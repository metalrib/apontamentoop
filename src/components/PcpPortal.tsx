import React, { useState, useEffect } from 'react';
import { Operator, ProductionOrder, Apontamento, TERMINALS, ROUTE_RULES } from '../types/mes';
import { getRouteForOp, getRouteEvaluation, obterQuantidadeTotal, obterEtapasDaRota } from '../utils/routeEngine';
import { addProductionOrder, saveMultipleOrders, resetFactoryData, deleteProductionOrder, clearAllOrders, deleteApontamento, clearAllApontamentos, fetchOperators } from '../services/mesStorage';
import { db, ref, update } from '../services/firebase';
import { parseNomusHtml, NomusParseResult, calculateDeadlineInfo } from '../utils/nomusParser';
import { MetalribLogo } from './MetalribLogo';
import { OpProductionCard } from './OpProductionCard';
import { OpChatModal } from './OpChatModal';
import { TeamManagementModal } from './TeamManagementModal';
import { TeamProductivity } from './TeamProductivity';
import { TerminalsOverview } from './TerminalsOverview';
import { AppointmentsHistory } from './AppointmentsHistory';
import {
  Factory,
  Layers,
  Plus,
  RefreshCw,
  Search,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Monitor,
  Users,
  Calendar,
  ArrowRight,
  TrendingUp,
  Download,
  Trash2,
  FileSpreadsheet,
  Tv,
  Code,
  Copy,
  Check,
  Eye,
  Maximize2,
  Upload,
  FileCode,
  Sparkles,
  LayoutGrid,
  List,
  MessageSquare
} from 'lucide-react';
import { playClick, playSuccessStart } from '../utils/audio';

interface PcpPortalProps {
  orders: Record<string, ProductionOrder>;
  apontamentos: Apontamento[];
  onSwitchToTotem: () => void;
  onSelectOpForTotem: (opNumero: string) => void;
  onOrdersUpdated?: (updatedOrders: Record<string, ProductionOrder>) => void;
  onClearOrders?: () => void;
}

