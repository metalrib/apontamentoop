import React, { useState, useEffect, useRef } from 'react';
import { ProductionOrder, Apontamento } from '../types/mes';
import { getRouteForOp, getRouteEvaluation, isAncoraOrder, obterEtapasDaRota } from '../utils/routeEngine';
import { calculateDeadlineInfo } from '../utils/nomusParser';
import { Html5Qrcode } from 'html5-qrcode';
import {
  Search,
  Camera,
  X,
  CheckCircle2,
  Clock,
  Lock,
  Calendar,
  Layers,
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  Monitor,
  Activity,
  User,
  Tag
} from 'lucide-react';
import { MetalribLogo } from './MetalribLogo';
import { playClick, playBarcodeBeep, playBlockedError } from '../utils/audio';

interface MobilePcpTrackerProps {
  orders: Record<string, ProductionOrder>;
  apontamentos: Apontamento[];
  initialOpNumber?: string | null;
  onSwitchToTotem: () => void;
  onOpenSupervisor?: () => void;
}

export const MobilePcpTracker: React.FC<MobilePcpTrackerProps> = ({
  orders,
  apontamentos,
  initialOpNumber,
  onSwitchToTotem,
  onOpenSupervisor
}) => {
  const [searchTerm, setSearchTerm] = useState<string>(initialOpNumber || '');
  const [selectedOp, setSelectedOp] = useState<ProductionOrder | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState<boolean>(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // Sincroniza OP inicial
  useEffect(() => {
    if (initialOpNumber && orders[initialOpNumber]) {
      setSelectedOp(orders[initialOpNumber]);
      setSearchTerm(initialOpNumber);
    }
  }, [initialOpNumber, orders]);

  // Busca e seleção por número digitado
  const handleSelectOpByNumber = (opNum: string) => {
    playClick();
    const cleanNum = opNum.replace(/^(\s*OP\s*)+/i, '').trim();
    const found = orders[cleanNum] || orders[opNum];
    if (found) {
      setSelectedOp(found);
      setSearchTerm(found.op_numero);
    } else {
      setSelectedOp(null);
    }
  };

  // Gerenciamento do Scanner de Câmera
  useEffect(() => {
    if (!isScannerOpen) {
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .then(() => {
            scannerRef.current = null;
          })
          .catch(() => {
            scannerRef.current = null;
          });
      }
      return;
    }

    const html5QrCode = new Html5Qrcode('mobile-camera-reader');
    scannerRef.current = html5QrCode;

    html5QrCode
      .start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 }
        },
        (decodedText) => {
          playBarcodeBeep();
          const clean = decodedText.replace(/^(\s*OP\s*)+/i, '').trim();
          setSearchTerm(clean);
          handleSelectOpByNumber(clean);
          setIsScannerOpen(false);
        },
        () => {
          // Leituras vazias ignoradas em loop
        }
      )
      .catch((err) => {
        console.error('Camera scan error:', err);
        setScannerError('Acesso à câmera indisponível ou bloqueado. Digite o número da OP.');
      });

    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {}).finally(() => {
          scannerRef.current = null;
        });
      }
    };
  }, [isScannerOpen]);

  // Lista de OPs para sugestão rápida
  const orderList = Object.values(orders);
  const filteredOrderSuggestions = searchTerm.trim()
    ? orderList.filter((op) => {
        const query = searchTerm.toLowerCase();
        return (
          op.op_numero.toLowerCase().includes(query) ||
          op.descricao.toLowerCase().includes(query) ||
          (op.codigo && op.codigo.toLowerCase().includes(query))
        );
      }).slice(0, 10)
    : orderList.slice(0, 8);

  // Análise da OP selecionada
  const routeData = selectedOp ? getRouteForOp(selectedOp) : null;
  const steps = selectedOp ? obterEtapasDaRota(selectedOp) : [];
  const evaluation = selectedOp && steps.length > 0 ? getRouteEvaluation(selectedOp, apontamentos, steps) : null;
  const deadline = selectedOp ? calculateDeadlineInfo(selectedOp.data_entrega) : null;

  // Descobre status em tempo real da OP
  const activeApontamento = selectedOp
    ? apontamentos.find(
        (a) =>
          a.status === 'EM_ANDAMENTO' &&
          (a.op_numero === selectedOp.op_numero || a.op_numero === selectedOp.numero)
      )
    : null;

  const totalFinishedLastStep =
    selectedOp && steps.length > 0 && evaluation
      ? evaluation[steps[steps.length - 1]]?.finalizadas || 0
      : 0;
  const isOrderFullyCompleted = selectedOp && totalFinishedLastStep >= (selectedOp.quantidade_total || 1);

  return (
    <div className="w-full max-w-md mx-auto min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans border-x border-slate-800 shadow-2xl relative">
      {/* Top Header Mobile */}
      <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-3.5 py-2.5 flex items-center justify-between gap-2 shadow-md">
        <div className="flex items-center gap-2">
          <MetalribLogo size="sm" />
          <div>
            <div className="text-[11px] font-mono font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
              <span>PCP MOBILE</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <div className="text-[10px] text-slate-400 font-mono">RASTREIO INSTANTÂNEO</div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              playClick();
              onSwitchToTotem();
            }}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer active:scale-95 transition"
            title="Mudar para Modo Totem de Chão de Fábrica"
          >
            <Monitor className="w-3.5 h-3.5 text-amber-400" />
            <span>Totem</span>
          </button>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <div className="flex-1 p-3.5 flex flex-col gap-3">
        {/* Barra de Pesquisa Fixa com Botão de Câmera */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-2 flex items-center gap-2 shadow-lg">
          <div className="relative flex-1 flex items-center">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                const val = e.target.value.trim();
                if (orders[val]) {
                  setSelectedOp(orders[val]);
                }
              }}
              placeholder="Digite o número da OP..."
              className="w-full pl-8 pr-3 py-2 bg-slate-950/80 border border-slate-800 rounded-xl text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
            />
            {searchTerm && (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setSelectedOp(null);
                }}
                className="absolute right-2 text-slate-400 hover:text-white p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            onClick={() => {
              playClick();
              setScannerError(null);
              setIsScannerOpen(true);
            }}
            className="px-3 py-2 bg-[#1C2F8A] hover:bg-blue-600 active:scale-95 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 border border-blue-400/50 shadow-md shrink-0 cursor-pointer transition"
          >
            <Camera className="w-4 h-4 text-blue-200" />
            <span className="hidden xs:inline">📷 Bipar</span>
          </button>
        </div>

        {/* Modal de Câmera para Código de Barras */}
        {isScannerOpen && (
          <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-4 shadow-2xl flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-mono font-bold text-blue-400 flex items-center gap-1.5">
                  <Camera className="w-4 h-4" />
                  APONTE PARA O CÓDIGO DA OP
                </span>
                <button
                  onClick={() => setIsScannerOpen(false)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {scannerError ? (
                <div className="p-4 bg-red-950/50 border border-red-800 rounded-xl text-xs text-red-300 space-y-2 text-center">
                  <AlertTriangle className="w-6 h-6 mx-auto text-red-400" />
                  <p>{scannerError}</p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-slate-700 bg-black">
                  <div id="mobile-camera-reader" className="w-full h-64" />
                </div>
              )}

              <button
                onClick={() => setIsScannerOpen(false)}
                className="mt-3 w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold font-mono"
              >
                Cancelar Leitura
              </button>
            </div>
          </div>
        )}

        {/* Card de Rastreio Resumido da OP */}
        {selectedOp && routeData && evaluation && deadline ? (
          <div className="space-y-3 animate-in fade-in duration-200">
            {/* 1. Header do Item Rastreado */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-600 via-sky-400 to-emerald-400" />

              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="px-3 py-1 bg-[#1C2F8A] border border-blue-400/80 rounded-xl text-white font-mono font-black text-lg shadow-sm">
                  OP {selectedOp.op_numero}
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono font-bold text-amber-400">
                    {selectedOp.quantidade_total || 1} {selectedOp.unidade_medida || 'PC'}
                  </span>

                  {deadline.isDelayed ? (
                    <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-red-950/80 text-red-400 border border-red-800 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {deadline.text}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-800 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      No Prazo
                    </span>
                  )}
                </div>
              </div>

              <div className="text-sm font-bold text-white leading-tight mb-1">
                {selectedOp.descricao}
              </div>

              <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                <span>Cód: <strong className="text-slate-300">{selectedOp.codigo || '—'}</strong></span>
                <span>Entrega: <strong className="text-slate-300">{selectedOp.data_entrega || '—'}</strong></span>
              </div>
            </div>

            {/* 2. Status Atual em Destaque */}
            <div
              className={`p-3.5 rounded-2xl border text-xs font-mono shadow-lg transition-all ${
                isOrderFullyCompleted
                  ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300'
                  : activeApontamento
                  ? 'bg-cyan-950/50 border-cyan-500/60 text-cyan-200'
                  : 'bg-slate-900 border-slate-800 text-slate-300'
              }`}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" />
                <span>STATUS ATUAL EM TEMPO REAL</span>
              </div>

              {isOrderFullyCompleted ? (
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-400">
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                  <span>PRODUÇÃO CONCLUÍDA EM TODOS OS SETORES</span>
                </div>
              ) : activeApontamento ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-bold text-cyan-300">
                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping shrink-0" />
                    <span>EM PRODUÇÃO NO SETOR: {activeApontamento.setor.toUpperCase()}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-300 pt-1">
                    <User className="w-3.5 h-3.5 text-amber-400" />
                    <span>Operador: <strong>{activeApontamento.operador}</strong></span>
                    <span>·</span>
                    <Clock className="w-3.5 h-3.5 text-blue-400" />
                    <span>Iniciado às {new Date(activeApontamento.hora_inicio).toLocaleTimeString('pt-BR')}</span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-400 flex items-center gap-2 py-0.5">
                  <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Aguardando apontamento de operador na fábrica</span>
                </div>
              )}
            </div>

            {/* 3. Linha do Tempo da Rota (Timeline Vertical) */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 shadow-xl">
              <div className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center justify-between">
                <span>LINHA DO TEMPO DA ROTA ({steps.length} ETAPAS)</span>
                <span className="text-blue-400">{routeData?.rule.label}</span>
              </div>

              <div className="space-y-2.5 relative">
                {/* Linha vertical conectora de fundo */}
                <div className="absolute left-[13px] top-3 bottom-3 w-0.5 bg-slate-800 -z-0" />

                {steps.map((step, idx) => {
                  const stepEval = evaluation ? evaluation[step] : null;
                  const totalOpQtd = selectedOp.quantidade_total || 1;
                  const isFinished = stepEval ? stepEval.finalizadas >= totalOpQtd : false;
                  const isInProgress = stepEval ? (stepEval.emAndamento || 0) > 0 : false;

                  // Busca dados do apontamento para este passo
                  const aptsForStep = apontamentos.filter(
                    (a) =>
                      (a.op_numero === selectedOp.op_numero || a.op_numero === selectedOp.numero) &&
                      (a.etapa_rota === step || a.setor.toLowerCase().includes(step.toLowerCase()))
                  );
                  const lastApt = aptsForStep[aptsForStep.length - 1];

                  return (
                    <div
                      key={step}
                      className={`relative z-10 flex items-start gap-3 p-2 rounded-xl transition border text-xs font-mono ${
                        isFinished
                          ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
                          : isInProgress
                          ? 'bg-cyan-950/30 border-cyan-400/50 ring-1 ring-cyan-500/40 text-cyan-200'
                          : 'bg-slate-950/40 border-slate-800/80 text-slate-400'
                      }`}
                    >
                      {/* Ícone Indicador de Etapa */}
                      <div className="mt-0.5 shrink-0">
                        {isFinished ? (
                          <div className="w-6 h-6 rounded-full bg-emerald-500 text-black flex items-center justify-center font-bold shadow-sm">
                            <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
                          </div>
                        ) : isInProgress ? (
                          <div className="w-6 h-6 rounded-full bg-cyan-500 text-black flex items-center justify-center font-bold animate-pulse shadow-md">
                            <Clock className="w-4 h-4 stroke-[2.5]" />
                          </div>
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-slate-800 text-slate-500 flex items-center justify-center border border-slate-700">
                            <Lock className="w-3.5 h-3.5" />
                          </div>
                        )}
                      </div>

                      {/* Informações da Etapa */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-bold text-white truncate">
                            {idx + 1}. {step}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              isFinished
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : isInProgress
                                ? 'bg-cyan-500/20 text-cyan-300'
                                : 'bg-slate-800 text-slate-500'
                            }`}
                          >
                            {isFinished ? '✔ Concluído' : isInProgress ? '⏳ Em Andamento' : '🔒 Pendente'}
                          </span>
                        </div>

                        {/* Detalhes do Operador e Horário */}
                        {lastApt && (
                          <div className="mt-1 text-[11px] text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            {lastApt.operador && (
                              <span className="text-slate-300 font-semibold flex items-center gap-1">
                                <User className="w-3 h-3 text-amber-400" />
                                {lastApt.operador}
                              </span>
                            )}
                            {lastApt.hora_fim && (
                              <span className="text-emerald-400">
                                Finalizado às {new Date(lastApt.hora_fim).toLocaleTimeString('pt-BR')}
                              </span>
                            )}
                            {lastApt.status === 'EM_ANDAMENTO' && (
                              <span className="text-cyan-400 animate-pulse">
                                Iniciado às {new Date(lastApt.hora_inicio).toLocaleTimeString('pt-BR')}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          /* Sugestão Rápida / OPs Recentes */
          <div className="space-y-2">
            <div className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider px-1">
              {searchTerm ? 'Resultados da Pesquisa' : 'Ordens de Produção Recentes'}
            </div>

            <div className="space-y-2">
              {filteredOrderSuggestions.map((op) => {
                const dl = calculateDeadlineInfo(op.data_entrega);
                return (
                  <button
                    key={op.op_numero}
                    onClick={() => handleSelectOpByNumber(op.op_numero)}
                    className="w-full p-3 bg-slate-900 hover:bg-slate-850 active:scale-[0.99] border border-slate-800 rounded-xl text-left transition flex items-center justify-between gap-3 cursor-pointer"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-blue-400 text-sm">
                          OP {op.op_numero}
                        </span>
                        <span className="text-[10px] font-mono bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded">
                          {op.quantidade_total || 1} {op.unidade_medida || 'PC'}
                        </span>
                        {dl.isDelayed && (
                          <span className="text-[10px] font-bold text-red-400 bg-red-950/60 px-1.5 py-0.5 rounded border border-red-900">
                            {dl.text}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-300 truncate font-sans mt-0.5">
                        {op.descricao}
                      </div>
                    </div>
                    <div className="text-slate-500 font-mono text-xs">
                      →
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
