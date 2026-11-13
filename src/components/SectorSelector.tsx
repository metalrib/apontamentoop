import React, { useState, useEffect } from 'react';
import { TerminalConfig, ProductionOrder, Apontamento, isOfficeDoorCorrer, isOfficeDoorGiro } from '../types/mes';
import { POSTOS_POR_TERMINAL } from '../data/terminais';
import {
  findStepForSector,
  getRouteForOp,
  getRouteEvaluation,
  isAncoraOrder,
  obterQuantidadeTotal,
  validarPostoIndustrial,
  etapaPertenceARota,
  matchStepName,
  isVaiVemOrder,
  isBatente,
  isTrilhoCorrer,
  isEstanteCompleta,
  isQuadroEstante,
  isPeEstanteSemPintura,
  isPeEstanteComPintura,
  isAbrigoDoca
} from '../utils/routeEngine';
import { updateProductionOrder, verificarECorrigirRotaOp, fetchTerminalsConfig } from '../services/mesStorage';
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
  const [, setSectorsVersion] = useState(0);

  // Escuta atualizações de configuração de terminais e setores via Socket.io / Eventos locais
  useEffect(() => {
    const handleSectorsChange = () => {
      setSectorsVersion((v) => v + 1);
    };
    window.addEventListener('metalrib_sectors_updated', handleSectorsChange);
    return () => {
      window.removeEventListener('metalrib_sectors_updated', handleSectorsChange);
    };
  }, []);

  const qtdTotal = obterQuantidadeTotal(order);

  // DETERMINAÇÃO DE ROTAS PERMITIDAS (MATRIZ OFICIAL METALRIB)
  const routeData = getRouteForOp(order);
  const steps = routeData.steps;

  const evaluation = getRouteEvaluation(order, apontamentos, steps);

  const isAncora = isAncoraOrder(order);
  const isTerminal5 = terminal.id === 5;

  // Consulta DINÂMICA da lista de setores configurados para o terminal ativo (SQLite / localStorage)
  const dynamicTerminals = fetchTerminalsConfig();
  const activeTerminalConfig = dynamicTerminals.find((t) => t.id === terminal?.id) || terminal;
  const rawTerminalSectors = (Array.isArray(activeTerminalConfig?.sectors)
    ? activeTerminalConfig.sectors
    : (Array.isArray(terminal?.sectors) ? terminal.sectors : [])
  ).map((s: string) => {
    const st = String(s || '').trim();
    return (st.toLowerCase() === 'preparação de folhas' || st.toLowerCase() === 'preparacao de folhas')
      ? 'Preparação de Folha'
      : st;
  });
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

  const isLaserRequerido = Boolean(order.requer_laser || (order as any).requerLaser);
  const sectorsToProcess = [...availableSectors];
  if (terminal.id === 1 && isLaserRequerido) {
    if (!sectorsToProcess.some(s => s.toLowerCase().includes('laser'))) {
      const corteIdx = sectorsToProcess.findIndex(s => s.toLowerCase().includes('corte'));
      if (corteIdx >= 0) {
        sectorsToProcess.splice(corteIdx + 1, 0, 'Laser');
      } else {
        sectorsToProcess.unshift('Laser');
      }
    }
  }

  // FILTRAR O PASSO 1 PARA MOSTRAR APENAS SETORES DA OP ATUAL (LIMPEZA VISUAL)
  // Setores que NÃO pertencem à rota da OP NÃO devem ser renderizados (nem mesmo com cadeado).
  const isOdCorrer = isOfficeDoorCorrer(order);
  const isOdGiro = isOfficeDoorGiro(order);
  const isOpOffice = isOdCorrer || isOdGiro || String(order.descricao || order.produto || '').toUpperCase().includes('OFFICE');
  const isOpVaiVem = isVaiVemOrder(order);
  const isOpBatente =
    isBatente(order) ||
    order.tipoOrdem === 'Batente' ||
    order.tipo === 'Batente' ||
    String(order.familia || '').toUpperCase().includes('BATENTE') ||
    String(order.descricao || order.produto || '').toUpperCase().startsWith('BAT ') ||
    String(order.descricao || order.produto || '').toUpperCase().startsWith('BAT-') ||
    String(order.descricao || order.produto || '').toUpperCase().startsWith('BAT_') ||
    String(order.descricao || order.produto || '').toUpperCase().startsWith('BATENTE') ||
    String(order.descricao || order.produto || '').toUpperCase().includes('BATENTE') ||
    (String(order.codigo || (order as any).codigoProduto || '').startsWith('020.') &&
      !String(order.descricao || order.produto || '').toUpperCase().startsWith('FOLHA') &&
      !String(order.descricao || order.produto || '').toUpperCase().includes('FOLHA'));

  // Se a OP for Batente, expurga compulsoriamente qualquer etapa indevida de folha ou montagem de portas de rotaOp
  if (isOpBatente) {
    for (let i = rotaOp.length - 1; i >= 0; i--) {
      const rNorm = normalizar(rotaOp[i]);
      if (rNorm.includes('folha') || rNorm.includes('gaxeta') || (rNorm.includes('montagem') && !rNorm.includes('batente'))) {
        rotaOp.splice(i, 1);
      }
    }
  }
  const isOpTrilho = isTrilhoCorrer(order);
  const isOpEstante = isEstanteCompleta(order) || isQuadroEstante(order) || isPeEstanteSemPintura(order) || isPeEstanteComPintura(order);
  const isOpAbrigo = isAbrigoDoca(order);

  const postosExibiveis = sectorsToProcess.filter((setorTerminal) => {
    const setorNorm = normalizar(setorTerminal);

    // 1. ISOLAMENTO ESTRITO ENTRE FAMÍLIAS DE PRODUTO:
    // Se a OP NÃO é Office Door, nenhum setor de Office Door pode ser exibido
    if (!isOpOffice && setorNorm.includes('office')) {
      return false;
    }
    // Se a OP É Office Door:
    if (isOpOffice) {
      if (isOdGiro) {
        if (
          setorNorm.includes('correr') ||
          setorNorm.includes('corte aluminio') ||
          setorNorm.includes('preparacao office door correr') ||
          setorNorm.includes('montagem office de correr') ||
          setorNorm.includes('montagem office door correr') ||
          setorNorm.includes('montagem de portas giratoria padrao e especial') ||
          (!setorNorm.includes('office') && (setorNorm.includes('porta') || setorNorm.includes('giro')))
        ) {
          return false;
        }
      } else if (isOdCorrer) {
        if (
          setorNorm.includes('giro') ||
          setorNorm.includes('girat') ||
          setorNorm.includes('dobra') ||
          setorNorm.includes('laser') ||
          setorNorm.includes('gaxeta') ||
          setorNorm.includes('montagem de office door giro') ||
          (!setorNorm.includes('office') && (setorNorm.includes('porta') || setorNorm.includes('correr')))
        ) {
          return false;
        }
      }
    }

    // Se a OP NÃO é Vai-Vem, nenhum setor de Vai-Vem pode ser exibido
    if (!isOpVaiVem && (setorNorm.includes('vai vem') || setorNorm.includes('vv'))) {
      return false;
    }
    if (isOpVaiVem && (setorNorm.includes('office') || (setorNorm.includes('montagem') && !setorNorm.includes('vai vem')))) {
      return false;
    }

    // Se a OP NÃO é Batente, nenhum setor de Batente pode ser exibido
    if (!isOpBatente && setorNorm.includes('batente')) {
      return false;
    }
    if (isOpBatente && (
      setorNorm.includes('folha') ||
      setorNorm.includes('gaxeta') ||
      setorNorm.includes('office') ||
      setorNorm.includes('vai vem') ||
      (setorNorm.includes('montagem') && !setorNorm.includes('batente'))
    )) {
      return false;
    }

    // Se a OP NÃO é Trilho, nenhum setor de Trilho pode ser exibido
    if (!isOpTrilho && setorNorm.includes('trilho')) {
      return false;
    }

    // Se a OP NÃO é Estante, nenhum setor de Estante pode ser exibido
    if (!isOpEstante && setorNorm.includes('estante')) {
      return false;
    }

    // Se a OP NÃO é Abrigo, nenhum setor de Abrigo pode ser exibido
    if (!isOpAbrigo && setorNorm.includes('abrigo')) {
      return false;
    }

    // Caso especial: Solda sob demanda para âncoras no Terminal 5
    if (isAncora && isTerminal5 && setorTerminal.includes('Solda')) return true;

    // Caso especial: Laser no Terminal 1 quando a OP requer laser
    const isLaser = setorTerminal.toLowerCase().includes('laser');
    if (isLaser && isLaserRequerido) return true;

    // 2. CORRESPONDÊNCIA COM A ROTA DA OP
    // Apenas renderizar se o setor pertencer a alguma etapa real da rota da OP
    const matched = findStepForSector(setorTerminal, steps) || findStepForSector(setorTerminal, rotaOp);
    if (matched !== null) {
      return true;
    }

    if (steps.some((st) => normalizar(st) === setorNorm) || rotaOp.some((st) => normalizar(st) === setorNorm)) {
      return true;
    }

    // Equivalências explícitas para etapas de Batente no Terminal 3:
    if (isOpBatente) {
      const isSetorPrepBat = setorNorm.includes('preparacao') && setorNorm.includes('batente');
      const isSetorInjFinBat = (setorNorm.includes('injecao') || setorNorm.includes('finalizacao')) && setorNorm.includes('batente');
      const rotaTemPrep = steps.some(st => normalizar(st).includes('preparacao')) || rotaOp.some(st => normalizar(st).includes('preparacao'));
      const rotaTemInjFin = steps.some(st => normalizar(st).includes('injecao') || normalizar(st).includes('finalizacao')) || rotaOp.some(st => normalizar(st).includes('injecao') || normalizar(st).includes('finalizacao'));

      if (isSetorPrepBat && rotaTemPrep) return true;
      if (isSetorInjFinBat && rotaTemInjFin) return true;
    }

    return false;
  });

  // No Terminal 1, garante a ordem oficial do fluxo produtivo: Corte -> Laser -> Dobra
  if (terminal.id === 1) {
    postosExibiveis.sort((a, b) => {
      const getPriority = (nome: string) => {
        const norm = (nome || '').toLowerCase();
        if (norm.includes('corte')) return 1;
        if (norm.includes('laser')) return 2;
        if (norm.includes('dobra')) return 3;
        return 99;
      };
      return getPriority(a) - getPriority(b);
    });
  }

  const validSectors = postosExibiveis.filter((s) => {
    if (isAncora && isTerminal5 && s.includes('Solda')) return true;
    if (s.toLowerCase().includes('laser') && Boolean(order.requer_laser || (order as any).requerLaser)) return true;
    const isStep = findStepForSector(s, steps) !== null || (isOpBatente && s.toLowerCase().includes('batente'));
    if (!isStep) return false;
    const v = validarPostoIndustrial(order, s, apontamentos, terminal.id);
    return v.valido;
  });

  // =========================================================================
  // CÁLCULO E SINCRONIZAÇÃO DE PROGRESSO DO POSTO (IDÊNTICO AO PORTAL DO PCP)
  // =========================================================================
  const calcularProgressoPosto = (etapa: any, op: any): string => {
    const total = Number(op.quantidadeFisica || op.quantidade || op.quantidade_total || etapa?.total || qtdTotal || 1);
    if (!etapa) return `0/${total}`;
    
    const statusNorm = String(etapa.status || '').toLowerCase().trim();
    if (statusNorm === 'concluido' || statusNorm === 'finalizado') {
      return `${total}/${total}`;
    }

    if (Array.isArray(etapa.pecas) && etapa.pecas.length > 0) {
      const prontas = etapa.pecas.filter(
        (p: any) =>
          p &&
          (String(p.status || '').toLowerCase() === 'concluido' ||
            String(p.status || '').toLowerCase() === 'concluida' ||
            String(p.status || '').toLowerCase() === 'finalizado' ||
            p.concluida === true)
      ).length;
      return `${prontas}/${total}`;
    }

    const produzidas = Number(
      etapa.quantidadeProduzida ?? etapa.concluidas ?? etapa.qtdProduzida ?? 0
    );
    return `${produzidas}/${total}`;
  };

  // Localiza os dados da etapa no objeto da OP, progressoPostos, apontamentos ou evaluation
  const obterEtapaDoPosto = (nomePosto: string, matchedStep?: string | null): any => {
    const postNorm = normalizar(nomePosto);
    const matchedNorm = matchedStep ? normalizar(matchedStep) : '';

    let etapaEncontrada: any = null;

    // 1. Procurar em order.etapas
    const etapas = (order as any)?.etapas;
    if (etapas) {
      if (Array.isArray(etapas)) {
        etapaEncontrada = etapas.find((e: any) => {
          if (!e) return false;
          if (typeof e === 'string') {
            return normalizar(e) === postNorm || (matchedNorm && normalizar(e) === matchedNorm);
          }
          const nameNorm = normalizar(e.nome || e.step || e.etapa || e.setor || '');
          return (
            nameNorm === postNorm ||
            (matchedNorm && nameNorm === matchedNorm) ||
            (matchedStep && matchStepName(e.nome || e.step || e.etapa || '', matchedStep)) ||
            matchStepName(e.nome || e.step || e.etapa || '', nomePosto)
          );
        });
        if (typeof etapaEncontrada === 'string') {
          etapaEncontrada = { nome: etapaEncontrada };
        }
      } else if (typeof etapas === 'object') {
        const chave = Object.keys(etapas).find((k) => {
          const kNorm = normalizar(k);
          return (
            kNorm === postNorm ||
            (matchedNorm && kNorm === matchedNorm) ||
            (matchedStep && matchStepName(k, matchedStep)) ||
            matchStepName(k, nomePosto)
          );
        });
        if (chave && etapas[chave]) {
          etapaEncontrada =
            typeof etapas[chave] === 'object' ? { ...etapas[chave] } : { status: etapas[chave] };
        }
      }
    }

    // 2. ProgressoPostos da OP
    const progPostos = (order as any)?.progressoPostos;
    if (progPostos && typeof progPostos === 'object') {
      const chaveProg = Object.keys(progPostos).find((k) => {
        const kNorm = normalizar(k);
        return (
          kNorm === postNorm ||
          (matchedNorm && kNorm === matchedNorm) ||
          (matchedStep && matchStepName(k, matchedStep)) ||
          matchStepName(k, nomePosto)
        );
      });
      if (chaveProg && progPostos[chaveProg]) {
        const pData = progPostos[chaveProg];
        etapaEncontrada = {
          ...etapaEncontrada,
          ...pData,
          status: pData.concluido ? 'concluido' : (etapaEncontrada?.status || pData.status),
          concluidas: pData.concluidas ?? etapaEncontrada?.concluidas,
          quantidadeProduzida: pData.concluidas ?? pData.quantidadeProduzida ?? etapaEncontrada?.quantidadeProduzida
        };
      }
    }

    // 3. Apontamentos indexados por posto na OP
    const opApts = (order as any)?.apontamentos;
    if (opApts && typeof opApts === 'object') {
      const chaveApts = Object.keys(opApts).find((k) => {
        const kNorm = normalizar(k);
        return (
          kNorm === postNorm ||
          (matchedNorm && kNorm === matchedNorm) ||
          (matchedStep && matchStepName(k, matchedStep)) ||
          matchStepName(k, nomePosto)
        );
      });
      if (chaveApts && opApts[chaveApts]) {
        const aData = opApts[chaveApts];
        etapaEncontrada = {
          ...etapaEncontrada,
          ...aData,
          pecas: aData.pecas || etapaEncontrada?.pecas
        };
      }
    }

    // 4. Integração com o motor oficial de avaliação de rota do PCP (evaluation)
    const targetStep = matchedStep || steps.find((s) => matchStepName(s, nomePosto) || normalizar(s) === postNorm);
    const evalResult = targetStep ? evaluation[targetStep] : null;
    if (evalResult) {
      const finalizadasEval = evalResult.finalizadas || 0;
      const isComplete = finalizadasEval >= qtdTotal;
      const etapaConcluidas = Number(etapaEncontrada?.concluidas ?? etapaEncontrada?.quantidadeProduzida ?? 0);
      const isPendente = etapaEncontrada?.status === 'PENDENTE' || etapaEncontrada?.status === 'pendente' || (order.status && order.status.startsWith('Aguardando Início'));

      const qtdProduzidaEfetiva = (isPendente && finalizadasEval === 0)
        ? 0
        : Math.max(etapaConcluidas, finalizadasEval);

      etapaEncontrada = {
        ...etapaEncontrada,
        total: qtdTotal,
        quantidadeProduzida: qtdProduzidaEfetiva,
        concluidas: qtdProduzidaEfetiva,
        status: isComplete
          ? 'concluido'
          : (qtdProduzidaEfetiva === 0 && isPendente ? 'pendente' : (etapaEncontrada?.status || (evalResult.emAndamento > 0 ? 'em_andamento' : 'pendente')))
      };
    }

    return etapaEncontrada;
  };

  // Retorna a quantidade numérica de peças concluídas no posto
  const obterQtdConcluidaPorPosto = (nomePosto: string): number => {
    const matchedStep = findStepForSector(nomePosto, steps);
    const etapa = obterEtapaDoPosto(nomePosto, matchedStep);
    const progresso = calcularProgressoPosto(etapa, order);
    const [prontasStr] = progresso.split('/');
    return Number(prontasStr) || 0;
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
        if (normalizar(sec) === normalizar(step)) return true;
        if (isOpBatente) {
          const sNorm = normalizar(sec);
          const stNorm = normalizar(step);
          if (sNorm.includes('preparacao') && sNorm.includes('batente') && stNorm.includes('preparacao')) return true;
          if (sNorm.includes('batente') && (sNorm.includes('injecao') || sNorm.includes('finalizacao')) && (stNorm.includes('injecao') || stNorm.includes('finalizacao'))) return true;
        }
        return false;
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
            const matchedStep =
              findStepForSector(sector, steps) ||
              (isOpBatente && normalizar(sector).includes('preparacao') && normalizar(sector).includes('batente')
                ? steps.find((s) => normalizar(s).includes('preparacao')) || null
                : isOpBatente && (normalizar(sector).includes('injecao') || normalizar(sector).includes('finalizacao')) && normalizar(sector).includes('batente')
                ? steps.find((s) => normalizar(s).includes('injecao') || normalizar(s).includes('finalizacao')) || null
                : null);
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

            // Contagem e progresso com a mesma lógica do Portal PCP
            const etapaObj = obterEtapaDoPosto(sector, matchedStep);
            const progressoTexto = calcularProgressoPosto(etapaObj, order);
            const qtdConcluidaPosto = obterQtdConcluidaPorPosto(sector);
            const isConcluido = qtdConcluidaPosto >= qtdTotal || progressoTexto.startsWith(`${qtdTotal}/${qtdTotal}`);

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
                  if (isLaserSector && !order.requer_laser) {
                    await updateProductionOrder(order.op_numero, { requer_laser: true });
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
                    : isConcluido
                    ? 'bg-emerald-950/20 border-emerald-500/30 hover:border-emerald-500/60 text-slate-200 cursor-pointer'
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
                      : isConcluido
                      ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
                      : qtdConcluidaPosto > 0
                      ? 'bg-amber-400 animate-pulse'
                      : isPartOfRoute
                      ? 'bg-blue-400/70'
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
                  <div className="flex items-center gap-1.5 shrink-0 ml-1.5">
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                        isConcluido
                          ? 'text-emerald-300 bg-emerald-950/60 border-emerald-400/50 font-bold'
                          : 'text-blue-100 bg-blue-900/60 border-blue-400/50 font-bold'
                      }`}
                    >
                      {progressoTexto}
                    </span>
                    <div className="w-4 h-4 rounded-full bg-blue-300 text-slate-950 flex items-center justify-center font-bold shadow-sm">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                  </div>
                ) : isSobDemanda && !order.requer_solda ? (
                  <span className="text-[10px] text-amber-400 font-mono shrink-0 ml-1.5">+Solda</span>
                ) : isLaserPending && stepEval ? (
                  <span className="text-[10px] text-orange-400 font-mono font-bold shrink-0 flex items-center gap-0.5 ml-1.5">
                    🔥 {progressoTexto}
                  </span>
                ) : isPartOfRoute ? (
                  <span
                    className={`text-[10px] font-mono shrink-0 ml-1.5 px-1.5 py-0.5 rounded border ${
                      isConcluido
                        ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30 font-bold'
                        : qtdConcluidaPosto > 0
                        ? 'text-amber-300 bg-amber-500/10 border-amber-500/30 font-semibold'
                        : 'text-slate-400 bg-slate-900/60 border-slate-800'
                    }`}
                  >
                    {progressoTexto}
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
