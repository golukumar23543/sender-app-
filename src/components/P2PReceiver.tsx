import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Download,
  FileType,
  CheckCircle2,
  Loader2,
  FileWarning,
  ArrowLeft,
  KeyRound,
  FolderOpen,
  Wifi,
  FileDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatBytes, formatDuration } from '../lib/utils';
import { db } from '../lib/firebase';
import { doc, getDoc, onSnapshot, collection, addDoc, updateDoc } from 'firebase/firestore';

const WRITE_BATCH_BYTES = 4 * 1024 * 1024; // 4 MB disk write batching
const MEMORY_COALESCE_BYTES = 16 * 1024 * 1024; // 16 MB Blob coalescing to reduce GC pressure

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ],
  iceCandidatePoolSize: 4
};

interface FileMetadata {
  index: number;
  totalFiles: number;
  totalBytes: number;
  name: string;
  size: number;
  mimeType: string;
}

interface ReceivedFileItem {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  url?: string;
  savedToDisk: boolean;
}

interface P2PReceiverProps {
  initialRoom: string | null;
  onBack: () => void;
}

function getUniqueFileName(desiredName: string, usedNames: Set<string>): string {
  if (!usedNames.has(desiredName)) {
    usedNames.add(desiredName);
    return desiredName;
  }
  const dotIdx = desiredName.lastIndexOf('.');
  const base = dotIdx > 0 ? desiredName.slice(0, dotIdx) : desiredName;
  const ext = dotIdx > 0 ? desiredName.slice(dotIdx) : '';
  let counter = 1;
  while (usedNames.has(`${base} (${counter})${ext}`)) {
    counter++;
  }
  const unique = `${base} (${counter})${ext}`;
  usedNames.add(unique);
  return unique;
}

