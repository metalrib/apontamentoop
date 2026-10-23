import React, { useState } from 'react';
import { ProductionOrder, Apontamento } from '../types/mes';
import { calculateDeadlineInfo } from '../utils/nomusParser';
import { getRouteForOp, getRouteEvaluation, isAncoraOrder } from '../utils/routeEngine';
import { updateProductionOrder } from '../services/mesStorage';
import { playClick } from '../utils/audio';
import {
  ChevronDown,
  ChevronUp,
  Layers,
  ArrowRight,
  Monitor,
  Sparkles,
  CheckCircle2
} from 'lucide-react';

interface OpProductionCardProps {
  order: ProductionOrder;
  apontamentos?: Apontamento[];
  onOpenChat?: (order: ProductionOrder) => void;
  onSelectForTotem?: (opNumero: string) => void;
  onDelete?: (opNumero: string) => void;
}

export const OpProductionCard: React.FC<OpProductionCardProps> = ({
  order,
  apontamentos = [],
  onSelectForTotem
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Cálculo de Prazo e Atraso
  const deadline = calculateDeadlineInfo(order.data_entrega);

  // Rota e Badge de Linha Padrão vs Especial sob Medida
  const { rule, steps } = getRouteForOp(order);
  const evaluation = getRouteEvaluation(order, apontamentos, steps);
  const isAncora = isAncoraOrder(order);
  const totalPhysicalUnits = Math.max(1, Math.round(order.quantidade_total || 1));

  // Detecção de 100% Concluída Geral
  const isAllStepsFinished = steps.length > 0 && steps.every((s) => {
    const etapaState = order.etapas?.[s];
    const evalResult = evaluation[s];
    return (etapaState && etapaState.status === 'CONCLUIDO') || (evalResult && evalResult.finalizadas >= totalPhysicalUnits);
  });
  const isConcluidaGeral = order.status === 'FINALIZADA' || isAllStepsFinished;

  // Processo Atual (Em Andamento) vs Aguardando Próximo Setor
  const activeApt = apontamentos.find(
    (a) => (a.op_numero === order.op_numero || a.op === order.op_numero) && a.status === 'EM_ANDAMENTO'
  );

  const nextWaitingStep = !isConcluidaGeral && !activeApt
    ? steps.find((s) => {
        const etapaState = order.etapas?.[s];
        const evalResult = evaluation[s];
        return !((etapaState && etapaState.status === 'CONCLUIDO') || (evalResult && evalResult.finalizadas >= totalPhysicalUnits));
      }) || steps[0]
    : null;

  // Verifica se é estritamente Porta Vai e Vem faturada em M² com metragem fracionada
  const descUpper = (order.descricao || '').toUpperCase();
  const isVaiVem = descUpper.includes('VAI VEM') || descUpper.includes('VV') || rule.keyword === 'PT VAI VEM';
  const m2Num = Number(order.quantidade_m2 ?? (order.unidade_medida === 'M²' ? (order.quantidade ?? order.quantidade_total) : 0));
  const isM2Fracionado = Boolean((order.unidade_medida === 'M²' || order.quantidade_m2) && m2Num > 0 && !Number.isInteger(m2Num));
  const showPhysicalQuantitySelector = isVaiVem && isM2Fracionado;

  // Ajuste rápido de quantidade física a produzir (estritamente para Vai e Vem em M² fracionada)
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
    <div
      className={`bg-[#0c142b] rounded-2xl p-5 shadow-xl transition-all duration-200 flex flex-col justify-between relative ${
        isConcluidaGeral
          ? 'border-2 border-emerald-500/50 shadow-emerald-950/20'
          : 'border border-blue-900/60'
      }`}
    >
      {/* 1. CABEÇALHO DO CARD */}
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="space-y-1">
          {/* Número da OP e Badge 100% Concluída em destaque */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="px-2.5 py-1 bg-[#1C2F8A]/40 border border-blue-400/50 rounded-lg text-blue-200 font-mono font-black text-sm tracking-wide shadow-sm inline-block">
              {(order.numero || order.op_numero).replace(/^(\s*OP\s*)+/i, 'OP ').trim()}
            </div>

            {isConcluidaGeral && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold font-mono bg-emerald-500/20 border border-emerald-500/60 text-emerald-300 shadow-sm animate-pulse">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>CONCLUÍDA GERAL (100%)</span>
              </span>
            )}
          </div>

          {/* Badge de Linha Padrão ou Especial */}
          {rule.badge && (
            <div>
              <span
                className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${
                  rule.isStandardLine
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                    : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                }`}
              >
                {rule.badge}
              </span>
            </div>
          )}
        </div>

        {/* Canto direito: Badge com a quantidade */}
        {showPhysicalQuantitySelector ? (
          <div className="bg-slate-950/90 border border-amber-500/50 px-3 py-1.5 rounded-xl flex flex-col items-center justify-center min-w-[72px] shadow-inner shrink-0">
            <span className="text-[11px] font-mono font-bold text-amber-400 leading-none">
              {Number(order.quantidade_m2 || order.quantidade_total).toFixed(2)} M²
            </span>
            <span className="text-xs font-black text-white font-mono leading-tight mt-1 whitespace-nowrap">
              {Math.round(order.quantidade_total)} UN
            </span>
          </div>
        ) : (
          <div className="bg-slate-950/90 border border-blue-950 px-3 py-1.5 rounded-xl flex flex-col items-center justify-center min-w-[54px] shadow-inner shrink-0">
            <span className="text-xl font-black text-white font-mono leading-none">
              {Math.round(order.quantidade_total)}
            </span>
            <span className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider mt-0.5">
              {order.unidade_medida === 'UN' ? 'UN' : 'PC'}
            </span>
          </div>
        )}
      </div>

      {/* 2. CORPO PRINCIPAL */}
      <div className="my-1.5">
        {/* Título em caixa alta e negrito: Campo descricao */}
        <h3 className="text-sm font-bold text-white uppercase tracking-wide line-clamp-2 leading-snug">
          {order.descricao}
        </h3>

        {/* Subtítulo discreto: Código do Item */}
        <div className="text-xs text-slate-400 font-mono mt-1">
          <span>Cód: <span className="text-slate-300 font-semibold">{order.codigo || '—'}</span></span>
        </div>

        {/* Indicação do Processo Atual no Card Principal */}
        {!isConcluidaGeral && (
          <div className="mt-2.5">
            {activeApt ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-950/60 border border-blue-500/50 rounded-xl text-xs font-mono text-blue-200 shadow-sm">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
                <span className="truncate">
                  <span className="font-extrabold text-blue-300">🔵 PROCESSO ATUAL:</span>{' '}
                  <strong className="text-white">{activeApt.setorFisico || activeApt.setor}</strong>{' '}
                  <span className="text-slate-400 text-[11px]">(Operador: <strong className="text-blue-100">{activeApt.colaborador || activeApt.operador || 'Operador'}</strong>)</span>
                </span>
              </div>
            ) : nextWaitingStep ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-950/40 border border-amber-500/40 rounded-xl text-xs font-mono text-amber-200 shadow-sm">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
                <span className="truncate">
                  <span className="font-extrabold text-amber-300">🟡 AGUARDANDO INÍCIO EM:</span>{' '}
                  <strong className="text-white uppercase">{nextWaitingStep}</strong>
                </span>
              </div>
            ) : null}
          </div>
        )}

        {/* Seletor rápido de quantidade física a produzir - Apenas para Porta Vai e Vem faturada em M² fracionada */}
        {showPhysicalQuantitySelector && (
          <div className="mt-2.5 p-2 bg-slate-950/80 border border-amber-500/30 rounded-xl flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] font-mono text-slate-300 font-semibold">
              Qtde Física a Produzir:
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAdjustPhysicalQuantity(-1);
                }}
                disabled={order.quantidade_total <= 1}
                className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white font-bold font-mono text-sm flex items-center justify-center border border-slate-700 cursor-pointer active:scale-95 transition"
                title="Diminuir peças físicas"
              >
                -
              </button>
              <span className="px-2 py-0.5 bg-slate-900 border border-slate-700 rounded-md font-mono font-black text-white text-xs min-w-[28px] text-center">
                {order.quantidade_total}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAdjustPhysicalQuantity(1);
                }}
                className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold font-mono text-sm flex items-center justify-center border border-slate-700 cursor-pointer active:scale-95 transition"
                title="Aumentar peças físicas"
              >
                +
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3. FAIXA DE STATUS OPERACIONAL E EXPANSÃO */}
      <div className="mt-3 pt-3 border-t border-blue-950 flex items-center justify-between gap-2">
        {/* Tag de Prazo/Alerta */}
        <span
          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold font-mono border ${deadline.badgeClass}`}
        >
          {deadline.label}
        </span>

        {/* Botão de expansão: "Detalhes ∨" / "Ocultar ∧" */}
        <button
          type="button"
          onClick={() => {
            playClick();
            setIsExpanded(!isExpanded);
          }}
          className="text-xs font-mono font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1 py-1 px-2.5 rounded-lg bg-blue-950/40 hover:bg-blue-950/80 border border-blue-900/60 transition cursor-pointer"
        >
          <span>{isExpanded ? 'Ocultar' : 'Detalhes'}</span>
          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* 4. GAVETA DE DETALHES TÉCNICOS E APONTAMENTO (EXPANDIDA) */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-blue-900/60 space-y-3.5 animate-in fade-in duration-150">
          {/* Grid 2x2 apenas com informações técnicas */}
          <div className="grid grid-cols-2 gap-2 bg-slate-950/90 p-3 rounded-xl border border-blue-950 text-xs font-mono">
            <div>
              <span className="text-[10px] text-slate-500 uppercase block font-semibold">1. STATUS NOMUS ERP</span>
              <span className="text-white font-bold truncate block">{order.status_nomus || 'Liberada'}</span>
            </div>

            <div>
              <span className="text-[10px] text-slate-500 uppercase block font-semibold">2. PRAZO DE ENTREGA</span>
              <span className="text-amber-300 font-bold block">{order.data_entrega || '—'}</span>
            </div>

            <div>
              <span className="text-[10px] text-slate-500 uppercase block font-semibold">3. LOTE / ENGENHARIA</span>
              <span className="text-white font-bold block">{order.lote || '—'}</span>
            </div>

            <div>
              <span className="text-[10px] text-slate-500 uppercase block font-semibold">4. OBSERVAÇÕES</span>
              <span className="text-slate-300 truncate block" title={order.observacao || ''}>
                {order.observacao || '—'}
              </span>
            </div>
          </div>

          {/* Âncora: Controle de Solda e Montagem sob demanda */}
          {isAncora && (
            <div className="bg-amber-950/30 border border-amber-500/40 p-2.5 rounded-xl flex items-center justify-between gap-3 text-xs font-mono">
              <div>
                <span className="text-amber-300 font-bold flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  Solda e Montagem (Terminal 5)
                </span>
                <span className="text-[10px] text-slate-400 block">
                  {order.requer_solda ? 'Etapa 3 inclusa na rota da OP' : 'Conclusão padrão na Dobra (T1)'}
                </span>
              </div>
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  playClick();
                  await updateProductionOrder(order.op_numero, { requer_solda: !order.requer_solda });
                }}
                className={`px-3 py-1.5 rounded-lg font-bold text-xs border transition cursor-pointer active:scale-95 whitespace-nowrap ${
                  order.requer_solda
                    ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md'
                    : 'bg-slate-900 hover:bg-slate-800 text-amber-300 border-amber-500/50'
                }`}
              >
                {order.requer_solda ? '✓ Requer Solda' : '+ Ativar Solda'}
              </button>
            </div>
          )}

          {/* Resumo das Etapas da Rota */}
          <div className="space-y-1.5 bg-slate-950/60 p-3 rounded-xl border border-blue-950/60">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 font-semibold mb-1">
              <span className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-blue-400" />
                <span>AVANÇO NA ROTA DE PRODUÇÃO:</span>
              </span>
              <span className="text-slate-500 text-[10px]">{steps.length} etapas</span>
            </div>

            {/* Linha de Destaque antes da listagem das etapas */}
            {!isConcluidaGeral && (
              <div className="mb-2">
                {activeApt ? (
                  <div className="flex items-center gap-2 px-2.5 py-1.5 bg-blue-950/80 border border-blue-500/40 rounded-lg text-xs font-mono text-blue-200">
                    <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
                    <span className="truncate">
                      <strong>🔵 PROCESSO ATUAL:</strong> {activeApt.setorFisico || activeApt.setor} <span className="text-slate-400 text-[11px]">(Operador: {activeApt.colaborador || activeApt.operador || 'Operador'})</span>
                    </span>
                  </div>
                ) : nextWaitingStep ? (
                  <div className="flex items-center gap-2 px-2.5 py-1.5 bg-amber-950/60 border border-amber-500/40 rounded-lg text-xs font-mono text-amber-200">
                    <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                    <span className="truncate">
                      <strong>🟡 AGUARDANDO INÍCIO EM:</strong> <span className="text-white font-bold">{nextWaitingStep}</span>
                    </span>
                  </div>
                ) : null}
              </div>
            )}

            <div className="space-y-1.5">
              {steps.map((step, idx) => {
                const evalResult = evaluation[step];
                const finalizadas = evalResult?.finalizadas || 0;
                const emAndamento = evalResult?.emAndamento || 0;
                const total = Math.max(1, Math.round(order.quantidade_total || 1));
                const isComplete = finalizadas >= total;
                const isActive = emAndamento > 0;

                return (
                  <div
                    key={step}
                    className="flex items-center justify-between gap-2 text-xs font-mono px-2.5 py-1.5 rounded-lg bg-slate-900/80 border border-slate-800"
                  >
                    <span className="text-slate-300 truncate font-medium">
                      <span className="text-slate-500 mr-1.5">{idx + 1}.</span>
                      {step}
                    </span>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isComplete ? (
                        <span className="text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                          {finalizadas}/{total} concluídas
                        </span>
                      ) : isActive ? (
                        <span className="text-[11px] font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
                          {finalizadas}/{total} ({emAndamento} em andamento)
                        </span>
                      ) : finalizadas > 0 ? (
                        <span className="text-[11px] font-bold text-amber-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                          {finalizadas}/{total} concluídas
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-500 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                          0/{total} pendente
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Botão de Ação / Badge de Conclusão */}
          {isConcluidaGeral ? (
            <div className="w-full py-3 px-4 bg-emerald-950/50 border border-emerald-500/50 rounded-xl text-center text-emerald-300 font-mono text-xs font-bold flex items-center justify-center gap-2 shadow-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Produção finalizada em todos os postos</span>
            </div>
          ) : onSelectForTotem ? (
            <button
              type="button"
              onClick={() => {
                playClick();
                onSelectForTotem(order.op_numero);
              }}
              className="w-full py-3 px-4 bg-gradient-to-r from-blue-700 to-indigo-600 hover:from-blue-600 hover:to-indigo-500 text-white rounded-xl text-xs font-mono font-black border border-blue-400/40 flex items-center justify-center gap-2 transition cursor-pointer active:scale-[0.98] shadow-lg shadow-blue-950/60"
            >
              <Monitor className="w-4 h-4 text-blue-200" />
              <span>Abrir no Totem / Apontar</span>
              <ArrowRight className="w-4 h-4 text-blue-200" />
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
};
