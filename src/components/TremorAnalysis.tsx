import React from 'react';
import { Activity, Zap, AlertTriangle } from 'lucide-react';

interface TremorAnalysisProps {
  metrics: {
    rms: number;
    frequency: number;
    intensity: string;
    stage: string;
    recoveryRate?: number;
  };
}

export const TremorAnalysis: React.FC<TremorAnalysisProps> = ({ metrics }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl flex items-center space-x-4">
        <div className="p-3 bg-blue-500/10 rounded-lg text-blue-400">
          <Activity size={24} />
        </div>
        <div>
          <p className="text-zinc-500 text-xs uppercase tracking-wider">Tremor Amplitude</p>
          <p className="text-2xl font-mono text-white">{metrics.rms.toFixed(3)} <span className="text-sm text-zinc-600">g</span></p>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl flex items-center space-x-4">
        <div className="p-3 bg-emerald-500/10 rounded-lg text-emerald-400">
          <Zap size={24} />
        </div>
        <div>
          <p className="text-zinc-500 text-xs uppercase tracking-wider">Frequency</p>
          <p className="text-2xl font-mono text-white">{metrics.frequency.toFixed(1)} <span className="text-sm text-zinc-600">Hz</span></p>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl flex items-center space-x-4">
        <div className={`p-3 rounded-lg ${metrics.stage === 'Stage 3' ? 'bg-red-500/10 text-red-400' : metrics.stage === 'Stage 2' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-zinc-800 text-zinc-400'}`}>
          <AlertTriangle size={24} />
        </div>
        <div>
          <p className="text-zinc-500 text-xs uppercase tracking-wider">Disease Level</p>
          <p className={`text-2xl font-mono ${metrics.stage === 'Stage 3' ? 'text-red-400' : metrics.stage === 'Stage 2' ? 'text-yellow-400' : 'text-zinc-400'}`}>
            {metrics.stage}
          </p>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl flex items-center space-x-4">
        <div className="p-3 bg-purple-500/10 rounded-lg text-purple-400">
          <Activity size={24} className="rotate-90" />
        </div>
        <div>
          <p className="text-zinc-500 text-xs uppercase tracking-wider">Recovery Rate</p>
          <p className="text-2xl font-mono text-white">
            {metrics.recoveryRate !== undefined ? `${metrics.recoveryRate > 0 ? '+' : ''}${metrics.recoveryRate.toFixed(1)}%` : '--'}
          </p>
        </div>
      </div>
    </div>
  );
};
