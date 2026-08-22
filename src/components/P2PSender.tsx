import React, { useState, useRef, useEffect, useCallback } from 'react';
import { UploadCloud, FileType, CheckCircle2, Copy, Loader2, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import { cn, formatBytes } from '../lib/utils';
import { db } from '../lib/firebase';
import { doc, setDoc, updateDoc, onSnapshot, collection, addDoc, serverTimestamp, getDocs, deleteDoc } from 'firebase/firestore';

const CHUNK_SIZE = 65536; // 64KB chunks for optimal WebRTC performance
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

interface P2PSenderProps {
  onBack: () => void;
}

export function P2PSender({ onBack }: P2PSenderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [status, setStatus] = useState<'selecting' | 'waiting' | 'connecting' | 'transferring' | 'completed'>('selecting');
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Cleanup listeners
  const unsubRoomRef = useRef<() => void>();
  const unsubCalleeRef = useRef<() => void>();

  // Speed calculation
  const lastTimeRef = useRef<number>(Date.now());
  const bytesSinceLastRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      pcRef.current?.close();
      if (unsubRoomRef.current) unsubRoomRef.current();
      if (unsubCalleeRef.current) unsubCalleeRef.current();
      // Clean up room on exit if we created one
      if (roomId) {
        deleteDoc(doc(db, 'rooms', roomId)).catch(() => {});
      }
    };
  }, [roomId]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      startSession(e.dataTransfer.files[0]);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      startSession(e.target.files[0]);
    }
  };

  const startSession = async (selectedFile: File) => {
    try {
      setFile(selectedFile);
      const newRoomId = Math.floor(100000 + Math.random() * 900000).toString();
      setRoomId(newRoomId);
      setStatus('waiting');
      
      const roomRef = doc(db, 'rooms', newRoomId);
      await setDoc(roomRef, { createdAt: serverTimestamp(), status: 'waiting' });
      
      await initializePeerConnection(newRoomId, selectedFile);
    } catch (e: any) {
      console.error(e);
      alert('Failed to start transfer session: ' + e.message);
      setStatus('selecting');
    }
  };

  const initializePeerConnection = async (room: string, fileToSend: File) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;
    
    const roomRef = doc(db, 'rooms', room);
    const callerCandidatesCollection = collection(roomRef, 'callerCandidates');
    const calleeCandidatesCollection = collection(roomRef, 'calleeCandidates');
    
    pc.onicecandidate = async (e) => {
      if (e.candidate) {
        await addDoc(callerCandidatesCollection, e.candidate.toJSON());
      }
    };
    
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
         // handle disconnect
      }
    };

    // Create Data Channel
    const dc = pc.createDataChannel('fileTransfer', {
      ordered: true
    });
    dcRef.current = dc;
    
    if ('bufferedAmountLowThreshold' in dc) {
      dc.bufferedAmountLowThreshold = 65536 * 4;
    }

    dc.onopen = () => {
      setStatus('transferring');
      sendFileChunks(fileToSend, dc);
    };

    // Create Offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    await updateDoc(roomRef, {
      offer: {
        type: offer.type,
        sdp: offer.sdp,
      },
    });
    
    // Listen for remote answer
    unsubRoomRef.current = onSnapshot(roomRef, async (snapshot) => {
      const data = snapshot.data();
      if (!pc.currentRemoteDescription && data && data.answer) {
        setStatus('connecting');
        const answer = new RTCSessionDescription(data.answer);
        await pc.setRemoteDescription(answer);
      }
    });
    
    // Listen for remote ICE candidates
    unsubCalleeRef.current = onSnapshot(calleeCandidatesCollection, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          await pc.addIceCandidate(new RTCIceCandidate(data));
        }
      });
    });
  };

  const sendFileChunks = (file: File, dc: RTCDataChannel) => {
    let offset = 0;
    lastTimeRef.current = Date.now();
    bytesSinceLastRef.current = 0;
    
    dc.send(JSON.stringify({
      type: 'metadata',
      name: file.name,
      size: file.size,
      mimeType: file.type
    }));

    const readSlice = () => {
      if (offset >= file.size) {
        if (dc.readyState === 'open') {
          dc.send(JSON.stringify({ type: 'eof' }));
        }
        setStatus('completed');
        return;
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      slice.arrayBuffer().then(buffer => {
        if (dc.readyState !== 'open') {
          console.error("Data channel is not open");
          setStatus('error');
          return;
        }
        
        dc.send(buffer);
        offset += buffer.byteLength;
        bytesSinceLastRef.current += buffer.byteLength;
        
        const now = Date.now();
        if (now - lastTimeRef.current > 1000) {
          const speedBps = (bytesSinceLastRef.current / (now - lastTimeRef.current)) * 1000;
          setSpeed(formatBytes(speedBps) + '/s');
          lastTimeRef.current = now;
          bytesSinceLastRef.current = 0;
        }
        setProgress((offset / file.size) * 100);
        
        if (dc.bufferedAmount > (dc.bufferedAmountLowThreshold || 65536 * 4)) {
          dc.onbufferedamountlow = () => {
            dc.onbufferedamountlow = null;
            readSlice();
          };
        } else {
           if (offset % (CHUNK_SIZE * 50) === 0) {
              setTimeout(readSlice, 0);
           } else {
              readSlice();
           }
        }
      }).catch(err => {
        console.error("Error reading file", err);
      });
    };
    
    readSlice();
  };

  const joinLink = roomId ? `${window.location.origin}/?room=${roomId}` : '';

  return (
    <div className="w-full">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-neutral-900/50 backdrop-blur-2xl border border-neutral-800 shadow-2xl rounded-[2rem] p-8 relative overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
        
        <motion.button 
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={onBack}
          className="absolute top-6 left-6 p-2 text-neutral-400 hover:text-white bg-neutral-800/50 hover:bg-neutral-700 rounded-full transition-colors duration-300 z-10 border border-neutral-700/50"
        >
          <ArrowLeft className="w-5 h-5" />
        </motion.button>

        <div className="text-center mb-8 mt-2 relative z-10">
          <div className="w-12 h-12 bg-indigo-500/20 text-indigo-400 rounded-full flex items-center justify-center mx-auto mb-4 border border-indigo-500/30">
            <UploadCloud className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Send File</h1>
        </div>

        <AnimatePresence mode="wait">
          {status === 'selecting' && (
            <motion.div
              key="dropzone"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={cn(
                "relative z-10 border-2 border-dashed rounded-2xl p-10 text-center transition-all duration-300 cursor-pointer shadow-inner",
                dragActive ? "border-indigo-500 bg-indigo-500/10" : "border-neutral-700 hover:border-indigo-400/50 hover:bg-neutral-800/50"
              )}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleChange}
              />
              <FileType className={cn("w-10 h-10 mx-auto mb-4 transition-colors", dragActive ? "text-indigo-400" : "text-neutral-500")} />
              <h3 className="text-sm font-medium text-neutral-200">Click or drag any file here</h3>
              <p className="text-xs text-neutral-500 mt-1">Unlimited file size support</p>
            </motion.div>
          )}

          {status === 'waiting' && roomId && (
            <motion.div
              key="waiting"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="text-center space-y-6 relative z-10"
            >
              <div>
                <h3 className="text-lg font-medium text-white">Waiting for receiver</h3>
                <p className="text-sm text-neutral-400 mt-1">Enter this PIN on the receiving device to connect.</p>
              </div>

              <div className="flex justify-center items-center">
                <div className="bg-neutral-950/50 border-2 border-neutral-800 rounded-2xl py-4 px-8 text-4xl font-bold tracking-[0.25em] text-indigo-400 font-mono shadow-inner">
                  {roomId}
                </div>
              </div>

              <div className="py-4 flex flex-col items-center">
                <p className="text-xs text-neutral-500 mb-4 uppercase tracking-wider font-semibold">Or Scan QR</p>
                <div className="bg-white p-3 rounded-xl shadow-sm border border-neutral-200 inline-block">
                  <QRCodeSVG value={joinLink} size={120} />
                </div>
              </div>
              
              <div className="flex items-center justify-center space-x-2 text-sm text-neutral-400 animate-pulse">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                <span>Waiting for connection...</span>
              </div>
            </motion.div>
          )}

          {status === 'connecting' && (
             <motion.div
                key="connecting"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center py-8 relative z-10"
              >
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mb-4" />
                <p className="text-sm font-medium text-neutral-300">Establishing P2P direct connection...</p>
             </motion.div>
          )}

          {status === 'transferring' && file && (
            <motion.div
              key="transferring"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6 relative z-10"
            >
              <div className="bg-neutral-800/50 rounded-2xl p-4 flex items-center space-x-4 border border-neutral-700/50 shadow-inner">
                <div className="w-10 h-10 bg-neutral-900 border border-neutral-800 rounded-lg shadow-sm flex items-center justify-center flex-shrink-0">
                  <FileType className="w-5 h-5 text-indigo-400" />
                </div>
                <div className="overflow-hidden flex-1">
                  <p className="text-sm font-medium text-neutral-200 truncate">{file.name}</p>
                  <p className="text-xs text-neutral-500">{formatBytes(file.size)}</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium text-neutral-400 mb-1">
                  <span>Transferring...</span>
                  <span className="text-indigo-400">{progress.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-neutral-800 rounded-full h-2 overflow-hidden shadow-inner border border-neutral-700/50">
                  <motion.div
                    className="bg-gradient-to-r from-indigo-500 to-purple-500 h-full rounded-full"
                    style={{ width: `${progress}%` }}
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex justify-end text-xs text-neutral-500 pt-1 font-mono">
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
              className="text-center space-y-6 relative z-10"
            >
              <motion.div 
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
                className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto text-emerald-400 border border-emerald-500/30"
              >
                <motion.div
                  initial={{ rotate: -90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                >
                  <CheckCircle2 className="w-8 h-8" />
                </motion.div>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <h3 className="text-lg font-medium text-white">Transfer Complete!</h3>
                <p className="text-sm text-neutral-400 mt-1">File sent successfully via P2P.</p>
              </motion.div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  setFile(null);
                  setRoomId(null);
                  setStatus('selecting');
                  setProgress(0);
                }}
                className="w-full bg-neutral-800 hover:bg-neutral-700 text-white font-medium py-3 rounded-xl transition-colors duration-300 shadow-lg border border-neutral-700 hover:border-neutral-500"
              >
                Send Another File
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
