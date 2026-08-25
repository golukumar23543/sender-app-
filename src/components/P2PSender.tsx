import React, { useState, useRef, useEffect, useCallback } from 'react';
import { UploadCloud, FileType, CheckCircle2, Copy, Loader2, ArrowLeft, Zap, Shield, Sparkles, Check } from 'lucide-react';
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
  const [copied, setCopied] = useState(false);

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

  const copyRoomLink = () => {
    if (!roomId) return;
    const link = `${window.location.origin}/?room=${roomId}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const joinLink = roomId ? `${window.location.origin}/?room=${roomId}` : '';

  return (
    <div className="w-full">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel rounded-3xl sm:rounded-[2.5rem] p-5 sm:p-8 md:p-10 relative overflow-hidden"
      >
        <div className="absolute -top-20 -right-20 w-48 h-48 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />
        
        <motion.button 
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          onClick={onBack}
          className="absolute top-5 left-5 sm:top-6 sm:left-6 p-2 sm:p-2.5 text-neutral-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] rounded-xl sm:rounded-2xl transition-all duration-200 z-20 border border-white/[0.08]"
        >
          <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
        </motion.button>

        <div className="text-center mb-6 sm:mb-8 mt-1 relative z-10">
          <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-indigo-500/20 to-purple-600/20 text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-3 sm:mb-4 border border-indigo-500/30 shadow-[0_0_30px_rgba(99,102,241,0.3)]">
            <UploadCloud className="w-6 h-6 sm:w-7 sm:h-7" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Send Files</h1>
          <p className="text-xs text-neutral-400 mt-1">Direct P2P Encrypted Stream</p>
        </div>

        <AnimatePresence mode="wait">
          {status === 'selecting' && (
            <motion.div
              key="dropzone"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className={cn(
                "relative z-10 border-2 border-dashed rounded-2xl sm:rounded-3xl p-6 sm:p-10 md:p-12 text-center transition-all duration-300 cursor-pointer overflow-hidden group",
                dragActive 
                  ? "border-indigo-400 bg-indigo-500/15 shadow-[0_0_40px_rgba(99,102,241,0.3)]" 
                  : "border-white/[0.1] hover:border-indigo-500/50 bg-white/[0.02] hover:bg-white/[0.04]"
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
              <div className="w-14 h-14 sm:w-16 sm:h-16 bg-neutral-900/90 rounded-2xl flex items-center justify-center mx-auto mb-3 sm:mb-4 border border-white/[0.08] shadow-inner group-hover:scale-105 group-hover:border-indigo-500/40 transition-all">
                <FileType className={cn("w-7 h-7 sm:w-8 sm:h-8 transition-colors", dragActive ? "text-indigo-300" : "text-neutral-400 group-hover:text-indigo-400")} />
              </div>
              <h3 className="text-sm sm:text-base font-semibold text-neutral-100 group-hover:text-white transition-colors">Tap or Drop files here</h3>
              <p className="text-xs text-neutral-400 mt-1 sm:mt-1.5 font-medium">All formats supported • No file size limit</p>
              
              <div className="mt-4 sm:mt-6 inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[11px] font-medium text-indigo-300">
                <Sparkles className="w-3 h-3" />
                <span>Ready for instant transfer</span>
              </div>
            </motion.div>
          )}

          {status === 'waiting' && roomId && (
            <motion.div
              key="waiting"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="text-center space-y-6 relative z-10"
            >
              <div>
                <div className="inline-block px-3 py-1 bg-amber-500/10 border border-amber-500/25 rounded-full text-amber-300 text-xs font-semibold mb-2">
                  Waiting for connection
                </div>
                <h3 className="text-lg font-bold text-white">Receiver PIN Code</h3>
                <p className="text-xs text-neutral-400 mt-1">Enter this 6-digit code on the other device:</p>
              </div>

              <div className="flex justify-center items-center">
                <div className="relative group">
                  <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-3xl blur opacity-30 group-hover:opacity-60 transition duration-300"></div>
                  <div className="relative bg-neutral-950/90 border-2 border-indigo-500/40 rounded-2xl py-4 px-8 text-4xl sm:text-5xl font-extrabold tracking-[0.25em] text-indigo-300 font-mono shadow-2xl">
                    {roomId}
                  </div>
                </div>
              </div>

              {/* QR Code Container */}
              <div className="py-2 flex flex-col items-center">
                <p className="text-[11px] text-neutral-400 mb-3 uppercase tracking-wider font-bold">Or Scan Directly</p>
                <div className="p-3.5 bg-white rounded-2xl shadow-xl inline-block border-4 border-neutral-800">
                  <QRCodeSVG value={joinLink} size={130} level="M" />
                </div>
              </div>

              <div className="flex items-center justify-center space-x-3 pt-2">
                <button
                  onClick={copyRoomLink}
                  className="flex items-center space-x-2 text-xs font-semibold px-4 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-neutral-300 transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Link Copied!' : 'Copy Direct Link'}</span>
                </button>
              </div>
              
              <div className="flex items-center justify-center space-x-2 text-xs text-neutral-400 font-medium pt-2">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                <span>Listening for peer signal...</span>
              </div>
            </motion.div>
          )}

          {status === 'connecting' && (
             <motion.div
                key="connecting"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center py-10 relative z-10"
              >
                <div className="w-16 h-16 rounded-2xl bg-indigo-500/20 flex items-center justify-center text-indigo-400 border border-indigo-500/30 mb-4 animate-pulse">
                  <Loader2 className="w-8 h-8 animate-spin" />
                </div>
                <h3 className="text-base font-bold text-white">Connecting Peers</h3>
                <p className="text-xs text-neutral-400 mt-1">Establishing direct encrypted WebRTC channel...</p>
             </motion.div>
          )}

          {status === 'transferring' && file && (
            <motion.div
              key="transferring"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="space-y-6 relative z-10"
            >
              <div className="glass-card rounded-2xl p-4 flex items-center space-x-4 border border-white/[0.08] shadow-lg">
                <div className="w-12 h-12 bg-indigo-500/20 border border-indigo-500/30 rounded-xl flex items-center justify-center flex-shrink-0 text-indigo-400">
                  <FileType className="w-6 h-6" />
                </div>
                <div className="overflow-hidden flex-1">
                  <p className="text-sm font-bold text-white truncate">{file.name}</p>
                  <p className="text-xs text-neutral-400 font-mono">{formatBytes(file.size)}</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs font-semibold text-neutral-300">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
                    <span>Streaming Data</span>
                  </span>
                  <span className="text-indigo-300 font-mono text-sm">{progress.toFixed(1)}%</span>
                </div>
                
                <div className="w-full bg-neutral-950 rounded-full h-3 overflow-hidden p-0.5 border border-white/[0.08] shadow-inner">
                  <motion.div
                    className="bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-400 h-full rounded-full shadow-[0_0_15px_rgba(99,102,241,0.6)]"
                    style={{ width: `${progress}%` }}
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                  />
                </div>
                
                <div className="flex justify-between items-center text-xs text-neutral-400 pt-1 font-mono">
                  <span>Transfer Speed:</span>
                  <span className="text-indigo-400 font-bold bg-indigo-500/10 px-2.5 py-0.5 rounded-md border border-indigo-500/20">
                    {speed || 'Calculating...'}
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
                <h3 className="text-xl font-bold text-white">Transfer Complete!</h3>
                <p className="text-xs text-neutral-400 mt-1.5">File sent directly with 100% data integrity.</p>
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
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold py-3.5 rounded-2xl transition-all duration-300 shadow-xl border border-indigo-400/30 cursor-pointer"
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

