import React, { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue } from 'react';
import { TerminalConfig, ProductionOrder, Apontamento, TERMINALS } from './types/mes';
import {
  fetchProductionOrders,
  fetchApontamentos,
  getSavedTerminalId,
  saveTerminalId,
  startUnit,
  finishUnit,
  startBatch,
  finishBatch,
  cancelarInicioEtapa,
  subscribeToMesUpdates,
  fetchTerminalsConfig,
  TEST_DUMMY_OPS,
  verificarECorrigirRotaOp,
  cleanOpId,
  formatOpNumber,
  getLocalSocket,
  purgeLocalAppointmentsForOp,
  isLocalApiActive,
  saveOperators,
  fetchLocalColaboradores
} from './services/mesStorage';
import { formatarNumeroOP } from './utils/nomusParser';
import { ActiveBatchItem } from './components/ActiveBatchesPanel';
import { Header } from './components/Header';
import { TerminalSelector } from './components/TerminalSelector';
import { BarcodeScannerInput } from './components/BarcodeScannerInput';
import { OpDetailsCard } from './components/OpDetailsCard';
import { SectorSelector } from './components/SectorSelector';
import { OperatorSelector } from './components/OperatorSelector';
import { ProductionAction } from './components/ProductionAction';
import { AutoCleanToast } from './components/AutoCleanToast';
import { SupervisorDashboard } from './components/SupervisorDashboard';
import { PcpPortal } from './components/PcpPortal';
import { MobilePcpTracker } from './components/MobilePcpTracker';
import { ErrorBoundary } from './components/ErrorBoundary';
import { getRouteForOp, findStepForSector, isAncoraOrder, obterQuantidadeTotal, initOrSyncOrderEtapas, validarPostoIndustrial } from './utils/routeEngine';
import { playSuccessStart, playSuccessFinish, playBlockedError, playClick } from './utils/audio';
import { Lock, Shield, KeyRound } from 'lucide-react';

