import React, { useState, useEffect, useRef, useMemo, useDeferredValue, useCallback } from 'react';
import { ProductionOrder, Apontamento } from '../types/mes';
import { getRouteForOp, getRouteEvaluation, isAncoraOrder, obterEtapasDaRota } from '../utils/routeEngine';
import { verificarECorrigirRotaOp } from '../services/mesStorage';
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
  RefreshCw,
  AlertTriangle,
  Monitor,
  Activity,
  User,
  ChevronRight,
  Zap,
  Building2
} from 'lucide-react';
import { MetalribLogo } from './MetalribLogo';
import { playClick, playBarcodeBeep } from '../utils/audio';

export type StatusFilterType = 'ALL' | 'RUNNING' | 'DELAYED' | 'WAITING' | 'FINISHED';

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
  if (norm.includes('ROUTER') || norm.includes('GAXETA')) {
    return 'T3';
  }

  // T2 - Injeção/Prep:
  if (norm.includes('INJE') || norm.includes('PREPARACAO')) {
    return 'T2';
  }

  // T1 - Chaparia:
  if (norm.includes('CORTE') || norm.includes('LASER') || norm.includes('DOBRA')) {
    return 'T1';
  }

  // T4 - Montagem Portas:
  if (norm.includes('MONTAGEM')) {
    return 'T4';
  }

  // Fallback padrão
  return 'T1';
}

/**
 * Cores temáticas para os postos de T1 a T5
 */
export function getTerminalBadgeColor(terminal: string): string {
  switch (terminal) {
    case 'T1':
      return 'bg-blue-950 text-blue-300 border-blue-700/70';
    case 'T2':
      return 'bg-purple-950 text-purple-300 border-purple-700/70';
    case 'T3':
      return 'bg-amber-950 text-amber-300 border-amber-700/70';
    case 'T4':
      return 'bg-sky-950 text-sky-300 border-sky-700/70';
    case 'T5':
      return 'bg-emerald-950 text-emerald-300 border-emerald-700/70';
    default:
      return 'bg-slate-850 text-slate-300 border-slate-700';
  }
}

/**
 * Encurta o nome da etapa para exibição compacta no badge [T# • Etapa]
 */
export function getShortStepName(stepName: string): string {
  if (!stepName) return 'Aguardando';
  const clean = stepName.replace(/^Aguardando\s+In[ií]cio\s+em:\s*/i, '').trim();
  const upper = clean.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (upper.includes('CORTE DE TRILHO')) return 'Corte Trilho';
  if (upper.includes('MONTAGEM DE TRILHO')) return 'Mont. Trilho';
  if (upper.includes('CORTE')) return 'Corte';
  if (upper.includes('LASER')) return 'Laser';
  if (upper.includes('DOBRA')) return 'Dobra';
  if (upper.includes('SOLDA')) return 'Solda';
  if (upper.includes('ROUTER')) return 'Router';
  if (upper.includes('GAXETA')) return 'Gaxeta';
  if (upper.includes('PREPARACAO') && upper.includes('FOLHA')) return 'Prep. Folha';
  if (upper.includes('PREPARACAO') && upper.includes('BAT')) return 'Prep. Bat.';
  if (upper.includes('PREPARACAO') && upper.includes('VAI')) return 'Prep. Vai-Vem';
  if (upper.includes('PREPARACAO')) return 'Preparação';
  if (upper.includes('INJE') && upper.includes('BAT')) return 'Inj. Batente';
  if (upper.includes('INJE')) return 'Injeção';
  if (upper.includes('MONTAGEM') && upper.includes('GIRAT')) return 'Mont. Giro';
  if (upper.includes('MONTAGEM') && upper.includes('CORR')) return 'Mont. Correr';
  if (upper.includes('MONTAGEM') && upper.includes('VAI')) return 'Mont. Vai-Vem';
  if (upper.includes('MONTAGEM') && upper.includes('OFFICE') && upper.includes('GIR')) return 'Mont. Off. Gir';
  if (upper.includes('MONTAGEM') && upper.includes('OFFICE') && upper.includes('COR')) return 'Mont. Off. Cor';
  if (upper.includes('MONTAGEM') && upper.includes('ESTANTE')) return 'Mont. Estante';
  if (upper.includes('MONTAGEM') && (upper.includes('ABRIGO') || upper.includes('DOCA'))) return 'Mont. Doca';
  if (upper.includes('MONTAGEM') && upper.includes('EMENDADA')) return 'Mont. Emendada';
  if (upper.includes('MONTAGEM')) return 'Montagem';

  return clean.length > 14 ? clean.slice(0, 12) + '...' : clean;
}

interface MobileOpCardItemProps {
  op: ProductionOrder;
  apontamentos?: Apontamento[];
  activeApt?: Apontamento;
  onSelect: (opNumero: string) => void;
}

