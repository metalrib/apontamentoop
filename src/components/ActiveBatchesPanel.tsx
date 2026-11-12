import React, { useState, useEffect } from 'react';
import { Clock, User, Zap, ArrowRight, Layers } from 'lucide-react';
import { playClick } from '../utils/audio';
import { formatarNumeroOP } from '../utils/nomusParser';

export interface ActiveBatchItem {
  id: string;
  apontamentoId?: string;
  opNumero: string;
  descricao: string;
  codigo?: string;
  etapa: string;
  operador: string;
  horaInicio?: string;
  inicioMs: number;
}

interface ActiveBatchesPanelProps {
  items: ActiveBatchItem[];
  onSelectBatch: (item: ActiveBatchItem) => void;
  terminalId?: number | string;
  terminalNome?: string;
}

const ActiveBatchCard: React.FC<{ item: ActiveBatchItem; onSelect: () => void }> = ({ item, onSelect }) => {
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(() => {
    return Math.max(0, Math.floor((Date.now() - item.inicioMs) / 1000));
  });

  useEffect(() => {
    const update = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - item.inicioMs) / 1000)));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [item.inicioMs]);

  const formatTimer = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
      return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <button
      type="button"
      onClick={() => {
        playClick();
        onSelect();
      }}
      className="text-left bg-gradient-to-br from-slate-900/95 via-[#0c142b]/90 to-[#070d1d] hover:from-[#111c38] hover:to-[#0c1630] active:scale-[0.99] border-2 border-amber-500/40 hover:border-amber-400 p-4 rounded-2xl shadow-xl hover:shadow-amber-500/10 transition-all group flex flex-col justify-between gap-3 cursor-pointer w-full relative overflow-hidden"
    >
      {/* Faixa decorativa superior discreta */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-amber-400 to-emerald-400 opacity-70 group-hover:opacity-100 transition-opacity" />

      {/* Topo do Card: Número da OP e Badge do Posto */}
      <div className="flex items-center justify-between gap-2 w-full">
        <span className="text-base sm:text-lg font-black text-white font-mono tracking-wide group-hover:text-amber-300 transition-colors">
          {formatarNumeroOP(item.opNumero)}
        </span>
        <span className="px-2.5 py-1 rounded-lg text-xs font-bold font-mono bg-blue-600/20 text-blue-300 border border-blue-500/40 flex items-center gap-1.5 shrink-0">
          <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
          <span className="truncate max-w-[130px] sm:max-w-[160px]">{item.etapa}</span>
        </span>
      </div>

      {/* Meio: Descrição do Produto e Código */}
      <div className="w-full">
        <p className="text-xs text-slate-200 font-medium line-clamp-1 group-hover:text-white transition-colors">
          {item.descricao}
        </p>
        {item.codigo && (
          <p className="text-[11px] text-slate-400 font-mono mt-0.5">
            Cód: {item.codigo}
          </p>
        )}
      </div>

      {/* Base: Operador, Cronômetro e Botão Concluir */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80 w-full">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5 text-slate-300 text-xs truncate" title={`Operador: ${item.operador}`}>
            <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="font-semibold truncate">{item.operador}</span>
          </div>

          <div className="flex items-center gap-1.5 text-amber-400 text-xs font-mono font-bold shrink-0">
            <Clock className="w-3.5 h-3.5 animate-spin" />
            <span>{formatTimer(elapsedSeconds)}</span>
          </div>
        </div>

        <span className="px-3 py-1.5 rounded-xl bg-emerald-600/20 group-hover:bg-emerald-600 text-emerald-300 group-hover:text-white border border-emerald-500/40 font-bold text-xs font-mono transition-all flex items-center gap-1 shrink-0 shadow-sm">
          <span>CONCLUIR</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </span>
      </div>
    </button>
  );
};

export const ActiveBatchesPanel: React.FC<ActiveBatchesPanelProps> = ({
  items,
  onSelectBatch,
  terminalId,
  terminalNome
}) => {
  if (!items || items.length === 0) return null;

  const terminalLabel = terminalId
    ? `TERMINAL ${terminalId}`
    : terminalNome
    ? terminalNome.toUpperCase()
    : 'ESTE TERMINAL';

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col gap-3.5 animate-in fade-in slide-in-from-bottom-3 duration-200">
      {/* Cabeçalho do Painel */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-400">
            <Zap className="w-4 h-4 fill-amber-400" />
          </div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm sm:text-base font-extrabold text-white tracking-wide font-mono">
              ⚡ LOTES EM EXECUÇÃO NO {terminalLabel}
            </h3>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono">
              {items.length}
            </span>
          </div>
        </div>

        <span className="text-xs text-slate-400 font-mono">
          Toque no card para concluir o lote sem bipar novamente
        </span>
      </div>

      {/* Grade de Cards de Lotes Ativos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full">
        {items.map((item) => (
          <ActiveBatchCard
            key={item.id}
            item={item}
            onSelect={() => onSelectBatch(item)}
          />
        ))}
      </div>
    </div>
  );
};
