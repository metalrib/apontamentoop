import React, { useState, useEffect } from 'react';
import { ProductionOrder, Apontamento, TerminalConfig } from '../types/mes';
import { getRouteForOp, getRouteEvaluation, findStepForSector, isBatchTracking, matchStepName, obterQuantidadeTotal, validarPostoIndustrial } from '../utils/routeEngine';
import { updateProductionOrder } from '../services/mesStorage';
import { Play, Square, Lock, Clock, CheckCircle2, User, AlertTriangle, Check, Layers } from 'lucide-react';
import { playClick, playBlockedError } from '../utils/audio';

interface ProductionActionProps {
  order: ProductionOrder;
  apontamentos: Apontamento[];
  selectedSector: string | null;
  selectedOperator: string | null;
  currentTerminal: TerminalConfig;
  onStartUnit: (unidadeNumero: number, etapaRota: string) => void;
  onFinishUnit: (apontamentoId: string) => void;
  onStartBatch?: (etapaRota: string, quantidadeTotal: number) => void;
  onFinishBatch?: (apontamentoId: string, quantidadeRefugo?: number) => void;
  isLoading?: boolean;
}

export const ProductionAction: React.FC<ProductionActionProps> = ({
  order,
  apontamentos,
  selectedSector,
  selectedOperator,
  currentTerminal,
  onStartUnit,
  onFinishUnit,
  onStartBatch,
  onFinishBatch,
  isLoading = false
}) => {
  const { steps } = getRouteForOp(order);
  const evaluation = getRouteEvaluation(order, apontamentos, steps);

  const matchedStep = selectedSector ? findStepForSector(selectedSector, steps) : null;
  const totalPhysicalUnits = obterQuantidadeTotal(order);

  // Identifica se a OP e o Setor utilizam Apontamento em Lote Completo ou Peça a Peça (Unitário)
  const isBatch = isBatchTracking(order, selectedSector);

  // Encontra apontamentos ativos neste setor/etapa
  const activeInSector = apontamentos.filter(a => 
    a.op_numero === order.op_numero &&
    (a.setor === selectedSector || (matchedStep && a.etapa_rota === matchedStep)) &&
    a.status === 'EM_ANDAMENTO'
  );

  // Identifica se há lote ativo no setor (ou unidade ativa do operador no modo unitário)
  const activeBatch = activeInSector.find(a => a.is_lote || a.unidade_numero === 0);
  const activeUnitForCurrentOperator = selectedOperator
    ? activeInSector.find(a => a.operador === selectedOperator && !a.is_lote && a.unidade_numero > 0)
    : null;

  const activeForCurrentOperator = isBatch ? activeBatch : activeUnitForCurrentOperator;

  // Identifica se o setor selecionado é o Corte no Terminal 1
  const isCorteSector = Boolean(
    selectedSector && (
      selectedSector.toLowerCase().includes('corte') || 
      selectedSector.toLowerCase().includes('guilhotina') ||
      selectedSector.toLowerCase().includes('serra')
    )
  );

  const [sendToLaser, setSendToLaser] = useState<boolean>(Boolean(order.requer_laser));

  useEffect(() => {
    setSendToLaser(Boolean(order.requer_laser));
  }, [order.op_numero, order.requer_laser]);

  const handleToggleLaser = async () => {
    playClick();
    const nextVal = !sendToLaser;
    setSendToLaser(nextVal);
    await updateProductionOrder(order.op_numero, { requer_laser: nextVal });
  };

  // Timer para operação em andamento
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [refugoInput, setRefugoInput] = useState<number>(0);

  useEffect(() => {
    if (!activeForCurrentOperator) {
      setElapsedSeconds(0);
      setRefugoInput(0);
      return;
    }

    const calcElapsed = () => {
      const start = new Date(activeForCurrentOperator.hora_inicio).getTime();
      const now = Date.now();
      setElapsedSeconds(Math.max(0, Math.floor((now - start) / 1000)));
    };

    calcElapsed();
    const interval = setInterval(calcElapsed, 1000);
    return () => clearInterval(interval);
  }, [activeForCurrentOperator?.id, activeForCurrentOperator?.hora_inicio]);

  const formatTimer = (totalSec: number) => {
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    return `${hours > 0 ? `${hours.toString().padStart(2, '0')}:` : ''}${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Se nenhum setor foi escolhido
  if (!selectedSector) {
    return (
      <div className="w-full bg-[#0e131f] border-2 border-dashed border-slate-800 rounded-3xl p-8 text-center text-slate-500">
        <p className="text-base font-semibold">
          Selecione seu Setor acima para habilitar o comando de apontamento.
        </p>
      </div>
    );
  }

  // Se o setor não fizer parte da rota da peça
  if (!matchedStep) {
    return (
      <div className="w-full bg-slate-900/90 border-2 border-amber-500/30 rounded-3xl p-8 text-center text-amber-300">
        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
        <h3 className="text-xl font-bold text-white mb-1">
          Setor Não Aplicável a esta OP
        </h3>
        <p className="text-sm text-slate-400 max-w-lg mx-auto">
          O setor <span className="text-amber-400 font-bold">{selectedSector}</span> não consta na rota de produção desta peça ({steps.join(' ➔ ')}).
        </p>
      </div>
    );
  }

  // Se nenhum operador foi escolhido
  // Se nenhum operador foi escolhido
  if (!selectedOperator && !activeForCurrentOperator) {
    return (
      <div className="w-full bg-[#0e131f] border border-amber-500/30 rounded-xl p-3 text-center text-amber-300/80 shrink-0 mt-auto">
        <User className="w-5 h-5 text-amber-400 mx-auto mb-1 inline" />
        <span className="text-xs font-mono ml-2">
          {isBatch
            ? 'Toque no seu nome no Passo 2 acima para liberar o início do lote.'
            : 'Toque no seu nome no Passo 2 acima para liberar o início da unidade.'}
        </span>
      </div>
    );
  }

  const stepEval = evaluation[matchedStep];

  // Caso 1: LOTE OU UNIDADE EM ANDAMENTO (CRONÔMETRO ATIVO)
  if (activeForCurrentOperator) {
    const operatorName = activeForCurrentOperator.operador || selectedOperator || 'Operador';

    if (isBatch) {
      // ESTADO 2: LOTE EM PRODUÇÃO
      const startTimeFormatted = new Date(
        activeForCurrentOperator.horaInicio || activeForCurrentOperator.hora_inicio
      ).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

      return (
        <div className="w-full bg-[#0e131f] border border-cyan-500/50 rounded-xl p-2.5 shadow-lg shrink-0 mt-auto">
          <div className="flex items-center justify-between mb-2 text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
              <span className="font-bold text-cyan-400 uppercase tracking-wider">
                LOTE EM PRODUÇÃO: {totalPhysicalUnits} PC • {selectedSector} • {operatorName} • Iniciado às {startTimeFormatted}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-cyan-300 font-extrabold text-sm font-mono">
              <Clock className="w-4 h-4 animate-spin text-cyan-400" />
              <span>{formatTimer(elapsedSeconds)}</span>
            </div>
          </div>

          {/* Campo Opcional de Refugo/Perdas */}
          <div className="flex items-center justify-between px-2.5 py-1 bg-slate-950/90 border border-slate-800 rounded-lg mb-2 text-xs font-mono">
            <span className="text-slate-400">Refugo / Peças Perdidas (opcional):</span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                max={totalPhysicalUnits}
                value={refugoInput === 0 ? '' : refugoInput}
                onChange={(e) => setRefugoInput(Math.max(0, Math.min(totalPhysicalUnits, parseInt(e.target.value) || 0)))}
                placeholder="0"
                className="w-12 px-1.5 py-0.5 text-center bg-slate-900 border border-slate-700 rounded text-white font-bold text-xs focus:outline-none focus:border-cyan-400"
              />
              <span className="text-slate-500 text-[11px]">PC</span>
            </div>
          </div>

          {/* BOTÃO CONCLUIR LOTE COMPLETO */}
          <button
            onClick={() => {
              playClick();
              if (onFinishBatch) {
                onFinishBatch(activeForCurrentOperator.id, refugoInput);
              } else {
                onFinishUnit(activeForCurrentOperator.id);
              }
            }}
            disabled={isLoading}
            className="w-full py-3.5 px-6 bg-teal-600 hover:bg-teal-500 active:scale-[0.99] transition-all text-white font-bold text-base rounded-xl flex items-center justify-center gap-2 shadow-lg cursor-pointer tracking-wide uppercase"
          >
            {isLoading ? (
              <span className="animate-spin text-xl">↻</span>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5" />
                <span>CONCLUIR LOTE COMPLETO ({totalPhysicalUnits} PEÇAS)</span>
              </>
            )}
          </button>
        </div>
      );
    }

    // MODO UNITÁRIO: FINALIZAR UNIDADE
    return (
      <div className="w-full bg-[#0e131f] border border-rose-500/50 rounded-xl p-2.5 shadow-lg shrink-0 mt-auto">
        <div className="flex items-center justify-between mb-2 text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
            <span className="font-bold text-rose-400 uppercase tracking-wider">
              UNIDADE {activeForCurrentOperator.unidade_numero} DE {totalPhysicalUnits} EM PRODUÇÃO · {operatorName}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-rose-400 font-extrabold text-sm font-mono">
            <Clock className="w-4 h-4 animate-spin" />
            <span>{formatTimer(elapsedSeconds)}</span>
          </div>
        </div>

        {/* BOTÃO FINALIZAR UNIDADE */}
        <button
          onClick={() => {
            playClick();
            onFinishUnit(activeForCurrentOperator.id);
          }}
          disabled={isLoading}
          className="w-full py-2.5 px-4 bg-rose-600 hover:bg-rose-500 active:scale-[0.99] transition-all text-white font-bold text-base rounded-xl flex items-center justify-center gap-2 shadow-md uppercase tracking-wide cursor-pointer"
        >
          {isLoading ? (
            <span className="animate-spin text-xl">↻</span>
          ) : (
            <>
              <Square className="w-5 h-5 fill-white" />
              <span>FINALIZAR UNIDADE</span>
            </>
          )}
        </button>
      </div>
    );
  }

  // Caso 2: Verificar se todo o lote já foi concluído nesta etapa
  // A mensagem "LOTE 100% CONCLUÍDO NESTE SETOR" só pode ser renderizada se a etapa de fato foi finalizada
  const etapaKey = order.etapas ? Object.keys(order.etapas).find(k => matchStepName(k, matchedStep)) : undefined;
  const etapaState = etapaKey && order.etapas ? order.etapas[etapaKey] : undefined;

  const isActuallyConcluded = etapaState
    ? etapaState.status === 'CONCLUIDO'
    : (stepEval.finishedApontamentos.length > 0 && stepEval.finalizadas >= totalPhysicalUnits);

  if (isActuallyConcluded) {
    return (
      <div className="w-full bg-[#0e131f] border border-emerald-500/40 rounded-xl p-3 text-center shadow-md shrink-0 mt-auto">
        <CheckCircle2 className="w-5 h-5 text-emerald-400 mx-auto mb-1 inline" />
        <span className="text-sm font-bold text-white ml-2">
          LOTE 100% CONCLUÍDO NESTE SETOR ({totalPhysicalUnits} PEÇAS)
        </span>
      </div>
    );
  }

  // Caso 3: Início de Lote ou Próxima Unidade
  const nextUnitNumber = stepEval.nextUnitNumber;
  const routeValidation = selectedSector ? validarPostoIndustrial(order, selectedSector, apontamentos, currentTerminal.id) : { valido: true };
  const isUnblocked = stepEval.canStartNextUnit && routeValidation.valido;
  const blockingMessage = !routeValidation.valido
    ? routeValidation.motivo
    : stepEval.blockingReason || (stepEval.previousStepName ? `Aguardando etapa anterior (${stepEval.previousStepName})` : 'Bloqueado');

  // RENDERIZAÇÃO PARA ITENS EM LOTE (ESTADO 1: PENDENTE)
  if (isBatch) {
    return (
      <div className="w-full bg-[#0e131f] border border-slate-700/80 rounded-xl p-2.5 shadow-md shrink-0 mt-auto">
        <div className="flex items-center justify-between mb-2 text-xs font-mono">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
            PASSO 3: APONTAMENTO DO LOTE COMPLETO
          </span>
          <span className="text-emerald-400 font-bold">
            {totalPhysicalUnits} PEÇAS · {selectedSector}
          </span>
        </div>

        {/* Toggle Universal de Envio ao Laser antes da Dobra */}
        {isCorteSector && isUnblocked && (
          <div
            onClick={handleToggleLaser}
            className={`mb-2.5 px-3 py-2 rounded-lg border flex items-center justify-between gap-2.5 cursor-pointer select-none transition-all ${
              sendToLaser
                ? 'bg-orange-950/40 border-orange-500/70 text-orange-200 shadow-sm'
                : 'bg-slate-900/90 border-slate-700/80 text-slate-400 hover:border-slate-600'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <input
                type="checkbox"
                id="send-to-laser-toggle-batch"
                checked={sendToLaser}
                onChange={() => {}}
                className="w-4 h-4 rounded text-orange-500 accent-orange-500 cursor-pointer"
              />
              <label htmlFor="send-to-laser-toggle-batch" className="text-xs font-mono font-medium cursor-pointer">
                <span>Enviar peça para o Laser antes da Dobra?</span>{' '}
                <span className="text-[11px] text-slate-500">(Furação / Recorte / Detalhe)</span>
              </label>
            </div>
            {sendToLaser && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-500/20 text-orange-300 border border-orange-500/30 font-mono shrink-0">
                🔥 Requer Laser
              </span>
            )}
          </div>
        )}

        {!isUnblocked ? (
          <button
            disabled
            onClick={() => playBlockedError()}
            className="w-full py-2.5 px-4 bg-slate-800/80 border border-slate-700 text-slate-400 font-bold text-base rounded-xl cursor-not-allowed flex items-center justify-center gap-2 opacity-70"
          >
            <Lock className="w-5 h-5 text-slate-500" />
            <span>{blockingMessage}</span>
          </button>
        ) : (
          <button
            onClick={async () => {
              playClick();
              if (isCorteSector) {
                await updateProductionOrder(order.op_numero, { requer_laser: sendToLaser });
              }
              if (onStartBatch) {
                onStartBatch(matchedStep, totalPhysicalUnits);
              } else {
                onStartUnit(1, matchedStep);
              }
            }}
            disabled={isLoading}
            className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] transition-all text-white font-bold text-base rounded-xl flex items-center justify-center gap-2 shadow-md uppercase tracking-wide cursor-pointer"
          >
            {isLoading ? (
              <span className="animate-spin text-xl">↻</span>
            ) : (
              <>
                <Play className="w-5 h-5 fill-current" />
                <span>INICIAR LOTE ({totalPhysicalUnits} PEÇAS)</span>
              </>
            )}
          </button>
        )}
      </div>
    );
  }

  // RENDERIZAÇÃO PARA ITENS UNITÁRIOS (PEÇA A PEÇA)
  return (
    <div className="w-full bg-[#0e131f] border border-slate-700/80 rounded-xl p-2.5 shadow-md shrink-0 mt-auto">
      <div className="flex items-center justify-between mb-2 text-xs font-mono">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
          PASSO 3: APONTAMENTO DA UNIDADE
        </span>
        <span className="text-blue-300 font-bold">
          Unidade {nextUnitNumber} de {totalPhysicalUnits} ({selectedSector})
        </span>
      </div>

      {/* Toggle Universal de Envio ao Laser antes da Dobra */}
      {isCorteSector && isUnblocked && (
        <div
          onClick={handleToggleLaser}
          className={`mb-2.5 px-3 py-2 rounded-lg border flex items-center justify-between gap-2.5 cursor-pointer select-none transition-all ${
            sendToLaser
              ? 'bg-orange-950/40 border-orange-500/70 text-orange-200 shadow-sm'
              : 'bg-slate-900/90 border-slate-700/80 text-slate-400 hover:border-slate-600'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <input
              type="checkbox"
              id="send-to-laser-toggle-unit"
              checked={sendToLaser}
              onChange={() => {}}
              className="w-4 h-4 rounded text-orange-500 accent-orange-500 cursor-pointer"
            />
            <label htmlFor="send-to-laser-toggle-unit" className="text-xs font-mono font-medium cursor-pointer">
              <span>Enviar peça para o Laser antes da Dobra?</span>{' '}
              <span className="text-[11px] text-slate-500">(Furação / Recorte / Detalhe)</span>
            </label>
          </div>
          {sendToLaser && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-500/20 text-orange-300 border border-orange-500/30 font-mono shrink-0">
              🔥 Requer Laser
            </span>
          )}
        </div>
      )}

      {!isUnblocked ? (
        <button
          disabled
          onClick={() => playBlockedError()}
          className="w-full py-2.5 px-4 bg-slate-800/80 border border-slate-700 text-slate-400 font-bold text-base rounded-xl cursor-not-allowed flex items-center justify-center gap-2 opacity-70"
        >
          <Lock className="w-5 h-5 text-slate-500" />
          <span>{!routeValidation.valido ? routeValidation.motivo : `Aguardando término da Unidade ${nextUnitNumber} no setor anterior`}</span>
        </button>
      ) : (
        <button
          onClick={async () => {
            playClick();
            if (isCorteSector) {
              await updateProductionOrder(order.op_numero, { requer_laser: sendToLaser });
            }
            onStartUnit(nextUnitNumber, matchedStep);
          }}
          disabled={isLoading}
          className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] transition-all text-white font-bold text-base rounded-xl flex items-center justify-center gap-2 shadow-md uppercase tracking-wide cursor-pointer"
        >
          {isLoading ? (
            <span className="animate-spin text-xl">↻</span>
          ) : (
            <>
              <Play className="w-5 h-5 fill-current" />
              <span>INICIAR UNIDADE</span>
            </>
          )}
        </button>
      )}
    </div>
  );
};
