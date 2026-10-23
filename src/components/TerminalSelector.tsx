import React, { useMemo } from 'react';
import { TerminalConfig } from '../types/mes';
import { fetchTerminalsConfig } from '../services/mesStorage';
import { Check, Factory, ChevronRight } from 'lucide-react';
import { playClick } from '../utils/audio';
import { MetalribLogo } from './MetalribLogo';

interface TerminalSelectorProps {
  currentTerminalId: number | null;
  onSelectTerminal: (terminal: TerminalConfig) => void;
  onCancel?: () => void;
  isModal?: boolean;
}

export const TerminalSelector: React.FC<TerminalSelectorProps> = ({
  currentTerminalId,
  onSelectTerminal,
  onCancel,
  isModal = false
}) => {
  const terminals = useMemo(() => fetchTerminalsConfig(), []);

  return (
    <div
      className={
        isModal
          ? 'w-full max-w-7xl p-4 sm:p-6 bg-[#0c142b] rounded-2xl border border-blue-900/60 shadow-2xl flex flex-col items-center max-h-[92vh] overflow-y-auto'
          : 'min-h-screen w-full overflow-y-auto p-4 md:p-6 bg-slate-950 flex flex-col items-center justify-center'
      }
    >
      {/* Cabeçalho Compacto de Seleção */}
      <div className="text-center mb-4 sm:mb-5 flex flex-col items-center">
        <div className="mb-2">
          <MetalribLogo size="sm" />
        </div>
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-950/80 border border-blue-800/80 text-blue-300 text-[11px] font-mono mb-1.5">
          <Factory className="w-3 h-3 text-blue-400" />
          <span>CONFIGURAÇÃO DE HARDWARE DO TOTEM</span>
        </div>
        <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
          SELEÇÃO DO TERMINAL FÍSICO
        </h1>
        <p className="text-slate-400 text-xs sm:text-sm mt-1 max-w-2xl mx-auto">
          Identifique o posto deste computador no chão de fábrica da Metalrib.
        </p>
      </div>

      {/* Grade Responsiva Compacta dos Terminais 1 a 5 (5 colunas no Desktop) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 max-w-7xl w-full">
        {terminals.map((term) => {
          const isSelected = currentTerminalId === term.id;
          const uniqueSectors = Array.from(new Set(term.sectors || []));

          return (
            <button
              key={term.id}
              onClick={() => {
                playClick();
                onSelectTerminal(term);
              }}
              className={`text-left p-3.5 rounded-xl border-2 transition-all flex flex-col justify-between kiosk-btn cursor-pointer ${
                isSelected
                  ? 'bg-[#1C2F8A]/40 border-blue-400 ring-2 ring-blue-500/50 shadow-lg shadow-blue-900/40'
                  : 'bg-slate-900/90 border-slate-800 hover:border-blue-500/50 hover:bg-slate-850'
              }`}
            >
              <div>
                {/* Header do Card com Ícone T1..T5 e Título */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm shrink-0 ${
                        isSelected
                          ? 'bg-[#1C2F8A] text-white border border-blue-300 shadow-sm'
                          : 'bg-slate-800 text-blue-400 border border-slate-700'
                      }`}
                    >
                      T{term.id}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-white tracking-wide truncate">
                        {term.name}
                      </h3>
                      <span className="text-[11px] text-slate-400 font-mono block truncate">
                        {term.label}
                      </span>
                    </div>
                  </div>

                  {isSelected && (
                    <div className="w-5 h-5 rounded-full bg-amber-500 text-black flex items-center justify-center font-bold shrink-0 mt-0.5">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                  )}
                </div>

                {/* Lista de Setores Autorizados em Pílulas Inline Compactas */}
                <div className="mt-2.5 pt-2 border-t border-slate-800/80">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                    Setores ({uniqueSectors.length})
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {uniqueSectors.map((sector, idx) => (
                      <span
                        key={`${term.id}_sec_${sector}_${idx}`}
                        className="text-[10px] py-0.5 px-2 bg-slate-800/80 rounded border border-slate-700/60 text-slate-300 font-medium inline-block"
                      >
                        {sector}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Botão Inferior Compacto */}
              <div
                className={`mt-3 pt-2 border-t border-slate-800 flex items-center justify-between text-xs font-bold py-1 ${
                  isSelected ? 'text-blue-300' : 'text-amber-400'
                }`}
              >
                <span>{isSelected ? 'TERMINAL ATUAL' : 'SELECIONAR ESTE'}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </div>
            </button>
          );
        })}
      </div>

      {isModal && onCancel && (
        <div className="mt-4 text-center">
          <button
            onClick={onCancel}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
          >
            Manter Terminal Atual
          </button>
        </div>
      )}
    </div>
  );
};
