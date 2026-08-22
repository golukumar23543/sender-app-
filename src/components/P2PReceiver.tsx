import React, { useState, useRef, useEffect } from 'react';
import { Download, FileType, CheckCircle2, Loader2, FileWarning, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatBytes } from '../lib/utils';
import { db } from '../lib/firebase';
import { doc, getDoc, setDoc, onSnapshot, collection, addDoc, updateDoc } from 'firebase/firestore';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

interface FileMetadata {
  name: string;
  size: number;
  mimeType: string;
}

interface P2PReceiverProps {
  initialRoom: string | null;
  onBack: () => void;
}

export function P2PReceiver({ initialRoom, onBack }: P2PReceiverProps) {
  const [status, setStatus] = useState<'entering-pin' | 'joining' | 'connecting' | 'waiting-info' | 'transferring' | 'completed' | 'full' | 'error'>('entering-pin');
  const [errorMessage, setErrorMessage] = useState('');
  const [pin, setPin] = useState('');
  const [metadata, setMetadata] = useState<FileMetadata | null>(null);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState('');
  
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const unsubRoomRef = useRef<() => void>();
  const unsubCallerRef = useRef<() => void>();
  
  const receivedBytesRef = useRef(0);
  const chunksRef = useRef<ArrayBuffer[]>([]);
  const fileStreamRef = useRef<any>(null);
  const useStreamRef = useRef(false);
  
  const lastTimeRef = useRef<number>(Date.now());
  const bytesSinceLastRef = useRef<number>(0);

  useEffect(() => {
    if (initialRoom) {
      handleConnect(initialRoom);
    }
    return () => {
      pcRef.current?.close();
      if (unsubRoomRef.current) unsubRoomRef.current();
      if (unsubCallerRef.current) unsubCallerRef.current();
    };
  }, [initialRoom]);

  const handleConnect = async (roomToJoin: string) => {
    if (!roomToJoin || roomToJoin.length !== 6) return;
    setStatus('joining');
    
    try {
      const roomRef = doc(db, 'rooms', roomToJoin);
      const roomSnapshot = await getDoc(roomRef);
      
      if (!roomSnapshot.exists()) {
        setErrorMessage('Room does not exist.');
        setStatus('error');
        return;
      }
      
      setStatus('connecting');
      await initializePeerConnection(roomToJoin, roomSnapshot.data());
    } catch (e: any) {
      console.error(e);
      setErrorMessage(e.message || 'Failed to connect to the room.');
      setStatus('error');
    }
  };

  const initializePeerConnection = async (room: string, roomData: any) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;
    
    const roomRef = doc(db, 'rooms', room);
    const callerCandidatesCollection = collection(roomRef, 'callerCandidates');
    const calleeCandidatesCollection = collection(roomRef, 'calleeCandidates');

    pc.onicecandidate = async (e) => {
      if (e.candidate) {
        await addDoc(calleeCandidatesCollection, e.candidate.toJSON());
      }
    };

    pc.ondatachannel = (e) => {
      const dc = e.channel;
      setStatus('waiting-info');
      
      dc.onmessage = async (event) => {
        if (typeof event.data === 'string') {
          const msg = JSON.parse(event.data);
          
          if (msg.type === 'metadata') {
            setMetadata({
              name: msg.name,
              size: msg.size,
              mimeType: msg.mimeType
            });
            setStatus('transferring');
            lastTimeRef.current = Date.now();
            bytesSinceLastRef.current = 0;
            
            if ('showSaveFilePicker' in window) {
              try {
                // @ts-ignore
                const handle = await window.showSaveFilePicker({ suggestedName: msg.name });
                fileStreamRef.current = await handle.createWritable();
                useStreamRef.current = true;
              } catch (err) {
                console.warn('User cancelled save picker, falling back to memory blob');
                useStreamRef.current = false;
              }
            }
          } else if (msg.type === 'eof') {
            if (useStreamRef.current && fileStreamRef.current) {
              await fileStreamRef.current.close();
            } else {
              const blob = new Blob(chunksRef.current, { type: metadata?.mimeType });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = metadata?.name || 'download';
              a.click();
              chunksRef.current = [];
              URL.revokeObjectURL(url);
            }
            setStatus('completed');
          }
        } else {
          receivedBytesRef.current += event.data.byteLength;
          bytesSinceLastRef.current += event.data.byteLength;
          
          if (metadata) {
            setProgress((receivedBytesRef.current / metadata.size) * 100);
          }
          
          const now = Date.now();
          if (now - lastTimeRef.current > 1000) {
            const speedBps = (bytesSinceLastRef.current / (now - lastTimeRef.current)) * 1000;
            setSpeed(formatBytes(speedBps) + '/s');
            lastTimeRef.current = now;
            bytesSinceLastRef.current = 0;
          }

          if (useStreamRef.current && fileStreamRef.current) {
            await fileStreamRef.current.write(event.data);
          } else {
            chunksRef.current.push(event.data);
          }
        }
      };
    };
    
    // Listen for room updates (specifically for the offer if it wasn't there yet)
    unsubRoomRef.current = onSnapshot(roomRef, async (snapshot) => {
      const data = snapshot.data();
      if (!data) return;

      if (data.offer && !pc.currentRemoteDescription) {
        try {
          const offer = new RTCSessionDescription(data.offer);
          await pc.setRemoteDescription(offer);
          
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          
          await updateDoc(roomRef, {
            answer: {
              type: answer.type,
              sdp: answer.sdp,
            }
          });
        } catch (e) {
          console.error("Failed to process offer:", e);
        }
      }
    });

    // Listen for remote ICE candidates
    unsubCallerRef.current = onSnapshot(callerCandidatesCollection, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          await pc.addIceCandidate(new RTCIceCandidate(data));
        }
      });
    });
  };

  if (status === 'full' || status === 'error') {
    return (
      <div className="w-full max-w-md mx-auto bg-white border border-slate-200 shadow-xl rounded-3xl p-8 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-500 mb-6">
          <FileWarning className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2">Connection Failed</h2>
        <p className="text-slate-500 mb-8">{errorMessage || 'This transfer session is already active, closed, or does not exist.'}</p>
        <button
          onClick={() => {
             setPin('');
             setStatus('entering-pin');
          }}
          className="w-full bg-slate-900 text-white font-medium py-3 rounded-xl"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="w-full">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white/80 backdrop-blur-xl border border-white/40 shadow-2xl rounded-3xl p-8 relative"
      >
        <button 
          onClick={onBack}
          className="absolute top-6 left-6 p-2 text-slate-400 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-full transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="text-center mb-8 mt-2">
          <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <Download className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Receive File</h1>
        </div>

        <AnimatePresence mode="wait">
          {status === 'entering-pin' && (
            <motion.div
              key="entering-pin"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="text-center space-y-6"
            >
              <p className="text-slate-500 text-sm">Enter the 6-digit PIN from the sender to connect.</p>
              
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="000000"
                className="w-full text-center text-4xl font-bold tracking-[0.25em] text-slate-900 bg-slate-50 border-2 border-slate-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 rounded-2xl py-4 transition-all outline-none"
              />

              <button
                onClick={() => handleConnect(pin)}
                disabled={pin.length !== 6}
                className="w-full bg-blue-600 disabled:bg-slate-200 disabled:text-slate-400 hover:bg-blue-700 text-white font-medium py-4 rounded-xl transition-colors shadow-lg shadow-blue-500/30 disabled:shadow-none"
              >
                Connect
              </button>
            </motion.div>
          )}

          {(status === 'joining' || status === 'connecting' || status === 'waiting-info') && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center py-8"
            >
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-4" />
              <p className="text-sm font-medium text-slate-700">
                {status === 'joining' ? 'Joining session...' : 
                 status === 'connecting' ? 'Establishing P2P connection...' : 
                 'Waiting for sender to start transfer...'}
              </p>
            </motion.div>
          )}

          {status === 'transferring' && metadata && (
             <motion.div
              key="transferring"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6"
            >
              <div className="bg-slate-50 rounded-2xl p-4 flex items-center space-x-4 border border-slate-100">
                <div className="w-10 h-10 bg-white rounded-lg shadow-sm flex items-center justify-center flex-shrink-0">
                  <FileType className="w-5 h-5 text-blue-500" />
                </div>
                <div className="overflow-hidden flex-1">
                  <p className="text-sm font-medium text-slate-800 truncate">{metadata.name}</p>
                  <p className="text-xs text-slate-500">{formatBytes(metadata.size)}</p>
                </div>
              </div>

              {!useStreamRef.current && metadata.size > 1000000000 && (
                <div className="text-xs text-amber-600 bg-amber-50 p-2 rounded-lg border border-amber-100 text-center">
                  Notice: Saving a very large file to memory. Your browser may pause briefly when the transfer finishes.
                </div>
              )}

              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium text-slate-600 mb-1">
                  <span>Receiving...</span>
                  <span>{progress.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <motion.div
                    className="bg-blue-600 h-full rounded-full"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex justify-end text-xs text-slate-400 font-mono">
                  {speed}
                </div>
              </div>
            </motion.div>
          )}

          {status === 'completed' && (
            <motion.div
              key="completed"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center space-y-6"
            >
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto text-green-600">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-slate-900">Download Complete!</h3>
                <p className="text-sm text-slate-500 mt-1 text-balance">The file has been successfully transferred and saved to your device.</p>
              </div>

              <button
                onClick={onBack}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium py-3 rounded-xl transition-colors shadow-lg shadow-slate-900/20"
              >
                Done
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
