import React, { useState, useRef, useEffect } from 'react';
import { Download, FileType, CheckCircle2, Loader2, FileWarning, ArrowLeft, KeyRound, Sparkles, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatBytes } from '../lib/utils';
import { db } from '../lib/firebase';
import { doc, getDoc, onSnapshot, collection, addDoc, updateDoc } from 'firebase/firestore';

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
  const metadataRef = useRef<FileMetadata | null>(null);
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
        setErrorMessage('Room does not exist. Check the 6-digit PIN.');
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
            const newMetadata = {
              name: msg.name,
              size: msg.size,
              mimeType: msg.mimeType
            };
            setMetadata(newMetadata);
            metadataRef.current = newMetadata;
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
              const meta = metadataRef.current;
              const blob = new Blob(chunksRef.current, { type: meta?.mimeType || 'application/octet-stream' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = meta?.name || 'download';
              a.click();
              chunksRef.current = [];
              URL.revokeObjectURL(url);
            }
            setStatus('completed');
          }
        } else {
          receivedBytesRef.current += event.data.byteLength;
          bytesSinceLastRef.current += event.data.byteLength;
          
          if (metadataRef.current) {
            setProgress((receivedBytesRef.current / metadataRef.current.size) * 100);
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
    
    // Listen for room updates
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
      <div className="w-full max-w-md mx-auto glass-panel rounded-3xl sm:rounded-[2.5rem] p-6 sm:p-8 text-center relative overflow-hidden">
        <div className="relative z-10">
          <div className="w-14 h-14 sm:w-16 sm:h-16 bg-red-500/20 rounded-2xl flex items-center justify-center mx-auto text-red-400 mb-5 sm:mb-6 border border-red-500/30 shadow-[0_0_30px_rgba(239,68,68,0.2)]">
            <FileWarning className="w-7 h-7 sm:w-8 sm:h-8" />
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-white mb-2">Connection Failed</h2>
          <p className="text-neutral-400 text-xs mb-6 sm:mb-8">{errorMessage || 'This transfer session is already active, closed, or does not exist.'}</p>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
               setPin('');
               setStatus('entering-pin');
            }}
            className="w-full bg-white/[0.06] hover:bg-white/[0.1] text-white font-semibold py-3 sm:py-3.5 rounded-xl sm:rounded-2xl transition-all duration-300 border border-white/[0.1] shadow-lg cursor-pointer text-sm"
          >
            Try Again
          </motion.button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel rounded-3xl sm:rounded-[2.5rem] p-5 sm:p-8 md:p-10 relative overflow-hidden"
      >
        <div className="absolute -top-20 -left-20 w-48 h-48 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />
        
        <motion.button 
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          onClick={onBack}
          className="absolute top-5 left-5 sm:top-6 sm:left-6 p-2 sm:p-2.5 text-neutral-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] rounded-xl sm:rounded-2xl transition-all duration-200 z-20 border border-white/[0.08]"
        >
          <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
        </motion.button>

        <div className="text-center mb-6 sm:mb-8 mt-1 relative z-10">
          <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-emerald-500/20 to-teal-600/20 text-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-3 sm:mb-4 border border-emerald-500/30 shadow-[0_0_30px_rgba(16,185,129,0.3)]">
            <Download className="w-6 h-6 sm:w-7 sm:h-7" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Receive Files</h1>
          <p className="text-xs text-neutral-400 mt-1">Direct P2P Encrypted Stream</p>
        </div>

        <AnimatePresence mode="wait">
          {status === 'entering-pin' && (
            <motion.div
              key="entering-pin"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="text-center space-y-6 relative z-10"
            >
              <div className="space-y-3">
                <label className="block text-xs font-semibold text-neutral-300 uppercase tracking-wider text-center flex items-center justify-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Enter 6-Digit Transfer PIN</span>
                </label>
                
                <div className="relative group">
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-300"></div>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="• • • • • •"
                    className="relative w-full text-center text-3xl sm:text-4xl tracking-[0.25em] font-mono text-emerald-300 font-bold bg-neutral-950/80 border-2 border-white/[0.1] focus:border-emerald-500/60 focus:ring-4 focus:ring-emerald-500/10 rounded-2xl py-4 transition-all outline-none placeholder:text-neutral-700 shadow-inner"
                    autoFocus
                  />
                </div>
              </div>

              <motion.button
                whileHover={pin.length === 6 ? { scale: 1.02 } : {}}
                whileTap={pin.length === 6 ? { scale: 0.98 } : {}}
                onClick={() => handleConnect(pin)}
                disabled={pin.length !== 6}
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-2xl transition-all duration-300 shadow-xl border border-emerald-400/30 cursor-pointer text-sm"
              >
                Connect & Download
              </motion.button>
            </motion.div>
          )}

          {(status === 'joining' || status === 'connecting' || status === 'waiting-info') && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center py-10 relative z-10"
            >
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 flex items-center justify-center text-emerald-400 border border-emerald-500/30 mb-4 animate-pulse">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>
              <p className="text-sm font-bold text-white">
                {status === 'joining' ? 'Joining transfer session...' : 
                 status === 'connecting' ? 'Establishing P2P tunnel...' : 
                 'Waiting for sender to stream...'}
              </p>
              <p className="text-xs text-neutral-400 mt-1">Direct device connection via WebRTC</p>
            </motion.div>
          )}

          {status === 'transferring' && metadata && (
             <motion.div
              key="transferring"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="space-y-6 relative z-10"
            >
              <div className="glass-card rounded-2xl p-4 flex items-center space-x-4 border border-white/[0.08] shadow-lg">
                <div className="w-12 h-12 bg-emerald-500/20 border border-emerald-500/30 rounded-xl flex items-center justify-center flex-shrink-0 text-emerald-400">
                  <FileType className="w-6 h-6" />
                </div>
                <div className="overflow-hidden flex-1">
                  <p className="text-sm font-bold text-white truncate">{metadata.name}</p>
                  <p className="text-xs text-neutral-400 font-mono">{formatBytes(metadata.size)}</p>
                </div>
              </div>

              {!useStreamRef.current && metadata.size > 1000000000 && (
                <div className="text-xs text-amber-300 bg-amber-500/10 p-3 rounded-xl border border-amber-500/20 text-center leading-relaxed">
                  Notice: Saving a very large file to memory. Your browser may pause briefly when the transfer finishes.
                </div>
              )}

              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs font-semibold text-neutral-300">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    <span>Receiving Stream</span>
                  </span>
                  <span className="text-emerald-300 font-mono text-sm">{progress.toFixed(1)}%</span>
                </div>
                
                <div className="w-full bg-neutral-950 rounded-full h-3 overflow-hidden p-0.5 border border-white/[0.08] shadow-inner">
                  <motion.div
                    className="bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-400 h-full rounded-full shadow-[0_0_15px_rgba(16,185,129,0.6)]"
                    style={{ width: `${progress}%` }}
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                  />
                </div>
                
                <div className="flex justify-between items-center text-xs text-neutral-400 pt-1 font-mono">
                  <span>Transfer Speed:</span>
                  <span className="text-emerald-400 font-bold bg-emerald-500/10 px-2.5 py-0.5 rounded-md border border-emerald-500/20">
                    {speed || 'Streaming...'}
                  </span>
                </div>
              </div>
            </motion.div>
          )}

          {status === 'completed' && (
            <motion.div
              key="completed"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center space-y-6 relative z-10 py-2"
            >
              <div className="relative w-20 h-20 mx-auto">
                <div className="absolute inset-0 bg-emerald-500/30 rounded-3xl blur-xl animate-pulse" />
                <motion.div 
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 240, damping: 16 }}
                  className="relative w-full h-full bg-gradient-to-br from-emerald-500 to-teal-600 rounded-3xl flex items-center justify-center text-white shadow-xl"
                >
                  <CheckCircle2 className="w-10 h-10" />
                </motion.div>
              </div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
              >
                <h3 className="text-xl font-bold text-white">Download Complete!</h3>
                <p className="text-xs text-neutral-400 mt-1.5">File successfully transferred and saved to your device.</p>
              </motion.div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onBack}
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold py-3.5 rounded-2xl transition-all duration-300 shadow-xl border border-emerald-400/30 cursor-pointer"
              >
                Done
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

