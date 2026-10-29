import React, { useState, useEffect } from 'react';
import { TerminalConfig, ProductionOrder, Apontamento, TERMINALS } from '../types/mes';
import { fetchTerminalsConfig } from '../services/mesStorage';
import {
  getRouteEvaluation,
  obterQuantidadeTotal,
  obterEtapasDaRota,
  doesSectorMatchStep
} from '../utils/routeEngine';
import { Monitor, Users, Layers, AlertCircle, ChevronRight, CheckCircle2 } from 'lucide-react';

export interface TerminalsOverviewProps {
  orders: Record<string, ProductionOrder>;
  apontamentos: Apontamento[];
  terminals?: TerminalConfig[];
  onSelectOp?: (opNumero: string) => void;
}

export interface SectorQueueStatus {
  sector: string;
  ativas: number;
  naFila: number;
  activeOps: string[];
  queuedOps: string[];
}

export const checkOpIsComplete = (op: ProductionOrder, apontamentos: Apontamento[]): boolean => {
  if (op.status === 'FINALIZADA') return true;
  const steps = obterEtapasDaRota(op);
  if (!steps || steps.length === 0) return false;
  const evaluation = getRouteEvaluation(op, apontamentos, steps);
  const total = Math.max(1, Math.round(obterQuantidadeTotal(op)));
  return steps.every((s) => {
    const st = op.etapas?.[s];
    const ev = evaluation[s];
    return (st && st.status === 'CONCLUIDO') || (ev && ev.finalizadas >= total);
  });
};

export function computeTerminalSectorQueues(
  term: TerminalConfig,
  orders: Record<string, ProductionOrder>,
  apontamentos: Apontamento[]
): Record<string, SectorQueueStatus> {
  const result: Record<string, SectorQueueStatus> = {};
  const sectors = Array.from(new Set(term.sectors || []));

  sectors.forEach((s) => {
    result[s] = {
      sector: s,
      ativas: 0,
      naFila: 0,
      activeOps: [],
      queuedOps: []
    };
  });

  const orderList = Object.values(orders);

  orderList.forEach((op) => {
    if (checkOpIsComplete(op, apontamentos)) return;

    const steps = obterEtapasDaRota(op);
    if (!steps || steps.length === 0) return;
    const total = Math.max(1, Math.round(obterQuantidadeTotal(op)));
    const evaluation = getRouteEvaluation(op, apontamentos, steps);

    // Encontra a primeira etapa pendente da rota desta OP
    const nextStep = steps.find((step) => {
      const ev = evaluation[step];
      const fin = ev ? ev.finalizadas : 0;
      return fin < total;
    });

    if (!nextStep) return;

    // Verifica se algum posto deste terminal atende a esta próxima etapa
    sectors.forEach((sec) => {
      if (doesSectorMatchStep(sec, nextStep)) {
        const ev = evaluation[nextStep];
        const hasActiveApt = apontamentos.some(
          (a) =>
            a.status === 'EM_ANDAMENTO' &&
            (a.op_numero === op.op_numero || a.op === op.op_numero) &&
            doesSectorMatchStep(sec, a.setor || a.etapa_rota || '')
        );

        const isActive = (ev && ev.emAndamento > 0) || hasActiveApt;
        const opKey = op.op_numero || op.numero || '';

        if (isActive) {
          if (!result[sec].activeOps.includes(opKey)) {
            result[sec].activeOps.push(opKey);
            result[sec].ativas += 1;
          }
        } else {
          if (!result[sec].queuedOps.includes(opKey)) {
            result[sec].queuedOps.push(opKey);
            result[sec].naFila += 1;
          }
        }
      }
    });
  });

  // Também verifica apontamentos em andamento diretamente associados a cada setor
  apontamentos.forEach((a) => {
    if (a.status === 'EM_ANDAMENTO') {
      const aptSector = a.setor || a.etapa_rota || '';
      const opKey = a.op_numero || a.op || '';
      sectors.forEach((sec) => {
        if (doesSectorMatchStep(sec, aptSector)) {
          if (!result[sec].activeOps.includes(opKey)) {
            result[sec].activeOps.push(opKey);
            result[sec].ativas += 1;
            // Se estava na fila, ajusta contagem
            const qIdx = result[sec].queuedOps.indexOf(opKey);
            if (qIdx !== -1) {
              result[sec].queuedOps.splice(qIdx, 1);
              result[sec].naFila = Math.max(0, result[sec].naFila - 1);
            }
          }
        }
      });
    }
  });

  return result;
}

