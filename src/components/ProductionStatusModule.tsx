import React, { useState, useEffect, useMemo, useDeferredValue, useCallback, useRef } from 'react';
import { ProductionOrder, Apontamento, OpMessageRow } from '../types/mes';
import {
  verificarECorrigirRotaOp,
  cleanOpId,
  formatOpNumber,
  atualizarStatusMacroOp,
  updateProductionOrder,
  fetchAllMensagens,
  fetchOpMensagens,
  enviarMensagemOp,
  responderMensagemOp,
  marcarMensagemLida,
  getLocalSocket
} from '../services/mesStorage';
import {
  isEntregaHoje,
  isAtrasada,
  getDiasRestantes,
  classificarBucketTimeline,
  parseDataEntrega
} from '../utils/pcpStatusUtils';
import {
  getRouteForOp,
  getRouteEvaluation,
  obterEtapasDaRota,
  checkOp100Percent,
  isOpConcluida,
  isOpEmProducao,
  isOpEmAberto
} from '../utils/routeEngine';
import { classificarModeloOP, MODELOS_PRODUTO } from '../utils/productClassifier';
import { playClick, playSuccessStart } from '../utils/audio';
import { OpProductionCard } from './OpProductionCard';
import { PcpDelayReasonModal } from './PcpDelayReasonModal';
import {
  AlertTriangle,
  Clock,
  Package,
  CheckCircle2,
  Search,
  X,
  MessageSquare,
  Star,
  Pause,
  Play,
  LayoutGrid,
  List,
  Columns,
  CalendarDays,
  BarChart3,
  ArrowLeft,
  Send,
  RefreshCw,
  Layers,
  ChevronRight,
  User,
  Shield,
  Check,
  CheckCheck,
  CornerDownRight,
  Filter,
  Maximize2
} from 'lucide-react';

interface ProductionStatusModuleProps {
  orders: Record<string, ProductionOrder>;
  apontamentos: Apontamento[];
  onSelectOpForTotem?: (opNumero: string) => void;
  onSwitchToTotem?: () => void;
  onBackToMes: () => void;
  onOrdersUpdated?: (orders: Record<string, ProductionOrder>) => void;
}


// Funções auxiliares para tratamento e formatação segura de data/hora no Chat/Inbox
const extractOpNumeroFromMsg = (m: any): string => {
  if (!m) return '';
  const raw =
    m.order_numero ||
    m.op_numero ||
    m.numero ||
    m.ordem_numero ||
    m.op ||
    m.numero_op ||
    m.order_id ||
    '';
  return cleanOpId(raw);
};

const extractTimestampFromMsg = (m: any): number => {
  if (!m) return Date.now();
  const raw =
    m.timestamp ||
    m.criado_em ||
    m.criadoEm ||
    m.createdAt ||
    m.dataHora ||
    m.data_hora;
  if (typeof raw === 'number' && !isNaN(raw) && raw > 0) return raw;
  if (typeof raw === 'string') {
    const num = Number(raw);
    if (!isNaN(num) && num > 0) return num;
    let s = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}/.test(s)) s = s.replace(' ', 'T');
    const t = new Date(s).getTime();
    if (!isNaN(t)) return t;
  }
  return Date.now();
};

const formatarDataMensagem = (raw?: any): string => {
  if (!raw) return '—';
  try {
    let t: number | null = null;
    if (typeof raw === 'object' && raw !== null) {
      t = extractTimestampFromMsg(raw);
    } else {
      t = extractTimestampFromMsg({ timestamp: raw });
    }
    if (!t || isNaN(t)) return '—';
    const d = new Date(t);
    if (isNaN(d.getTime())) return '—';

    const hoje = new Date();
    const isHoje =
      d.getDate() === hoje.getDate() &&
      d.getMonth() === hoje.getMonth() &&
      d.getFullYear() === hoje.getFullYear();

    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (isHoje) {
      return hora;
    }
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    return `${dia}/${mes} ${hora}`;
  } catch {
    return '—';
  }
};

