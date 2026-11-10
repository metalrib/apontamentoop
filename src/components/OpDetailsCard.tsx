import React, { useState } from 'react';
import { ProductionOrder, Apontamento, TerminalConfig } from '../types/mes';
import { getRouteForOp, getRouteEvaluation, findStepForSector, isAncoraOrder, obterQuantidadeTotal, obterEtapasDaRota } from '../utils/routeEngine';
import { calculateDeadlineInfo } from '../utils/nomusParser';
import { updateProductionOrder, verificarECorrigirRotaOp, obterOcorrenciasDaOp } from '../services/mesStorage';
import { playClick } from '../utils/audio';
import { CheckCircle2, Clock, Lock, Layers, Calendar, Tag, FileText, Hash, AlertCircle, Sparkles, AlertTriangle } from 'lucide-react';
import { OpOccurrenceModal } from './OpOccurrenceModal';

interface OpDetailsCardProps {
  order: ProductionOrder;
  apontamentos: Apontamento[];
  selectedSector: string | null;
  currentTerminal: TerminalConfig | null;
}

export const OpDetailsCard: React.FC<OpDetailsCardProps> = React.memo(({
  order: propOrder,
  apontamentos = [],
  selectedSector,
  currentTerminal
}) => {
  const [showOccurrenceModal, setShowOccurrenceModal] = useState(false);
  const safeApontamentos = Array.isArray(apontamentos) ? apontamentos : [];
  const order = verificarECorrigirRotaOp(propOrder);
  const ocorrencias = obterOcorrenciasDaOp(order);
  const qtdTotal = obterQuantidadeTotal(order);
  const { rule } = getRouteForOp(order);
  const steps = Array.isArray(order.rota) && order.rota.length >= 4 ? order.rota : obterEtapasDaRota(order);
  const evaluation = getRouteEvaluation(order, safeApontamentos, steps);

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
  const m2Num = Number(order.quantidade_m2 ?? (order.unidade_medida === 'M²' ? qtdTotal : 0));
  const isM2Fracionado = isM2 && m2Num > 0 && !Number.isInteger(m2Num);
  const isQtdUm = qtdTotal === 1 || order.quantidade === 1 || order.quantidade_total === 1;

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
    e.stopPropagation();

    playClick();

    const qtdAtual = Number(targetOp.quantidadeFisica || targetOp.quantidade || 1);
    const novaQtd = Math.max(1, qtdAtual + delta);

    if (novaQtd === qtdAtual) return;

    const opKey = String(targetOp.id || targetOp.numero || targetOp.op_numero || '').replace(/^OP\s*/i, '').trim();
    if (!opKey) return;
    const opKeyWithPrefix = `OP ${opKey}`;

    try {
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
    handleAlterarQuantidadeFisica({ preventDefault: () => {}, stopPropagation: () => {} } as any, order, delta);
  };

  return (
    <div className="w-full h-[44px] max-h-[44px] px-3 bg-slate-900 border border-slate-800 rounded-xl shadow-md flex items-center justify-between gap-2.5 text-xs font-mono shrink-0 select-none overflow-hidden">
      {/* Lado Esquerdo: Número da OP, Descrição, Código e Tags */}
      <div className="flex items-center gap-2 min-w-0">
        {/* Número da OP */}
        <div className="h-8 px-2.5 bg-[#1C2F8A] border border-blue-400/80 rounded-lg text-white font-mono font-black text-xs sm:text-sm tracking-wider shadow-sm shrink-0 flex items-center">
          {(order.numero || order.op_numero).replace(/^(\s*OP\s*)+/i, 'OP ').trim()}
        </div>

        {/* Descrição do Produto com truncate flexível */}
        <div className="text-white font-bold text-xs sm:text-sm truncate max-w-[200px] sm:max-w-xs md:max-w-md lg:max-w-lg font-sans leading-none" title={order.descricao}>
          {order.descricao}
        </div>

        {/* Código do Item */}
        <div className="hidden sm:inline-flex h-7 px-2 items-center rounded-md bg-slate-950 border border-slate-800 text-blue-300 font-mono text-[11px] shrink-0 leading-none">
          Cód: {order.codigo || '—'}
        </div>

        {/* Tag de Atraso ou Entrega */}
        {deadline.isDelayed ? (
          <span className="h-7 px-2 flex items-center rounded-md bg-red-950/80 text-red-400 border border-red-800 font-bold text-[10px] shrink-0 leading-none">
            {deadline.text}
          </span>
        ) : (
          <span className="hidden md:inline-flex h-7 px-2 flex items-center rounded-md bg-slate-950 text-slate-400 border border-slate-800 text-[10px] shrink-0 leading-none">
            Entrega: {deliveryDate}
          </span>
        )}

        {/* Badge de Linha Padrão / Sob Medida */}
        {(order.tipoOrdem || rule.badge) && (
          <span
            className={`hidden lg:inline-flex h-7 px-2 flex items-center rounded-md text-[10px] font-bold border shrink-0 leading-none ${
              (order.tipoOrdem ? order.tipoOrdem.includes('Padrão') : rule.isStandardLine)
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/60'
                : 'bg-amber-950/80 text-amber-300 border-amber-500/60'
            }`}
          >
            {order.tipoOrdem || rule.badge}
          </span>
        )}

        {/* Badge Requer Laser */}
        {order.requer_laser && (
          <span className="h-7 px-2 flex items-center rounded-md text-[10px] font-bold border shrink-0 bg-orange-950/80 text-orange-300 border-orange-500/60 font-mono gap-1 leading-none">
            <span>🔥 Laser</span>
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
            className={`h-7 px-2 rounded-md text-[10px] font-mono font-bold border flex items-center gap-1 shadow-sm transition cursor-pointer active:scale-95 shrink-0 leading-none ${
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

        {/* Botão Ocorrência no Cabeçalho da OP */}
        <button
          type="button"
          onClick={() => {
            playClick();
            setShowOccurrenceModal(true);
          }}
          className={`h-7 px-2 rounded-md text-[10px] font-mono font-bold border flex items-center gap-1 shadow-sm transition cursor-pointer active:scale-95 shrink-0 leading-none ${
            ocorrencias.length > 0
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/60'
              : 'bg-slate-950 text-slate-400 hover:text-amber-300 border-slate-800 hover:border-amber-500/40'
          }`}
          title="Registrar Ocorrência / Motivo de Atraso"
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden sm:inline">Ocorrência</span>
          {ocorrencias.length > 0 && (
            <span className="px-1 py-0.2 bg-amber-500/40 text-amber-200 rounded text-[9px] font-black">
              {ocorrencias.length}
            </span>
          )}
        </button>
      </div>

      {/* Lado Direito: Quantidade Total e Ajuste M² */}
      <div className="flex items-center gap-2 shrink-0">
        {showPhysicalQuantitySelector ? (
          <div className="h-8 px-2.5 bg-slate-950 border border-amber-500/60 rounded-lg flex items-center gap-1.5">
            {order.quantidade_m2 ? (
              <span className="text-[10px] font-bold text-amber-400">
                {Number(order.quantidade_m2).toFixed(1)} M²
              </span>
            ) : (
              <span className="text-[10px] font-bold text-amber-400 uppercase">
                {isDupla ? 'DUPLA' : isVaiVem ? 'VAI-VEM' : 'FÍSICA'}
              </span>
            )}
            <span className="text-white font-black text-sm">
              {qtdTotal} {order.unidade_medida === 'UN' ? 'UN' : 'PC'}
            </span>
            <div 
              className="flex items-center gap-1 pl-1 border-l border-slate-800"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={(e) => handleAlterarQuantidadeFisica(e, order, -1)}
                disabled={(order.quantidadeFisica || order.quantidade || qtdTotal || 1) <= 1}
                className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white font-bold text-xs flex items-center justify-center cursor-pointer transition active:scale-95"
                title="Diminuir peças físicas"
              >
                -
              </button>
              <button
                type="button"
                onClick={(e) => handleAlterarQuantidadeFisica(e, order, 1)}
                className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center justify-center cursor-pointer transition active:scale-95"
                title="Aumentar peças físicas"
              >
                +
              </button>
            </div>
          </div>
        ) : (
          <div className="h-8 px-2.5 bg-slate-950 border border-slate-800 rounded-lg flex items-center gap-1.5">
            <span className="text-slate-400 text-[10px] font-bold">QTDE:</span>
            <span className="text-white font-black text-sm">
              {qtdTotal}
            </span>
            <span className="text-slate-300 text-[10px]">
              {order.unidade_medida === 'UN' ? 'UN' : (unitBadge === 'M²' ? 'PC' : (unitBadge || 'PC'))}
            </span>
          </div>
        )}
      </div>

      <OpOccurrenceModal
        order={order}
        selectedOperator={null}
        selectedSector={selectedSector}
        currentTerminal={currentTerminal}
        isOpen={showOccurrenceModal}
        onClose={() => setShowOccurrenceModal(false)}
      />
    </div>
  );
});

export default OpDetailsCard;

