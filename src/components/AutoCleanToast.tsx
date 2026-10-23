import React, { useEffect, useState } from 'react';
import { CheckCircle2, ArrowRight, Sparkles } from 'lucide-react';
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
  durationMs = 3000,
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
    }, 50);

    return () => clearInterval(interval);
  }, [durationMs, onClean]);

  const progressPercent = (timeLeftMs / durationMs) * 100;
  const secondsDisplay = (timeLeftMs / 1000).toFixed(1);

  return (
    <div className="fixed top-4 left-4 right-4 z-50 max-w-4xl mx-auto animate-in fade-in slide-in-from-top-6 duration-300">
      <div className="bg-emerald-600 text-white rounded-3xl p-5 sm:p-6 shadow-2xl shadow-emerald-950/60 border-2 border-emerald-400 overflow-hidden relative">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center shrink-0 border border-white/30">
              <CheckCircle2 className="w-8 h-8 text-white stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold tracking-wider bg-black/20 px-2 py-0.5 rounded text-emerald-100">
                  SUCESSO · CHÃO DE FÁBRICA
                </span>
              </div>
              <h3 className="text-xl sm:text-2xl font-black tracking-tight text-white mt-0.5">
                {message}
              </h3>
              {details && (
                <p className="text-sm font-medium text-emerald-100 mt-0.5">
                  {details}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
            <div className="text-right">
              <span className="text-[11px] font-mono text-emerald-100 uppercase block">
                Liberando Totem Em
              </span>
              <span className="text-2xl font-black font-mono-num text-white">
                {secondsDisplay}s
              </span>
            </div>

            <button
              onClick={() => {
                playClick();
                onClean();
              }}
              className="px-5 py-3 bg-white text-emerald-900 hover:bg-emerald-50 active:scale-95 rounded-2xl font-black text-sm flex items-center gap-1.5 transition shadow-lg shrink-0 cursor-pointer"
            >
              <span>LIMPAR AGORA</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Barra de Progresso visual da contagem regressiva de 3 segundos */}
        <div className="absolute bottom-0 left-0 right-0 h-2 bg-black/30">
          <div
            className="h-full bg-white transition-all duration-75 ease-linear"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
};
