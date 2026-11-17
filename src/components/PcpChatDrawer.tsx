import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ProductionOrder, OpMessageRow } from '../types/mes';
import {
  fetchOpMensagens,
  fetchAllMensagens,
  enviarMensagemOp,
  responderMensagemOp,
  marcarMensagemLida,
  getLocalSocket
} from '../services/mesStorage';
import { formatarNumeroOP, cleanOpId } from '../utils/nomusParser';
import { playClick, playSuccessStart } from '../utils/audio';
import {
  MessageSquare,
  X,
  Send,
  User,
  Shield,
  Clock,
  CheckCheck,
  CornerDownRight,
  Reply,
  Search,
  ChevronRight,
  Layers,
  Sparkles,
  Award
} from 'lucide-react';

interface PcpChatDrawerProps {
  order: ProductionOrder | null;
  allOrders?: Record<string, ProductionOrder>;
  isOpen: boolean;
  onClose: () => void;
  onSelectOrder?: (order: ProductionOrder) => void;
}

export const PcpChatDrawer: React.FC<PcpChatDrawerProps> = ({
  order,
  allOrders = {},
  isOpen,
  onClose,
  onSelectOrder
}) => {
  const [currentRole, setCurrentRole] = useState<'pcp' | 'producao'>('pcp');
  const [authorName, setAuthorName] = useState<string>('PCP');
  const [messageText, setMessageText] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [messages, setMessages] = useState<OpMessageRow[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState<boolean>(false);

  // Resposta em thread vinculada a uma mensagem pai
  const [replyingToMessage, setReplyingToMessage] = useState<OpMessageRow | null>(null);

  // Busca de OP para troca rápida caso o drawer seja aberto sem OP ou queira navegar
  const [orderSearchQuery, setOrderSearchQuery] = useState<string>('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sincroniza o autor padrão quando troca o papel
  const handleToggleRole = (role: 'pcp' | 'producao') => {
    playClick();
    setCurrentRole(role);
    setAuthorName(role === 'pcp' ? 'PCP' : 'Eduardo (Coordenação)');
  };

  // Carrega mensagens da OP atual
  const carregarMensagens = useCallback(async () => {
    if (!order) {
      setMessages([]);
      return;
    }
    const cleanId = cleanOpId(order.numero || order.op_numero);
    if (!cleanId) return;

    setIsLoadingMessages(true);
    try {
      const msgs = await fetchOpMensagens(cleanId);
      setMessages(msgs || []);

      // Marca como lida para o leitor atual
      const pendentes = (msgs || []).filter(m => (
        (currentRole === 'pcp' && !m.lida_pcp) ||
        (currentRole === 'producao' && !m.lida_producao)
      ));
      for (const p of pendentes) {
        marcarMensagemLida(p.id, { leitor: currentRole }).catch(() => {});
      }
    } catch (err) {
      console.warn('[PcpChatDrawer] Erro ao carregar mensagens:', err);
    } finally {
      setIsLoadingMessages(false);
    }
  }, [order, currentRole]);

  useEffect(() => {
    if (isOpen) {
      carregarMensagens();
    }
  }, [isOpen, order, carregarMensagens]);

  // Escuta Socket.io em tempo real
  useEffect(() => {
    if (!isOpen) return;

    let socket: any = null;
    try {
      socket = getLocalSocket();
      if (!socket) return;

      const handleNovaMensagem = (msg: OpMessageRow) => {
        if (!order) return;
        const targetClean = cleanOpId(order.numero || order.op_numero);
        const msgClean = cleanOpId(msg.order_numero);
        if (targetClean === msgClean) {
          setMessages(prev => {
            if (prev.some(m => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          // Auto-marca como lida
          marcarMensagemLida(msg.id, { leitor: currentRole }).catch(() => {});
        }
      };

      const handleResposta = (data: { id: string; resposta: any; mensagem: OpMessageRow }) => {
        if (!order) return;
        const targetClean = cleanOpId(order.numero || order.op_numero);
        const msgClean = cleanOpId(data.mensagem?.order_numero);
        if (targetClean === msgClean) {
          setMessages(prev => prev.map(m => (m.id === data.id ? data.mensagem : m)));
        }
      };

      const handleLida = (updatedMsg: OpMessageRow) => {
        if (!order) return;
        const targetClean = cleanOpId(order.numero || order.op_numero);
        const msgClean = cleanOpId(updatedMsg?.order_numero);
        if (targetClean === msgClean) {
          setMessages(prev => prev.map(m => (m.id === updatedMsg.id ? updatedMsg : m)));
        }
      };

      socket.on('nova_mensagem_op', handleNovaMensagem);
      socket.on('mensagem_op_respondida', handleResposta);
      socket.on('mensagem_op_lida', handleLida);

      return () => {
        socket.off('nova_mensagem_op', handleNovaMensagem);
        socket.off('mensagem_op_respondida', handleResposta);
        socket.off('mensagem_op_lida', handleLida);
      };
    } catch {}
  }, [isOpen, order, currentRole]);

  // Scroll automático para a última mensagem
  useEffect(() => {
    if (isOpen && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Envio de nova mensagem ou resposta em thread
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!messageText.trim() || !order || isSubmitting) return;

    const texto = messageText.trim();
    setIsSubmitting(true);
    try {
      if (replyingToMessage) {
        // Responde na thread existente
        await responderMensagemOp(replyingToMessage.id, {
          remetente: currentRole,
          autor: authorName,
          texto
        });
        setReplyingToMessage(null);
      } else {
        // Envia nova mensagem da OP
        await enviarMensagemOp({
          order_numero: cleanOpId(order.numero || order.op_numero),
          texto,
          remetente: currentRole,
          order_desc: order.descricao || order.produto || ''
        });
      }
      playSuccessStart();
      setMessageText('');
      await carregarMensagens();
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    } catch (err) {
      console.error('[PcpChatDrawer] Erro ao enviar mensagem:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Formata hora legível
  const formatTime = (ts: number | string) => {
    try {
      const d = new Date(typeof ts === 'number' ? ts : Number(ts) || ts);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  // Filtra OPs para seleção rápida se necessário
  const ordersArray = Object.values(allOrders || {});
  const filteredQuickOps = orderSearchQuery.trim()
    ? ordersArray.filter(o => {
        const q = orderSearchQuery.toUpperCase();
        return (
          (o.numero || o.op_numero || '').toUpperCase().includes(q) ||
          (o.descricao || '').toUpperCase().includes(q)
        );
      }).slice(0, 8)
    : [];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
        onClick={() => {
          playClick();
          onClose();
        }}
      />

      {/* Drawer Panel Lateral à Direita */}
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md sm:max-w-lg bg-[#090F21] border-l-2 border-blue-900/80 shadow-2xl flex flex-col justify-between animate-in slide-in-from-right duration-250">
          {/* Header do Drawer */}
          <div className="p-4 sm:p-5 border-b border-blue-950 bg-[#0c142b]/90">
            <div className="flex items-center justify-between pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>Chat PCP ↔ Coordenação</span>
                    <span className="bg-blue-900/80 text-blue-200 border border-blue-400/40 px-1.5 py-0.2 rounded text-[10px] font-mono">
                      EXCLUSIVO
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Comunicação direta em tempo real por Ordem de Produção
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  playClick();
                  onClose();
                }}
                className="text-slate-400 hover:text-white p-1.5 rounded-xl hover:bg-slate-800 transition cursor-pointer"
                title="Fechar Gaveta"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Dados da OP Vinculada */}
            {order ? (
              <div className="bg-slate-950/80 border border-blue-900/50 rounded-2xl p-3 flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-bold font-mono text-blue-300">
                    {formatarNumeroOP(order.numero || order.op_numero)}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {order.data_entrega && (
                      <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-blue-950 text-blue-300 border border-blue-800">
                        Entrega: {order.data_entrega}
                      </span>
                    )}
                    {order.status_macro && (
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-md border ${
                        order.status_macro === 'atrasada'
                          ? 'bg-rose-950/80 text-rose-300 border-rose-700/60'
                          : order.status_macro === 'falta_embalar'
                          ? 'bg-purple-950/80 text-purple-300 border-purple-700/60'
                          : order.status_macro === 'embalada'
                          ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60'
                          : 'bg-blue-950/80 text-blue-300 border-blue-700/60'
                      }`}>
                        {order.status_macro.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-200 line-clamp-2">
                  {order.descricao || order.produto || 'Sem descrição'}
                </p>
              </div>
            ) : (
              /* Seletor rápido de OP quando aberto sem ordem pré-selecionada */
              <div className="space-y-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={orderSearchQuery}
                    onChange={(e) => setOrderSearchQuery(e.target.value)}
                    placeholder="Buscar OP para conversar (ex: 024563-01)..."
                    className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-blue-400 font-mono"
                  />
                </div>
                {filteredQuickOps.length > 0 && (
                  <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                    {filteredQuickOps.map((opItem) => (
                      <button
                        key={opItem.numero || opItem.op_numero}
                        onClick={() => {
                          if (onSelectOrder) onSelectOrder(opItem);
                          setOrderSearchQuery('');
                        }}
                        className="w-full text-left p-2 rounded-lg bg-slate-900/60 hover:bg-slate-800 border border-slate-800 text-xs flex items-center justify-between text-slate-200 transition cursor-pointer"
                      >
                        <div className="line-clamp-1">
                          <strong className="text-blue-300 font-mono mr-2">{formatarNumeroOP(opItem.numero || opItem.op_numero)}</strong>
                          <span className="text-slate-400">{opItem.descricao}</span>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Alternador de Perfil do Remetente (PCP vs Coordenação) */}
            <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-blue-950/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Você está falando como:
              </span>
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-blue-950">
                <button
                  type="button"
                  onClick={() => handleToggleRole('pcp')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                    currentRole === 'pcp'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>PCP</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleRole('producao')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                    currentRole === 'producao'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Award className="w-3.5 h-3.5" />
                  <span>Eduardo (Coordenação)</span>
                </button>
              </div>
            </div>
          </div>

          {/* Área de Mensagens / Histórico */}
          <div className="flex-1 p-4 sm:p-5 overflow-y-auto space-y-4">
            {!order ? (
              <div className="text-center py-12 text-slate-500 text-xs">
                <MessageSquare className="w-10 h-10 text-slate-600 mx-auto mb-2 opacity-50" />
                <span>Selecione ou busque uma OP acima para visualizar e enviar mensagens.</span>
              </div>
            ) : isLoadingMessages ? (
              <div className="text-center py-12 text-blue-400 text-xs font-mono animate-pulse">
                Carregando histórico da OP...
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs border border-dashed border-slate-800 rounded-2xl p-6">
                <MessageSquare className="w-8 h-8 text-blue-400/50 mx-auto mb-2" />
                <span className="font-semibold text-slate-300 block mb-1">
                  Nenhuma mensagem registrada nesta OP ainda.
                </span>
                <span className="text-[11px] text-slate-500">
                  Envie o primeiro alinhamento sobre prioridade, projeto, material ou data abaixo.
                </span>
              </div>
            ) : (
              messages.map((msg) => {
                const isPcp = msg.remetente === 'pcp';
                const hasReplies = Array.isArray(msg.respostas) && msg.respostas.length > 0;

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col space-y-1.5 ${isPcp ? 'items-start' : 'items-end'}`}
                  >
                    {/* Balão Principal da Mensagem */}
                    <div
                      className={`max-w-[85%] rounded-2xl p-3.5 shadow-md border ${
                        isPcp
                          ? 'bg-[#0f1d40] border-blue-700/50 text-white'
                          : 'bg-[#1e173b] border-indigo-700/50 text-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3 mb-1.5 pb-1 border-b border-white/10">
                        <span className={`text-[11px] font-bold flex items-center gap-1 ${
                          isPcp ? 'text-blue-300' : 'text-indigo-300'
                        }`}>
                          {isPcp ? <Shield className="w-3 h-3 text-blue-400" /> : <Award className="w-3 h-3 text-indigo-400" />}
                          <span>{isPcp ? 'PCP' : 'Coordenação'}</span>
                        </span>
                        <span className="text-[10px] text-slate-400 flex items-center gap-1 font-mono">
                          <Clock className="w-3 h-3" />
                          {formatTime(msg.timestamp)}
                        </span>
                      </div>

                      <p className="text-xs leading-relaxed whitespace-pre-wrap select-text">
                        {msg.texto}
                      </p>

                      <div className="flex items-center justify-between gap-2 mt-2 pt-1.5 border-t border-white/5 text-[10px] text-slate-400">
                        <button
                          type="button"
                          onClick={() => {
                            playClick();
                            setReplyingToMessage(msg);
                            if (textareaRef.current) textareaRef.current.focus();
                          }}
                          className="hover:text-blue-300 flex items-center gap-1 font-semibold cursor-pointer transition"
                        >
                          <Reply className="w-3 h-3" />
                          <span>Responder</span>
                        </button>

                        <div className="flex items-center gap-1">
                          <CheckCheck className={`w-3.5 h-3.5 ${
                            (msg.lida_pcp && msg.lida_producao) ? 'text-blue-400' : 'text-slate-500'
                          }`} />
                          <span>
                            {(msg.lida_pcp && msg.lida_producao) ? 'Lida por ambos' : msg.lida_pcp ? 'Lida PCP' : 'Enviada'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Respostas da Thread (Respostas encadeadas) */}
                    {hasReplies && (
                      <div className={`space-y-1.5 pl-4 sm:pl-6 max-w-[85%] ${isPcp ? 'self-start' : 'self-end'}`}>
                        {msg.respostas?.map((resp) => {
                          const isRespPcp = resp.remetente === 'pcp';
                          return (
                            <div
                              key={resp.id}
                              className={`p-2.5 rounded-xl border text-xs leading-relaxed ${
                                isRespPcp
                                  ? 'bg-blue-950/70 border-blue-900/60 text-slate-200'
                                  : 'bg-indigo-950/70 border-indigo-900/60 text-slate-200'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 mb-1 text-[10px] font-mono text-slate-400">
                                <span className={`font-bold flex items-center gap-1 ${
                                  isRespPcp ? 'text-blue-300' : 'text-indigo-300'
                                }`}>
                                  <CornerDownRight className="w-3 h-3" />
                                  <span>{resp.autor || (isRespPcp ? 'PCP' : 'Coordenação')}</span>
                                </span>
                                <span>{formatTime(resp.timestamp)}</span>
                              </div>
                              <p className="whitespace-pre-wrap">{resp.texto}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Footer Input */}
          <div className="p-4 sm:p-5 border-t border-blue-950 bg-[#0c142b]/95">
            {replyingToMessage && (
              <div className="mb-2 p-2 rounded-xl bg-blue-950/80 border border-blue-800/60 flex items-center justify-between text-xs text-blue-200">
                <div className="flex items-center gap-1.5 line-clamp-1">
                  <Reply className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span>
                    Respondendo a <strong>{replyingToMessage.remetente === 'pcp' ? 'PCP' : 'Coordenação'}</strong>: "{replyingToMessage.texto}"
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyingToMessage(null)}
                  className="text-slate-400 hover:text-white p-1 rounded-md"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <form onSubmit={handleSendMessage} className="space-y-2">
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  rows={2}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  disabled={!order || isSubmitting}
                  placeholder={
                    order
                      ? `Digite sua mensagem como ${currentRole === 'pcp' ? 'PCP' : 'Coordenação'}... (Pressione Enter para enviar)`
                      : 'Selecione uma OP para digitar...'
                  }
                  className="w-full p-3 pr-12 bg-slate-950 border border-blue-900/60 rounded-2xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 resize-none font-sans disabled:opacity-50"
                />

                <button
                  type="submit"
                  disabled={!order || !messageText.trim() || isSubmitting}
                  className="absolute right-2.5 bottom-3.5 p-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white rounded-xl transition cursor-pointer disabled:cursor-not-allowed shadow-md"
                  title="Enviar mensagem"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-500 px-1 font-mono">
                <span>Enter para enviar • Shift + Enter para quebrar linha</span>
                <span>{messageText.length} caracteres</span>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
