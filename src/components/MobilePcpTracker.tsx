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
  Tag,
  ChevronRight
} from 'lucide-react';
import { MetalribLogo } from './MetalribLogo';
import { playClick, playBarcodeBeep, playBlockedError } from '../utils/audio';

export interface TerminalFilterItem {
  id: string;
  label: string;
  shortLabel: string;
  terminalCode?: 'T1' | 'T2' | 'T3' | 'T4' | 'T5';
}

export const TERMINAL_FILTERS: TerminalFilterItem[] = [
  { id: 'ALL', label: 'Todos', shortLabel: 'Todos' },
  { id: 'T1', label: 'T1 - Chaparia', shortLabel: 'T1', terminalCode: 'T1' },
  { id: 'T2', label: 'T2 - Injeção/Prep', shortLabel: 'T2', terminalCode: 'T2' },
  { id: 'T3', label: 'T3 - Router/Gaxeta', shortLabel: 'T3', terminalCode: 'T3' },
  { id: 'T4', label: 'T4 - Montagem Portas', shortLabel: 'T4', terminalCode: 'T4' },
  { id: 'T5', label: 'T5 - Serralharia/Estruturas', shortLabel: 'T5', terminalCode: 'T5' }
];

/**
 * Formata o número da OP garantindo prefixo único "OP XXXXXX-XX"
 */
export function formatOpNumber(raw?: string): string {
  if (!raw) return '';
  const clean = String(raw).replace(/^(\s*OP\s*)+/i, '').trim();
  return `OP ${clean}`;
}

/**
 * Identifica se a OP está ativa (em produção ou pendente, não finalizada)
 */
export function isOpActive(op: ProductionOrder): boolean {
  if (op.status === 'FINALIZADA' || op.status_fabrica === 'Embalada') return false;
  return true;
}

/**
 * Identifica a etapa atual real da OP no chão de fábrica
 */
export function getOpEffectiveEtapa(op: ProductionOrder, apontamentos?: Apontamento[]): string {
  // 1. Apontamento ativo em andamento neste momento
  if (Array.isArray(apontamentos) && apontamentos.length > 0) {
    const active = apontamentos.find(
      (a) =>
        a.status === 'EM_ANDAMENTO' &&
        (a.op_numero === op.op_numero || a.op === op.op_numero || a.op_numero === op.numero)
    );
    if (active) {
      return active.setor || active.etapa_rota || op.etapaAtual || 'Em Produção';
    }
  }

  // 2. Se a OP já tem etapaAtual definida
  if (op.etapaAtual && typeof op.etapaAtual === 'string' && op.etapaAtual.trim()) {
    const clean = op.etapaAtual.replace(/^Aguardando\s+In[ií]cio\s+em:\s*/i, '').trim();
    if (clean) return clean;
  }

  // 3. Se a OP tem statusEtapa
  if (op.statusEtapa && typeof op.statusEtapa === 'string' && op.statusEtapa.trim()) {
    const clean = op.statusEtapa.replace(/^Aguardando\s+In[ií]cio\s+em:\s*/i, '').trim();
    if (clean) return clean;
  }

  // 4. Se a OP tem status no formato "Aguardando Início em: X"
  if (op.status && typeof op.status === 'string' && op.status.includes('Aguardando Início em:')) {
    const clean = op.status.replace(/^Aguardando\s+In[ií]cio\s+em:\s*/i, '').trim();
    if (clean) return clean;
  }

  // 5. Determina a primeira etapa da rota calculada oficial
  try {
    const steps = obterEtapasDaRota(op);
    if (steps && steps.length > 0) {
      return steps[0];
    }
  } catch {
    // fallback
  }

  return 'Aguardando Início';
}

/**
 * Mapeia a OP para o seu respectivo terminal físico (T1 a T5) com base na etapa atual
 */