const MobileOpCardItem = React.memo<MobileOpCardItemProps>(({
  op,
  apontamentos = [],
  activeApt,
  onSelect
}) => {
  if (!op) return null;

  const isRunning = Boolean(activeApt);
  const dl = calculateDeadlineInfo(op?.data_entrega);
  const opEffectiveEtapa = getOpEffectiveEtapa(op, apontamentos || []);
  const terminalForOp = getTerminalForOp(op, apontamentos || []);
  const shortStep = getShortStepName(opEffectiveEtapa);

  // Cálculo dinâmico do progresso segmentado por etapas
  let opSteps: string[] = [];
  try {
    opSteps = (op ? obterEtapasDaRota(op) : []) || [];
  } catch (e) {
    opSteps = [];
  }
  const totalSteps = opSteps.length;
  let evalResult: Record<string, any> = {};
  try {
    evalResult = (op && totalSteps > 0 ? getRouteEvaluation(op, apontamentos || [], opSteps) : {}) || {};
  } catch (e) {
    evalResult = {};
  }
  const totalOpQtd = op?.quantidade_total || 1;

  let finishedCount = 0;
  let inProgressStepIdx = -1;
  opSteps.forEach((s, idx) => {
    const stepEval = evalResult?.[s];
    if (stepEval && (stepEval.finalizadas || 0) >= totalOpQtd) {
      finishedCount++;
    } else if (inProgressStepIdx === -1 && stepEval && (stepEval.emAndamento || 0) > 0) {
      inProgressStepIdx = idx;
    }
  });
  const progressPercent =
    totalSteps > 0 ? Math.round((finishedCount / totalSteps) * 100) : 0;
  const isFinished =
    op?.status === 'FINALIZADA' || (totalSteps > 0 && finishedCount >= totalSteps);

  const opNumero = op?.op_numero || op?.numero || '';

  return (
    <button
      type="button"
      onClick={() => onSelect(opNumero)}
      className={`w-full p-3 bg-slate-900/90 hover:bg-slate-850 active:scale-[0.99] border rounded-2xl text-left transition-all flex flex-col gap-2 cursor-pointer group shadow-sm ${
        isRunning
          ? 'border-cyan-500/60 bg-[#0a1528] ring-1 ring-cyan-500/30'
          : isFinished
          ? 'border-emerald-500/30 bg-emerald-950/10'
          : dl?.isDelayed
          ? 'border-red-900/60 bg-red-950/10'
          : 'border-slate-800/90 hover:border-slate-700'
      }`}
    >
      {/* LINHA 1: Topo com OP + Quantidade + Badges de Status e Terminal */}
      <div className="flex items-center justify-between gap-2 w-full">
        {/* Esquerda: OP e Qtd */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-mono font-black text-blue-300 text-xs tracking-wide bg-[#1C2F8A] border border-blue-400/50 px-2 py-0.5 rounded-lg shrink-0 shadow-sm">
            {formatOpNumber(op?.op_numero || op?.numero)}
          </span>
          <span className="text-[10px] font-mono font-bold bg-slate-800 text-amber-300 px-1.5 py-0.5 rounded-md border border-slate-700 shrink-0">
            {op?.quantidade_total || 1} {op?.unidade_medida || 'PC'}
          </span>
        </div>

        {/* Direita: Prazo e Posto */}
        <div className="flex items-center gap-1.5 shrink-0">
          {dl?.isDelayed ? (
            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-red-950 text-red-300 border border-red-800 shrink-0 whitespace-nowrap flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse shrink-0" />
              {Math.abs(dl.daysDiff)}d atraso
            </span>
          ) : dl?.isHistoric || dl?.text === 'Lote Anterior' ? (
            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-slate-800 text-slate-400 border border-slate-700 shrink-0 whitespace-nowrap">
              Lote Ant.
            </span>
          ) : null}

          <span
            className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border shrink-0 whitespace-nowrap ${getTerminalBadgeColor(
              terminalForOp
            )}`}
          >
            {terminalForOp} • {shortStep}
          </span>
        </div>
      </div>

      {/* LINHA 2: Cliente / Obra (se existir no cadastro da OP) */}
      {op?.cliente && (
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-sky-300 font-semibold truncate">
          <Building2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span className="truncate">{op.cliente}</span>
        </div>
      )}

      {/* LINHA 3: Descrição da Peça */}
      <div className="flex items-center justify-between gap-2 w-full text-xs min-w-0">
        <p className="text-xs text-slate-200 font-medium truncate flex-1 min-w-0">
          {op?.descricao || 'Sem descrição'}
        </p>
        <ChevronRight className="w-4 h-4 text-slate-500 shrink-0 group-hover:text-blue-300 group-hover:translate-x-0.5 transition-transform" />
      </div>

      {/* LINHA 4: Indicador Pulsante se estiver com Operador Ativo */}
      {isRunning && activeApt && (
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-cyan-300 bg-cyan-950/60 border border-cyan-500/40 rounded-lg px-2.5 py-1">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping shrink-0" />
          <User className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="truncate">
            <strong>{activeApt.operador}</strong> em <strong>{String(activeApt.setor || '').toUpperCase()}</strong>
          </span>
        </div>
      )}

      {/* LINHA 5: Barra Segmentada de Progresso */}
      <div className="flex items-center gap-2 pt-1 border-t border-slate-800/70">
        <div className="flex-1 flex items-center gap-1 h-1.5 bg-slate-950 rounded-full p-0.5 border border-slate-800">
          {opSteps.map((st, i) => {
            const isDone = i < finishedCount;
            const isCur = i === inProgressStepIdx || (i === finishedCount && isRunning);
            return (
              <div
                key={st}
                className={`h-full flex-1 rounded-full transition-all ${
                  isDone
                    ? 'bg-emerald-400'
                    : isCur
                    ? 'bg-cyan-400 animate-pulse shadow-sm shadow-cyan-400/50'
                    : 'bg-slate-800'
                }`}
                title={`${i + 1}. ${st}`}
              />
            );
          })}
        </div>
        <span className="text-[10px] font-mono font-bold text-slate-400 shrink-0">
          {finishedCount}/{totalSteps} ({progressPercent}%)
        </span>
      </div>
    </button>
  );
});

interface MobilePcpTrackerProps {
  orders?: Record<string, ProductionOrder>;
  apontamentos?: Apontamento[];
  initialOpNumber?: string | null;
  onRefresh?: () => Promise<void> | void;
  onSwitchToTotem: () => void;
  onSelectOpForTotem?: (opNumero: string) => void;
  onOpenSupervisor?: () => void;
}

export const MobilePcpTracker: React.FC<MobilePcpTrackerProps> = ({
  orders = {},
  apontamentos = [],
  initialOpNumber,
  onRefresh,
  onSwitchToTotem,
  onSelectOpForTotem,
  onOpenSupervisor
}) => {
  const [searchTerm, setSearchTerm] = useState<string>(initialOpNumber || '');
  const deferredSearch = useDeferredValue(searchTerm);
  const [selectedOp, setSelectedOp] = useState<ProductionOrder | null>(null);
  const [selectedTerminal, setSelectedTerminal] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilterType>('ALL');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isScannerOpen, setIsScannerOpen] = useState<boolean>(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [manualOpInput, setManualOpInput] = useState<string>('');
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // Sincroniza OP inicial se fornecida
  useEffect(() => {
    if (initialOpNumber && orders?.[initialOpNumber]) {
      setSelectedOp(verificarECorrigirRotaOp(orders[initialOpNumber]));
      setSearchTerm(initialOpNumber);
    }
  }, [initialOpNumber, orders]);

  const orderList = useMemo(() => {
    try {
      if (!orders || typeof orders !== 'object') return [];
      return Object.values(orders)
        .filter((o): o is ProductionOrder => Boolean(o && typeof o === 'object'))
        .map(verificarECorrigirRotaOp);
    } catch (err) {
      console.error('[MobilePcpTracker] Erro ao carregar orderList:', err);
      return [];
    }
  }, [orders]);

  // Mapa rápido de apontamentos ativos indexados por OP
  const activeApontamentoByOp = useMemo(() => {
    const map: Record<string, Apontamento> = {};
    if (!Array.isArray(apontamentos)) return map;
    apontamentos.forEach((a) => {
      if (a && a.status === 'EM_ANDAMENTO') {
        const opNum = a.op_numero || a.op;
        if (opNum) {
          const clean = String(opNum).replace(/^(\s*OP\s*)+/i, '').trim();
          map[clean] = a;
          map[opNum] = a;
        }
      }
    });
    return map;
  }, [apontamentos]);

  // Mantém a OP selecionada rigorosamente sincronizada caso seja atualizada no servidor local
  useEffect(() => {
    if (selectedOp) {
      const opNumKey = selectedOp.op_numero;
      const numeroKey = selectedOp.numero;
      const cleanNum = (opNumKey || numeroKey || '').replace(/^(\s*OP\s*)+/i, '').trim();
      const updated =
        (opNumKey && orders ? orders[opNumKey] : undefined) ||
        (numeroKey && orders ? orders[numeroKey] : undefined) ||
        (cleanNum && orders ? orders[cleanNum] : undefined) ||
        (orders ? orders[`OP ${cleanNum}`] : undefined) ||
        orderList.find(
          (o) =>
            (o.op_numero && o.op_numero.replace(/^(\s*OP\s*)+/i, '').trim() === cleanNum) ||
            (o.numero && o.numero.replace(/^(\s*OP\s*)+/i, '').trim() === cleanNum)
        );
      if (updated) {
        setSelectedOp(updated);
      } else {
        setSelectedOp(null);
      }
    }
  }, [orders, orderList]);

  // Busca e seleção por número digitado ou clicado
  const handleSelectOpByNumber = useCallback((opNum: string) => {
    playClick();
    const cleanNum = (opNum || '').replace(/^(\s*OP\s*)+/i, '').trim();
    if (!cleanNum) return;
    const found =
      (orders ? orders[cleanNum] : undefined) ||
      (orders ? orders[opNum] : undefined) ||
      (orders ? orders[`OP ${cleanNum}`] : undefined) ||
      orderList.find(
        (o) =>
          (o.op_numero && o.op_numero.replace(/^(\s*OP\s*)+/i, '').trim() === cleanNum) ||
          (o.numero && o.numero.replace(/^(\s*OP\s*)+/i, '').trim() === cleanNum)
      );
    if (found) {
      setSelectedOp(found);
    } else {
      setSelectedOp(null);
    }
  }, [orders, orderList]);

  // Gerenciamento seguro do Scanner de Câmera (blindado para HTTP e navegadores sem suporte)
  useEffect(() => {
    if (!isScannerOpen) {
      if (scannerRef.current) {
        try {
          scannerRef.current
            .stop()
            .then(() => {
              scannerRef.current = null;
            })
            .catch(() => {
              scannerRef.current = null;
            });
        } catch {
          scannerRef.current = null;
        }
      }
      return;
    }

    // 1. Verificação defensiva de ambiente seguro (HTTPS / Localhost)
    const isLocalhost =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const isSecure = typeof window !== 'undefined' && (window.isSecureContext || isLocalhost);
    const hasMediaDevices =
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function';

    if (!isSecure && !isLocalhost) {
      console.warn('[Camera] Acesso à câmera bloqueado pelo navegador em HTTP de rede local.');
      setScannerError('Acesso à câmera bloqueado pelo navegador em redes HTTP sem SSL (192.168.0.x). Digite o número da OP ou crachá abaixo:');
      return;
    }

    if (!hasMediaDevices) {
      console.warn('[Camera] navigator.mediaDevices.getUserMedia indisponível.');
      setScannerError('Câmera não suportada neste dispositivo. Digite o número da OP ou crachá abaixo:');
      return;
    }

    let isCancelled = false;
    let html5QrCode: Html5Qrcode | null = null;

    // Aguarda o elemento renderizar no DOM antes de acoplar o scanner
    const timer = setTimeout(() => {
      if (isCancelled) return;
      try {
        const elem = document.getElementById('mobile-camera-reader');
        if (!elem) {
          setScannerError('Elemento visual do leitor não encontrado. Digite a OP manualmente:');
          return;
        }

        html5QrCode = new Html5Qrcode('mobile-camera-reader');
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
              if (typeof navigator !== 'undefined' && navigator.vibrate) {
                try {
                  navigator.vibrate(100);
                } catch {}
              }
              const clean = (decodedText || '').replace(/^(\s*OP\s*)+/i, '').trim();
              setSearchTerm(clean);
              handleSelectOpByNumber(clean);
              setIsScannerOpen(false);
            },
            () => {
              // Leituras vazias ignoradas em loop
            }
          )
          .catch((err) => {
            console.error('[Camera] Erro ao iniciar câmera:', err);
            setScannerError('Acesso à câmera negado ou indisponível. Digite o número da OP ou crachá abaixo:');
          });
      } catch (err) {
        console.error('[Camera] Exceção síncrona ao inicializar Html5Qrcode:', err);
        setScannerError('Não foi possível iniciar a câmera neste aparelho. Digite a OP manualmente:');
      }
    }, 120);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
      if (scannerRef.current) {
        try {
          scannerRef.current.stop().catch(() => {}).finally(() => {
            scannerRef.current = null;
          });
        } catch {
          scannerRef.current = null;
        }
      }
    };
  }, [isScannerOpen, handleSelectOpByNumber]);

  // Contagem de OPs ativas por terminal (T1 a T5)
  const activeOrders = useMemo(() => orderList.filter(isOpActive), [orderList]);

  const countsByTerminal: Record<string, number> = useMemo(() => {
    const counts: Record<string, number> = {
      ALL: activeOrders.length,
      T1: 0,
      T2: 0,
      T3: 0,
      T4: 0,
      T5: 0
    };

    activeOrders.forEach((op) => {
      if (!op) return;
      const term = getTerminalForOp(op, apontamentos || []);
      if (counts[term] !== undefined) {
        counts[term]++;
      }
    });

    return counts;
  }, [activeOrders, apontamentos]);

  // Contagem para o Micro-Dashboard no Topo (Opção 2)
  const kpiCounts = useMemo(() => {
    let running = 0;
    let delayed = 0;
    let waiting = 0;
    let finished = 0;
    let totalActive = 0;

    orderList.forEach((op) => {
      if (!op) return;
      const isActive = isOpActive(op);
      const cleanNum = (op.op_numero || op.numero || '').replace(/^(\s*OP\s*)+/i, '').trim();
      const isRunning = Boolean(
        activeApontamentoByOp[cleanNum] || (op.op_numero && activeApontamentoByOp[op.op_numero])
      );
      const dl = calculateDeadlineInfo(op.data_entrega);
      const isFinished = !isActive || op.status === 'FINALIZADA';

      if (isFinished) {
        finished++;
      } else {
        totalActive++;
        if (isRunning) {
          running++;
        } else {
          waiting++;
        }
        if (dl?.isDelayed) {
          delayed++;
        }
      }
    });

    return { running, delayed, waiting, finished, totalActive };
  }, [orderList, activeApontamentoByOp]);

  // Lista de Ordens filtradas reativamente com busca diferida (zero travamento)
  const filteredOrders = useMemo(() => {
    try {
      return orderList.filter((op) => {
        if (!op) return false;
        const isActive = isOpActive(op);
        const hasSearch = (deferredSearch || '').trim().length > 0;
        const cleanNum = (op.op_numero || op.numero || '').replace(/^(\s*OP\s*)+/i, '').trim();
        const isRunning = Boolean(
          activeApontamentoByOp[cleanNum] || (op.op_numero && activeApontamentoByOp[op.op_numero])
        );
        const dl = calculateDeadlineInfo(op.data_entrega);
        const isFinished = !isActive || op.status === 'FINALIZADA';

        // Filtro de Status
        if (statusFilter === 'FINISHED') {
          if (!isFinished) return false;
        } else {
          // Se não há pesquisa manual e não estamos no filtro FINISHED, oculta finalizadas
          if (!hasSearch && isFinished) {
            return false;
          }
        }

        if (statusFilter === 'RUNNING' && !isRunning) return false;
        if (statusFilter === 'DELAYED' && !dl?.isDelayed) return false;
        if (statusFilter === 'WAITING' && (isRunning || isFinished)) return false;

        // Filtro de Terminal selecionado (T1 a T5 ou Todos)
        if (selectedTerminal !== 'ALL') {
          const term = getTerminalForOp(op, apontamentos || []);
          if (term !== selectedTerminal) {
            return false;
          }
        }

        // Filtro de Pesquisa de Texto
        if (hasSearch) {
          const query = (deferredSearch || '').toLowerCase().trim();
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
    } catch (err) {
      console.error('[MobilePcpTracker] Erro ao filtrar ordens:', err);
      return [];
    }
  }, [orderList, statusFilter, selectedTerminal, deferredSearch, activeApontamentoByOp, apontamentos]);

  // Dados da OP selecionada para o Bottom Sheet (Opção 4)
  const routeData = selectedOp ? getRouteForOp(selectedOp) : null;
  const steps = selectedOp ? (obterEtapasDaRota(selectedOp) || []) : [];
  const evaluation = selectedOp && steps.length > 0 ? getRouteEvaluation(selectedOp, apontamentos || [], steps) : null;
  const deadline = selectedOp ? calculateDeadlineInfo(selectedOp.data_entrega) : null;
  const terminalForSelected = selectedOp ? getTerminalForOp(selectedOp, apontamentos || []) : 'T1';

  const activeApontamento = selectedOp
    ? (apontamentos || []).find(
        (a) =>
          a &&
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
    <div className="w-full max-w-md mx-auto min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans border-x border-slate-800 shadow-2xl relative select-none">
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
          {onRefresh && (
            <button
              type="button"
              onClick={async () => {
                playClick();
                setIsRefreshing(true);
                try {
                  await onRefresh();
                } finally {
                  setTimeout(() => setIsRefreshing(false), 500);
                }
              }}
              disabled={isRefreshing}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-blue-400 border border-slate-700 text-xs font-bold flex items-center justify-center cursor-pointer active:scale-95 transition"
              title="Sincronizar dados em tempo real"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-blue-300' : ''}`} />
            </button>
          )}

          <button
            onClick={() => {
              playClick();
              onSwitchToTotem();
            }}
            className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer active:scale-95 transition"
            title="Mudar para Modo Totem de Chão de Fábrica"
          >
            <Monitor className="w-3.5 h-3.5 text-amber-400" />
            <span>Totem</span>
          </button>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <div className="flex-1 p-3.5 flex flex-col gap-3 pb-8">
        {/* 1. Barra de Pesquisa com Botão de Bipar Câmera */}
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
              placeholder="Buscar OP, produto ou cliente..."
              className="w-full pl-8 pr-8 py-2 bg-slate-950/80 border border-slate-800 rounded-xl text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
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
            <span>Bipar</span>
          </button>
        </div>

        {/* 2. MICRO-DASHBOARD / CHIPS DE FILTRO RÁPIDO DE STATUS (Opção 2) */}
        <div className="grid grid-cols-4 gap-1.5">
          {/* Produzindo */}
          <button
            type="button"
            onClick={() => {
              playClick();
              setStatusFilter((prev) => (prev === 'RUNNING' ? 'ALL' : 'RUNNING'));
            }}
            className={`p-2 rounded-xl border flex flex-col items-center justify-center transition-all cursor-pointer ${
              statusFilter === 'RUNNING'
                ? 'bg-cyan-950 border-cyan-400 text-cyan-200 shadow-md shadow-cyan-950/50 ring-1 ring-cyan-400/50 scale-[1.02]'
                : 'bg-slate-900/90 border-slate-800 text-slate-300 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center gap-1 text-[10px] font-mono font-bold text-cyan-400">
              <Zap className="w-3 h-3 text-cyan-400 fill-cyan-400/20" />
              <span>PRODUÇÃO</span>
            </div>
            <span className="text-base font-black font-mono mt-0.5 text-white">
              {kpiCounts.running}
            </span>
          </button>

          {/* Atrasadas */}
          <button
            type="button"
            onClick={() => {
              playClick();
              setStatusFilter((prev) => (prev === 'DELAYED' ? 'ALL' : 'DELAYED'));
            }}
            className={`p-2 rounded-xl border flex flex-col items-center justify-center transition-all cursor-pointer ${
              statusFilter === 'DELAYED'
                ? 'bg-red-950 border-red-500 text-red-200 shadow-md shadow-red-950/50 ring-1 ring-red-500/50 scale-[1.02]'
                : 'bg-slate-900/90 border-slate-800 text-slate-300 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center gap-1 text-[10px] font-mono font-bold text-red-400">
              <AlertTriangle className="w-3 h-3 text-red-400" />
              <span>ATRASO</span>
            </div>
            <span className={`text-base font-black font-mono mt-0.5 ${kpiCounts.delayed > 0 ? 'text-red-400' : 'text-slate-400'}`}>
              {kpiCounts.delayed}
            </span>
          </button>

          {/* Na Fila */}
          <button
            type="button"
            onClick={() => {
              playClick();
              setStatusFilter((prev) => (prev === 'WAITING' ? 'ALL' : 'WAITING'));
            }}
            className={`p-2 rounded-xl border flex flex-col items-center justify-center transition-all cursor-pointer ${
              statusFilter === 'WAITING'
                ? 'bg-amber-950 border-amber-500 text-amber-200 shadow-md shadow-amber-950/50 ring-1 ring-amber-500/50 scale-[1.02]'
                : 'bg-slate-900/90 border-slate-800 text-slate-300 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center gap-1 text-[10px] font-mono font-bold text-amber-400">
              <Clock className="w-3 h-3 text-amber-400" />
              <span>NA FILA</span>
            </div>
            <span className="text-base font-black font-mono mt-0.5 text-white">
              {kpiCounts.waiting}
            </span>
          </button>

          {/* Concluídas */}
          <button
            type="button"
            onClick={() => {
              playClick();
              setStatusFilter((prev) => (prev === 'FINISHED' ? 'ALL' : 'FINISHED'));
            }}
            className={`p-2 rounded-xl border flex flex-col items-center justify-center transition-all cursor-pointer ${
              statusFilter === 'FINISHED'
                ? 'bg-emerald-950 border-emerald-500 text-emerald-200 shadow-md shadow-emerald-950/50 ring-1 ring-emerald-500/50 scale-[1.02]'
                : 'bg-slate-900/90 border-slate-800 text-slate-300 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-400">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span>PRONTAS</span>
            </div>
            <span className="text-base font-black font-mono mt-0.5 text-white">
              {kpiCounts.finished}
            </span>
          </button>
        </div>

        {/* 3. SELETOR HORIZONTAL DE TERMINAIS NO TOPO (T1 A T5) */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 -mx-3.5 px-3.5 scroll-smooth select-none">
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
                      ? 'bg-blue-800 text-white'
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
                  LEITURA DE CÓDIGO DA OP
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setIsScannerOpen(false);
                    setScannerError(null);
                    setManualOpInput('');
                  }}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {scannerError ? (
                <div className="p-4 bg-slate-950/90 border border-amber-500/40 rounded-xl text-xs space-y-3 text-center">
                  <div className="flex items-center justify-center gap-1.5 text-amber-400 font-bold">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Digitação Manual da OP</span>
                  </div>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    {scannerError}
                  </p>
                  <div className="flex gap-2 pt-1">
                    <input
                      type="text"
                      value={manualOpInput}
                      onChange={(e) => setManualOpInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const clean = manualOpInput.replace(/^(\s*OP\s*)+/i, '').trim();
                          if (clean) {
                            playBarcodeBeep();
                            setSearchTerm(clean);
                            handleSelectOpByNumber(clean);
                            setIsScannerOpen(false);
                            setManualOpInput('');
                          }
                        }
                      }}
                      placeholder="Ex: 023752-01 ou crachá"
                      className="flex-1 bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono text-white outline-none placeholder:text-slate-500"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const clean = manualOpInput.replace(/^(\s*OP\s*)+/i, '').trim();
                        if (clean) {
                          playBarcodeBeep();
                          setSearchTerm(clean);
                          handleSelectOpByNumber(clean);
                          setIsScannerOpen(false);
                          setManualOpInput('');
                        }
                      }}
                      disabled={!manualOpInput.trim()}
                      className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold rounded-xl text-xs font-mono transition cursor-pointer"
                    >
                      Buscar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="overflow-hidden rounded-xl border border-slate-700 bg-black">
                    <div id="mobile-camera-reader" className="w-full h-64" />
                  </div>
                  <div className="p-2 bg-slate-950/60 rounded-xl border border-slate-800 flex gap-2">
                    <input
                      type="text"
                      value={manualOpInput}
                      onChange={(e) => setManualOpInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const clean = manualOpInput.replace(/^(\s*OP\s*)+/i, '').trim();
                          if (clean) {
                            playBarcodeBeep();
                            setSearchTerm(clean);
                            handleSelectOpByNumber(clean);
                            setIsScannerOpen(false);
                            setManualOpInput('');
                          }
                        }
                      }}
                      placeholder="Ou digite a OP aqui..."
                      className="flex-1 bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-1.5 text-xs font-mono text-white outline-none placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const clean = manualOpInput.replace(/^(\s*OP\s*)+/i, '').trim();
                        if (clean) {
                          playBarcodeBeep();
                          setSearchTerm(clean);
                          handleSelectOpByNumber(clean);
                          setIsScannerOpen(false);
                          setManualOpInput('');
                        }
                      }}
                      disabled={!manualOpInput.trim()}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold rounded-xl text-xs font-mono transition cursor-pointer"
                    >
                      OK
                    </button>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setIsScannerOpen(false);
                  setScannerError(null);
                  setManualOpInput('');
                }}
                className="mt-3 w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold font-mono cursor-pointer transition"
              >
                Fechar
              </button>
            </div>
          </div>
        )}

        {/* 4. LISTA DE CARDS DE OPS (Opção 3) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1 text-xs font-mono text-slate-400">
            <span className="font-bold uppercase tracking-wider flex items-center gap-1.5">
              {statusFilter === 'RUNNING' && <Zap className="w-3.5 h-3.5 text-cyan-400" />}
              {statusFilter === 'DELAYED' && <AlertTriangle className="w-3.5 h-3.5 text-red-400" />}
              {statusFilter === 'WAITING' && <Clock className="w-3.5 h-3.5 text-amber-400" />}
              {statusFilter === 'FINISHED' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
              <span>
                {statusFilter === 'RUNNING'
                  ? 'OPs em Produção Agora'
                  : statusFilter === 'DELAYED'
                  ? 'OPs com Atraso Crítico'
                  : statusFilter === 'WAITING'
                  ? 'OPs na Fila / Aguardando'
                  : statusFilter === 'FINISHED'
                  ? 'OPs Concluídas'
                  : selectedTerminal === 'ALL'
                  ? searchTerm
                    ? 'Resultados da Pesquisa'
                    : 'Ordens de Produção Ativas'
                  : `Posto ${TERMINAL_FILTERS.find((t) => t.id === selectedTerminal)?.label || selectedTerminal}`}
              </span>
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
                  : 'Nenhuma OP ativa corresponde aos filtros selecionados.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredOrders.map((op, idx) => {
                if (!op) return null;
                const cleanNum = (op?.op_numero || op?.numero || '').replace(/^(\s*OP\s*)+/i, '').trim();
                const activeApt =
                  activeApontamentoByOp[cleanNum] ||
                  (op?.op_numero ? activeApontamentoByOp[op.op_numero] : undefined);
                return (
                  <MobileOpCardItem
                    key={`${op?.id || op?.numero || op?.op_numero || 'op'}-${idx}`}
                    op={op}
                    apontamentos={apontamentos || []}
                    activeApt={activeApt}
                    onSelect={handleSelectOpByNumber}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 5. GAVETA INFERIOR / BOTTOM SHEET DE DETALHES DA OP (Opção 4) */}
      {selectedOp && routeData && evaluation && deadline && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          {/* Backdrop com blur escuro clicável para fechar */}
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
            onClick={() => setSelectedOp(null)}
          />

          {/* Container Deslizante Inferior (Bottom Sheet) */}
          <div className="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] sm:max-w-md sm:mx-auto bg-[#0a1022] border-t-2 border-blue-500/50 rounded-t-3xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300">
            {/* Alça visual de arrasto no topo */}
            <div
              className="w-full pt-2.5 pb-1 flex justify-center cursor-pointer"
              onClick={() => setSelectedOp(null)}
            >
              <div className="w-12 h-1.5 bg-slate-700 hover:bg-slate-500 rounded-full transition" />
            </div>

            {/* Cabeçalho Fixo do Bottom Sheet */}
            <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between gap-2 bg-[#0c142b]">
              <div className="flex items-center gap-2 min-w-0">
                <span className="px-2.5 py-1 bg-[#1C2F8A] border border-blue-400/80 rounded-xl text-white font-mono font-black text-base shadow-sm shrink-0">
                  {formatOpNumber(selectedOp.op_numero || selectedOp.numero)}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-lg text-xs font-mono font-bold border shrink-0 ${getTerminalBadgeColor(
                    terminalForSelected
                  )}`}
                >
                  {terminalForSelected} • {getShortStepName(getOpEffectiveEtapa(selectedOp, apontamentos))}
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  playClick();
                  setSelectedOp(null);
                }}
                className="p-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 cursor-pointer active:scale-95 transition"
                title="Fechar Detalhes"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Conteúdo com Scroll do Bottom Sheet */}
            <div className="flex-1 overflow-y-auto px-4 py-3.5 space-y-3.5">
              {/* Identificação do Produto & Cliente */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 shadow-md space-y-2">
                {selectedOp.cliente && (
                  <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-sky-400 pb-1 border-b border-slate-800">
                    <Building2 className="w-4 h-4 text-sky-400 shrink-0" />
                    <span>Cliente: {selectedOp.cliente}</span>
                  </div>
                )}

                <div className="text-sm font-bold text-white leading-snug">
                  {selectedOp.descricao}
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 text-xs font-mono">
                  <div className="bg-slate-950/70 p-2 rounded-xl border border-slate-800">
                    <span className="text-slate-400 block text-[10px]">CÓDIGO:</span>
                    <strong className="text-white text-xs">
                      {selectedOp.codigo || selectedOp.codigoProduto || '—'}
                    </strong>
                  </div>
                  <div className="bg-slate-950/70 p-2 rounded-xl border border-slate-800">
                    <span className="text-slate-400 block text-[10px]">QUANTIDADE:</span>
                    <strong className="text-amber-300 text-xs">
                      {selectedOp.quantidade_total || 1} {selectedOp.unidade_medida || 'PC'}
                    </strong>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs font-mono pt-1">
                  <span className="text-slate-400">
                    Entrega: <strong className="text-slate-200">{selectedOp.data_entrega || '—'}</strong>
                  </span>
                  {deadline?.isDelayed ? (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-950 text-red-300 border border-red-800 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 text-red-400" />
                      {deadline.text}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-emerald-400" />
                      {deadline?.text || 'No Prazo'}
                    </span>
                  )}
                </div>
              </div>

              {/* Card de Status Atual em Tempo Real */}
              <div
                className={`p-3.5 rounded-2xl border text-xs font-mono shadow-md transition-all ${
                  isOrderFullyCompleted
                    ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300'
                    : activeApontamento
                    ? 'bg-cyan-950/60 border-cyan-500/60 text-cyan-200 ring-1 ring-cyan-500/20'
                    : 'bg-slate-900 border-slate-800 text-slate-300'
                }`}
              >
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5" />
                  <span>SITUAÇÃO ATUAL NO CHÃO DE FÁBRICA</span>
                </div>

                {isOrderFullyCompleted ? (
                  <div className="flex items-center gap-2 text-sm font-bold text-emerald-400 py-1">
                    <CheckCircle2 className="w-5 h-5 shrink-0" />
                    <span>PRODUÇÃO CONCLUÍDA EM TODOS OS SETORES</span>
                  </div>
                ) : activeApontamento ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-sm font-bold text-cyan-300">
                      <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping shrink-0" />
                      <span>EM PRODUÇÃO: {String(activeApontamento.setor || '').toUpperCase()}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-300 pt-1">
                      <User className="w-3.5 h-3.5 text-amber-400" />
                      <span>
                        Operador: <strong>{activeApontamento.operador}</strong>
                      </span>
                      <span>·</span>
                      <Clock className="w-3.5 h-3.5 text-blue-400" />
                      <span>
                        Iniciado às {(() => {
                          try {
                            return activeApontamento.hora_inicio ? new Date(activeApontamento.hora_inicio).toLocaleTimeString('pt-BR') : '';
                          } catch {
                            return '';
                          }
                        })()}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 flex items-center gap-2 py-1">
                    <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>Aguardando apontamento de operador na fábrica</span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-800/80">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950/80 border border-cyan-500/40 text-xs font-mono text-cyan-300 shadow-sm">
                    <Activity className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-slate-400">Etapa Atual:</span>
                    <strong className="text-white font-bold">{getOpEffectiveEtapa(selectedOp, apontamentos || [])}</strong>
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    Posto: <strong className="text-blue-400 font-bold">{terminalForSelected}</strong>
                  </span>
                </div>
              </div>

              {/* Linha do Tempo Vertical da Rota */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 shadow-md">
                <div className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center justify-between">
                  <span>LINHA DO TEMPO ({steps.length} ETAPAS)</span>
                  <span className="text-blue-400">{routeData?.rule?.label || 'Rota'}</span>
                </div>

                <div className="space-y-2.5 relative">
                  <div className="absolute left-[13px] top-3 bottom-3 w-0.5 bg-slate-800 -z-0" />

                  {steps.map((step, idx) => {
                    const stepEval = evaluation ? evaluation[step] : null;
                    const totalOpQtd = selectedOp.quantidade_total || 1;
                    const isFinished = stepEval ? (stepEval.finalizadas || 0) >= totalOpQtd : false;
                    const isInProgress = stepEval ? (stepEval.emAndamento || 0) > 0 : false;

                    const aptsForStep = (apontamentos || []).filter(
                      (a) =>
                        a &&
                        (a.op_numero === selectedOp.op_numero ||
                          a.op === selectedOp.op_numero ||
                          a.op_numero === selectedOp.numero) &&
                        (a.etapa_rota === step || String(a.setor || '').toLowerCase().includes(step.toLowerCase()))
                    );
                    const lastApt = aptsForStep[aptsForStep.length - 1];

                    return (
                      <div
                        key={step}
                        className={`relative z-10 flex items-start gap-3 p-2.5 rounded-xl transition border text-xs font-mono ${
                          isFinished
                            ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
                            : isInProgress
                            ? 'bg-cyan-950/40 border-cyan-400/60 ring-1 ring-cyan-500/40 text-cyan-200'
                            : 'bg-slate-950/50 border-slate-800/80 text-slate-400'
                        }`}
                      >
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
                                  Finalizado às {(() => {
                                    try {
                                      return new Date(lastApt.hora_fim).toLocaleTimeString('pt-BR');
                                    } catch {
                                      return '';
                                    }
                                  })()}
                                </span>
                              )}
                              {lastApt.status === 'EM_ANDAMENTO' && lastApt.hora_inicio && (
                                <span className="text-cyan-400 animate-pulse">
                                  Iniciado às {(() => {
                                    try {
                                      return new Date(lastApt.hora_inicio).toLocaleTimeString('pt-BR');
                                    } catch {
                                      return '';
                                    }
                                  })()}
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

            {/* Rodapé Fixo do Bottom Sheet com Ações */}
            <div className="p-3.5 border-t border-slate-800 bg-[#0c142b] flex items-center gap-2">
              {(onSelectOpForTotem || onSwitchToTotem) && (
                <button
                  type="button"
                  onClick={() => {
                    playClick();
                    if (onSelectOpForTotem) {
                      onSelectOpForTotem(selectedOp.op_numero || selectedOp.numero || '');
                    } else {
                      onSwitchToTotem();
                    }
                  }}
                  className="flex-1 py-3 px-4 bg-[#1C2F8A] hover:bg-blue-600 active:scale-[0.98] text-white rounded-xl text-xs font-mono font-bold flex items-center justify-center gap-2 border border-blue-400/60 shadow-lg cursor-pointer transition"
                >
                  <Monitor className="w-4 h-4 text-amber-400" />
                  <span>Abrir no Totem para Apontar</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  playClick();
                  setSelectedOp(null);
                }}
                className="py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-mono font-bold cursor-pointer transition active:scale-[0.98] border border-slate-700"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