export function P2PReceiver({ initialRoom, onBack }: P2PReceiverProps) {
  const [status, setStatus] = useState<
    'entering-pin' | 'joining' | 'connecting' | 'waiting-info' | 'transferring' | 'completed' | 'full' | 'error'
  >('entering-pin');
  const [errorMessage, setErrorMessage] = useState('');
  const [pin, setPin] = useState('');
  const [metadata, setMetadata] = useState<FileMetadata | null>(null);
  const [batchTotalFiles, setBatchTotalFiles] = useState(1);
  const [batchTotalBytes, setBatchTotalBytes] = useState(0);
  const [receivedTotalBytes, setReceivedTotalBytes] = useState(0);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState('');
  const [eta, setEta] = useState('');
  const [connectionMode, setConnectionMode] = useState<'local' | 'p2p' | 'relay' | null>(null);
  const [summaryText, setSummaryText] = useState('');
  const [selectedFolderName, setSelectedFolderName] = useState<string | null>(null);
  const [receivedFiles, setReceivedFiles] = useState<ReceivedFileItem[]>([]);

  const supportsDirectoryPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const unsubRoomRef = useRef<(() => void) | undefined>(undefined);
  const unsubCallerRef = useRef<(() => void) | undefined>(undefined);
  const dirHandleRef = useRef<any>(null);
  const wakeLockRef = useRef<any>(null);
  const objectUrlsRef = useRef<string[]>([]);

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
      // Ignore if unsupported
    }
  }, []);

  const cleanupAll = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    if (unsubRoomRef.current) {
      unsubRoomRef.current();
      unsubRoomRef.current = undefined;
    }
    if (unsubCallerRef.current) {
      unsubCallerRef.current();
      unsubCallerRef.current = undefined;
    }
    releaseWakeLock();
  }, [releaseWakeLock]);

  const revokeAllUrls = useCallback(() => {
    for (const u of objectUrlsRef.current) {
      try {
        URL.revokeObjectURL(u);
      } catch {
        // Ignore
      }
    }
    objectUrlsRef.current = [];
  }, []);

  useEffect(() => {
    if (initialRoom) {
      handleConnect(initialRoom);
    }
    return () => {
      cleanupAll();
      revokeAllUrls();
    };
  }, [initialRoom]);

  useEffect(() => {
    if (status === 'connecting' || status === 'waiting-info' || status === 'transferring') {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }
  }, [status, requestWakeLock, releaseWakeLock]);

  const handlePickSaveFolder = async () => {
    if (!supportsDirectoryPicker) return;
    try {
      // @ts-ignore
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      dirHandleRef.current = handle;
      setSelectedFolderName(handle.name || 'Selected Folder');
    } catch {
      // User cancelled picker
    }
  };

  const triggerDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
    }, 100);
  };

  const handleDownloadAll = () => {
    const downloadable = receivedFiles.filter((f) => f.url);
    downloadable.forEach((item, idx) => {
      setTimeout(() => {
        if (item.url) triggerDownload(item.url, item.name);
      }, idx * 250);
    });
  };

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
      await initializePeerConnection(roomToJoin);
    } catch (e: any) {
      console.error(e);
      setErrorMessage(e.message || 'Failed to connect to the room.');
      setStatus('error');
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
      // Ignore
    }
  };

  const initializePeerConnection = async (room: string) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    const roomRef = doc(db, 'rooms', room);
    const callerCandidatesCollection = collection(roomRef, 'callerCandidates');
    const calleeCandidatesCollection = collection(roomRef, 'calleeCandidates');
    const pendingRemoteCandidates: RTCIceCandidateInit[] = [];

    pc.onicecandidate = async (e) => {
      if (e.candidate) {
        try {
          await addDoc(calleeCandidatesCollection, e.candidate.toJSON());
        } catch {
          // Ignore
        }
      }
    };

    pc.ondatachannel = (e) => {
      const dc = e.channel;
      dc.binaryType = 'arraybuffer';
      setStatus('waiting-info');
      setTimeout(() => detectConnectionType(pc), 800);

      let transferStartTime = Date.now();
      let lastUiUpdate = Date.now();
      let lastSampleTime = Date.now();
      let lastSampleBytes = 0;
      let smoothedBps = 0;

      let totalBatchBytesLocal = 0;
      let totalBatchFilesLocal = 1;
      let totalReceivedLocal = 0;
      let currentMeta: FileMetadata | null = null;

      // Disk-stream pipeline state (serialized via writeChain for zero race conditions)
      let writeChain: Promise<void> = Promise.resolve();
      let activeWritable: any = null;
      let diskStaging: ArrayBuffer[] = [];
      let diskStagingBytes = 0;
      const usedDiskNames = new Set<string>();

      // Memory-coalescing state (for iOS/Android/browsers without directory picker)
      let memCoalescedBlobs: Blob[] = [];
      let memPendingBuffers: ArrayBuffer[] = [];
      let memPendingBytes = 0;
      let autoDownloadDelayIndex = 0;

      const flushDiskStaging = () => {
        if (diskStaging.length === 0) return;
        const batch = new Blob(diskStaging);
        diskStaging = [];
        diskStagingBytes = 0;
        writeChain = writeChain.then(async () => {
          if (activeWritable) {
            await activeWritable.write(batch);
          }
        });
      };

      const finalizeMemoryFile = (meta: FileMetadata) => {
        if (memPendingBuffers.length > 0) {
          memCoalescedBlobs.push(new Blob(memPendingBuffers));
          memPendingBuffers = [];
          memPendingBytes = 0;
        }
        const finalBlob = new Blob(memCoalescedBlobs, {
          type: meta.mimeType || 'application/octet-stream'
        });
        memCoalescedBlobs = [];

        const url = URL.createObjectURL(finalBlob);
        objectUrlsRef.current.push(url);

        const item: ReceivedFileItem = {
          id: `${Date.now()}-${meta.index}-${Math.random().toString(36).slice(2, 7)}`,
          name: meta.name,
          size: meta.size,
          mimeType: meta.mimeType,
          url,
          savedToDisk: false
        };

        setReceivedFiles((prev) => [...prev, item]);

        // Stagger auto-downloads slightly so multi-file batches don't get throttled
        const delayMs = autoDownloadDelayIndex * 250;
        autoDownloadDelayIndex++;
        setTimeout(() => {
          triggerDownload(url, meta.name);
        }, delayMs);
      };

      dc.onmessage = (event) => {
        if (typeof event.data === 'string') {
          let msg: any;
          try {
            msg = JSON.parse(event.data);
          } catch {
            return;
          }

          if (msg.type === 'batch-start') {
            transferStartTime = Date.now();
            lastUiUpdate = transferStartTime;
            lastSampleTime = transferStartTime;
            lastSampleBytes = 0;
            totalReceivedLocal = 0;
            totalBatchFilesLocal = msg.totalFiles || 1;
            totalBatchBytesLocal = msg.totalBytes || 0;
            setBatchTotalFiles(totalBatchFilesLocal);
            setBatchTotalBytes(totalBatchBytesLocal);
            setReceivedFiles([]);
            setProgress(0);
            setReceivedTotalBytes(0);
            setStatus('transferring');
          } else if (msg.type === 'metadata') {
            const newMeta: FileMetadata = {
              index: msg.index ?? 0,
              totalFiles: msg.totalFiles ?? totalBatchFilesLocal,
              totalBytes: msg.totalBytes ?? msg.size ?? 0,
              name: msg.name || 'download',
              size: msg.size || 0,
              mimeType: msg.mimeType || 'application/octet-stream'
            };

            if (!totalBatchBytesLocal && newMeta.totalBytes) {
              totalBatchBytesLocal = newMeta.totalBytes;
              setBatchTotalBytes(totalBatchBytesLocal);
            }
            if (newMeta.totalFiles) {
              totalBatchFilesLocal = newMeta.totalFiles;
              setBatchTotalFiles(newMeta.totalFiles);
            }

            currentMeta = newMeta;
            setMetadata(newMeta);
            setStatus('transferring');

            if (dirHandleRef.current) {
              const targetName = getUniqueFileName(newMeta.name, usedDiskNames);
              writeChain = writeChain.then(async () => {
                const fileHandle = await dirHandleRef.current.getFileHandle(targetName, { create: true });
                activeWritable = await fileHandle.createWritable();
              });
            } else {
              memCoalescedBlobs = [];
              memPendingBuffers = [];
              memPendingBytes = 0;
            }
          } else if (msg.type === 'file-end' || msg.type === 'eof') {
            const finishedMeta = currentMeta;
            if (dirHandleRef.current) {
              flushDiskStaging();
              writeChain = writeChain.then(async () => {
                if (activeWritable) {
                  await activeWritable.close();
                  activeWritable = null;
                }
                if (finishedMeta) {
                  setReceivedFiles((prev) => [
                    ...prev,
                    {
                      id: `${Date.now()}-${finishedMeta.index}`,
                      name: finishedMeta.name,
                      size: finishedMeta.size,
                      mimeType: finishedMeta.mimeType,
                      savedToDisk: true
                    }
                  ]);
                }
              });
            } else if (finishedMeta) {
              finalizeMemoryFile(finishedMeta);
            }

            if (msg.type === 'eof') {
              // Single-file fallback completion
              writeChain.then(() => {
                const elapsedSec = Math.max(0.5, (Date.now() - transferStartTime) / 1000);
                const avgBps = totalReceivedLocal / elapsedSec;
                setProgress(100);
                setReceivedTotalBytes(totalReceivedLocal);
                setSummaryText(
                  `Received 1 file (${formatBytes(totalReceivedLocal)}) in ${formatDuration(elapsedSec)} • Avg ${formatBytes(avgBps)}/s`
                );
                setStatus('completed');
              });
            }
          } else if (msg.type === 'batch-end') {
            flushDiskStaging();
            writeChain.then(() => {
              if (dc.readyState === 'open') {
                try {
                  dc.send(JSON.stringify({ type: 'batch-ack' }));
                } catch {
                  // Ignore
                }
              }
              const elapsedSec = Math.max(0.5, (Date.now() - transferStartTime) / 1000);
              const finalBytes = totalBatchBytesLocal || totalReceivedLocal;
              const avgBps = finalBytes / elapsedSec;
              setProgress(100);
              setReceivedTotalBytes(finalBytes);
              setSummaryText(
                `Received ${totalBatchFilesLocal} ${totalBatchFilesLocal === 1 ? 'file' : 'files'} (${formatBytes(finalBytes)}) in ${formatDuration(elapsedSec)} • Avg ${formatBytes(avgBps)}/s`
              );
              setStatus('completed');
            });
          }
          return;
        }

        // Binary chunk path — kept 100% synchronous & lightweight
        const buffer = event.data as ArrayBuffer;
        const chunkLen = buffer.byteLength;
        totalReceivedLocal += chunkLen;

        if (dirHandleRef.current) {
          diskStaging.push(buffer);
          diskStagingBytes += chunkLen;
          if (diskStagingBytes >= WRITE_BATCH_BYTES) {
            flushDiskStaging();
          }
        } else {
          memPendingBuffers.push(buffer);
          memPendingBytes += chunkLen;
          if (memPendingBytes >= MEMORY_COALESCE_BYTES) {
            memCoalescedBlobs.push(new Blob(memPendingBuffers));
            memPendingBuffers = [];
            memPendingBytes = 0;
          }
        }

        const now = Date.now();
        if (now - lastUiUpdate >= 150) {
          const dt = (now - lastSampleTime) / 1000;
          if (dt >= 0.2) {
            const instBps = (totalReceivedLocal - lastSampleBytes) / dt;
            smoothedBps = smoothedBps === 0 ? instBps : smoothedBps * 0.65 + instBps * 0.35;
            lastSampleBytes = totalReceivedLocal;
            lastSampleTime = now;

            if (smoothedBps > 0) {
              const mbps = (smoothedBps * 8) / 1_000_000;
              setSpeed(`${formatBytes(smoothedBps)}/s (${mbps.toFixed(0)} Mbps)`);
              const denom = totalBatchBytesLocal || currentMeta?.size || 0;
              if (denom > 0) {
                const remaining = Math.max(0, denom - totalReceivedLocal);
                setEta(formatDuration(remaining / smoothedBps));
              }
            }
          }

          setReceivedTotalBytes(totalReceivedLocal);
          const denom = totalBatchBytesLocal || currentMeta?.size || 0;
          if (denom > 0) {
            setProgress(Math.min(99.9, (totalReceivedLocal / denom) * 100));
          }
          lastUiUpdate = now;
        }
      };
    };

    unsubRoomRef.current = onSnapshot(roomRef, async (snapshot) => {
      const data = snapshot.data();
      if (!data) return;

      if (data.offer && !pc.currentRemoteDescription) {
        try {
          const offer = new RTCSessionDescription(data.offer);
          await pc.setRemoteDescription(offer);

          while (pendingRemoteCandidates.length > 0) {
            const cand = pendingRemoteCandidates.shift();
            if (cand) {
              await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
            }
          }

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          await updateDoc(roomRef, {
            answer: {
              type: answer.type,
              sdp: answer.sdp
            }
          });
        } catch (e) {
          console.error('Failed to process offer:', e);
        }
      }
    });

    unsubCallerRef.current = onSnapshot(callerCandidatesCollection, (snapshot) => {
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

  if (status === 'full' || status === 'error') {
    return (
      <div className="w-full max-w-md mx-auto glass-panel rounded-3xl sm:rounded-[2.5rem] p-6 sm:p-8 text-center relative overflow-hidden">
        <div className="relative z-10">
          <div className="w-14 h-14 sm:w-16 sm:h-16 bg-red-500/20 rounded-2xl flex items-center justify-center mx-auto text-red-400 mb-5 sm:mb-6 border border-red-500/30 shadow-[0_0_30px_rgba(239,68,68,0.2)]">
            <FileWarning className="w-7 h-7 sm:w-8 sm:h-8" />
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-white mb-2">Connection Failed</h2>
          <p className="text-neutral-400 text-xs mb-6 sm:mb-8">
            {errorMessage || 'This transfer session is already active, closed, or does not exist.'}
          </p>
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
          onClick={() => {
            cleanupAll();
            revokeAllUrls();
            onBack();
          }}
          className="absolute top-5 left-5 sm:top-6 sm:left-6 p-2 sm:p-2.5 text-neutral-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] rounded-xl sm:rounded-2xl transition-all duration-200 z-20 border border-white/[0.08]"
        >
          <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
        </motion.button>

        <div className="text-center mb-6 sm:mb-8 mt-1 relative z-10">
          <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-emerald-500/20 to-teal-600/20 text-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-3 sm:mb-4 border border-emerald-500/30 shadow-[0_0_30px_rgba(16,185,129,0.3)]">
            <Download className="w-6 h-6 sm:w-7 sm:h-7" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Receive Files</h1>
          <p className="text-xs text-neutral-400 mt-1">Turbo Multi-File P2P Stream</p>
        </div>

        <AnimatePresence mode="wait">
          {status === 'entering-pin' && (
            <motion.div
              key="entering-pin"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="text-center space-y-5 relative z-10"
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

              {supportsDirectoryPicker && (
                <button
                  type="button"
                  onClick={handlePickSaveFolder}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.1] text-xs font-medium text-neutral-300 transition-colors cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4 text-emerald-400" />
                  <span>
                    {selectedFolderName
                      ? `Saving straight to: ${selectedFolderName}`
                      : 'Choose Save Folder (Best for 2GB+ files)'}
                  </span>
                </button>
              )}

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
              className="flex flex-col items-center py-8 relative z-10 space-y-4"
            >
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 flex items-center justify-center text-emerald-400 border border-emerald-500/30 animate-pulse">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-white">
                  {status === 'joining'
                    ? 'Joining transfer session...'
                    : status === 'connecting'
                    ? 'Establishing P2P tunnel...'
                    : 'Connected! Waiting for stream...'}
                </p>
                <p className="text-xs text-neutral-400 mt-1">Direct device connection via WebRTC</p>
              </div>
              {status === 'waiting-info' && supportsDirectoryPicker && !selectedFolderName && (
                <button
                  type="button"
                  onClick={handlePickSaveFolder}
                  className="flex items-center gap-2 py-2 px-4 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-xs font-semibold text-emerald-300 transition-colors cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Stream Directly to Folder (Zero-RAM)</span>
                </button>
              )}
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
                <div className="w-11 h-11 bg-emerald-500/20 border border-emerald-500/30 rounded-xl flex items-center justify-center flex-shrink-0 text-emerald-400">
                  <FileType className="w-5 h-5" />
                </div>
                <div className="overflow-hidden flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-emerald-300 uppercase tracking-wider">
                      File {(metadata?.index ?? 0) + 1} of {batchTotalFiles}
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
                  <p className="text-sm font-bold text-white truncate mt-0.5">
                    {metadata?.name || 'Receiving stream...'}
                  </p>
                  <p className="text-xs text-neutral-400 font-mono">
                    {formatBytes(receivedTotalBytes)}
                    {batchTotalBytes > 0 ? ` / ${formatBytes(batchTotalBytes)}` : ''}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs font-semibold text-neutral-300">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    <span>Receiving Stream</span>
                  </span>
                  <span className="text-emerald-300 font-mono text-sm">{progress.toFixed(1)}%</span>
                </div>

                <div className="w-full bg-neutral-950 rounded-full h-3 overflow-hidden p-0.5 border border-white/[0.08] shadow-inner">
                  <div
                    className="bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-400 h-full rounded-full shadow-[0_0_15px_rgba(16,185,129,0.6)] transition-[width] duration-150 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>

                <div className="flex flex-wrap justify-between items-center gap-2 text-xs text-neutral-400 pt-1 font-mono">
                  <div>
                    <span>Speed: </span>
                    <span className="text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                      {speed || 'Streaming...'}
                    </span>
                  </div>
                  <div>
                    <span>ETA: </span>
                    <span className="text-cyan-300 font-semibold">{eta || '--'}</span>
                  </div>
                </div>
              </div>

              {receivedFiles.length > 0 && (
                <div className="text-xs text-emerald-300/90 text-center bg-emerald-500/10 border border-emerald-500/20 rounded-xl py-2 px-3">
                  {receivedFiles.length} of {batchTotalFiles} files received so far
                </div>
              )}
            </motion.div>
          )}

          {status === 'completed' && (
            <motion.div
              key="completed"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center space-y-5 relative z-10 py-2"
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
                <h3 className="text-xl font-bold text-white">Download Complete!</h3>
                <p className="text-xs text-emerald-300 font-mono mt-1.5">{summaryText}</p>
              </motion.div>

              {receivedFiles.length > 0 && (
                <div className="text-left space-y-2">
                  {receivedFiles.some((f) => f.url) && receivedFiles.length > 1 && (
                    <button
                      type="button"
                      onClick={handleDownloadAll}
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-xs font-semibold text-emerald-300 transition-colors cursor-pointer"
                    >
                      <FileDown className="w-4 h-4" />
                      <span>Save All ({receivedFiles.length} Files)</span>
                    </button>
                  )}

                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 rounded-2xl p-2 bg-neutral-950/50 border border-white/[0.07]">
                    {receivedFiles.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-2 p-2 rounded-xl bg-white/[0.03] border border-white/[0.06]"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-neutral-100 truncate">{item.name}</p>
                          <p className="text-[10px] text-neutral-400 font-mono">{formatBytes(item.size)}</p>
                        </div>
                        {item.savedToDisk ? (
                          <span className="text-[11px] font-semibold text-emerald-400 px-2 py-1 rounded-lg bg-emerald-500/10 flex-shrink-0">
                            Saved
                          </span>
                        ) : item.url ? (
                          <button
                            type="button"
                            onClick={() => triggerDownload(item.url!, item.name)}
                            className="text-[11px] font-semibold text-emerald-300 hover:text-white bg-emerald-500/15 hover:bg-emerald-500/30 px-2.5 py-1 rounded-lg border border-emerald-500/25 flex-shrink-0 cursor-pointer transition-colors"
                          >
                            Save
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  cleanupAll();
                  revokeAllUrls();
                  onBack();
                }}
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