export default function App() {
  // Terminal Físico Ativo
  const [currentTerminal, setCurrentTerminal] = useState<TerminalConfig | null>(() => {
    const list = fetchTerminalsConfig();
    const savedId = getSavedTerminalId();
    if (savedId) {
      return list.find(t => t.id === savedId) || list[0] || TERMINALS[0];
    }
    return list[0] || TERMINALS[0]; // Padrão: Terminal 1
  });
  const [showTerminalModal, setShowTerminalModal] = useState<boolean>(false);
  const showTerminalModalRef = useRef<boolean>(false);
  showTerminalModalRef.current = showTerminalModal;

  // Zero-Downtime: Controle de Auto-Atualização Segura do Frontend
  const [atualizacaoPendente, setAtualizacaoPendente] = useState<boolean>(false);
  const atualizacaoPendenteRef = useRef<boolean>(false);
  atualizacaoPendenteRef.current = atualizacaoPendente;

  // Dados da Fábrica (Sincronizados em tempo real)
  const [orders, setOrders] = useState<Record<string, ProductionOrder>>({});
  const [apontamentos, setApontamentos] = useState<Apontamento[]>([]);

  // Estado do Totem no Chão de Fábrica (guardando apenas o ID da OP selecionada para evitar loops de render)
  const [selectedOpNumber, setSelectedOpNumber] = useState<string | null>(null);
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [selectedOperator, setSelectedOperator] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Referências síncronas para validação em listeners do Socket.io (evita closures desatualizadas)
  const selectedOpNumberRef = useRef<string | null>(selectedOpNumber);
  selectedOpNumberRef.current = selectedOpNumber;
  const selectedSectorRef = useRef<string | null>(selectedSector);
  selectedSectorRef.current = selectedSector;
  const selectedOperatorRef = useRef<string | null>(selectedOperator);
  selectedOperatorRef.current = selectedOperator;

  // Auto-Limpeza de Notificação Toast
  const [toastData, setToastData] = useState<{ message: string; details?: string } | null>(null);

  // Configuração opcional do Totem: Manter OP aberta após iniciar (persistido em localStorage)
  const [manterOpAberta, setManterOpAberta] = useState<boolean>(() => {
    try {
      return localStorage.getItem('metalrib_manter_op_aberta') === 'true';
    } catch {
      return false;
    }
  });

  const handleToggleManterOpAberta = useCallback((val: boolean) => {
    setManterOpAberta(val);
    try {
      localStorage.setItem('metalrib_manter_op_aberta', String(val));
    } catch {}
  }, []);

  // Painel de Supervisão e Separação de Sistemas (Totem vs PCP vs Mobile)
  const [systemMode, setSystemMode] = useState<'totem' | 'pcp' | 'mobile'>(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      return 'mobile';
    }
    return 'totem';
  });
  const [showSupervisor, setShowSupervisor] = useState<boolean>(false);
  const showSupervisorRef = useRef<boolean>(false);
  showSupervisorRef.current = showSupervisor;

  const [showPinModal, setShowPinModal] = useState<boolean>(false);
  const showPinModalRef = useRef<boolean>(false);
  showPinModalRef.current = showPinModal;
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string | null>(null);

  const handleUnlockPcp = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput === '1234' || pinInput === 'admin') {
      playSuccessStart();
      setSystemMode('pcp');
      setShowPinModal(false);
      setPinInput('');
      setPinError(null);
    } else {
      playBlockedError();
      setPinError('Senha ou PIN incorreto. Tente novamente.');
    }
  };

  const isFetchingRef = useRef<boolean>(false);

  // Carrega OPs e Apontamentos da API Local / Cache de forma estável (sem loops)
  const loadData = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const [allOrders, allApts] = await Promise.all([
        fetchProductionOrders(),
        fetchApontamentos()
      ]);
      const correctedMap: Record<string, ProductionOrder> = {};
      Object.keys(allOrders || {}).forEach((k) => {
        const canonical = formatOpNumber(cleanOpId(k));
        if (canonical) {
          correctedMap[canonical] = verificarECorrigirRotaOp(allOrders[k], false);
        }
      });

      setOrders((prev) => {
        const prevKeys = Object.keys(prev);
        const newKeys = Object.keys(correctedMap);
        if (
          prevKeys.length === newKeys.length &&
          prevKeys.every((k) => prev[k] === correctedMap[k] || JSON.stringify(prev[k]) === JSON.stringify(correctedMap[k]))
        ) {
          return prev;
        }
        return correctedMap;
      });

      setApontamentos((prev) => {
        if (
          prev.length === (allApts || []).length &&
          prev.every((a, idx) => a.id === allApts[idx]?.id && a.status === allApts[idx]?.status)
        ) {
          return prev;
        }
        return allApts || [];
      });

      // Sincroniza configuração de terminais e setores caso tenham sido editados no PCP
      const dynamicTerms = fetchTerminalsConfig();
      setCurrentTerminal((prev) => {
        if (!prev) return dynamicTerms[0] || TERMINALS[0];
        const match = dynamicTerms.find((t) => t.id === prev.id);
        if (match && match.id === prev.id && match.name === prev.name && match.sectors?.length === prev.sectors?.length) {
          return prev;
        }
        return match || dynamicTerms[0] || TERMINALS[0];
      });
    } catch (err) {
      console.error('Falha ao carregar dados do MES:', err);
    } finally {
      isFetchingRef.current = false;
    }
  }, []);

  // Executa carga inicial e escuta reativamente atualizações locais e eventos
  useEffect(() => {
    loadData();

    const handleSectorsUpdated = () => {
      const dynamicTerms = fetchTerminalsConfig();
      setCurrentTerminal((prev) => {
        if (!prev) return dynamicTerms[0] || TERMINALS[0];
        const match = dynamicTerms.find((t) => t.id === prev.id);
        if (
          match &&
          match.id === prev.id &&
          match.name === prev.name &&
          JSON.stringify(match.sectors) === JSON.stringify(prev.sectors)
        ) {
          return prev;
        }
        return match || dynamicTerms[0] || TERMINALS[0];
      });
    };
    window.addEventListener('metalrib_sectors_updated', handleSectorsUpdated);
    let debounceTimer: any = null;
    const unsubscribe = subscribeToMesUpdates(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        loadData();
      }, 300);
    });

    return () => {
      clearTimeout(debounceTimer);
      window.removeEventListener('metalrib_sectors_updated', handleSectorsUpdated);
      unsubscribe();
    };
  }, []);

  // Listener exclusivo do Socket.io para atualização em tempo real (registrado apenas na montagem [])
  useEffect(() => {
    try {
      const socket = getLocalSocket();
      const handleAtualizacao = async (novasOrdens: any[]) => {
        if (!Array.isArray(novasOrdens)) return;
        const finalMap: Record<string, ProductionOrder> = {};
        for (const item of novasOrdens) {
          const opNum = String(item.numero || item.id || '').trim();
          const clean = cleanOpId(opNum);
          if (!clean || TEST_DUMMY_OPS.has(clean)) continue;
          const opNumero = formatOpNumber(clean);
          const qtd = Number(item.quantidadeFisica || item.quantidade_total || item.quantidade || 1);
          const parsedEtapas = typeof item.etapas === 'string'
            ? JSON.parse(item.etapas || '[]')
            : (item.etapas || []);

          const synced = initOrSyncOrderEtapas({
            ...item,
            id: opNumero,
            op_numero: opNumero,
            numero: opNumero,
            descricao: item.descricao || item.produto || '',
            produto: item.descricao || item.produto || '',
            codigo: item.codigo || item.codigoProduto || '',
            codigoProduto: item.codigo || item.codigoProduto || '',
            cliente: item.cliente || 'METALRIB',
            tipoOrdem: item.tipoOrdem || 'Padrão',
            quantidade_total: qtd,
            quantidade: qtd,
            quantidadeFisica: qtd,
            requer_laser: Boolean(item.requer_laser || item.requerLaser),
            requerLaser: Boolean(item.requer_laser || item.requerLaser),
            requerRouter: Boolean(item.requerRouter || item.requer_router || item.encaminhar_router),
            requer_router: Boolean(item.requerRouter || item.requer_router || item.encaminhar_router),
            encaminhar_router: Boolean(item.requerRouter || item.requer_router || item.encaminhar_router),
            etapas: parsedEtapas
          });
          const processed = verificarECorrigirRotaOp(synced, false);
          finalMap[opNumero] = processed;
        }

        setOrders(finalMap);

        // Recarrega apontamentos atualizados (necessário quando uma OP foi resetada ou teve unidades concluídas/estornadas)
        const updatedApts = await fetchApontamentos();
        setApontamentos(Array.isArray(updatedApts) ? updatedApts : []);

        // Se a OP aberta no Totem teve sua etapa cancelada ou retornada para PENDENTE no banco
        const currentSelectedClean = cleanOpId(selectedOpNumberRef.current || '');
        if (currentSelectedClean) {
          const currentOrder = finalMap[currentSelectedClean];
          const currentSector = selectedSectorRef.current;
          if (currentOrder && currentSector) {
            const stepData = currentOrder.etapas && typeof currentOrder.etapas === 'object'
              ? (Array.isArray(currentOrder.etapas)
                  ? currentOrder.etapas.find((e: any) => (typeof e === 'string' ? e : e.nome) === currentSector)
                  : currentOrder.etapas[currentSector])
              : null;

            const hasActiveApt = Array.isArray(updatedApts) && updatedApts.some((a) => {
              const aClean = cleanOpId(a.op_numero || (a as any).opNumero || '');
              return aClean === currentSelectedClean && (a.status === 'EM_ANDAMENTO' || a.status === 'EM_PRODUCAO');
            });

            if (stepData && typeof stepData === 'object' && stepData.status === 'PENDENTE' && !stepData.inicio && !hasActiveApt && selectedOperatorRef.current) {
              console.log('[Totem] Etapa cancelada remotamente. Retornando ao início...');
              handleResetScreen();
              setToastData({
                message: '⚠️ Etapa cancelada pelo PCP',
                details: `A etapa ${currentSector} da ${formatOpNumber(currentSelectedClean)} foi cancelada pelo PCP. Tela reiniciada.`
              });
            }
          }
        }
      };

      const handleOrdemResetada = (data: any) => {
        const resetOpNum = cleanOpId(data?.numero || data?.opNumero || data?.id || '');
        const currentSelectedClean = cleanOpId(selectedOpNumberRef.current || '');
        const resetEtapa = String(data?.etapa || data?.setor || '').trim().toLowerCase();
        const currentSector = String(selectedSectorRef.current || '').trim().toLowerCase();

        // Se a OP resetada/cancelada pelo PCP estiver aberta na tela do Totem:
        if (currentSelectedClean && resetOpNum && currentSelectedClean === resetOpNum) {
          const isSameEtapa = !resetEtapa || !currentSector || resetEtapa === currentSector || currentSector.includes(resetEtapa) || resetEtapa.includes(currentSector);
          if (isSameEtapa) {
            handleResetScreen();
            playBlockedError();
            setToastData({
              message: '⚠️ Etapa estornada pelo PCP',
              details: `A etapa ${data?.etapa || ''} da ${formatOpNumber(resetOpNum)} foi cancelada pelo PCP. Tela reiniciada.`
            });
          }
        }
        loadData();
      };

      const handleOpResetada = (data: any) => {
        const resetOpNum = cleanOpId(data?.numero || data?.opNumero || data?.id || '');
        const currentSelectedClean = cleanOpId(selectedOpNumberRef.current || '');
        if (currentSelectedClean && resetOpNum && currentSelectedClean === resetOpNum) {
          handleResetScreen();
          playBlockedError();
          setToastData({
            message: '⚠️ OP Resetada pelo PCP',
            details: `A ordem ${formatOpNumber(resetOpNum)} foi resetada pelo PCP. Tela reiniciada.`
          });
        }
        loadData();
      };

      const handleOrdemApontada = async (data: any) => {
        const updatedApts = await fetchApontamentos();
        setApontamentos(Array.isArray(updatedApts) ? updatedApts : []);
        window.dispatchEvent(new CustomEvent('metalrib_apontamentos_updated', { detail: data }));
      };

      const handleColaboradoresAtualizados = (colabs: any) => {
        if (Array.isArray(colabs) && colabs.length > 0) {
          saveOperators(colabs);
        } else {
          fetchLocalColaboradores();
        }
        window.dispatchEvent(new CustomEvent('metalrib_operators_updated', { detail: colabs }));
      };

      const handleSistemaAtualizado = (info: any) => {
        console.log('[Zero-Downtime] Evento sistema_atualizado recebido via Socket.io:', info);
        const isIdle = (
          !selectedOpNumberRef.current &&
          !showTerminalModalRef.current &&
          !showSupervisorRef.current &&
          !showPinModalRef.current
        );

        if (isIdle) {
          console.log('[Zero-Downtime] Terminal ocioso na tela inicial. Recarregando frontend agora...');
          window.location.reload();
        } else {
          console.log('[Zero-Downtime] Terminal em produção/modal aberto. Atualização agendada para retorno à tela inicial.');
          atualizacaoPendenteRef.current = true;
          setAtualizacaoPendente(true);
        }
      };

      socket.on('ordens_atualizadas', handleAtualizacao);
      socket.on('op_resetada', handleOpResetada);
      socket.on('ordem_resetada', handleOrdemResetada);
      socket.on('ordem_apontada', handleOrdemApontada);
      socket.on('colaboradores_atualizados', handleColaboradoresAtualizados);
      socket.on('sistema_atualizado', handleSistemaAtualizado);

      // Listener para eventos locais disparados na mesma sessão
      const handleWindowReset = () => {
        loadData();
      };
      const handleWindowResetada = (e: any) => {
        handleOrdemResetada(e.detail);
      };
      window.addEventListener('metalrib_ordem_resetada', handleWindowResetada);
      window.addEventListener('metalrib_op_resetada', handleWindowResetada);
      window.addEventListener('metalrib_orders_updated', handleWindowReset);
      window.addEventListener('metalrib_apontamentos_updated', handleWindowReset);

      return () => {
        socket.off('ordens_atualizadas', handleAtualizacao);
        socket.off('op_resetada', handleOpResetada);
        socket.off('ordem_resetada', handleOrdemResetada);
        socket.off('ordem_apontada', handleOrdemApontada);
        socket.off('colaboradores_atualizados', handleColaboradoresAtualizados);
        socket.off('sistema_atualizado', handleSistemaAtualizado);
        window.removeEventListener('metalrib_ordem_resetada', handleWindowResetada);
        window.removeEventListener('metalrib_op_resetada', handleWindowResetada);
        window.removeEventListener('metalrib_orders_updated', handleWindowReset);
        window.removeEventListener('metalrib_apontamentos_updated', handleWindowReset);
      };
    } catch (err) {
      console.warn('[Socket.io] Erro no listener em App.tsx:', err);
    }
  }, [loadData]);

  // OP atual derivada reativamente do dicionário de ordens com suporte flexível a chaves com/sem 'OP'
  const currentOp: ProductionOrder | null = useMemo(() => {
    if (!selectedOpNumber) return null;
    const clean = cleanOpId(selectedOpNumber);
    const formatted = formatOpNumber(clean);
    return (
      orders[selectedOpNumber] ||
      orders[formatted] ||
      orders[clean] ||
      Object.values(orders).find((o) => cleanOpId(o.op_numero || o.numero) === clean) ||
      null
    );
  }, [selectedOpNumber, orders]);

  // Auto-seleção inteligente e validação estrita de setor na rota da OP
  const lastOpNumRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentOp || !currentTerminal) return;

    const isNewOp = lastOpNumRef.current !== currentOp.op_numero;
    lastOpNumRef.current = currentOp.op_numero;

    // Cenário Prioritário: OP já possui lote EM PRODUÇÃO em algum setor deste terminal
    const activeBatchInTerminal = apontamentos.find(
      (a) =>
        (a.op === currentOp.op_numero || a.op_numero === currentOp.op_numero) &&
        a.status === 'EM_ANDAMENTO' &&
        (a.is_lote || a.unidade_numero === 0) &&
        (!a.terminal_id || Number(a.terminal_id) === Number(currentTerminal.id)) &&
        (currentTerminal.sectors.includes(a.setor) || (a.setorFisico && currentTerminal.sectors.includes(a.setorFisico)))
    );

    if (activeBatchInTerminal) {
      const targetSec = activeBatchInTerminal.setorFisico || activeBatchInTerminal.setor;
      const targetOp = activeBatchInTerminal.colaborador || activeBatchInTerminal.operador;
      if (selectedSector !== targetSec) {
        setSelectedSector(targetSec);
      }
      if (selectedOperator !== targetOp) {
        setSelectedOperator(targetOp);
      }
      return;
    }

    const { steps } = getRouteForOp(currentOp);
    const isAncora = isAncoraOrder(currentOp);
    const isTerminal5 = currentTerminal.id === 5;
    const validSectors = (currentTerminal.sectors || []).filter((sec) => {
      if (isAncora && isTerminal5 && sec === 'Solda e Montagem') return true;
      return findStepForSector(sec, steps) !== null;
    });

    // Auto-seleciona o primeiro posto liberado da rota da OP neste terminal
    const primeiroLiberado = validSectors.find(
      (sec) => validarPostoIndustrial(currentOp, sec, apontamentos, currentTerminal.id).valido
    );
    const alvo = primeiroLiberado || validSectors[0] || null;

    if (alvo && (isNewOp || !selectedSector || !validSectors.includes(selectedSector))) {
      setSelectedSector(alvo);
    } else if (!alvo && selectedSector && !validSectors.includes(selectedSector)) {
      setSelectedSector(null);
      setSelectedOperator(null);
    }
  }, [currentOp?.op_numero, currentTerminal?.id, apontamentos]);

  // Sempre que o setor mudar ou for desmarcado, limpa o colaborador selecionado (exceto se houver lote em produção neste setor)
  useEffect(() => {
    if (!currentOp || !selectedSector) {
      setSelectedOperator(null);
      return;
    }
    const activeBatchInSector = apontamentos.find(
      (a) =>
        (a.op === currentOp.op_numero || a.op_numero === currentOp.op_numero) &&
        a.status === 'EM_ANDAMENTO' &&
        (a.is_lote || a.unidade_numero === 0) &&
        (a.setor === selectedSector || a.setorFisico === selectedSector)
    );
    if (activeBatchInSector) {
      setSelectedOperator(activeBatchInSector.colaborador || activeBatchInSector.operador);
    } else {
      setSelectedOperator(null);
    }
  }, [selectedSector, currentOp?.op_numero, apontamentos]);

  // Reseta a tela do Totem para o estado inicial livre
  const handleResetScreen = useCallback((keepToast?: boolean | React.MouseEvent) => {
    setSelectedOpNumber(null);
    setSelectedSector(null);
    setSelectedOperator(null);
    setSearchError(null);
    if (keepToast !== true) {
      setToastData(null);
    }

    // Zero-Downtime: se houver atualização pendente do sistema, recarrega de forma segura ao voltar à tela inicial
    if (atualizacaoPendenteRef.current) {
      console.log('[Zero-Downtime] Terminal voltou à tela inicial. Executando atualização pendente...');
      setTimeout(() => {
        window.location.reload();
      }, 500);
    }
  }, []);

  // Zero-Downtime: auto-reload caso o terminal volte a ficar ocioso com atualização pendente
  useEffect(() => {
    if (atualizacaoPendente && !selectedOpNumber && !showTerminalModal && !showSupervisor && !showPinModal) {
      console.log('[Zero-Downtime] Terminal ocioso com atualização pendente detectada. Recarregando...');
      setToastData({
        message: '🔄 Atualizando Terminal',
        details: 'Uma nova versão do sistema foi disponibilizada. O terminal está recarregando...'
      });
      const timer = setTimeout(() => {
        window.location.reload();
      }, 700);
      return () => clearTimeout(timer);
    }
  }, [atualizacaoPendente, selectedOpNumber, showTerminalModal, showSupervisor, showPinModal]);

  // Lotes em andamento vinculados aos postos do terminal ativo
  const activeBatchesInTerminal = useMemo<ActiveBatchItem[]>(() => {
    if (!currentTerminal) return [];
    const list: ActiveBatchItem[] = [];
    const seenKeys = new Set<string>();

    const activeTermId = Number(currentTerminal.id);
    const activeTermCode = `T${activeTermId}`;
    const activeTermName = currentTerminal.name || `Terminal ${activeTermId}`;

    // Obter a lista oficial de postos/setores configurados para este terminalAtivo
    const officialSectors: string[] = (
      Array.isArray(currentTerminal.sectors) && currentTerminal.sectors.length > 0
        ? currentTerminal.sectors
        : (POSTOS_POR_TERMINAL[activeTermCode] || [])
    );

    const terminalSectorsNorm = officialSectors
      .map((s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim())
      .filter(Boolean);

    const normalizeStep = (str?: string) =>
      (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

    // Verificação rigorosa se o nome do posto/etapa pertence explicitamente aos setores deste terminal
    const isSectorOfActiveTerminal = (setorOrEtapa?: string) => {
      if (!setorOrEtapa) return false;
      const norm = normalizeStep(setorOrEtapa);
      return terminalSectorsNorm.some((ts: string) => {
        if (ts === norm) return true;
        // Aliases específicos e seguros para variações conhecidas da fábrica
        if ((norm === 'laser' || norm === 'laser cnc') && (ts === 'laser' || ts === 'laser cnc')) return true;
        if ((norm.startsWith('preparacao de folha') || norm.startsWith('preparao de folha')) && (ts.startsWith('preparacao de folha') || ts.startsWith('preparao de folha'))) return true;
        if (norm.startsWith('injecao') && !norm.includes('batente') && ts.startsWith('injecao') && !ts.includes('batente')) return true;
        if (norm.includes('vai vem') && ts.includes('vai vem') && norm.includes('montagem') && ts.includes('montagem')) return true;
        if (norm.includes('corte') && norm.includes('aluminio') && ts.includes('corte') && ts.includes('aluminio')) return true;
        if (norm.includes('solda') && ts.includes('solda')) return true;
        return false;
      });
    };

    // Critério oficial de pertencimento estrito ao terminal ativo
    const belongsToTerminal = (setorOrEtapa?: string, termId?: number | string, termName?: string) => {
      const parsedTermId = (termId !== undefined && termId !== null && termId !== '') ? Number(termId) : null;
      const normTermName = (termName || '').trim().toUpperCase();

      // Regra 1: O registro de início da etapa possui terminalId ou terminalNome igual ao terminalAtivo atual
      const isCurrentId = parsedTermId !== null && parsedTermId > 0 && parsedTermId === activeTermId;
      const isCurrentName = normTermName === activeTermCode || normTermName === activeTermName.toUpperCase();
      if (isCurrentId || isCurrentName) {
        return true;
      }

      // Se o registro apontar explicitamente para OUTRO terminal (ex: termId = 3 quando estamos no 5),
      // NUNCA exibir este card aqui, pois pertence comprovadamente a outro terminal
      if (parsedTermId !== null && parsedTermId > 0 && parsedTermId !== activeTermId) {
        return false;
      }
      if (normTermName && normTermName.startsWith('T') && normTermName !== activeTermCode) {
        return false;
      }

      // Regra 2: O nome do posto/etapa em execução pertence explicitamente à lista de setores vinculados a este terminalAtivo
      if (isSectorOfActiveTerminal(setorOrEtapa)) {
        return true;
      }

      // NUNCA exibir etapas de outros terminais caso não haja correspondência
      return false;
    };

    // 1. Vasculhar apontamentos com status EM_ANDAMENTO (ou sem hora_fim)
    if (Array.isArray(apontamentos)) {
      for (const apt of apontamentos) {
        if (apt.status === 'EM_ANDAMENTO' || (!apt.hora_fim && apt.status !== 'FINALIZADO')) {
          const step = apt.etapa_rota || apt.setor || '';
          if (belongsToTerminal(step, apt.terminal_id, apt.terminal)) {
            const rawOp = apt.op_numero || (apt as any).op || '';
            const formattedOp = formatarNumeroOP(rawOp);
            const cleanKey = cleanOpId(rawOp);
            const order = orders[formattedOp] || orders[cleanKey] || orders[rawOp];

            // EXCLUSÃO OBRIGATÓRIA: se a OP está FINALIZADA ou se a etapa já tem 100% concluída
            if (order) {
              const ordStatusUpper = String(order.status || '').toUpperCase().trim();
              if (ordStatusUpper === 'FINALIZADA' || ordStatusUpper === 'FINALIZADO') continue;

              const totalOpQtd = Math.max(1, order.quantidadeFisica || order.quantidade_total || order.quantidade || 1);

              // 1. Verifica no objeto etapas da ordem
              if (order.etapas && typeof order.etapas === 'object' && !Array.isArray(order.etapas)) {
                const etapaKey = Object.keys(order.etapas).find(k => normalizeStep(k) === normalizeStep(step));
                if (etapaKey) {
                  const etapaData = (order.etapas as any)[etapaKey];
                  const st = String(etapaData?.status || '').toUpperCase();
                  if (st === 'CONCLUIDO' || st === 'FINALIZADO' || (etapaData?.concluidas ?? 0) >= totalOpQtd) {
                    continue;
                  }
                }
              }

              // 2. Verifica se todas as peças desta etapa já estão concluídas nos apontamentos
              const finishedInStep = apontamentos.filter(a =>
                (cleanOpId(a.op_numero || '') === cleanKey) &&
                (a.status === 'FINALIZADO' || a.status === 'CONCLUIDO') &&
                (normalizeStep(a.etapa_rota) === normalizeStep(step) || normalizeStep(a.setor) === normalizeStep(step))
              );
              const hasFinishedBatch = finishedInStep.some(a => a.is_lote || a.unidade_numero === 0);
              const finishedUnitsCount = finishedInStep.filter(a => !a.is_lote && a.unidade_numero > 0).length;
              if (hasFinishedBatch || finishedUnitsCount >= totalOpQtd) {
                continue;
              }

              // 3. Se for apontamento unitário, verifica se esta unidade específica já foi finalizada
              if (apt.unidade_numero && apt.unidade_numero > 0) {
                const unitAlreadyFinished = finishedInStep.some(a => a.unidade_numero === apt.unidade_numero);
                if (unitAlreadyFinished) {
                  continue;
                }
              }
            }

            const uniqueKey = `${cleanKey}_${step.toLowerCase()}`;
            if (!seenKeys.has(uniqueKey)) {
              seenKeys.add(uniqueKey);
              const inicio = apt.hora_inicio || (apt as any).horaInicio || '';
              const inicioMs = inicio ? new Date(inicio).getTime() : (apt.criadoEm || Date.now());
              list.push({
                id: apt.id,
                apontamentoId: apt.id,
                opNumero: formattedOp,
                descricao: order?.descricao || order?.produto || (apt as any).descricao || 'Ordem de Produção',
                codigo: order?.codigoProduto || order?.codigo || '',
                etapa: step,
                operador: apt.colaborador || apt.operador || 'Operador',
                horaInicio: inicio,
                inicioMs: isNaN(inicioMs) ? Date.now() : inicioMs
              });
            }
          }
        }
      }
    }

    // 2. Vasculhar ordens cujo etapas contenha EM_PRODUCAO no terminal ativo
    for (const opKey of Object.keys(orders)) {
      const ord = orders[opKey];
      if (!ord || !ord.etapas) continue;
      const ordStatusUpper = String(ord.status || '').toUpperCase().trim();
      if (ordStatusUpper === 'FINALIZADA' || ordStatusUpper === 'FINALIZADO') continue;

      const formattedOp = formatarNumeroOP(ord.numero || ord.op_numero || opKey);
      const cleanKey = cleanOpId(formattedOp);
      const totalOpQtd = Math.max(1, ord.quantidadeFisica || ord.quantidade_total || ord.quantidade || 1);

      if (ord.etapas && typeof ord.etapas === 'object' && !Array.isArray(ord.etapas)) {
        for (const [etapaNome, etapaData] of Object.entries(ord.etapas)) {
          if (etapaData && typeof etapaData === 'object' && (etapaData.status === 'EM_PRODUCAO' || etapaData.status === 'EM_ANDAMENTO')) {
            if ((etapaData.concluidas ?? 0) >= totalOpQtd) continue;

            const etapaTermId = (etapaData as any).terminal_id || (etapaData as any).terminalId;
            const etapaTermName = (etapaData as any).terminal || (etapaData as any).terminalNome;
            if (belongsToTerminal(etapaNome, etapaTermId, etapaTermName)) {
              const uniqueKey = `${cleanKey}_${etapaNome.toLowerCase()}`;
              if (!seenKeys.has(uniqueKey)) {
                seenKeys.add(uniqueKey);
                const inicio = (etapaData as any).inicio || (etapaData as any).timestampInicio;
                const inicioMs = inicio ? (typeof inicio === 'string' ? new Date(inicio).getTime() : Number(inicio)) : Date.now();
                list.push({
                  id: `${cleanKey}_${etapaNome}`,
                  opNumero: formattedOp,
                  descricao: ord.descricao || ord.produto || 'Ordem de Produção',
                  codigo: ord.codigoProduto || ord.codigo || '',
                  etapa: etapaNome,
                  operador: (etapaData as any).operador || ord.colaborador || ord.operador || 'Operador',
                  horaInicio: typeof inicio === 'string' ? inicio : undefined,
                  inicioMs: isNaN(inicioMs) ? Date.now() : inicioMs
                });
              }
            }
          }
        }
      }
    }

    return list;
  }, [currentTerminal, apontamentos, orders]);

  // Abre diretamente a tela da OP na etapa em andamento pronta para conclusão
  const handleSelectActiveBatch = useCallback((batch: ActiveBatchItem) => {
    playClick();
    setSelectedOpNumber(batch.opNumero);
    setSelectedSector(batch.etapa);
    setSelectedOperator(batch.operador);
  }, []);

  // Seleciona terminal físico
  const handleSelectTerminal = (term: TerminalConfig) => {
    saveTerminalId(term.id);
    setCurrentTerminal(term);
    setShowTerminalModal(false);
    handleResetScreen();
  };

  // Busca OP por código
  const handleSearchOp = (opNumber: string) => {
    const clean = opNumber.trim().toUpperCase();
    if (!clean) return;

    setIsLoading(true);
    setSearchError(null);

    try {
      let found = orders[clean] || orders[formatOpNumber(clean)];
      if (!found) {
        const cleanNoPrefix = clean.replace(/^OP\s*/i, '').replace(/[-_\s]/g, '');
        const keys = Object.keys(orders);
        let matchedKey = keys.find((k) => {
          const kClean = k.replace(/^OP\s*/i, '').replace(/[-_\s]/g, '');
          return kClean === cleanNoPrefix || k.trim().toUpperCase() === clean;
        });

        // Se o operador digitou o radical da OP (ex: 023838 para 023838-01)
        if (!matchedKey && cleanNoPrefix.length >= 4) {
          matchedKey = keys.find((k) => {
            const kClean = k.replace(/^OP\s*/i, '').replace(/[-_\s]/g, '');
            return kClean.startsWith(cleanNoPrefix) || kClean.includes(cleanNoPrefix);
          });
        }

        if (matchedKey) found = orders[matchedKey];
      }

      if (found) {
        setSelectedOpNumber(found.op_numero);
        setSearchError(null);

        // Se há lote EM PRODUÇÃO neste terminal para esta OP, auto-seleciona setor e operador diretamente
        const activeBatchInTerminal = apontamentos.find(
          (a) =>
            (a.op === found.op_numero || a.op_numero === found.op_numero) &&
            a.status === 'EM_ANDAMENTO' &&
            (a.is_lote || a.unidade_numero === 0) &&
            currentTerminal &&
            (!a.terminal_id || Number(a.terminal_id) === Number(currentTerminal.id)) &&
            (currentTerminal.sectors.includes(a.setor) || (a.setorFisico && currentTerminal.sectors.includes(a.setorFisico)))
        );

        if (activeBatchInTerminal) {
          setSelectedSector(activeBatchInTerminal.setorFisico || activeBatchInTerminal.setor);
          setSelectedOperator(activeBatchInTerminal.colaborador || activeBatchInTerminal.operador);
        } else {
          setSelectedOperator(null);
          // Regra Inteligente: NUNCA seleciona setor fora da rota.
          // Se houver exatamente 1 setor aplicável neste terminal, auto-seleciona.
          // Se houver 2 ou mais setores, mantém desmarcado para escolha do operador.
          if (currentTerminal && currentTerminal.sectors) {
            const { steps } = getRouteForOp(found);
            const isAncora = isAncoraOrder(found);
            const isTerminal5 = currentTerminal.id === 5;
            const validSectors = currentTerminal.sectors.filter((sec) => {
              if (isAncora && isTerminal5 && sec === 'Solda e Montagem') return true;
              return findStepForSector(sec, steps) !== null;
            });
            const primeiroLiberado = validSectors.find(
              (sec) => validarPostoIndustrial(found, sec, apontamentos, currentTerminal.id).valido
            );
            const alvo = primeiroLiberado || validSectors[0] || null;
            setSelectedSector(alvo);
          }
        }
      } else {
        playBlockedError();
        setSearchError(
          `Ordem de Produção "${opNumber}" não encontrada. Verifique o número digitado ou importe as ordens do Nomus ERP no Portal PCP.`
        );
      }
    } catch {
      playBlockedError();
      setSearchError('Erro ao consultar banco de dados. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  // Iniciar Unidade
  const handleStartUnit = async (unidadeNumero: number, etapaRota: string, encaminharRouter?: boolean) => {
    if (!currentOp || !selectedSector || !selectedOperator || !currentTerminal) return;
    setIsLoading(true);
    try {
      await startUnit({
        op_numero: currentOp.op_numero,
        unidade_numero: unidadeNumero,
        setor: selectedSector,
        etapa_rota: etapaRota,
        terminal_id: currentTerminal.id,
        operador: selectedOperator,
        requerRouter: encaminharRouter
      });

      playSuccessStart();

      // Recarrega apontamentos atualizados
      await loadData();

      // Dispara Toast de Auto-Limpeza de 3 segundos e LIMPA A TELA para o PASSO 1
      setToastData({
        message: `▶ Unidade ${unidadeNumero} Iniciada com Sucesso!`,
        details: `Operador: ${selectedOperator} · Setor: ${selectedSector} · Registro salvo com sucesso`
      });

      // PASSO 3: Retorna ao PASSO 1 imediatamente para o próximo colaborador
      handleResetScreen();
    } catch (err) {
      console.error(err);
      playBlockedError();
      setToastData({
        message: '⚠ Falha ao iniciar apontamento',
        details: err instanceof Error ? err.message : 'Erro interno de processamento'
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Finalizar Unidade
  const handleFinishUnit = async (apontamentoId: string, encaminharRouter?: boolean) => {
    if (!currentOp || !selectedSector) return;
    setIsLoading(true);
    try {
      const finished = await finishUnit(apontamentoId, currentOp.op_numero, { encaminharRouter });
      playSuccessFinish();

      // Recarrega apontamentos atualizados
      await loadData();

      // Dispara Toast de Auto-Limpeza de 3 segundos e LIMPA A TELA para o PASSO 1
      if (encaminharRouter) {
        setToastData({
          message: `⏹ Unidade ${finished.unidade_numero} Finalizada! OP encaminhada para o Router (Terminal 5).`,
          details: `Duração: ${finished.duracao_minutos} min · Próxima Etapa: Router`
        });
      } else {
        setToastData({
          message: `⏹ Unidade ${finished.unidade_numero} Finalizada com Sucesso!`,
          details: `Duração: ${finished.duracao_minutos} min · Operador: ${finished.operador} · Setor: ${selectedSector}`
        });
      }

      // PASSO 3: Retorna ao PASSO 1 imediatamente para o próximo colaborador
      handleResetScreen();
    } catch (err) {
      console.error(err);
      playBlockedError();
      setToastData({
        message: '⚠ Falha ao finalizar unidade',
        details: err instanceof Error ? err.message : 'Erro interno de processamento'
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Ajuste reativo e instantâneo da quantidade física da OP
  const handleAdjustQuantity = useCallback(async (novaQtd: number) => {
    if (!currentOp) return;
    const cleanId = cleanOpId(currentOp.op_numero || currentOp.numero || '');
    const formatId = formatOpNumber(cleanId);

    // Atualização imediata do estado React para refletir em todos os componentes e botões
    setOrders((prev) => {
      const copy = { ...prev };
      const target = copy[currentOp.op_numero] || copy[formatId] || copy[cleanId];
      if (target) {
        const updatedTarget = {
          ...target,
          quantidadeFisica: novaQtd,
          quantidade_total: novaQtd,
          quantidade: novaQtd
        };
        copy[currentOp.op_numero] = updatedTarget;
        copy[formatId] = updatedTarget;
        copy[cleanId] = updatedTarget;
      }
      return copy;
    });

    try {
      await updateProductionOrder(currentOp.op_numero, {
        quantidade_total: novaQtd,
        quantidade: novaQtd,
        quantidadeFisica: novaQtd
      });
    } catch (e) {
      console.warn('Erro ao atualizar quantidade no storage:', e);
    }
  }, [currentOp]);

  // Iniciar Lote Completo
  const handleStartBatch = async (etapaRota: string, quantidadeTotal: number, encaminharRouter?: boolean) => {
    if (!currentOp || !selectedSector || !selectedOperator || !currentTerminal) return;
    setIsLoading(true);
    const opNum = currentOp.op_numero;
    const opNome = selectedOperator;
    const sector = selectedSector;
    const termId = currentTerminal.id;
    try {
      await startBatch({
        op_numero: opNum,
        quantidade_total: quantidadeTotal,
        quantidadeAjustada: quantidadeTotal,
        setor: sector,
        etapa_rota: etapaRota,
        terminal_id: termId,
        operador: opNome,
        requerRouter: encaminharRouter
      });

      playSuccessStart();
      await loadData();

      setToastData({
        message: `✔ Lote de ${quantidadeTotal} peças iniciado por ${opNome}!`,
        details: `${formatarNumeroOP(opNum)} · Setor: ${sector}`
      });

      if (!manterOpAberta) {
        // Retorna imediatamente à tela inicial do Totem
        handleResetScreen(true);
      }
    } catch (err) {
      console.error(err);
      playBlockedError();
      setToastData({
        message: '⚠ Falha ao iniciar lote',
        details: err instanceof Error ? err.message : 'Erro interno de processamento'
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Finalizar Lote Completo
  const handleFinishBatch = async (apontamentoId: string, quantidadeRefugo?: number, encaminharRouter?: boolean, quantidadeAjustada?: number) => {
    if (!currentOp || !selectedSector) return;
    setIsLoading(true);
    const opNum = currentOp.op_numero;
    const sector = selectedSector;
    try {
      const finished = await finishBatch(apontamentoId, opNum, { quantidadeRefugo, encaminharRouter, quantidadeAjustada });
      playSuccessFinish();
      await loadData();

      const opNome = finished.colaborador || finished.operador || 'Operador';
      const duracaoTempo = finished.duracao || finished.duracao_minutos;

      if (encaminharRouter) {
        setToastData({
          message: `✔ Lote de ${finished.quantidade_lote} peças concluído! OP encaminhada para o Router (Terminal 5).`,
          details: `Duração: ${duracaoTempo} min · Próxima Etapa: Router`
        });
      } else {
        setToastData({
          message: `✔ Lote de ${finished.quantidade_lote} peças concluído com sucesso por ${opNome}!`,
          details: `Duração: ${duracaoTempo} min · Setor: ${sector}`
        });
      }

      // Retorna imediatamente à tela inicial de bipar mantendo o toast visível
      handleResetScreen(true);
    } catch (err) {
      console.error(err);
      playBlockedError();
      setToastData({
        message: '⚠ Falha ao finalizar lote',
        details: err instanceof Error ? err.message : 'Erro interno de processamento'
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Cancelar / Estornar Início Acidental de Lote ou Unidade
  const handleCancelStart = async (apontamentoId: string, etapaRota: string) => {
    if (!currentOp || !selectedSector) return;
    setIsLoading(true);
    const opNum = currentOp.op_numero;
    const sector = selectedSector;
    try {
      await cancelarInicioEtapa(opNum, sector, apontamentoId);
      playClick();
      await loadData();

      setToastData({
        message: `✔ Início da etapa ${sector} estornado com sucesso!`,
        details: `${formatarNumeroOP(opNum)} · Posto retornado para Pendente`
      });

      // Retorna imediatamente à tela inicial de bipar mantendo o toast visível
      handleResetScreen(true);
    } catch (err) {
      console.error(err);
      playBlockedError();
      setToastData({
        message: '⚠ Falha ao estornar início de etapa',
        details: err instanceof Error ? err.message : 'Erro interno de processamento'
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Se estiver no Modo Mobile (Consulta Rápida / Rastreio PCP)
  if (systemMode === 'mobile') {
    return (
      <ErrorBoundary
        fallbackTitle="Falha na Interface Mobile"
        fallbackMessage="Ocorreu um erro inesperado ao renderizar a consulta mobile. Toque abaixo para tentar novamente ou retornar ao Totem."
        onReset={() => {
          setSystemMode('totem');
        }}
      >
        <MobilePcpTracker
          orders={orders || {}}
          apontamentos={apontamentos || []}
          initialOpNumber={selectedOpNumber}
          onRefresh={loadData}
          onSwitchToTotem={() => {
            playClick();
            setSystemMode('totem');
          }}
          onSelectOpForTotem={(opNum) => {
            handleSearchOp(opNum);
            setSystemMode('totem');
          }}
          onOpenSupervisor={() => setShowSupervisor(true)}
        />
      </ErrorBoundary>
    );
  }

  // Se estiver no Modo PCP & Coordenação
  if (systemMode === 'pcp') {
    return (
      <PcpPortal
        orders={orders}
        apontamentos={apontamentos}
        onSwitchToTotem={() => {
          playClick();
          setSystemMode('totem');
        }}
        onSelectOpForTotem={(op) => {
          handleSearchOp(op);
          setSystemMode('totem');
        }}
        onOrdersUpdated={(updated) => setOrders(updated)}
        onClearOrders={() => {
          setOrders({});
          setSelectedOpNumber(null);
        }}
      />
    );
  }

  // ESTADO 1: TELA INICIAL LIMPA (BIPE OU DIGITE A OP)
  if (!currentOp) {
    return (
      <>
        {/* Notificação Toast Flutuante Discreta (2.5 segundos) */}
        {toastData && (
          <AutoCleanToast
            message={toastData.message}
            details={toastData.details}
            durationMs={2500}
            onClean={() => setToastData(null)}
          />
        )}

        <BarcodeScannerInput
          onSearchOp={handleSearchOp}
          isLoading={isLoading}
          errorMessage={searchError}
          currentTerminal={currentTerminal}
          onSwitchTerminal={() => setShowTerminalModal(true)}
          onOpenPcp={() => setShowPinModal(true)}
          onOpenMobile={() => {
            playClick();
            setSystemMode('mobile');
          }}
          manterOpAberta={manterOpAberta}
          onToggleManterOpAberta={handleToggleManterOpAberta}
          activeBatches={activeBatchesInTerminal}
          onSelectActiveBatch={handleSelectActiveBatch}
        />

        {/* Modal de Troca de Terminal Físico */}
        {showTerminalModal && (
          <div className="fixed inset-0 z-50 bg-slate-950/90 overflow-y-auto flex items-center justify-center p-2 sm:p-4">
            <TerminalSelector
              currentTerminalId={currentTerminal?.id || null}
              onSelectTerminal={handleSelectTerminal}
              onCancel={() => setShowTerminalModal(false)}
              isModal={true}
            />
          </div>
        )}

        {/* Modal do Painel de Supervisão */}
        {showSupervisor && (
          <SupervisorDashboard
            orders={orders}
            apontamentos={apontamentos}
            onClose={() => setShowSupervisor(false)}
            onSelectOp={(op) => {
              handleSearchOp(op);
              setShowSupervisor(false);
            }}
          />
        )}

        {/* Modal de Acesso Seguro ao PCP (PIN) */}
        {showPinModal && (
          <div className="fixed inset-0 z-50 bg-slate-950/90 overflow-y-auto flex items-center justify-center p-2 sm:p-4">
            <div className="bg-[#0c142b] border-2 border-blue-900 w-full max-w-sm rounded-3xl p-6 shadow-2xl text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#1C2F8A] text-white flex items-center justify-center mx-auto mb-3 border border-blue-400/40">
                <KeyRound className="w-6 h-6" />
              </div>

              <h3 className="text-lg font-bold text-white">Acesso PCP & Coordenação</h3>
              <p className="text-xs text-slate-400 mt-1">
                Digite a senha/PIN de coordenação para acessar o portal de gestão.
              </p>

              <form onSubmit={handleUnlockPcp} className="mt-5 space-y-4">
                <input
                  type="password"
                  autoComplete="off"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  placeholder="••••"
                  maxLength={8}
                  autoFocus
                  className="w-full text-center tracking-widest text-2xl font-mono py-3 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-400"
                />

                {pinError && (
                  <div className="text-xs text-rose-400 font-mono">
                    {pinError}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowPinModal(false);
                      setPinInput('');
                      setPinError(null);
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold hover:bg-slate-700 transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl bg-[#1C2F8A] hover:bg-blue-600 text-white text-xs font-bold transition shadow-md"
                  >
                    Entrar
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </>
    );
  }

  // ESTADO 2: OP ENCONTRADA - FLUXO DO CHÃO DE FÁBRICA
  return (
    <div className="min-h-screen flex flex-col p-2.5 gap-2 bg-slate-950 text-slate-100 select-none antialiased selection:bg-[#1C2F8A] selection:text-white">
      {/* Barra Superior Kiosk do Chão de Fábrica */}
      <Header
        currentTerminal={currentTerminal}
        onSwitchTerminal={() => setShowTerminalModal(true)}
        onOpenSupervisor={() => setShowSupervisor(true)}
        onOpenPcp={() => setShowPinModal(true)}
        onOpenMobile={() => {
          playClick();
          setSystemMode('mobile');
        }}
        onResetScreen={handleResetScreen}
        manterOpAberta={manterOpAberta}
        onToggleManterOpAberta={handleToggleManterOpAberta}
        atualizacaoPendente={atualizacaoPendente}
      />

      {/* Notificação Toast Flutuante Discreta (2.5 segundos) */}
      {toastData && (
        <AutoCleanToast
          message={toastData.message}
          details={toastData.details}
          durationMs={2500}
          onClean={() => setToastData(null)}
        />
      )}

      {/* Conteúdo Principal */}
      <main className="flex-1 min-h-0 flex flex-col w-full max-w-7xl mx-auto">
        {/* Régua Horizontal Superior com Botão de Trocar OP e Detalhes Compactos */}
        <div className="flex items-center gap-2 shrink-0 mb-1">
          <button
            onClick={handleResetScreen}
            className="h-[44px] max-h-[44px] px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 text-xs font-bold transition flex items-center gap-1 cursor-pointer shrink-0 active:scale-95 shadow-sm"
            title="Bipar outra OP"
          >
            <span>← Bipar Outra</span>
          </button>

          <div className="flex-1 min-w-0">
            <OpDetailsCard
              order={currentOp}
              apontamentos={apontamentos}
              selectedSector={selectedSector}
              currentTerminal={currentTerminal}
              onAdjustQuantity={handleAdjustQuantity}
            />
          </div>
        </div>

        {/* Div/container que envolve os Passos 1, 2 e 3 (abaixo do cabeçalho da OP) */}
        <div className="flex-1 overflow-y-auto max-h-[calc(100vh-140px)] px-4 py-2 space-y-3 pb-28 custom-scrollbar">
          {/* Passo 1: Posto de Trabalho */}
          <SectorSelector
            terminal={currentTerminal!}
            order={currentOp}
            apontamentos={apontamentos}
            selectedSector={selectedSector}
            onSelectSector={(s) => {
              setSelectedSector(s);
              setSelectedOperator(null);
            }}
          />

          {/* Passo 2: Identificação do Colaborador */}
          <OperatorSelector
            selectedOperator={selectedOperator}
            selectedSector={selectedSector}
            currentTerminal={currentTerminal}
            order={currentOp}
            onSelectOperator={(op) => setSelectedOperator(op)}
          />

          {/* Passo 3: Ação de Apontamento Fixa no Rodapé */}
          <ProductionAction
            order={currentOp}
            apontamentos={apontamentos}
            selectedSector={selectedSector}
            selectedOperator={selectedOperator}
            currentTerminal={currentTerminal!}
            onStartUnit={handleStartUnit}
            onFinishUnit={handleFinishUnit}
            onStartBatch={handleStartBatch}
            onFinishBatch={handleFinishBatch}
            onCancelStart={handleCancelStart}
            onAdjustQuantity={handleAdjustQuantity}
            isLoading={isLoading}
          />
        </div>
      </main>

      {/* Modal de Troca de Terminal Físico */}
      {showTerminalModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 overflow-y-auto flex items-center justify-center p-2 sm:p-4">
          <TerminalSelector
            currentTerminalId={currentTerminal?.id || null}
            onSelectTerminal={handleSelectTerminal}
            onCancel={() => setShowTerminalModal(false)}
            isModal={true}
          />
        </div>
      )}

      {/* Modal do Painel de Supervisão */}
      {showSupervisor && (
        <SupervisorDashboard
          orders={orders}
          apontamentos={apontamentos}
          onClose={() => setShowSupervisor(false)}
          onSelectOp={(op) => {
            handleSearchOp(op);
            setShowSupervisor(false);
          }}
        />
      )}

      {/* Modal de Acesso Seguro ao PCP (PIN) */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 flex items-center justify-center p-4">
          <div className="bg-[#0c142b] border-2 border-blue-900 w-full max-w-sm rounded-3xl p-6 shadow-2xl text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#1C2F8A] text-white flex items-center justify-center mx-auto mb-3 border border-blue-400/40">
              <KeyRound className="w-6 h-6" />
            </div>

            <h3 className="text-lg font-bold text-white">Acesso PCP & Coordenação</h3>
            <p className="text-xs text-slate-400 mt-1">
              Digite a senha/PIN de coordenação para acessar o portal de gestão.
            </p>

            <form onSubmit={handleUnlockPcp} className="mt-5 space-y-4">
              <input
                type="password"
                autoComplete="off"
                maxLength={8}
                autoFocus
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="••••"
                className="w-full text-center py-3 bg-slate-950 border border-blue-900 rounded-xl text-xl font-mono tracking-widest text-white focus:outline-none focus:border-blue-400"
              />

              {pinError && (
                <div className="text-xs font-semibold text-rose-400">
                  {pinError}
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowPinModal(false);
                    setPinInput('');
                    setPinError(null);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 text-xs font-bold transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-[#1C2F8A] hover:bg-blue-600 text-white text-xs font-bold transition border border-blue-400/40 shadow-md"
                >
                  Entrar no PCP
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Footer Industrial Discreto */}
      <footer className="py-3 px-6 border-t border-blue-900/40 bg-[#070B16] text-slate-400 text-xs font-mono flex flex-col sm:flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span className="font-semibold text-slate-300">METALRIB PORTAS FRIGORÍFICAS · CHÃO DE FÁBRICA MES</span>
        </div>
        <div className="flex items-center gap-4 text-slate-400">
          <span>5 Terminais Interconectados</span>
          <span>·</span>
          <span>Validação Sequencial Ativa</span>
          <span>·</span>
          <button
            onClick={() => setShowSupervisor(true)}
            className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer font-bold"
          >
            Supervisão e Exportação
          </button>
        </div>
      </footer>
    </div>
  );
}
