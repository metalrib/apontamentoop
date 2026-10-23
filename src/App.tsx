import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  subscribeToMesUpdates,
  fetchTerminalsConfig
} from './services/mesStorage';
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
import { getRouteForOp, findStepForSector, isAncoraOrder } from './utils/routeEngine';
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

  // Dados da Fábrica (Sincronizados em tempo real)
  const [orders, setOrders] = useState<Record<string, ProductionOrder>>({});
  const [apontamentos, setApontamentos] = useState<Apontamento[]>([]);

  // Estado do Totem no Chão de Fábrica (guardando apenas o ID da OP selecionada para evitar loops de render)
  const [selectedOpNumber, setSelectedOpNumber] = useState<string | null>(null);
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [selectedOperator, setSelectedOperator] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Auto-Limpeza de 3 Segundos
  const [toastData, setToastData] = useState<{ message: string; details?: string } | null>(null);

  // Painel de Supervisão e Separação de Sistemas (Totem vs PCP vs Mobile)
  const [systemMode, setSystemMode] = useState<'totem' | 'pcp' | 'mobile'>(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      return 'mobile';
    }
    return 'totem';
  });
  const [showSupervisor, setShowSupervisor] = useState<boolean>(false);
  const [showPinModal, setShowPinModal] = useState<boolean>(false);
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
      setPinError('PIN incorreto. Use 1234.');
    }
  };

  // Carrega OPs e Apontamentos do Storage/Firebase de forma estável
  const loadData = useCallback(async () => {
    try {
      const [allOrders, allApts] = await Promise.all([
        fetchProductionOrders(),
        fetchApontamentos()
      ]);
      setOrders(allOrders);
      setApontamentos(allApts);

      // Sincroniza configuração de terminais e setores caso tenham sido editados no PCP
      const dynamicTerms = fetchTerminalsConfig();
      setCurrentTerminal((prev) => {
        if (!prev) return dynamicTerms[0] || TERMINALS[0];
        const match = dynamicTerms.find((t) => t.id === prev.id);
        return match || dynamicTerms[0] || TERMINALS[0];
      });
    } catch (err) {
      console.error('Falha ao carregar dados do MES:', err);
    }
  }, []);

  // Executa carga inicial e escuta atualizações de outras abas ou terminais
  useEffect(() => {
    loadData();
    const unsubscribe = subscribeToMesUpdates(() => {
      loadData();
    });
    return () => unsubscribe();
  }, [loadData]);

  // OP atual derivada diretamente do dicionário de ordens (sem criar loops de estado)
  const currentOp: ProductionOrder | null = selectedOpNumber ? (orders[selectedOpNumber] || null) : null;

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

    // Cenário 1: OP possui APENAS 1 setor aplicável neste terminal: auto-seleciona
    if (validSectors.length === 1) {
      if (selectedSector !== validSectors[0]) {
        setSelectedSector(validSectors[0]);
      }
    } else {
      // Cenário 2: OP possui 2 ou mais setores aplicáveis neste terminal (ex: T1 com Corte e Dobra; T4 com Gaxeta e Montagem Giratória):
      // Ao abrir/trocar de OP, NUNCA deixa setor selecionado por padrão!
      if (isNewOp || (selectedSector && !validSectors.includes(selectedSector))) {
        setSelectedSector(null);
        setSelectedOperator(null);
      }
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
      let found = orders[clean];
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
            if (validSectors.length === 1) {
              setSelectedSector(validSectors[0]);
            } else {
              setSelectedSector(null);
            }
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
  const handleStartUnit = async (unidadeNumero: number, etapaRota: string) => {
    if (!currentOp || !selectedSector || !selectedOperator || !currentTerminal) return;
    setIsLoading(true);
    try {
      await startUnit({
        op_numero: currentOp.op_numero,
        unidade_numero: unidadeNumero,
        setor: selectedSector,
        etapa_rota: etapaRota,
        terminal_id: currentTerminal.id,
        operador: selectedOperator
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
  const handleFinishUnit = async (apontamentoId: string) => {
    if (!currentOp || !selectedSector) return;
    setIsLoading(true);
    try {
      const finished = await finishUnit(apontamentoId, currentOp.op_numero);
      playSuccessFinish();

      // Recarrega apontamentos atualizados
      await loadData();

      // Dispara Toast de Auto-Limpeza de 3 segundos e LIMPA A TELA para o PASSO 1
      setToastData({
        message: `⏹ Unidade ${finished.unidade_numero} Finalizada com Sucesso!`,
        details: `Duração: ${finished.duracao_minutos} min · Operador: ${finished.operador} · Setor: ${selectedSector}`
      });

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

  // Iniciar Lote Completo
  const handleStartBatch = async (etapaRota: string, quantidadeTotal: number) => {
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
        setor: sector,
        etapa_rota: etapaRota,
        terminal_id: termId,
        operador: opNome
      });

      playSuccessStart();
      await loadData();

      setToastData({
        message: `✔ Lote de ${quantidadeTotal} peças iniciado com sucesso por ${opNome}! Retornando ao totem...`,
        details: `OP: ${opNum} · Setor: ${sector} · Terminal ${termId}`
      });

      // Retorna imediatamente após 1 segundo limpando os estados para a tela inicial do totem
      setTimeout(() => {
        handleResetScreen(true);
      }, 1000);
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
  const handleFinishBatch = async (apontamentoId: string, quantidadeRefugo?: number) => {
    if (!currentOp || !selectedSector) return;
    setIsLoading(true);
    const opNum = currentOp.op_numero;
    const sector = selectedSector;
    try {
      const finished = await finishBatch(apontamentoId, opNum, { quantidadeRefugo });
      playSuccessFinish();
      await loadData();

      const opNome = finished.colaborador || finished.operador || 'Operador';
      const duracaoTempo = finished.duracao || finished.duracao_minutos;

      setToastData({
        message: `✔ Lote de ${finished.quantidade_lote} peças concluído com sucesso por ${opNome}!`,
        details: `Duração: ${duracaoTempo} min · Setor: ${sector}`
      });

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

  // Se estiver no Modo Mobile (Consulta Rápida / Rastreio PCP)
  if (systemMode === 'mobile') {
    return (
      <MobilePcpTracker
        orders={orders}
        apontamentos={apontamentos}
        initialOpNumber={selectedOpNumber}
        onSwitchToTotem={() => {
          playClick();
          setSystemMode('totem');
        }}
        onOpenSupervisor={() => setShowSupervisor(true)}
      />
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
        {/* Auto-Limpeza Toast (3 segundos) */}
        {toastData && (
          <AutoCleanToast
            message={toastData.message}
            details={toastData.details}
            durationMs={3000}
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
        />

        {/* Modal de Troca de Terminal Físico */}
        {showTerminalModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md overflow-y-auto flex items-center justify-center p-2 sm:p-4">
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
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md overflow-y-auto flex items-center justify-center p-2 sm:p-4">
            <div className="bg-[#0c142b] border-2 border-blue-900 w-full max-w-sm rounded-3xl p-6 shadow-2xl text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#1C2F8A] text-white flex items-center justify-center mx-auto mb-3 border border-blue-400/40">
                <KeyRound className="w-6 h-6" />
              </div>

              <h3 className="text-lg font-bold text-white">Acesso PCP & Coordenação</h3>
              <p className="text-xs text-slate-400 mt-1">
                Digite a senha/PIN de coordenação para acessar o portal de gestão (Padrão: <span className="font-mono text-blue-300">1234</span>).
              </p>

              <form onSubmit={handleUnlockPcp} className="mt-5 space-y-4">
                <input
                  type="password"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  placeholder="PIN"
                  maxLength={6}
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

  // ESTADO 2: OP ENCONTRADA - FLUXO DO CHÃO DE FÁBRICA (ZERO SCROLL PARA 1366x768)
  return (
    <div className="h-screen max-h-screen overflow-hidden flex flex-col p-2.5 gap-2 bg-slate-950 text-slate-100 select-none antialiased selection:bg-[#1C2F8A] selection:text-white">
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
      />

      {/* Auto-Limpeza Toast (3 segundos) */}
      {toastData && (
        <AutoCleanToast
          message={toastData.message}
          details={toastData.details}
          durationMs={3000}
          onClean={() => setToastData(null)}
        />
      )}

      {/* Conteúdo Principal (Zero Scroll para 1366x768) */}
      <main className="flex-1 min-h-0 flex flex-col w-full max-w-7xl mx-auto">
        <div className="flex-1 min-h-0 flex flex-col gap-2 justify-between">
          {/* Régua Horizontal Superior com Botão de Trocar OP e Detalhes Compactos */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleResetScreen}
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 text-xs font-bold transition flex items-center gap-1 cursor-pointer shrink-0 active:scale-95 shadow-sm"
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
              />
            </div>
          </div>

          {/* Passo 1: Posto de Trabalho */}
          <SectorSelector
            terminal={currentTerminal!}
            order={currentOp}
            apontamentos={apontamentos}
            selectedSector={selectedSector}
            onSelectSector={(s) => setSelectedSector(s)}
          />

          {/* Passo 2: Identificação do Colaborador */}
          <OperatorSelector
            selectedOperator={selectedOperator}
            selectedSector={selectedSector}
            currentTerminal={currentTerminal}
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
            isLoading={isLoading}
          />
        </div>
      </main>

      {/* Modal de Troca de Terminal Físico */}
      {showTerminalModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md overflow-y-auto flex items-center justify-center p-2 sm:p-4">
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
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0c142b] border-2 border-blue-900 w-full max-w-sm rounded-3xl p-6 shadow-2xl text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#1C2F8A] text-white flex items-center justify-center mx-auto mb-3 border border-blue-400/40">
              <KeyRound className="w-6 h-6" />
            </div>

            <h3 className="text-lg font-bold text-white">Acesso PCP & Coordenação</h3>
            <p className="text-xs text-slate-400 mt-1">
              Digite a senha/PIN de coordenação para acessar o portal de gestão (Padrão: <span className="font-mono text-blue-300">1234</span>).
            </p>

            <form onSubmit={handleUnlockPcp} className="mt-5 space-y-4">
              <input
                type="password"
                maxLength={8}
                autoFocus
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="PIN (1234)"
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
