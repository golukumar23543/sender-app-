/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { P2PSender } from './components/P2PSender';
import { P2PReceiver } from './components/P2PReceiver';
import { AdminPanel } from './components/AdminPanel';
import { Send, Download, Zap, MonitorSmartphone, ShieldCheck, Wifi, Sparkles, Radio, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { recordInstall } from './lib/tracking';

export default function App() {
  const [mode, setMode] = useState<'home' | 'send' | 'receive' | 'admin'>('home');
  const [initialRoom, setInitialRoom] = useState<string | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [logoClicks, setLogoClicks] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setInitialRoom(roomParam);
      setMode('receive');
    }

    const checkIOS = () => {
      const userAgent = window.navigator.userAgent.toLowerCase();
      return /iphone|ipad|ipod/.test(userAgent);
    };
    
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    
    if (checkIOS() && !isStandalone) {
      setIsIOS(true);
    }

    if (isStandalone) {
      recordInstall();
    }

    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', recordInstall);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', recordInstall);
    };
  }, []);

  useEffect(() => {
    if (logoClicks > 0) {
      const timer = setTimeout(() => setLogoClicks(0), 3000);
      return () => clearTimeout(timer);
    }
  }, [logoClicks]);

  const handleLogoClick = () => {
    setLogoClicks(prev => {
      const newCount = prev + 1;
      if (newCount === 5) {
        setMode('admin');
        return 0;
      }
      return newCount;
    });
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstallable(false);
      setDeferredPrompt(null);
      recordInstall();
    }
  };

  return (
    <div className="min-h-screen bg-[#07080c] flex flex-col items-center justify-between p-3 sm:p-6 lg:p-8 relative overflow-x-hidden font-sans text-neutral-100 selection:bg-indigo-500/30 selection:text-indigo-200">
      {/* Ambient background light grid & luminous orbs */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(99,102,241,0.18),rgba(255,255,255,0))] pointer-events-none" />
      <div className="absolute top-1/4 -left-40 w-[35rem] h-[35rem] bg-gradient-to-tr from-indigo-600/15 to-violet-500/10 rounded-full mix-blend-screen filter blur-[120px] animate-blob pointer-events-none" />
      <div className="absolute bottom-1/4 -right-40 w-[35rem] h-[35rem] bg-gradient-to-bl from-cyan-500/10 via-fuchsia-600/10 to-indigo-600/15 rounded-full mix-blend-screen filter blur-[120px] animate-blob animation-delay-2000 pointer-events-none" />
      
      {/* Top subtle brand status bar */}
      <header className="z-20 w-full max-w-xl lg:max-w-2xl flex items-center justify-between py-2 sm:py-3 px-1 text-xs text-neutral-400">
        <div className="flex items-center space-x-2 bg-white/[0.03] backdrop-blur-md px-3 sm:px-4 py-1.5 rounded-full border border-white/[0.06] shadow-sm">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="font-mono font-medium tracking-wide text-neutral-300">P2P Network Active</span>
        </div>
        <div className="flex items-center space-x-1.5 bg-white/[0.03] backdrop-blur-md px-3 sm:px-4 py-1.5 rounded-full border border-white/[0.06] text-neutral-300 font-medium">
          <Lock className="w-3.5 h-3.5 text-indigo-400" />
          <span>E2E Encrypted</span>
        </div>
      </header>

      {/* Main Container - fully responsive across Mobile (w-full), Tablet (max-w-xl), and Laptop/Desktop (max-w-2xl) */}
      <main className="z-10 w-full max-w-xl lg:max-w-2xl my-auto py-4 sm:py-8">
        <AnimatePresence mode="wait">
          {mode === 'home' && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.98 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="glass-panel rounded-3xl sm:rounded-[2.5rem] p-5 sm:p-8 md:p-10 lg:p-12 relative overflow-hidden"
            >
              {/* Internal subtle lighting gradients */}
              <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-36 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute inset-0 bg-gradient-to-b from-white/[0.04] via-transparent to-transparent pointer-events-none rounded-3xl sm:rounded-[2.5rem]" />
              
              {/* Logo & Headline */}
              <div className="text-center mb-8 sm:mb-10 relative z-10">
                <motion.div 
                  initial={{ scale: 0.8, rotate: -8 }}
                  animate={{ scale: 1, rotate: 0 }}
                  whileHover={{ scale: 1.06, rotate: 3 }}
                  whileTap={{ scale: 0.92 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                  onClick={handleLogoClick}
                  className="relative group w-18 h-18 sm:w-22 sm:h-22 mx-auto mb-5 sm:mb-6 cursor-pointer"
                >
                  <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 via-purple-500 to-cyan-400 rounded-3xl blur-lg opacity-60 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="relative w-full h-full bg-gradient-to-b from-neutral-900 via-neutral-950 to-black rounded-3xl p-[1px] shadow-2xl flex items-center justify-center border border-white/15">
                    <div className="w-full h-full rounded-[22px] bg-gradient-to-br from-indigo-600/30 via-neutral-900/90 to-purple-900/30 flex items-center justify-center overflow-hidden">
                      <motion.div
                        animate={{ y: [0, -4, 0] }}
                        transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
                        className="text-white drop-shadow-[0_0_12px_rgba(99,102,241,0.8)]"
                      >
                        <Zap className="w-8 h-8 sm:w-10 sm:h-10 fill-indigo-400/20 text-indigo-300 stroke-[2.2]" />
                      </motion.div>
                    </div>
                  </div>
                  {/* Subtle 5-tap indicator if clicked */}
                  {logoClicks > 0 && (
                    <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-indigo-500 text-[10px] text-white font-mono px-2 py-0.5 rounded-full shadow-md font-bold">
                      {logoClicks}/5
                    </span>
                  )}
                </motion.div>

                <div className="inline-flex items-center space-x-1.5 px-3.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/25 text-indigo-300 text-xs font-semibold mb-3">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Next-Gen Direct Beam</span>
                </div>

                <motion.h1 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="text-3xl sm:text-5xl md:text-5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-white via-neutral-100 to-neutral-400 mb-2 sm:mb-3"
                >
                  Sender App
                </motion.h1>
                <motion.p 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-neutral-400 font-normal text-xs sm:text-base max-w-md mx-auto leading-relaxed px-2"
                >
                  Direct high-speed device-to-device file transfer.<br className="hidden sm:inline" />
                  <span className="text-neutral-300 font-medium"> Zero cloud storage. No file size limits.</span>
                </motion.p>
              </div>

              {/* Action Buttons: Send & Receive with adaptive tablet & laptop grids */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-5 relative z-10">
                <motion.button
                  whileHover={{ scale: 1.02, translateY: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setMode('send')}
                  className="relative z-20 cursor-pointer group flex flex-col items-start justify-between p-5 sm:p-7 bg-gradient-to-b from-neutral-900/90 to-neutral-950/90 hover:from-neutral-850 hover:to-neutral-900 border border-white/[0.08] hover:border-indigo-500/50 rounded-2xl sm:rounded-3xl transition-all duration-300 shadow-xl overflow-hidden min-h-[140px] sm:min-h-[170px]"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                  
                  <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-indigo-500/20 to-purple-600/20 rounded-2xl flex items-center justify-center text-indigo-400 group-hover:text-indigo-300 mb-4 sm:mb-6 border border-indigo-500/30 group-hover:border-indigo-400/60 shadow-[0_0_25px_-5px_rgba(99,102,241,0.4)] transition-all">
                    <Send className="w-5 h-5 sm:w-6 sm:h-6 ml-0.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                  </div>
                  <div>
                    <span className="block text-base sm:text-lg font-bold text-white tracking-tight group-hover:text-indigo-200 transition-colors">Send Files</span>
                    <span className="text-xs text-neutral-400 font-medium">Generate PIN or QR Code</span>
                  </div>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.02, translateY: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setMode('receive')}
                  className="relative z-20 cursor-pointer group flex flex-col items-start justify-between p-5 sm:p-7 bg-gradient-to-b from-neutral-900/90 to-neutral-950/90 hover:from-neutral-850 hover:to-neutral-900 border border-white/[0.08] hover:border-emerald-500/50 rounded-2xl sm:rounded-3xl transition-all duration-300 shadow-xl overflow-hidden min-h-[140px] sm:min-h-[170px]"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                  
                  <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-emerald-500/20 to-teal-600/20 rounded-2xl flex items-center justify-center text-emerald-400 group-hover:text-emerald-300 mb-4 sm:mb-6 border border-emerald-500/30 group-hover:border-emerald-400/60 shadow-[0_0_25px_-5px_rgba(16,185,129,0.4)] transition-all">
                    <Download className="w-5 h-5 sm:w-6 sm:h-6 group-hover:translate-y-0.5 transition-transform" />
                  </div>
                  <div>
                    <span className="block text-base sm:text-lg font-bold text-white tracking-tight group-hover:text-emerald-200 transition-colors">Receive</span>
                    <span className="text-xs text-neutral-400 font-medium">Connect via 6-Digit PIN</span>
                  </div>
                </motion.button>
              </div>
              
              {/* Install PWA Section */}
              <AnimatePresence>
                {(isInstallable || isIOS) && (
                  <motion.div
                    initial={{ opacity: 0, y: 12, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                    exit={{ opacity: 0, y: 12, height: 0 }}
                    className="mt-6"
                  >
                    {isIOS ? (
                      <div className="w-full relative z-20 flex items-center space-x-3.5 p-4 bg-gradient-to-r from-blue-500/10 via-indigo-500/5 to-purple-500/10 border border-blue-500/25 rounded-2xl">
                        <div className="p-2.5 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30 flex-shrink-0">
                          <MonitorSmartphone className="w-5 h-5" />
                        </div>
                        <div className="text-xs text-neutral-300 leading-relaxed">
                          <span className="font-semibold text-white block">Install on iOS / iPhone:</span>
                          Tap <strong className="text-blue-300 font-bold">Share ⎋</strong> in Safari menu, then tap <strong className="text-blue-300 font-bold">Add to Home Screen ⊞</strong>.
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={handleInstallClick}
                        className="w-full relative z-20 cursor-pointer flex items-center justify-center space-x-3 p-4 bg-gradient-to-r from-indigo-500/15 via-purple-500/15 to-indigo-500/15 hover:from-indigo-500/25 hover:via-purple-500/25 hover:to-indigo-500/25 border border-indigo-500/30 hover:border-indigo-400/60 rounded-2xl transition-all duration-300 shadow-lg group"
                      >
                        <MonitorSmartphone className="w-5 h-5 text-indigo-400 group-hover:scale-110 transition-transform" />
                        <span className="font-semibold text-indigo-200 text-sm tracking-wide">Install Sender App to Home Screen</span>
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Offline Hotspot Feature Highlight */}
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.35 }}
                className="mt-8 text-center"
              >
                <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-950/40 via-purple-950/20 to-neutral-900/50 border border-indigo-500/20 text-left flex items-start space-x-3">
                  <div className="p-2 bg-indigo-500/20 rounded-xl text-indigo-400 border border-indigo-500/30 flex-shrink-0 mt-0.5">
                    <Wifi className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-xs text-indigo-300 font-bold tracking-wide uppercase flex items-center gap-1.5">
                      <span>⚡ Superfast Offline Wi-Fi Direct</span>
                    </h2>
                    <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                      Connect both devices to the same Wi-Fi or Hotspot. Files stream directly between devices with zero internet bandwidth consumption!
                    </p>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}

          {mode === 'send' && (
            <motion.div key="send" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
              <P2PSender onBack={() => setMode('home')} />
            </motion.div>
          )}

          {mode === 'receive' && (
            <motion.div key="receive" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
              <P2PReceiver initialRoom={initialRoom} onBack={() => { setMode('home'); setInitialRoom(null); }} />
            </motion.div>
          )}

          {mode === 'admin' && (
            <motion.div key="admin" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="w-full flex justify-center">
              <AdminPanel onBack={() => setMode('home')} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer Branding */}
      <footer className="z-20 text-center py-4">
        <div className="inline-flex items-center space-x-2 px-4 py-1.5 rounded-full bg-white/[0.02] border border-white/[0.05] text-xs font-medium text-neutral-400 tracking-wider">
          <span>Engineered by</span>
          <span className="font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400">Mr.Golu</span>
          <span className="text-neutral-600">•</span>
          <span className="text-neutral-500">v2.4 Pro</span>
        </div>
      </footer>
    </div>
  );
}


