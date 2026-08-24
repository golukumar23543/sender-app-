import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Users, Smartphone, Download, Shield } from 'lucide-react';
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
      <div className="bg-neutral-900/50 backdrop-blur-2xl border border-neutral-800 shadow-2xl rounded-[2rem] p-10 relative overflow-hidden w-full max-w-md">
        <button 
          onClick={onBack}
          className="absolute top-6 left-6 p-2 text-neutral-400 hover:text-white bg-neutral-800/50 hover:bg-neutral-700 rounded-full transition-colors duration-300 z-10 border border-neutral-700/50"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="text-center mb-8 relative z-10 mt-4">
          <div className="w-16 h-16 bg-neutral-800 rounded-full flex items-center justify-center mx-auto mb-4 border border-neutral-700">
            <Shield className="w-8 h-8 text-neutral-400" />
          </div>
          <h2 className="text-2xl font-bold text-white">Admin Access</h2>
          <p className="text-neutral-400 mt-2 text-sm">Enter password to view analytics.</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4 relative z-10">
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              placeholder="Enter Password"
              className="w-full text-center text-lg text-white bg-neutral-950/50 border-2 border-neutral-800 focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 rounded-xl py-3 transition-all outline-none"
            />
            {error && <p className="text-red-400 text-sm mt-2 text-center">{error}</p>}
          </div>
          <button
            type="submit"
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-3 rounded-xl transition-colors duration-300 shadow-lg border border-indigo-500/50"
          >
            Unlock Panel
          </button>
        </form>
      </div>
    );
  }

  const deviceCounts = installs.reduce((acc, curr) => {
    acc[curr.platform || 'Unknown'] = (acc[curr.platform || 'Unknown'] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="bg-neutral-900/90 backdrop-blur-3xl border border-neutral-800 shadow-2xl rounded-[2rem] p-8 w-full max-w-2xl relative max-h-[85vh] overflow-y-auto">
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-neutral-800">
        <div className="flex items-center space-x-4">
          <button 
            onClick={onBack}
            className="p-2 text-neutral-400 hover:text-white bg-neutral-800/50 hover:bg-neutral-700 rounded-full transition-colors duration-300 border border-neutral-700/50"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield className="w-6 h-6 text-indigo-400" />
            Admin Dashboard
          </h2>
        </div>
        <button onClick={fetchData} className="text-sm bg-neutral-800 px-3 py-1 rounded hover:bg-neutral-700 transition-colors">
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-neutral-400">Loading analytics...</div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-neutral-950/50 p-6 rounded-2xl border border-neutral-800 flex flex-col items-center justify-center">
              <Download className="w-8 h-8 text-emerald-400 mb-2" />
              <div className="text-3xl font-bold text-white">{installs.length}</div>
              <div className="text-sm text-neutral-400">Total Installs</div>
            </div>
            <div className="bg-neutral-950/50 p-6 rounded-2xl border border-neutral-800 flex flex-col items-center justify-center">
              <Users className="w-8 h-8 text-blue-400 mb-2" />
              <div className="text-3xl font-bold text-white">{Object.keys(deviceCounts).length}</div>
              <div className="text-sm text-neutral-400">Unique Platforms</div>
            </div>
          </div>

          <div className="bg-neutral-950/50 p-6 rounded-2xl border border-neutral-800">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-indigo-400" />
              Installs by Device Platform
            </h3>
            <div className="space-y-3">
              {Object.entries(deviceCounts).map(([platform, count]) => (
                <div key={platform} className="flex justify-between items-center bg-neutral-900 p-3 rounded-lg border border-neutral-800">
                  <span className="text-neutral-300 font-medium">{platform}</span>
                  <span className="text-indigo-400 font-bold bg-indigo-500/10 px-3 py-1 rounded-full">{count}</span>
                </div>
              ))}
              {Object.keys(deviceCounts).length === 0 && (
                <div className="text-center text-neutral-500 py-4">No data yet.</div>
              )}
            </div>
          </div>

          <div className="bg-neutral-950/50 p-6 rounded-2xl border border-neutral-800 overflow-hidden">
            <h3 className="text-lg font-semibold text-white mb-4">
              Detailed Device Logs
            </h3>
            <div className="space-y-3 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
              {installs.map((install) => (
                <div key={install.id} className="bg-neutral-900 p-4 rounded-xl border border-neutral-800 flex flex-col space-y-2">
                  <div className="flex justify-between items-start">
                    <span className="text-indigo-400 font-semibold bg-indigo-500/10 px-3 py-1 rounded-md text-sm border border-indigo-500/20">
                      {install.platform || 'Unknown OS'}
                    </span>
                    <span className="text-neutral-500 text-xs font-mono">
                      {install.installedAt?.toDate ? install.installedAt.toDate().toLocaleString() : 'Just now'}
                    </span>
                  </div>
                  <div className="text-xs text-neutral-400 font-mono break-all bg-neutral-950 p-2 rounded-lg border border-neutral-800/50">
                    {install.deviceInfo || 'No user agent data'}
                  </div>
                </div>
              ))}
              {installs.length === 0 && (
                <div className="text-center text-neutral-500 py-4">No detailed logs yet.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
