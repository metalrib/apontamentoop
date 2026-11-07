import React, { useState, useEffect } from 'react';
import { TerminalConfig, ProductionOrder, Apontamento } from '../types/mes';
import { POSTOS_POR_TERMINAL } from '../data/terminais';
import {
  findStepForSector,
  getRouteForOp,
  getRouteEvaluation,
  isAncoraOrder,
  obterQuantidadeTotal,
  validarPostoIndustrial,
  etapaPertenceARota
} from '../utils/routeEngine';
import { updateProductionOrder, verificarECorrigirRotaOp } from '../services/mesStorage';
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
  order: propOrder,
  apontamentos,
  selectedSector,
  onSelectSector
}) => {
  const order = verificarECorrigirRotaOp(propOrder);
  const [blockedWarning, setBlockedWarning] = useState<string | null>(null);
  const qtdTotal = obterQuantidadeTotal(order);

  // DETERMINAÇÃO DE ROTAS PERMITIDAS (MATRIZ OFICIAL METALRIB)
  const routeData = getRouteForOp(order);
  const steps = routeData.steps;

  const evaluation = getRouteEvaluation(order, apontamentos, steps);

  const isAncora = isAncoraOrder(order);
  const isTerminal5 = terminal.id === 5;

  const termKey = `T${terminal.id}` as keyof typeof POSTOS_POR_TERMINAL;
  const rawTerminalSectors = Array.isArray(terminal?.sectors) && terminal.sectors.length > 0
    ? terminal.sectors
    : (POSTOS_POR_TERMINAL[termKey] || []);
  const availableSectors = Array.from(new Set(rawTerminalSectors));

  // 1. Extração robusta da rota da OP (op.rota, op.etapas ou steps calculados)
  const rotaRaw = (order as any)?.rota ?? order?.etapas;
  const rotaOp: string[] = [];

  if (Array.isArray(rotaRaw) && rotaRaw.length > 0) {
    rotaOp.push(...rotaRaw);
  } else if (typeof rotaRaw === 'string' && rotaRaw.trim()) {
    rotaOp.push(...rotaRaw.split(/[➔\->,;|]/).map((s: string) => s.trim()).filter(Boolean));
  } else if (typeof (order as any)?.etapas === 'object' && (order as any)?.etapas !== null && !Array.isArray((order as any)?.etapas)) {
    rotaOp.push(...Object.keys((order as any).etapas));
  }

  // Complementa com as etapas calculadas da rota da OP
  if (Array.isArray(steps) && steps.length > 0) {
    steps.forEach((st) => {
      if (!rotaOp.includes(st)) {
        rotaOp.push(st);
      }
    });
  }

  const normalizar = (s: string) =>
    (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  // FILTRAR O PASSO 1 PARA MOSTRAR APENAS SETORES DA OP ATUAL (LIMPEZA VISUAL)
  // Setores que NÃO pertencem à rota da OP NÃO devem ser renderizados (nem mesmo com cadeado).
  // Nota: Montagem Porta Vai-Vem permanece visível no Terminal 5 (para Fábio/Nathan) e Terminal 4.
  const postosExibiveis = availableSectors.filter((setorTerminal) => {
    // Caso especial: Solda sob demanda para âncoras no Terminal 5
    if (isAncora && isTerminal5 && setorTerminal.includes('Solda')) return true;

    // 1. Funções técnicas oficiais de correspondência de etapa
    if (etapaPertenceARota(setorTerminal, rotaOp)) return true;
    if (findStepForSector(setorTerminal, rotaOp) !== null) return true;

    const setorNorm = normalizar(setorTerminal);

    // 2. Verifica se o setor do terminal existe dentro da rota cadastrada para esta OP
    return rotaOp.some((etapaRota) => {
      const etapaNorm = normalizar(etapaRota);
      if (etapaNorm === setorNorm) return true;

      // Equivalência para Vai-Vem (Montagem vs Preparação)
      if (etapaNorm.includes('vai vem') && setorNorm.includes('vai vem')) {
        if (etapaNorm.includes('prepar') || setorNorm.includes('prepar')) {
          return etapaNorm.includes('prepar') && setorNorm.includes('prepar');
        }
        if (
          (etapaNorm.includes('montagem') || etapaNorm.includes('finaliz')) &&
          (setorNorm.includes('montagem') || setorNorm.includes('finaliz'))
        ) {
          return true;
        }
      }

      // Equivalência para Portas Giratórias
      if (
        (etapaNorm.includes('girat') || etapaNorm.includes('giro')) &&
        (setorNorm.includes('girat') || setorNorm.includes('giro')) &&
        etapaNorm.includes('montagem') &&
        setorNorm.includes('montagem')
      ) {
        return true;
      }

      // Equivalência para Portas de Correr
      if (
        etapaNorm.includes('correr') &&
        setorNorm.includes('correr') &&
        etapaNorm.includes('montagem') &&
        setorNorm.includes('montagem')
      ) {
        return true;
      }

      // Equivalência para Gaxeta
      if (etapaNorm.includes('gaxeta') && setorNorm.includes('gaxeta')) {
        return true;
      }

      // Equivalência para Trilhos
      if (
        (etapaNorm.includes('corte') && etapaNorm.includes('trilho') && setorNorm.includes('corte') && setorNorm.includes('trilho')) ||
        (etapaNorm.includes('montagem') && etapaNorm.includes('trilho') && setorNorm.includes('montagem') && setorNorm.includes('trilho'))
      ) {
        return true;
      }

      return false;
    });
  });

  const validSectors = postosExibiveis.filter((s) => {
    if (isAncora && isTerminal5 && s.includes('Solda')) return true;
    const isStep = findStepForSector(s, steps) !== null;
    if (!isStep) return false;
    const v = validarPostoIndustrial(order, s, apontamentos, terminal.id);
    return v.valido;
  });

  // Isolamento estrito de contagem por posto de trabalho
  const postMatchStrict = (a: Apontamento, nomePosto: string): boolean => {
    const postNorm = normalizar(nomePosto);
    const aptSetorNorm = normalizar(a.setorFisico || a.setor || '');
    const aptEtapaNorm = normalizar(a.etapa_rota || a.etapaRota || '');

    // 1. Casamento direto por igualdade exata
    if (aptSetorNorm === postNorm || aptEtapaNorm === postNorm) return true;

    // 2. Regra Vai-Vem: SEPARA RIGOROSAMENTE Preparação de Montagem
    if (postNorm.includes('vai vem')) {
      const isPostPreparacao = postNorm.includes('prepar');
      const isPostMontagem = postNorm.includes('montag') || postNorm.includes('finaliz');

      const isAptPreparacao = aptSetorNorm.includes('prepar') || aptEtapaNorm.includes('prepar');
      const isAptMontagem =
        aptSetorNorm.includes('montag') ||
        aptSetorNorm.includes('finaliz') ||
        aptEtapaNorm.includes('montag') ||
        aptEtapaNorm.includes('finaliz');

      if (isPostPreparacao) {
        return isAptPreparacao && !isAptMontagem;
      }
      if (isPostMontagem) {
        return isAptMontagem && !isAptPreparacao;
      }
      return false;
    }

    // 3. Batentes: SEPARA Preparação de Injeção/Finalização
    if (postNorm.includes('batente')) {
      const isPostPrep = postNorm.includes('prepar');
      const isAptPrep = aptSetorNorm.includes('prepar') || aptEtapaNorm.includes('prepar');
      if (isPostPrep) return isAptPrep;
      const isPostInj = postNorm.includes('injec') || postNorm.includes('finaliz');
      const isAptInj =
        aptSetorNorm.includes('injec') ||
        aptSetorNorm.includes('finaliz') ||
        aptEtapaNorm.includes('injec') ||
        aptEtapaNorm.includes('finaliz');
      if (isPostInj) return isAptInj;
      return false;
    }

    // 4. Corte Alumínio vs Corte
    if (postNorm.includes('aluminio')) {
      return aptSetorNorm.includes('aluminio') || aptEtapaNorm.includes('aluminio');
    }
    if (postNorm === 'corte') {
      return (
        (aptSetorNorm === 'corte' || aptEtapaNorm === 'corte') &&
        !aptSetorNorm.includes('aluminio') &&
        !aptEtapaNorm.includes('aluminio') &&
        !aptSetorNorm.includes('trilho') &&
        !aptEtapaNorm.includes('trilho')
      );
    }

    // 5. Trilhos: SEPARA Corte de Montagem
    if (postNorm.includes('trilho')) {
      if (postNorm.includes('corte')) {
        return (
          (aptSetorNorm.includes('trilho') && aptSetorNorm.includes('corte')) ||
          (aptEtapaNorm.includes('trilho') && aptEtapaNorm.includes('corte'))
        );
      }
      if (postNorm.includes('montag')) {
        return (
          (aptSetorNorm.includes('trilho') && aptSetorNorm.includes('montag')) ||
          (aptEtapaNorm.includes('trilho') && aptEtapaNorm.includes('montag'))
        );
      }
      return false;
    }

    // 6. Demais
    if (aptEtapaNorm && aptEtapaNorm === postNorm) return true;
    if (aptSetorNorm && aptSetorNorm === postNorm) return true;

    return false;
  };

  // ISOLAMENTO DO CÁLCULO DA BADGE: calcula APENAS as peças concluídas no seu próprio posto
  const obterQtdConcluidaPorPosto = (nomePosto: string): number => {
    const postNorm = normalizar(nomePosto);

    // 1. Se os apontamentos estiverem separados por chaves de postos no objeto da OP:
    const opApts = (order as any)?.apontamentos;
    if (opApts && typeof opApts === 'object') {
      const chaveEncontrada = Object.keys(opApts).find((k) => {
        const kNorm = normalizar(k);
        if (kNorm === postNorm) return true;
        if (postNorm.includes('vai vem') && kNorm.includes('vai vem')) {
          if (postNorm.includes('prepar') && kNorm.includes('prepar')) return true;
          if (
            (postNorm.includes('montag') || postNorm.includes('finaliz')) &&
            (kNorm.includes('montag') || kNorm.includes('finaliz'))
          ) {
            return true;
          }
          return false;
        }
        return false;
      });

      const postoData = chaveEncontrada ? opApts[chaveEncontrada] : undefined;
      if (postoData) {
        if (postoData?.pecas && Array.isArray(postoData.pecas)) {
          return postoData.pecas.filter(
            (p: any) => p.status === 'concluida' || p.status === 'FINALIZADO' || p.concluida === true
          ).length;
        }
        if (typeof postoData?.qtdProduzida === 'number') {
          return postoData.qtdProduzida;
        }
        if (typeof postoData?.concluidas === 'number') {
          return postoData.concluidas;
        }
      }
    }

    // 2. Se houver uma lista única de peças na OP, filtre obrigatoriamente pelo posto/etapa:
    const opPecas = (order as any)?.pecas;
    if (Array.isArray(opPecas)) {
      const pecasDoPosto = opPecas.filter((p: any) => {
        const pPostoNorm = normalizar(p.posto || p.setor || p.etapa || '');
        const isSamePosto =
          pPostoNorm === postNorm ||
          (postNorm.includes('vai vem') &&
            pPostoNorm.includes('vai vem') &&
            ((postNorm.includes('prepar') && pPostoNorm.includes('prepar')) ||
              ((postNorm.includes('montag') || postNorm.includes('finaliz')) &&
                (pPostoNorm.includes('montag') || pPostoNorm.includes('finaliz')))));
        const isConcluida =
          p.status === 'concluida' || p.status === 'FINALIZADO' || p.concluida === true;
        return isSamePosto && isConcluida;
      });

      if (pecasDoPosto.length > 0) {
        return pecasDoPosto.length;
      }
    }

    // 3. Verificação no progressoPostos da OP
    const progPostos = (order as any)?.progressoPostos;
    if (progPostos && typeof progPostos === 'object') {
      const chaveProg = Object.keys(progPostos).find((k) => normalizar(k) === postNorm);
      if (chaveProg && typeof progPostos[chaveProg]?.concluidas === 'number') {
        return progPostos[chaveProg].concluidas;
      }
    }

    // 4. Verificação estrita nos apontamentos recebidos
    const aptsDoPosto = apontamentos.filter((a) => {
      if (a.op_numero !== order.op_numero && a.op !== order.op_numero) return false;
      const isConcluido = a.status === 'FINALIZADO' || a.status === 'CONCLUIDO';
      if (!isConcluido) return false;
      return postMatchStrict(a, nomePosto);
    });

    const finishedBatch = aptsDoPosto.find((a) => a.is_lote || a.unidade_numero === 0);
    const finishedUnits = aptsDoPosto.filter((a) => !a.is_lote && a.unidade_numero > 0);
    const uniqueUnits = new Set(finishedUnits.map((a) => a.unidade_numero));
    let totalApts = uniqueUnits.size;
    if (finishedBatch) {
      totalApts = Math.max(totalApts, finishedBatch.quantidade_lote || qtdTotal);
    }

    if (totalApts > 0) {
      return totalApts;
    }

    // 5. Fallback isolado via order.etapas (apenas se a chave casar rigorosamente)
    if (order.etapas && typeof order.etapas === 'object' && !Array.isArray(order.etapas)) {
      const etapaKey = Object.keys(order.etapas).find((k) => {
        const kNorm = normalizar(k);
        if (kNorm === postNorm) return true;
        if (postNorm.includes('vai vem') && kNorm.includes('vai vem')) {
          if (postNorm.includes('prepar') && kNorm.includes('prepar')) return true;
          if (
            (postNorm.includes('montag') || postNorm.includes('finaliz')) &&
            (kNorm.includes('montag') || kNorm.includes('finaliz'))
          ) {
            return true;
          }
          return false;
        }
        return false;
      });

      if (etapaKey) {
        const st = (order.etapas as Record<string, any>)[etapaKey];
        if (st && typeof st.concluidas === 'number' && st.concluidas > 0) {
          if (aptsDoPosto.length > 0 || st.status === 'CONCLUIDO') {
            return st.concluidas;
          }
        }
      }
    }

    return 0;
  };

  // Determina o setor a ser selecionado automaticamente (único compatível ou sequência da rota)
  const obterSetorAutoSelecao = (): string | null => {
    // 1. Apenas 1 setor exibível para este terminal: auto-seleciona diretamente
    if (postosExibiveis.length === 1) {
      return postosExibiveis[0];
    }

    // 2. Apenas 1 setor com validação industrial liberada no momento: auto-seleciona
    if (validSectors.length === 1) {
      return validSectors[0];
    }

    // 3. Seleção pela sequência da rota: busca a primeira etapa pendente que pertença a este terminal
    for (const step of steps) {
      const stepSector = postosExibiveis.find((sec) => {
        if (findStepForSector(sec, [step]) !== null) return true;
        return normalizar(sec) === normalizar(step);
      });

      if (stepSector) {
        const concluidas = obterQtdConcluidaPorPosto(stepSector);
        const isStepFinished = concluidas >= qtdTotal;
        const validCheck = validarPostoIndustrial(order, stepSector, apontamentos, terminal.id);

        if (!isStepFinished && validCheck.valido) {
          return stepSector;
        }
      }
    }

    // 4. Se houver setores válidos, seleciona o primeiro
    if (validSectors.length > 0) {
      return validSectors[0];
    }

    return null;
  };

  // Auto-seleciona se houver apenas 1 setor compatível ou na sequência correta da rota
  useEffect(() => {
    if (postosExibiveis.length === 0) return;

    // Se já houver um setor selecionado válido dentro dos exibíveis deste terminal, mantém a escolha
    if (selectedSector && postosExibiveis.includes(selectedSector)) {
      return;
    }

    const setorSugerido = obterSetorAutoSelecao();
    if (setorSugerido && selectedSector !== setorSugerido) {
      const isPendingSobDemanda =
        isAncora && isTerminal5 && setorSugerido.includes('Solda') && !order.requer_solda;
      if (!isPendingSobDemanda) {
        onSelectSector(setorSugerido);
      }
    }
  }, [
    order.op_numero,
    terminal.id,
    postosExibiveis.length,
    validSectors.length,
    selectedSector,
    onSelectSector,
    isAncora,
    isTerminal5,
    order.requer_solda
  ]);

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

      {postosExibiveis.length === 0 ? (
        <div className="p-3 text-center text-xs font-mono text-slate-400 bg-slate-950/40 rounded-xl border border-slate-800">
          Nenhum posto do {terminal.name} consta na rota desta OP ({order.op_numero}).
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
          {postosExibiveis.map((sector, idx) => {
            const matchedStep = findStepForSector(sector, steps);
            const isSobDemanda = isAncora && isTerminal5 && sector.includes('Solda');
            const isPartOfRoute = matchedStep !== null || isSobDemanda;
            const stepEval = matchedStep ? evaluation[matchedStep] : null;
            const isSelected = selectedSector === sector;
            const isLaserSector = sector.toLowerCase().includes('laser');
            const isLaserPending =
              isLaserSector && Boolean(order.requer_laser) && (!stepEval || stepEval.finalizadas < qtdTotal);

            // Validação estrita de rotas industriais especiais
            const routeValidation = validarPostoIndustrial(order, sector, apontamentos, terminal.id);
            const isBlockedByRouteRule = !routeValidation.valido;

            // Contagem isolada estritamente por posto de trabalho
            const qtdConcluidaPosto = obterQtdConcluidaPorPosto(sector);

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
                    🔥 {qtdConcluidaPosto}/{qtdTotal}
                  </span>
                ) : isPartOfRoute ? (
                  <span className="text-[10px] text-slate-400 font-mono shrink-0 ml-1.5">
                    {qtdConcluidaPosto}/{qtdTotal}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
