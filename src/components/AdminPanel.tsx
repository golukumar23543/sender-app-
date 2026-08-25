import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Users, Smartphone, Download, Shield, RefreshCw, KeyRound, Sparkles, CheckCircle2 } from 'lucide-react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '../lib/firebase';

interface AdminPanelProps {
  onBack: () => void;
}

export function AdminPanel({ onBack }: AdminPanelProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  
  const [installs, setInstalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === 'Golu@87091') {
      setIsAuthenticated(true);
      fetchData();
    } else {
      setError('Incorrect password');
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'installs'), orderBy('installedAt', 'desc'));
      const querySnapshot = await getDocs(q);
      const data = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setInstalls(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass-panel rounded-[2.5rem] p-8 sm:p-10 relative overflow-hidden w-full max-w-md shadow-2xl"
      >
        <div className="absolute -top-20 -right-20 w-48 h-48 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />
        
        <motion.button 
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          onClick={onBack}
          className="absolute top-6 left-6 p-2.5 text-neutral-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] rounded-2xl transition-all duration-200 z-20 border border-white/[0.08]"
        >
          <ArrowLeft className="w-5 h-5" />
        </motion.button>

        <div className="text-center mb-8 relative z-10 mt-2">
          <div className="w-16 h-16 bg-gradient-to-br from-indigo-500/20 to-purple-600/20 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-indigo-500/30 shadow-[0_0_30px_rgba(99,102,241,0.3)]">
            <Shield className="w-8 h-8 text-indigo-400" />
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Admin Portal</h2>
          <p className="text-neutral-400 mt-1 text-xs">Enter authorization pass to view install telemetry.</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4 relative z-10">
          <div className="space-y-2">
            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-300"></div>
              <input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                placeholder="Enter Password"
                className="relative w-full text-center text-lg text-white bg-neutral-950/80 border-2 border-white/[0.1] focus:border-indigo-500/60 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl py-3.5 transition-all outline-none placeholder:text-neutral-600"
                autoFocus
              />
            </div>
            {error && <p className="text-red-400 text-xs font-semibold text-center">{error}</p>}
          </div>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold py-3.5 rounded-2xl transition-all duration-300 shadow-xl border border-indigo-400/30 cursor-pointer text-sm"
          >
            Unlock Dashboard
          </motion.button>
        </form>
      </motion.div>
    );
  }

  const deviceCounts = installs.reduce((acc, curr) => {
    const name = curr.deviceName || curr.platform || 'Unknown';
    acc[name] = (acc[name] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass-panel rounded-[2.5rem] p-6 sm:p-8 w-full max-w-2xl relative max-h-[85vh] overflow-y-auto custom-scrollbar shadow-2xl"
    >
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-white/[0.08] sticky top-0 bg-[#0d0f18]/90 backdrop-blur-xl z-20 -mt-2 pt-2">
        <div className="flex items-center space-x-3.5">
          <motion.button 
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            onClick={onBack}
            className="p-2.5 text-neutral-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] rounded-2xl transition-all duration-200 border border-white/[0.08]"
          >
            <ArrowLeft className="w-5 h-5" />
          </motion.button>
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2 tracking-tight">
              <Shield className="w-5 h-5 text-indigo-400" />
              <span>Admin Telemetry</span>
            </h2>
            <p className="text-[11px] text-neutral-400">Live app install and device tracking</p>
          </div>
        </div>

        <motion.button 
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={fetchData} 
          disabled={loading}
          className="flex items-center space-x-1.5 text-xs font-semibold bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] px-3 py-2 rounded-xl text-neutral-300 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </motion.button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-neutral-400 text-sm animate-pulse">
          Fetching device analytics...
        </div>
      ) : (
        <div className="space-y-6">
          {/* Key metrics grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="glass-card p-5 rounded-2xl border border-white/[0.08] flex flex-col items-center justify-center relative overflow-hidden">
              <div className="absolute -top-10 -right-10 w-24 h-24 bg-emerald-500/10 rounded-full blur-xl pointer-events-none" />
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-2 border border-emerald-500/30">
                <Download className="w-5 h-5" />
              </div>
              <div className="text-3xl font-extrabold text-white tracking-tight">{installs.length}</div>
              <div className="text-xs text-neutral-400 font-medium mt-0.5">Total Installs</div>
            </div>

            <div className="glass-card p-5 rounded-2xl border border-white/[0.08] flex flex-col items-center justify-center relative overflow-hidden">
              <div className="absolute -top-10 -right-10 w-24 h-24 bg-indigo-500/10 rounded-full blur-xl pointer-events-none" />
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center mb-2 border border-indigo-500/30">
                <Users className="w-5 h-5" />
              </div>
              <div className="text-3xl font-extrabold text-white tracking-tight">{Object.keys(deviceCounts).length}</div>
              <div className="text-xs text-neutral-400 font-medium mt-0.5">Device Models</div>
            </div>
          </div>

          {/* Grouped counts by device */}
          <div className="glass-card p-5 rounded-2xl border border-white/[0.08]">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2 uppercase tracking-wider">
              <Smartphone className="w-4 h-4 text-indigo-400" />
              <span>Installs by Exact Device Model</span>
            </h3>
            <div className="space-y-2">
              {Object.entries(deviceCounts).map(([platform, count]) => (
                <div key={platform} className="flex justify-between items-center bg-white/[0.02] hover:bg-white/[0.05] p-3 rounded-xl border border-white/[0.05] transition-colors">
                  <div className="flex items-center space-x-2.5">
                    <div className="w-2 h-2 rounded-full bg-indigo-400" />
                    <span className="text-neutral-200 font-medium text-sm">{platform}</span>
                  </div>
                  <span className="text-indigo-300 font-mono font-bold bg-indigo-500/15 border border-indigo-500/30 px-2.5 py-0.5 rounded-lg text-xs">
                    {count} {count === 1 ? 'device' : 'devices'}
                  </span>
                </div>
              ))}
              {Object.keys(deviceCounts).length === 0 && (
                <div className="text-center text-neutral-500 py-6 text-xs font-medium">No device installs recorded yet.</div>
              )}
            </div>
          </div>

          {/* Detailed logs */}
          <div className="glass-card p-5 rounded-2xl border border-white/[0.08] overflow-hidden">
            <h3 className="text-sm font-bold text-white mb-3 uppercase tracking-wider">
              Detailed Installation Logs
            </h3>
            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1.5 custom-scrollbar">
              {installs.map((install) => (
                <div key={install.id} className="bg-white/[0.02] hover:bg-white/[0.04] p-3.5 rounded-xl border border-white/[0.05] flex flex-col space-y-2 transition-colors">
                  <div className="flex justify-between items-center">
                    <span className="text-indigo-300 font-semibold bg-indigo-500/10 px-2.5 py-1 rounded-lg text-xs border border-indigo-500/20">
                      {install.deviceName || install.platform || 'Unknown Device'}
                    </span>
                    <span className="text-neutral-500 text-[11px] font-mono">
                      {install.installedAt?.toDate ? install.installedAt.toDate().toLocaleString() : 'Just now'}
                    </span>
                  </div>
                  <div className="text-[11px] text-neutral-400 font-mono break-all bg-neutral-950/80 p-2 rounded-lg border border-white/[0.04]">
                    {install.deviceInfo || 'No user agent details'}
                  </div>
                </div>
              ))}
              {installs.length === 0 && (
                <div className="text-center text-neutral-500 py-6 text-xs font-medium">No logs recorded yet.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