export function getTerminalForOp(op: ProductionOrder, apontamentos?: Apontamento[]): 'T1' | 'T2' | 'T3' | 'T4' | 'T5' {
  const etapa = getOpEffectiveEtapa(op, apontamentos);
  const norm = etapa
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  // T5 - Serralharia/Estruturas:
  // ['Solda', 'Corte de Trilho', 'Montagem de Trilho', 'Montagem Abrigo Doca', 'Montagem Estante', 'Montagem Portas Emendadas']
  if (
    norm.includes('TRILHO') ||
    norm.includes('ESTANTE') ||
    norm.includes('ABRIGO') ||
    norm.includes('DOCA') ||
    norm.includes('EMENDADA') ||
    norm.includes('SOLDA')
  ) {
    return 'T5';
  }

  // T3 - Router/Gaxeta:
  // ['Router', 'Instalação de Gaxeta']
  if (norm.includes('ROUTER') || norm.includes('GAXETA')) {
    return 'T3';
  }

  // T2 - Injeção/Prep:
  // ['Preparação de Folhas', 'Preparação de Batentes', 'Preparação de Vai Vem', 'Injeção de Folhas', 'Injeção e Finalização de Batentes']
  if (norm.includes('INJE') || norm.includes('PREPARACAO')) {
    return 'T2';
  }

  // T1 - Chaparia:
  // ['Corte', 'Laser', 'Dobra']
  if (norm.includes('CORTE') || norm.includes('LASER') || norm.includes('DOBRA')) {
    return 'T1';
  }

  // T4 - Montagem Portas:
  // ['Montagem de Portas Giratória', 'Montagem Portas de Correr Padrão e Especial', 'Montagem Porta Vai-Vem', 'Montagem Office Door Giratória', 'Montagem Office Door Correr']
  if (norm.includes('MONTAGEM')) {
    return 'T4';
  }

  // Fallback padrão
  return 'T1';
}

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
  const [selectedTerminal, setSelectedTerminal] = useState<string>('ALL');
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

  const orderList = Object.values(orders);

  // Busca e seleção por número digitado
  const handleSelectOpByNumber = (opNum: string) => {
    playClick();
    const cleanNum = opNum.replace(/^(\s*OP\s*)+/i, '').trim();
    const found =
      orders[cleanNum] ||
      orders[opNum] ||
      orderList.find(
        (o) =>
          (o.op_numero && o.op_numero.replace(/^(\s*OP\s*)+/i, '').trim() === cleanNum) ||
          (o.numero && o.numero.replace(/^(\s*OP\s*)+/i, '').trim() === cleanNum)
      );
    if (found) {
      setSelectedOp(found);
      setSearchTerm(cleanNum);
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

  // Contagem de OPs ativas por terminal (T1 a T5)
  const activeOrders = orderList.filter(isOpActive);

  const countsByTerminal: Record<string, number> = {
    ALL: activeOrders.length,
    T1: 0,
    T2: 0,
    T3: 0,
    T4: 0,
    T5: 0
  };

  activeOrders.forEach((op) => {
    const term = getTerminalForOp(op, apontamentos);
    if (countsByTerminal[term] !== undefined) {
      countsByTerminal[term]++;
    }
  });

  // Lista de Ordens filtradas localmente de forma reativa
  const filteredOrders = orderList.filter((op) => {
    const isActive = isOpActive(op);
    const hasSearch = searchTerm.trim().length > 0;

    // Se não há pesquisa manual digitada, oculta OPs finalizadas
    if (!hasSearch && !isActive) {
      return false;
    }

    // Filtro de Terminal selecionado (T1 a T5 ou Todos)
    if (selectedTerminal !== 'ALL') {
      const term = getTerminalForOp(op, apontamentos);
      if (term !== selectedTerminal) {
        return false;
      }
    }

    // Filtro de Pesquisa de Texto
    if (hasSearch) {
      const query = searchTerm.toLowerCase().trim();
      const cleanQuery = query.replace(/^(\s*OP\s*)+/i, '').trim();
      const opNum = (op.op_numero || op.numero || '').toLowerCase();
      const desc = (op.descricao || '').toLowerCase();
      const cod = (op.codigo || op.codigoProduto || '').toLowerCase();
      const client = (op.cliente || '').toLowerCase();

      return (
        opNum.includes(query) ||
        opNum.includes(cleanQuery) ||
        desc.includes(query) ||
        cod.includes(query) ||
        client.includes(query)
      );
    }

    return true;
  });

  // Análise da OP selecionada em detalhe
  const routeData = selectedOp ? getRouteForOp(selectedOp) : null;
  const steps = selectedOp ? obterEtapasDaRota(selectedOp) : [];
  const evaluation = selectedOp && steps.length > 0 ? getRouteEvaluation(selectedOp, apontamentos, steps) : null;
  const deadline = selectedOp ? calculateDeadlineInfo(selectedOp.data_entrega) : null;

  // Descobre status em tempo real da OP selecionada
  const activeApontamento = selectedOp
    ? apontamentos.find(
        (a) =>
          a.status === 'EM_ANDAMENTO' &&
          (a.op_numero === selectedOp.op_numero || a.op === selectedOp.op_numero || a.op_numero === selectedOp.numero)
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
        {/* Barra de Pesquisa com Botão de Bipar Câmera */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-2 flex items-center gap-2 shadow-lg">
          <div className="relative flex-1 flex items-center">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                const val = e.target.value.trim();
                const cleanVal = val.replace(/^(\s*OP\s*)+/i, '').trim();
                if (orders[val] || orders[cleanVal]) {
                  setSelectedOp(orders[val] || orders[cleanVal]);
                }
              }}
              placeholder="Digite o número da OP..."
              className="w-full pl-8 pr-8 py-2 bg-slate-950/80 border border-slate-800 rounded-xl text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setSelectedOp(null);
                }}
                className="absolute right-2 text-slate-400 hover:text-white p-1 rounded-md"
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

        {/* 2. SELETOR HORIZONTAL DE TERMINAIS NO TOPO (T1 A T5) */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 -mx-3.5 px-3.5 scroll-smooth select-none">
          {TERMINAL_FILTERS.map((term) => {
            const count = countsByTerminal[term.id] || 0;
            const isActive = selectedTerminal === term.id;
            return (
              <button
                key={term.id}
                type="button"
                onClick={() => {
                  playClick();
                  setSelectedTerminal(term.id);
                  if (selectedOp) {
                    setSelectedOp(null);
                  }
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all whitespace-nowrap flex items-center gap-1.5 shrink-0 cursor-pointer ${
                  isActive
                    ? 'bg-blue-600 text-white border border-blue-400 shadow-md shadow-blue-900/40 ring-1 ring-blue-400/40 scale-[1.02]'
                    : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 hover:border-slate-700'
                }`}
              >
                <span>{term.label}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                    isActive
                      ? 'bg-blue-800/90 text-white'
                      : count > 0
                      ? 'bg-slate-800 text-cyan-300 border border-slate-700'
                      : 'bg-slate-950 text-slate-500'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
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

        {/* Card de Rastreio Resumido da OP Selecionada */}
        {selectedOp && routeData && evaluation && deadline ? (
          <div className="space-y-3 animate-in fade-in duration-200">
            {/* Botão Voltar para a Lista */}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setSelectedOp(null)}
                className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-bold font-mono flex items-center gap-1.5 cursor-pointer transition active:scale-95 shadow-sm"
              >
                <ArrowLeft className="w-4 h-4 text-blue-400" />
                <span>Voltar à Lista de OPs</span>
              </button>

              <span className="text-[11px] font-mono text-slate-400">
                Posto: <strong className="text-blue-400">{getTerminalForOp(selectedOp, apontamentos)}</strong>
              </span>
            </div>

            {/* 1. Header do Item Rastreado */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-600 via-sky-400 to-emerald-400" />

              <div className="flex items-center justify-between gap-2 mb-2">
                {/* 1. Prefixo Duplicado Corrigido: exibe apenas "OP XXXXXX-XX" */}
                <div className="px-3 py-1 bg-[#1C2F8A] border border-blue-400/80 rounded-xl text-white font-mono font-black text-lg shadow-sm">
                  {formatOpNumber(selectedOp.op_numero || selectedOp.numero)}
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono font-bold text-amber-400">
                    {selectedOp.quantidade_total || 1} {selectedOp.unidade_medida || 'PC'}
                  </span>

                  {/* 2. Trava de Alerta de Atraso Antigo (> 60 dias) */}
                  {deadline.isDelayed ? (
                    <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-red-950/80 text-red-400 border border-red-800 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 text-red-400" />
                      {deadline.text}
                    </span>
                  ) : deadline.isHistoric || deadline.text === 'Lote Anterior' ? (
                    <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      Lote Anterior
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-800 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-emerald-400" />
                      No Prazo
                    </span>
                  )}
                </div>
              </div>

              <div className="text-sm font-bold text-white leading-tight mb-1">
                {selectedOp.descricao}
              </div>

              <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                <span>Cód: <strong className="text-slate-300">{selectedOp.codigo || selectedOp.codigoProduto || '—'}</strong></span>
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

              {/* 3. Identificação do Posto/Etapa Atual em Destaque */}
              <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-800/80">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950/80 border border-cyan-500/40 text-xs font-mono text-cyan-300 shadow-sm">
                  <Activity className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-slate-400">Etapa Atual:</span>
                  <strong className="text-white font-bold">{getOpEffectiveEtapa(selectedOp, apontamentos)}</strong>
                </span>
                <span className="text-[11px] font-mono text-slate-400">
                  Posto Físico: <strong className="text-blue-400 font-bold">{getTerminalForOp(selectedOp, apontamentos)}</strong>
                </span>
              </div>
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
                      (a.op_numero === selectedOp.op_numero || a.op === selectedOp.op_numero || a.op_numero === selectedOp.numero) &&
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
          /* Lista de Cards de OPs Filtradas */
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1 text-xs font-mono text-slate-400">
              <span className="font-bold uppercase tracking-wider">
                {selectedTerminal === 'ALL'
                  ? searchTerm
                    ? 'Resultados da Pesquisa'
                    : 'Ordens de Produção Ativas'
                  : `Posto ${TERMINAL_FILTERS.find((t) => t.id === selectedTerminal)?.label || selectedTerminal}`}
              </span>
              <span className="text-[11px] font-bold text-cyan-400">
                {filteredOrders.length} {filteredOrders.length === 1 ? 'OP' : 'OPs'}
              </span>
            </div>

            {filteredOrders.length === 0 ? (
              <div className="p-8 text-center bg-slate-900/60 border border-slate-800 rounded-2xl text-slate-400 font-mono text-xs">
                <Activity className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                <p className="font-semibold text-slate-300">Nenhuma ordem de produção encontrada.</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  {searchTerm
                    ? 'Verifique os termos da busca ou limpe o campo.'
                    : 'Não há ordens ativas nesta etapa no momento.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredOrders.map((op) => {
                  const dl = calculateDeadlineInfo(op.data_entrega);
                  const opEffectiveEtapa = getOpEffectiveEtapa(op, apontamentos);
                  const terminalForOp = getTerminalForOp(op, apontamentos);
                  const isRunning = apontamentos.some(
                    (a) =>
                      a.status === 'EM_ANDAMENTO' &&
                      (a.op_numero === op.op_numero || a.op === op.op_numero || a.op_numero === op.numero)
                  );

                  return (
                    <button
                      key={op.op_numero}
                      onClick={() => handleSelectOpByNumber(op.op_numero)}
                      className={`w-full p-3 bg-slate-900 hover:bg-slate-850 active:scale-[0.99] border rounded-2xl text-left transition flex flex-col gap-2 cursor-pointer shadow-md ${
                        isRunning
                          ? 'border-cyan-500/50 ring-1 ring-cyan-500/30 bg-cyan-950/20'
                          : 'border-slate-800'
                      }`}
                    >
                      {/* Linha 1: Badge OP (sem duplicação "OP OP"), Quantidade e Prazo */}
                      <div className="flex items-center justify-between gap-2 w-full">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono font-black text-blue-400 text-sm tracking-wide bg-[#1C2F8A]/30 border border-blue-400/40 px-2.5 py-0.5 rounded-lg shrink-0 shadow-sm">
                            {formatOpNumber(op.op_numero || op.numero)}
                          </span>
                          <span className="text-[10px] font-mono font-bold bg-slate-800/90 text-amber-300 px-2 py-0.5 rounded-md border border-slate-700 shrink-0">
                            {op.quantidade_total || 1} {op.unidade_medida || 'PC'}
                          </span>
                        </div>

                        {/* Trava de Alerta de Atraso Antigo (> 60 dias) */}
                        <div className="shrink-0">
                          {dl.isDelayed ? (
                            <span className="text-[10px] font-bold text-red-400 bg-red-950/70 px-2 py-0.5 rounded-md border border-red-900 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 text-red-400" />
                              {dl.text}
                            </span>
                          ) : dl.isHistoric || dl.text === 'Lote Anterior' ? (
                            <span className="text-[10px] font-bold text-slate-400 bg-slate-800/90 px-2 py-0.5 rounded-md border border-slate-700 flex items-center gap-1">
                              <Clock className="w-3 h-3 text-slate-500" />
                              Lote Anterior
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-md border border-emerald-900 flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-emerald-400" />
                              No Prazo
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Linha 2: Descrição e Código do Produto */}
                      <div className="text-xs font-semibold text-slate-200 line-clamp-2 leading-tight">
                        {op.descricao}
                      </div>

                      {/* Linha 3: Identificação do Posto/Etapa Atual em Destaque sutil e Terminal */}
                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80 w-full text-xs font-mono">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono border ${
                              isRunning
                                ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200 shadow-sm'
                                : 'bg-slate-950/80 border-slate-800 text-slate-300'
                            }`}
                          >
                            <Activity
                              className={`w-3 h-3 ${isRunning ? 'text-cyan-400 animate-spin' : 'text-cyan-400'}`}
                            />
                            <span className="text-slate-400 text-[10px]">Etapa Atual:</span>
                            <strong className="text-white font-bold truncate">
                              {opEffectiveEtapa}
                            </strong>
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-800/80 text-blue-300 border border-slate-700">
                            {terminalForOp}
                          </span>
                          <span className="text-slate-500 text-xs">→</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