export const ProductionStatusModule: React.FC<ProductionStatusModuleProps> = React.memo(({
  orders,
  apontamentos,
  onSelectOpForTotem,
  onSwitchToTotem,
  onBackToMes,
  onOrdersUpdated
}) => {
  // 1. Estados Principais de Filtro e Visualização
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [macroFilter, setMacroFilter] = useState<'NONE' | 'ATRASADAS' | 'HOJE' | 'FALTA_EMBALAR' | 'FINALIZADAS'>('NONE');
  const [quickFilter, setQuickFilter] = useState<'TODAS' | 'COM_CHAT' | 'PRIORITARIAS' | 'COM_ATRASO' | 'PAUSADAS'>('TODAS');
  const [selectedModel, setSelectedModel] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'lista' | 'kanban' | 'timeline' | 'analises'>('lista');
  const [orderViewType, setOrderViewType] = useState<'cards' | 'table'>('cards');

  // Paginação inteligente de 40 itens por vez
  const [pageSize, setPageSize] = useState<number>(40);

  // Modal de Motivo de Atraso
  const [delayModalOpen, setDelayModalOpen] = useState<boolean>(false);
  const [selectedDelayOrder, setSelectedDelayOrder] = useState<ProductionOrder | null>(null);

  // Feedback Toast
  const [toastMsg, setToastMsg] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);
  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToastMsg({ message, type });
    setTimeout(() => {
      setToastMsg((prev) => (prev?.message === message ? null : prev));
    }, 3500);
  };

  // 2. Chat / Mensagens
  const [allChatMessages, setAllChatMessages] = useState<OpMessageRow[]>([]);
  const [isInboxOpen, setIsInboxOpen] = useState<boolean>(true);
  const [inboxFilter, setInboxFilter] = useState<'todas' | 'nao_lidas'>('todas');
  const [inboxSearch, setInboxSearch] = useState<string>('');
  const [activeThreadOp, setActiveThreadOp] = useState<ProductionOrder | null>(null);
  const [threadMessages, setThreadMessages] = useState<OpMessageRow[]>([]);
  const [isLoadingThread, setIsLoadingThread] = useState<boolean>(false);
  const [chatRole, setChatRole] = useState<'pcp' | 'producao'>('pcp');
  const [replyText, setReplyText] = useState<string>('');
  const [replyingTo, setReplyingTo] = useState<OpMessageRow | null>(null);
  const [isSendingMsg, setIsSendingMsg] = useState<boolean>(false);
  const threadEndRef = useRef<HTMLDivElement>(null);

  // Sincronização de Mensagens
  const refreshMessages = useCallback(async () => {
    try {
      const list = await fetchAllMensagens();
      setAllChatMessages(list);
    } catch {}
  }, []);

  useEffect(() => {
    refreshMessages();
    let socket: any = null;
    try {
      socket = getLocalSocket();
      if (socket) {
        socket.on('nova_mensagem_op', refreshMessages);
        socket.on('mensagem_op_lida', refreshMessages);
        socket.on('mensagens_atualizadas', refreshMessages);
        return () => {
          socket.off('nova_mensagem_op', refreshMessages);
          socket.off('mensagem_op_lida', refreshMessages);
          socket.off('mensagens_atualizadas', refreshMessages);
        };
      }
    } catch {}
  }, [refreshMessages]);

  // Carga das mensagens do thread ativo
  const loadThreadMessages = useCallback(async (op: ProductionOrder) => {
    const cleanId = cleanOpId(op.numero || op.op_numero);
    setIsLoadingThread(true);
    try {
      const msgs = await fetchOpMensagens(cleanId);
      setThreadMessages(msgs || []);
      // Marca automaticamente as mensagens da outra parte como lidas
      for (const m of msgs || []) {
        if (!m.lida) {
          marcarMensagemLida(String(m.id), { leitor: chatRole }).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('Erro ao carregar mensagens do thread:', err);
    } finally {
      setIsLoadingThread(false);
    }
  }, [chatRole]);

  useEffect(() => {
    if (activeThreadOp) {
      loadThreadMessages(activeThreadOp);
    } else {
      setThreadMessages([]);
    }
  }, [activeThreadOp, loadThreadMessages]);

  useEffect(() => {
    if (threadMessages.length > 0) {
      threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [threadMessages]);

  // Mapa de mensagens não lidas por OP
  const unreadCountsByOp = useMemo(() => {
    const map: Record<string, number> = {};
    allChatMessages.forEach((m: any) => {
      const isUnread = !(m.lida || m.lida_pcp);
      if (isUnread) {
        const clean = extractOpNumeroFromMsg(m);
        if (clean) {
          map[clean] = (map[clean] || 0) + 1;
        }
      }
    });
    return map;
  }, [allChatMessages]);

  const totalUnreadChat = useMemo(() => {
    return allChatMessages.filter((m: any) => !(m.lida || m.lida_pcp)).length;
  }, [allChatMessages]);

  // Conjunto de OPs que possuem alguma mensagem registrada
  const chatOpSet = useMemo(() => {
    const set = new Set<string>();
    allChatMessages.forEach((m) => {
      set.add(cleanOpId(m.op_numero));
    });
    return set;
  }, [allChatMessages]);

  // 3. Processamento de Ordens
  const orderList = useMemo(() => {
    return Object.values(orders).map(verificarECorrigirRotaOp);
  }, [orders]);

  // 4 Contadores Clicáveis do PCP
  const pcpMacroCounts = useMemo(() => {
    let atrasadas = 0;
    let hoje = 0;
    let faltaEmbalar = 0;
    let finalizadas = 0;

    orderList.forEach((op) => {
      const isFin = op.status_macro === 'embalada' || op.status === 'FINALIZADA' || checkOp100Percent(op, apontamentos);
      if (isFin) {
        finalizadas++;
      } else if (op.status_macro === 'falta_embalar') {
        faltaEmbalar++;
      } else if (isEntregaHoje(op.data_entrega, op.status_macro)) {
        hoje++;
      } else if (isAtrasada(op.data_entrega, op.status_macro)) {
        atrasadas++;
      }
    });

    return { atrasadas, hoje, faltaEmbalar, finalizadas };
  }, [orderList, apontamentos]);

  // Contadores dinâmicos por Família
  const modelCounts = useMemo(() => {
    const counts: Record<string, number> = {
      ALL: orderList.length
    };
    MODELOS_PRODUTO.forEach((m) => {
      counts[m] = 0;
    });
    orderList.forEach((op) => {
      const modelo = classificarModeloOP(op);
      counts[modelo] = (counts[modelo] || 0) + 1;
    });
    return counts;
  }, [orderList]);

  // Filtro completo com useDeferredValue
  const deferredSearch = useDeferredValue(searchTerm);

  const filteredOrders = useMemo(() => {
    const searchLower = (deferredSearch || '').trim().toLowerCase();

    return orderList.filter((op) => {
      const isFin = op.status_macro === 'embalada' || op.status === 'FINALIZADA' || checkOp100Percent(op, apontamentos);

      // 1. Filtro dos 4 Contadores Clicáveis
      if (macroFilter === 'ATRASADAS') {
        if (isFin || op.status_macro === 'falta_embalar' || !isAtrasada(op.data_entrega, op.status_macro)) {
          return false;
        }
      } else if (macroFilter === 'HOJE') {
        if (isFin || op.status_macro === 'falta_embalar' || !isEntregaHoje(op.data_entrega, op.status_macro)) {
          return false;
        }
      } else if (macroFilter === 'FALTA_EMBALAR') {
        if (op.status_macro !== 'falta_embalar') {
          return false;
        }
      } else if (macroFilter === 'FINALIZADAS') {
        if (!isFin) {
          return false;
        }
      }

      // 2. Filtros Rápidos (Pílulas)
      if (quickFilter === 'COM_CHAT') {
        const cleanId = cleanOpId(op.numero || op.op_numero);
        if (!chatOpSet.has(cleanId)) return false;
      } else if (quickFilter === 'PRIORITARIAS') {
        if (!(op.favorito || op.prioridade === 'alta')) return false;
      } else if (quickFilter === 'COM_ATRASO') {
        if (!isAtrasada(op.data_entrega, op.status_macro) && !op.motivo_atraso) return false;
      } else if (quickFilter === 'PAUSADAS') {
        if (!op.pausada) return false;
      }

      // 3. Filtro por Família/Modelo
      if (selectedModel !== 'ALL' && classificarModeloOP(op) !== selectedModel) {
        return false;
      }

      // 4. Busca por texto
      if (searchLower) {
        const match = (
          (op.op_numero || '').toLowerCase().includes(searchLower) ||
          (op.numero || '').toLowerCase().includes(searchLower) ||
          (op.descricao || '').toLowerCase().includes(searchLower) ||
          ((op as any).produto || '').toLowerCase().includes(searchLower) ||
          (op.lote || '').toLowerCase().includes(searchLower) ||
          ((op.codigo || (op as any).codigoProduto || '').toLowerCase().includes(searchLower)) ||
          (op.cliente || '').toLowerCase().includes(searchLower)
        );
        if (!match) return false;
      }

      return true;
    });
  }, [orderList, macroFilter, quickFilter, selectedModel, deferredSearch, apontamentos, chatOpSet]);

  // Reseta a paginação ao trocar de filtro
  useEffect(() => {
    setPageSize(40);
  }, [macroFilter, quickFilter, selectedModel, deferredSearch]);

  const paginatedOrders = useMemo(() => {
    return filteredOrders.slice(0, pageSize);
  }, [filteredOrders, pageSize]);

  // 4. Ações Exclusivas do PCP
  const handleConfirmarEmbalagem = useCallback(async (op: ProductionOrder) => {
    playClick();
    const cleanId = cleanOpId(op.numero || op.op_numero);
    try {
      await atualizarStatusMacroOp(cleanId, { status_macro: 'embalada' });
      await updateProductionOrder(cleanId, { status_macro: 'embalada', status: 'FINALIZADA' } as any);
      playSuccessStart();
      showToast(`Embalagem da OP ${formatOpNumber(cleanId)} confirmada com sucesso! OP finalizada.`, 'success');
      if (onOrdersUpdated) {
        onOrdersUpdated({ ...orders, [cleanId]: { ...op, status_macro: 'embalada', status: 'FINALIZADA' } });
      }
    } catch (err) {
      console.error('Erro ao confirmar embalagem:', err);
      showToast(`Erro ao confirmar embalagem da OP ${cleanId}`, 'error');
    }
  }, [orders, onOrdersUpdated]);

  const handleTogglePrioridade = useCallback(async (op: ProductionOrder) => {
    playClick();
    const cleanId = cleanOpId(op.numero || op.op_numero);
    const nextFav = !Boolean(op.favorito || op.prioridade === 'alta');
    try {
      await atualizarStatusMacroOp(cleanId, {
        favorito: nextFav ? 1 : 0,
        prioridade: nextFav ? 'alta' : 'normal'
      });
      await updateProductionOrder(cleanId, {
        favorito: nextFav,
        prioridade: nextFav ? 'alta' : 'normal'
      } as any);
      showToast(nextFav ? `OP ${formatOpNumber(cleanId)} marcada como PRIORITÁRIA ⭐` : `Prioridade da OP ${formatOpNumber(cleanId)} removida`, 'info');
    } catch (err) {
      console.error('Erro ao alternar prioridade:', err);
    }
  }, []);

  const handleTogglePausada = useCallback(async (op: ProductionOrder) => {
    playClick();
    const cleanId = cleanOpId(op.numero || op.op_numero);
    const nextPausada = !Boolean(op.pausada);
    try {
      await atualizarStatusMacroOp(cleanId, { pausada: nextPausada ? 1 : 0 });
      await updateProductionOrder(cleanId, { pausada: nextPausada } as any);
      showToast(nextPausada ? `OP ${formatOpNumber(cleanId)} PAUSADA ⏸️` : `OP ${formatOpNumber(cleanId)} RETOMADA ▶️`, 'info');
    } catch (err) {
      console.error('Erro ao alternar pausa:', err);
    }
  }, []);

  const handleSinalizarAtraso = useCallback((op: ProductionOrder) => {
    setSelectedDelayOrder(op);
    setDelayModalOpen(true);
  }, []);

  const handleOpenOpChat = useCallback((op: ProductionOrder) => {
    setIsInboxOpen(true);
    setActiveThreadOp(op);
  }, []);

  // Envio de mensagem no chat integrado
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !activeThreadOp || isSendingMsg) return;

    const cleanId = cleanOpId(activeThreadOp.numero || activeThreadOp.op_numero);
    setIsSendingMsg(true);
    playClick();

    try {
      if (replyingTo) {
        await responderMensagemOp(String(replyingTo.id), {
          remetente: chatRole,
          texto: replyText.trim(),
          autor: chatRole === 'pcp' ? 'PCP' : 'Coordenação (Eduardo)'
        });
      } else {
        await enviarMensagemOp({
          order_numero: cleanId,
          texto: replyText.trim(),
          remetente: chatRole,
          order_desc: activeThreadOp.descricao || ''
        });
      }

      setReplyText('');
      setReplyingTo(null);
      await loadThreadMessages(activeThreadOp);
      await refreshMessages();
      playSuccessStart();
    } catch (err) {
      console.error('Erro ao enviar mensagem:', err);
      showToast('Erro ao enviar mensagem', 'error');
    } finally {
      setIsSendingMsg(false);
    }
  };

  // Conversas ativas agrupadas para o Inbox Lateral
  const inboxThreads = useMemo(() => {
    const threadMap: Record<string, { op: ProductionOrder; lastMsg: any; count: number; unread: number }> = {};

    allChatMessages.forEach((m: any) => {
      const cleanId = extractOpNumeroFromMsg(m);
      if (!cleanId) return;

      const op =
        orders[cleanId] ||
        orders['OP ' + cleanId] ||
        orders[cleanId.padStart(6, '0')] ||
        Object.values(orders).find((o) => cleanOpId(o.numero || o.op_numero) === cleanId) || {
          id: cleanId,
          numero: cleanId,
          op_numero: cleanId,
          descricao: m.order_desc || `OP ${cleanId}`,
          codigo: '',
          lote: '',
          quantidade_total: 1,
          status: 'EM_ANDAMENTO',
          etapas: {}
        };

      const isUnread = !(m.lida || m.lida_pcp);
      const msgTime = extractTimestampFromMsg(m);

      if (!threadMap[cleanId]) {
        threadMap[cleanId] = {
          op,
          lastMsg: m,
          count: 1,
          unread: isUnread ? 1 : 0
        };
      } else {
        threadMap[cleanId].count++;
        if (isUnread) threadMap[cleanId].unread++;
        // Mantém a mensagem mais recente
        if (msgTime > extractTimestampFromMsg(threadMap[cleanId].lastMsg)) {
          threadMap[cleanId].lastMsg = m;
        }
      }
    });

    let threads = Object.values(threadMap);

    // Filtro do inbox (todas vs não lidas)
    if (inboxFilter === 'nao_lidas') {
      threads = threads.filter((t) => t.unread > 0);
    }

    // Busca dentro do inbox
    if (inboxSearch.trim()) {
      const q = inboxSearch.trim().toLowerCase();
      threads = threads.filter(
        (t) =>
          formatOpNumber(t.op.numero || t.op.op_numero).toLowerCase().includes(q) ||
          (t.op.descricao || '').toLowerCase().includes(q) ||
          (t.lastMsg.texto || '').toLowerCase().includes(q)
      );
    }

    // Ordenação: não lidas no topo, depois as mais recentes
    return threads.sort((a, b) => {
      if (a.unread > 0 && b.unread === 0) return -1;
      if (b.unread > 0 && a.unread === 0) return 1;
      return extractTimestampFromMsg(b.lastMsg) - extractTimestampFromMsg(a.lastMsg);
    });
  }, [allChatMessages, orders, inboxFilter, inboxSearch]);

  // 5. Agrupamentos para Kanban, Linha do Tempo e Análises
  const kanbanColumns = useMemo(() => {
    return [
      {
        id: 'atrasadas',
        title: 'Atrasadas',
        icon: '⚠️',
        badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
        borderClass: 'border-rose-900/60',
        orders: filteredOrders.filter((op) => {
          const isFin = op.status_macro === 'embalada' || op.status === 'FINALIZADA' || checkOp100Percent(op, apontamentos);
          return !isFin && op.status_macro !== 'falta_embalar' && isAtrasada(op.data_entrega, op.status_macro);
        })
      },
      {
        id: 'hoje',
        title: 'Entrega Hoje',
        icon: '📅',
        badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        borderClass: 'border-amber-900/60',
        orders: filteredOrders.filter((op) => {
          const isFin = op.status_macro === 'embalada' || op.status === 'FINALIZADA' || checkOp100Percent(op, apontamentos);
          return !isFin && op.status_macro !== 'falta_embalar' && isEntregaHoje(op.data_entrega, op.status_macro);
        })
      },
      {
        id: 'producao',
        title: 'Em Produção nos Totens',
        icon: '🔵',
        badgeClass: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
        borderClass: 'border-blue-900/60',
        orders: filteredOrders.filter((op) => {
          const isFin = op.status_macro === 'embalada' || op.status === 'FINALIZADA' || checkOp100Percent(op, apontamentos);
          return (
            !isFin &&
            op.status_macro !== 'falta_embalar' &&
            !isAtrasada(op.data_entrega, op.status_macro) &&
            !isEntregaHoje(op.data_entrega, op.status_macro)
          );
        })
      },
      {
        id: 'falta_embalar',
        title: 'Falta Embalar (Portas)',
        icon: '📦',
        badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
        borderClass: 'border-purple-900/60',
        orders: filteredOrders.filter((op) => op.status_macro === 'falta_embalar')
      },
      {
        id: 'finalizadas',
        title: 'Finalizadas',
        icon: '✅',
        badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        borderClass: 'border-emerald-900/60',
        orders: filteredOrders.filter((op) => {
          return op.status_macro === 'embalada' || op.status === 'FINALIZADA' || checkOp100Percent(op, apontamentos);
        })
      }
    ];
  }, [filteredOrders, apontamentos]);

  const timelineBuckets = useMemo(() => {
    return [
      {
        id: 'atrasadas',
        label: '⚠️ Atrasadas (Prazo Vencido)',
        color: 'border-rose-500/60 bg-rose-950/20 text-rose-300',
        orders: filteredOrders.filter((op) => {
          const isFin = op.status_macro === 'embalada' || op.status === 'FINALIZADA' || checkOp100Percent(op, apontamentos);
          return !isFin && classificarBucketTimeline(op.data_entrega, op.status_macro) === 'atrasadas';
        })
      },
      {
        id: 'hoje',
        label: '📅 Entrega Hoje',
        color: 'border-amber-500/60 bg-amber-950/20 text-amber-300',
        orders: filteredOrders.filter((op) => {
          const isFin = op.status_macro === 'embalada' || op.status === 'FINALIZADA' || checkOp100Percent(op, apontamentos);
          return !isFin && classificarBucketTimeline(op.data_entrega, op.status_macro) === 'hoje';
        })
      },
      {
        id: 'proximos_3_dias',
        label: '🕒 Próximos 3 Dias',
        color: 'border-blue-500/60 bg-blue-950/20 text-blue-300',
        orders: filteredOrders.filter((op) => {
          const isFin = op.status_macro === 'embalada' || op.status === 'FINALIZADA' || checkOp100Percent(op, apontamentos);
          return !isFin && classificarBucketTimeline(op.data_entrega, op.status_macro) === 'proximos_3_dias';
        })
      },
      {
        id: 'esta_semana',
        label: '📆 Esta Semana (4 a 7 Dias)',
        color: 'border-indigo-500/60 bg-indigo-950/20 text-indigo-300',
        orders: filteredOrders.filter((op) => {
          const isFin = op.status_macro === 'embalada' || op.status === 'FINALIZADA' || checkOp100Percent(op, apontamentos);
          return !isFin && classificarBucketTimeline(op.data_entrega, op.status_macro) === 'esta_semana';
        })
      },
      {
        id: 'futuro',
        label: '🗓️ Futuro / Programadas / Concluídas',
        color: 'border-slate-800 bg-slate-950/60 text-slate-300',
        orders: filteredOrders.filter((op) => {
          const isFin = op.status_macro === 'embalada' || op.status === 'FINALIZADA' || checkOp100Percent(op, apontamentos);
          return isFin || classificarBucketTimeline(op.data_entrega, op.status_macro) === 'futuro';
        })
      }
    ];
  }, [filteredOrders, apontamentos]);

  // Métricas para a Visão Análises
  const totalComDataValida = useMemo(() => {
    return orderList.filter((o) => {
      const isFin = o.status_macro === 'embalada' || o.status === 'FINALIZADA' || checkOp100Percent(o, apontamentos);
      return !isFin && o.data_entrega && o.data_entrega !== '—';
    }).length;
  }, [orderList, apontamentos]);

  const totalAtrasadasAbertas = useMemo(() => {
    return orderList.filter((o) => {
      const isFin = o.status_macro === 'embalada' || o.status === 'FINALIZADA' || checkOp100Percent(o, apontamentos);
      return !isFin && isAtrasada(o.data_entrega, o.status_macro);
    }).length;
  }, [orderList, apontamentos]);

  const onTimePercentage = totalComDataValida > 0
    ? Math.max(0, Math.round(((totalComDataValida - totalAtrasadasAbertas) / totalComDataValida) * 100))
    : 100;

  const motivosRanking = useMemo(() => {
    const ranking: Record<string, number> = {};
    orderList.forEach((o) => {
      if (o.motivo_atraso) {
        ranking[o.motivo_atraso] = (ranking[o.motivo_atraso] || 0) + 1;
      }
    });
    return Object.entries(ranking).sort((a, b) => b[1] - a[1]);
  }, [orderList]);

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Toast de Feedback */}
      {toastMsg && (
        <div
          className={`fixed bottom-6 right-6 z-[999999] px-4 py-3 rounded-2xl shadow-2xl font-mono text-xs flex items-center gap-2 border animate-in slide-in-from-bottom-3 duration-200 ${
            toastMsg.type === 'success'
              ? 'bg-emerald-950/95 border-emerald-500/60 text-emerald-200'
              : toastMsg.type === 'error'
              ? 'bg-rose-950/95 border-rose-500/60 text-rose-200'
              : 'bg-blue-950/95 border-blue-500/60 text-blue-200'
          }`}
        >
          {toastMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          )}
          <span>{toastMsg.message}</span>
        </div>
      )}

      {/* CABEÇALHO DO MÓDULO STATUS DE PRODUÇÃO */}
      <div className="bg-[#0c142b] border border-blue-900/60 p-4 sm:p-5 rounded-2xl shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <button
            onClick={() => {
              playClick();
              onBackToMes();
            }}
            className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer active:scale-95 flex items-center gap-2 font-mono text-xs font-bold shrink-0"
            title="Voltar para a tela de Ordens de Produção (MES)"
          >
            <ArrowLeft className="w-4 h-4 text-blue-400" />
            <span className="hidden sm:inline">Voltar para Apontamento MES</span>
          </button>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-black text-white font-mono tracking-wide uppercase">
                Status de Produção & Prazos
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                PCP & COORDENAÇÃO
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Alimentado automaticamente pelo banco SQLite dos 5 terminais em tempo real
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => {
              playClick();
              setIsInboxOpen(!isInboxOpen);
            }}
            className={`px-3.5 py-2 rounded-xl text-xs font-mono font-bold flex items-center gap-2 border transition cursor-pointer active:scale-95 shadow-md ${
              isInboxOpen
                ? 'bg-gradient-to-r from-indigo-700 to-purple-700 text-white border-purple-400/60 shadow-purple-950/40'
                : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
            }`}
          >
            <MessageSquare className="w-4 h-4 text-purple-300" />
            <span>Inbox PCP ↔ Coordenação</span>
            {totalUnreadChat > 0 && (
              <span className="px-1.5 py-0.2 bg-rose-500 text-white rounded-full text-[10px] font-mono font-bold animate-pulse">
                {totalUnreadChat}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ÁREA 1: TOPO COM 4 CONTADORES CLICÁVEIS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Atrasadas */}
        <button
          type="button"
          onClick={() => {
            playClick();
            setMacroFilter((prev) => (prev === 'ATRASADAS' ? 'NONE' : 'ATRASADAS'));
          }}
          className={`p-4 rounded-2xl border text-left transition-all duration-200 cursor-pointer active:scale-98 shadow-lg flex flex-col justify-between ${
            macroFilter === 'ATRASADAS'
              ? 'bg-rose-950/80 border-rose-500 ring-2 ring-rose-500/50 shadow-rose-950/40'
              : 'bg-[#0c142b] border-blue-900/60 hover:border-rose-500/60 hover:bg-rose-950/20'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-rose-300 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              Atrasadas
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-bold border border-rose-500/40">
              PRAZO
            </span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-black text-rose-400 font-mono-num">{pcpMacroCounts.atrasadas}</span>
            <span className="text-[11px] text-slate-400">
              {macroFilter === 'ATRASADAS' ? 'Filtro Ativo ✓' : 'Clique p/ filtrar'}
            </span>
          </div>
        </button>

        {/* Entrega Hoje */}
        <button
          type="button"
          onClick={() => {
            playClick();
            setMacroFilter((prev) => (prev === 'HOJE' ? 'NONE' : 'HOJE'));
          }}
          className={`p-4 rounded-2xl border text-left transition-all duration-200 cursor-pointer active:scale-98 shadow-lg flex flex-col justify-between ${
            macroFilter === 'HOJE'
              ? 'bg-amber-950/80 border-amber-500 ring-2 ring-amber-500/50 shadow-amber-950/40'
              : 'bg-[#0c142b] border-blue-900/60 hover:border-amber-500/60 hover:bg-amber-950/20'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber-400" />
              Entrega Hoje
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40">
              HOJE
            </span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-black text-amber-400 font-mono-num">{pcpMacroCounts.hoje}</span>
            <span className="text-[11px] text-slate-400">
              {macroFilter === 'HOJE' ? 'Filtro Ativo ✓' : 'Clique p/ filtrar'}
            </span>
          </div>
        </button>

        {/* Falta Embalar */}
        <button
          type="button"
          onClick={() => {
            playClick();
            setMacroFilter((prev) => (prev === 'FALTA_EMBALAR' ? 'NONE' : 'FALTA_EMBALAR'));
          }}
          className={`p-4 rounded-2xl border text-left transition-all duration-200 cursor-pointer active:scale-98 shadow-lg flex flex-col justify-between ${
            macroFilter === 'FALTA_EMBALAR'
              ? 'bg-purple-950/80 border-purple-500 ring-2 ring-purple-500/50 shadow-purple-950/40'
              : 'bg-[#0c142b] border-blue-900/60 hover:border-purple-500/60 hover:bg-purple-950/20'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
              <Package className="w-4 h-4 text-purple-400" />
              Falta Embalar
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-bold border border-purple-500/40">
              EXPEDIÇÃO
            </span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-black text-purple-400 font-mono-num">{pcpMacroCounts.faltaEmbalar}</span>
            <span className="text-[11px] text-slate-400">
              {macroFilter === 'FALTA_EMBALAR' ? 'Filtro Ativo ✓' : 'Portas prontas'}
            </span>
          </div>
        </button>

        {/* Finalizadas */}
        <button
          type="button"
          onClick={() => {
            playClick();
            setMacroFilter((prev) => (prev === 'FINALIZADAS' ? 'NONE' : 'FINALIZADAS'));
          }}
          className={`p-4 rounded-2xl border text-left transition-all duration-200 cursor-pointer active:scale-98 shadow-lg flex flex-col justify-between ${
            macroFilter === 'FINALIZADAS'
              ? 'bg-emerald-950/80 border-emerald-500 ring-2 ring-emerald-500/50 shadow-emerald-950/40'
              : 'bg-[#0c142b] border-blue-900/60 hover:border-emerald-500/60 hover:bg-emerald-950/20'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Finalizadas
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40">
              100%
            </span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-black text-emerald-400 font-mono-num">{pcpMacroCounts.finalizadas}</span>
            <span className="text-[11px] text-slate-400">
              {macroFilter === 'FINALIZADAS' ? 'Filtro Ativo ✓' : 'Prontas/Embaladas'}
            </span>
          </div>
        </button>
      </div>

      {/* Banner de Filtro Ativo */}
      {macroFilter !== 'NONE' && (
        <div className="flex items-center justify-between bg-blue-950/80 border border-blue-500/50 px-4 py-2.5 rounded-2xl text-xs font-mono text-blue-200 shadow-md">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-ping shrink-0" />
            <span>
              Filtro ativo por contador rápido:{' '}
              <strong className="text-white uppercase font-bold">
                {macroFilter === 'ATRASADAS'
                  ? '⚠️ Atrasadas'
                  : macroFilter === 'HOJE'
                  ? '📅 Entrega Hoje'
                  : macroFilter === 'FALTA_EMBALAR'
                  ? '📦 Falta Embalar (Portas)'
                  : '✅ Finalizadas'}
              </strong>{' '}
              ({filteredOrders.length} OPs exibidas)
            </span>
          </div>
          <button
            onClick={() => {
              playClick();
              setMacroFilter('NONE');
            }}
            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-bold transition cursor-pointer active:scale-95"
          >
            Remover Filtro (✕)
          </button>
        </div>
      )}

      {/* BARRA DE BUSCA LARGA + FILTROS RÁPIDOS + SELETOR DE VISÃO */}
      <div className="bg-[#0c142b] p-3.5 rounded-2xl border border-blue-900/60 shadow-lg space-y-3">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Busca Larga com min-w-[340px] e Botão X */}
          <div className="relative flex-1 min-w-[340px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por Nº da OP, descrição, cód ou lote..."
              className="w-full pl-10 pr-9 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-white focus:outline-none focus:border-blue-400 placeholder-slate-500"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-white cursor-pointer"
                title="Limpar busca"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Seletor das 4 Visões */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-blue-950 shadow-inner shrink-0">
            <button
              onClick={() => {
                playClick();
                setViewMode('lista');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'lista' ? 'bg-[#1C2F8A] text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Lista</span>
            </button>
            <button
              onClick={() => {
                playClick();
                setViewMode('kanban');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'kanban' ? 'bg-[#1C2F8A] text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Columns className="w-3.5 h-3.5" />
              <span>Kanban</span>
            </button>
            <button
              onClick={() => {
                playClick();
                setViewMode('timeline');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'timeline' ? 'bg-[#1C2F8A] text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              <span>Linha do Tempo</span>
            </button>
            <button
              onClick={() => {
                playClick();
                setViewMode('analises');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'analises' ? 'bg-[#1C2F8A] text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Análises</span>
            </button>

            {viewMode === 'lista' && (
              <div className="flex items-center gap-0.5 ml-1 pl-1 border-l border-slate-800">
                <button
                  onClick={() => setOrderViewType('cards')}
                  className={`p-1 rounded transition ${orderViewType === 'cards' ? 'text-blue-300' : 'text-slate-500'}`}
                  title="Cards"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setOrderViewType('table')}
                  className={`p-1 rounded transition ${orderViewType === 'table' ? 'text-blue-300' : 'text-slate-500'}`}
                  title="Tabela"
                >
                  <List className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Filtros Rápidos (Pílulas) */}
        <div className="flex items-center gap-2 flex-wrap border-t border-blue-950/80 pt-2.5">
          <span className="text-[11px] font-mono text-slate-400 font-bold uppercase mr-1">Filtros Rápidos:</span>
          <button
            onClick={() => {
              playClick();
              setQuickFilter('TODAS');
            }}
            className={`px-3 py-1 rounded-xl text-xs font-mono font-bold transition cursor-pointer ${
              quickFilter === 'TODAS'
                ? 'bg-[#1C2F8A] text-white border border-blue-400/60 shadow-sm'
                : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            Todas ({orderList.length})
          </button>

          <button
            onClick={() => {
              playClick();
              setQuickFilter('COM_CHAT');
            }}
            className={`px-3 py-1 rounded-xl text-xs font-mono font-bold transition cursor-pointer flex items-center gap-1.5 ${
              quickFilter === 'COM_CHAT'
                ? 'bg-indigo-600 text-white border border-indigo-400 shadow-sm'
                : 'bg-slate-900 text-indigo-300 hover:text-white border border-indigo-500/30'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>💬 Com Chat/Aviso PCP ({chatOpSet.size})</span>
          </button>

          <button
            onClick={() => {
              playClick();
              setQuickFilter('PRIORITARIAS');
            }}
            className={`px-3 py-1 rounded-xl text-xs font-mono font-bold transition cursor-pointer flex items-center gap-1.5 ${
              quickFilter === 'PRIORITARIAS'
                ? 'bg-amber-500 text-slate-950 font-black border border-amber-300 shadow-md ring-1 ring-amber-400/50'
                : 'bg-slate-900 text-amber-400 hover:text-amber-200 border border-amber-500/30'
            }`}
          >
            <Star className="w-3.5 h-3.5 fill-amber-400" />
            <span>⭐ Prioritárias</span>
          </button>

          <button
            onClick={() => {
              playClick();
              setQuickFilter('COM_ATRASO');
            }}
            className={`px-3 py-1 rounded-xl text-xs font-mono font-bold transition cursor-pointer flex items-center gap-1.5 ${
              quickFilter === 'COM_ATRASO'
                ? 'bg-rose-600 text-white border border-rose-400 shadow-md'
                : 'bg-slate-900 text-rose-300 hover:text-white border border-rose-500/30'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>⚠️ Com Atraso</span>
          </button>

          <button
            onClick={() => {
              playClick();
              setQuickFilter('PAUSADAS');
            }}
            className={`px-3 py-1 rounded-xl text-xs font-mono font-bold transition cursor-pointer flex items-center gap-1.5 ${
              quickFilter === 'PAUSADAS'
                ? 'bg-amber-600 text-white border border-amber-400 shadow-md'
                : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <span>⏸️ Pausadas</span>
          </button>
        </div>

        {/* Seletor Horizontal de Famílias */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1 no-scrollbar flex-nowrap sm:flex-wrap border-t border-blue-950/80">
          <button
            onClick={() => {
              playClick();
              setSelectedModel('ALL');
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 shrink-0 ${
              selectedModel === 'ALL'
                ? 'bg-[#1C2F8A] text-white border border-blue-400/80 shadow-md ring-1 ring-blue-400/30'
                : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Todas Famílias</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-md text-[10px] bg-slate-950 border border-slate-800">
              {modelCounts['ALL'] || 0}
            </span>
          </button>

          {MODELOS_PRODUTO.map((modelo) => {
            const count = modelCounts[modelo] || 0;
            const isSelected = selectedModel === modelo;

            return (
              <button
                key={modelo}
                onClick={() => {
                  playClick();
                  setSelectedModel(modelo);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  isSelected
                    ? 'bg-[#1C2F8A] text-white border border-blue-400/80 shadow-md font-bold ring-1 ring-blue-400/30'
                    : count > 0
                    ? 'bg-slate-900/80 text-slate-300 hover:text-white border border-slate-800'
                    : 'bg-slate-950/60 text-slate-500 border border-slate-900'
                }`}
              >
                <span>{modelo}</span>
                <span className="ml-1 px-1.5 py-0.2 rounded-md text-[10px] font-mono font-bold bg-slate-950 border border-slate-800">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ÁREA 2: LAYOUT DIVIDIDO (CONTEÚDO PRINCIPAL + INBOX LATERAL) */}
      <div className="flex flex-col xl:flex-row gap-5 items-start">
        {/* Painel Principal (Esquerda / Centro) */}
        <div className="flex-1 min-w-0 w-full space-y-4">
          {filteredOrders.length === 0 ? (
            <div className="border border-blue-900/60 rounded-2xl p-12 text-center bg-[#0c142b] shadow-2xl flex flex-col items-center justify-center gap-4">
              <Package className="w-12 h-12 text-slate-600" />
              <span className="text-base font-semibold text-slate-200 max-w-lg">
                Nenhuma ordem de produção encontrada para os filtros selecionados no Status de Produção.
              </span>
              <button
                onClick={() => {
                  playClick();
                  setMacroFilter('NONE');
                  setQuickFilter('TODAS');
                  setSelectedModel('ALL');
                  setSearchTerm('');
                }}
                className="px-4 py-2 bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 border border-blue-500/40 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Limpar Filtros e Mostrar Carteira Geral
              </button>
            </div>
          ) : viewMode === 'lista' ? (
            /* VISÃO 1: LISTA */
            orderViewType === 'cards' ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {paginatedOrders.map((op, index) => (
                    <OpProductionCard
                      key={`${op.id || op.numero || op.op_numero}-${index}`}
                      order={op}
                      apontamentos={apontamentos}
                      onOpenChat={handleOpenOpChat}
                      onSelectForTotem={onSelectOpForTotem}
                      onConfirmarEmbalagem={handleConfirmarEmbalagem}
                      onTogglePrioridade={handleTogglePrioridade}
                      onTogglePausada={handleTogglePausada}
                      onSinalizarAtraso={handleSinalizarAtraso}
                      unreadCount={unreadCountsByOp[cleanOpId(op.numero || op.op_numero)] || 0}
                      hideQuantitySelector={true}
                      compact={true}
                      readOnlyRoute={true}
                    />
                  ))}
                </div>

                {/* Paginação de 40 itens */}
                {filteredOrders.length > pageSize && (
                  <div className="p-4 bg-[#0c142b] border border-blue-900/60 rounded-2xl text-center space-y-2">
                    <p className="text-xs font-mono text-slate-400">
                      Exibindo <strong>{paginatedOrders.length}</strong> de <strong>{filteredOrders.length}</strong> OPs
                    </p>
                    <div className="flex items-center justify-center gap-3">
                      <button
                        onClick={() => {
                          playClick();
                          setPageSize((prev) => prev + 40);
                        }}
                        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-mono font-bold transition cursor-pointer active:scale-95 shadow-md"
                      >
                        Carregar mais 40 OPs
                      </button>
                      <button
                        onClick={() => {
                          playClick();
                          setPageSize(filteredOrders.length);
                        }}
                        className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-mono font-bold transition cursor-pointer active:scale-95 border border-slate-700"
                      >
                        Mostrar Todas ({filteredOrders.length})
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* TABELA COMPACTA */
              <div className="border border-blue-900/60 rounded-2xl overflow-hidden bg-[#0c142b] shadow-2xl">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-[#090F21] text-slate-400 border-b border-blue-950">
                    <tr>
                      <th className="p-3.5">Nº OP</th>
                      <th className="p-3.5">DESCRIÇÃO DO PRODUTO</th>
                      <th className="p-3.5">STATUS MACRO / PRAZO</th>
                      <th className="p-3.5 text-center">LOTE / QTD</th>
                      <th className="p-3.5 text-right">AÇÕES PCP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-blue-950">
                    {paginatedOrders.map((op, index) => {
                      const unreadCount = unreadCountsByOp[cleanOpId(op.numero || op.op_numero)] || 0;
                      return (
                        <tr key={`${op.id || op.numero || op.op_numero}-${index}`} className="hover:bg-slate-900/60 transition">
                          <td className="p-3.5 font-bold text-blue-300 font-mono text-sm">
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => handleTogglePrioridade(op)}
                                className="cursor-pointer"
                              >
                                <Star
                                  className={`w-3.5 h-3.5 ${
                                    op.favorito || op.prioridade === 'alta' ? 'fill-amber-400 text-amber-400' : 'text-slate-600'
                                  }`}
                                />
                              </button>
                              <span>{formatOpNumber(op.numero || op.op_numero)}</span>
                            </div>
                          </td>
                          <td className="p-3.5 font-sans max-w-sm">
                            <div className="font-semibold text-slate-100 truncate">{op.descricao}</div>
                            <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                              Cód: {op.codigo || '—'} · {classificarModeloOP(op)}
                            </div>
                          </td>
                          <td className="p-3.5">
                            {op.status_macro === 'falta_embalar' ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">
                                📦 Falta Embalar
                              </span>
                            ) : isAtrasada(op.data_entrega, op.status_macro) ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                ⚠️ Atrasada ({op.data_entrega})
                              </span>
                            ) : isEntregaHoje(op.data_entrega, op.status_macro) ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                📅 Entrega Hoje
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                                Prazo: {op.data_entrega || '—'}
                              </span>
                            )}
                          </td>
                          <td className="p-3.5 text-center text-slate-300">
                            {op.lote} <span className="text-white font-bold">({op.quantidade_total} un)</span>
                          </td>
                          <td className="p-3.5 text-right">
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              {op.status_macro === 'falta_embalar' && (
                                <button
                                  onClick={() => handleConfirmarEmbalagem(op)}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-[11px] transition cursor-pointer"
                                >
                                  ✓ Embalar
                                </button>
                              )}
                              <button
                                onClick={() => handleSinalizarAtraso(op)}
                                className="p-1 text-slate-400 hover:text-amber-400 rounded-lg"
                                title="Sinalizar Atraso"
                              >
                                <AlertTriangle className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleTogglePausada(op)}
                                className={`p-1 rounded-lg ${op.pausada ? 'text-amber-400' : 'text-slate-400'}`}
                                title={op.pausada ? 'Retomar' : 'Pausar'}
                              >
                                {op.pausada ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                              </button>
                              <button
                                onClick={() => handleOpenOpChat(op)}
                                className="relative p-1 text-blue-400 hover:text-blue-200 rounded-lg"
                                title="Chat"
                              >
                                <MessageSquare className="w-4 h-4" />
                                {unreadCount > 0 && (
                                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-rose-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center">
                                    {unreadCount}
                                  </span>
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : viewMode === 'kanban' ? (
            /* VISÃO 2: QUADRO KANBAN */
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3.5 items-start">
              {kanbanColumns.map((col) => (
                <div
                  key={col.id}
                  className={`bg-[#0c142b] border rounded-2xl p-3.5 flex flex-col shadow-xl min-h-[450px] ${col.borderClass}`}
                >
                  <div className="flex items-center justify-between pb-3 border-b border-blue-950 mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{col.icon}</span>
                      <span className="font-mono font-bold text-xs text-white uppercase tracking-wider">{col.title}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-mono font-bold border ${col.badgeClass}`}>
                      {col.orders.length}
                    </span>
                  </div>

                  <div className="space-y-2.5 flex-1 max-h-[72vh] overflow-y-auto pr-1 no-scrollbar">
                    {col.orders.length === 0 ? (
                      <div className="py-10 text-center text-slate-600 font-mono text-xs">Nenhuma OP nesta etapa</div>
                    ) : (
                      col.orders.map((op) => {
                        const unreadCount = unreadCountsByOp[cleanOpId(op.numero || op.op_numero)] || 0;
                        const dias = getDiasRestantes(op.data_entrega);

                        return (
                          <div
                            key={op.op_numero || op.numero}
                            className={`p-3 rounded-xl border transition-all text-xs font-mono shadow-md ${
                              op.status_macro === 'falta_embalar'
                                ? 'bg-purple-950/40 border-purple-500/50'
                                : isAtrasada(op.data_entrega, op.status_macro)
                                ? 'bg-rose-950/40 border-rose-500/40'
                                : 'bg-slate-950/80 border-blue-950'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1 mb-1.5">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleTogglePrioridade(op)}
                                  className="p-0.5 text-slate-500 hover:text-amber-400 cursor-pointer"
                                >
                                  <Star
                                    className={`w-3.5 h-3.5 ${
                                      op.favorito || op.prioridade === 'alta' ? 'fill-amber-400 text-amber-400' : ''
                                    }`}
                                  />
                                </button>
                                <span className="font-black text-blue-200">
                                  {formatOpNumber(op.numero || op.op_numero)}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-400 font-bold truncate max-w-[90px]">
                                {classificarModeloOP(op)}
                              </span>
                            </div>

                            <p className="font-sans text-slate-200 font-semibold text-xs line-clamp-2 leading-snug mb-2">
                              {op.descricao}
                            </p>

                            <div className="flex items-center gap-1.5 flex-wrap mb-2">
                              {dias !== null && dias < 0 ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                  Atraso {Math.abs(dias)}d
                                </span>
                              ) : dias === 0 ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                  Hoje
                                </span>
                              ) : dias !== null ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                                  {dias}d
                                </span>
                              ) : null}

                              {op.pausada && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                  ⏸️ Pausada
                                </span>
                              )}
                            </div>

                            {op.motivo_atraso && (
                              <div className="text-[10px] text-amber-300 mb-2 truncate bg-amber-950/40 border border-amber-500/30 px-1.5 py-0.5 rounded">
                                ⚠️ {op.motivo_atraso}
                              </div>
                            )}

                            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-1">
                              {op.status_macro === 'falta_embalar' ? (
                                <button
                                  type="button"
                                  onClick={() => handleConfirmarEmbalagem(op)}
                                  className="flex-1 py-1 px-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-[10px] flex items-center justify-center gap-1 transition cursor-pointer active:scale-95 shadow-sm"
                                >
                                  <CheckCircle2 className="w-3 h-3 text-emerald-200" />
                                  <span>Confirmar Embalagem</span>
                                </button>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleSinalizarAtraso(op)}
                                    className="p-1 rounded text-slate-400 hover:text-amber-400"
                                    title="Sinalizar Atraso"
                                  >
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleTogglePausada(op)}
                                    className="p-1 rounded text-slate-400 hover:text-white"
                                    title={op.pausada ? 'Retomar' : 'Pausar'}
                                  >
                                    {op.pausada ? <Play className="w-3.5 h-3.5 text-amber-400" /> : <Pause className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                              )}

                              <button
                                type="button"
                                onClick={() => handleOpenOpChat(op)}
                                className="p-1 rounded text-blue-400 hover:text-blue-200 transition cursor-pointer flex items-center gap-1"
                                title="Abrir Chat"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                                {unreadCount > 0 && (
                                  <span className="w-3.5 h-3.5 bg-rose-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center">
                                    {unreadCount}
                                  </span>
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : viewMode === 'timeline' ? (
            /* VISÃO 3: LINHA DO TEMPO */
            <div className="space-y-4">
              {timelineBuckets.map((bucket) => (
                <div key={bucket.id} className={`p-4 rounded-2xl border shadow-xl bg-[#0c142b] ${bucket.color}`}>
                  <div className="flex items-center justify-between pb-3 border-b border-blue-950/80 mb-3">
                    <span className="font-mono font-bold text-sm tracking-wide">{bucket.label}</span>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-slate-900 border border-slate-700 text-white">
                      {bucket.orders.length} OPs
                    </span>
                  </div>

                  {bucket.orders.length === 0 ? (
                    <p className="text-xs font-mono text-slate-500 py-3 text-center">
                      Nenhuma ordem de produção neste intervalo de prazo.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {bucket.orders.map((op) => {
                        const dias = getDiasRestantes(op.data_entrega);
                        const unreadCount = unreadCountsByOp[cleanOpId(op.numero || op.op_numero)] || 0;

                        return (
                          <div
                            key={op.op_numero || op.numero}
                            className="p-3.5 rounded-xl bg-slate-950/90 border border-blue-950 text-xs font-mono shadow-md flex flex-col justify-between"
                          >
                            <div>
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-1.5">
                                  <button onClick={() => handleTogglePrioridade(op)}>
                                    <Star
                                      className={`w-3.5 h-3.5 ${
                                        op.favorito || op.prioridade === 'alta' ? 'fill-amber-400 text-amber-400' : 'text-slate-600'
                                      }`}
                                    />
                                  </button>
                                  <span className="font-bold text-blue-300 text-sm">
                                    {formatOpNumber(op.numero || op.op_numero)}
                                  </span>
                                </div>
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                                  {dias !== null && dias < 0
                                    ? `Vencida (${Math.abs(dias)}d)`
                                    : dias === 0
                                    ? 'Entrega Hoje'
                                    : dias !== null
                                    ? `Em ${dias} dias`
                                    : 'Sem Prazo'}
                                </span>
                              </div>

                              <h4 className="font-sans text-white font-semibold text-xs line-clamp-2 leading-snug mb-1">
                                {op.descricao}
                              </h4>
                              <div className="text-[11px] text-slate-400 mb-2">
                                Prazo: <strong className="text-amber-300">{op.data_entrega || '—'}</strong>
                              </div>
                            </div>

                            <div className="pt-2 border-t border-slate-900 flex items-center justify-between gap-2">
                              {op.status_macro === 'falta_embalar' ? (
                                <button
                                  onClick={() => handleConfirmarEmbalagem(op)}
                                  className="py-1 px-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-[10px]"
                                >
                                  ✓ Embalar
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleSinalizarAtraso(op)}
                                  className="py-1 px-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-lg text-[10px] font-bold border border-slate-800"
                                >
                                  ⚠️ Motivo
                                </button>
                              )}

                              <button
                                onClick={() => handleOpenOpChat(op)}
                                className="py-1 px-2.5 bg-blue-950 hover:bg-blue-900 text-blue-300 rounded-lg text-[10px] font-bold border border-blue-800 flex items-center gap-1.5"
                              >
                                <MessageSquare className="w-3 h-3" />
                                <span>Chat</span>
                                {unreadCount > 0 && (
                                  <span className="w-3.5 h-3.5 bg-rose-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center">
                                    {unreadCount}
                                  </span>
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            /* VISÃO 4: ANÁLISES EXECUTIVAS */
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-[#0c142b] border border-blue-900/60 p-5 rounded-2xl shadow-lg">
                  <span className="text-xs font-mono text-slate-400 uppercase block font-semibold">
                    % On-Time Delivery
                  </span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span
                      className={`text-3xl font-black font-mono-num ${
                        onTimePercentage >= 85 ? 'text-emerald-400' : onTimePercentage >= 70 ? 'text-amber-400' : 'text-rose-400'
                      }`}
                    >
                      {onTimePercentage}%
                    </span>
                    <span className="text-xs text-slate-400 font-mono">no prazo</span>
                  </div>
                  <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden mt-3 border border-slate-800">
                    <div
                      className={`h-full ${
                        onTimePercentage >= 85 ? 'bg-emerald-500' : onTimePercentage >= 70 ? 'bg-amber-500' : 'bg-rose-500'
                      }`}
                      style={{ width: `${onTimePercentage}%` }}
                    />
                  </div>
                </div>

                <div className="bg-[#0c142b] border border-purple-900/60 p-5 rounded-2xl shadow-lg">
                  <span className="text-xs font-mono text-purple-300 uppercase block font-semibold">
                    Aguardando Embalagem
                  </span>
                  <div className="text-3xl font-black text-purple-400 mt-1 font-mono-num">
                    {pcpMacroCounts.faltaEmbalar}
                  </div>
                  <span className="text-[11px] text-slate-400 mt-2 block">Portas montadas prontas para expedição</span>
                </div>

                <div className="bg-[#0c142b] border border-blue-900/60 p-5 rounded-2xl shadow-lg">
                  <span className="text-xs font-mono text-blue-300 uppercase block font-semibold">
                    Operações Ativas no Chão
                  </span>
                  <div className="text-3xl font-black text-blue-400 mt-1 font-mono-num">
                    {orderList.filter((o) => isOpEmProducao(o, apontamentos)).length}
                  </div>
                  <span className="text-[11px] text-slate-400 mt-2 block">Lotes em execução nos 5 terminais</span>
                </div>

                <div className="bg-[#0c142b] border border-indigo-900/60 p-5 rounded-2xl shadow-lg">
                  <span className="text-xs font-mono text-indigo-300 uppercase block font-semibold">
                    Alinhamentos no Chat
                  </span>
                  <div className="text-3xl font-black text-indigo-300 mt-1 font-mono-num">
                    {allChatMessages.length}
                  </div>
                  <span className="text-[11px] text-slate-400 mt-2 block">
                    {totalUnreadChat > 0 ? (
                      <strong className="text-rose-400">{totalUnreadChat} mensagens não lidas</strong>
                    ) : (
                      'Todas mensagens lidas'
                    )}
                  </span>
                </div>
              </div>

              {/* Ranking de Motivos de Atraso */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-[#0c142b] border border-blue-900/60 p-5 rounded-2xl shadow-lg space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-blue-950">
                    <span className="font-mono font-bold text-xs text-white uppercase flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                      Ranking dos Motivos de Atraso
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      {motivosRanking.reduce((acc, curr) => acc + curr[1], 0)} ocorrências
                    </span>
                  </div>

                  {motivosRanking.length === 0 ? (
                    <p className="text-xs font-mono text-slate-500 py-6 text-center">
                      Nenhum motivo de atraso registrado nas ordens ativas.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {motivosRanking.map(([motivo, count]) => {
                        const total = motivosRanking.reduce((acc, curr) => acc + curr[1], 0);
                        const perc = total > 0 ? Math.round((count / total) * 100) : 0;
                        return (
                          <div key={motivo} className="space-y-1">
                            <div className="flex items-center justify-between text-xs font-mono">
                              <span className="text-slate-200 font-semibold">{motivo}</span>
                              <span className="text-amber-400 font-bold">{count} ({perc}%)</span>
                            </div>
                            <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
                              <div
                                className="h-full bg-gradient-to-r from-amber-500 to-rose-500 rounded-full"
                                style={{ width: `${perc}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Distribuição por Família */}
                <div className="bg-[#0c142b] border border-blue-900/60 p-5 rounded-2xl shadow-lg space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-blue-950">
                    <span className="font-mono font-bold text-xs text-white uppercase flex items-center gap-2">
                      <Layers className="w-4 h-4 text-blue-400" />
                      Distribuição da Carteira por Família
                    </span>
                    <span className="text-xs text-slate-400 font-mono">{orderList.length} OPs</span>
                  </div>

                  <div className="space-y-2.5">
                    {MODELOS_PRODUTO.map((mod) => {
                      const count = modelCounts[mod] || 0;
                      if (count === 0) return null;
                      const perc = orderList.length > 0 ? Math.round((count / orderList.length) * 100) : 0;
                      return (
                        <div key={mod} className="space-y-1">
                          <div className="flex items-center justify-between text-xs font-mono">
                            <span className="text-slate-200 font-semibold">{mod}</span>
                            <span className="text-blue-300 font-bold">{count} ({perc}%)</span>
                          </div>
                          <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
                            <div
                              className="h-full bg-gradient-to-r from-blue-600 to-teal-400 rounded-full"
                              style={{ width: `${perc}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* PAINEL LATERAL FIXO: INBOX DE CONVERSAS PCP ↔ COORDENAÇÃO */}
        {isInboxOpen && (
          <div className="w-full xl:w-96 shrink-0 bg-[#0c142b] border border-purple-900/60 rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[750px] sticky top-4 animate-in slide-in-from-right-4 duration-200">
            {/* Header do Inbox */}
            <div className="p-3.5 bg-[#090F21] border-b border-blue-950 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-purple-400" />
                <span className="font-mono font-bold text-xs text-white uppercase tracking-wider">
                  Inbox PCP ↔ Coordenação
                </span>
                {totalUnreadChat > 0 && (
                  <span className="px-1.5 py-0.2 bg-rose-500 text-white rounded-full text-[9px] font-bold">
                    {totalUnreadChat}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => refreshMessages()}
                  className="p-1 rounded text-slate-400 hover:text-white transition"
                  title="Atualizar conversas"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setIsInboxOpen(false)}
                  className="p-1 rounded text-slate-400 hover:text-white transition"
                  title="Recolher painel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Visualização: Thread Ativo vs Lista de Conversas */}
            {activeThreadOp ? (
              /* THREAD ATIVO */
              <div className="flex-1 flex flex-col min-h-0 bg-[#0a1024]">
                {/* Cabeçalho do Thread */}
                <div className="p-3 bg-slate-950 border-b border-blue-950 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2 truncate">
                    <button
                      onClick={() => setActiveThreadOp(null)}
                      className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition"
                      title="Voltar para a lista de conversas"
                    >
                      <ArrowLeft className="w-3.5 h-3.5 text-blue-400" />
                    </button>
                    <div className="truncate">
                      <span className="font-mono font-black text-xs text-blue-300 bg-blue-950/80 border border-blue-500/40 px-2 py-0.5 rounded shadow-sm inline-block mb-1">
                        {formatOpNumber(activeThreadOp.numero || activeThreadOp.op_numero)}
                      </span>
                      <span className="text-[11px] text-slate-200 truncate block font-sans font-medium">
                        {activeThreadOp.descricao}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Mensagens do Thread */}
                <div className="flex-1 overflow-y-auto p-3 space-y-3 font-mono text-xs no-scrollbar">
                  {isLoadingThread ? (
                    <div className="py-10 text-center text-slate-500">Carregando histórico...</div>
                  ) : threadMessages.length === 0 ? (
                    <div className="py-10 text-center text-slate-500">
                      Nenhuma mensagem registrada nesta OP. Envie uma mensagem abaixo para iniciar o alinhamento.
                    </div>
                  ) : (
                    threadMessages.map((msg) => {
                      const isPcp = (msg.remetente || '').toLowerCase() === 'pcp';
                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col ${isPcp ? 'items-end' : 'items-start'}`}
                        >
                          <div
                            className={`max-w-[88%] p-3 rounded-2xl shadow-md border ${
                              isPcp
                                ? 'bg-blue-600/25 border-blue-500/50 text-blue-100 rounded-br-none'
                                : 'bg-purple-600/25 border-purple-500/50 text-purple-100 rounded-bl-none'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 text-[10px] mb-1 opacity-80">
                              <span className="font-bold uppercase flex items-center gap-1">
                                {isPcp ? <Shield className="w-3 h-3 text-blue-400" /> : <User className="w-3 h-3 text-purple-400" />}
                                {isPcp ? 'PCP' : 'Coordenação (Eduardo)'}
                              </span>
                              <span>
                                {formatarDataMensagem(msg)}
                              </span>
                            </div>

                            {msg.resposta_a && (
                              <div className="text-[10px] p-1.5 bg-black/40 rounded-lg border border-white/10 mb-1.5 opacity-90 truncate">
                                ↳ Respondendo: "{msg.resposta_a.texto}"
                              </div>
                            )}

                            <p className="whitespace-pre-wrap leading-relaxed">{msg.texto}</p>

                            <div className="mt-1 flex items-center justify-end">
                              <button
                                onClick={() => setReplyingTo(msg)}
                                className="text-[10px] opacity-60 hover:opacity-100 transition cursor-pointer flex items-center gap-1"
                              >
                                <CornerDownRight className="w-3 h-3" />
                                <span>Responder</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={threadEndRef} />
                </div>

                {/* Input de Envio do Thread */}
                <form onSubmit={handleSendMessage} className="p-2.5 bg-slate-950 border-t border-blue-950 shrink-0 space-y-2">
                  {/* Seletor de Remetente */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 text-[10px] font-mono">
                      <span className="text-slate-400">Falando como:</span>
                      <button
                        type="button"
                        onClick={() => setChatRole('pcp')}
                        className={`px-2 py-0.5 rounded font-bold transition cursor-pointer ${
                          chatRole === 'pcp'
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-900 text-slate-400 hover:text-white'
                        }`}
                      >
                        PCP
                      </button>
                      <button
                        type="button"
                        onClick={() => setChatRole('producao')}
                        className={`px-2 py-0.5 rounded font-bold transition cursor-pointer ${
                          chatRole === 'producao'
                            ? 'bg-purple-600 text-white'
                            : 'bg-slate-900 text-slate-400 hover:text-white'
                        }`}
                      >
                        Coordenação (Eduardo)
                      </button>
                    </div>

                    {replyingTo && (
                      <button
                        type="button"
                        onClick={() => setReplyingTo(null)}
                        className="text-[10px] text-amber-400 hover:text-white flex items-center gap-0.5"
                      >
                        <X className="w-3 h-3" /> Cancelar resposta
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder={
                        replyingTo
                          ? `Respondendo a ${replyingTo.autor || replyingTo.remetente}...`
                          : 'Digitar mensagem para alinhamento...'
                      }
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-blue-400"
                    />
                    <button
                      type="submit"
                      disabled={!replyText.trim() || isSendingMsg}
                      className="p-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl transition cursor-pointer active:scale-95 shrink-0"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              /* LISTA DE CONVERSAS NO INBOX */
              <div className="flex-1 flex flex-col min-h-0">
                {/* Filtro do Inbox: Todas vs Não Lidas + Busca */}
                <div className="p-2.5 bg-slate-950 border-b border-blue-950 space-y-2 shrink-0">
                  <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-xl border border-slate-800 text-xs font-mono">
                    <button
                      onClick={() => setInboxFilter('todas')}
                      className={`flex-1 py-1 rounded-lg font-bold transition ${
                        inboxFilter === 'todas' ? 'bg-[#1C2F8A] text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Todas ({inboxThreads.length})
                    </button>
                    <button
                      onClick={() => setInboxFilter('nao_lidas')}
                      className={`flex-1 py-1 rounded-lg font-bold transition flex items-center justify-center gap-1 ${
                        inboxFilter === 'nao_lidas' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <span>Não Lidas</span>
                      {totalUnreadChat > 0 && (
                        <span className="w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
                          {totalUnreadChat}
                        </span>
                      )}
                    </button>
                  </div>

                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                    <input
                      type="text"
                      value={inboxSearch}
                      onChange={(e) => setInboxSearch(e.target.value)}
                      placeholder="Buscar OP ou texto na conversa..."
                      className="w-full pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs font-mono text-white focus:outline-none focus:border-blue-400"
                    />
                  </div>
                </div>

                {/* Lista de Threads */}
                <div className="flex-1 overflow-y-auto divide-y divide-blue-950/60 no-scrollbar">
                  {inboxThreads.length === 0 ? (
                    <div className="py-12 text-center text-slate-500 font-mono text-xs px-4">
                      {inboxFilter === 'nao_lidas'
                        ? 'Nenhuma conversa com mensagens pendentes de leitura.'
                        : 'Nenhuma conversa registrada ainda. Clique em "Chat" no card de qualquer OP para iniciar.'}
                    </div>
                  ) : (
                    inboxThreads.map((thread) => {
                      const cleanId = cleanOpId(thread.op.numero || thread.op.op_numero);
                      const isUnread = thread.unread > 0;

                      const displayOpNum = formatOpNumber(thread.op.numero || thread.op.op_numero || cleanId) || `OP ${cleanId}`;

                      return (
                        <div
                          key={cleanId}
                          onClick={() => {
                            playClick();
                            setActiveThreadOp(thread.op);
                          }}
                          className={`p-3 transition cursor-pointer hover:bg-slate-900/60 flex items-start justify-between gap-2.5 ${
                            isUnread ? 'bg-rose-950/20 border-l-2 border-rose-500' : ''
                          }`}
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-mono font-black text-xs text-blue-300 bg-blue-950/90 border border-blue-500/50 px-2.5 py-0.5 rounded shadow-sm inline-block">
                                {displayOpNum}
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono">
                                {formatarDataMensagem(thread.lastMsg)}
                              </span>
                            </div>

                            <p className="text-[11px] font-sans font-semibold text-slate-100 truncate mt-1">
                              {thread.op.descricao}
                            </p>

                            <p className="text-[11px] font-mono text-slate-400 truncate">
                              <strong className={thread.lastMsg.remetente === 'pcp' ? 'text-blue-400' : 'text-purple-400'}>
                                {thread.lastMsg.remetente === 'pcp' ? 'PCP: ' : 'Coordenação: '}
                              </strong>
                              {thread.lastMsg.texto}
                            </p>
                          </div>

                          {isUnread && (
                            <span className="w-5 h-5 rounded-full bg-rose-500 text-white font-mono font-black text-[10px] flex items-center justify-center shrink-0 animate-pulse shadow-sm">
                              {thread.unread}
                            </span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal de Motivo de Atraso */}
      <PcpDelayReasonModal
        order={selectedDelayOrder}
        isOpen={delayModalOpen}
        onClose={() => {
          setDelayModalOpen(false);
          setSelectedDelayOrder(null);
        }}
        onSaved={() => {
          showToast('Status e motivo de atraso atualizados!', 'success');
          setDelayModalOpen(false);
          setSelectedDelayOrder(null);
        }}
      />
    </div>
  );
});

export default ProductionStatusModule;
