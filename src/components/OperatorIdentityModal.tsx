import React, { useEffect } from 'react';
import { ShieldAlert, User, CheckCircle2, X } from 'lucide-react';
import { ActiveBatchItem } from './ActiveBatchesPanel';
import { formatarNumeroOP } from '../utils/nomusParser';
import { playClick } from '../utils/audio';

interface OperatorIdentityModalProps {
  batch: ActiveBatchItem;
  onConfirm: () => void;
  onCancel: () => void;
}

export const OperatorIdentityModal: React.FC<OperatorIdentityModalProps> = ({
  batch,
  onConfirm,
  onCancel
}) => {
  // Fecha com tecla ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md overflow-y-auto flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
      <div className="bg-[#0c142b] border-2 border-amber-500/70 w-full max-w-lg rounded-3xl p-6 sm:p-8 shadow-2xl shadow-amber-950/50 flex flex-col gap-6 text-center animate-in zoom-in-95 duration-200 relative">
        {/* Ícone de Alerta e Identidade */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/15 border-2 border-amber-500/50 text-amber-400 flex items-center justify-center shadow-inner">
            <ShieldAlert className="w-9 h-9 stroke-[2.2]" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-white font-mono tracking-wider">
              CONFIRMAÇÃO DE OPERADOR
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-sm mx-auto">
              Você está prestes a acessar e concluir este lote em andamento. Por favor, confirme sua identidade para evitar finalizar o lote de outro colega:
            </p>
          </div>
        </div>

        {/* Card em Destaque com os Dados do Lote */}
        <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col gap-3 text-left shadow-inner">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase font-mono tracking-wider">
              Lote em Execução
            </span>
            <span className="px-2.5 py-1 rounded-lg text-xs font-bold font-mono bg-blue-600/20 text-blue-300 border border-blue-500/40">
              Etapa: {batch.etapa}
            </span>
          </div>

          <div className="text-xl sm:text-2xl font-black text-white font-mono tracking-wide">
            {formatarNumeroOP(batch.opNumero)}
          </div>

          {batch.descricao && (
            <div className="text-xs sm:text-sm text-slate-300 font-medium line-clamp-2">
              {batch.descricao}
            </div>
          )}

          {/* Destaque Principal do Operador que iniciou o Lote */}
          <div className="mt-2 pt-3 border-t border-slate-800 flex flex-col gap-1 items-center text-center bg-slate-900/60 rounded-xl p-3 border border-slate-800/80">
            <span className="text-[11px] font-bold text-amber-400/90 uppercase tracking-widest font-mono">
              Operador que iniciou o lote:
            </span>
            <div className="flex items-center justify-center gap-2 mt-0.5">
              <User className="w-6 h-6 text-amber-400 shrink-0" />
              <span className="text-2xl sm:text-3xl font-black text-amber-300 font-sans tracking-wide">
                {batch.operador}
              </span>
            </div>
          </div>
        </div>

        {/* Botões de Ação */}
        <div className="flex flex-col gap-2.5 w-full">
          <button
            type="button"
            onClick={() => {
              playClick();
              onConfirm();
            }}
            className="w-full py-4 px-6 rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white font-black text-base sm:text-lg tracking-wide shadow-xl shadow-emerald-950 flex items-center justify-center gap-3 transition-all cursor-pointer border-2 border-emerald-400"
          >
            <CheckCircle2 className="w-6 h-6 shrink-0 text-white" />
            <span className="truncate">SIM, SOU {batch.operador.toUpperCase()}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              playClick();
              onCancel();
            }}
            className="w-full py-3 px-5 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-[0.98] text-slate-400 hover:text-rose-300 border border-slate-800 hover:border-rose-900/50 font-bold text-xs sm:text-sm tracking-wide transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <X className="w-4 h-4" />
            <span>NÃO SOU EU / CANCELAR</span>
          </button>
        </div>
      </div>
    </div>
  );
};