export const PcpPortal: React.FC<PcpPortalProps> = ({
  orders,
  apontamentos,
  onSwitchToTotem,
  onSelectOpForTotem,
  onOrdersUpdated,
  onClearOrders
}) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'orders' | 'apontamentos' | 'productivity' | 'tv_status'>('dashboard');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'EM_PRODUCAO' | 'FINALIZADA'>('ALL');
  const [orderViewMode, setOrderViewMode] = useState<'cards' | 'table'>('cards');
  const [chatOrder, setChatOrder] = useState<ProductionOrder | null>(null);

  // Toast de Feedback Operacional
  const [feedbackToast, setFeedbackToast] = useState<{ message: string; type?: 'success' | 'info' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setFeedbackToast({ message, type });
    setTimeout(() => {
      setFeedbackToast((prev) => (prev?.message === message ? null : prev));
    }, 3500);
  };

  // TV Andon Search & Quick Filters
  const [andonSearchTerm, setAndonSearchTerm] = useState<string>('');
  const [andonFilterPill, setAndonFilterPill] = useState<'todas' | 'em_andamento' | 'concluidas' | 'atrasadas'>('todas');

  // Modal Importar HTML do Nomus ERP
  const [showNomusImportModal, setShowNomusImportModal] = useState<boolean>(false);
  const [nomusHtmlInput, setNomusHtmlInput] = useState<string>('');
  const [nomusParseResult, setNomusParseResult] = useState<NomusParseResult | null>(null);
  const [replaceExistingOrders, setReplaceExistingOrders] = useState<boolean>(true);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Modal Gestão de Equipe e Colaboradores
  const [showTeamModal, setShowTeamModal] = useState<boolean>(false);
  const [operatorsList, setOperatorsList] = useState<Operator[]>(() => fetchOperators());

  useEffect(() => {
    const handleUpdate = () => {
      setOperatorsList(fetchOperators());
    };
    window.addEventListener('metalrib_operators_updated', handleUpdate);
    return () => {
      window.removeEventListener('metalrib_operators_updated', handleUpdate);
    };
  }, []);

  // Modal Confirmação Limpar Lista
  const [showClearConfirmModal, setShowClearConfirmModal] = useState<boolean>(false);

  // Modais de Exclusão de Histórico de Apontamentos
  const [showClearAptsModal, setShowClearAptsModal] = useState<boolean>(false);
  const [apontamentoToDelete, setApontamentoToDelete] = useState<Apontamento | null>(null);
  const [aptsSearchTerm, setAptsSearchTerm] = useState<string>('');

  // Modal Nova OP Manual
  const [showNewOpModal, setShowNewOpModal] = useState<boolean>(false);
  const [newOpNumber, setNewOpNumber] = useState<string>('');
  const [newOpProductType, setNewOpProductType] = useState<string>('FOLHA');
  const [newOpDesc, setNewOpDesc] = useState<string>('FOLHA PORTA ISOTÉRMICA INOX 304 2100x900');
  const [newOpCodigo, setNewOpCodigo] = useState<string>('001.0118');
  const [newOpQtd, setNewOpQtd] = useState<number>(1);
  const [newOpDataEntrega, setNewOpDataEntrega] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toLocaleDateString('pt-BR');
  });
  const [newOpLote, setNewOpLote] = useState<string>('LT-2026-01');
  const [newOpClient, setNewOpClient] = useState<string>('');

  const orderList = Object.values(orders);

  // Filtro de OPs
  const filteredOrders = orderList.filter((op) => {
    const matchesSearch =
      op.op_numero.toLowerCase().includes(searchTerm.toLowerCase()) ||
      op.descricao.toLowerCase().includes(searchTerm.toLowerCase()) ||
      op.lote.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (op.codigo && op.codigo.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesStatus =
      statusFilter === 'ALL' ? true : op.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Métricas de Fábrica
  const totalOps = orderList.length;
  const activeApontamentos = apontamentos.filter((a) => a.status === 'EM_ANDAMENTO');
  const finishedApontamentos = apontamentos.filter((a) => a.status === 'FINALIZADO');
  const uniqueActiveOperators = new Set(activeApontamentos.map((a) => a.operador)).size;

  // Atualiza descrição ao escolher tipo de produto
  const handleProductTypeChange = (type: string) => {
    setNewOpProductType(type);
    const templates: Record<string, { desc: string; cod: string }> = {
      FOLHA: { desc: 'FOLHA PORTA ISOTÉRMICA INOX 304 2100x900', cod: '001.0118' },
      BAT: { desc: 'BATENTE BAT AÇO GALVANIZADO 2100x900', cod: '020.0033' },
      'OFFICE DOOR': { desc: 'PORTA OFFICE DOOR COM VISOR DUPLO', cod: '003.0044' },
      'PT GIR': { desc: 'PORTA PT GIR GIRATÓRIA REFORÇADA INOX', cod: '004.0055' },
      'PT VAI VEM': { desc: 'PORTA PT VAI VEM IMPACTO POLICARBONATO', cod: '005.0066' },
      ANCORA: { desc: 'ESTRUTURA ANCORA MONTAGEM PESADA', cod: '006.0077' },
      TRILHO: { desc: 'TRILHO DE PORTA DE CORRER EM ALUMÍNIO 3M', cod: '007.0088' },
      CORTINA: { desc: 'CORTINA EM PVC FLEXÍVEL POLAR -25°C', cod: '008.0099' }
    };
    if (templates[type]) {
      setNewOpDesc(templates[type].desc);
      setNewOpCodigo(templates[type].cod);
    }
  };

  const handleCreateOp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOpNumber.trim()) return;

    let cleanOp = newOpNumber.trim().toUpperCase();
    if (!cleanOp.startsWith('OP ')) {
      cleanOp = `OP ${cleanOp}`;
    }

    const newOrder: ProductionOrder = {
      op_numero: cleanOp,
      numero: cleanOp,
      descricao: newOpDesc.trim().toUpperCase() || 'PRODUTO FABRIL METALRIB',
      codigo: newOpCodigo.trim() || undefined,
      quantidade_total: Number(newOpQtd) || 1,
      lote: newOpLote.trim().toUpperCase() || 'LOTE-PADRAO',
      cliente: newOpClient.trim() || 'Cliente Geral',
      data_entrega: newOpDataEntrega.trim() || undefined,
      status: 'EM_PRODUCAO',
      status_fabrica: 'Produzindo Hoje',
      data_criacao: new Date().toISOString()
    };

    await addProductionOrder(newOrder);

    if (onOrdersUpdated) {
      onOrdersUpdated({
        ...orders,
        [newOrder.op_numero]: newOrder
      });
    }

    playSuccessStart();
    setShowNewOpModal(false);
    setNewOpNumber('');
    setNewOpClient('');
    showToast(`OP ${newOrder.numero || newOrder.op_numero} cadastrada com sucesso!`, 'success');
  };

  // Analisa o HTML do Nomus ao colar ou carregar arquivo
  const handleAnalyzeNomusHtml = (rawHtml: string) => {
    setNomusHtmlInput(rawHtml);
    setImportSuccessMsg(null);
    if (!rawHtml.trim()) {
      setNomusParseResult(null);
      return;
    }
    const result = parseNomusHtml(rawHtml);
    setNomusParseResult(result);
  };

  // Carregamento de arquivo .html / .htm
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      if (content) {
        handleAnalyzeNomusHtml(content);
        setShowNomusImportModal(true);
      }
    };
    reader.readAsText(file);
  };

  // Confirma a importação das OPs do Nomus para a fábrica
  const handleConfirmImportNomus = async () => {
    if (!nomusParseResult || nomusParseResult.orders.length === 0) return;
    playClick();

    // 1. Gravação direta e permanente no Firebase Realtime Database (/ordens_producao)
    const updates: Record<string, any> = {};
    nomusParseResult.orders.forEach((op: any) => {
      const opKey = String(op.numeroOP || op.op_numero || op.numero || op.id || '').replace(/[.#$[\]/]/g, '_');
      if (!opKey) return;
      const qtd = obterQuantidadeTotal(op);

      const descUpper = String(op.descricao || '').toUpperCase();
      const codStr = String(op.codigoProduto || op.cod || op.codigo || '').trim();

      let etapas = op.etapas;
      let etapaAtual = op.etapaAtual || 'Corte';
      let status = op.status || 'EM_PRODUCAO';

      // SE FOR LINHA SUPER CONG (007, 003 OU TEXTO SUPER CONG)
      const rotasCalculadas = obterEtapasDaRota(op);
      etapas = rotasCalculadas;
      etapaAtual = rotasCalculadas[0] || 'Corte';
      status = `Aguardando Início em: ${etapaAtual}`;

      op.etapas = etapas;
      op.etapaAtual = etapaAtual;
      op.statusEtapa = status;
      op.status = status;

      const cleanOp = JSON.parse(JSON.stringify({
        ...op,
        op_numero: op.op_numero || opKey,
        numero: op.numero || opKey,
        numeroOP: op.numeroOP || opKey,
        quantidade_total: qtd,
        quantidade: qtd,
        etapas,
        etapaAtual,
        statusEtapa: status,
        status,
        importadoEm: new Date().toISOString()
      }));
      updates[`ordens_producao/${opKey}`] = cleanOp;
    });

    try {
      await update(ref(db), updates);
    } catch (err) {
      console.error('[PCP] Erro ao gravar ordens diretamente no nó permanente do Firebase:', err);
    }

    const count = await saveMultipleOrders(nomusParseResult.orders, false);
    
    // Atualização imediata do estado em memória para reatividade instantânea
    const nextOrders: Record<string, ProductionOrder> = { ...orders };
    nomusParseResult.orders.forEach((o) => {
      if (o.op_numero) {
        nextOrders[o.op_numero] = o;
      }
    });

    if (onOrdersUpdated) {
      onOrdersUpdated(nextOrders);
    }

    playSuccessStart();
    setImportSuccessMsg(`🎉 ${count} Ordens de Produção do Nomus importadas e gravadas com sucesso no Firebase Realtime Database!`);
    showToast(`🎉 ${count} Ordens de Produção do Nomus importadas com sucesso!`, 'success');
    
    setTimeout(() => {
      setShowNomusImportModal(false);
      setNomusHtmlInput('');
      setNomusParseResult(null);
      setImportSuccessMsg(null);
    }, 1500);
  };

  // Limpa lista de OPs: aciona confirmação via window.confirm
  const handleClearOrdersList = async () => {
    playClick();
    const confirmed = window.confirm(
      'Deseja realmente apagar todas as Ordens de Produção carregadas no sistema e no Firebase? Esta ação deixará o painel zerado para receber os dados reais importados.'
    );
    if (!confirmed) return;
    await executeClearAllOrders();
  };

  const executeClearAllOrders = async () => {
    setShowClearConfirmModal(false);
    playClick();

    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('pcp_orders');
        localStorage.removeItem('mes_pcp_orders');
        localStorage.setItem('mes_pcp_orders', JSON.stringify({}));
      } catch (err) {
        console.warn('Storage error on clear', err);
      }
    }

    try {
      await clearAllOrders();
    } catch (err) {
      console.warn('clearAllOrders error', err);
    }

    if (onClearOrders) {
      onClearOrders();
    }
    if (onOrdersUpdated) {
      onOrdersUpdated({});
    }

    setNomusParseResult(null);
    setNomusHtmlInput('');
    setSearchTerm('');
    showToast('Lista de OPs limpa com sucesso!', 'success');
  };

  const handleExportCsv = () => {
    playClick();
    const headers = 'ID,OP,Unidade,Setor,Etapa,Terminal,Operador,Inicio,Fim,DuracaoMin,Status\n';
    const rows = apontamentos
      .map(
        (a) =>
          `"${a.id}","${a.op_numero}","${a.unidade_numero}","${a.setor}","${a.etapa_rota}","${a.terminal_id}","${a.operador}","${a.hora_inicio}","${a.hora_fim || ''}","${a.duracao_minutos || ''}","${a.status}"`
      )
      .join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `metalrib_apontamentos_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#070B16] text-slate-100 flex flex-col font-sans relative">
      {/* Input invisível de arquivo para importação do HTML do Nomus */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".html,.htm"
        className="hidden"
        onClick={(e) => {
          (e.target as HTMLInputElement).value = '';
        }}
        onChange={handleFileInputChange}
      />

      {/* Toast de Confirmação de Operações */}
      {feedbackToast && (
        <div className="fixed top-5 right-5 z-50 flex items-center gap-3 bg-[#0c142b] border-2 border-emerald-500 text-white px-5 py-3 rounded-2xl shadow-2xl shadow-black font-mono text-xs font-bold animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <span>{feedbackToast.message}</span>
          <button
            onClick={() => setFeedbackToast(null)}
            className="ml-3 text-slate-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Header do Portal PCP & Coordenação */}
      <header className="bg-[#0c142b] border-b border-blue-900/60 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 sticky top-0 z-40 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <MetalribLogo size="md" />
          <div className="border-l border-blue-900/80 pl-4 hidden md:block">
            <h1 className="text-sm font-black text-white tracking-wider font-mono flex items-center gap-2">
              <span>PORTAL DO PCP & COORDENAÇÃO</span>
              <span className="text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/40 px-2 py-0.5 rounded font-mono">
                SISTEMA GERENCIAL
              </span>
            </h1>
            <p className="text-xs text-slate-400 font-mono">Controle de Fluxo e Orquestração Industrial</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Botão de Importar HTML do Nomus */}
          <button
            onClick={() => {
              playClick();
              setShowNomusImportModal(true);
            }}
            className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs rounded-xl flex items-center gap-2 transition shadow-lg shadow-emerald-950/50 border border-emerald-400/50 cursor-pointer active:scale-95 ring-2 ring-emerald-500/20"
            title="Importar HTML do Status de Produção exportado do Nomus ERP"
          >
            <Upload className="w-4 h-4 text-emerald-200" />
            <span>Importar HTML do Nomus</span>
            <span className="bg-emerald-900/60 text-emerald-200 border border-emerald-400/40 px-1.5 py-0.2 text-[9px] rounded font-mono font-bold">
              OPs
            </span>
          </button>

          {/* Botão de Equipe / Colaboradores */}
          <button
            onClick={() => {
              playClick();
              setShowTeamModal(true);
            }}
            className="px-4 py-2 bg-gradient-to-r from-blue-700 to-indigo-700 hover:from-blue-600 hover:to-indigo-600 text-white font-bold text-xs rounded-xl flex items-center gap-2 transition shadow-lg shadow-indigo-950/50 border border-blue-400/50 cursor-pointer active:scale-95"
            title="Gestão de Colaboradores, Matrículas e Escala de Setores"
          >
            <Users className="w-4 h-4 text-blue-200" />
            <span>Equipe / Colaboradores</span>
            <span className="bg-blue-900/60 text-blue-200 border border-blue-400/40 px-1.5 py-0.2 text-[9px] rounded font-mono font-bold">
              ESCALA
            </span>
          </button>

          <button
            onClick={() => setActiveTab('tv_status')}
            className={`px-4 py-2 font-bold text-xs rounded-xl flex items-center gap-2 transition shadow-md border cursor-pointer active:scale-95 ${
              activeTab === 'tv_status'
                ? 'bg-amber-500 text-black border-amber-300 shadow-amber-500/20'
                : 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/50'
            }`}
            title="Acessar o Painel de Status de Produção e Gerador/Editor de HTML"
          >
            <Tv className="w-4 h-4" />
            <span>Status Produção (HTML / TV)</span>
          </button>

          <button
            onClick={() => setShowNewOpModal(true)}
            className="px-4 py-2 bg-[#1C2F8A] hover:bg-[#253eb8] text-white font-bold text-xs rounded-xl flex items-center gap-2 transition shadow-md shadow-blue-950 border border-blue-400/40 cursor-pointer active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>Nova OP Manual</span>
          </button>

          <button
            onClick={onSwitchToTotem}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl flex items-center gap-2 transition shadow-md border border-emerald-400/40 cursor-pointer active:scale-95"
            title="Ir para a interface de toque dos operadores nos 5 computadores"
          >
            <Monitor className="w-4 h-4" />
            <span>Abrir Modo Totem</span>
          </button>
        </div>
      </header>

      {/* Barra de Abas do PCP */}
      <div className="bg-[#090F21] border-b border-blue-950 px-6 flex items-center justify-between text-xs font-semibold overflow-x-auto">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`py-3.5 px-4 border-b-2 transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              activeTab === 'dashboard'
                ? 'border-blue-400 text-blue-300 bg-blue-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Factory className="w-4 h-4 text-blue-400" />
            <span>Visão Geral da Fábrica (5 Terminais)</span>
          </button>

          <button
            onClick={() => setActiveTab('orders')}
            className={`py-3.5 px-4 border-b-2 transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              activeTab === 'orders'
                ? 'border-blue-400 text-blue-300 bg-blue-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-4 h-4 text-blue-400" />
            <span>Ordens de Produção ({orderList.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('apontamentos')}
            className={`py-3.5 px-4 border-b-2 transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              activeTab === 'apontamentos'
                ? 'border-blue-400 text-blue-300 bg-blue-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="w-4 h-4 text-blue-400" />
            <span>Histórico de Apontamentos ({apontamentos.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('productivity')}
            className={`py-3.5 px-4 border-b-2 transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              activeTab === 'productivity'
                ? 'border-blue-400 text-blue-300 bg-blue-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <TrendingUp className="w-4 h-4 text-blue-400" />
            <span>Produtividade da Equipe</span>
          </button>

          <button
            onClick={() => setActiveTab('tv_status')}
            className={`py-3.5 px-4 border-b-2 transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              activeTab === 'tv_status'
                ? 'border-amber-400 text-amber-300 bg-amber-500/15'
                : 'border-transparent text-amber-400/80 hover:text-amber-200'
            }`}
          >
            <Tv className="w-4 h-4 text-amber-400" />
            <span>Painel TV Andon / Status</span>
            <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.2 text-[9px] rounded font-mono font-bold">
              AO VIVO
            </span>
          </button>
        </div>

        <button
          onClick={handleExportCsv}
          className="text-slate-400 hover:text-blue-300 flex items-center gap-1.5 text-xs py-2 px-3 rounded-lg hover:bg-blue-950 transition cursor-pointer"
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span className="hidden sm:inline">Exportar CSV</span>
        </button>
      </div>

      {/* Conteúdo Principal do PCP */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* ABA 1: VISÃO GERAL DA FÁBRICA */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* KPI Cards Strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-[#0c142b] border border-blue-900/60 p-5 rounded-2xl shadow-lg">
                <span className="text-xs font-mono text-slate-400 uppercase">Ordens no PCP</span>
                <div className="text-3xl font-black text-white mt-1 font-mono-num">{totalOps}</div>
                <span className="text-[11px] text-blue-400 font-medium">Cadastradas no sistema</span>
              </div>

              <div className="bg-[#0c142b] border border-blue-900/60 p-5 rounded-2xl shadow-lg">
                <span className="text-xs font-mono text-slate-400 uppercase">Operações Ativas</span>
                <div className="text-3xl font-black text-emerald-400 mt-1 font-mono-num">
                  {activeApontamentos.length}
                </div>
                <span className="text-[11px] text-slate-400">Em execução agora no chão</span>
              </div>

              <div className="bg-[#0c142b] border border-blue-900/60 p-5 rounded-2xl shadow-lg">
                <span className="text-xs font-mono text-slate-400 uppercase">Colaboradores em Ação</span>
                <div className="text-3xl font-black text-blue-300 mt-1 font-mono-num">
                  {uniqueActiveOperators} <span className="text-sm font-normal text-slate-500">de {operatorsList.length}</span>
                </div>
                <span className="text-[11px] text-slate-400">Alocados nos setores</span>
              </div>

              <div className="bg-[#0c142b] border border-blue-900/60 p-5 rounded-2xl shadow-lg">
                <span className="text-xs font-mono text-slate-400 uppercase">Etapas Concluídas</span>
                <div className="text-3xl font-black text-white mt-1 font-mono-num">
                  {finishedApontamentos.length}
                </div>
                <span className="text-[11px] text-emerald-400 font-medium">Apontamentos finalizados</span>
              </div>
            </div>

            {/* Status em Tempo Real dos 5 Terminais Físicos */}
            <TerminalsOverview
              orders={orders}
              apontamentos={apontamentos}
              onSelectOp={(opNum) => {
                onSelectOpForTotem(opNum);
                onSwitchToTotem();
              }}
            />
          </div>
        )}

        {/* ABA 2: GESTÃO DE ORDENS DE PRODUÇÃO (PCP) */}
        {activeTab === 'orders' && (
          <div className="space-y-4">
            {/* Barra de Filtros e Busca */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#0c142b] p-4 rounded-2xl border border-blue-900/60">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por Nº da OP, descrição ou lote..."
                  className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-white focus:outline-none focus:border-blue-400"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStatusFilter('ALL')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    statusFilter === 'ALL'
                      ? 'bg-[#1C2F8A] text-white'
                      : 'bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  Todas ({orderList.length})
                </button>
                <button
                  onClick={() => setStatusFilter('EM_PRODUCAO')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    statusFilter === 'EM_PRODUCAO'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  Em Produção
                </button>
                <button
                  onClick={() => setStatusFilter('FINALIZADA')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    statusFilter === 'FINALIZADA'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  Concluídas
                </button>

                <div className="h-6 w-px bg-blue-950 mx-1 hidden sm:block" />

                {/* Alternador de Visualização: Cards vs Tabela */}
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-blue-950">
                  <button
                    onClick={() => {
                      playClick();
                      setOrderViewMode('cards');
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition cursor-pointer ${
                      orderViewMode === 'cards'
                        ? 'bg-[#1C2F8A] text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                    title="Exibir como Cards de Chão de Fábrica"
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                    <span>Cards</span>
                  </button>
                  <button
                    onClick={() => {
                      playClick();
                      setOrderViewMode('table');
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition cursor-pointer ${
                      orderViewMode === 'table'
                        ? 'bg-[#1C2F8A] text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                    title="Exibir como Tabela"
                  >
                    <List className="w-3.5 h-3.5" />
                    <span>Tabela</span>
                  </button>
                </div>

                <div className="h-6 w-px bg-blue-950 mx-1 hidden sm:block" />

                <button
                  onClick={() => {
                    playClick();
                    setShowNomusImportModal(true);
                  }}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer active:scale-95 shadow-sm"
                  title="Importar HTML do Nomus para carregar todas as OPs"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Importar HTML Nomus</span>
                </button>

                {orderList.length > 0 && (
                  <button
                    onClick={handleClearOrdersList}
                    className="px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/40 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer active:scale-95"
                    title="Limpar lista de OPs"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                    <span>Limpar Lista</span>
                  </button>
                )}
              </div>
            </div>

            {/* Listagem de OPs */}
            {filteredOrders.length === 0 ? (
              <div className="border border-blue-900/60 rounded-2xl p-12 text-center bg-[#0c142b] shadow-2xl flex flex-col items-center justify-center gap-4">
                <Factory className="w-12 h-12 text-slate-600" />
                <span className="text-base font-semibold text-slate-200 max-w-lg">
                  Nenhuma ordem de produção em andamento. Importe o arquivo HTML do Nomus ou cadastre uma nova OP.
                </span>
                <div className="flex flex-wrap items-center justify-center gap-3 mt-1">
                  <button
                    onClick={() => {
                      playClick();
                      setShowNomusImportModal(true);
                    }}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer shadow-lg active:scale-95 transition"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Importar HTML do Nomus</span>
                  </button>
                  <button
                    onClick={() => {
                      playClick();
                      setShowNewOpModal(true);
                    }}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer shadow-lg active:scale-95 transition"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Nova OP Manual</span>
                  </button>
                </div>
              </div>
            ) : orderViewMode === 'cards' ? (
              /* MODO CARDS DE PRODUÇÃO IDENTICOS AO SISTEMA DE CHÃO DE FÁBRICA */
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredOrders.map((op) => (
                  <OpProductionCard
                    key={op.op_numero}
                    order={op}
                    apontamentos={apontamentos}
                    onOpenChat={(o) => setChatOrder(o)}
                    onSelectForTotem={(opNum) => {
                      onSelectOpForTotem(opNum);
                      onSwitchToTotem();
                    }}
                    onDelete={async (opNum) => {
                      const confirmed = typeof window !== 'undefined'
                        ? window.confirm(`Deseja realmente excluir a OP ${opNum}?`)
                        : true;
                      if (!confirmed) return;
                      playClick();
                      await deleteProductionOrder(opNum);
                      if (onOrdersUpdated) {
                        const next = { ...orders };
                        delete next[opNum];
                        onOrdersUpdated(next);
                      }
                      showToast(`OP ${opNum} excluída com sucesso!`, 'info');
                    }}
                  />
                ))}
              </div>
            ) : (
              /* MODO TABELA */
              <div className="border border-blue-900/60 rounded-2xl overflow-hidden bg-[#0c142b] shadow-2xl">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-[#090F21] text-slate-400 border-b border-blue-950">
                    <tr>
                      <th className="p-3.5">Nº OP</th>
                      <th className="p-3.5">DESCRIÇÃO DO PRODUTO</th>
                      <th className="p-3.5">ROTA IDENTIFICADA</th>
                      <th className="p-3.5 text-center">LOTE / QTD</th>
                      <th className="p-3.5">PROGRESSO</th>
                      <th className="p-3.5 text-right">AÇÕES</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-blue-950">
                    {filteredOrders.map((op) => {
                      const { rule } = getRouteForOp(op);
                      const steps = obterEtapasDaRota(op);
                      const evalResult = getRouteEvaluation(op, apontamentos, steps);
                      const lastStep = steps[steps.length - 1];
                      const finishedCount = evalResult[lastStep]?.finalizadas || 0;
                      const percent = Math.min(100, Math.round((finishedCount / op.quantidade_total) * 100));

                      return (
                        <tr key={op.op_numero} className="hover:bg-slate-900/60 transition">
                          <td className="p-3.5 font-bold text-blue-300 font-mono text-sm">
                            {op.numero || op.op_numero}
                          </td>
                          <td className="p-3.5 font-sans font-semibold text-slate-100 max-w-sm truncate">
                            {op.descricao}
                            <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                              Cód: {op.codigo || '—'} · Lote: {op.lote}
                            </div>
                          </td>
                          <td className="p-3.5">
                            <div className="flex flex-col gap-1 items-start">
                              <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 text-[11px] font-bold">
                                {rule.label}
                              </span>
                              {rule.badge && (
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                  rule.isStandardLine
                                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                    : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                                }`}>
                                  {rule.badge}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3.5 text-center text-slate-300">
                            {op.lote} <span className="text-white font-bold">({op.quantidade_total} un)</span>
                          </td>
                          <td className="p-3.5">
                            <div className="flex items-center gap-2">
                              <div className="w-24 h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                                <div
                                  className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 rounded-full transition-all"
                                  style={{ width: `${percent}%` }}
                                />
                              </div>
                              <span className="text-slate-400 text-[10px]">{percent}%</span>
                            </div>
                          </td>
                          <td className="p-3.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => setChatOrder(op)}
                                className="p-1.5 text-blue-400 hover:text-blue-200 hover:bg-blue-500/20 rounded-lg transition cursor-pointer"
                                title="Abrir conversa da OP"
                              >
                                <MessageSquare className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => {
                                  playClick();
                                  onSelectOpForTotem(op.op_numero);
                                  onSwitchToTotem();
                                }}
                                className="px-3 py-1.5 bg-[#1C2F8A] hover:bg-blue-600 text-white rounded-lg font-bold text-xs transition cursor-pointer active:scale-95"
                                title="Abrir esta OP diretamente no terminal de chão de fábrica"
                              >
                                Abrir no Totem
                              </button>
                              <button
                                onClick={async () => {
                                  const confirmed = typeof window !== 'undefined'
                                    ? window.confirm(`Deseja realmente excluir a OP ${op.op_numero}?`)
                                    : true;
                                  if (!confirmed) return;
                                  playClick();
                                  await deleteProductionOrder(op.op_numero);
                                  if (onOrdersUpdated) {
                                    const next = { ...orders };
                                    delete next[op.op_numero];
                                    onOrdersUpdated(next);
                                  }
                                  showToast(`OP ${op.op_numero} excluída com sucesso!`, 'info');
                                }}
                                className="p-1.5 text-rose-400 hover:text-rose-200 hover:bg-rose-500/20 rounded-lg transition cursor-pointer border border-transparent hover:border-rose-500/30"
                                title="Excluir esta OP"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ABA 3: HISTÓRICO DE APONTAMENTOS */}
        {activeTab === 'apontamentos' && (
          <AppointmentsHistory
            apontamentos={apontamentos}
            orders={orders}
            onClearAll={async () => {
              await clearAllApontamentos();
              showToast('Histórico de apontamentos excluído com sucesso!', 'info');
            }}
            onDeleteOne={async (apt) => {
              await deleteApontamento(apt.op_numero || apt.op || '', apt.id);
              showToast(`Apontamento da OP ${apt.op || apt.op_numero} excluído!`, 'info');
            }}
            onSelectOp={(opNum) => {
              onSelectOpForTotem(opNum);
              onSwitchToTotem();
            }}
            onExportCsv={handleExportCsv}
          />
        )}

        {/* ABA 4: PRODUTIVIDADE DA EQUIPE */}
        {activeTab === 'productivity' && (
          <TeamProductivity
            operators={operatorsList}
            apontamentos={apontamentos}
            orders={orders}
            onSelectOp={(opNum) => {
              onSelectOpForTotem(opNum);
              onSwitchToTotem();
            }}
          />
        )}

        {/* ABA 5: STATUS DE PRODUÇÃO / TV ANDON */}
        {activeTab === 'tv_status' && (() => {
          const checkOp100Percent = (op: ProductionOrder): boolean => {
            if (op.status === 'FINALIZADA') return true;
            const steps = obterEtapasDaRota(op);
            if (!steps || steps.length === 0) return false;
            const evaluation = getRouteEvaluation(op, apontamentos, steps);
            const total = Math.max(1, Math.round(op.quantidade_total || 1));
            return steps.every((s) => {
              const st = op.etapas?.[s];
              const ev = evaluation[s];
              return (st && st.status === 'CONCLUIDO') || (ev && ev.finalizadas >= total);
            });
          };

          const totalEmAndamento = orderList.filter((op) => op.status === 'EM_PRODUCAO' && !checkOp100Percent(op)).length;
          const totalConcluidas = orderList.filter((op) => checkOp100Percent(op)).length;
          const totalAtrasadas = orderList.filter((op) => calculateDeadlineInfo(op.data_entrega).isDelayed && !checkOp100Percent(op)).length;

          const filteredAndonOrders = orderList.filter((op) => {
            if (andonSearchTerm.trim()) {
              const query = andonSearchTerm.trim().toLowerCase();
              const matchOp = (op.op_numero || '').toLowerCase().includes(query) || (op.numero || '').toLowerCase().includes(query);
              const matchCode = (op.codigo || '').toLowerCase().includes(query);
              const matchDesc = (op.descricao || '').toLowerCase().includes(query);
              const matchClient = (op.cliente || '').toLowerCase().includes(query);
              if (!matchOp && !matchCode && !matchDesc && !matchClient) {
                return false;
              }
            }

            if (andonFilterPill === 'em_andamento') {
              return op.status === 'EM_PRODUCAO' && !checkOp100Percent(op);
            }
            if (andonFilterPill === 'concluidas') {
              return checkOp100Percent(op);
            }
            if (andonFilterPill === 'atrasadas') {
              return calculateDeadlineInfo(op.data_entrega).isDelayed && !checkOp100Percent(op);
            }
            return true;
          });

          return (
            <div className="space-y-6 animate-in fade-in duration-200">
              {/* Barra de Pesquisa e Filtros Rápidos no Topo */}
              <div className="bg-[#0c142b] border border-blue-900/60 p-5 rounded-2xl shadow-xl space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="relative flex h-3.5 w-3.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500" />
                    </span>
                    <div>
                      <h3 className="text-base font-extrabold text-white font-mono tracking-wide uppercase">
                        Painel Andon · Monitoramento Operacional ao Vivo
                      </h3>
                      <p className="text-xs text-slate-400 font-mono">
                        Visão respirada de chão de fábrica para TV e acompanhamento em tempo real
                      </p>
                    </div>
                  </div>

                  <div className="text-xs font-mono text-slate-400 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 shrink-0">
                    Exibindo <strong className="text-emerald-400">{filteredAndonOrders.length}</strong> de {orderList.length} OPs
                  </div>
                </div>

                {/* Barra de Pesquisa Proeminente */}
                <div className="relative">
                  <Search className="w-5 h-5 text-blue-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={andonSearchTerm}
                    onChange={(e) => setAndonSearchTerm(e.target.value)}
                    placeholder="🔍 Digite o número da OP ou Código da Peça..."
                    className="w-full pl-12 pr-10 py-3 bg-slate-950/90 border border-blue-900/70 rounded-xl font-mono text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 shadow-inner transition"
                  />
                  {andonSearchTerm && (
                    <button
                      onClick={() => setAndonSearchTerm('')}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white p-1 rounded-md text-xs font-mono"
                      title="Limpar pesquisa"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Filtros em Pílula Rápidos */}
                <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs font-mono">
                  <button
                    type="button"
                    onClick={() => setAndonFilterPill('todas')}
                    className={`px-3.5 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition cursor-pointer shrink-0 ${
                      andonFilterPill === 'todas'
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-900/50'
                        : 'bg-slate-950/80 border border-slate-800 text-slate-300 hover:bg-slate-900 hover:text-white'
                    }`}
                  >
                    <span>Todas</span>
                    <span className={`px-1.5 py-0.2 rounded text-[10px] ${andonFilterPill === 'todas' ? 'bg-blue-800 text-white' : 'bg-slate-800 text-slate-400'}`}>
                      {orderList.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAndonFilterPill('em_andamento')}
                    className={`px-3.5 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition cursor-pointer shrink-0 ${
                      andonFilterPill === 'em_andamento'
                        ? 'bg-blue-500/20 border border-blue-400 text-blue-200 shadow-md shadow-blue-950/40'
                        : 'bg-slate-950/80 border border-slate-800 text-slate-300 hover:bg-slate-900 hover:text-white'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                    <span>Em Andamento</span>
                    <span className={`px-1.5 py-0.2 rounded text-[10px] ${andonFilterPill === 'em_andamento' ? 'bg-blue-500/30 text-blue-200' : 'bg-slate-800 text-slate-400'}`}>
                      {totalEmAndamento}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAndonFilterPill('concluidas')}
                    className={`px-3.5 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition cursor-pointer shrink-0 ${
                      andonFilterPill === 'concluidas'
                        ? 'bg-emerald-500/20 border border-emerald-400 text-emerald-300 shadow-md shadow-emerald-950/40'
                        : 'bg-slate-950/80 border border-slate-800 text-slate-300 hover:bg-slate-900 hover:text-white'
                    }`}
                  >
                    <span>✅ 100% Concluídas</span>
                    <span className={`px-1.5 py-0.2 rounded text-[10px] ${andonFilterPill === 'concluidas' ? 'bg-emerald-500/30 text-emerald-200' : 'bg-slate-800 text-slate-400'}`}>
                      {totalConcluidas}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAndonFilterPill('atrasadas')}
                    className={`px-3.5 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition cursor-pointer shrink-0 ${
                      andonFilterPill === 'atrasadas'
                        ? 'bg-rose-500/20 border border-rose-400 text-rose-300 shadow-md shadow-rose-950/40'
                        : 'bg-slate-950/80 border border-slate-800 text-slate-300 hover:bg-slate-900 hover:text-white'
                    }`}
                  >
                    <span>⚠ Atrasadas</span>
                    <span className={`px-1.5 py-0.2 rounded text-[10px] ${andonFilterPill === 'atrasadas' ? 'bg-rose-500/30 text-rose-200' : 'bg-slate-800 text-slate-400'}`}>
                      {totalAtrasadas}
                    </span>
                  </button>
                </div>
              </div>

              {/* Grid Respirada de Cards */}
              {orderList.length === 0 ? (
                <div className="bg-[#0c142b] border border-blue-900/60 rounded-2xl p-12 text-center text-slate-400 space-y-3">
                  <Factory className="w-12 h-12 text-slate-600 mx-auto" />
                  <h4 className="text-base font-semibold text-slate-200 max-w-lg mx-auto">
                    Nenhuma ordem de produção em andamento. Importe o arquivo HTML do Nomus ou cadastre uma nova OP.
                  </h4>
                </div>
              ) : filteredAndonOrders.length === 0 ? (
                <div className="bg-[#0c142b] border border-blue-900/60 rounded-2xl p-12 text-center text-slate-400 font-mono space-y-2">
                  <Search className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                  <h4 className="text-base font-bold text-white">Nenhuma Ordem de Produção Encontrada</h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Tente alterar os termos da busca ou selecione o filtro <strong className="text-blue-400 cursor-pointer" onClick={() => { setAndonSearchTerm(''); setAndonFilterPill('todas'); }}>"Todas"</strong> para ver todas as ordens.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {filteredAndonOrders.map((op) => (
                    <OpProductionCard
                      key={op.op_numero}
                      order={op}
                      apontamentos={apontamentos}
                      onOpenChat={(o) => setChatOrder(o)}
                      onSelectForTotem={(opNum) => {
                        onSelectOpForTotem(opNum);
                        onSwitchToTotem();
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </main>

      {/* Modal de Cadastro de Nova OP */}
      {showNewOpModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0c142b] border-2 border-blue-900 w-full max-w-lg rounded-3xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-blue-900/80">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-blue-400" />
                <h3 className="text-lg font-bold text-white">Criar Nova Ordem de Produção (PCP)</h3>
              </div>
              <button
                onClick={() => setShowNewOpModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateOp} className="space-y-4">
              <div>
                <label className="text-xs font-mono text-slate-400 block mb-1">
                  MODELO / FAMÍLIA DE PRODUTO
                </label>
                <select
                  value={newOpProductType}
                  onChange={(e) => handleProductTypeChange(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-950 border border-blue-900 rounded-xl text-white font-mono text-xs focus:border-blue-400 focus:outline-none"
                >
                  <option value="FOLHA">FOLHA - Folha Standard / Isotérmica</option>
                  <option value="BAT">BAT - Batente</option>
                  <option value="OFFICE DOOR">OFFICE DOOR - Office Door</option>
                  <option value="PT GIR">PT GIR - Porta Giratória</option>
                  <option value="PT VAI VEM">PT VAI VEM - Porta Vai Vem</option>
                  <option value="ANCORA">ANCORA - Âncora / Fixação</option>
                  <option value="TRILHO">TRILHO - Trilho de Porta de Correr</option>
                  <option value="CORTINA">CORTINA - Cortina de PVC</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-mono text-slate-400 block mb-1">
                  NÚMERO DA OP (Ex: 023838-09)
                </label>
                <input
                  type="text"
                  required
                  value={newOpNumber}
                  onChange={(e) => setNewOpNumber(e.target.value.toUpperCase())}
                  placeholder="023838-09"
                  className="w-full px-4 py-2.5 bg-slate-950 border border-blue-900 rounded-xl text-white font-mono text-sm focus:border-blue-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-mono text-slate-400 block mb-1">
                  DESCRIÇÃO TÉCNICA DO PRODUTO
                </label>
                <input
                  type="text"
                  required
                  value={newOpDesc}
                  onChange={(e) => setNewOpDesc(e.target.value.toUpperCase())}
                  className="w-full px-4 py-2.5 bg-slate-950 border border-blue-900 rounded-xl text-white font-sans text-sm focus:border-blue-400 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-mono text-slate-400 block mb-1">
                    CÓDIGO DO ITEM (Cód)
                  </label>
                  <input
                    type="text"
                    value={newOpCodigo}
                    onChange={(e) => setNewOpCodigo(e.target.value)}
                    placeholder="Ex: 001.0118"
                    className="w-full px-4 py-2.5 bg-slate-950 border border-blue-900 rounded-xl text-white font-mono text-sm focus:border-blue-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-mono text-slate-400 block mb-1">
                    DATA DE ENTREGA
                  </label>
                  <input
                    type="text"
                    value={newOpDataEntrega}
                    onChange={(e) => setNewOpDataEntrega(e.target.value)}
                    placeholder="DD/MM/AAAA (ex: 28/10/2026)"
                    className="w-full px-4 py-2.5 bg-slate-950 border border-blue-900 rounded-xl text-white font-mono text-sm focus:border-blue-400 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-mono text-slate-400 block mb-1">
                    QUANTIDADE TOTAL
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    required
                    value={newOpQtd}
                    onChange={(e) => setNewOpQtd(parseInt(e.target.value, 10))}
                    className="w-full px-4 py-2.5 bg-slate-950 border border-blue-900 rounded-xl text-white font-mono text-sm focus:border-blue-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-mono text-slate-400 block mb-1">
                    LOTE / ENGENHARIA
                  </label>
                  <input
                    type="text"
                    required
                    value={newOpLote}
                    onChange={(e) => setNewOpLote(e.target.value.toUpperCase())}
                    className="w-full px-4 py-2.5 bg-slate-950 border border-blue-900 rounded-xl text-white font-mono text-sm focus:border-blue-400 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-mono text-slate-400 block mb-1">
                  CLIENTE / DESTINO (Opcional)
                </label>
                <input
                  type="text"
                  value={newOpClient}
                  onChange={(e) => setNewOpClient(e.target.value)}
                  placeholder="Ex: Frigorífico Estrela"
                  className="w-full px-4 py-2.5 bg-slate-950 border border-blue-900 rounded-xl text-white font-sans text-sm focus:border-blue-400 focus:outline-none"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-blue-950">
                <button
                  type="button"
                  onClick={() => setShowNewOpModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-[#1C2F8A] hover:bg-[#253eb8] text-white font-bold text-xs rounded-xl transition border border-blue-400/40 cursor-pointer"
                >
                  Salvar Ordem no PCP
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Importação do HTML de Status de OP do Nomus ERP */}
      {showNomusImportModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-[#0c142b] border-2 border-emerald-500/60 w-full max-w-4xl max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden my-auto">
            {/* Header do Modal - Fixo no Topo */}
            <div className="p-6 pb-4 border-b border-blue-900/80 flex items-center justify-between flex-shrink-0 bg-[#0c142b]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span>Importar HTML do Status do Nomus ERP</span>
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded font-mono">
                      SINCRONIZAÇÃO AUTOMÁTICA
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Cole o código HTML da tela de status/ordens de produção do Nomus ou carregue o arquivo .html exportado.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowNomusImportModal(false)}
                className="text-slate-400 hover:text-white p-2 text-base cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Corpo do Modal com Rolagem Livre (Mouse Scroll) */}
            <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
              {/* Mensagem de Sucesso */}
              {importSuccessMsg && (
                <div className="p-4 rounded-2xl bg-emerald-950/80 border border-emerald-500 text-emerald-200 text-sm font-bold flex items-center gap-3 animate-bounce">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                  <span>{importSuccessMsg}</span>
                </div>
              )}

              {/* Campo para colagem do HTML ou upload de arquivo */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-mono font-bold text-slate-200 flex items-center gap-2">
                    <FileCode className="w-4 h-4 text-emerald-400" />
                    <span>Cole o HTML do Nomus abaixo:</span>
                  </label>

                  {/* Upload de arquivo .html */}
                  <button
                    type="button"
                    onClick={() => {
                      playClick();
                      fileInputRef.current?.click();
                    }}
                    className="text-xs bg-slate-900 hover:bg-slate-800 text-slate-200 px-3.5 py-1.5 rounded-xl border border-slate-700 cursor-pointer flex items-center gap-1.5 transition active:scale-95"
                  >
                    <Upload className="w-3.5 h-3.5 text-blue-400" />
                    <span>Carregar Arquivo .html</span>
                  </button>
                </div>

                <div className="relative">
                  <textarea
                    value={nomusHtmlInput}
                    onChange={(e) => handleAnalyzeNomusHtml(e.target.value)}
                    placeholder="Cole aqui o HTML completo da página do Nomus (com <table>, <tr>, <td> contendo número de OP, descrição, quantidade, etc)..."
                    rows={4}
                    className="w-full p-3.5 bg-slate-950 border border-blue-900/80 rounded-2xl font-mono text-xs text-emerald-300 focus:outline-none focus:border-emerald-400 placeholder:text-slate-600"
                  />
                  {nomusHtmlInput && (
                    <button
                      onClick={() => handleAnalyzeNomusHtml('')}
                      className="absolute right-3 top-3 text-[11px] bg-slate-800 text-slate-400 hover:text-white px-2 py-1 rounded-md"
                    >
                      Limpar
                    </button>
                  )}
                </div>
              </div>

              {/* Resultado da Análise / Preview das OPs Identificadas */}
              {nomusParseResult && (
                <div className="space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      <span className="text-xs font-bold text-white font-mono">
                        {nomusParseResult.orders.length} Ordem(ns) de Produção Reconhecida(s) no Nomus
                      </span>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={replaceExistingOrders}
                        onChange={(e) => setReplaceExistingOrders(e.target.checked)}
                        className="rounded accent-emerald-500"
                      />
                      <span>Substituir todas as OPs existentes (limpar lista antiga)</span>
                    </label>
                  </div>

                  {nomusParseResult.warnings.length > 0 && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300">
                      {nomusParseResult.warnings.join(' ')}
                    </div>
                  )}

                  {/* Tabela de pré-visualização das OPs com as 9 colunas do Nomus */}
                  <div className="max-h-64 overflow-y-auto border border-blue-950 rounded-xl bg-slate-950/80">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-[#090F21] text-slate-400 sticky top-0 border-b border-blue-950">
                        <tr>
                          <th className="p-2.5">1. Entrega OP</th>
                          <th className="p-2.5">2. Status Nomus</th>
                          <th className="p-2.5">3. Descrição</th>
                          <th className="p-2.5">4. Cód</th>
                          <th className="p-2.5">5. Lote</th>
                          <th className="p-2.5">6. Obs</th>
                          <th className="p-2.5">7. Ordem (OP)</th>
                          <th className="p-2.5 text-center">8. Qtde</th>
                          <th className="p-2.5 text-center">9. Qtde Prod</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-blue-950/60">
                        {nomusParseResult.orders.map((o) => (
                          <tr key={o.op_numero} className="hover:bg-slate-900/50">
                            <td className="p-2.5 text-amber-300 font-bold whitespace-nowrap">
                              {o.data_entrega || '—'}
                            </td>
                            <td className="p-2.5">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 whitespace-nowrap">
                                {o.status_nomus || 'Liberada'}
                              </span>
                            </td>
                            <td className="p-2.5 text-slate-200 truncate max-w-[200px]" title={o.descricao}>
                              {o.descricao}
                            </td>
                            <td className="p-2.5 text-slate-400 whitespace-nowrap">
                              {o.codigo || '—'}
                            </td>
                            <td className="p-2.5 text-slate-300 whitespace-nowrap">
                              {o.lote || '—'}
                            </td>
                            <td className="p-2.5 text-slate-400 truncate max-w-[120px]" title={o.observacao || ''}>
                              {o.observacao || '—'}
                            </td>
                            <td className="p-2.5 font-bold text-emerald-400 whitespace-nowrap">
                              {o.numero || o.op_numero}
                            </td>
                            <td className="p-2.5 text-center font-bold text-white whitespace-nowrap">
                              {o.quantidade_m2 ? (
                                <span title={`${o.quantidade_m2} M² equivalem a ${o.quantidade_total} portas físicas`}>
                                  {Number(o.quantidade_m2).toFixed(2)} M² <span className="text-amber-400 font-mono text-[10px]">({o.quantidade_total} un)</span>
                                </span>
                              ) : (
                                <span>{o.quantidade_total} un</span>
                              )}
                            </td>
                            <td className="p-2.5 text-center font-mono text-slate-300 whitespace-nowrap">
                              {o.qtde_produzida ?? 0}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Footer de Ações do Modal - Fixo e Sempre Visível */}
            <div className="p-5 border-t border-blue-900/80 flex flex-col sm:flex-row items-center justify-between gap-3 flex-shrink-0 bg-[#090F21]">
              <span className="text-xs text-slate-400 font-mono text-center sm:text-left">
                Ao clicar em confirmar, todas as ordens ficarão disponíveis instantaneamente nos 5 terminais do chão de fábrica.
              </span>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setShowNomusImportModal(false)}
                  className="px-4 py-2.5 rounded-xl text-slate-400 hover:text-white text-xs font-bold cursor-pointer transition hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!nomusParseResult || nomusParseResult.orders.length === 0}
                  onClick={handleConfirmImportNomus}
                  className={`px-6 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition cursor-pointer active:scale-95 shadow-lg ${
                    nomusParseResult && nomusParseResult.orders.length > 0
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white border border-emerald-400/50 shadow-emerald-950'
                      : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                  }`}
                >
                  <Check className="w-4 h-4" />
                  <span>
                    Confirmar e Carregar {nomusParseResult ? nomusParseResult.orders.length : 0} OPs na Fábrica
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Conversa / Chat da OP */}
      {chatOrder && (
        <OpChatModal
          order={orders[chatOrder.op_numero] || chatOrder}
          onClose={() => setChatOrder(null)}
        />
      )}

      {/* Modal de Confirmação para Limpar Lista de OPs (100% In-App, sem window.confirm) */}
      {showClearConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0c142b] border-2 border-rose-500/80 w-full max-w-md rounded-3xl p-6 shadow-2xl text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/40 flex items-center justify-center mx-auto">
              <Trash2 className="w-7 h-7" />
            </div>

            <h3 className="text-lg font-bold text-white">Limpar Lista de Ordens de Produção?</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Deseja realmente apagar todas as <strong className="text-rose-400 font-bold">{orderList.length}</strong> Ordens de Produção atualmente carregadas? 
              <br />
              <span className="text-slate-400 mt-1 block">
                Esta ação limpa o storage e permite importar o HTML do Nomus ERP do zero com os dados limpos.
              </span>
            </p>

            <div className="flex items-center gap-3 pt-3">
              <button
                type="button"
                onClick={() => setShowClearConfirmModal(false)}
                className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={executeClearAllOrders}
                className="flex-1 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white text-xs font-bold transition cursor-pointer shadow-lg shadow-rose-950 border border-rose-400"
              >
                Sim, Limpar Lista
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmação Excluir Todo Histórico de Apontamentos */}
      {showClearAptsModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0b1122] border-2 border-rose-900/80 w-full max-w-md rounded-3xl p-6 shadow-2xl relative animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/40 flex items-center justify-center font-bold">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-black text-white font-mono">EXCLUIR HISTÓRICO</h3>
                <p className="text-xs text-rose-300 font-mono">Ação destrutiva e definitiva</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 mb-6 font-mono leading-relaxed">
              Tem certeza que deseja apagar todos os <span className="text-white font-bold">{apontamentos.length} registros</span> de apontamento de início e término dos terminais? Esta ação não pode ser desfeita.
            </p>

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowClearAptsModal(false)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 font-mono text-xs rounded-xl border border-slate-700 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  playClick();
                  await clearAllApontamentos();
                  setShowClearAptsModal(false);
                  showToast('Histórico de apontamentos excluído com sucesso!', 'info');
                }}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-mono font-bold text-xs rounded-xl border border-rose-400 transition cursor-pointer shadow-lg shadow-rose-950 flex items-center gap-2"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Sim, Excluir Tudo</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmação Excluir Apontamento Individual */}
      {apontamentoToDelete && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0b1122] border-2 border-rose-900/80 w-full max-w-md rounded-3xl p-6 shadow-2xl relative animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/40 flex items-center justify-center font-bold">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-white font-mono">EXCLUIR APONTAMENTO</h3>
                <p className="text-xs text-slate-400 font-mono">OP {apontamentoToDelete.op_numero} · Un #{apontamentoToDelete.unidade_numero}</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 mb-6 font-mono leading-relaxed">
              Excluir o registro de <span className="text-white font-bold">{apontamentoToDelete.operador}</span> no setor <span className="text-amber-400 font-bold">{apontamentoToDelete.setor}</span>?
            </p>

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setApontamentoToDelete(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 font-mono text-xs rounded-xl border border-slate-700 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  playClick();
                  await deleteApontamento(apontamentoToDelete.id, apontamentoToDelete.op_numero);
                  setApontamentoToDelete(null);
                  showToast('Apontamento excluído com sucesso!', 'info');
                }}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-mono font-bold text-xs rounded-xl border border-rose-400 transition cursor-pointer shadow-lg shadow-rose-950 flex items-center gap-2"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Excluir</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Gestão de Colaboradores e Escala de Setores */}
      <TeamManagementModal
        isOpen={showTeamModal}
        onClose={() => setShowTeamModal(false)}
        onOperatorsUpdated={() => setOperatorsList(fetchOperators())}
      />
    </div>
  );
};
