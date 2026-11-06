import React, { useState, useEffect } from 'react';
import { ProductionOrder, Apontamento } from '../types/mes';
import { StepStatus, doesSectorMatchStep, matchStepName, verificarRouterLiberada } from '../utils/routeEngine';
import { Play, Square, Lock, Clock, CheckCircle2, User, Sparkles, Layers } from 'lucide-react';
import { playClick, playBlockedError } from '../utils/audio';

interface IndividualPieceCardsProps {
  order: ProductionOrder;
  apontamentos: Apontamento[];
  selectedSector: string;
  matchedStep: string;
  selectedOperator: string | null;
  totalPhysicalUnits: number;
  stepEval: StepStatus;
  routeValidation: { valido: boolean; motivo?: string };
  onStartUnit: (unidadeNumero: number, etapaRota: string) => void;
  onFinishUnit: (apontamentoId: string, encaminharRouter?: boolean) => void;
  isLoading?: boolean;
  // Regra de Fluxo Contínuo Gaxeta -> Montagem
  ehGaxetaParaMontagem?: boolean;
  qtdGaxetaPronta?: number;
  qtdMontagemPronta?: number;
  pecasDisponiveisParaMontar?: number;
}

export const IndividualPieceCards: React.FC<IndividualPieceCardsProps> = ({
  order,
  apontamentos,
  selectedSector,
  matchedStep,
  selectedOperator,
  totalPhysicalUnits,
  stepEval,
  routeValidation,
  onStartUnit,
  onFinishUnit,
  isLoading = false,
  ehGaxetaParaMontagem = false,
  qtdGaxetaPronta = 0,
  qtdMontagemPronta = 0,
  pecasDisponiveisParaMontar = 0
}) => {
  // Timer reativo em tempo real para unidades em andamento
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTimer = (startTime?: string) => {
    if (!startTime) return '00:00';
    const startMs = new Date(startTime).getTime();
    if (isNaN(startMs)) return '00:00';
    const totalSec = Math.max(0, Math.floor((now - startMs) / 1000));
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    return `${hours > 0 ? `${hours.toString().padStart(2, '0')}:` : ''}${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Coleta apontamentos deste setor/etapa para a OP
  const sectorApontamentos = apontamentos.filter(
    (a) =>
      (a.op_numero === order.op_numero || a.op === order.op_numero) &&
      !a.is_lote &&
      (matchStepName(a.etapa_rota || a.etapaRota, matchedStep) ||
        doesSectorMatchStep(a.setorFisico || a.setor || '', matchedStep))
  );

  // Mapeia o status de cada peça individual (1 a totalPhysicalUnits)
  const pieceCards = Array.from({ length: totalPhysicalUnits }, (_, idx) => {
    const unitNum = idx + 1;
    const finishedApt = sectorApontamentos.find(
      (a) => a.unidade_numero === unitNum && (a.status === 'FINALIZADO' || a.status === 'CONCLUIDO')
    );
    const activeApt = sectorApontamentos.find(
      (a) => a.unidade_numero === unitNum && a.status === 'EM_ANDAMENTO'
    );

    const isFinished = Boolean(
      finishedApt || (stepEval.finalizadas >= totalPhysicalUnits && !activeApt)
    );
    const isActive = Boolean(activeApt);

    return {
      unitNum,
      isFinished,
      isActive,
      finishedApt,
      activeApt
    };
  });

  // Regra de Paralelismo: Montagem de Vai-Vem com Router
  const prevStepName = stepEval.previousStepName || '';
  const isEtapaAnteriorRouter = Boolean(prevStepName && prevStepName.toLowerCase().includes('router'));

  const isMontagemVaiVem = Boolean(
    (matchedStep?.toUpperCase() || '').includes('VAI VEM') &&
    ((matchedStep?.toUpperCase() || '').includes('MONTAGEM') || (matchedStep?.toUpperCase() || '').includes('FINALIZACAO')) ||
    (selectedSector?.toUpperCase() || '').includes('VAI VEM') &&
    ((selectedSector?.toUpperCase() || '').includes('MONTAGEM') || (selectedSector?.toUpperCase() || '').includes('FINALIZACAO')) ||
    (order.descricao || '').toUpperCase().includes('VAI VEM') ||
    String(order.codigo || order.codigoProduto || '').startsWith('011.')
  );

  const routerCheck = verificarRouterLiberada(order, apontamentos);

  // Status da etapa anterior (Router ou equivalente)
  const opApts = (order as any)?.apontamentos;
  let statusRouterApts = '';
  if (opApts && typeof opApts === 'object') {
    const routerKey = Object.keys(opApts).find((k) => k.toLowerCase().includes('router'));
    if (routerKey) {
      statusRouterApts = String(opApts[routerKey]?.status || '').toLowerCase().trim();
    }
  }

  const hasActiveOrFinishedRouterApt = Array.isArray(apontamentos) && apontamentos.some((a) => {
    const matchOp = a.op_numero === order.op_numero || a.op === order.op_numero;
    if (!matchOp) return false;
    const sec = (a.setorFisico || a.setor || '').toLowerCase();
    const stp = (a.etapa_rota || a.etapaRota || '').toLowerCase();
    const isR = sec.includes('router') || stp.includes('router');
    if (!isR) return false;
    const s = String(a.status || '').toUpperCase().trim();
    return (
      s === 'EM_ANDAMENTO' ||
      s === 'EM_PRODUCAO' ||
      s === 'FINALIZADO' ||
      s === 'CONCLUIDO' ||
      Boolean((a.hora_inicio || a.horaInicio) && !a.hora_fim && !a.horaFim)
    );
  });

  const etapaRouterStatus = String(
    (order.etapas && typeof order.etapas === 'object' && !Array.isArray(order.etapas) && (order.etapas as any)['Router']?.status) || ''
  ).toLowerCase().trim();

  // A Router libera se estiver 'em_andamento' OU 'concluido'
  const isRouterLiberada = Boolean(
    statusRouterApts === 'em_andamento' ||
    statusRouterApts === 'em andamento' ||
    statusRouterApts === 'em_producao' ||
    statusRouterApts === 'em producao' ||
    statusRouterApts === 'concluido' ||
    statusRouterApts === 'concluida' ||
    statusRouterApts === 'finalizado' ||
    statusRouterApts === 'finalizada' ||
    etapaRouterStatus === 'em_andamento' ||
    etapaRouterStatus === 'em_producao' ||
    etapaRouterStatus === 'concluido' ||
    etapaRouterStatus === 'finalizado' ||
    hasActiveOrFinishedRouterApt ||
    routerCheck.routerLiberada ||
    (stepEval?.previousStepFinalizadas ?? 0) > 0
  );

  // Métricas agregadas
  const totalConcluidas = pieceCards.filter((p) => p.isFinished).length;
  const totalEmAndamento = pieceCards.filter((p) => p.isActive).length;
  const percentConcluido = Math.round((totalConcluidas / totalPhysicalUnits) * 100);

  return (
    <div className="w-full bg-[#0b101d] border border-slate-800 rounded-2xl p-3.5 shadow-xl shrink-0 mt-auto flex flex-col gap-3">
      {/* CABEÇALHO DO PAINEL DE CARTÕES UNITÁRIOS */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-blue-500/10 rounded-lg border border-blue-500/30 text-blue-400">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest block">
              PASSO 3: CARTÕES DE PEÇAS INDIVIDUAIS
            </span>
            <span className="text-sm font-bold text-white font-mono">
              {selectedSector} · {totalPhysicalUnits} Peças na OP
            </span>
          </div>
        </div>

        {/* Indicadores de Progresso */}
        <div className="flex items-center gap-2 text-xs font-mono">
          {ehGaxetaParaMontagem && (
            <span
              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all ${
                pecasDisponiveisParaMontar > 0
                  ? 'bg-cyan-950/80 text-cyan-300 border-cyan-500/50 animate-pulse'
                  : 'bg-slate-900 text-slate-500 border-slate-800'
              }`}
            >
              {pecasDisponiveisParaMontar > 0
                ? `⚡ ${pecasDisponiveisParaMontar} un liberada${pecasDisponiveisParaMontar > 1 ? 's' : ''} da Gaxeta`
                : '🔒 0 un da Gaxeta'}
            </span>
          )}

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800">
            <span className="text-emerald-400 font-bold">{totalConcluidas}/{totalPhysicalUnits}</span>
            <span className="text-slate-500">prontas</span>
            <span className="text-slate-400 font-bold">({percentConcluido}%)</span>
          </div>

          {totalEmAndamento > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-950/60 border border-amber-500/50 text-amber-300 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="font-bold">{totalEmAndamento} em andamento</span>
            </div>
          )}
        </div>
      </div>

      {/* GRADE RESPONSIVA DE CARTÕES DE PEÇAS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 max-h-[50vh] overflow-y-auto pr-1 custom-scrollbar">
        {pieceCards.map((piece) => {
          const { unitNum, isFinished, isActive, finishedApt, activeApt } = piece;

          // Validação de liberação para peças não iniciadas
          let isAvailableToStart = false;
          let lockReason = '';

          if (!isFinished && !isActive) {
            if (!routeValidation.valido) {
              isAvailableToStart = false;
              lockReason = routeValidation.motivo || 'Rota Bloqueada';
            } else if (ehGaxetaParaMontagem) {
              if (unitNum > qtdGaxetaPronta) {
                isAvailableToStart = false;
                lockReason =
                  qtdGaxetaPronta === 0
                    ? 'Aguardando Peça #1 na Gaxeta'
                    : `Aguardando Peça #${unitNum} na Gaxeta (${qtdMontagemPronta}/${qtdGaxetaPronta} liberadas)`;
              } else {
                // Sem trava sequencial: qualquer peça liberada pela gaxeta pode ser iniciada em paralelo
                isAvailableToStart = true;
              }
            } else if (isEtapaAnteriorRouter || isMontagemVaiVem) {
              // REGRA DE PARALELISMO: Router libera a montagem se estiver 'em_andamento' OU 'concluido'
              if (!isRouterLiberada) {
                isAvailableToStart = false;
                lockReason = 'Aguardando início da etapa Router';
              } else {
                // Sem trava sequencial: todas as peças ficam disponíveis para operadores diferentes trabalharem em paralelo
                isAvailableToStart = true;
              }
            } else {
              // Postos convencionais unitários (como Preparação Vai Vem, Montagem Vai Vem, etc.)
              if (stepEval.stepIndex === 0) {
                // Primeira etapa da rota: todas as peças estão liberadas
                isAvailableToStart = true;
              } else if (
                (stepEval.previousStepFinalizadas ?? 0) >= (stepEval.isBatch ? totalPhysicalUnits : unitNum)
              ) {
                // Etapa anterior concluída para a unidade ou lote
                isAvailableToStart = true;
              } else {
                isAvailableToStart = false;
                lockReason = `Aguardando etapa anterior (${stepEval.previousStepName || 'Anterior'})`;
              }
            }
          }

          // 1. ESTADO: PEÇA CONCLUÍDA
          if (isFinished) {
            const opNome = finishedApt?.operador || finishedApt?.colaborador || 'Operador';
            const duracao = finishedApt?.duracao_minutos || finishedApt?.duracao;

            return (
              <div
                key={unitNum}
                className="bg-[#09151f] border-2 border-emerald-500/60 rounded-2xl p-3.5 flex flex-col justify-between shadow-md relative overflow-hidden group transition-all"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    <span className="text-base font-extrabold text-white font-mono">
                      PEÇA #{unitNum}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 uppercase font-mono">
                    Concluída
                  </span>
                </div>

                <div className="mt-1 space-y-0.5 text-xs font-mono text-slate-300">
                  <p className="flex items-center gap-1.5 text-emerald-300">
                    <User className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="font-semibold truncate">{opNome}</span>
                  </p>
                  {duracao !== undefined && (
                    <p className="text-[11px] text-slate-400">
                      Duração: <span className="text-white font-bold">{duracao} min</span>
                    </p>
                  )}
                </div>

                <div className="mt-3 pt-2 border-t border-emerald-500/20 flex items-center justify-between text-[11px] text-emerald-400 font-mono">
                  <span>✔ Produção Aprovada</span>
                  <span className="text-slate-500">Unidade {unitNum}/{totalPhysicalUnits}</span>
                </div>
              </div>
            );
          }

          // 2. ESTADO: PEÇA EM PRODUÇÃO (CRONÔMETRO ATIVO)
          if (isActive && activeApt) {
            const opNome = activeApt.operador || activeApt.colaborador || selectedOperator || 'Operador';
            const isAssignedToCurrentUser = !selectedOperator || activeApt.operador === selectedOperator;

            return (
              <div
                key={unitNum}
                className="bg-[#181109] border-2 border-amber-500 rounded-2xl p-3.5 flex flex-col justify-between shadow-lg shadow-amber-950/40 ring-1 ring-amber-500/60 relative overflow-hidden transition-all animate-in fade-in zoom-in-95"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
                    <span className="text-base font-extrabold text-amber-200 font-mono">
                      PEÇA #{unitNum}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 uppercase font-mono">
                    Em Produção
                  </span>
                </div>

                {/* Cronômetro e Operador */}
                <div className="my-2 p-2 rounded-xl bg-slate-950/80 border border-amber-500/30 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-mono text-slate-300">
                    <User className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="font-bold text-white truncate max-w-[110px]">{opNome}</span>
                  </div>
                  <div className="flex items-center gap-1 text-sm font-extrabold font-mono text-amber-300">
                    <Clock className="w-4 h-4 text-amber-400 animate-spin" />
                    <span>{formatTimer(activeApt.hora_inicio || activeApt.horaInicio)}</span>
                  </div>
                </div>

                {/* Botão de Finalizar Peça */}
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => {
                    playClick();
                    onFinishUnit(activeApt.id);
                  }}
                  className={`w-full mt-2 py-2 px-3 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow-md cursor-pointer ${
                    isAssignedToCurrentUser
                      ? 'bg-rose-600 hover:bg-rose-500 active:scale-[0.98] text-white shadow-rose-950/50'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                  }`}
                >
                  {isLoading ? (
                    <span className="animate-spin text-base">↻</span>
                  ) : (
                    <>
                      <Square className="w-4 h-4 fill-white shrink-0" />
                      <span>FINALIZAR PEÇA #{unitNum}</span>
                    </>
                  )}
                </button>
              </div>
            );
          }

          // 3. ESTADO: PEÇA DISPONÍVEL / LIBERADA PARA INICIAR
          if (isAvailableToStart) {
            return (
              <div
                key={unitNum}
                className="bg-[#0b172a] border-2 border-cyan-500/80 hover:border-cyan-400 rounded-2xl p-3.5 flex flex-col justify-between shadow-lg shadow-cyan-950/20 relative transition-all group"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-cyan-400 animate-bounce" />
                    <span className="text-base font-extrabold text-white font-mono">
                      PEÇA #{unitNum}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 uppercase font-mono animate-pulse">
                    Liberada
                  </span>
                </div>

                <div className="mt-1 text-xs font-mono text-cyan-200/80">
                  <p className="flex items-center gap-1.5">
                    <span>Pronta para iniciar</span>
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {selectedOperator ? `Operador: ${selectedOperator}` : 'Selecione operador no Passo 2'}
                  </p>
                </div>

                {/* Botão de Iniciar Peça */}
                <button
                  type="button"
                  disabled={isLoading || !selectedOperator}
                  onClick={() => {
                    if (!selectedOperator) {
                      playBlockedError();
                      return;
                    }
                    playClick();
                    onStartUnit(unitNum, matchedStep);
                  }}
                  className={`w-full mt-3 py-2 px-3 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow-md cursor-pointer ${
                    selectedOperator
                      ? 'bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white shadow-emerald-950/50'
                      : 'bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-700 opacity-80'
                  }`}
                >
                  {isLoading ? (
                    <span className="animate-spin text-base">↻</span>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current shrink-0" />
                      <span>{selectedOperator ? `INICIAR PEÇA #${unitNum}` : 'SELECIONE OPERADOR'}</span>
                    </>
                  )}
                </button>
              </div>
            );
          }

          // 4. ESTADO: PEÇA BLOQUEADA OU NA FILA
          return (
            <div
              key={unitNum}
              className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-3.5 flex flex-col justify-between opacity-60 transition-all select-none"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Lock className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="text-base font-extrabold font-mono">
                    PEÇA #{unitNum}
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-500 border border-slate-700 uppercase font-mono">
                  Bloqueada
                </span>
              </div>

              <div className="mt-1 text-xs font-mono text-slate-500 leading-tight">
                <p>{lockReason || 'Aguardando liberação'}</p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Fila de produção: Unidade {unitNum}/{totalPhysicalUnits}
                </p>
              </div>

              <button
                type="button"
                disabled
                onClick={() => playBlockedError()}
                className="w-full mt-3 py-2 px-3 bg-slate-950/60 border border-slate-800 text-slate-600 font-bold text-xs rounded-xl cursor-not-allowed flex items-center justify-center gap-1.5 uppercase font-mono"
              >
                <Lock className="w-3.5 h-3.5 shrink-0" />
                <span>BLOQUEADA</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
