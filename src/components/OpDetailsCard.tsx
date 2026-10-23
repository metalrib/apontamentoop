import React from 'react';
import { ProductionOrder, Apontamento, TerminalConfig } from '../types/mes';
import { getRouteForOp, getRouteEvaluation, findStepForSector, isAncoraOrder } from '../utils/routeEngine';
import { calculateDeadlineInfo } from '../utils/nomusParser';
import { updateProductionOrder } from '../services/mesStorage';
import { playClick } from '../utils/audio';
import { CheckCircle2, Clock, Lock, Layers, Calendar, Tag, FileText, Hash, AlertCircle, Sparkles } from 'lucide-react';

interface OpDetailsCardProps {
  order: ProductionOrder;
  apontamentos: Apontamento[];
  selectedSector: string | null;
  currentTerminal: TerminalConfig | null;
}

export const OpDetailsCard: React.FC<OpDetailsCardProps> = ({
  order,
  apontamentos,
  selectedSector
}) => {
  const { rule, steps } = getRouteForOp(order);
  const evaluation = getRouteEvaluation(order, apontamentos, steps);

  // Calcula total geral de unidades finalizadas na última etapa da rota (produto acabado)
  const finalStep = steps[steps.length - 1];
  const finishedTotalOrder = evaluation[finalStep]?.finalizadas || 0;

  // Se um setor estiver selecionado, verifica o apontamento parcial específico desse setor
  const activeStepForSector = selectedSector ? findStepForSector(selectedSector, steps) : null;
  const currentStepEval = activeStepForSector ? evaluation[activeStepForSector] : null;

  const unitBadge = order.unidade_medida || 'PC';
  const deliveryDate = order.data_entrega || 'A Definir';
  const statusNomus = order.status_nomus || 'Liberada';
  const deadline = calculateDeadlineInfo(order.data_entrega);
  const isAncora = isAncoraOrder(order);

  // Verifica se é estritamente Porta Vai e Vem faturada em M² com metragem fracionada
  const descUpper = (order.descricao || '').toUpperCase();
  const isVaiVem = descUpper.includes('VAI VEM') || descUpper.includes('VV') || rule.keyword === 'PT VAI VEM';
  const m2Num = Number(order.quantidade_m2 ?? (order.unidade_medida === 'M²' ? (order.quantidade ?? order.quantidade_total) : 0));
  const isM2Fracionado = Boolean((order.unidade_medida === 'M²' || order.quantidade_m2) && m2Num > 0 && !Number.isInteger(m2Num));
  const showPhysicalQuantitySelector = isVaiVem && isM2Fracionado;

  // Ajuste rápido de quantidade física a produzir (especialmente útil para M²)
  const handleAdjustPhysicalQuantity = async (delta: number) => {
    playClick();
    const current = Math.round(order.quantidade_total || 1);
    const nextVal = Math.max(1, current + delta);
    if (nextVal === current) return;

    await updateProductionOrder(order.op_numero, {
      quantidade_total: nextVal,
      quantidade: nextVal
    });
  };

  return (
    <div className="w-full py-1.5 px-3 bg-slate-900 border border-slate-800 rounded-lg shadow-md flex items-center justify-between gap-3 text-xs font-mono shrink-0 select-none">
      {/* Lado Esquerdo: Número da OP, Descrição, Código e Tags */}
      <div className="flex items-center gap-2.5 min-w-0">
        {/* Número da OP */}
        <div className="px-2.5 py-0.5 bg-[#1C2F8A] border border-blue-400/80 rounded-md text-white font-mono font-black text-sm tracking-wider shadow-sm shrink-0">
          {(order.numero || order.op_numero).replace(/^(\s*OP\s*)+/i, 'OP ').trim()}
        </div>

        {/* Descrição do Produto com truncate */}
        <div className="text-white font-bold text-xs sm:text-sm truncate max-w-[240px] md:max-w-sm lg:max-w-md font-sans" title={order.descricao}>
          {order.descricao}
        </div>

        {/* Código do Item */}
        <div className="hidden sm:inline-flex px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-blue-300 font-mono text-[11px] shrink-0">
          Cód: {order.codigo || '—'}
        </div>

        {/* Tag de Atraso ou Entrega */}
        {deadline.isDelayed ? (
          <span className="px-2 py-0.5 rounded bg-red-950/80 text-red-400 border border-red-800 font-bold text-[10px] shrink-0">
            {deadline.text}
          </span>
        ) : (
          <span className="hidden md:inline-flex px-2 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800 text-[10px] shrink-0">
            Entrega: {deliveryDate}
          </span>
        )}

        {/* Badge de Linha Padrão / Sob Medida */}
        {rule.badge && (
          <span
            className={`hidden lg:inline-flex px-2 py-0.5 rounded text-[10px] font-bold border shrink-0 ${
              rule.isStandardLine
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/60'
                : 'bg-amber-950/80 text-amber-300 border-amber-500/60'
            }`}
          >
            {rule.badge}
          </span>
        )}

        {/* Badge Requer Laser */}
        {order.requer_laser && (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold border shrink-0 bg-orange-950/80 text-orange-300 border-orange-500/60 font-mono flex items-center gap-1">
            <span>🔥 Requer Laser</span>
          </span>
        )}

        {/* Controle compacto de Solda sob demanda para Âncora */}
        {isAncora && (
          <button
            type="button"
            onClick={async () => {
              playClick();
              await updateProductionOrder(order.op_numero, { requer_solda: !order.requer_solda });
            }}
            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border flex items-center gap-1 shadow-sm transition cursor-pointer active:scale-95 shrink-0 ${
              order.requer_solda
                ? 'bg-amber-500 text-slate-950 border-amber-400 font-black'
                : 'bg-slate-950 text-amber-300 border-amber-500/50'
            }`}
            title="Ativar/Desativar solda sob demanda no Terminal 5"
          >
            <Sparkles className="w-3 h-3" />
            <span>{order.requer_solda ? 'Solda T5' : '+ Solda'}</span>
          </button>
        )}
      </div>

      {/* Lado Direito: Quantidade Total e Ajuste M² */}
      <div className="flex items-center gap-2 shrink-0">
        {showPhysicalQuantitySelector ? (
          <div className="px-2.5 py-0.5 bg-slate-950 border border-amber-500/60 rounded-md flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-amber-400">
              {Number(order.quantidade_m2 || order.quantidade_total).toFixed(1)} M²
            </span>
            <span className="text-white font-black text-sm">
              {Math.round(order.quantidade_total)} {order.unidade_medida === 'UN' ? 'UN' : 'PC'}
            </span>
            <div className="flex items-center gap-1 pl-1 border-l border-slate-800">
              <button
                type="button"
                onClick={() => handleAdjustPhysicalQuantity(-1)}
                disabled={order.quantidade_total <= 1}
                className="w-4 h-4 rounded bg-slate-800 text-white font-bold text-[10px] flex items-center justify-center cursor-pointer"
              >
                -
              </button>
              <button
                type="button"
                onClick={() => handleAdjustPhysicalQuantity(1)}
                className="w-4 h-4 rounded bg-slate-800 text-white font-bold text-[10px] flex items-center justify-center cursor-pointer"
              >
                +
              </button>
            </div>
          </div>
        ) : (
          <div className="px-2.5 py-0.5 bg-slate-950 border border-slate-800 rounded-md flex items-center gap-1.5">
            <span className="text-slate-400 text-[10px] font-bold">QTDE:</span>
            <span className="text-white font-black text-sm">
              {Math.round(order.quantidade_total)}
            </span>
            <span className="text-slate-300 text-[10px]">
              {order.unidade_medida === 'UN' ? 'UN' : (unitBadge === 'M²' ? 'PC' : (unitBadge || 'PC'))}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

