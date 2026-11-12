import React, { useEffect, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { playClick } from '../utils/audio';

interface AutoCleanToastProps {
  message: string;
  details?: string;
  durationMs?: number;
  onClean: () => void;
}

export const AutoCleanToast: React.FC<AutoCleanToastProps> = ({
  message,
  details,
  durationMs = 2500,
  onClean
}) => {
  const [timeLeftMs, setTimeLeftMs] = useState<number>(durationMs);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, durationMs - elapsed);
      setTimeLeftMs(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
        onClean();
      }
    }, 40);

    return () => clearInterval(interval);
  }, [durationMs, onClean]);

  const progressPercent = (timeLeftMs / durationMs) * 100;

  return (
    <div className="fixed top-4 right-4 z-50 pointer-events-none flex flex-col items-end max-w-sm sm:max-w-md w-full px-3 animate-in fade-in slide-in-from-top-3 duration-200">
      <div className="pointer-events-auto bg-slate-900 border border-emerald-500/60 text-white rounded-2xl p-3.5 shadow-2xl shadow-black/80 overflow-hidden relative w-full flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center shrink-0 mt-0.5">
          <CheckCircle2 className="w-5 h-5 stroke-[2.5]" />
        </div>

        <div className="flex-1 min-w-0 pr-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              SUCESSO
            </span>
          </div>
          <h4 className="text-sm font-bold text-white leading-snug mt-1 truncate">
            {message}
          </h4>
          {details && (
            <p className="text-xs text-slate-300 font-mono mt-0.5 truncate">
              {details}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            playClick();
            onClean();
          }}
          className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition shrink-0 cursor-pointer"
          title="Fechar notificação"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Linha discreta de progresso na base */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-800">
          <div
            className="h-full bg-emerald-400 transition-all duration-75 ease-linear"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
};
