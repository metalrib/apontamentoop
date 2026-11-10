import React, { useState, useEffect } from 'react';
import { ProductionOrder, Apontamento } from '../types/mes';
import { updateProductionOrder } from '../services/mesStorage';
import { StepStatus, doesSectorMatchStep, matchStepName, verificarRouterLiberada, verificarDobraLiberada, verificarPreparacaoFolhasLiberada, isVaiVemOuOfficeDoor, verificarLiberacaoMontagemVaiVemOuOfficeDoor } from '../utils/routeEngine';
import { Play, Square, Lock, Clock, CheckCircle2, User, Sparkles, Layers, AlertTriangle, RotateCcw } from 'lucide-react';
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
  onCancelStart?: (apontamentoId: string, etapaRota: string) => void;
  isLoading?: boolean;
  // Regra de Fluxo Contínuo Gaxeta -> Montagem
  ehGaxetaParaMontagem?: boolean;
  qtdGaxetaPronta?: number;
  qtdMontagemPronta?: number;
  pecasDisponiveisParaMontar?: number;
  onOpenOccurrenceModal?: () => void;
  ocorrenciasCount?: number;
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
  onCancelStart,
  isLoading = false,
  ehGaxetaParaMontagem = false,
  qtdGaxetaPronta = 0,
  qtdMontagemPronta = 0,
  pecasDisponiveisParaMontar = 0,
  onOpenOccurrenceModal,
  ocorrenciasCount = 0
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

  // Regra de Bloqueio Condicional: Montagem de Vai-Vem e Office Door (Terminal 5)
  const prevStepName = stepEval.previousStepName || '';

  const isPostoMontagem = Boolean(
    (matchedStep?.toUpperCase() || '').includes('MONTAGEM') || 
    (matchedStep?.toUpperCase() || '').includes('FINALIZACAO') ||
    (selectedSector?.toUpperCase() || '').includes('MONTAGEM') || 
    (selectedSector?.toUpperCase() || '').includes('FINALIZACAO')
  );

  const isMontagemVaiVemOuOfficeDoor = isPostoMontagem && isVaiVemOuOfficeDoor(order);
  const montagemVVCheck = isMontagemVaiVemOuOfficeDoor
    ? verificarLiberacaoMontagemVaiVemOuOfficeDoor(order, apontamentos)
    : { liberada: true };

  // Regra de Fluxo Paralelo: Dobra e Preparação de Folhas
  const isDobra = (matchedStep?.toUpperCase() || '').includes('DOBRA') || (selectedSector?.toUpperCase() || '').includes('DOBRA');
  const dobraCheck = verificarDobraLiberada(order, apontamentos);

  const isPrepFolhas =
    ((matchedStep?.toUpperCase() || '').includes('PREPARACAO') && (matchedStep?.toUpperCase() || '').includes('FOLHA')) ||
    ((selectedSector?.toUpperCase() || '').includes('PREPARACAO') && (selectedSector?.toUpperCase() || '').includes('FOLHA')) ||
    ((matchedStep?.toUpperCase() || '') === 'PREPARACAO' && prevStepName.toUpperCase().includes('DOBRA'));
  const prepCheck = verificarPreparacaoFolhasLiberada(order, apontamentos);

  // REGRA DE LIBERAÇÃO DIRETA E SEM AMARRAÇÃO DE ÍNDICE:
  // Se a etapa anterior da OP já estiver com status concluído (ou quantidadeConcluida >= totalPhysicalUnits):
  // TODAS as peças da etapa atual estão 100% LIBERADAS para apontamento!
  const isEtapaAnteriorConcluida = () => {
    if (stepEval.stepIndex === 0) return true;
    if (!prevStepName) return true;

    // 1. Verificação via stepEval
    if ((stepEval.previousStepFinalizadas ?? 0) >= totalPhysicalUnits) return true;

    // 2. Verificação via progressoPostos
    const progressoPrev = (order as any)?.progressoPostos
      ? (order as any).progressoPostos[prevStepName] ||
        (order as any).progressoPostos['Instalação de Gaxeta'] ||
        (order as any).progressoPostos['Instalacao de Gaxeta'] ||
        Object.entries((order as any).progressoPostos).find(([k]) => matchStepName(k, prevStepName))?.[1]
      : undefined;
    if (progressoPrev && (progressoPrev.concluido || (progressoPrev.concluidas ?? 0) >= totalPhysicalUnits || progressoPrev.status === 'CONCLUIDO')) {
      return true;
    }

    // 3. Verificação via order.etapas
    const etapasObj = order.etapas && typeof order.etapas === 'object' && !Array.isArray(order.etapas) ? order.etapas : undefined;
    if (etapasObj) {
      const prevEntry = Object.entries(etapasObj).find(([k]) => matchStepName(k, prevStepName));
      if (prevEntry) {
        const val: any = prevEntry[1];
        const st = String(val?.status || val || '').toUpperCase().trim();
        if (st === 'CONCLUIDO' || st === 'FINALIZADO' || (val?.concluidas ?? 0) >= totalPhysicalUnits) {
          return true;
        }
      }
    }

    // 4. Verificação via apontamentos da etapa anterior
    const prevApts = apontamentos.filter(
      (a) =>
        (a.op_numero === order.op_numero || a.op === order.op_numero) &&
        (matchStepName(a.etapa_rota || a.etapaRota, prevStepName) ||
          doesSectorMatchStep(a.setorFisico || a.setor || '', prevStepName))
    );
    const hasBatchFinished = prevApts.some(a => (a.is_lote || a.unidade_numero === 0) && (a.status === 'FINALIZADO' || a.status === 'CONCLUIDO'));
    if (hasBatchFinished) return true;

    const finishedUnitsCount = prevApts.filter(a => (a.status === 'FINALIZADO' || a.status === 'CONCLUIDO') && !a.is_lote && a.unidade_numero > 0).length;
    if (finishedUnitsCount >= totalPhysicalUnits) return true;

    // 5. Verificação via fluxo de Gaxeta
    if (ehGaxetaParaMontagem && qtdGaxetaPronta >= totalPhysicalUnits) {
      return true;
    }

    return false;
  };

  const etapaAnteriorTotalmenteConcluida = isEtapaAnteriorConcluida();

  // Quantidade consolidada de peças prontas da etapa anterior para liberação unitária
  const totalPecasProntasEtapaAnterior = Math.max(
    stepEval.previousStepFinalizadas ?? 0,
    qtdGaxetaPronta,
    etapaAnteriorTotalmenteConcluida ? totalPhysicalUnits : 0,
    (order as any)?.progressoPostos?.[prevStepName]?.concluidas ?? 0
  );

  // Métricas agregadas
  const totalConcluidas = pieceCards.filter((p) => p.isFinished).length;
  const totalEmAndamento = pieceCards.filter((p) => p.isActive).length;
  const percentConcluido = Math.round((totalConcluidas / totalPhysicalUnits) * 100);

  // Regra do Seletor de Quantidade Física nos Cartões Unitários:
  const descUpper = String(order.descricao || (order as any).produto || '').toUpperCase();
  const rawCode = String(order.codigo || order.codigoProduto || (order as any).cod || '').trim();
  const codeClean = rawCode;
  const isFamilia011 =
    codeClean.startsWith('011.') ||
    codeClean.startsWith('011') ||
    codeClean.includes('011.0012') ||
    codeClean.includes('011.0013') ||
    codeClean.includes('011.0117') ||
    codeClean.includes('0110012') ||
    codeClean.includes('0110013') ||
    codeClean.includes('0110117') ||
    descUpper.includes('011.');
  const isFamilia010 =
    codeClean.startsWith('010.') ||
    codeClean.startsWith('010') ||
    codeClean === '010.0008';
  const isOfficeDoor =
    isFamilia010 ||
    descUpper.includes('OFFICE DOOR') ||
    descUpper.includes('OFFICE-DOOR');
  const isDupla = descUpper.includes('DUPLA') || descUpper.includes('DUPLO') || Boolean(order.isDupla);
  const isVaiVem =
    descUpper.includes('VAI VEM') ||
    descUpper.includes('VAI-VEM') ||
    descUpper.includes('VV') ||
    isFamilia011 ||
    Boolean(order.familia?.toLowerCase().includes('vai e vem'));
  const isQtdUm = totalPhysicalUnits === 1 || order.quantidade === 1 || order.quantidade_total === 1;

  const showPhysicalQuantitySelector =
    isFamilia011 ||
    isFamilia010 ||
    isOfficeDoor ||
    isDupla ||
    isVaiVem ||
    isQtdUm ||
    order.quantidadeFisica !== undefined;

  const handleAdjustPhysicalQuantity = async (delta: number) => {
    playClick();
    const current = Math.round(
      order.quantidadeFisica ??
      (isDupla && (order.quantidade_total === 1 || order.quantidade === 1) ? 2 : totalPhysicalUnits)
    );
    const nextVal = Math.max(1, current + delta);
    if (nextVal === current) return;

    await updateProductionOrder(order.op_numero, {
      quantidade_total: nextVal,
      quantidade: nextVal,
      quantidadeFisica: nextVal,
      ...(isDupla ? { quantidadeFolhas: nextVal, isDupla: true } : {})
    });
  };

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
          {/* Seletor rápido de quantidade física a produzir nos cartões unitários */}
          {showPhysicalQuantitySelector && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-amber-500/50">
              <span className="text-[11px] font-mono font-bold text-amber-300">
                Qtde Física:
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleAdjustPhysicalQuantity(-1)}
                  disabled={totalPhysicalUnits <= 1 || isLoading}
                  className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white font-bold font-mono text-xs flex items-center justify-center border border-slate-700 cursor-pointer active:scale-95 transition"
                  title="Diminuir peças físicas da OP"
                >
                  -
                </button>
                <span className="px-2 py-0.5 bg-slate-950 border border-slate-800 rounded font-mono font-black text-white text-xs min-w-[24px] text-center">
                  {totalPhysicalUnits}
                </span>
                <button
                  type="button"
                  onClick={() => handleAdjustPhysicalQuantity(1)}
                  disabled={isLoading}
                  className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 text-white font-bold font-mono text-xs flex items-center justify-center border border-slate-700 cursor-pointer active:scale-95 transition"
                  title="Aumentar peças físicas da OP"
                >
                  +
                </button>
              </div>
            </div>
          )}

          
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
            // REGRA OBRIGATÓRIA: Se a etapa anterior inteira já estiver concluída (ou for a primeira etapa da rota):
            // TODAS AS PEÇAS ESTÃO 100% LIBERADAS PARA APONTAMENTO!
            if (etapaAnteriorTotalmenteConcluida) {
              isAvailableToStart = true;
              lockReason = '';
            } else if (!routeValidation.valido) {
              isAvailableToStart = false;
              lockReason = routeValidation.motivo || 'Rota Bloqueada';
            } else if (ehGaxetaParaMontagem) {
              // Fluxo contínuo parcial da Gaxeta para a Montagem:
              if (unitNum <= totalPecasProntasEtapaAnterior) {
                isAvailableToStart = true;
              } else {
                isAvailableToStart = false;
                lockReason =
                  totalPecasProntasEtapaAnterior === 0
                    ? 'Aguardando Peça #1 na Gaxeta'
                    : `Aguardando Peça #${unitNum} na Gaxeta (${qtdMontagemPronta}/${totalPecasProntasEtapaAnterior} liberadas)`;
              }
            } else if (
              (matchedStep?.toUpperCase() || '').includes('ROUTER') ||
              (selectedSector?.toUpperCase() || '').includes('ROUTER')
            ) {
              // Posto de Router pode ser iniciado a qualquer momento em paralelo e independente
              isAvailableToStart = true;
            } else if (
              (matchedStep?.toUpperCase() || '').includes('INJECAO') ||
              (selectedSector?.toUpperCase() || '').includes('INJECAO')
            ) {
              // Posto de Injeção NUNCA depende ou espera pela etapa Router
              isAvailableToStart = true;
            } else if (isMontagemVaiVemOuOfficeDoor) {
              // REGRA DE BLOQUEIO CONDICIONAL: Montagem de Vai-Vem e Office Door (Terminal 5)
              if (!montagemVVCheck.liberada) {
                isAvailableToStart = false;
                lockReason = montagemVVCheck.motivo || '🔒 Aguardando Liberação';
              } else {
                isAvailableToStart = true;
              }
            } else if (isDobra) {
              // REGRA DE FLUXO PARALELO: Dobra liberada se Corte ou Laser estiver em andamento ou concluído
              if (dobraCheck.dobraLiberada) {
                isAvailableToStart = true;
              } else {
                isAvailableToStart = false;
                lockReason = dobraCheck.motivo || 'Aguardando início da etapa Corte ou Laser';
              }
            } else if (isPrepFolhas) {
              // REGRA DE FLUXO PARALELO: Preparação de Folhas liberada se Dobra estiver em andamento ou concluída
              if (prepCheck.preparacaoLiberada) {
                isAvailableToStart = true;
              } else {
                isAvailableToStart = false;
                lockReason = prepCheck.motivo || 'Aguardando início da etapa Dobra';
              }
            } else {
              // Postos convencionais unitários:
              if (unitNum <= totalPecasProntasEtapaAnterior) {
                isAvailableToStart = true;
              } else {
                isAvailableToStart = false;
                lockReason = `Aguardando etapa anterior (${prevStepName || 'Anterior'})`;
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

                {/* Botão Secundário: Estornar Início da Peça */}
                {onCancelStart && (
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => {
                      const confirmed = typeof window !== 'undefined'
                        ? window.confirm(`Deseja estornar o início da Peça #${unitNum}? O apontamento em andamento será cancelado.`)
                        : true;
                      if (!confirmed) return;
                      playClick();
                      onCancelStart(activeApt.id, matchedStep);
                    }}
                    className="w-full mt-1.5 py-1 px-2 rounded-lg font-mono font-bold text-[10px] text-rose-300 hover:text-white bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/30 flex items-center justify-center gap-1 transition cursor-pointer active:scale-95"
                    title={`Estornar início acidental da peça #${unitNum}`}
                  >
                    <RotateCcw className="w-3 h-3 text-rose-400" />
                    <span>Estornar Início</span>
                  </button>
                )}
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

      {/* Botão em Destaque: Registrar Ocorrência / Motivo de Atraso */}
      {onOpenOccurrenceModal && (
        <button
          type="button"
          onClick={() => {
            playClick();
            onOpenOccurrenceModal();
          }}
          className="w-full py-2.5 px-4 bg-amber-500/10 hover:bg-amber-500/20 active:scale-[0.99] text-amber-300 hover:text-amber-200 border border-amber-500/40 rounded-xl text-xs font-mono font-bold flex items-center justify-center gap-2 transition cursor-pointer shadow-sm"
          title="Registrar ocorrência ou justificar atraso sem pausar a produção"
        >
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Registrar Ocorrência / Motivo de Atraso</span>
          {ocorrenciasCount > 0 && (
            <span className="px-1.5 py-0.5 bg-amber-500/30 text-amber-200 rounded text-[10px] font-black border border-amber-500/40">
              {ocorrenciasCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
};
