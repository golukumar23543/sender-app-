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
    <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 inset-x-0 h-64 bg-gradient-to-b from-blue-500/10 to-transparent pointer-events-none" />
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-400/20 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob pointer-events-none" />
      <div className="absolute -top-32 -right-32 w-96 h-96 bg-purple-400/20 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob animation-delay-2000 pointer-events-none" />
      
      <div className="z-10 w-full max-w-lg">
        <AnimatePresence mode="wait">
          {mode === 'home' && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-white/80 backdrop-blur-xl border border-white/40 shadow-2xl rounded-3xl p-8"
            >
              <div className="text-center mb-10">
                <div className="w-16 h-16 bg-blue-600 text-white rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-blue-500/30 transform rotate-3">
                  <Zap className="w-8 h-8" />
                </div>
                <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Beam Transfer</h1>
                <p className="text-slate-500 mt-3">Direct device-to-device file sharing.<br/>No limits, no quality loss.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setMode('send')}
                  className="flex flex-col items-center justify-center p-6 bg-slate-50 hover:bg-blue-50 border-2 border-slate-100 hover:border-blue-200 rounded-2xl transition-all group"
                >
                  <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm text-blue-600 group-hover:scale-110 transition-transform mb-4">
                    <Send className="w-5 h-5 ml-1" />
                  </div>
                  <span className="font-semibold text-slate-800">Send File</span>
                </button>

                <button
                  onClick={() => setMode('receive')}
                  className="flex flex-col items-center justify-center p-6 bg-slate-50 hover:bg-green-50 border-2 border-slate-100 hover:border-green-200 rounded-2xl transition-all group"
                >
                  <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm text-green-600 group-hover:scale-110 transition-transform mb-4">
                    <Download className="w-5 h-5" />
                  </div>
                  <span className="font-semibold text-slate-800">Receive</span>
                </button>
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

      <div className="mt-12 text-center text-xs text-slate-400 z-10">
        <p>Transfer Beam &copy; {new Date().getFullYear()}</p>
      </div>
    </div>
  );
}

