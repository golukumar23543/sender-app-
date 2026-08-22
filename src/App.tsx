/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { P2PSender } from './components/P2PSender';
import { P2PReceiver } from './components/P2PReceiver';
import { Send, Download, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [mode, setMode] = useState<'home' | 'send' | 'receive'>('home');
  const [initialRoom, setInitialRoom] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setInitialRoom(roomParam);
      setMode('receive');
    }
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans text-neutral-200">
      {/* Background decoration */}
      <div className="absolute top-0 inset-x-0 h-96 bg-gradient-to-b from-indigo-500/10 via-purple-500/5 to-transparent pointer-events-none" />
      <div className="absolute top-1/4 -left-32 w-[30rem] h-[30rem] bg-indigo-500/10 rounded-full mix-blend-screen filter blur-[100px] animate-blob pointer-events-none" />
      <div className="absolute top-1/3 -right-32 w-[30rem] h-[30rem] bg-fuchsia-500/10 rounded-full mix-blend-screen filter blur-[100px] animate-blob animation-delay-2000 pointer-events-none" />
      
      <div className="z-10 w-full max-w-lg">
        <AnimatePresence mode="wait">
          {mode === 'home' && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-neutral-900/50 backdrop-blur-2xl border border-neutral-800 shadow-2xl rounded-[2rem] p-10 relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
              
              <div className="text-center mb-12 relative z-10">
                <motion.div 
                  initial={{ scale: 0.8, rotate: -10 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                  className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-[0_0_40px_rgba(99,102,241,0.4)]"
                >
                  <motion.div
                    animate={{ y: [0, -5, 0] }}
                    transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                  >
                    <Zap className="w-8 h-8" />
                  </motion.div>
                </motion.div>
                <motion.h1 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="text-4xl font-extrabold text-white tracking-tight mb-2"
                >
                  Sender App
                </motion.h1>
                <motion.p 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-neutral-400 font-medium"
                >
                  Direct device-to-device file sharing.<br/>Zero limits, absolute quality.
                </motion.p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 relative z-10">
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setMode('send')}
                  className="flex flex-col items-center justify-center p-6 bg-neutral-800/50 hover:bg-neutral-800 border border-neutral-700/50 hover:border-indigo-500/50 rounded-2xl transition-all duration-300 group shadow-lg"
                >
                  <div className="w-12 h-12 bg-neutral-900 rounded-full flex items-center justify-center shadow-inner text-indigo-400 group-hover:text-indigo-300 mb-4 border border-neutral-800">
                    <Send className="w-5 h-5 ml-1" />
                  </div>
                  <span className="font-semibold text-neutral-200">Send File</span>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setMode('receive')}
                  className="flex flex-col items-center justify-center p-6 bg-neutral-800/50 hover:bg-neutral-800 border border-neutral-700/50 hover:border-emerald-500/50 rounded-2xl transition-all duration-300 group shadow-lg"
                >
                  <div className="w-12 h-12 bg-neutral-900 rounded-full flex items-center justify-center shadow-inner text-emerald-400 group-hover:text-emerald-300 mb-4 border border-neutral-800">
                    <Download className="w-5 h-5" />
                  </div>
                  <span className="font-semibold text-neutral-200">Receive</span>
                </motion.button>
              </div>
            </motion.div>
          )}

          {mode === 'send' && (
            <motion.div key="send" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <P2PSender onBack={() => setMode('home')} />
            </motion.div>
          )}

          {mode === 'receive' && (
            <motion.div key="receive" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <P2PReceiver initialRoom={initialRoom} onBack={() => { setMode('home'); setInitialRoom(null); }} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-12 text-center z-10 opacity-60 hover:opacity-100 transition-opacity duration-300">
        <p className="text-sm font-medium tracking-wide text-neutral-500 uppercase">
          Developed by <span className="text-indigo-400 font-bold">Mr.Golu</span>
        </p>
      </div>
    </div>
  );
}