export function getActiveTerminalOperators(
  term: TerminalConfig,
  apontamentos: Apontamento[]
): { activeOperators: string[]; activeApontamentos: Apontamento[] } {
  const sectors = term.sectors || [];
  const activeHere = apontamentos.filter((a) => {
    if (a.status !== 'EM_ANDAMENTO') return false;
    if (a.terminal_id === term.id) return true;
    const termStr = String(a.terminal || '').toUpperCase();
    if (termStr.includes(`T${term.id}`) || termStr.includes(String(term.id))) return true;
    const aptSec = a.setor || a.etapa_rota || '';
    return sectors.some((s) => doesSectorMatchStep(s, aptSec));
  });

  const uniqueOperators = Array.from(
    new Set(activeHere.map((a) => a.operador || a.colaborador).filter(Boolean))
  ) as string[];

  return {
    activeOperators: uniqueOperators,
    activeApontamentos: activeHere
  };
}

export const TerminalsOverview: React.FC<TerminalsOverviewProps> = ({
  orders,
  apontamentos,
  terminals,
  onSelectOp
}) => {
  const [terminalsList, setTerminalsList] = useState<TerminalConfig[]>(
    () => terminals || fetchTerminalsConfig() || TERMINALS
  );

  useEffect(() => {
    if (terminals) {
      setTerminalsList(terminals);
    } else {
      const handleSync = () => {
        setTerminalsList(fetchTerminalsConfig() || TERMINALS);
      };
      window.addEventListener('storage', handleSync);
      window.addEventListener('metalrib_terminals_updated', handleSync);
      return () => {
        window.removeEventListener('storage', handleSync);
        window.removeEventListener('metalrib_terminals_updated', handleSync);
      };
    }
  }, [terminals]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <Monitor className="w-4 h-4 text-blue-400" />
          <span>Status em Tempo Real dos 5 Terminais Físicos</span>
        </h3>
        <span className="text-xs text-slate-400 font-mono">Sincronização instantânea</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {terminalsList.map((term) => {
          const { activeOperators, activeApontamentos } = getActiveTerminalOperators(
            term,
            apontamentos
          );
          const hasActiveOrders = activeApontamentos.length > 0;
          const sectorQueues = computeTerminalSectorQueues(term, orders, apontamentos);
          const sectors = Array.from(new Set(term.sectors || []));

          // Contagem total de ordens ativas e em fila no terminal
          const totalAtivasNoTerminal = Object.values(sectorQueues).reduce(
            (acc, curr) => acc + curr.ativas,
            0
          );
          const totalNaFilaNoTerminal = Object.values(sectorQueues).reduce(
            (acc, curr) => acc + curr.naFila,
            0
          );

          return (
            <div
              key={term.id}
              className="bg-[#0c142b] border-2 border-blue-900/50 hover:border-blue-700/60 rounded-2xl p-5 flex flex-col justify-between shadow-xl transition-all duration-200 h-[480px] min-h-[480px] max-h-[480px] select-none"
            >
              {/* TOPO: Cabeçalho do Terminal e Indicador Luminoso */}
              <div className="shrink-0 pb-3 border-b border-blue-950/80">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-[#1C2F8A] text-white flex items-center justify-center font-black text-base border border-blue-400/50 shadow-md shrink-0">
                      T{term.id}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-white text-base truncate">{term.name}</h4>
                      <p className="text-xs text-slate-400 font-mono truncate">{term.label}</p>
                    </div>
                  </div>

                  {/* Indicador Luminoso no Canto Superior Direito */}
                  <div className="shrink-0 flex items-center">
                    {hasActiveOrders ? (
                      <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-[11px] font-mono font-bold text-emerald-400">
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                        </span>
                        <span>Ativo</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-400">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
                        <span>Ocioso</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Sub-barra de Resumo de Carga do Terminal */}
                <div className="flex items-center gap-3 mt-3 text-[11px] font-mono text-slate-400">
                  <span>
                    Postos:{' '}
                    <strong className="text-slate-200">{sectors.length}</strong>
                  </span>
                  <span>•</span>
                  <span>
                    Em execução:{' '}
                    <strong className={totalAtivasNoTerminal > 0 ? 'text-emerald-400 font-bold' : 'text-slate-300'}>
                      {totalAtivasNoTerminal}
                    </strong>
                  </span>
                  <span>•</span>
                  <span>
                    Na fila:{' '}
                    <strong className={totalNaFilaNoTerminal > 0 ? 'text-blue-300 font-bold' : 'text-slate-300'}>
                      {totalNaFilaNoTerminal}
                    </strong>
                  </span>
                </div>
              </div>

              {/* CORPO: Grelha Interna de Duas Colunas dos Postos com Altura Padronizada */}
              <div className="flex-1 my-3 overflow-y-auto pr-1 scrollbar-thin">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {sectors.map((sector) => {
                    const q = sectorQueues[sector] || {
                      sector,
                      ativas: 0,
                      naFila: 0,
                      activeOps: [],
                      queuedOps: []
                    };

                    const isRunning = q.ativas > 0;
                    const hasQueue = q.naFila > 0;

                    return (
                      <div
                        key={`${term.id}_${sector}`}
                        className={`p-2.5 rounded-xl border text-xs font-mono transition flex flex-col justify-between gap-1.5 min-h-[64px] ${
                          isRunning
                            ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200 shadow-sm shadow-emerald-950/40'
                            : hasQueue
                            ? 'bg-blue-950/40 border-blue-800/60 text-blue-200'
                            : 'bg-slate-950/60 border-slate-800/80 text-slate-400'
                        }`}
                        title={`${sector} — ${q.ativas} ativa(s), ${q.naFila} na fila`}
                      >
                        {/* Nome do Posto */}
                        <div className="flex items-start justify-between gap-1">
                          <span
                            className="font-semibold text-[11px] text-white truncate leading-tight"
                            title={sector}
                          >
                            {sector}
                          </span>
                          {isRunning && (
                            <span className="relative flex h-2 w-2 shrink-0 mt-0.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                            </span>
                          )}
                        </div>

                        {/* Etiqueta Discreta com Contagem Conforme a Regra Oficial */}
                        <div className="text-[10px] font-mono leading-tight">
                          {isRunning ? (
                            <span className="text-emerald-400 font-bold inline-flex items-center gap-1 truncate">
                              <span>🟢</span>
                              <span className="truncate">
                                ({q.ativas} ativa{q.ativas > 1 ? 's' : ''} / {q.naFila} na fila)
                              </span>
                            </span>
                          ) : hasQueue ? (
                            <span className="text-blue-300 font-medium inline-flex items-center gap-1 truncate">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block shrink-0" />
                              <span className="truncate">• {q.naFila} OP{q.naFila > 1 ? 's' : ''}</span>
                            </span>
                          ) : (
                            <span className="text-slate-500 inline-flex items-center gap-1 truncate">
                              <span>⚪</span>
                              <span>• Vazio</span>
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* RODAPÉ: Operadores Ativos no Terminal ou Estado Ocioso */}
              <div className="pt-3 border-t border-blue-950/80 text-xs font-mono shrink-0">
                {activeOperators.length > 0 ? (
                  <div className="text-emerald-400 font-bold flex items-center gap-2 truncate">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                    <span className="truncate">
                      👥 Operadores ativos: {activeOperators.join(', ')}
                    </span>
                  </div>
                ) : (
                  <div className="text-slate-500 flex items-center gap-2 truncate">
                    <span className="w-2 h-2 rounded-full bg-slate-600 shrink-0" />
                    <span className="truncate">⚪ Terminal ocioso • Pronto para novo apontamento</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
