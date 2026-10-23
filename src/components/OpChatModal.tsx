import React, { useState } from 'react';
import { ProductionOrder } from '../types/mes';
import { addOpMessage } from '../services/mesStorage';
import { playClick, playSuccessStart } from '../utils/audio';
import { MessageSquare, X, Send, User, Shield, Clock } from 'lucide-react';

interface OpChatModalProps {
  order: ProductionOrder;
  onClose: () => void;
  onMessageSent?: () => void;
}

export const OpChatModal: React.FC<OpChatModalProps> = ({ order, onClose, onMessageSent }) => {
  const [authorName, setAuthorName] = useState('Eduardo');
  const [role, setRole] = useState('Produção');
  const [messageText, setMessageText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const messages = order.mensagens || (order.ultimo_aviso ? [{
    id: 'msg-initial',
    autor: order.ultimo_aviso.autor,
    texto: order.ultimo_aviso.texto,
    data_hora: order.ultimo_aviso.data_hora
  }] : []);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await addOpMessage(order.op_numero, {
        autor: authorName.trim() || 'Usuário',
        papel: role,
        texto: messageText.trim()
      });
      playSuccessStart();
      setMessageText('');
      if (onMessageSent) onMessageSent();
    } catch (err) {
      console.error('Erro ao enviar mensagem:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0c142b] border-2 border-blue-900/80 w-full max-w-lg rounded-3xl p-6 shadow-2xl flex flex-col justify-between max-h-[90vh]">
        {/* Header */}
        <div>
          <div className="flex items-center justify-between pb-3 border-b border-blue-900/80 mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>Conversa da OP {order.numero || order.op_numero}</span>
                </h3>
                <p className="text-xs text-slate-400 line-clamp-1">
                  {order.descricao}
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                playClick();
                onClose();
              }}
              className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Histórico de Mensagens */}
          <div className="space-y-3 max-h-72 overflow-y-auto pr-1 my-3">
            {messages.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-xs font-mono">
                Nenhum recado ou aviso registrado para esta OP ainda.
                <br />
                Envie o primeiro recado operacional abaixo.
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className="bg-slate-950/90 border border-blue-950 rounded-xl p-3 space-y-1.5 shadow-sm"
                >
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="font-bold text-blue-300 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-blue-400" />
                      <span>{m.autor}</span>
                    </span>
                    <span className="text-[10px] text-slate-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {m.data_hora}
                    </span>
                  </div>
                  <p className="text-xs text-slate-200 leading-relaxed font-sans">
                    {m.texto}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Formulário de Envio */}
        <form onSubmit={handleSendMessage} className="pt-3 border-t border-blue-900/80 space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="text-[10px] font-mono text-slate-400 block mb-1">
                Nome do Remetente:
              </label>
              <input
                type="text"
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                placeholder="Ex: Eduardo"
                className="w-full px-3 py-1.5 bg-slate-950 border border-blue-900/80 rounded-lg text-xs text-white focus:outline-none focus:border-blue-400 font-mono"
              />
            </div>

            <div className="w-36">
              <label className="text-[10px] font-mono text-slate-400 block mb-1">
                Setor / Papel:
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full px-2 py-1.5 bg-slate-950 border border-blue-900/80 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-blue-400 font-mono"
              >
                <option value="Produção">Produção</option>
                <option value="PCP">PCP</option>
                <option value="Coordenação">Coordenação</option>
                <option value="Qualidade">Qualidade</option>
                <option value="Expedição">Expedição</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="Digite o aviso ou recado operacional da OP..."
              className="flex-1 px-3.5 py-2.5 bg-slate-950 border border-blue-900/80 rounded-xl text-xs text-white focus:outline-none focus:border-blue-400 font-sans"
            />
            <button
              type="submit"
              disabled={!messageText.trim() || isSubmitting}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer active:scale-95 shadow-md ${
                messageText.trim()
                  ? 'bg-blue-600 hover:bg-blue-500 text-white'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
            >
              <Send className="w-4 h-4" />
              <span>Enviar</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
