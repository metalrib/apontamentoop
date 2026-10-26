import React, { useEffect } from 'react';
import { TerminalConfig, ProductionOrder, Apontamento } from '../types/mes';
import { POSTOS_POR_TERMINAL } from '../data/terminais';
import { findStepForSector, getRouteForOp, getRouteEvaluation, isAncoraOrder } from '../utils/routeEngine';
import { updateProductionOrder } from '../services/mesStorage';
import { playClick } from '../utils/audio';
import { Check } from 'lucide-react';

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
  const { steps } = getRouteForOp(order);
  const evaluation = getRouteEvaluation(order, apontamentos, steps);

  const isAncora = isAncoraOrder(order);
  const isTerminal5 = terminal.id === 5;

  const termKey = `T${terminal.id}` as keyof typeof POSTOS_POR_TERMINAL;
  const availableSectors = Array.isArray(terminal?.sectors) && terminal.sectors.length > 0
    ? terminal.sectors
    : (POSTOS_POR_TERMINAL[termKey] || []);
  const validSectors = availableSectors.filter(s => {
    if (isAncora && isTerminal5 && s.includes('Solda')) return true;
    return findStepForSector(s, steps) !== null;
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

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {availableSectors.map((sector, idx) => {
          const matchedStep = findStepForSector(sector, steps);
          const isSobDemanda = isAncora && isTerminal5 && sector.includes('Solda');
          const isPartOfRoute = matchedStep !== null || isSobDemanda;
          const stepEval = matchedStep ? evaluation[matchedStep] : null;
          const isSelected = selectedSector === sector;
          const isLaserSector = sector.toLowerCase().includes('laser');
          const isLaserPending = isLaserSector && Boolean(order.requer_laser) && (!stepEval || stepEval.finalizadas < order.quantidade_total);

          return (
            <button
              key={`${terminal.id}_${sector}_${idx}`}
              onClick={async () => {
                playClick();
                if (isSobDemanda && !order.requer_solda) {
                  await updateProductionOrder(order.op_numero, { requer_solda: true });
                }
                onSelectSector(sector);
              }}
              className={`py-1.5 px-3 text-xs md:text-sm rounded-lg border text-left transition-all flex items-center justify-between gap-2 kiosk-btn cursor-pointer ${
                isSelected
                  ? 'bg-[#1C2F8A]/50 border-blue-400 ring-2 ring-blue-500/50 shadow-md text-white font-bold'
                  : isSobDemanda && !order.requer_solda
                  ? 'bg-amber-950/20 border-amber-500/50 hover:border-amber-400 text-amber-200'
                  : isLaserPending
                  ? 'bg-orange-950/25 border-orange-500/60 hover:border-orange-400 text-orange-200'
                  : isPartOfRoute
                  ? 'bg-slate-900 border-slate-700/80 hover:border-blue-500/60 hover:bg-slate-850 text-slate-200'
                  : 'bg-slate-950/40 border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    isSobDemanda && !order.requer_solda
                      ? 'bg-amber-400 animate-pulse'
                      : isLaserPending
                      ? 'bg-orange-400 animate-pulse'
                      : isPartOfRoute
                      ? 'bg-emerald-400'
                      : 'bg-slate-600'
                  }`}
                />
                <span className="truncate font-semibold">{sector}</span>
              </div>

              {isSelected ? (
                <div className="w-4 h-4 rounded-full bg-blue-400 text-slate-950 flex items-center justify-center font-bold shrink-0">
                  <Check className="w-3 h-3 stroke-[3]" />
                </div>
              ) : isSobDemanda && !order.requer_solda ? (
                <span className="text-[10px] text-amber-400 font-mono shrink-0">+Solda</span>
              ) : isLaserPending && stepEval ? (
                <span className="text-[10px] text-orange-400 font-mono font-bold shrink-0 flex items-center gap-0.5">
                  🔥 {stepEval.finalizadas}/{order.quantidade_total}
                </span>
              ) : isPartOfRoute && stepEval ? (
                <span className="text-[10px] text-slate-400 font-mono shrink-0">
                  {stepEval.finalizadas}/{order.quantidade_total}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
};
