import React, { useState, useEffect } from 'react';
import { ProductionOrder } from '../types/mes';
import { atualizarStatusMacroOp } from '../services/mesStorage';
import { formatarNumeroOP } from '../utils/nomusParser';
import { playClick, playSuccessStart } from '../utils/audio';
import { AlertTriangle, X, Check, Clock, ShieldAlert, Sparkles, RotateCcw } from 'lucide-react';

interface PcpDelayReasonModalProps {
  order: ProductionOrder | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

const MOTIVOS_PREDEFINIDOS = [
  { id: 'mat', label: 'Falta de Material', icon: '📦', desc: 'Aguardando chapas, inox, poliuretano ou perfis' },
  { id: 'eng', label: 'Ajuste de Projeto/Engenharia', icon: '📐', desc: 'Divergência de medidas ou detalhamento técnico' },
  { id: 'terc', label: 'Aguardando Terceiros/Pintura', icon: '🎨', desc: 'Processamento externo ou acabamento especial' },
  { id: 'maq', label: 'Manutenção de Máquina', icon: '🔧', desc: 'Corte laser, dobradeira ou injetora em reparo' },
  { id: 'mo', label: 'Falta de Mão de Obra', icon: '👥', desc: 'Capacidade do posto ou remanejamento de equipe' },
  { id: 'log', label: 'Logística / Aguardando Cliente', icon: '🚚', desc: 'Alteração de cronograma solicitada pelo cliente' },
];

export const PcpDelayReasonModal: React.FC<PcpDelayReasonModalProps> = ({
  order,
  isOpen,
  onClose,
  onSaved
}) => {
  if (!isOpen || !order) return null;

  const [selectedReason, setSelectedReason] = useState<string>(order.motivo_atraso || '');
  const [customText, setCustomText] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  useEffect(() => {
    if (order) {
      setSelectedReason(order.motivo_atraso || '');
      setCustomText('');
    }
  }, [order]);

  const handleSelectPreset = (label: string) => {
    playClick();
    setSelectedReason(label);
  };

  const handleSave = async (motivoFinal?: string) => {
    const motivo = (motivoFinal !== undefined ? motivoFinal : (customText.trim() || selectedReason)).trim();
    if (!motivo) return;

    setIsSaving(true);
    try {
      await atualizarStatusMacroOp(order.numero || order.op_numero, {
        status_macro: 'atrasada',
        motivo_atraso: motivo
      });
      playSuccessStart();
      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      console.error('[PcpDelayReasonModal] Erro ao salvar motivo:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearAtraso = async () => {
    setIsSaving(true);
    try {
      await atualizarStatusMacroOp(order.numero || order.op_numero, {
        status_macro: 'produzindo_hoje',
        motivo_atraso: ''
      });
      playSuccessStart();
      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      console.error('[PcpDelayReasonModal] Erro ao limpar atraso:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div
        className="bg-[#0c142b] border-2 border-amber-500/50 w-full max-w-lg rounded-3xl p-6 shadow-2xl flex flex-col justify-between max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div>
          <div className="flex items-center justify-between pb-3 border-b border-amber-500/30 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>Sinalizar Motivo de Atraso</span>
                </h3>
                <p className="text-xs text-amber-300 font-mono font-bold">
                  {formatarNumeroOP(order.numero || order.op_numero)}
                  {order.data_entrega ? ` • Prazo: ${order.data_entrega}` : ''}
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

          <p className="text-xs text-slate-300 line-clamp-2 mb-4 bg-slate-950/80 p-2.5 rounded-xl border border-slate-800/80">
            {order.descricao || order.produto || 'Sem descrição'}
          </p>

          {/* Motivo Atual Registrado */}
          {order.motivo_atraso && (
            <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs">
              <span className="text-[10px] uppercase font-bold text-amber-400 tracking-wider block mb-1">
                Motivo Atualmente Gravado:
              </span>
              <span className="text-white font-medium">{order.motivo_atraso}</span>
            </div>
          )}

          {/* Presets Rápidos */}
          <div className="space-y-2 mb-4">
            <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
              Selecione o Motivo Principal:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {MOTIVOS_PREDEFINIDOS.map((preset) => {
                const isSelected = selectedReason === preset.label;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset.label)}
                    className={`p-2.5 rounded-xl border text-left text-xs transition cursor-pointer flex flex-col gap-0.5 ${
                      isSelected
                        ? 'bg-amber-500/20 border-amber-400 text-white shadow-md'
                        : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-bold">
                      <span>{preset.icon}</span>
                      <span className="line-clamp-1">{preset.label}</span>
                    </div>
                    <span className="text-[10px] text-slate-400 line-clamp-1">{preset.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Ou Descreva Livremente */}
          <div className="mb-4">
            <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block mb-1.5">
              Ou Detalhe / Descreva o Motivo:
            </label>
            <textarea
              rows={2}
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="Descreva observações adicionais sobre o atraso..."
              className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-amber-400 resize-none font-sans"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
          {order.motivo_atraso || order.status_macro === 'atrasada' ? (
            <button
              type="button"
              onClick={handleClearAtraso}
              disabled={isSaving}
              className="px-3 py-2 bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-700/50 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Limpar motivo e marcar a OP como em produção regular"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Regularizar / Limpar</span>
            </button>
          ) : <div />}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                playClick();
                onClose();
              }}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => handleSave()}
              disabled={isSaving || (!selectedReason && !customText.trim())}
              className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="w-4 h-4" />
              <span>{isSaving ? 'Gravando...' : 'Confirmar Atraso'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
