import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  UploadCloud,
  FileType,
  CheckCircle2,
  Copy,
  Loader2,
  ArrowLeft,
  Sparkles,
  Check,
  Images,
  FolderPlus,
  X,
  Trash2,
  Film,
  Image as ImageIcon,
  Wifi,
  Send
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import { cn, formatBytes, formatDuration } from '../lib/utils';
import { db } from '../lib/firebase';
import { doc, setDoc, updateDoc, onSnapshot, collection, addDoc, serverTimestamp, deleteDoc } from 'firebase/firestore';

const READ_BLOCK_SIZE = 4 * 1024 * 1024; // 4 MB read-ahead block (minimizes iOS/disk IPC)
const HIGH_WATER_MARK = 8 * 1024 * 1024; // 8 MB SCTP send buffer ceiling
const LOW_WATER_MARK = 2 * 1024 * 1024;  // 2 MB bufferedAmountLowThreshold

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ],
  iceCandidatePoolSize: 4
};

interface P2PSenderProps {
  onBack: () => void;
}

interface QueuedFile {
  id: string;
  file: File;
}

function getFileIcon(mimeType: string, name: string) {
  const lower = name.toLowerCase();
  if (mimeType.startsWith('image/') || /\.(heic|heif|jpg|jpeg|png|gif|webp|raw|dng)$/.test(lower)) {
    return <ImageIcon className="w-4 h-4 text-pink-400" />;
  }
  if (mimeType.startsWith('video/') || /\.(mov|mp4|m4v|mkv|avi|webm|3gp)$/.test(lower)) {
    return <Film className="w-4 h-4 text-cyan-400" />;
  }
  return <FileType className="w-4 h-4 text-indigo-400" />;
}

