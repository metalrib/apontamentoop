import React, { useState, useEffect } from 'react';
import { TerminalConfig, ProductionOrder, Apontamento } from '../types/mes';
import { POSTOS_POR_TERMINAL } from '../data/terminais';
import { findStepForSector, getRouteForOp, getRouteEvaluation, isAncoraOrder, obterQuantidadeTotal, validarPostoIndustrial } from '../utils/routeEngine';
import { updateProductionOrder } from '../services/mesStorage';
import { playClick, playBlockedError } from '../utils/audio';
import { Check, AlertCircle, Lock } from 'lucide-react';

interface SectorSelectorProps {
  terminal: TerminalConfig;
  order: ProductionOrder;
  apontamentos: Apontamento[];
  selectedSector: string | null;
  onSelectSector: (sector: string) => void;
}

export const SectorSelector: React.FC<SectorSelectorProps> = ({
  terminal,
  order,
  apontamentos,
  selectedSector,
  onSelectSector
}) => {
  const [blockedWarning, setBlockedWarning] = useState<string | null>(null);
  const qtdTotal = obterQuantidadeTotal(order);
  // DETERMINAÇÃO DE ROTAS PERMITIDAS (SOBREPOSIÇÃO OBRIGATÓRIA SUPER CONG)
  const codNorm = String(order.codigoProduto || (order as any).cod || order.codigo || '').trim();
  const descNorm = String(order.descricao || (order as any).produto || '').toUpperCase();

  const ehSuperCong = 
    codNorm.startsWith('007.') || 
    codNorm.startsWith('003.') || 
    codNorm.startsWith('007') || 
    codNorm.startsWith('003') || 
    descNorm.includes('007.') || 
    descNorm.includes('003.') || 
    descNorm.includes('SUPER CONG');

  let steps: string[];

  if (ehSuperCong) {
    if (codNorm.startsWith('003.') || codNorm.startsWith('003') || descNorm.includes('PT GIR') || descNorm.includes('GIRO')) {
      steps = [
        'Corte',
        'Dobra',
        'Preparação de Folhas',
        'Injeção de Folhas',
        'Montagem de Portas Giratória'
      ];
    } else {
      steps = [
        'Corte',
        'Dobra',
        'Preparação de Folhas',
        'Injeção de Folhas',
        'Montagem Portas de Correr Padrão e Especial'
      ];
    }
  } else if (Array.isArray(order.etapas) && order.etapas.length > 0) {
    steps = order.etapas;
  } else {
    const routeData = getRouteForOp(order);
    steps = routeData.steps;
  }

  const evaluation = getRouteEvaluation(order, apontamentos, steps);

  const isAncora = isAncoraOrder(order);
  const isTerminal5 = terminal.id === 5;

  const termKey = `T${terminal.id}` as keyof typeof POSTOS_POR_TERMINAL;
  const availableSectors = Array.isArray(terminal?.sectors) && terminal.sectors.length > 0
    ? terminal.sectors
    : (POSTOS_POR_TERMINAL[termKey] || []);

  const validSectors = availableSectors.filter(s => {
    if (isAncora && isTerminal5 && s.includes('Solda')) return true;
    const isStep = findStepForSector(s, steps) !== null;
    if (!isStep) return false;
    const v = validarPostoIndustrial(order, s, apontamentos, terminal.id);
    return v.valido;
  });

  // Auto-seleciona imediatamente se houver apenas UM setor válido neste terminal para a OP
  // (Caso seja âncora sob demanda ainda não ativada, não força seleção para respeitar escolha do operador)
  useEffect(() => {
    if (validSectors.length === 1 && selectedSector !== validSectors[0]) {
      const isPendingSobDemanda = isAncora && isTerminal5 && validSectors[0].includes('Solda') && !order.requer_solda;
      if (!isPendingSobDemanda) {
        onSelectSector(validSectors[0]);
      }
    }
  }, [validSectors.length, validSectors[0], selectedSector, onSelectSector, isAncora, isTerminal5, order.requer_solda]);

  return (
    <div className="w-full bg-[#0c142b] border border-blue-900/60 rounded-xl p-2.5 shadow-md shrink-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-bold text-blue-400 uppercase tracking-widest font-mono">
          PASSO 1: SELECIONE O POSTO DE TRABALHO
        </span>
        <div className="text-[10px] font-mono text-blue-300 bg-[#1C2F8A]/40 border border-blue-500/40 px-2 py-0.5 rounded">
          {terminal.name}
        </div>
      </div>

      {blockedWarning && (
        <div className="mb-2 p-2 bg-rose-950/80 border border-rose-500/70 rounded-lg text-rose-200 text-xs font-mono flex items-center gap-2 animate-pulse">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{blockedWarning}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
        {availableSectors.map((sector, idx) => {
          const matchedStep = findStepForSector(sector, steps);
          const isSobDemanda = isAncora && isTerminal5 && sector.includes('Solda');
          const isPartOfRoute = matchedStep !== null || isSobDemanda;
          const stepEval = matchedStep ? evaluation[matchedStep] : null;
          const isSelected = selectedSector === sector;
          const isLaserSector = sector.toLowerCase().includes('laser');
          const isLaserPending = isLaserSector && Boolean(order.requer_laser) && (!stepEval || stepEval.finalizadas < qtdTotal);

          // Validação estrita de rotas industriais especiais
          const routeValidation = validarPostoIndustrial(order, sector, apontamentos, terminal.id);
          const isBlockedByRouteRule = !routeValidation.valido;

          return (
            <button
              key={`${terminal.id}_${sector}_${idx}`}
              onClick={async () => {
                if (isBlockedByRouteRule) {
                  playBlockedError();
                  setBlockedWarning(routeValidation.motivo || 'Posto não permitido para esta OP.');
                  setTimeout(() => setBlockedWarning(null), 6000);
                  return;
                }
                setBlockedWarning(null);
                playClick();
                if (isSobDemanda && !order.requer_solda) {
                  await updateProductionOrder(order.op_numero, { requer_solda: true });
                }
                onSelectSector(sector);
              }}
              title={isBlockedByRouteRule ? routeValidation.motivo : undefined}
              className={`relative py-1.5 px-3 text-xs sm:text-sm font-semibold rounded-xl border text-center transition-all flex items-center justify-between kiosk-btn ${
                isBlockedByRouteRule
                  ? 'bg-slate-950/30 border-slate-800/80 text-slate-500 cursor-not-allowed opacity-60'
                  : isSelected
                  ? 'bg-gradient-to-r from-[#1C2F8A] to-blue-700 border-blue-400 ring-2 ring-blue-500/60 shadow-lg text-white font-bold cursor-pointer'
                  : isSobDemanda && !order.requer_solda
                  ? 'bg-amber-950/25 border-amber-500/50 hover:border-amber-400 text-amber-200 cursor-pointer'
                  : isLaserPending
                  ? 'bg-orange-950/30 border-orange-500/60 hover:border-orange-400 text-orange-200 cursor-pointer'
                  : isPartOfRoute
                  ? 'bg-slate-900 border-slate-700/80 hover:border-blue-500/60 hover:bg-slate-850 text-slate-200 cursor-pointer'
                  : 'bg-slate-950/40 border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 cursor-pointer'
              }`}
            >
              <span
                className={`w-2 h-2 mr-2 rounded-full shrink-0 ${
                  isBlockedByRouteRule
                    ? 'bg-slate-600'
                    : isSobDemanda && !order.requer_solda
                    ? 'bg-amber-400 animate-pulse'
                    : isLaserPending
                    ? 'bg-orange-400 animate-pulse'
                    : isPartOfRoute
                    ? 'bg-emerald-400'
                    : 'bg-slate-600'
                }`}
              />

              <span className="whitespace-normal text-center leading-snug text-xs sm:text-sm font-semibold flex-1 break-words">
                {sector}
              </span>

              {isBlockedByRouteRule ? (
                <div className="shrink-0 ml-1.5 text-slate-500" title={routeValidation.motivo}>
                  <Lock className="w-3.5 h-3.5" />
                </div>
              ) : isSelected ? (
                <div className="w-4 h-4 rounded-full bg-blue-400 text-slate-950 flex items-center justify-center font-bold shrink-0 shadow-sm ml-1.5">
                  <Check className="w-3 h-3 stroke-[3]" />
                </div>
              ) : isSobDemanda && !order.requer_solda ? (
                <span className="text-[10px] text-amber-400 font-mono shrink-0 ml-1.5">+Solda</span>
              ) : isLaserPending && stepEval ? (
                <span className="text-[10px] text-orange-400 font-mono font-bold shrink-0 flex items-center gap-0.5 ml-1.5">
                  🔥 {stepEval.finalizadas}/{qtdTotal}
                </span>
              ) : isPartOfRoute && stepEval ? (
                <span className="text-[10px] text-slate-400 font-mono shrink-0 ml-1.5">
                  {stepEval.finalizadas}/{qtdTotal}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
};
