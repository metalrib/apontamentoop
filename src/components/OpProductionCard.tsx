import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { ProductionOrder, Apontamento } from '../types/mes';
import { calculateDeadlineInfo } from '../utils/nomusParser';
import { getRouteForOp, getRouteEvaluation, isAncoraOrder, obterQuantidadeTotal, obterEtapasDaRota } from '../utils/routeEngine';
import { classificarModeloOP } from '../utils/productClassifier';
import { updateProductionOrder, verificarECorrigirRotaOp, obterOcorrenciasDaOp, cancelarInicioEtapa, resetarOpCompleta, cleanOpId, formatOpNumber } from '../services/mesStorage';
import { playClick } from '../utils/audio';
import {
  ChevronDown,
  ChevronUp,
  Layers,
  ArrowRight,
  Monitor,
  Sparkles,
  CheckCircle2,
  Trash2,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';
import { OpOccurrenceModal } from './OpOccurrenceModal';

interface OpProductionCardProps {
  order?: ProductionOrder;
  op?: ProductionOrder;
  apontamentos?: Apontamento[];
  onOpenChat?: (order: ProductionOrder) => void;
  onSelectForTotem?: (opNumero: string) => void;
  onDelete?: (opNumero: string) => void;
  onResetOpCompleta?: (opNumero: string) => void;
}

export const OpProductionCard: React.FC<OpProductionCardProps> = React.memo(({
  order: propOrder,
  op: propOp,
  apontamentos = [],
  onSelectForTotem,
  onDelete,
  onResetOpCompleta
}) => {
  const op = verificarECorrigirRotaOp((propOrder || propOp)!);
  const order = op;

  // 1. FORÇAR CÁLCULO DINÂMICO DAS ETAPAS
  const etapasCalculadas = Array.isArray(op.rota) && op.rota.length >= 4 ? op.rota : obterEtapasDaRota(op);
  const totalEtapas = etapasCalculadas.length;
  const steps = etapasCalculadas;

  const [isExpanded, setIsExpanded] = useState(false);
  const [showOccurrenceModal, setShowOccurrenceModal] = useState(false);
  const ocorrencias = obterOcorrenciasDaOp(order);

  // Cálculo de Prazo e Atraso
  const deadline = calculateDeadlineInfo(order.data_entrega);

  // Rota e Badge de Linha Padrão vs Especial sob Medida
  const { rule } = getRouteForOp(order);
  const evaluation = getRouteEvaluation(order, apontamentos, etapasCalculadas);
  const isAncora = isAncoraOrder(order);
  const totalPhysicalUnits = obterQuantidadeTotal(order);
  const modeloProduto = classificarModeloOP(order);

  // Detecção de 100% Concluída Geral calculada dinamicamente
  const isAllStepsFinished = totalEtapas > 0 && etapasCalculadas.every((s) => {
    const etapaState = (!Array.isArray(order.etapas) && typeof order.etapas === 'object') ? order.etapas?.[s] : undefined;
    const evalResult = evaluation[s];
    return (etapaState && etapaState.status === 'CONCLUIDO') || (evalResult && evalResult.finalizadas >= totalPhysicalUnits);
  });
  const isConcluidaGeral = order.status === 'FINALIZADA' || isAllStepsFinished;

  // Processo Atual (Em Andamento) vs Aguardando Próximo Setor
  const cleanOrderOp = (order.op_numero || order.numero || '').replace(/^(\s*OP\s*)+/i, '').replace(/[-_\s]/g, '').toUpperCase();
  const activeApt = apontamentos.find((a) => {
    if (a.status !== 'EM_ANDAMENTO') return false;
    const aOp = (a.op_numero || a.op || '').replace(/^(\s*OP\s*)+/i, '').replace(/[-_\s]/g, '').toUpperCase();
    return aOp === cleanOrderOp;
  });

  const activeEtapaEntry = (!activeApt && order.etapas && typeof order.etapas === 'object' && !Array.isArray(order.etapas))
    ? Object.entries(order.etapas).find(([_, val]: [string, any]) => {
        const st = String(val?.status || val || '').toUpperCase().trim();
        return st === 'EM_PRODUCAO' || st === 'EM_ANDAMENTO' || st === 'IN_PROGRESS';
      })
    : null;

  const activeStationName = activeApt
    ? (activeApt.setorFisico || activeApt.setor)
    : (order.postoAtivo || (activeEtapaEntry ? activeEtapaEntry[0] : null));

  const activeOperatorName = activeApt
    ? (activeApt.colaborador || activeApt.operador || 'Operador')
    : (order.operadorAtual || order.colaboradorIniciou || null);

  const hasActiveProcess = Boolean(activeApt || activeStationName);

  const nextWaitingStep = !isConcluidaGeral && !hasActiveProcess
    ? etapasCalculadas.find((s) => {
        const etapaState = (!Array.isArray(order.etapas) && typeof order.etapas === 'object') ? order.etapas?.[s] : undefined;
        const evalResult = evaluation[s];
        return !((etapaState && (etapaState.status === 'CONCLUIDO' || etapaState.status === 'FINALIZADO')) || (evalResult && evalResult.finalizadas >= totalPhysicalUnits));
      }) || etapasCalculadas[0]
    : null;

  // Regra Oficial do Seletor de Quantidade Física a Produzir:
  // Renderizado sempre que:
  // a) O código pertencer à família de Vai-Vem (011.0012, 011.0013, 011.0117, ou qualquer código iniciado por 011.); OU
  // b) A descrição contiver o termo DUPLA ou VAI VEM; OU
  // c) A quantidade total for igual a 1 e o usuário precisar definir a quantidade de folhas físicas (ex: 2 folhas); OU
  // d) O usuário desejar ajustar a quantidade física manualmente via botões [+] e [-].
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
    rule.keyword === 'PT VAI VEM' ||
    Boolean(order.familia?.toLowerCase().includes('vai e vem'));
  const isM2 = Boolean(order.unidade_medida === 'M²' || order.quantidade_m2);
  const m2Num = Number(order.quantidade_m2 ?? (order.unidade_medida === 'M²' ? (order.quantidade ?? order.quantidade_total) : 0));
  const isM2Fracionado = isM2 && m2Num > 0 && !Number.isInteger(m2Num);
  const isQtdUm = totalPhysicalUnits === 1 || order.quantidade === 1 || order.quantidade_total === 1;

  const showPhysicalQuantitySelector =
    isFamilia011 ||
    isFamilia010 ||
    isOfficeDoor ||
    isDupla ||
    isVaiVem ||
    isQtdUm ||
    isM2 ||
    isM2Fracionado ||
    order.quantidadeFisica !== undefined;

  // 1. FUNÇÃO LÓGICA DE ATUALIZAÇÃO DA QUANTIDADE FÍSICA
  const handleAlterarQuantidadeFisica = async (
    e: React.MouseEvent,
    targetOp: any,
    delta: number
  ) => {
    e.preventDefault();
    e.stopPropagation(); // Impede o card de abrir/fechar

    playClick();

    const qtdAtual = Number(targetOp.quantidadeFisica ?? obterQuantidadeTotal(targetOp) ?? targetOp.quantidade ?? 1);
    const novaQtd = Math.max(1, qtdAtual + delta);

    if (novaQtd === qtdAtual) return;

    const opKey = String(targetOp.id || targetOp.numero || targetOp.op_numero || '').replace(/^OP\s*/i, '').trim();
    if (!opKey) return;
    const opKeyWithPrefix = `OP ${opKey}`;

    try {
      // Sincroniza via mesStorage (local + Socket.io / SQLite)
      await updateProductionOrder(targetOp.op_numero || targetOp.numero || opKey, {
        quantidade_total: novaQtd,
        quantidade: novaQtd,
        quantidadeFisica: novaQtd,
        ...(isDupla ? { quantidadeFolhas: novaQtd, isDupla: true } : {})
      });
    } catch (error) {
      console.error("[PCP] Erro ao atualizar quantidade física:", error);
    }
  };

  const handleAdjustPhysicalQuantity = (delta: number) => {
    handleAlterarQuantidadeFisica({ preventDefault: () => {}, stopPropagation: () => {} } as any, op, delta);
  };

  // Controle de estorno / reset de etapa em andamento (PCP)
  const [stepToReset, setStepToReset] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState<boolean>(false);

  // Controle de reset da OP Completa (PCP)
  const [showResetAllModal, setShowResetAllModal] = useState<boolean>(false);
  const [isResettingAll, setIsResettingAll] = useState<boolean>(false);

  const handleConfirmResetStep = async () => {
    if (!stepToReset) return;
    setIsResetting(true);
    playClick();
    try {
      const cleanId = cleanOpId(order.op_numero || order.numero || (order as any).id || '');
      await cancelarInicioEtapa(cleanId, stepToReset);
    } catch (err) {
      console.error('Erro ao resetar etapa no PCP:', err);
    } finally {
      setIsResetting(false);
      setStepToReset(null);
    }
  };

  const handleConfirmResetOpCompleta = async () => {
    setIsResettingAll(true);
    playClick();
    try {
      const cleanId = cleanOpId(order.op_numero || order.numero || (order as any).id || '');
      const res = await resetarOpCompleta(cleanId);
      if (res.success && onResetOpCompleta) {
        onResetOpCompleta(order.op_numero || order.numero);
      }
    } catch (err) {
      console.error('Erro ao resetar OP completa no PCP:', err);
    } finally {
      setIsResettingAll(false);
      setShowResetAllModal(false);
    }
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
              {formatOpNumber(order.numero || order.op_numero)}
            </div>

            {isConcluidaGeral && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold font-mono bg-emerald-500/20 border border-emerald-500/60 text-emerald-300 shadow-sm">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>CONCLUÍDA GERAL (100%)</span>
              </span>
            )}
          </div>

          {/* Badges de Classificação: Linha Padrão/Especial + Modelo do Produto */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {(op.tipoOrdem || rule.badge) && (
              <span
                className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${
                  (op.tipoOrdem ? op.tipoOrdem.includes('Padrão') : rule.isStandardLine)
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                    : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                }`}
              >
                {op.tipoOrdem || rule.badge}
              </span>
            )}

            {modeloProduto && (
              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-blue-950/80 border border-blue-800/70 text-blue-300 font-mono">
                {modeloProduto}
              </span>
            )}
          </div>
        </div>

        {/* Canto direito: Badge com a quantidade e botão de excluir */}
        <div className="flex items-center gap-2 shrink-0">
          {showPhysicalQuantitySelector ? (
            <div className="bg-slate-950/90 border border-amber-500/50 px-3 py-1.5 rounded-xl flex flex-col items-center justify-center min-w-[72px] shadow-inner shrink-0">
              {order.quantidade_m2 ? (
                <span className="text-[11px] font-mono font-bold text-amber-400 leading-none">
                  {Number(order.quantidade_m2).toFixed(2)} M²
                </span>
              ) : (
                <span className="text-[10px] font-mono font-bold text-amber-400 uppercase leading-none">
                  {isDupla ? 'DUPLA' : isVaiVem ? 'VAI-VEM' : 'FÍSICA'}
                </span>
              )}
              <span className="text-xs font-black text-white font-mono leading-tight mt-1 whitespace-nowrap">
                {totalPhysicalUnits} {order.unidade_medida === 'UN' ? 'UN' : 'PC'}
              </span>
            </div>
          ) : (
            <div className="bg-slate-950/90 border border-blue-950 px-3 py-1.5 rounded-xl flex flex-col items-center justify-center min-w-[54px] shadow-inner shrink-0">
              <span className="text-xl font-black text-white font-mono leading-none">
                {totalPhysicalUnits}
              </span>
              <span className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider mt-0.5">
                {order.unidade_medida === 'UN' ? 'UN' : 'PC'}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              playClick();
              setShowResetAllModal(true);
            }}
            title="Resetar Ordem Completa (Voltar para Etapa 1)"
            className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/30 transition-colors flex items-center justify-center w-8 h-8 cursor-pointer active:scale-95 shrink-0"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(order.op_numero || order.numero);
              }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/30 transition-colors flex items-center justify-center w-8 h-8 cursor-pointer active:scale-95 shrink-0"
              title="Excluir esta OP"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
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
            {activeStationName ? (
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-blue-950/60 border border-blue-500/50 rounded-xl text-xs font-mono text-blue-200 shadow-sm">
                <div className="flex items-center gap-2 truncate">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-400 shrink-0" />
                  <span className="truncate">
                    <span className="font-extrabold text-blue-300">🔵 PROCESSO ATUAL:</span>{' '}
                    <strong className="text-white">{activeStationName}</strong>{' '}
                    {activeOperatorName && (
                      <span className="text-slate-400 text-[11px]">(Operador: <strong className="text-blue-100">{activeOperatorName}</strong>)</span>
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={isResetting}
                  onClick={(e) => {
                    e.stopPropagation();
                    playClick();
                    setStepToReset(
                      activeApt?.etapa_rota || activeApt?.setorFisico || activeApt?.setor || activeStationName
                    );
                  }}
                  className={`px-2 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 hover:text-rose-100 border border-rose-500/40 rounded-lg text-[10px] font-bold flex items-center gap-1 transition shrink-0 ${
                    isResetting ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer active:scale-95'
                  }`}
                  title="Resetar etapa em andamento (cancelar início acidental)"
                >
                  <RotateCcw className={`w-3.5 h-3.5 text-rose-400 ${isResetting ? 'animate-spin' : ''}`} />
                  <span>{isResetting ? 'Resetando...' : 'Resetar Etapa'}</span>
                </button>
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

        {/* Seletor rápido de quantidade física a produzir */}
        {showPhysicalQuantitySelector && (
          <div 
            className="mt-2.5 p-2 bg-slate-950/80 border border-amber-500/30 rounded-xl flex items-center justify-between gap-2 flex-wrap"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-[11px] font-mono text-slate-300 font-semibold select-none">
              Qtde Física a Produzir:
            </span>
            <div 
              className="flex items-center gap-2" 
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={(e) => handleAlterarQuantidadeFisica(e, op, -1)}
                disabled={(op.quantidadeFisica ?? totalPhysicalUnits ?? 1) <= 1}
                className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 active:scale-95 text-white font-bold border border-slate-600 transition-all select-none cursor-pointer"
                title="Diminuir peças físicas"
              >
                -
              </button>
              <span className="px-3 py-1 font-bold text-sm bg-slate-900 border border-slate-700 rounded text-amber-400 min-w-[36px] text-center select-none shadow-inner">
                {op.quantidadeFisica || totalPhysicalUnits || 1}
              </span>
              <button
                type="button"
                onClick={(e) => handleAlterarQuantidadeFisica(e, op, 1)}
                className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-bold border border-slate-600 transition-all select-none cursor-pointer"
                title="Aumentar peças físicas"
              >
                +
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3. FAIXA DE STATUS OPERACIONAL E EXPANSÃO */}
      <div className="mt-3 pt-3 border-t border-blue-950 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {/* Tag de Prazo/Alerta */}
          <span
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold font-mono border ${deadline.badgeClass}`}
          >
            {deadline.label}
          </span>

          {/* Badge de Ocorrências Registradas pelo Chão de Fábrica */}
          {ocorrencias.length > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                playClick();
                setShowOccurrenceModal(true);
              }}
              className="px-2.5 py-1 rounded-lg text-[11px] font-bold font-mono border bg-amber-500/15 border-amber-500/50 text-amber-300 hover:bg-amber-500/25 transition cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-95"
              title="Ver ocorrências registradas pelo chão de fábrica"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span>{ocorrencias.length} Ocorrência{ocorrencias.length > 1 ? 's' : ''}</span>
            </button>
          )}
        </div>

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

          {/* Ocorrências / Motivos de Atraso Registrados pelo Chão de Fábrica */}
          <div className="bg-slate-950/90 p-3 rounded-xl border border-amber-500/30 text-xs font-mono space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span>Ocorrências / Motivos de Atraso ({ocorrencias.length})</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  playClick();
                  setShowOccurrenceModal(true);
                }}
                className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 text-[10px] font-bold transition cursor-pointer"
              >
                + Registrar / Ver Histórico
              </button>
            </div>

            {ocorrencias.length === 0 ? (
              <p className="text-[11px] text-slate-500">Nenhuma ocorrência registrada para esta ordem de produção.</p>
            ) : (
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {ocorrencias.map((oc) => (
                  <div key={oc.id} className="p-2 bg-slate-900/80 rounded-lg border border-slate-800 text-[11px]">
                    <div className="flex items-center justify-between text-slate-400 text-[10px] mb-0.5">
                      <span className="font-bold text-amber-300">{oc.operador} • Posto: {oc.posto}</span>
                      <span>{new Date(oc.dataHora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} • {new Date(oc.dataHora).toLocaleDateString('pt-BR')}</span>
                    </div>
                    <p className="text-slate-200 whitespace-pre-wrap">{oc.descricao}</p>
                  </div>
                ))}
              </div>
            )}
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

          {/* Controle Universal de Envio ao Laser antes da Dobra (Terminal 1) */}
          <div className="bg-orange-950/20 border border-orange-500/30 p-2.5 rounded-xl flex items-center justify-between gap-3 text-xs font-mono">
            <div>
              <span className="text-orange-300 font-bold flex items-center gap-1.5">
                <span>🔥</span>
                Laser CNC (Terminal 1)
              </span>
              <span className="text-[10px] text-slate-400 block">
                {(order.requer_laser || (order as any).requerLaser) ? 'Etapa Laser inclusa na rota da OP' : 'Fluxo padrão sem Laser'}
              </span>
            </div>
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                playClick();
                const nextVal = !Boolean(order.requer_laser || (order as any).requerLaser);
                await updateProductionOrder(order.op_numero, {
                  requer_laser: nextVal,
                  requerLaser: nextVal
                } as any);
              }}
              className={`px-3 py-1.5 rounded-lg font-bold text-xs border transition cursor-pointer active:scale-95 whitespace-nowrap ${
                (order.requer_laser || (order as any).requerLaser)
                  ? 'bg-orange-500 text-slate-950 border-orange-400 shadow-md'
                  : 'bg-slate-900 hover:bg-slate-800 text-orange-300 border-orange-500/50'
              }`}
            >
              {(order.requer_laser || (order as any).requerLaser) ? '✓ Requer Laser' : '+ Ativar Laser'}
            </button>
          </div>

          {/* Resumo das Etapas da Rota */}
          <div className="space-y-1.5 bg-slate-950/60 p-3 rounded-xl border border-blue-950/60">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 font-semibold mb-1">
              <span className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-blue-400" />
                <span>AVANÇO NA ROTA DE PRODUÇÃO:</span>
              </span>
              <span className="text-slate-500 text-[10px]">{totalEtapas} etapas</span>
            </div>

            {/* Linha de Destaque antes da listagem das etapas */}
            {!isConcluidaGeral && (
              <div className="mb-2">
                {activeStationName ? (
                  <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-blue-950/80 border border-blue-500/40 rounded-lg text-xs font-mono text-blue-200">
                    <div className="flex items-center gap-2 truncate">
                      <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                      <span className="truncate">
                        <strong>🔵 PROCESSO ATUAL:</strong> {activeStationName}{' '}
                        {activeOperatorName && (
                          <span className="text-slate-400 text-[11px]">(Operador: {activeOperatorName})</span>
                        )}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={isResetting}
                      onClick={(e) => {
                        e.stopPropagation();
                        setStepToReset(
                          activeApt?.etapa_rota || activeApt?.setorFisico || activeApt?.setor || activeStationName
                        );
                      }}
                      className={`px-2 py-0.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 hover:text-rose-100 border border-rose-500/40 rounded text-[10px] font-bold flex items-center gap-1 transition shrink-0 ${
                        isResetting ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer active:scale-95'
                      }`}
                      title="Resetar etapa em andamento (cancelar início acidental)"
                    >
                      <RotateCcw className={`w-3 h-3 text-rose-400 ${isResetting ? 'animate-spin' : ''}`} />
                      <span>{isResetting ? 'Resetando...' : 'Resetar Etapa'}</span>
                    </button>
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
              {etapasCalculadas.map((step, idx) => {
                const evalResult = evaluation[step];
                const finalizadas = evalResult?.finalizadas || 0;
                const emAndamento = evalResult?.emAndamento || 0;
                const total = Math.max(1, Math.round(order.quantidade_total || 1));
                const isComplete = finalizadas >= total;
                const etapaObj = (!Array.isArray(order.etapas) && typeof order.etapas === 'object') ? order.etapas?.[step] : undefined;
                const etapaStatus = String(etapaObj?.status || etapaObj || '').toUpperCase().trim();
                const isStepActiveInEtapas = etapaStatus === 'EM_PRODUCAO' || etapaStatus === 'EM_ANDAMENTO' || etapaStatus === 'IN_PROGRESS';
                const isActive = emAndamento > 0 || isStepActiveInEtapas || Boolean(activeStationName && (activeStationName.toLowerCase().trim() === step.toLowerCase().trim()));
                const displayStep = (step.trim().toLowerCase() === 'preparação de folhas' || step.trim().toLowerCase() === 'preparacao de folhas')
                  ? 'Preparação de Folha'
                  : step;

                return (
                  <div
                    key={step}
                    className="flex items-center justify-between gap-2 text-xs font-mono px-2.5 py-1.5 rounded-lg bg-slate-900/80 border border-slate-800"
                  >
                    <span className="text-slate-300 truncate font-medium">
                      <span className="text-slate-500 mr-1.5">{idx + 1}.</span>
                      {displayStep}
                    </span>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isComplete ? (
                        <span className="text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                          {finalizadas}/{total} concluídas
                        </span>
                      ) : isActive ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[11px] font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
                            {finalizadas > 0 ? `${finalizadas}/${total} · ` : ''}{emAndamento > 0 ? `${emAndamento} em andamento` : 'em andamento'}
                          </span>
                          <button
                            type="button"
                            disabled={isResetting}
                            onClick={(e) => {
                              e.stopPropagation();
                              playClick();
                              setStepToReset(step);
                            }}
                            className={`px-1.5 py-0.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 hover:text-rose-100 border border-rose-500/40 rounded text-[10px] font-bold flex items-center gap-1 transition shrink-0 ${
                              isResetting ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer active:scale-95'
                            }`}
                            title={`Resetar etapa ${step} (cancelar início acidental)`}
                          >
                            <RotateCcw className={`w-3 h-3 text-rose-400 ${isResetting ? 'animate-spin' : ''}`} />
                            <span>{isResetting ? '...' : 'Resetar'}</span>
                          </button>
                        </div>
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

      <OpOccurrenceModal
        order={order}
        isOpen={showOccurrenceModal}
        onClose={() => setShowOccurrenceModal(false)}
      />

      {/* Modal de Confirmação para Resetar Etapa no PCP */}
      {stepToReset && typeof document !== 'undefined' && createPortal(
        <div
          onClick={(e) => {
            e.stopPropagation();
            setStepToReset(null);
          }}
          className="fixed inset-0 z-[99999] bg-slate-950/90 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#0f172a] border border-rose-500/50 rounded-2xl p-6 max-w-md w-full shadow-2xl animate-in fade-in zoom-in-95 duration-150 text-left"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400">
                <AlertTriangle className="w-6 h-6 text-rose-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white leading-snug">
                  Resetar Etapa
                </h3>
                <p className="text-xs text-slate-400 font-mono">
                  {formatOpNumber(order.numero || order.op_numero)} • {stepToReset}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed mb-6 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
              Deseja resetar a etapa <strong className="text-white">"{stepToReset}"</strong> desta OP? O início acidental deste posto será cancelado e o status retornará para <span className="text-amber-400 font-bold">Pendente</span>.
            </p>

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={isResetting}
                onClick={(e) => {
                  e.stopPropagation();
                  setStepToReset(null);
                }}
                className={`flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-xl transition ${
                  isResetting ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer'
                }`}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleConfirmResetStep();
                }}
                disabled={isResetting}
                className={`flex-1 py-2.5 px-4 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl transition shadow-lg flex items-center justify-center gap-2 uppercase tracking-wider ${
                  isResetting ? 'opacity-60 cursor-not-allowed pointer-events-none' : 'active:scale-[0.99] cursor-pointer'
                }`}
              >
                {isResetting ? (
                  <>
                    <RotateCcw className="w-4 h-4 animate-spin text-white" />
                    <span>Resetando...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-4 h-4" />
                    <span>Sim, Resetar</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modal de Confirmação para Resetar OP Completa no PCP */}
      {showResetAllModal && typeof document !== 'undefined' && createPortal(
        <div
          onClick={(e) => {
            e.stopPropagation();
            setShowResetAllModal(false);
          }}
          className="fixed inset-0 z-[99999] bg-slate-950/90 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#0f172a] border border-amber-500/50 rounded-2xl p-6 max-w-md w-full shadow-2xl animate-in fade-in zoom-in-95 duration-150 text-left"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
                <AlertTriangle className="w-6 h-6 text-amber-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white leading-snug">
                  Resetar Ordem Completa
                </h3>
                <p className="text-xs text-slate-400 font-mono">
                  {formatOpNumber(order.numero || order.op_numero)}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed mb-6 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
              Tem certeza que deseja resetar TODOS os apontamentos da OP <strong className="text-white">{formatOpNumber(order.numero || order.op_numero)}</strong>? Todas as etapas já concluídas ou em andamento voltarão para o status <span className="text-amber-400 font-bold">PENDENTE</span>.
            </p>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowResetAllModal(false);
                }}
                className="flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-xl transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleConfirmResetOpCompleta();
                }}
                disabled={isResettingAll}
                className="flex-1 py-2.5 px-4 bg-gradient-to-r from-amber-600 to-rose-600 hover:from-amber-500 hover:to-rose-500 active:scale-[0.99] text-white font-bold text-xs rounded-xl transition shadow-lg flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider"
              >
                {isResettingAll ? (
                  <span className="animate-spin text-sm">↻</span>
                ) : (
                  <>
                    <RotateCcw className="w-4 h-4" />
                    <span>SIM, RESETAR TUDO</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
});

export const StatusCard = OpProductionCard;
export default OpProductionCard;