export function P2PSender({ onBack }: P2PSenderProps) {
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [status, setStatus] = useState<'selecting' | 'waiting' | 'connecting' | 'transferring' | 'completed'>('selecting');
  const [progress, setProgress] = useState(0);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [currentFileName, setCurrentFileName] = useState('');
  const [transferredBytes, setTransferredBytes] = useState(0);
  const [speed, setSpeed] = useState('');
  const [eta, setEta] = useState('');
  const [connectionMode, setConnectionMode] = useState<'local' | 'p2p' | 'relay' | null>(null);
  const [summaryText, setSummaryText] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const ackResolveRef = useRef<(() => void) | null>(null);
  const wakeLockRef = useRef<any>(null);

  // Cleanup listeners
  const unsubRoomRef = useRef<(() => void) | undefined>(undefined);
  const unsubCalleeRef = useRef<(() => void) | undefined>(undefined);
  const roomIdRef = useRef<string | null>(null);

  const totalBatchBytes = queuedFiles.reduce((acc, item) => acc + item.file.size, 0);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator && !wakeLockRef.current) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      }
    } catch {
      // Ignore if unsupported or denied
    }
  }, []);

  const cleanupConnection = useCallback(() => {
    cancelledRef.current = true;
    pcRef.current?.close();
    pcRef.current = null;
    dcRef.current = null;
    if (unsubRoomRef.current) {
      unsubRoomRef.current();
      unsubRoomRef.current = undefined;
    }
    if (unsubCalleeRef.current) {
      unsubCalleeRef.current();
      unsubCalleeRef.current = undefined;
    }
    if (roomIdRef.current) {
      deleteDoc(doc(db, 'rooms', roomIdRef.current)).catch(() => {});
      roomIdRef.current = null;
    }
    releaseWakeLock();
  }, [releaseWakeLock]);

  useEffect(() => {
    return () => {
      cleanupConnection();
    };
  }, [cleanupConnection]);

  useEffect(() => {
    if (status === 'waiting' || status === 'connecting' || status === 'transferring') {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }
  }, [status, requestWakeLock, releaseWakeLock]);

  const addFilesToQueue = useCallback((fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;

    setErrorBanner(null);
    setQueuedFiles((prev) => {
      const existingKeys = new Set(prev.map((q) => `${q.file.name}-${q.file.size}-${q.file.lastModified}`));
      const next = [...prev];
      for (const f of incoming) {
        const key = `${f.name}-${f.size}-${f.lastModified}`;
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          next.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            file: f
          });
        } else {
          // Even if duplicate name/size/timestamp, allow adding if user picked intentionally
          next.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            file: f
          });
        }
      }
      return next;
    });
  }, []);

  const removeQueuedFile = (id: string) => {
    setQueuedFiles((prev) => prev.filter((item) => item.id !== id));
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        addFilesToQueue(e.dataTransfer.files);
      }
    },
    [addFilesToQueue]
  );

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFilesToQueue(e.target.files);
    }
    // Reset input so selecting the same or additional photos/videos on iPhone always fires onChange
    e.target.value = '';
  };

  const startSession = async () => {
    if (queuedFiles.length === 0) return;
    try {
      setErrorBanner(null);
      cancelledRef.current = false;
      const filesToSend = queuedFiles.map((q) => q.file);
      const newRoomId = Math.floor(100000 + Math.random() * 900000).toString();
      setRoomId(newRoomId);
      roomIdRef.current = newRoomId;
      setStatus('waiting');
      setProgress(0);
      setTransferredBytes(0);
      setSpeed('');
      setEta('');
      setConnectionMode(null);

      const roomRef = doc(db, 'rooms', newRoomId);
      await setDoc(roomRef, { createdAt: serverTimestamp(), status: 'waiting' });

      await initializePeerConnection(newRoomId, filesToSend);
    } catch (e: any) {
      console.error(e);
      setErrorBanner('Failed to start transfer session: ' + (e?.message || 'Unknown error'));
      setStatus('selecting');
    }
  };

  const detectConnectionType = async (pc: RTCPeerConnection) => {
    try {
      const stats = await pc.getStats();
      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
          const local = stats.get(report.localCandidateId);
          const remote = stats.get(report.remoteCandidateId);
          const cType = local?.candidateType || remote?.candidateType;
          if (cType === 'host') setConnectionMode('local');
          else if (cType === 'relay') setConnectionMode('relay');
          else if (cType) setConnectionMode('p2p');
        }
      });
    } catch {
      // Ignore stats errors
    }
  };

  const initializePeerConnection = async (room: string, filesToSend: File[]) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    const roomRef = doc(db, 'rooms', room);
    const callerCandidatesCollection = collection(roomRef, 'callerCandidates');
    const calleeCandidatesCollection = collection(roomRef, 'calleeCandidates');
    const pendingRemoteCandidates: RTCIceCandidateInit[] = [];

    pc.onicecandidate = async (e) => {
      if (e.candidate) {
        try {
          await addDoc(callerCandidatesCollection, e.candidate.toJSON());
        } catch {
          // Ignore signaling cleanup errors
        }
      }
    };

    const dc = pc.createDataChannel('fileTransfer', {
      ordered: true
    });
    dc.binaryType = 'arraybuffer';
    dcRef.current = dc;
    dc.bufferedAmountLowThreshold = LOW_WATER_MARK;

    dc.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'batch-ack' && ackResolveRef.current) {
            ackResolveRef.current();
            ackResolveRef.current = null;
          }
        } catch {
          // Ignore malformed control msg
        }
      }
    };

    dc.onopen = () => {
      setStatus('transferring');
      setTimeout(() => detectConnectionType(pc), 800);
      sendAllFiles(filesToSend, dc, pc);
    };

    dc.onerror = (err) => {
      console.error('DataChannel error:', err);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await updateDoc(roomRef, {
      offer: {
        type: offer.type,
        sdp: offer.sdp
      }
    });

    unsubRoomRef.current = onSnapshot(roomRef, async (snapshot) => {
      const data = snapshot.data();
      if (!pc.currentRemoteDescription && data && data.answer) {
        setStatus('connecting');
        const answer = new RTCSessionDescription(data.answer);
        await pc.setRemoteDescription(answer);
        while (pendingRemoteCandidates.length > 0) {
          const cand = pendingRemoteCandidates.shift();
          if (cand) {
            await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
        }
      }
    });

    unsubCalleeRef.current = onSnapshot(calleeCandidatesCollection, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const data = change.doc.data() as RTCIceCandidateInit;
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(data)).catch(() => {});
          } else {
            pendingRemoteCandidates.push(data);
          }
        }
      });
    });
  };

  const waitForBufferLow = (dc: RTCDataChannel): Promise<void> => {
    if (dc.bufferedAmount <= LOW_WATER_MARK || dc.readyState !== 'open' || cancelledRef.current) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        dc.removeEventListener('bufferedamountlow', onLow);
        clearInterval(poll);
        resolve();
      };
      const onLow = () => done();
      dc.addEventListener('bufferedamountlow', onLow);
      const poll = setInterval(() => {
        if (dc.readyState !== 'open' || dc.bufferedAmount <= LOW_WATER_MARK || cancelledRef.current) {
          done();
        }
      }, 20);
    });
  };

  const waitForChannelDrain = (dc: RTCDataChannel): Promise<void> => {
    if (dc.bufferedAmount === 0 || dc.readyState !== 'open' || cancelledRef.current) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const poll = setInterval(() => {
        if (dc.readyState !== 'open' || dc.bufferedAmount === 0 || cancelledRef.current) {
          clearInterval(poll);
          resolve();
        }
      }, 25);
    });
  };

  const safeSendBinary = async (dc: RTCDataChannel, view: Uint8Array) => {
    while (!cancelledRef.current && dc.readyState === 'open') {
      if (dc.bufferedAmount > HIGH_WATER_MARK) {
        await waitForBufferLow(dc);
        continue;
      }
      try {
        dc.send(view);
        return;
      } catch {
        // SCTP send queue momentarily full; yield briefly and wait for buffer to drain
        await new Promise((r) => setTimeout(r, 15));
      }
    }
  };

  const sendAllFiles = async (files: File[], dc: RTCDataChannel, pc: RTCPeerConnection) => {
    const startTime = Date.now();
    let lastUiUpdate = startTime;
    let totalSent = 0;
    let lastSampleSent = 0;
    let lastSampleTime = startTime;
    let smoothedBps = 0;

    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

    // Use negotiated SCTP maxMessageSize (up to 256KB) for 4x lower framing overhead vs 64KB
    const remoteMaxMsg = pc.sctp?.maxMessageSize || 65536;
    const chunkSize = remoteMaxMsg >= 262144 ? 262144 : Math.min(Math.max(remoteMaxMsg, 16384), 65536);

    try {
      dc.send(
        JSON.stringify({
          type: 'batch-start',
          totalFiles: files.length,
          totalBytes
        })
      );

      for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
        if (cancelledRef.current || dc.readyState !== 'open') return;

        const file = files[fileIdx];
        setCurrentFileIndex(fileIdx);
        setCurrentFileName(file.name);

        dc.send(
          JSON.stringify({
            type: 'metadata',
            index: fileIdx,
            totalFiles: files.length,
            totalBytes,
            name: file.name,
            size: file.size,
            mimeType: file.type || 'application/octet-stream'
          })
        );

        let offset = 0;
        let chunksSinceYield = 0;

        // Prefetch the first 4MB block immediately
        let nextBlockPromise: Promise<ArrayBuffer> | null =
          file.size > 0
            ? file.slice(0, Math.min(READ_BLOCK_SIZE, file.size)).arrayBuffer()
            : null;

        while (offset < file.size && !cancelledRef.current && dc.readyState === 'open') {
          const currentBlockBuffer = await nextBlockPromise!;
          const blockLen = currentBlockBuffer.byteLength;
          const nextOffset = offset + blockLen;

          // Simultaneously start reading the NEXT 4MB block while sending the current block
          if (nextOffset < file.size) {
            nextBlockPromise = file
              .slice(nextOffset, Math.min(nextOffset + READ_BLOCK_SIZE, file.size))
              .arrayBuffer();
          } else {
            nextBlockPromise = null;
          }

          const blockBytes = new Uint8Array(currentBlockBuffer);
          let pos = 0;

          while (pos < blockLen && !cancelledRef.current && dc.readyState === 'open') {
            if (dc.bufferedAmount > HIGH_WATER_MARK) {
              await waitForBufferLow(dc);
              if (cancelledRef.current || dc.readyState !== 'open') return;
            }

            const end = Math.min(pos + chunkSize, blockLen);
            const sliceView = blockBytes.subarray(pos, end);
            await safeSendBinary(dc, sliceView);

            const sentNow = end - pos;
            pos = end;
            totalSent += sentNow;
            chunksSinceYield++;

            // Yield occasionally on ultra-fast loopback so browser stays responsive
            if (chunksSinceYield >= 32) {
              chunksSinceYield = 0;
              await new Promise((r) => setTimeout(r, 0));
            }

            const now = Date.now();
            if (now - lastUiUpdate >= 150) {
              const dt = (now - lastSampleTime) / 1000;
              if (dt >= 0.2) {
                const instBps = (totalSent - lastSampleSent) / dt;
                smoothedBps = smoothedBps === 0 ? instBps : smoothedBps * 0.65 + instBps * 0.35;
                lastSampleSent = totalSent;
                lastSampleTime = now;

                if (smoothedBps > 0) {
                  const mbps = (smoothedBps * 8) / 1_000_000;
                  setSpeed(`${formatBytes(smoothedBps)}/s (${mbps.toFixed(0)} Mbps)`);
                  const remaining = Math.max(0, totalBytes - totalSent);
                  setEta(formatDuration(remaining / smoothedBps));
                }
              }

              setTransferredBytes(totalSent);
              setProgress(totalBytes > 0 ? Math.min(99.9, (totalSent / totalBytes) * 100) : 100);
              lastUiUpdate = now;
            }
          }

          offset = nextOffset;
        }

        if (cancelledRef.current || dc.readyState !== 'open') return;

        dc.send(JSON.stringify({ type: 'file-end', index: fileIdx }));
      }

      // Wait for SCTP socket buffer to fully drain before signaling batch-end
      await waitForChannelDrain(dc);
      if (cancelledRef.current) return;

      if (dc.readyState === 'open') {
        const ackPromise = new Promise<void>((resolve) => {
          ackResolveRef.current = resolve;
          setTimeout(resolve, 2500);
        });
        dc.send(JSON.stringify({ type: 'batch-end', totalFiles: files.length }));
        await ackPromise;
      }

      const elapsedSec = Math.max(0.5, (Date.now() - startTime) / 1000);
      const avgBps = totalBytes / elapsedSec;
      setProgress(100);
      setTransferredBytes(totalBytes);
      setSummaryText(
        `Sent ${files.length} ${files.length === 1 ? 'file' : 'files'} (${formatBytes(totalBytes)}) in ${formatDuration(elapsedSec)} • Avg ${formatBytes(avgBps)}/s`
      );
      setStatus('completed');
    } catch (err) {
      console.error('Error streaming files:', err);
      if (!cancelledRef.current) {
        setErrorBanner('Transfer interrupted. Keep both screens active and on the same Wi-Fi for fastest speeds.');
      }
    }
  };

  const copyRoomLink = () => {
    if (!roomId) return;
    const link = `${window.location.origin}/?room=${roomId}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEditFiles = () => {
    cleanupConnection();
    setRoomId(null);
    setStatus('selecting');
  };

  const handleResetAll = () => {
    cleanupConnection();
    setQueuedFiles([]);
    setRoomId(null);
    setProgress(0);
    setTransferredBytes(0);
    setSpeed('');
    setEta('');
    setSummaryText('');
    setStatus('selecting');
  };

  const joinLink = roomId ? `${window.location.origin}/?room=${roomId}` : '';

  return (
    <div className="w-full">
      {/* Hidden multi-file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />
      <input
        ref={mediaInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel rounded-3xl sm:rounded-[2.5rem] p-5 sm:p-8 md:p-10 relative overflow-hidden"
      >
        <div className="absolute -top-20 -right-20 w-48 h-48 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />

        <motion.button
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          onClick={() => {
            cleanupConnection();
            onBack();
          }}
          className="absolute top-5 left-5 sm:top-6 sm:left-6 p-2 sm:p-2.5 text-neutral-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] rounded-xl sm:rounded-2xl transition-all duration-200 z-20 border border-white/[0.08]"
        >
          <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
        </motion.button>

        <div className="text-center mb-6 sm:mb-8 mt-1 relative z-10">
          <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-indigo-500/20 to-purple-600/20 text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-3 sm:mb-4 border border-indigo-500/30 shadow-[0_0_30px_rgba(99,102,241,0.3)]">
            <UploadCloud className="w-6 h-6 sm:w-7 sm:h-7" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Send Files</h1>
          <p className="text-xs text-neutral-400 mt-1">Turbo Multi-File P2P Stream</p>
        </div>

        {errorBanner && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-xs text-red-300 text-center relative z-10">
            {errorBanner}
          </div>
        )}

        <AnimatePresence mode="wait">
          {status === 'selecting' && queuedFiles.length === 0 && (
            <motion.div
              key="dropzone"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="space-y-4 relative z-10"
            >
              <div
                className={cn(
                  'border-2 border-dashed rounded-2xl sm:rounded-3xl p-6 sm:p-10 text-center transition-all duration-300 cursor-pointer overflow-hidden group',
                  dragActive
                    ? 'border-indigo-400 bg-indigo-500/15 shadow-[0_0_40px_rgba(99,102,241,0.3)]'
                    : 'border-white/[0.1] hover:border-indigo-500/50 bg-white/[0.02] hover:bg-white/[0.04]'
                )}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="w-14 h-14 sm:w-16 sm:h-16 bg-neutral-900/90 rounded-2xl flex items-center justify-center mx-auto mb-3 sm:mb-4 border border-white/[0.08] shadow-inner group-hover:scale-105 group-hover:border-indigo-500/40 transition-all">
                  <FileType
                    className={cn(
                      'w-7 h-7 sm:w-8 sm:h-8 transition-colors',
                      dragActive ? 'text-indigo-300' : 'text-neutral-400 group-hover:text-indigo-400'
                    )}
                  />
                </div>
                <h3 className="text-sm sm:text-base font-semibold text-neutral-100 group-hover:text-white transition-colors">
                  Tap or Drop Multiple Files
                </h3>
                <p className="text-xs text-neutral-400 mt-1 sm:mt-1.5 font-medium">
                  Unlimited photos, videos & files • No size limit
                </p>

                <div className="mt-4 inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[11px] font-medium text-indigo-300">
                  <Sparkles className="w-3 h-3" />
                  <span>Turbo 4MB Pipeline Ready</span>
                </div>
              </div>

              {/* Dedicated Quick Pickers — especially helpful on iPhone/iOS Photo Library */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => mediaInputRef.current?.click()}
                  className="flex items-center justify-center gap-2.5 py-3.5 px-4 rounded-2xl bg-gradient-to-r from-pink-500/15 to-indigo-500/15 hover:from-pink-500/25 hover:to-indigo-500/25 border border-pink-500/30 text-white text-xs sm:text-sm font-semibold transition-all cursor-pointer"
                >
                  <Images className="w-4 h-4 text-pink-300" />
                  <span>Select Photos & Videos</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center justify-center gap-2.5 py-3.5 px-4 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.1] text-neutral-200 text-xs sm:text-sm font-semibold transition-all cursor-pointer"
                >
                  <FolderPlus className="w-4 h-4 text-indigo-400" />
                  <span>Browse All Files</span>
                </button>
              </div>
            </motion.div>
          )}

          {status === 'selecting' && queuedFiles.length > 0 && (
            <motion.div
              key="queue"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="space-y-4 relative z-10"
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <div className="flex items-center justify-between px-1">
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    {queuedFiles.length} {queuedFiles.length === 1 ? 'File' : 'Files'} Ready
                  </h3>
                  <p className="text-xs text-indigo-300 font-mono font-semibold">
                    Total Size: {formatBytes(totalBatchBytes)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setQueuedFiles([])}
                  className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-red-400 bg-white/[0.04] hover:bg-red-500/10 px-3 py-1.5 rounded-xl border border-white/[0.08] transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </button>
              </div>

              <div
                className={cn(
                  'max-h-60 overflow-y-auto space-y-2 pr-1 rounded-2xl p-2 bg-neutral-950/50 border transition-colors',
                  dragActive ? 'border-indigo-400 bg-indigo-500/10' : 'border-white/[0.07]'
                )}
              >
                {queuedFiles.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-white/[0.05] flex items-center justify-center flex-shrink-0">
                        {getFileIcon(item.file.type, item.file.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm font-medium text-neutral-100 truncate">
                          {item.file.name}
                        </p>
                        <p className="text-[11px] text-neutral-400 font-mono">
                          {formatBytes(item.file.size)}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeQueuedFile(item.id)}
                      className="p-1.5 text-neutral-500 hover:text-red-400 rounded-lg hover:bg-white/[0.05] transition-colors flex-shrink-0 cursor-pointer"
                      aria-label="Remove file"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => mediaInputRef.current?.click()}
                  className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.1] text-xs font-semibold text-pink-300 transition-colors cursor-pointer"
                >
                  <Images className="w-3.5 h-3.5" />
                  <span>+ Photos & Videos</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.1] text-xs font-semibold text-indigo-300 transition-colors cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  <span>+ More Files</span>
                </button>
              </div>

              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                onClick={startSession}
                className="w-full flex items-center justify-center gap-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold py-4 rounded-2xl transition-all duration-300 shadow-xl border border-indigo-400/30 cursor-pointer text-sm"
              >
                <Send className="w-4 h-4" />
                <span>
                  Send {queuedFiles.length} {queuedFiles.length === 1 ? 'File' : 'Files'} ({formatBytes(totalBatchBytes)})
                </span>
              </motion.button>
            </motion.div>
          )}

          {status === 'waiting' && roomId && (
            <motion.div
              key="waiting"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="text-center space-y-5 relative z-10"
            >
              <div>
                <div className="inline-block px-3 py-1 bg-amber-500/10 border border-amber-500/25 rounded-full text-amber-300 text-xs font-semibold mb-2">
                  Ready • {queuedFiles.length} {queuedFiles.length === 1 ? 'file' : 'files'} ({formatBytes(totalBatchBytes)})
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
              <div className="py-1 flex flex-col items-center">
                <p className="text-[11px] text-neutral-400 mb-2.5 uppercase tracking-wider font-bold">Or Scan Directly</p>
                <div className="p-3.5 bg-white rounded-2xl shadow-xl inline-block border-4 border-neutral-800">
                  <QRCodeSVG value={joinLink} size={130} level="M" />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                <button
                  onClick={copyRoomLink}
                  className="flex items-center space-x-2 text-xs font-semibold px-4 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-neutral-300 transition-colors cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Link Copied!' : 'Copy Direct Link'}</span>
                </button>
                <button
                  onClick={handleEditFiles}
                  className="flex items-center space-x-1.5 text-xs font-semibold px-4 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.08] text-neutral-300 transition-colors cursor-pointer"
                >
                  <span>Edit Queue</span>
                </button>
              </div>

              <div className="flex items-center justify-center space-x-2 text-xs text-neutral-400 font-medium pt-1">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                <span>Keep screen open • Listening for peer...</span>
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

          {status === 'transferring' && (
            <motion.div
              key="transferring"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="space-y-5 relative z-10"
            >
              <div className="glass-card rounded-2xl p-4 flex items-center space-x-3.5 border border-white/[0.08] shadow-lg">
                <div className="w-11 h-11 bg-indigo-500/20 border border-indigo-500/30 rounded-xl flex items-center justify-center flex-shrink-0 text-indigo-400">
                  <FileType className="w-5 h-5" />
                </div>
                <div className="overflow-hidden flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">
                      File {currentFileIndex + 1} of {queuedFiles.length}
                    </p>
                    {connectionMode && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        <Wifi className="w-2.5 h-2.5" />
                        {connectionMode === 'local'
                          ? 'Wi-Fi Direct'
                          : connectionMode === 'relay'
                          ? 'Relay'
                          : 'P2P Direct'}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-bold text-white truncate mt-0.5">{currentFileName}</p>
                  <p className="text-xs text-neutral-400 font-mono">
                    {formatBytes(transferredBytes)} / {formatBytes(totalBatchBytes)}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs font-semibold text-neutral-300">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
                    <span>Turbo Streaming</span>
                  </span>
                  <span className="text-indigo-300 font-mono text-sm">{progress.toFixed(1)}%</span>
                </div>

                <div className="w-full bg-neutral-950 rounded-full h-3 overflow-hidden p-0.5 border border-white/[0.08] shadow-inner">
                  <div
                    className="bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-400 h-full rounded-full shadow-[0_0_15px_rgba(99,102,241,0.6)] transition-[width] duration-150 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>

                <div className="flex flex-wrap justify-between items-center gap-2 text-xs text-neutral-400 pt-1 font-mono">
                  <div>
                    <span>Speed: </span>
                    <span className="text-indigo-400 font-bold bg-indigo-500/10 px-2 py-0.5 rounded-md border border-indigo-500/20">
                      {speed || 'Starting...'}
                    </span>
                  </div>
                  <div>
                    <span>ETA: </span>
                    <span className="text-cyan-300 font-semibold">{eta || '--'}</span>
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-neutral-500 text-center">
                Tip: Connect both devices to the same Wi-Fi or Hotspot for 20–60+ MB/s speed.
              </p>
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
                  transition={{ type: 'spring', stiffness: 240, damping: 16 }}
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
                <p className="text-xs text-emerald-300 font-mono mt-2">{summaryText}</p>
              </motion.div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleResetAll}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold py-3.5 rounded-2xl transition-all duration-300 shadow-xl border border-indigo-400/30 cursor-pointer"
              >
                Send More Files
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
