import React, { useState } from 'react';
import { ProductionOrder, OpOcorrencia, TerminalConfig } from '../types/mes';
import { addOpOccurrence, obterOcorrenciasDaOp } from '../services/mesStorage';
import { playClick, playSuccessStart } from '../utils/audio';
import { AlertTriangle, X, Check, Clock, User, Shield, Tag, MessageSquare, History } from 'lucide-react';

interface OpOccurrenceModalProps {
  order: ProductionOrder;
  selectedOperator?: string | null;
  selectedSector?: string | null;
  currentTerminal?: TerminalConfig | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (ocorrencia: OpOcorrencia) => void;
}

const CHIPS_RAPIDOS = [
  'Material com Defeito',
  'Ajuste de Máquina',
  'Falta de Insumo',
  'Divergência de Desenho',
  'Outros'
];

export const OpOccurrenceModal: React.FC<OpOccurrenceModalProps> = ({
  order,
  selectedOperator,
  selectedSector,
  currentTerminal,
  isOpen,
  onClose,
  onSaved
}) => {
  const [descricao, setDescricao] = useState('');
  const [selectedChip, setSelectedChip] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'nova' | 'historico'>('nova');

  if (!isOpen) return null;

  const ocorrenciasExistentes = obterOcorrenciasDaOp(order);
  const opNumeroDisplay = (order.numero || order.op_numero || '').replace(/^(\s*OP\s*)+/i, 'OP ').trim();

  const handleChipClick = (chip: string) => {
    playClick();
    setSelectedChip(chip);
    if (!descricao.trim()) {
      setDescricao(`${chip}: `);
    } else if (!descricao.includes(chip)) {
      setDescricao(`${chip} - ${descricao}`);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const textoLimpo = descricao.trim();
    if (!textoLimpo || isSaving) return;

    setIsSaving(true);
    try {
      const novaOcorrencia = await addOpOccurrence(order.op_numero || order.numero || '', {
        operador: selectedOperator || order.operadorAtual || 'Não identificado',
        posto: selectedSector || order.postoSelecionado || 'Posto Geral',
        terminal: currentTerminal?.id || 1,
        descricao: textoLimpo
      });

      playSuccessStart();
      setDescricao('');
      setSelectedChip(null);
      if (onSaved) onSaved(novaOcorrencia);
      onClose();
    } catch (err) {
      console.error('Erro ao salvar ocorrência:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-[#0c142b] border-2 border-amber-500/60 w-full max-w-lg rounded-3xl p-5 sm:p-6 shadow-2xl flex flex-col justify-between max-h-[92vh] animate-in fade-in zoom-in-95 duration-150 text-left">
        {/* Cabeçalho */}
        <div>
          <div className="flex items-center justify-between pb-3 border-b border-amber-500/30 mb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 bg-amber-500/15 rounded-xl border border-amber-500/40 text-amber-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white leading-tight">
                  Registrar Ocorrência na OP {opNumeroDisplay}
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5 truncate max-w-xs">
                  {order.descricao}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                playClick();
                onClose();
              }}
              className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Abas: Nova Ocorrência / Histórico */}
          <div className="flex items-center gap-2 mb-3 border-b border-slate-800 pb-2 text-xs font-mono">
            <button
              type="button"
              onClick={() => setActiveTab('nova')}
              className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'nova'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Nova Ocorrência</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('historico')}
              className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'historico'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Histórico ({ocorrenciasExistentes.length})</span>
            </button>
          </div>

          {/* Contexto Rápido do Operador e Posto */}
          <div className="mb-3 px-3 py-2 bg-slate-950/70 border border-slate-800 rounded-xl flex items-center justify-between text-xs font-mono text-slate-400">
            <span>
              Posto: <strong className="text-white">{selectedSector || 'Geral'}</strong>
            </span>
            <span>
              Operador: <strong className="text-amber-300">{selectedOperator || 'Não selecionado'}</strong>
            </span>
          </div>

          {activeTab === 'nova' ? (
            <form onSubmit={handleSave} className="space-y-3">
              {/* Chips Rápidos */}
              <div>
                <label className="text-[11px] font-mono text-slate-400 font-semibold mb-1.5 block">
                  Motivo Rápido (toque para preencher):
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {CHIPS_RAPIDOS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => handleChipClick(chip)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold border transition cursor-pointer active:scale-95 ${
                        selectedChip === chip
                          ? 'bg-amber-500/30 text-amber-200 border-amber-400 shadow-sm'
                          : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-amber-500/50 hover:text-amber-300'
                      }`}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              {/* Textarea */}
              <div>
                <label className="text-[11px] font-mono text-slate-400 font-semibold mb-1 block">
                  Descrição detalhada do problema ou atraso:
                </label>
                <textarea
                  rows={4}
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Descreva a ocorrência/problema ocorrido neste posto..."
                  className="w-full p-3 bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl text-white text-xs font-mono placeholder:text-slate-600 focus:outline-none transition resize-none"
                  autoFocus
                />
              </div>

              <div className="p-2.5 bg-amber-950/30 border border-amber-500/30 rounded-xl text-[11px] text-amber-300 font-mono flex items-start gap-2">
                <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  O registro de ocorrência <strong>não interrompe nem pausa</strong> o cronômetro do seu lote. Continue a produção normalmente.
                </span>
              </div>

              {/* Botões de Ação */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    playClick();
                    onClose();
                  }}
                  className="flex-1 py-3 px-4 rounded-xl text-xs font-bold font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!descricao.trim() || isSaving}
                  className={`flex-1 py-3 px-4 rounded-xl text-xs font-black font-mono flex items-center justify-center gap-2 transition cursor-pointer shadow-lg active:scale-95 ${
                    descricao.trim() && !isSaving
                      ? 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-black shadow-amber-950/50'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                  }`}
                >
                  {isSaving ? (
                    <span className="animate-spin text-sm">↻ Gravando...</span>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Gravar Ocorrência</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            /* Histórico de Ocorrências Registradas */
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {ocorrenciasExistentes.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-xs font-mono">
                  Nenhuma ocorrência registrada nesta OP até o momento.
                </div>
              ) : (
                ocorrenciasExistentes.map((oc) => (
                  <div
                    key={oc.id}
                    className="p-3 bg-slate-950/90 border border-amber-500/30 rounded-xl space-y-1.5 shadow-sm text-xs font-mono"
                  >
                    <div className="flex items-center justify-between text-slate-400 text-[11px]">
                      <span className="font-bold text-amber-300 flex items-center gap-1">
                        <User className="w-3 h-3 text-amber-400" />
                        {oc.operador}
                      </span>
                      <span className="text-slate-500 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(oc.dataHora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} • {new Date(oc.dataHora).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                    <div className="text-slate-400 text-[10px]">
                      Posto: <strong className="text-white">{oc.posto}</strong> • Terminal {oc.terminal}
                    </div>
                    <p className="text-slate-200 text-xs whitespace-pre-wrap bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                      {oc.descricao}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
