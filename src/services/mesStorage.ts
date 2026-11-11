import {
  ProductionOrder,
  Apontamento,
  Operator,
  OPERATORS,
  TerminalConfig,
  TERMINALS,
  CODIGOS_PORTAS_GIRO_PADRAO,
  CODIGOS_PORTAS_CORRER_PADRAO,
  CODIGOS_GIRATORIA_PADRAO,
  CODIGOS_PADRAO_CORRER,
  normalizarCodigo,
  OpOcorrencia,
  isPortaCorrerPadrao
} from '../types/mes';
import { deducePhysicalUnitsFromM2, processarRotaProduto, cleanOpId, cleanOpid, formatOpNumber } from '../utils/nomusParser';
import { getRouteForOp, doesSectorMatchStep, matchStepName, initOrSyncOrderEtapas, obterQuantidadeTotal, obterEtapasDaRota, isEligibleForRouter } from '../utils/routeEngine';
import { calcularDuracaoLiquidaMs, getPausaAtual } from '../utils/workShiftUtils';
import { io, Socket } from 'socket.io-client';

export { cleanOpId, cleanOpid, formatOpNumber };

/**
 * Sanitiza recursivamente qualquer objeto ou payload antes de enviar para o Firebase Realtime Database.
 * Remove quaisquer chaves cujo valor seja `undefined`, prevenindo a exceção fatal:
 * "Error: update failed: values argument contains undefined in property ..."
 */
export function sanitizePayload<T = any>(data: T): T {
  if (data === null || data === undefined) {
    return null as any;
  }
  if (Array.isArray(data)) {
    return data
      .filter((item) => item !== undefined)
      .map((item) => sanitizePayload(item)) as any;
  }
  if (typeof data === 'object') {
    if (data instanceof Date) return data as any;
    const clean: Record<string, any> = {};
    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined) {
        clean[key] = sanitizePayload(val);
      }
    }
    return clean as any;
  }
  return data;
}

export function toFirebaseKey(key: string): string {
  return (key || '').trim().replace(/[.#$\[\]\/]/g, '_');
}

const STORAGE_ORDERS_KEY = 'mes_pcp_orders';
const STORAGE_APONTAMENTOS_KEY = 'mes_apontamentos';
const STORAGE_TERMINAL_KEY = 'mes_selected_terminal';
export const STORAGE_OPERATORS_KEY = 'metalrib_operators';
export const STORAGE_TERMINALS_KEY = 'metalrib_terminals_sectors';

const BROADCAST_CHANNEL_NAME = 'MES_FACTORY_BROADCAST';

// Ordens de Produção Iniciais (vazio por padrão para operar 100% com dados reais do Nomus ERP / Firebase)
export const INITIAL_ORDERS: Record<string, ProductionOrder> = {};
export const INITIAL_ORDERS_MOCK: Record<string, ProductionOrder> = {};

// IDs de ordens de teste fictícias que devem ser expurgadas caso ainda persistam no localStorage ou Firebase
export const TEST_DUMMY_OPS = new Set([
  '023838-01', '023838-02', '023838-03', '023838-04',
  '023838-05', '023838-06', '023838-07', '023838-08',
  '023838-09', '023838-10', '023838-11'
]);

// Flags globais de inicialização no topo do módulo
export let isLocalSocketInitialized = false;
export let isLocalApiActive = false;
export let bgSyncTimer: any = null;
export let localSocket: Socket | null = null;

let broadcastChannel: BroadcastChannel | null = null;
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  try {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
  } catch (e) {
    console.warn('BroadcastChannel not supported', e);
  }
}

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();

function notifySubscribers() {
  subscribers.forEach(cb => {
    try {
      cb();
    } catch (e) {
      console.error('Subscriber error', e);
    }
  });
}

// Escuta mensagens de outros terminais/abas
if (broadcastChannel) {
  broadcastChannel.onmessage = (event) => {
    if (event.data && event.data.type === 'DATA_UPDATED') {
      notifySubscribers();
    }
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (
      event.key === STORAGE_APONTAMENTOS_KEY ||
      event.key === STORAGE_ORDERS_KEY ||
      event.key === STORAGE_OPERATORS_KEY ||
      event.key === STORAGE_TERMINALS_KEY
    ) {
      notifySubscribers();
    }
  });
}

function broadcastUpdate() {
  notifySubscribers();
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('metalrib_data_updated'));
      window.dispatchEvent(new CustomEvent('metalrib_operators_updated'));
    } catch {
      // silent
    }
  }
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage({ type: 'DATA_UPDATED', timestamp: Date.now() });
    } catch {
      // silent
    }
  }
}

const persistQueue = new Set<string>();

function persistirCorrecaoOp(docId: string, dadosParaAtualizar: Record<string, any>) {
  if (persistQueue.has(docId)) return;
  persistQueue.add(docId);

  // Sincroniza em segundo plano com a API local SQLite
  try {
    const cleanId = cleanOpId(docId);
    const localUrl = getLocalServerUrl();
    fetch(`${localUrl}/api/ordens/${cleanId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dadosParaAtualizar)
    }).catch(() => {});
  } catch {}
}

/**
 * AUTO-CORREÇÃO EM TEMPO REAL NO RUNTIME DO FRONTEND
 * Verifica se a OP é Porta Especial (Correr Especial ou Giratória fora da Whitelist)
 * e, caso tenha menos de 4 ou 5 etapas gravadas no banco:
 * 1. Corrigir o estado em memória imediatamente para a rota completa de 5 ou 6 etapas.
 * 2. Disparar persistência assíncrona em segundo plano no Firestore e Realtime Database.
 */
export function verificarECorrigirRotaOp<T extends ProductionOrder>(op: T): T {
  if (!op || typeof op !== 'object') return op;

  const desc = String(op.descricao || (op as any).produto || '').toUpperCase();
  const codRaw = String(op.codigo || (op as any).codigoProduto || (op as any).cod || '').trim();
  let codNormalizado = normalizarCodigo(codRaw);
  if (!codNormalizado && desc) {
    const matchCod = desc.match(/\b(\d{3}[\.-]?\d{4})\b/);
    if (matchCod) {
      codNormalizado = normalizarCodigo(matchCod[1]);
    }
  }

  // Não intercepta subcomponentes (Batentes, Folhas avulsas, Trilhos, Âncoras, etc.)
  const ehSubcomponente =
    codNormalizado.startsWith('020') ||
    codNormalizado.startsWith('021') ||
    codNormalizado.startsWith('028') ||
    codNormalizado.startsWith('011') ||
    codNormalizado.startsWith('009') ||
    codNormalizado.startsWith('010') ||
    desc.startsWith('BAT') ||
    desc.startsWith('BATENTE') ||
    desc.startsWith('FOLHA') ||
    desc.startsWith('TRILHO') ||
    desc.includes('ANCORA') ||
    desc.includes('VAI VEM') ||
    desc.includes('OFFICE DOOR');

  // Portas Duplas (Vai-Vem, Office Door, Giro ou Correr)
  const ehDupla = desc.includes('DUPLA') || desc.includes('DUPLO') || Boolean(op.isDupla);
  if (ehDupla) {
    op.isDupla = true;
    if (op.quantidadeFisica === undefined || op.quantidadeFisica === null) {
      const q = (op.quantidade_total === 1 || op.quantidade === 1) ? 2 : (op.quantidade_total || op.quantidade || 2);
      op.quantidadeFisica = q;
    }
    if (op.quantidadeFolhas === undefined || op.quantidadeFolhas === null) {
      op.quantidadeFolhas = op.quantidadeFisica;
    }
  }

  if (ehSubcomponente) return op;

  const ehGiratoria =
    desc.includes('PT GIR') ||
    desc.includes('PORTA GIR') ||
    desc.includes('GIRATORIA') ||
    desc.includes('GIRATÓRIA') ||
    desc.includes('GIRO') ||
    codNormalizado.startsWith('001') ||
    codNormalizado.startsWith('002') ||
    codNormalizado.startsWith('003') ||
    codNormalizado.startsWith('004');

  const ehCorrer =
    desc.includes('PT COR') ||
    desc.includes('PORTA CORRER') ||
    desc.includes('PORTA DE CORRER') ||
    desc.includes('CORRER') ||
    desc.includes('EMENDAD') ||
    codNormalizado.startsWith('005') ||
    codNormalizado.startsWith('006') ||
    codNormalizado.startsWith('007') ||
    codNormalizado.startsWith('008') ||
    codNormalizado.startsWith('029') ||
    codNormalizado.startsWith('025');

  const docId = (op.op_numero || (op as any).numeroOP || op.numero || (op as any).id || '').trim();

  // 1. Giratória: Padrão vs Especial
  const ehGiroPadrao = Boolean(
    (codRaw && (CODIGOS_PORTAS_GIRO_PADRAO.has(codRaw) || CODIGOS_GIRATORIA_PADRAO.has(codRaw))) ||
    (codNormalizado && (CODIGOS_PORTAS_GIRO_PADRAO.has(codNormalizado) || CODIGOS_GIRATORIA_PADRAO.has(codNormalizado)))
  );
  const ehGiroEspecial = ehGiratoria && (!ehGiroPadrao || desc.includes('ESP') || desc.includes('ESPECIAL') || op.familia?.includes('Especial'));

  if (ehGiratoria && ehGiroPadrao && !ehGiroEspecial) {
    const rotaAtual = Array.isArray(op.rota) && op.rota.length > 0 ? op.rota : (Array.isArray(op.etapas) ? op.etapas : []);
    const semApts = !op.apontamentos || Object.keys(op.apontamentos).length === 0;

    // Se estava indevidamente com rota completa de fabricação (6 etapas / iniciando em Corte) e sem apontamentos
    if (semApts && (rotaAtual.length > 2 || rotaAtual.includes('Corte') || op.familia === 'Porta Giratória Especial')) {
      const novaRota = [
        'Instalação de Gaxeta',
        'Montagem de Portas Giratórias'
      ];

      op.rota = novaRota;
      op.etapas = novaRota;
      op.familia = 'Porta Giratória Padrão';
      op.tipoMontagem = 'Porta Giratória Padrão';
      op.etapaAtual = 'Instalação de Gaxeta';
      op.statusEtapa = 'Aguardando Início em: Instalação de Gaxeta';
      op.status = 'Aguardando Início em: Instalação de Gaxeta';
      op.statusAtual = 'AGUARDANDO INÍCIO EM: Instalação de Gaxeta';

      if (docId) {
        persistirCorrecaoOp(docId, {
          rota: novaRota,
          etapas: novaRota,
          familia: 'Porta Giratória Padrão',
          tipoMontagem: 'Porta Giratória Padrão',
          etapaAtual: op.etapaAtual,
          statusEtapa: op.statusEtapa,
          status: op.status,
          statusAtual: op.statusAtual
        });
      }
    }
  } else if (ehGiroEspecial) {
    const rotaAtual = Array.isArray(op.rota) && op.rota.length > 0 ? op.rota : (Array.isArray(op.etapas) ? op.etapas : []);
    if (!rotaAtual || rotaAtual.length < 5 || !rotaAtual.includes('Corte')) {
      const novaRota = [
        'Corte',
        'Dobra',
        'Preparação de Folha',
        'Injeção',
        'Instalação de Gaxeta',
        'Montagem de Portas Giratória Padrão e Especial'
      ];

      op.rota = novaRota;
      op.etapas = novaRota;
      op.familia = 'Porta Giratória Especial';
      op.tipoMontagem = 'Porta Giratória Especial';

      const semApts = !op.apontamentos || Object.keys(op.apontamentos).length === 0;
      if (semApts) {
        if (!op.etapaAtual || op.etapaAtual.includes('Instalação') || op.etapaAtual.includes('Montagem')) {
          op.etapaAtual = 'Corte';
          op.statusEtapa = 'Aguardando Início em: Corte';
          op.status = 'Aguardando Início em: Corte';
        }
        if (!op.statusAtual || op.statusAtual.includes('Instalação') || op.statusAtual.includes('Montagem')) {
          op.statusAtual = 'AGUARDANDO INÍCIO EM: Corte';
        }
      }

      if (docId) {
        persistirCorrecaoOp(docId, {
          rota: novaRota,
          etapas: novaRota,
          familia: 'Porta Giratória Especial',
          tipoMontagem: 'Porta Giratória Especial',
          etapaAtual: op.etapaAtual,
          statusEtapa: op.statusEtapa,
          status: op.status,
          statusAtual: op.statusAtual
        });
      }
    }
  }

  // 2. Correr: Padrão vs Especial / Sob Medida
  const ehCorrerPadrao =
    (isPortaCorrerPadrao(codRaw || codNormalizado, desc) ||
      Boolean(
        (codRaw && (CODIGOS_PORTAS_CORRER_PADRAO.has(codRaw) || CODIGOS_PADRAO_CORRER.has(codRaw))) ||
        (codNormalizado && (CODIGOS_PORTAS_CORRER_PADRAO.has(codNormalizado) || CODIGOS_PADRAO_CORRER.has(codNormalizado)))
      )) &&
    !desc.includes('EMENDAD') &&
    !desc.includes('EMENDA') &&
    !desc.includes('INOX') &&
    !desc.includes('I304') &&
    !desc.includes('I430') &&
    !desc.includes('ESPECIAL') &&
    !desc.includes('ESP') &&
    !codNormalizado.startsWith('006') &&
    !codNormalizado.startsWith('008') &&
    !codNormalizado.startsWith('029') &&
    !codNormalizado.startsWith('025');

  const ehCorrerEspecial =
    ehCorrer &&
    (!ehCorrerPadrao ||
      op.familia?.includes('Especial') ||
      desc.includes('ESP') ||
      desc.includes('ESPECIAL') ||
      Boolean((op as any).medidaEspecial));

  if (ehCorrer && ehCorrerPadrao && !ehCorrerEspecial) {
    op.tipoOrdem = 'Porta de Correr Padrão (Montagem Final)';
    op.familia = 'Porta de Correr Padrão';
    op.tipoMontagem = 'Porta de Correr Padrão';
    const rotaAtual = Array.isArray(op.rota) && op.rota.length > 0 ? op.rota : (Array.isArray(op.etapas) ? op.etapas : []);
    const semApts = !op.apontamentos || Object.keys(op.apontamentos).length === 0;

    if (semApts && (rotaAtual.length > 1 || rotaAtual.includes('Corte') || op.familia === 'Porta de Correr Especial')) {
      const totalQtd = op.quantidadeFisica || op.quantidade || 1;
      const novaRota = ['Montagem Portas de Correr Padrão e Especial'];
      const novasEtapas = [
        {
          nome: 'Montagem Portas de Correr Padrão e Especial',
          ordem: 1,
          status: 'pendente',
          quantidadeProduzida: 0,
          total: totalQtd
        }
      ];
      op.rota = novaRota;
      op.etapas = novasEtapas;
      op.etapaAtual = 'Montagem Portas de Correr Padrão e Especial';
      op.statusEtapa = 'Aguardando Início em: Montagem Portas de Correr Padrão e Especial';
      op.status = 'Aguardando Início em: Montagem Portas de Correr Padrão e Especial';
      op.statusAtual = 'AGUARDANDO INÍCIO EM: Montagem Portas de Correr Padrão e Especial';

      if (docId) {
        persistirCorrecaoOp(docId, {
          rota: novaRota,
          etapas: novasEtapas,
          tipoOrdem: 'Porta de Correr Padrão (Montagem Final)',
          familia: 'Porta de Correr Padrão',
          tipoMontagem: 'Porta de Correr Padrão',
          etapaAtual: op.etapaAtual,
          statusEtapa: op.statusEtapa,
          status: op.status,
          statusAtual: op.statusAtual
        });
      }
    }
  } else if (ehCorrerEspecial) {
    op.tipoOrdem = 'Especial Sob Medida (Fabricação Completa)';
    op.familia = 'Porta de Correr Especial';
    op.tipoMontagem = 'Porta de Correr Especial';

    const rotaAtual = Array.isArray(op.rota) && op.rota.length > 0 ? op.rota : (Array.isArray(op.etapas) ? op.etapas : []);
    if (!rotaAtual || rotaAtual.length < 4 || !rotaAtual.includes('Corte')) {
      const novaRota = [
        'Corte',
        'Dobra',
        'Preparação de Folha',
        'Injeção',
        'Montagem Portas de Correr Padrão e Especial'
      ];

      op.rota = novaRota;
      op.etapas = novaRota;

      const semApts = !op.apontamentos || Object.keys(op.apontamentos).length === 0;
      if (semApts) {
        if (!op.etapaAtual || op.etapaAtual.includes('Montagem')) {
          op.etapaAtual = 'Corte';
          op.statusEtapa = 'Aguardando Início em: Corte';
          op.status = 'Aguardando Início em: Corte';
        }
        if (!op.statusAtual || op.statusAtual.includes('Montagem')) {
          op.statusAtual = 'AGUARDANDO INÍCIO EM: Corte';
        }
      }

      if (docId) {
        persistirCorrecaoOp(docId, {
          rota: novaRota,
          etapas: novaRota,
          tipoOrdem: 'Especial Sob Medida (Fabricação Completa)',
          familia: 'Porta de Correr Especial',
          tipoMontagem: 'Porta de Correr Especial',
          etapaAtual: op.etapaAtual,
          statusEtapa: op.statusEtapa,
          status: op.status,
          statusAtual: op.statusAtual
        });
      }
    } else {
      // Já possui rota completa de 5/6 etapas (ex: OP 024471-01). Preserva o processo atual onde o lote se encontra!
      if (docId && (op.tipoOrdem !== 'Especial Sob Medida (Fabricação Completa)' || op.familia !== 'Porta de Correr Especial')) {
        persistirCorrecaoOp(docId, {
          tipoOrdem: 'Especial Sob Medida (Fabricação Completa)',
          familia: 'Porta de Correr Especial',
          tipoMontagem: 'Porta de Correr Especial'
        });
      }
    }
  }

  return op;
}

/**
 * Inicializa dados caso o localStorage esteja vazio e purga ordens de teste fictícias
 */
export function ensureInitialData() {
  if (typeof window === 'undefined') return;
  const existingOrdersRaw = localStorage.getItem(STORAGE_ORDERS_KEY);
  if (existingOrdersRaw) {
    // Purga ordens de teste fictícias antigas (023838-01 a 08) que possam ter ficado no storage
    try {
      const parsed = JSON.parse(existingOrdersRaw);
      let modified = false;
      for (const dummyKey of TEST_DUMMY_OPS) {
        if (dummyKey in parsed) {
          delete parsed[dummyKey];
          modified = true;
        }
      }
      if (modified) {
        localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(parsed));
      }
    } catch {
      // ignore
    }
  }
  const existingApt = localStorage.getItem(STORAGE_APONTAMENTOS_KEY);
  if (!existingApt) {
    localStorage.setItem(STORAGE_APONTAMENTOS_KEY, JSON.stringify({}));
  }

  // Inicializa equipe de colaboradores e terminais apenas localmente se ainda não existirem
  const existingOps = localStorage.getItem(STORAGE_OPERATORS_KEY);
  if (!existingOps) {
    localStorage.setItem(STORAGE_OPERATORS_KEY, JSON.stringify(OPERATORS));
  }

  const existingTerms = localStorage.getItem(STORAGE_TERMINALS_KEY);
  if (!existingTerms) {
    const { terminals: sanitized } = sanitizeTerminalSectors(TERMINALS);
    localStorage.setItem(STORAGE_TERMINALS_KEY, JSON.stringify(sanitized));
  } else {
    try {
      const parsed: TerminalConfig[] = JSON.parse(existingTerms);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const { terminals: sanitized, changed } = sanitizeTerminalSectors(parsed);
        if (changed) {
          localStorage.setItem(STORAGE_TERMINALS_KEY, JSON.stringify(sanitized));
          const setoresMap = buildSetoresMap(sanitized);
          localStorage.setItem('metalrib_setores_por_terminal', JSON.stringify(setoresMap));
        }
      }
    } catch {
      // ignore
    }
  }
}

export const getLocalServerUrl = (): string => {
  if (typeof window !== 'undefined' && window.location.hostname) {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://localhost:3001';
    }
    return `http://${host}:3001`;
  }
  return 'http://192.168.0.12:3001';
};

export function getLocalSocket(): Socket {
  if (!localSocket) {
    const localUrl = getLocalServerUrl();
    localSocket = io(localUrl, {
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
      timeout: 3000,
      autoConnect: true
    });
  }
  return localSocket;
}

export function processAndStoreLocalOrdens(ordensList: any[], shouldBroadcast: boolean = true): Record<string, ProductionOrder> {
  try {
    const ordersMap: Record<string, ProductionOrder> = {};
    for (const item of ordensList) {
      const opNum = String(item.numero || item.id || '').trim();
      const clean = cleanOpId(opNum);
      if (!clean || TEST_DUMMY_OPS.has(clean)) continue;
      const opNumero = formatOpNumber(clean);
      const qtd = Number(item.quantidadeFisica || item.quantidade_total || item.quantidade || 1);
      
      const parsedEtapas = typeof item.etapas === 'string'
        ? JSON.parse(item.etapas || '[]')
        : (item.etapas || []);

      const syncedItem = initOrSyncOrderEtapas({
        ...item,
        id: opNumero,
        op_numero: opNumero,
        numero: opNumero,
        descricao: item.descricao || item.produto || '',
        produto: item.descricao || item.produto || '',
        codigo: item.codigo || item.codigoProduto || '',
        codigoProduto: item.codigo || item.codigoProduto || '',
        cliente: item.cliente || 'METALRIB',
        tipoOrdem: item.tipoOrdem || 'Padrão',
        quantidade_total: qtd,
        quantidade: qtd,
        quantidadeFisica: qtd,
        etapas: parsedEtapas
      });

      const corrected = verificarECorrigirRotaOp(syncedItem);
      ordersMap[opNumero] = corrected;
    }

    if (Object.keys(ordersMap).length > 0) {
      const currentRaw = localStorage.getItem(STORAGE_ORDERS_KEY);
      const newRaw = JSON.stringify(ordersMap);
      if (currentRaw !== newRaw) {
        localStorage.setItem(STORAGE_ORDERS_KEY, newRaw);
        if (shouldBroadcast) {
          broadcastUpdate();
        }
      }
    }
    return ordersMap;
  } catch (err) {
    console.warn('[Local API] Erro ao processar ordens locais:', err);
    return {};
  }
}

export async function fetchLocalOrdens(): Promise<boolean> {
  try {
    const localUrl = getLocalServerUrl();
    const res = await fetch(`${localUrl}/api/ordens`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      processAndStoreLocalOrdens(data, false);
      isLocalApiActive = true;
      return true;
    }
  } catch {
    // Servidor local offline
  }
  return false;
}

export function initLocalSocketListeners(): void {
  if (typeof window === 'undefined' || isLocalSocketInitialized) return;
  isLocalSocketInitialized = true;

  try {
    const localUrl = getLocalServerUrl();
    const socket = getLocalSocket();

    socket.on('connect', () => {
      console.log('[Socket.io] Conectado ao servidor local MES:', localUrl);
      isLocalApiActive = true;
      fetchLocalOrdens();
    });

    socket.on('terminais_atualizados', (terms: any[]) => {
      if (Array.isArray(terms) && terms.length > 0) {
        const { terminals: sanitized } = sanitizeTerminalSectors(terms);
        localStorage.setItem(STORAGE_TERMINALS_KEY, JSON.stringify(sanitized));
        const setoresMap = buildSetoresMap(sanitized);
        localStorage.setItem('metalrib_setores_por_terminal', JSON.stringify(setoresMap));
        window.dispatchEvent(new CustomEvent('metalrib_sectors_updated'));
      }
    });

    socket.on('ordem_resetada', (data: any) => {
      console.log('[Socket.io] Evento ordem_resetada recebido:', data);
      window.dispatchEvent(new CustomEvent('metalrib_ordem_resetada', { detail: data }));
      window.dispatchEvent(new CustomEvent('metalrib_orders_updated'));
      window.dispatchEvent(new CustomEvent('metalrib_apontamentos_updated'));
      fetchLocalOrdens();
    });

    socket.on('op_resetada', (data: any) => {
      console.log('[Socket.io] Evento op_resetada recebido:', data);
      window.dispatchEvent(new CustomEvent('metalrib_op_resetada', { detail: data }));
      window.dispatchEvent(new CustomEvent('metalrib_orders_updated'));
      window.dispatchEvent(new CustomEvent('metalrib_apontamentos_updated'));
      fetchLocalOrdens();
    });

    socket.on('setores_atualizados', (terms: any[]) => {
      if (Array.isArray(terms) && terms.length > 0) {
        const { terminals: sanitized } = sanitizeTerminalSectors(terms);
        localStorage.setItem(STORAGE_TERMINALS_KEY, JSON.stringify(sanitized));
        const setoresMap = buildSetoresMap(sanitized);
        localStorage.setItem('metalrib_setores_por_terminal', JSON.stringify(setoresMap));
        window.dispatchEvent(new CustomEvent('metalrib_sectors_updated'));
      }
    });

    socket.on('ordens_atualizadas', (ordens: any[]) => {
      console.log('[Socket.io] Evento ordens_atualizadas recebido do servidor local:', ordens?.length);
      if (Array.isArray(ordens)) {
        processAndStoreLocalOrdens(ordens, true);
      }
    });

    socket.on('connect_error', () => {
      isLocalApiActive = false;
    });

    socket.on('disconnect', () => {
      isLocalApiActive = false;
    });
  } catch (err) {
    console.warn('[Socket.io] Erro ao conectar ao servidor local:', err);
  }
}

// Inicializa no carregamento com tratamento de exceções para proteger a UI contra tela branca
try {
  ensureInitialData();
  initLocalSocketListeners();
} catch (err) {
  console.warn('[MES Storage] Erro na inicialização dos listeners:', err);
}

/**
 * Funções de Gestão de Operadores / Colaboradores (Chave: metalrib_operators)
 */
export function fetchOperators(): Operator[] {
  if (typeof window === 'undefined') return [...OPERATORS];
  ensureInitialData();
  const raw = localStorage.getItem(STORAGE_OPERATORS_KEY);
  if (!raw) return [...OPERATORS];
  try {
    const list: Operator[] = JSON.parse(raw);
    if (Array.isArray(list) && list.length > 0) {
      return list.map((op) => {
        const rawSectors = Array.isArray(op.sectors)
          ? op.sectors
          : Array.isArray(op.setores)
          ? op.setores
          : op.setor ? [op.setor] : [];

        const uniqueSectors = Array.from(new Set(rawSectors.map((s) => s.trim()).filter(Boolean)));
        const badge = (op.badge || op.codigo || '').trim().toUpperCase();
        const primarySetor = (op.setor && uniqueSectors.includes(op.setor)) ? op.setor : (uniqueSectors[0] || '');
        const nome = op.nome || op.name || '';
        const especialista = Boolean(op.especialista ?? op.especialistaVolante ?? op.isRoaming);
        const terminais = Array.isArray(op.terminais) ? [...op.terminais] : [];

        // Garante permissão oficial de Montagem Estante no T5 para a colaboradora Gabriele
        const isGabriele = op.id === 'gabriele' || nome.toLowerCase().includes('gabriele');
        if (isGabriele) {
          if (!uniqueSectors.includes('Montagem Estante')) {
            uniqueSectors.push('Montagem Estante');
          }
          if (!terminais.includes('T5')) {
            terminais.push('T5');
          }
        }

        // Padronização compulsória: qualquer "Preparação de Folha" (com 's') é migrada para "Preparação de Folha" (no singular)
        for (let i = 0; i < uniqueSectors.length; i++) {
          if (uniqueSectors[i].trim().toLowerCase() === 'preparação de folhas' || uniqueSectors[i].trim().toLowerCase() === 'preparacao de folhas') {
            uniqueSectors[i] = 'Preparação de Folha';
          }
        }

        // Garante que Danielson (DOB-02) e Leonardo Constancio (DOB-01) estejam em Dobra e Preparação de Folha (e nunca Corte)
        const isDanielson = op.id === 'danielson' || nome.toLowerCase().includes('danielson') || badge === 'DOB-02';
        if (isDanielson) {
          const idxCorte = uniqueSectors.findIndex((s) => s.toLowerCase() === 'corte');
          if (idxCorte >= 0) uniqueSectors.splice(idxCorte, 1);
          if (!uniqueSectors.includes('Dobra')) uniqueSectors.push('Dobra');
          if (!uniqueSectors.includes('Preparação de Folha')) uniqueSectors.push('Preparação de Folha');
        }

        const isLeonardoC = op.id === 'leonardo_c' || nome.toLowerCase().includes('leonardo constancio') || badge === 'DOB-01';
        if (isLeonardoC) {
          const idxCorte = uniqueSectors.findIndex((s) => s.toLowerCase() === 'corte');
          if (idxCorte >= 0) uniqueSectors.splice(idxCorte, 1);
          if (!uniqueSectors.includes('Dobra')) uniqueSectors.push('Dobra');
          if (!uniqueSectors.includes('Preparação de Folha')) uniqueSectors.push('Preparação de Folha');
        }

        // Garante terminais e badges corretos dos especialistas para que não vazem entre terminais
        const isSergio = op.id === 'sergio' || nome.toLowerCase().includes('sergio') || badge === 'ESP-T3';
        if (isSergio) {
          const idxT1 = terminais.indexOf('T1');
          if (idxT1 >= 0) terminais.splice(idxT1, 1);
          if (!terminais.includes('T3')) terminais.push('T3');
        }

        const isFabio = op.id === 'fabio' || nome.toLowerCase().includes('fabio') || badge === 'ESP-T5';
        if (isFabio) {
          const idxT1 = terminais.indexOf('T1');
          if (idxT1 >= 0) terminais.splice(idxT1, 1);
          if (!terminais.includes('T5')) terminais.push('T5');
        }

        const isBrunoC = op.id === 'bruno_c' || nome.toLowerCase().includes('bruno constancio') || badge === 'ESP-T1';
        if (isBrunoC) {
          if (!terminais.includes('T1')) terminais.push('T1');
        }

        const setoresPorTerm = op.setoresPorTerminal ? { ...op.setoresPorTerminal } : undefined;
        if (isGabriele && setoresPorTerm) {
          if (!setoresPorTerm.T5) {
            setoresPorTerm.T5 = [];
          }
          if (!setoresPorTerm.T5.includes('Montagem Estante')) {
            setoresPorTerm.T5.push('Montagem Estante');
          }
        }

        return {
          ...op,
          nome,
          name: nome,
          badge,
          codigo: badge,
          setor: primarySetor,
          setores: uniqueSectors,
          sectors: uniqueSectors,
          setoresPorTerminal: setoresPorTerm || op.setoresPorTerminal || undefined,
          terminais,
          especialista,
          ativo: op.ativo !== false,
          especialistaVolante: especialista,
          isRoaming: especialista && (terminais.length > 2 || terminais.length === 0)
        };
      });
    }
    return [...OPERATORS];
  } catch {
    return [...OPERATORS];
  }
}

export function saveOperators(operators: Operator[]): void {
  if (typeof window === 'undefined') return;
  const cleaned: Operator[] = operators.map((op) => {
    const rawSectors = Array.isArray(op.sectors)
      ? op.sectors
      : Array.isArray(op.setores)
      ? op.setores
      : op.setor ? [op.setor] : [];

    const uniqueSectors = Array.from(new Set(rawSectors.map((s) => s.trim()).filter(Boolean)));
    const badge = (op.badge || op.codigo || '').trim().toUpperCase();
    const primarySetor = (op.setor && uniqueSectors.includes(op.setor)) ? op.setor : (uniqueSectors[0] || '');
    const nome = op.nome || op.name || '';
    const especialista = Boolean(op.especialista ?? op.especialistaVolante ?? op.isRoaming);
    const terminais = Array.isArray(op.terminais) ? op.terminais : [];
    const postos = Array.isArray(op.postos) ? op.postos : [];
    const familias = Array.isArray(op.familias) ? op.familias : ['TODAS'];

    return {
      ...op,
      nome,
      name: nome,
      badge,
      codigo: badge,
      setor: primarySetor,
      setores: uniqueSectors,
      sectors: uniqueSectors,
      setoresPorTerminal: op.setoresPorTerminal || undefined,
      terminais,
      postos,
      familias,
      especialista,
      ativo: op.ativo !== false,
      especialistaVolante: especialista,
      isRoaming: especialista && (terminais.length > 2 || terminais.length === 0)
    };
  });
  localStorage.setItem(STORAGE_OPERATORS_KEY, JSON.stringify(cleaned));
  broadcastUpdate();
  window.dispatchEvent(new CustomEvent('metalrib_operators_updated'));
}

export async function updateColaboradorFirebase(id: string, dados: Partial<Operator>): Promise<void> {
  const current = fetchOperators();
  const index = current.findIndex(o => o.id === id);
  const existing = index >= 0 ? current[index] : null;

  const nome = (dados.nome || dados.name || existing?.nome || existing?.name || id).trim();
  const terminais = Array.isArray(dados.terminais) ? dados.terminais : (existing?.terminais || []);
  const setores = Array.isArray(dados.setores)
    ? dados.setores
    : Array.isArray(dados.sectors)
    ? dados.sectors
    : (existing?.setores || existing?.sectors || []);
  const especialista = Boolean(dados.especialista ?? existing?.especialista);
  const badge = (dados.badge || dados.codigo || existing?.badge || id.toUpperCase()).trim();

  const role = especialista
    ? `Especialista (${terminais.join('/') || 'Geral'})`
    : terminais.length > 1
    ? `Operador Volante (${terminais.join('/')})`
    : terminais.length === 1
    ? `Operador ${terminais[0]}`
    : 'Operador';

  const initials = existing?.initials || dados.initials || nome.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'OP';

  const payload: Operator = {
    ...(existing || {}),
    ...dados,
    id,
    name: nome,
    nome,
    initials,
    badge,
    codigo: badge,
    role,
    setor: setores[0] || '',
    setores: [...setores],
    sectors: [...setores],
    setoresPorTerminal: dados.setoresPorTerminal || existing?.setoresPorTerminal || undefined,
    terminais: [...terminais],
    especialista,
    ativo: dados.ativo !== undefined ? dados.ativo : (existing?.ativo !== false)
  };

  if (index >= 0) {
    current[index] = payload;
  } else {
    current.push(payload);
  }

  localStorage.setItem(STORAGE_OPERATORS_KEY, JSON.stringify(current));
  broadcastUpdate();
  window.dispatchEvent(new CustomEvent('metalrib_operators_updated'));
}

export function addOperator(newOp: Omit<Operator, 'id'> & { id?: string }): Operator {
  const current = fetchOperators();
  const id = newOp.id || `op_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const nome = (newOp.nome || newOp.name || '').trim();
  const initials = newOp.initials || nome.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'OP';
  const rawSectors = Array.isArray(newOp.sectors) ? newOp.sectors : (newOp.setores || []);
  const uniqueSectors = Array.from(new Set(rawSectors.map(s => s.trim()).filter(Boolean)));
  const badge = (newOp.badge || newOp.codigo || '').trim().toUpperCase();
  const especialista = Boolean(newOp.especialista ?? newOp.especialistaVolante ?? newOp.isRoaming);
  const terminais = Array.isArray(newOp.terminais) ? newOp.terminais : [];

  const operator: Operator = {
    ...newOp,
    id,
    name: nome,
    nome,
    badge,
    codigo: badge,
    initials,
    setor: uniqueSectors[0] || '',
    setores: uniqueSectors,
    sectors: uniqueSectors,
    setoresPorTerminal: newOp.setoresPorTerminal || undefined,
    terminais,
    postos: Array.isArray(newOp.postos) ? newOp.postos : [],
    familias: Array.isArray(newOp.familias) ? newOp.familias : ['TODAS'],
    especialista,
    isRoaming: especialista && (terminais.length > 2 || terminais.length === 0),
    especialistaVolante: especialista,
    ativo: newOp.ativo !== false
  };
  const updated = [operator, ...current];
  saveOperators(updated);
  return operator;
}

export function updateOperator(updatedOp: Operator): void {
  const current = fetchOperators();
  let index = current.findIndex((o) => o.id === updatedOp.id);
  if (index === -1 && updatedOp.badge) {
    index = current.findIndex((o) => o.badge && o.badge.trim().toUpperCase() === updatedOp.badge.trim().toUpperCase());
  }
  if (index === -1) {
    index = current.findIndex((o) => o.name.trim().toLowerCase() === updatedOp.name.trim().toLowerCase());
  }

  const rawSectors = Array.isArray(updatedOp.sectors) && updatedOp.sectors.length > 0
    ? updatedOp.sectors
    : Array.isArray(updatedOp.setores) && updatedOp.setores.length > 0
    ? updatedOp.setores
    : updatedOp.setor ? [updatedOp.setor] : [];
  const uniqueSectors = Array.from(new Set(rawSectors.map((s) => s.trim()).filter(Boolean)));
  const badge = (updatedOp.badge || updatedOp.codigo || '').trim().toUpperCase();
  const nome = (updatedOp.nome || updatedOp.name || '').trim();
  const especialista = Boolean(updatedOp.especialista ?? updatedOp.isRoaming ?? updatedOp.especialistaVolante);
  const terminais = Array.isArray(updatedOp.terminais)
    ? updatedOp.terminais
    : index >= 0 && Array.isArray(current[index].terminais)
    ? current[index].terminais!
    : [];
  const postos = Array.isArray(updatedOp.postos)
    ? updatedOp.postos
    : index >= 0 && Array.isArray(current[index].postos)
    ? current[index].postos!
    : [];
  const familias = Array.isArray(updatedOp.familias)
    ? updatedOp.familias
    : index >= 0 && Array.isArray(current[index].familias)
    ? current[index].familias!
    : ['TODAS'];

  const normalized: Operator = {
    ...(index >= 0 ? current[index] : {}),
    ...updatedOp,
    id: updatedOp.id || (index >= 0 ? current[index].id : `op_${Date.now()}`),
    name: nome,
    nome,
    badge,
    codigo: badge,
    role: updatedOp.role || 'Operador',
    setor: uniqueSectors[0] || '',
    setores: [...uniqueSectors],
    sectors: [...uniqueSectors],
    setoresPorTerminal: updatedOp.setoresPorTerminal || (index >= 0 ? current[index].setoresPorTerminal : undefined),
    terminais,
    postos,
    familias,
    especialista,
    isRoaming: especialista && (terminais.length > 2 || terminais.length === 0),
    especialistaVolante: especialista,
    ativo: updatedOp.ativo !== false
  };

  if (index >= 0) {
    current[index] = normalized;
  } else {
    current.unshift(normalized);
  }
  saveOperators([...current]);
}

export function deleteOperator(id: string): void {
  const current = fetchOperators();
  const filtered = current.filter(o => o.id !== id);
  saveOperators(filtered);
}

export function resetOperatorsToDefault(): Operator[] {
  saveOperators([...OPERATORS]);
  return [...OPERATORS];
}

/**
 * Funções de Gestão Dinâmica de Terminais e Setores (Chave: metalrib_terminals_sectors)
 */
export function sanitizeTerminalSectors(terminals: TerminalConfig[]): { terminals: TerminalConfig[]; changed: boolean } {
  let changed = false;

  const updated = terminals.map((t) => {
    let sectors = Array.from(new Set(t.sectors ? t.sectors.map((s) => s.trim()).filter(Boolean) : []));

    // Remove qualquer versão da nomenclatura legada solta "Trilhos p/ Portas Correr"
    const hasLegacy = sectors.some((s) => s === 'Trilhos p/ Portas Correr' || s.trim().toUpperCase() === 'TRILHOS P/ PORTAS CORRER');
    if (hasLegacy) {
      sectors = sectors.filter((s) => s !== 'Trilhos p/ Portas Correr' && s.trim().toUpperCase() !== 'TRILHOS P/ PORTAS CORRER');
      changed = true;
    }

    // Padronização compulsória de "Preparação de Folha" para "Preparação de Folha" (no singular)
    const hasPluralFolhas = sectors.some((s) => s.trim().toLowerCase() === 'preparação de folhas' || s.trim().toLowerCase() === 'preparacao de folhas');
    if (hasPluralFolhas) {
      sectors = sectors.map((s) => (s.trim().toLowerCase() === 'preparação de folhas' || s.trim().toLowerCase() === 'preparacao de folhas') ? 'Preparação de Folha' : s);
      sectors = Array.from(new Set(sectors));
      changed = true;
    }

    // Migração e padronização da etapa de Montagem Porta Vai-Vem
    const hasLegacyVaiVem = sectors.some((s) => s === 'Montagem Vai Vem' || s.trim().toUpperCase() === 'MONTAGEM VAI VEM');
    if (hasLegacyVaiVem) {
      sectors = sectors.map((s) => (s === 'Montagem Vai Vem' || s.trim().toUpperCase() === 'MONTAGEM VAI VEM') ? 'Montagem Porta Vai-Vem' : s);
      changed = true;
    }

    return { ...t, sectors, setores: [...sectors] };
  });

  return { terminals: updated, changed };
}

export function buildSetoresMap(terminals: TerminalConfig[]): Record<string, string[]> {
  const map: Record<string, string[]> = { T1: [], T2: [], T3: [], T4: [], T5: [] };
  terminals.forEach((t) => {
    const key = `T${t.id}`;
    map[key] = Array.from(new Set((t.sectors || []).map((s) => s.trim()).filter(Boolean)));
  });
  return map;
}

export function fetchTerminalsConfig(): TerminalConfig[] {
  if (typeof window === 'undefined') {
    const { terminals } = sanitizeTerminalSectors(TERMINALS);
    return terminals;
  }
  ensureInitialData();
  const raw = localStorage.getItem(STORAGE_TERMINALS_KEY);
  if (!raw) {
    const { terminals } = sanitizeTerminalSectors(TERMINALS);
    return terminals;
  }
  try {
    const list: TerminalConfig[] = JSON.parse(raw);
    if (Array.isArray(list) && list.length > 0) {
      const { terminals: sanitized, changed } = sanitizeTerminalSectors(list);
      if (changed) {
        saveTerminalsConfig(sanitized);
      }
      return sanitized;
    }
    const { terminals } = sanitizeTerminalSectors(TERMINALS);
    return terminals;
  } catch {
    const { terminals } = sanitizeTerminalSectors(TERMINALS);
    return terminals;
  }
}

export function saveTerminalsConfig(terminals: TerminalConfig[]): void {
  if (typeof window === 'undefined') return;
  const { terminals: sanitized } = sanitizeTerminalSectors(terminals);
  const cleaned = sanitized.map((t) => {
    const secs = Array.from(new Set(t.sectors ? t.sectors.map((s) => s.trim()).filter(Boolean) : []));
    return {
      ...t,
      sectors: secs,
      setores: secs
    };
  });
  localStorage.setItem(STORAGE_TERMINALS_KEY, JSON.stringify(cleaned));
  const setoresMap = buildSetoresMap(cleaned);
  localStorage.setItem('metalrib_setores_por_terminal', JSON.stringify(setoresMap));
  broadcastUpdate();
  window.dispatchEvent(new CustomEvent('metalrib_sectors_updated'));

  // Sincronização em tempo real via API SQLite e WebSocket
  try {
    const socket = getLocalSocket();
    if (socket && socket.connected) {
      socket.emit('atualizar_terminais', cleaned);
    }
    const localUrl = getLocalServerUrl();
    fetch(`${localUrl}/api/terminais`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terminals: cleaned })
    }).catch(() => {});
  } catch {}
}

export function fetchAllSectors(): string[] {
  const terminals = fetchTerminalsConfig();
  const set = new Set<string>();
  terminals.forEach((t) => {
    if (Array.isArray(t.sectors)) {
      t.sectors.forEach((s) => {
        if (s && s.trim()) set.add(s.trim());
      });
    }
  });
  return Array.from(set);
}

export async function addSectorToTerminalAndSync(terminalId: number | string, sectorName: string): Promise<boolean> {
  const clean = sectorName.trim();
  if (!clean) return false;
  const termIdNum = typeof terminalId === 'string' ? parseInt(terminalId.replace(/\D/g, ''), 10) : terminalId;
  const termIdStr = String(termIdNum || terminalId);
  const terminals = fetchTerminalsConfig();
  const term = terminals.find((t) => t.id === termIdNum || String(t.id) === termIdStr);
  if (!term) return false;
  if (!term.sectors) term.sectors = [];
  if (term.sectors.some((s) => s.toLowerCase() === clean.toLowerCase())) {
    return false;
  }
  term.sectors.push(clean);
  (term as any).setores = [...term.sectors];
  saveTerminalsConfig(terminals);

  // Dispara sincronização remota com SQLite e WebSocket
  try {
    const localUrl = getLocalServerUrl();
    const socket = getLocalSocket();
    if (socket && socket.connected) {
      socket.emit('criar_setor', { terminalId: termIdNum, sectorName: clean });
    }
    fetch(`${localUrl}/api/terminais/${termIdNum}/setores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectorName: clean })
    }).catch(() => {});
  } catch {}

  return true;
}

export function addSectorToTerminal(terminalId: number | string, sectorName: string): boolean {
  const clean = sectorName.trim();
  if (!clean) return false;
  const termIdNum = typeof terminalId === 'string' ? parseInt(terminalId.replace(/\D/g, ''), 10) : terminalId;
  const termIdStr = String(termIdNum || terminalId);
  const terminals = fetchTerminalsConfig();
  const term = terminals.find((t) => t.id === termIdNum || String(t.id) === termIdStr);
  if (!term) return false;
  if (!term.sectors) term.sectors = [];
  if (!term.sectors.some((s) => s.toLowerCase() === clean.toLowerCase())) {
    term.sectors.push(clean);
    (term as any).setores = [...term.sectors];
    saveTerminalsConfig(terminals);
    return true;
  }
  return false;
}

export async function removeSectorFromTerminal(terminalId: number | string, sectorName: string): Promise<boolean> {
  const clean = sectorName.trim();
  if (!clean) return false;
  const termIdNum = typeof terminalId === 'string' ? parseInt(terminalId.replace(/\D/g, ''), 10) : terminalId;
  const termIdStr = String(termIdNum || terminalId);

  const terminals = fetchTerminalsConfig();
  const term = terminals.find((t) => t.id === termIdNum || String(t.id) === termIdStr);
  if (!term) return false;

  term.sectors = (term.sectors || []).filter((s) => s.trim().toLowerCase() !== clean.toLowerCase());
  (term as any).setores = [...term.sectors];

  // Salva nos armazenamentos locais
  saveTerminalsConfig(terminals);

  // 4. Percorre a lista de colaboradores salvos e remove o setor dos colaboradores vinculados
  const termKey = `T${termIdStr}`.replace('TT', 'T');
  const operators = fetchOperators();
  let opModified = false;
  const isSectorStillInOtherTerminals = terminals.some((t) =>
    (t.sectors || []).some((s) => s.trim().toLowerCase() === clean.toLowerCase())
  );

  operators.forEach((op) => {
    // Remove do mapa de setores deste terminal no colaborador
    if (op.setoresPorTerminal && Array.isArray(op.setoresPorTerminal[termKey])) {
      const b4 = op.setoresPorTerminal[termKey].length;
      op.setoresPorTerminal[termKey] = op.setoresPorTerminal[termKey].filter(
        (s) => s.trim().toLowerCase() !== clean.toLowerCase()
      );
      if (op.setoresPorTerminal[termKey].length !== b4) opModified = true;
    }

    // Se o setor não existe mais em nenhum terminal da fábrica, remove também de op.sectors e op.setores
    if (!isSectorStillInOtherTerminals) {
      if (op.sectors) {
        const b4 = op.sectors.length;
        op.sectors = op.sectors.filter((s) => s.trim().toLowerCase() !== clean.toLowerCase());
        if (op.sectors.length !== b4) opModified = true;
      }
      if (op.setores) {
        const b4 = op.setores.length;
        op.setores = op.setores.filter((s) => s.trim().toLowerCase() !== clean.toLowerCase());
        if (op.setores.length !== b4) opModified = true;
      }
    }
  });

  if (opModified) {
    saveOperators(operators);
  }

  return true;
}

export function renameSectorGlobally(oldName: string, newName: string): void {
  const oldClean = oldName.trim();
  const newClean = newName.trim();
  if (!oldClean || !newClean || oldClean.toLowerCase() === newClean.toLowerCase()) return;

  // 1. Atualiza nos terminais
  const terminals = fetchTerminalsConfig();
  let termModified = false;
  terminals.forEach((term) => {
    if (term.sectors) {
      const idx = term.sectors.findIndex((s) => s.trim().toLowerCase() === oldClean.toLowerCase());
      if (idx >= 0) {
        term.sectors[idx] = newClean;
        termModified = true;
      }
    }
  });
  if (termModified) {
    saveTerminalsConfig(terminals);
  }

  // 2. Atualiza nos operadores vinculados
  const operators = fetchOperators();
  let opModified = false;
  operators.forEach((op) => {
    if (op.sectors && op.sectors.length > 0) {
      const idx = op.sectors.findIndex((s) => s.trim().toLowerCase() === oldClean.toLowerCase());
      if (idx >= 0) {
        op.sectors[idx] = newClean;
        opModified = true;
      }
    }
    if (op.setores && op.setores.length > 0) {
      const idx = op.setores.findIndex((s) => s.trim().toLowerCase() === oldClean.toLowerCase());
      if (idx >= 0) {
        op.setores[idx] = newClean;
        opModified = true;
      }
    }
    if (op.setoresPorTerminal) {
      Object.keys(op.setoresPorTerminal).forEach((tKey) => {
        const arr = op.setoresPorTerminal![tKey];
        if (Array.isArray(arr)) {
          const idx = arr.findIndex((s) => s.trim().toLowerCase() === oldClean.toLowerCase());
          if (idx >= 0) {
            arr[idx] = newClean;
            opModified = true;
          }
        }
      });
    }
  });
  if (opModified) {
    saveOperators(operators);
  }
}

export function deleteSectorGlobally(sectorName: string): void {
  const clean = sectorName.trim().toLowerCase();
  if (!clean) return;

  // 1. Remove dos terminais
  const terminals = fetchTerminalsConfig();
  terminals.forEach((term) => {
    if (term.sectors) {
      term.sectors = term.sectors.filter((s) => s.trim().toLowerCase() !== clean);
    }
  });
  saveTerminalsConfig(terminals);

  // 2. Remove dos operadores vinculados
  const operators = fetchOperators();
  operators.forEach((op) => {
    if (op.sectors) {
      op.sectors = op.sectors.filter((s) => s.trim().toLowerCase() !== clean);
    }
    if (op.setores) {
      op.setores = op.setores.filter((s) => s.trim().toLowerCase() !== clean);
    }
    if (op.setoresPorTerminal) {
      Object.keys(op.setoresPorTerminal).forEach((tKey) => {
        const arr = op.setoresPorTerminal![tKey];
        if (Array.isArray(arr)) {
          op.setoresPorTerminal![tKey] = arr.filter((s) => s.trim().toLowerCase() !== clean);
        }
      });
    }
  });
  saveOperators(operators);
}

export function resetTerminalsConfigToDefault(): TerminalConfig[] {
  if (typeof window === 'undefined') return [...TERMINALS];
  saveTerminalsConfig([...TERMINALS]);
  return [...TERMINALS];
}

export interface FactorySystemBackup {
  version: number;
  exportedAt: string;
  operators: Operator[];
  terminals: TerminalConfig[];
}

export function exportFactoryConfiguration(): FactorySystemBackup {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    operators: fetchOperators(),
    terminals: fetchTerminalsConfig()
  };
}

export function importFactoryConfiguration(data: any): { success: boolean; message: string } {
  try {
    if (!data) return { success: false, message: 'Dados de backup vazios ou inválidos.' };
    
    let termsImported = false;
    let opsImported = false;

    if (Array.isArray(data.terminals) && data.terminals.length > 0) {
      saveTerminalsConfig(data.terminals);
      termsImported = true;
    }

    if (Array.isArray(data.operators) && data.operators.length > 0) {
      saveOperators(data.operators);
      opsImported = true;
    }

    if (!termsImported && !opsImported) {
      return { success: false, message: 'Nenhum dado válido de operadores ou terminais encontrado no arquivo.' };
    }

    broadcastUpdate();
    return { success: true, message: 'Equipe e setores importados e sincronizados com sucesso!' };
  } catch (err: any) {
    return { success: false, message: `Erro ao importar: ${err?.message || 'Arquivo corrompido'}` };
  }
}

export function getSavedTerminalId(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_TERMINAL_KEY);
  return raw ? parseInt(raw, 10) : null;
}

export function saveTerminalId(terminalId: number) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_TERMINAL_KEY, terminalId.toString());
  broadcastUpdate();
}

export function clearTerminalSelection() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_TERMINAL_KEY);
  broadcastUpdate();
}

/**
 * Lê todas as Ordens de Produção (com suporte a sincronização direta com Firebase Realtime Database)
 */
export async function fetchProductionOrders(): Promise<Record<string, ProductionOrder>> {
  ensureInitialData();

  try {
    const hasLocal = await fetchLocalOrdens();
    if (hasLocal) {
      const rawLocal = localStorage.getItem(STORAGE_ORDERS_KEY);
      if (rawLocal && rawLocal !== '{}') {
        const parsed: Record<string, ProductionOrder> = JSON.parse(rawLocal);
        if (Object.keys(parsed).length > 0) {
          return parsed;
        }
      }
    }
  } catch {}

  const rawCache = localStorage.getItem(STORAGE_ORDERS_KEY);
  return rawCache ? JSON.parse(rawCache) : {};
}

/**
 * Busca uma OP por número (ex: 023838-01)
 */
export async function findOrder(opNumber: string): Promise<ProductionOrder | null> {
  const clean = opNumber.trim().toUpperCase();
  const orders = await fetchProductionOrders();
  if (orders[clean]) return orders[clean];

  // Busca flexível sem traço ou com espaços
  const keys = Object.keys(orders);
  for (const k of keys) {
    if (k.replace(/[-_\s]/g, '') === clean.replace(/[-_\s]/g, '')) {
      return orders[k];
    }
  }
  return null;
}

/**
 * Retorna todos os apontamentos salvos no sistema
 * Sincronizado automaticamente com Firebase historico_apontamentos
 */
export async function fetchApontamentos(opNumero?: string): Promise<Apontamento[]> {
  ensureInitialData();

  try {
    const localUrl = getLocalServerUrl();
    const res = await fetch(`${localUrl}/api/apontamentos`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const dbApts = await res.json();
      if (Array.isArray(dbApts) && dbApts.length > 0) {
        const rawStorage = localStorage.getItem(STORAGE_APONTAMENTOS_KEY);
        let treeStorage = {};
        if (rawStorage) {
          try { treeStorage = JSON.parse(rawStorage); } catch { treeStorage = {}; }
        }
        dbApts.forEach((apt) => {
          const clean = (apt.op_numero || apt.op || "").trim().toUpperCase();
          if (!treeStorage[clean]) treeStorage[clean] = {};
          treeStorage[clean][apt.id] = apt;
        });
        localStorage.setItem(STORAGE_APONTAMENTOS_KEY, JSON.stringify(treeStorage));
      }
    }
  } catch {}

  const raw = localStorage.getItem(STORAGE_APONTAMENTOS_KEY);
  let tree: Record<string, Record<string, Apontamento>> = {};
  if (raw) {
    try {
      tree = JSON.parse(raw);
    } catch {
      tree = {};
    }
  }

  const list: Apontamento[] = [];
  if (opNumero) {
    const clean = opNumero.trim().toUpperCase();
    if (tree[clean]) {
      Object.values(tree[clean]).forEach(a => list.push(a));
    }
  } else {
    Object.values(tree).forEach(opMap => {
      Object.values(opMap).forEach(a => list.push(a));
    });
  }

  list.sort((a, b) => new Date(b.hora_inicio || b.horaInicio || 0).getTime() - new Date(a.hora_inicio || a.horaInicio || 0).getTime());
  return list;
}

/**
 * Inicia uma nova unidade
 */
export async function startUnit(params: {
  op_numero: string;
  unidade_numero: number;
  setor: string;
  etapa_rota: string;
  terminal_id: number;
  operador: string;
}): Promise<Apontamento> {
  ensureInitialData();
  const cleanOp = params.op_numero.trim().toUpperCase();
  const raw = localStorage.getItem(STORAGE_APONTAMENTOS_KEY);
  let tree: Record<string, Record<string, Apontamento>> = {};
  if (raw) {
    try {
      tree = JSON.parse(raw);
    } catch {
      tree = {};
    }
  }

  if (!tree[cleanOp]) {
    tree[cleanOp] = {};
  }

  const uniqueId = `apt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const nowIso = new Date().toISOString();
  const novoApontamento: Apontamento = {
    id: uniqueId,
    op_numero: cleanOp,
    op: cleanOp,
    unidade_numero: params.unidade_numero,
    unidade: `Un #${params.unidade_numero}`,
    modo: 'UNITARIO',
    setor: params.setor,
    setorFisico: params.setor,
    etapa_rota: params.etapa_rota,
    etapaRota: params.etapa_rota,
    terminal_id: params.terminal_id,
    terminal: `T${params.terminal_id}`,
    operador: params.operador,
    colaborador: params.operador,
    hora_inicio: nowIso,
    horaInicio: nowIso,
    status: 'EM_ANDAMENTO'
  };

  tree[cleanOp][uniqueId] = novoApontamento;
  localStorage.setItem(STORAGE_APONTAMENTOS_KEY, JSON.stringify(tree));

  try {
    const rawOrders = localStorage.getItem(STORAGE_ORDERS_KEY);
    let ordersMap: Record<string, ProductionOrder> = {};
    if (rawOrders) {
      try {
        ordersMap = JSON.parse(rawOrders);
      } catch {
        ordersMap = {};
      }
    }

    let matchedOpKey = cleanOp;
    let targetOrder = ordersMap[cleanOp];
    if (!targetOrder) {
      const cleanNoPrefix = cleanOp.replace(/^OP\s*/i, '').replace(/[-_\s]/g, '');
      const foundKey = Object.keys(ordersMap).find((k) => {
        const kClean = k.replace(/^OP\s*/i, '').replace(/[-_\s]/g, '');
        return kClean === cleanNoPrefix || k.trim().toUpperCase() === cleanOp;
      });
      if (foundKey) {
        matchedOpKey = foundKey;
        targetOrder = ordersMap[foundKey];
      }
    }

    

    const opKey = toFirebaseKey(targetOrder?.op_numero || targetOrder?.numero || matchedOpKey);

    const opUpdates: Record<string, any> = {
      status: 'EM_PRODUCAO',
      status_fabrica: 'Produzindo Hoje',
      emProducao: true,
      postoAtivo: params.setor,
      etapaAtual: params.setor,
      postoSelecionado: params.setor,
      colaboradorIniciou: params.operador,
      operadorAtual: params.operador,
      dataInicio: nowIso,
      data_atualizacao: nowIso,
      ultimaAtualizacao: nowIso
    };

    if (targetOrder) {
      const { steps } = getRouteForOp(targetOrder);
      const totalPadrao = Number(targetOrder.quantidade_total ?? targetOrder.quantidade ?? 1) || 1;
      if (!targetOrder.etapas) {
        targetOrder.etapas = {};
      }
      steps.forEach((s) => {
        if (!targetOrder.etapas![s]) {
          targetOrder.etapas![s] = { status: 'PENDENTE', concluidas: 0, total: totalPadrao };
        } else if (targetOrder.etapas![s].total === undefined) {
          targetOrder.etapas![s].total = totalPadrao;
        }
      });
      const matchedStepKey = steps.find(s => matchStepName(s, params.etapa_rota) || doesSectorMatchStep(params.setor, s)) || params.etapa_rota;
      targetOrder.etapas[matchedStepKey] = {
        ...targetOrder.etapas[matchedStepKey],
        status: 'EM_PRODUCAO',
        concluidas: targetOrder.etapas[matchedStepKey]?.concluidas || 0,
        total: targetOrder.etapas[matchedStepKey]?.total ?? totalPadrao,
        inicio: nowIso,
        horaInicio: nowIso,
        operador: params.operador,
        operadorNome: params.operador
      };
      targetOrder.status = 'EM_PRODUCAO';
      targetOrder.status_fabrica = 'Produzindo Hoje';
      targetOrder.emProducao = true;
      targetOrder.postoAtivo = params.setor;
      targetOrder.etapaAtual = params.setor;
      targetOrder.postoSelecionado = params.setor;
      targetOrder.colaboradorIniciou = params.operador;
      targetOrder.operadorAtual = params.operador;
      targetOrder.dataInicio = targetOrder.dataInicio || nowIso;
      targetOrder.data_atualizacao = nowIso;
      targetOrder.ultimaAtualizacao = nowIso;

      opUpdates.etapas = targetOrder.etapas;

      if ((targetOrder as any).progressoPostos) {
        const progKey = Object.keys((targetOrder as any).progressoPostos).find(k => matchStepName(k, matchedStepKey) || doesSectorMatchStep(params.setor, k)) || matchedStepKey;
        if (!(targetOrder as any).progressoPostos[progKey]) {
          (targetOrder as any).progressoPostos[progKey] = { concluidas: 0 };
        }
        (targetOrder as any).progressoPostos[progKey].iniciado = true;
        (targetOrder as any).progressoPostos[progKey].status = 'EM_PRODUCAO';
        (targetOrder as any).progressoPostos[progKey].dataInicio = (targetOrder as any).progressoPostos[progKey].dataInicio || nowIso;
        opUpdates.progressoPostos = (targetOrder as any).progressoPostos;
      }

      ordersMap[matchedOpKey] = targetOrder;
      localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(ordersMap));
    }

    try {
      const localUrl = getLocalServerUrl();
      fetch(`${localUrl}/api/ordens/${cleanOpId(matchedOpKey)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targetOrder || opUpdates)
      }).catch(() => {});
      fetch(`${localUrl}/api/apontamentos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(novoApontamento)
      }).catch(() => {});
    } catch {}
  } catch (err) {
    console.error('Erro ao atualizar status da OP ao iniciar unidade:', err);
  }

  broadcastUpdate();
  return novoApontamento;
}

/**
 * Finaliza a unidade em andamento
 * Calcula duracao_minutos e regista hora_fim
 */
export async function finishUnit(
  apontamentoId: string,
  opNumero: string,
  options?: { encaminharRouter?: boolean }
): Promise<Apontamento> {
  ensureInitialData();
  const cleanOp = opNumero.trim().toUpperCase();
  const raw = localStorage.getItem(STORAGE_APONTAMENTOS_KEY);
  let tree: Record<string, Record<string, Apontamento>> = {};
  if (raw) {
    try {
      tree = JSON.parse(raw);
    } catch {
      tree = {};
    }
  }

  const opTree = tree[cleanOp];
  if (!opTree || !opTree[apontamentoId]) {
    throw new Error(`Apontamento ${apontamentoId} não encontrado para OP ${opNumero}`);
  }

  const item = opTree[apontamentoId];
  const now = new Date();
  const start = new Date(item.horaInicio || item.hora_inicio);
  const nowMs = now.getTime();
  const startMs = start.getTime();
  const duracaoLiquidaMs = !isNaN(startMs) ? calcularDuracaoLiquidaMs(startMs, nowMs) : 0;
  const diffMinutes = Math.max(0.1, Number((duracaoLiquidaMs / 60000).toFixed(1)));
  const diffMinutesInt = Math.max(1, Math.round(duracaoLiquidaMs / 60000));
  const nowIso = now.toISOString();

  const updated: Apontamento = {
    ...item,
    op: item.op || cleanOp,
    unidade: item.unidade || `Un #${item.unidade_numero}`,
    modo: 'UNITARIO',
    setorFisico: item.setorFisico || item.setor,
    etapaRota: item.etapaRota || item.etapa_rota,
    colaborador: item.colaborador || item.operador,
    terminal: item.terminal || `T${item.terminal_id}`,
    horaInicio: item.horaInicio || item.hora_inicio,
    hora_fim: nowIso,
    horaFim: nowIso,
    duracao_minutos: diffMinutes,
    duracao: diffMinutes,
    duracaoMs: duracaoLiquidaMs,
    duracaoMinutos: diffMinutesInt,
    duracaoFormatada: `${diffMinutesInt} min`,
    status: 'FINALIZADO'
  };

  tree[cleanOp][apontamentoId] = updated;
  localStorage.setItem(STORAGE_APONTAMENTOS_KEY, JSON.stringify(tree));

  try {
    const rawOrders = localStorage.getItem(STORAGE_ORDERS_KEY);
    if (rawOrders) {
      const ordersMap: Record<string, ProductionOrder> = JSON.parse(rawOrders);
      let matchedOpKey = cleanOp;
      let targetOrder = ordersMap[cleanOp];
      if (!targetOrder) {
        const cleanNoPrefix = cleanOp.replace(/^OP\s*/i, '').replace(/[-_\s]/g, '');
        const foundKey = Object.keys(ordersMap).find((k) => {
          const kClean = k.replace(/^OP\s*/i, '').replace(/[-_\s]/g, '');
          return kClean === cleanNoPrefix || k.trim().toUpperCase() === cleanOp;
        });
        if (foundKey) {
          matchedOpKey = foundKey;
          targetOrder = ordersMap[foundKey];
        }
      }

      if (targetOrder) {
        const { steps } = getRouteForOp(targetOrder);
        if (!targetOrder.etapas) {
          targetOrder.etapas = {};
        }
        steps.forEach((s) => {
          if (!targetOrder.etapas![s]) {
            targetOrder.etapas![s] = { status: 'PENDENTE', concluidas: 0 };
          }
        });

        const currentStepIndex = steps.findIndex(
          (s) => matchStepName(s, item.etapa_rota) || doesSectorMatchStep(item.setor, s)
        );
        const matchedStep = currentStepIndex >= 0 ? steps[currentStepIndex] : item.etapa_rota;

        // Verifica quantas unidades foram finalizadas para esta etapa
        const stepApts = Object.values(tree[cleanOp] || {}).filter(
          (a) => a.status === 'FINALIZADO' && (matchStepName(a.etapa_rota, matchedStep) || doesSectorMatchStep(a.setor, matchedStep))
        );
        const finishedCount = stepApts.length;
        const totalUnits = Math.max(1, Math.round(targetOrder.quantidade_total || 1));

        if (finishedCount >= totalUnits) {
          targetOrder.etapas[matchedStep] = {
            ...targetOrder.etapas[matchedStep],
            status: 'CONCLUIDO',
            concluidas: totalUnits,
            timestampFim: nowMs,
            duracaoMs: duracaoLiquidaMs,
            duracaoMinutos: diffMinutesInt,
            duracaoFormatada: `${diffMinutesInt} min`,
            colaboradorFinalizou: updated.colaborador || updated.operador
          };
          if (!targetOrder.progressoPostos) targetOrder.progressoPostos = {};
          targetOrder.progressoPostos[matchedStep] = {
            concluido: true,
            concluidas: totalUnits,
            dataConclusao: nowIso,
            duracaoMinutos: diffMinutesInt,
            duracaoMs: duracaoLiquidaMs
          };

          const isInjecaoStep = Boolean(
            matchedStep.toLowerCase().includes('injeção') ||
            matchedStep.toLowerCase().includes('injecao') ||
            item.setor.toLowerCase().includes('injeção') ||
            item.setor.toLowerCase().includes('injecao')
          );
          const eligibleRouter = isEligibleForRouter(targetOrder);

          if (isInjecaoStep && eligibleRouter) {
            if (options?.encaminharRouter) {
              targetOrder.encaminhar_router = true;
              targetOrder.requer_router = true;

              if (Array.isArray(targetOrder.etapas)) {
                const idx = targetOrder.etapas.findIndex((e: any) =>
                  typeof e === 'string' ? e.includes('Injeção') : (e.nome || e.step || '').includes('Injeção')
                );
                if (idx !== -1 && !targetOrder.etapas.includes('Router')) {
                  targetOrder.etapas.splice(idx + 1, 0, 'Router');
                }
              }
              if (targetOrder.etapas && typeof targetOrder.etapas === 'object' && !Array.isArray(targetOrder.etapas)) {
                targetOrder.etapas['Router'] = {
                  status: 'PENDENTE',
                  concluidas: 0
                };
              }

              targetOrder.etapaAtual = 'Router';
              targetOrder.statusEtapa = 'Aguardando Início em: Router';
              targetOrder.status = 'Aguardando Início em: Router';
              targetOrder.status_fabrica = 'Produzindo Hoje';
            } else {
              targetOrder.encaminhar_router = false;
              targetOrder.requer_router = false;
              const nextStep = currentStepIndex >= 0 && currentStepIndex < steps.length - 1 ? steps[currentStepIndex + 1] : undefined;
              if (nextStep) {
                targetOrder.etapaAtual = nextStep;
                targetOrder.statusEtapa = `Aguardando Início em: ${nextStep}`;
                targetOrder.status = `Aguardando Início em: ${nextStep}`;
              } else {
                targetOrder.status = 'EM_PRODUCAO';
              }
              targetOrder.status_fabrica = 'Produzindo Hoje';
            }
          } else {
            if (currentStepIndex >= 0) {
              for (let i = currentStepIndex + 1; i < steps.length; i++) {
                const nextStep = steps[i];
                if (!targetOrder.etapas[nextStep] || targetOrder.etapas[nextStep].status !== 'CONCLUIDO') {
                  targetOrder.etapas[nextStep] = {
                    status: targetOrder.etapas[nextStep]?.status === 'EM_PRODUCAO' ? 'EM_PRODUCAO' : 'PENDENTE',
                    concluidas: targetOrder.etapas[nextStep]?.concluidas || 0
                  };
                }
              }
            }

            const isLastStep = currentStepIndex >= 0 && currentStepIndex === steps.length - 1;
            if (isLastStep) {
              targetOrder.status = 'FINALIZADA';
              targetOrder.status_fabrica = 'Embalada';
              targetOrder.qtde_produzida = totalUnits;
            } else {
              const nextStep = currentStepIndex >= 0 && currentStepIndex < steps.length - 1 ? steps[currentStepIndex + 1] : undefined;
              if (nextStep) {
                targetOrder.etapaAtual = nextStep;
                targetOrder.statusEtapa = `Aguardando Início em: ${nextStep}`;
                targetOrder.status = `Aguardando Início em: ${nextStep}`;
              } else {
                targetOrder.status = 'EM_PRODUCAO';
              }
              targetOrder.status_fabrica = 'Produzindo Hoje';
            }
          }
        } else {
          targetOrder.etapas[matchedStep] = {
            status: 'EM_PRODUCAO',
            concluidas: finishedCount
          };
          targetOrder.status = 'EM_PRODUCAO';
          targetOrder.etapaAtual = matchedStep;
          targetOrder.statusEtapa = `Produzindo: ${matchedStep}`;
        }

        ordersMap[matchedOpKey] = targetOrder;
        localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(ordersMap));

        try {
          const localUrl = getLocalServerUrl();
          fetch(`${localUrl}/api/ordens/${cleanOpId(matchedOpKey)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(targetOrder)
          }).catch(() => {});
          fetch(`${localUrl}/api/apontamentos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updated)
          }).catch(() => {});
        } catch {}
      }
    }
  } catch (err) {
    console.error('Erro ao atualizar status da OP ao finalizar unidade:', err);
  }

  broadcastUpdate();
  return updated;
}

export interface StartBatchParams {
  op_numero: string;
  quantidade_total: number;
  setor: string;
  etapa_rota: string;
  terminal_id: number;
  operador: string;
}

/**
 * Inicia o apontamento do lote completo
 */
export async function startBatch(params: StartBatchParams): Promise<Apontamento> {
  ensureInitialData();
  const cleanOp = params.op_numero.trim().toUpperCase();
  const raw = localStorage.getItem(STORAGE_APONTAMENTOS_KEY);
  let tree: Record<string, Record<string, Apontamento>> = {};
  if (raw) {
    try {
      tree = JSON.parse(raw);
    } catch {
      tree = {};
    }
  }

  if (!tree[cleanOp]) {
    tree[cleanOp] = {};
  }

  const uniqueId = `apt_lote_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const nowIso = new Date().toISOString();
  const totalUnits = Math.max(1, Math.round(params.quantidade_total || 1));
  const novoApontamento: Apontamento = {
    id: uniqueId,
    op_numero: cleanOp,
    op: cleanOp,
    unidade_numero: 0,
    unidade: `Lote (${totalUnits} PC)`,
    is_lote: true,
    modo: 'LOTE',
    quantidade_lote: totalUnits,
    setor: params.setor,
    setorFisico: params.setor,
    etapa_rota: params.etapa_rota,
    etapaRota: params.etapa_rota,
    terminal_id: params.terminal_id,
    terminal: `T${params.terminal_id}`,
    operador: params.operador,
    colaborador: params.operador,
    hora_inicio: nowIso,
    horaInicio: nowIso,
    status: 'EM_ANDAMENTO'
  };

  tree[cleanOp][uniqueId] = novoApontamento;
  localStorage.setItem(STORAGE_APONTAMENTOS_KEY, JSON.stringify(tree));

  // Atualiza status da OP para EM_PRODUCAO com data/hora e colaborador de forma estritamente granular
  try {
    const rawOrders = localStorage.getItem(STORAGE_ORDERS_KEY);
    let ordersMap: Record<string, ProductionOrder> = {};
    if (rawOrders) {
      try {
        ordersMap = JSON.parse(rawOrders);
      } catch {
        ordersMap = {};
      }
    }

    let matchedOpKey = cleanOp;
    let targetOrder = ordersMap[cleanOp];
    if (!targetOrder) {
      const cleanNoPrefix = cleanOp.replace(/^OP\s*/i, '').replace(/[-_\s]/g, '');
      const foundKey = Object.keys(ordersMap).find((k) => {
        const kClean = k.replace(/^OP\s*/i, '').replace(/[-_\s]/g, '');
        return kClean === cleanNoPrefix || k.trim().toUpperCase() === cleanOp;
      });
      if (foundKey) {
        matchedOpKey = foundKey;
        targetOrder = ordersMap[foundKey];
      }
    }

    

    const opKey = toFirebaseKey(targetOrder?.op_numero || targetOrder?.numero || matchedOpKey);

    const opUpdates: Record<string, any> = {
      status: 'EM_PRODUCAO',
      status_fabrica: 'Produzindo Hoje',
      emProducao: true,
      postoAtivo: params.setor,
      etapaAtual: params.setor,
      postoSelecionado: params.setor,
      colaboradorIniciou: params.operador,
      operadorAtual: params.operador,
      dataInicio: nowIso,
      data_atualizacao: nowIso,
      ultimaAtualizacao: nowIso
    };

    if (targetOrder) {
      const { steps } = getRouteForOp(targetOrder);
      const totalPadrao = Number(targetOrder.quantidade_total ?? targetOrder.quantidade ?? 1) || 1;
      if (!targetOrder.etapas) {
        targetOrder.etapas = {};
      }
      steps.forEach((s) => {
        if (!targetOrder.etapas![s]) {
          targetOrder.etapas![s] = { status: 'PENDENTE', concluidas: 0, total: totalPadrao };
        } else if (targetOrder.etapas![s].total === undefined) {
          targetOrder.etapas![s].total = totalPadrao;
        }
      });
      const matchedStepKey = steps.find(s => matchStepName(s, params.etapa_rota) || doesSectorMatchStep(params.setor, s)) || params.etapa_rota;
      targetOrder.etapas[matchedStepKey] = {
        ...targetOrder.etapas[matchedStepKey],
        status: 'EM_PRODUCAO',
        concluidas: targetOrder.etapas[matchedStepKey]?.concluidas || 0,
        total: targetOrder.etapas[matchedStepKey]?.total ?? totalPadrao,
        inicio: nowIso,
        horaInicio: nowIso,
        operador: params.operador,
        operadorNome: params.operador
      };
      targetOrder.status = 'EM_PRODUCAO';
      targetOrder.status_fabrica = 'Produzindo Hoje';
      targetOrder.emProducao = true;
      targetOrder.postoAtivo = params.setor;
      targetOrder.etapaAtual = params.setor;
      targetOrder.postoSelecionado = params.setor;
      targetOrder.colaboradorIniciou = params.operador;
      targetOrder.operadorAtual = params.operador;
      targetOrder.dataInicio = targetOrder.dataInicio || nowIso;
      targetOrder.data_atualizacao = nowIso;
      targetOrder.ultimaAtualizacao = nowIso;

      opUpdates.etapas = targetOrder.etapas;

      if ((targetOrder as any).progressoPostos) {
        const progKey = Object.keys((targetOrder as any).progressoPostos).find(k => matchStepName(k, matchedStepKey) || doesSectorMatchStep(params.setor, k)) || matchedStepKey;
        if (!(targetOrder as any).progressoPostos[progKey]) {
          (targetOrder as any).progressoPostos[progKey] = { concluidas: 0 };
        }
        (targetOrder as any).progressoPostos[progKey].iniciado = true;
        (targetOrder as any).progressoPostos[progKey].status = 'EM_PRODUCAO';
        (targetOrder as any).progressoPostos[progKey].dataInicio = (targetOrder as any).progressoPostos[progKey].dataInicio || nowIso;
        opUpdates.progressoPostos = (targetOrder as any).progressoPostos;
      }

      ordersMap[matchedOpKey] = targetOrder;
      localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(ordersMap));
    }

    try {
      const localUrl = getLocalServerUrl();
      fetch(`${localUrl}/api/ordens/${cleanOpId(matchedOpKey)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targetOrder || opUpdates)
      }).catch(() => {});
      fetch(`${localUrl}/api/apontamentos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(novoApontamento)
      }).catch(() => {});
    } catch {}
  } catch (err) {
    console.error('Erro ao atualizar status da OP ao iniciar lote:', err);
  }

  broadcastUpdate();
  return novoApontamento;
}

/**
 * Finaliza o lote completo gravando EXCLUSIVAMENTE 1 único registro consolidado no histórico
 */
export async function finishBatch(
  apontamentoId: string,
  opNumero: string,
  options?: { quantidadeRefugo?: number; quantidadeProduzida?: number; encaminharRouter?: boolean }
): Promise<Apontamento> {
  ensureInitialData();
  const cleanOp = opNumero.trim().toUpperCase();
  const raw = localStorage.getItem(STORAGE_APONTAMENTOS_KEY);
  let tree: Record<string, Record<string, Apontamento>> = {};
  if (raw) {
    try {
      tree = JSON.parse(raw);
    } catch {
      tree = {};
    }
  }

  const opTree = tree[cleanOp];
  if (!opTree || !opTree[apontamentoId]) {
    throw new Error(`Apontamento de lote ${apontamentoId} não encontrado para OP ${opNumero}`);
  }

  const item = opTree[apontamentoId];
  const now = new Date();
  const start = new Date(item.horaInicio || item.hora_inicio);
  const nowMs = now.getTime();
  const startMs = start.getTime();
  const duracaoLiquidaMs = !isNaN(startMs) ? calcularDuracaoLiquidaMs(startMs, nowMs) : 0;
  const diffMinutes = Math.max(0.1, Number((duracaoLiquidaMs / 60000).toFixed(1)));
  const diffMinutesInt = Math.max(1, Math.round(duracaoLiquidaMs / 60000));
  const totalUnits = item.quantidade_lote || Math.max(1, Math.round(options?.quantidadeProduzida || 1));
  const refugo = options?.quantidadeRefugo || 0;
  const nowIso = now.toISOString();

  // EXCLUSIVAMENTE 1 único registro consolidado no histórico (sem loop de N unidades)
  const updated: Apontamento = {
    ...item,
    id: apontamentoId,
    op: cleanOp,
    op_numero: cleanOp,
    unidade: `Lote (${totalUnits} PC)`,
    unidade_numero: 0,
    modo: 'LOTE',
    setor: item.setor,
    setorFisico: item.setorFisico || item.setor,
    etapa_rota: item.etapa_rota,
    etapaRota: item.etapaRota || item.etapa_rota,
    operador: item.operador,
    colaborador: item.colaborador || item.operador,
    terminal_id: item.terminal_id,
    terminal: item.terminal || `T${item.terminal_id}`,
    hora_inicio: item.hora_inicio,
    horaInicio: item.horaInicio || item.hora_inicio,
    hora_fim: nowIso,
    horaFim: nowIso,
    duracao_minutos: diffMinutes,
    duracao: diffMinutes,
    duracaoMs: duracaoLiquidaMs,
    duracaoMinutos: diffMinutesInt,
    duracaoFormatada: `${diffMinutesInt} min`,
    status: 'FINALIZADO',
    quantidade_refugo: refugo,
    quantidade_lote: totalUnits,
    is_lote: true
  };

  tree[cleanOp][apontamentoId] = updated;

  // Limpa quaisquer registros legados individuais que tenham sido gerados anteriormente para este lote/etapa
  const legacyPrefix = `apt_${cleanOp.replace(/[\s\/\\]/g, '_')}_${item.etapa_rota}_u`;
  Object.keys(tree[cleanOp]).forEach((key) => {
    if (key.startsWith(legacyPrefix) && key !== apontamentoId) {
      delete tree[cleanOp][key];
    }
  });

  localStorage.setItem(STORAGE_APONTAMENTOS_KEY, JSON.stringify(tree));
  try {
    const rawOrders = localStorage.getItem(STORAGE_ORDERS_KEY);
    if (rawOrders) {
      const ordersMap: Record<string, ProductionOrder> = JSON.parse(rawOrders);
      let matchedOpKey = cleanOp;
      let targetOrder = ordersMap[cleanOp];
      if (!targetOrder) {
        const cleanNoPrefix = cleanOp.replace(/^OP\s*/i, '').replace(/[-_\s]/g, '');
        const foundKey = Object.keys(ordersMap).find((k) => {
          const kClean = k.replace(/^OP\s*/i, '').replace(/[-_\s]/g, '');
          return kClean === cleanNoPrefix || k.trim().toUpperCase() === cleanOp;
        });
        if (foundKey) {
          matchedOpKey = foundKey;
          targetOrder = ordersMap[foundKey];
        }
      }

      if (targetOrder) {
        const { steps } = getRouteForOp(targetOrder);
        if (!targetOrder.etapas) {
          targetOrder.etapas = {};
        }
        steps.forEach((s) => {
          if (!targetOrder.etapas![s]) {
            targetOrder.etapas![s] = { status: 'PENDENTE', concluidas: 0 };
          }
        });

        const currentStepIndex = steps.findIndex(
          (s) => matchStepName(s, item.etapa_rota) || doesSectorMatchStep(item.setor, s)
        );
        const matchedStep = currentStepIndex >= 0 ? steps[currentStepIndex] : item.etapa_rota;

        // Marca estritamente a etapa atual concluída (concluidas = totalUnits)
        targetOrder.etapas[matchedStep] = {
          ...targetOrder.etapas[matchedStep],
          status: 'CONCLUIDO',
          concluidas: totalUnits,
          timestampFim: nowMs,
          duracaoMs: duracaoLiquidaMs,
          duracaoMinutos: diffMinutesInt,
          duracaoFormatada: `${diffMinutesInt} min`,
          colaboradorFinalizou: updated.colaborador || updated.operador
        };
        if (!targetOrder.progressoPostos) targetOrder.progressoPostos = {};
        targetOrder.progressoPostos[matchedStep] = {
          concluido: true,
          concluidas: totalUnits,
          dataConclusao: new Date().toISOString(),
          duracaoMinutos: diffMinutesInt,
          duracaoMs: duracaoLiquidaMs
        };

        const isInjecaoStep = Boolean(
          matchedStep.toLowerCase().includes('injeção') ||
          matchedStep.toLowerCase().includes('injecao') ||
          item.setor.toLowerCase().includes('injeção') ||
          item.setor.toLowerCase().includes('injecao')
        );
        const eligibleRouter = isEligibleForRouter(targetOrder);

        if (isInjecaoStep && eligibleRouter) {
          if (options?.encaminharRouter) {
            targetOrder.encaminhar_router = true;
            targetOrder.requer_router = true;

            if (Array.isArray(targetOrder.etapas)) {
              const idx = targetOrder.etapas.findIndex((e: any) =>
                typeof e === 'string' ? e.includes('Injeção') : (e.nome || e.step || '').includes('Injeção')
              );
              if (idx !== -1 && !targetOrder.etapas.includes('Router')) {
                targetOrder.etapas.splice(idx + 1, 0, 'Router');
              }
            }
            if (targetOrder.etapas && typeof targetOrder.etapas === 'object' && !Array.isArray(targetOrder.etapas)) {
              targetOrder.etapas['Router'] = {
                status: 'PENDENTE',
                concluidas: 0
              };
            }

            targetOrder.etapaAtual = 'Router';
            targetOrder.statusEtapa = 'Aguardando Início em: Router';
            targetOrder.status = 'Aguardando Início em: Router';
            targetOrder.status_fabrica = 'Produzindo Hoje';
          } else {
            targetOrder.encaminhar_router = false;
            targetOrder.requer_router = false;
            const nextStep = currentStepIndex >= 0 && currentStepIndex < steps.length - 1 ? steps[currentStepIndex + 1] : undefined;
            if (nextStep) {
              targetOrder.etapaAtual = nextStep;
              targetOrder.statusEtapa = `Aguardando Início em: ${nextStep}`;
              targetOrder.status = `Aguardando Início em: ${nextStep}`;
            } else {
              targetOrder.status = 'EM_PRODUCAO';
            }
            targetOrder.status_fabrica = 'Produzindo Hoje';
          }
        } else {
          // As etapas subsequentes permanecem rigorosamente PENDENTES com 0 peças feitas
          if (currentStepIndex >= 0) {
            for (let i = currentStepIndex + 1; i < steps.length; i++) {
              const nextStep = steps[i];
              if (!targetOrder.etapas[nextStep] || targetOrder.etapas[nextStep].status !== 'CONCLUIDO') {
                targetOrder.etapas[nextStep] = {
                  status: targetOrder.etapas[nextStep]?.status === 'EM_PRODUCAO' ? 'EM_PRODUCAO' : 'PENDENTE',
                  concluidas: targetOrder.etapas[nextStep]?.concluidas || 0
                };
              }
            }
          }

          const isLastStep = currentStepIndex >= 0 && currentStepIndex === steps.length - 1;
          if (isLastStep) {
            targetOrder.status = 'FINALIZADA';
            targetOrder.status_fabrica = 'Embalada';
            targetOrder.qtde_produzida = totalUnits - refugo;
          } else {
            const nextStep = currentStepIndex >= 0 && currentStepIndex < steps.length - 1 ? steps[currentStepIndex + 1] : undefined;
            if (nextStep) {
              targetOrder.etapaAtual = nextStep;
              targetOrder.statusEtapa = `Aguardando Início em: ${nextStep}`;
              targetOrder.status = `Aguardando Início em: ${nextStep}`;
            } else {
              targetOrder.status = 'EM_PRODUCAO';
            }
            targetOrder.status_fabrica = 'Produzindo Hoje';
          }
        }

        ordersMap[matchedOpKey] = targetOrder;
        localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(ordersMap));

        try {
          const localUrl = getLocalServerUrl();
          fetch(`${localUrl}/api/ordens/${cleanOpId(matchedOpKey)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(targetOrder)
          }).catch(() => {});
          fetch(`${localUrl}/api/apontamentos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updated)
          }).catch(() => {});
        } catch {}
      }
    }
  } catch (err) {
    console.error('Erro ao atualizar status da OP ao finalizar lote:', err);
  }

  broadcastUpdate();
  return updated;
}

/**
 * Remove um apontamento individual por ID
 */
export async function deleteApontamento(apontamentoId: string, opNumero?: string): Promise<boolean> {
  ensureInitialData();
  const raw = localStorage.getItem(STORAGE_APONTAMENTOS_KEY);
  if (!raw) return false;
  let tree: Record<string, Record<string, Apontamento>> = {};
  try {
    tree = JSON.parse(raw);
  } catch {
    return false;
  }

  let deleted = false;
  let fbKey: string | undefined;
  if (opNumero) {
    const cleanOp = opNumero.trim().toUpperCase();
    if (tree[cleanOp] && tree[cleanOp][apontamentoId]) {
      fbKey = (tree[cleanOp][apontamentoId] as any)?.firebaseKey;
      delete tree[cleanOp][apontamentoId];
      deleted = true;
    }
  }
  if (!deleted) {
    for (const opKey of Object.keys(tree)) {
      if (tree[opKey] && tree[opKey][apontamentoId]) {
        fbKey = (tree[opKey][apontamentoId] as any)?.firebaseKey;
        delete tree[opKey][apontamentoId];
        deleted = true;
        break;
      }
    }
  }

  if (deleted) {
    localStorage.setItem(STORAGE_APONTAMENTOS_KEY, JSON.stringify(tree));
    try {
      const localUrl = getLocalServerUrl();
      fetch(`${localUrl}/api/apontamentos/${encodeURIComponent(apontamentoId)}`, {
        method: 'DELETE'
      }).catch(() => {});
    } catch {}
    broadcastUpdate();
  }
  return deleted;
}

/**
 * Cancela / estorna o início acidental de uma etapa da OP (Totem ou PCP)
 * Retorna o status do posto para 'PENDENTE', remove o apontamento em andamento,
 * limpa os campos de início/operador/cronômetro e preserva as etapas anteriores já concluídas.
 */
export async function cancelarInicioEtapa(
  opNumero: string,
  setorOuEtapa: string,
  apontamentoId?: string
): Promise<{ success: boolean; message: string }> {
  ensureInitialData();

  // 1. Higienização do identificador da OP (sem duplicidade de 'OP' e sem caracteres inválidos)
  const numClean = cleanOpId(opNumero);
  const keyWithOp = `OP ${numClean}`;
  const keyNoOp = numClean;
  const cleanNoSpecial = numClean.replace(/[-_\s]/g, '').toUpperCase();

  // 2. Localiza e remove apontamentos EM_ANDAMENTO no localStorage (STORAGE_APONTAMENTOS_KEY)
  const rawApts = localStorage.getItem(STORAGE_APONTAMENTOS_KEY);
  let tree: Record<string, Record<string, Apontamento>> = {};
  if (rawApts) {
    try {
      tree = JSON.parse(rawApts);
    } catch {
      tree = {};
    }
  }

  for (const treeKey of Object.keys(tree)) {
    const treeClean = cleanOpId(treeKey);
    const treeNoSpecial = treeClean.replace(/[-_\s]/g, '').toUpperCase();
    if (treeClean === numClean || treeNoSpecial === cleanNoSpecial) {
      const opTree = tree[treeKey] || {};
      for (const [id, a] of Object.entries(opTree)) {
        if (a.status === 'EM_ANDAMENTO') {
          const matchId = apontamentoId ? a.id === apontamentoId : true;
          const matchSetor =
            matchStepName(a.etapa_rota || a.etapaRota || '', setorOuEtapa) ||
            doesSectorMatchStep(a.setorFisico || a.setor || '', setorOuEtapa) ||
            (a.setor && a.setor.toLowerCase().trim() === setorOuEtapa.toLowerCase().trim()) ||
            (a.etapa_rota && a.etapa_rota.toLowerCase().trim() === setorOuEtapa.toLowerCase().trim());

          if (matchId && matchSetor) {
            delete opTree[id];
          }
        }
      }
      tree[treeKey] = opTree;
    }
  }
  localStorage.setItem(STORAGE_APONTAMENTOS_KEY, JSON.stringify(tree));

  // 3. Localiza a Ordem de Produção no localStorage
  const rawOrders = localStorage.getItem(STORAGE_ORDERS_KEY);
  let ordersMap: Record<string, ProductionOrder> = {};
  if (rawOrders) {
    try {
      ordersMap = JSON.parse(rawOrders);
    } catch {
      ordersMap = {};
    }
  }

  let targetOrder: ProductionOrder | null = ordersMap[keyWithOp] || ordersMap[keyNoOp] || null;
  let targetFirebaseKey = ordersMap[keyWithOp] ? keyWithOp : (ordersMap[keyNoOp] ? keyNoOp : keyWithOp);
  let matchedLocalKey = targetFirebaseKey;
  if (!targetOrder) {
    const foundKey = Object.keys(ordersMap).find((k) => {
      const kClean = cleanOpId(k);
      const kNoSpecial = kClean.replace(/[-_\s]/g, '').toUpperCase();
      return kClean === numClean || kNoSpecial === cleanNoSpecial;
    });
    if (foundKey) {
      matchedLocalKey = foundKey;
      targetFirebaseKey = foundKey;
      targetOrder = ordersMap[foundKey];
    }
  }

  if (targetOrder) {
    const { steps } = getRouteForOp(targetOrder);
    const matchedStepKey =
      steps.find(
        (s) => matchStepName(s, setorOuEtapa) || doesSectorMatchStep(setorOuEtapa, s)
      ) || setorOuEtapa;

    if (!targetOrder.etapas) {
      targetOrder.etapas = {};
    }

    // Reseta todas as chaves variantes dessa etapa (com ou sem acento, ex: Injeção e Injecao)
    const keysToReset = Object.keys(targetOrder.etapas).filter(
      k => matchStepName(k, matchedStepKey) || doesSectorMatchStep(k, matchedStepKey) || k === matchedStepKey || k === setorOuEtapa
    );
    if (keysToReset.length === 0) keysToReset.push(matchedStepKey);

    const totalPadrao = Number(
      targetOrder.quantidade_total ?? targetOrder.quantidade ?? 1
    ) || 1;

    for (const k of keysToReset) {
      const etapaAnterior = targetOrder.etapas[k] || { status: 'PENDENTE', concluidas: 0 };
      const totalEtapa = (typeof etapaAnterior.total === 'number' && !isNaN(etapaAnterior.total) && etapaAnterior.total > 0)
        ? etapaAnterior.total
        : totalPadrao;

      targetOrder.etapas[k] = {
        status: 'PENDENTE',
        inicio: null,
        fim: null,
        operadorId: null,
        operadorNome: null,
        emAndamento: 0,
        concluidas: etapaAnterior.concluidas || 0,
        quantidadeProduzida: etapaAnterior.concluidas || 0,
        total: totalEtapa // NUNCA permitir undefined aqui
      };
      if (Array.isArray((etapaAnterior as any).pecas)) {
        (targetOrder.etapas[k] as any).pecas = (etapaAnterior as any).pecas.map((p: any) => ({
          ...p,
          status: 'PENDENTE',
          inicio: null,
          fim: null,
          operadorId: null,
          operadorNome: null
        }));
      }
      delete (targetOrder.etapas[k] as any).horaInicio;
      delete (targetOrder.etapas[k] as any).hora_inicio;
      delete (targetOrder.etapas[k] as any).operador;
      delete (targetOrder.etapas[k] as any).colaborador;
    }

    // Varre todas as etapas para garantir que nenhuma etapa da OP tenha total ou qualquer campo com valor undefined
    for (const [stepKey, stepVal] of Object.entries(targetOrder.etapas)) {
      if (stepVal && typeof stepVal === 'object') {
        if ((stepVal as any).total === undefined || (stepVal as any).total === null) {
          (stepVal as any).total = totalPadrao;
        }
      }
    }

    if ((targetOrder as any).progressoPostos) {
      for (const k of Object.keys((targetOrder as any).progressoPostos)) {
        if (matchStepName(k, matchedStepKey) || doesSectorMatchStep(k, matchedStepKey) || k === matchedStepKey || k === setorOuEtapa) {
          (targetOrder as any).progressoPostos[k].iniciado = false;
          (targetOrder as any).progressoPostos[k].status = 'PENDENTE';
          (targetOrder as any).progressoPostos[k].dataInicio = null;
          (targetOrder as any).progressoPostos[k].operadorId = null;
          (targetOrder as any).progressoPostos[k].operadorNome = null;
        }
      }
    }

    // Verifica se restou alguma outra etapa ativa na OP
    const otherActiveStep = steps.find(
      (s) => s !== matchedStepKey && (
        targetOrder?.etapas?.[s]?.status === 'EM_PRODUCAO' ||
        targetOrder?.etapas?.[s]?.status === 'EM_ANDAMENTO' ||
        targetOrder?.etapas?.[s]?.status === 'IN_PROGRESS'
      )
    );
    const anyCompletedStep = steps.some(
      (s) => (targetOrder?.etapas?.[s]?.status === 'CONCLUIDO') || ((targetOrder?.etapas?.[s]?.concluidas || 0) > 0)
    );

    const proximaEtapaPendente = steps.find(
      (s) => (targetOrder?.etapas?.[s]?.status !== 'CONCLUIDO') && ((targetOrder?.etapas?.[s]?.concluidas || 0) === 0)
    ) || steps[0] || 'Corte';

    if (otherActiveStep) {
      targetOrder.status = 'EM_PRODUCAO';
      targetOrder.statusEtapa = `Em Produção: ${otherActiveStep}`;
      targetOrder.etapaAtual = otherActiveStep;
      targetOrder.postoAtivo = otherActiveStep;
      targetOrder.postoSelecionado = otherActiveStep;
    } else if (anyCompletedStep) {
      targetOrder.status = 'EM_PRODUCAO';
      targetOrder.status_fabrica = 'Produzindo Hoje';
      targetOrder.statusEtapa = `Aguardando Início em: ${proximaEtapaPendente}`;
      targetOrder.etapaAtual = proximaEtapaPendente;
      targetOrder.postoAtivo = null;
      targetOrder.postoSelecionado = null;
      targetOrder.colaboradorIniciou = null;
      targetOrder.operadorAtual = null;
    } else {
      targetOrder.status = `Aguardando Início em: ${proximaEtapaPendente}`;
      targetOrder.status_fabrica = 'Aguardando Início';
      targetOrder.statusEtapa = `Aguardando Início em: ${proximaEtapaPendente}`;
      targetOrder.etapaAtual = proximaEtapaPendente;
      targetOrder.postoAtivo = null;
      targetOrder.postoSelecionado = null;
      targetOrder.colaboradorIniciou = null;
      targetOrder.operadorAtual = null;
      targetOrder.dataInicio = null;
    }

    // Atualização atômica sem colisões de ancestral no Firebase Realtime Database
    const opUpdates: Record<string, any> = {
      etapas: targetOrder.etapas,
      status: targetOrder.status,
      status_fabrica: targetOrder.status_fabrica,
      statusEtapa: targetOrder.statusEtapa,
      etapaAtual: targetOrder.etapaAtual,
      postoAtivo: targetOrder.postoAtivo ?? null,
      postoSelecionado: targetOrder.postoSelecionado ?? null,
      colaboradorIniciou: targetOrder.colaboradorIniciou ?? null,
      operadorAtual: targetOrder.operadorAtual ?? null,
      data_atualizacao: new Date().toISOString()
    };

    if ((targetOrder as any).progressoPostos) {
      opUpdates.progressoPostos = (targetOrder as any).progressoPostos;
    }
    if (!otherActiveStep && !anyCompletedStep) {
      opUpdates.dataInicio = null;
    }

    const cleanUpdates = sanitizePayload(opUpdates);

    try {
      const localUrl = getLocalServerUrl();
      const numClean = cleanOpId(matchedLocalKey || opNumero);
      
      // Chamada oficial à rota de estorno/reset-etapa
      await fetch(`${localUrl}/api/ordens/${numClean}/reset-etapa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          numero: numClean,
          opNumero: formatOpNumber(numClean),
          etapa: setorOuEtapa,
          apontamentoId
        })
      }).catch((e) => {
        console.warn('Falha no fetch reset-etapa:', e);
      });

      // Emite evento via socket local se conectado
      const socket = getLocalSocket();
      if (socket && socket.connected) {
        socket.emit('resetar_etapa', {
          numero: numClean,
          opNumero: formatOpNumber(numClean),
          etapa: setorOuEtapa
        });
      }
    } catch (errSync) {
      console.warn('Erro ao sincronizar estorno de etapa:', errSync);
    }

    // Atualiza também no localStorage
    ordersMap[matchedLocalKey] = { ...targetOrder, ...cleanUpdates };
    if (matchedLocalKey !== targetFirebaseKey) {
      ordersMap[targetFirebaseKey] = { ...targetOrder, ...cleanUpdates };
    }
    localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(ordersMap));
  }

  broadcastUpdate();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('metalrib_orders_updated'));
    window.dispatchEvent(new CustomEvent('metalrib_apontamentos_updated'));
  }
  return { success: true, message: `Etapa ${setorOuEtapa} estornada com sucesso` };
}

/**
 * Reseta a OP Completa no Portal do PCP
 * Zera todos os apontamentos da ordem (concluídos e em andamento) voltando para a estaca zero (status PENDENTE),
 * limpa operadores, cronômetros, apontamentos no Firebase e no localStorage sem excluir a OP do sistema.
 */
export async function resetarOpCompleta(
  rawOpId: string
): Promise<{ success: boolean; message: string }> {
  ensureInitialData();
  const numClean = cleanOpId(rawOpId);
  if (!numClean) {
    return { success: false, message: 'Número de OP inválido.' };
  }

  const keyWithOp = `OP ${numClean}`;
  const keyNoOp = numClean;
  const cleanNoSpecial = numClean.replace(/[-_\s]/g, '').toUpperCase();

  // 1. Busca da OP no localStorage
  const rawOrders = localStorage.getItem(STORAGE_ORDERS_KEY);
  let ordersMap: Record<string, ProductionOrder> = {};
  if (rawOrders) {
    try {
      ordersMap = JSON.parse(rawOrders);
    } catch {
      ordersMap = {};
    }
  }

  let targetOrder: ProductionOrder | null = ordersMap[keyWithOp] || ordersMap[keyNoOp] || null;
  let targetFirebaseKey = ordersMap[keyWithOp] ? keyWithOp : (ordersMap[keyNoOp] ? keyNoOp : keyWithOp);
  let matchedLocalKey = targetFirebaseKey;
  if (!targetOrder) {
    const foundKey = Object.keys(ordersMap).find((k) => {
      const kClean = cleanOpId(k);
      const kNoSpecial = kClean.replace(/[-_\s]/g, '').toUpperCase();
      return kClean === numClean || kNoSpecial === cleanNoSpecial;
    });
    if (foundKey) {
      matchedLocalKey = foundKey;
      targetFirebaseKey = foundKey;
      targetOrder = ordersMap[foundKey];
    }
  }

  if (!targetOrder) {
    return { success: false, message: 'OP não encontrada no banco.' };
  }



  // 3. Remove apontamentos no localStorage (STORAGE_APONTAMENTOS_KEY)
  const rawApts = localStorage.getItem(STORAGE_APONTAMENTOS_KEY);
  if (rawApts) {
    try {
      const tree = JSON.parse(rawApts);
      for (const k of Object.keys(tree)) {
        const kClean = cleanOpId(k);
        const kNoSpecial = kClean.replace(/[-_\s]/g, '').toUpperCase();
        if (kClean === numClean || kNoSpecial === cleanNoSpecial) {
          delete tree[k];
        }
      }
      localStorage.setItem(STORAGE_APONTAMENTOS_KEY, JSON.stringify(tree));
    } catch {}
  }

  // 4. Determina etapas da rota da OP
  const steps = Array.isArray(targetOrder.rota) && targetOrder.rota.length > 0
    ? targetOrder.rota
    : obterEtapasDaRota(targetOrder);
  const primeiraEtapaNome = steps[0] || 'Corte';
  const totalQtd = Math.max(1, Math.round(targetOrder.quantidade_total || targetOrder.quantidade || 1));

  // 5. Zerar todas as etapas mantendo a estrutura da rota intacta
  let etapasResetadas: any;
  if (Array.isArray(targetOrder.etapas)) {
    etapasResetadas = targetOrder.etapas.map((etapa: any) => {
      if (typeof etapa === 'string') return etapa;
      return {
        ...etapa,
        status: 'PENDENTE',
        inicio: null,
        fim: null,
        operadorId: null,
        operadorNome: null,
        operador: null,
        colaborador: null,
        emAndamento: 0,
        concluidas: 0,
        quantidadeProduzida: 0,
        ...(etapa.pecas && {
          pecas: etapa.pecas.map((p: any) => ({
            ...p,
            status: 'PENDENTE',
            inicio: null,
            fim: null,
            operadorId: null,
            operadorNome: null,
            operador: null,
            colaborador: null
          }))
        })
      };
    });
  } else {
    etapasResetadas = typeof targetOrder.etapas === 'object' && targetOrder.etapas ? { ...targetOrder.etapas } : {};
    for (const stepName of steps) {
      const current = etapasResetadas[stepName];
      etapasResetadas[stepName] = {
        status: 'PENDENTE',
        concluidas: 0,
        total: (typeof current === 'object' && current?.total) ? current.total : totalQtd,
        ...(typeof current === 'object' && current?.pecas ? {
          pecas: current.pecas.map((p: any) => ({
            ...p,
            status: 'PENDENTE',
            inicio: null,
            fim: null,
            operadorId: null,
            operadorNome: null,
            operador: null,
            colaborador: null
          }))
        } : {})
      };
    }
  }

  // 6. Zerar progressoPostos
  const progressoPostosResetado: Record<string, any> = {};
  for (const stepName of steps) {
    progressoPostosResetado[stepName] = {
      concluidas: 0,
      concluido: false,
      iniciado: false,
      status: 'PENDENTE'
    };
  }

  // 7. Atualização atômica da OP no nó raiz
  const opUpdates: Record<string, any> = {
    etapas: etapasResetadas,
    progressoPostos: progressoPostosResetado,
    apontamentos: {},
    status: `Aguardando Início em: ${primeiraEtapaNome}`,
    statusEtapa: `Aguardando Início em: ${primeiraEtapaNome}`,
    status_fabrica: 'Aguardando Início',
    etapaAtual: primeiraEtapaNome,
    aguardandoEm: primeiraEtapaNome,
    postoAtivo: null,
    postoSelecionado: null,
    colaboradorIniciou: null,
    operadorAtual: null,
    dataInicio: null,
    dataFim: null,
    emProducao: false,
    quantidadeProduzidaTotal: 0,
    data_atualizacao: new Date().toISOString(),
    ultimaAtualizacao: Date.now()
  };

  const cleanUpdates = sanitizePayload(opUpdates);

  try {
    const localUrl = getLocalServerUrl();
    fetch(`${localUrl}/api/ordens/${cleanOpId(matchedLocalKey)}/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: cleanOpId(matchedLocalKey), opNumero: keyWithOp })
    }).catch(() => {});
    fetch(`${localUrl}/api/ordens/${cleanOpId(matchedLocalKey)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cleanUpdates)
    }).catch(() => {});
  } catch {}

  // 9. Atualização no localStorage
  const updatedTarget = { ...targetOrder, ...cleanUpdates };
  delete (updatedTarget as any).apontamentos;
  ordersMap[matchedLocalKey] = updatedTarget;
  if (matchedLocalKey !== targetFirebaseKey) {
    ordersMap[targetFirebaseKey] = updatedTarget;
  }
  localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(ordersMap));

  // 10. Broadcast e disparos de eventos para atualizar Totem e PCP
  broadcastUpdate();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('metalrib_orders_updated'));
    window.dispatchEvent(new CustomEvent('metalrib_apontamentos_updated'));
  }

  return { success: true, message: `OP ${numClean} foi completamente resetada para o início!` };
}

/**
 * Limpa todo o histórico de apontamentos
 */
export async function clearAllApontamentos(): Promise<void> {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_APONTAMENTOS_KEY, JSON.stringify({}));
  
  broadcastUpdate();
}

/**
 * Adiciona uma nova OP (para supervisão / teste)
 */
export async function addProductionOrder(order: ProductionOrder): Promise<void> {
  ensureInitialData();
  const orders = await fetchProductionOrders();

  const descUpper = String(order.descricao || '').toUpperCase();
  const codStr = String(order.codigoProduto || (order as any).cod || order.codigo || '').trim();

  let etapas = order.etapas;
  let etapaAtual = (order as any).etapaAtual || 'Corte';
  let status = order.status || 'EM_PRODUCAO';

  const rotasCalculadas = obterEtapasDaRota(order);
  etapas = rotasCalculadas;
  etapaAtual = rotasCalculadas[0] || 'Corte';
  status = `Aguardando Início em: ${etapaAtual}`;

  const cleanOrder = {
    ...order,
    etapas,
    etapaAtual,
    statusEtapa: status,
    status
  };

  orders[order.op_numero] = cleanOrder;
  localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(orders));
  try {
    const localUrl = getLocalServerUrl();
    fetch(`${localUrl}/api/ordens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ordens: [cleanOrder] })
    }).catch(() => {});
  } catch {}
  broadcastUpdate();
}

/**
 * Remove uma OP individual do sistema com sincronização definitiva no Firebase
 */
export async function deleteProductionOrder(opNumero: string): Promise<void> {
  ensureInitialData();
  const cleanInput = (opNumero || '').trim();
  if (!cleanInput) return;
  const normalizedSearch = cleanInput.replace(/^OP\s*/i, '').replace(/[-_\s]/g, '').toLowerCase();

  const orders = await fetchProductionOrders();
  let foundKey: string | undefined;
  for (const k of Object.keys(orders)) {
    const normK = k.trim().replace(/^OP\s*/i, '').replace(/[-_\s]/g, '').toLowerCase();
    if (normK === normalizedSearch || k === cleanInput) {
      foundKey = k;
      break;
    }
  }

  if (foundKey && orders[foundKey]) {
    delete orders[foundKey];
  }
  if (orders[cleanInput]) {
    delete orders[cleanInput];
  }
  localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(orders));

  try {
    const localUrl = getLocalServerUrl();
    fetch(`${localUrl}/api/ordens/${cleanOpId(cleanInput)}`, {
      method: 'DELETE'
    }).catch(() => {});
  } catch {}
  broadcastUpdate();
}

/**
 * Atualiza campos de uma OP existente (ex: status_fabrica, favorita, pausada)
 */
export async function updateProductionOrder(
  opNumero: string,
  updates: Partial<ProductionOrder>
): Promise<ProductionOrder | null> {
  ensureInitialData();
  const orders = await fetchProductionOrders();
  let targetKey = opNumero;
  if (!orders[targetKey]) {
    const foundKey = Object.keys(orders).find(
      k => k.replace(/[-_\s]/g, '').replace(/^OP/i, '') === opNumero.replace(/[-_\s]/g, '').replace(/^OP/i, '')
    );
    if (foundKey) targetKey = foundKey;
  }

  if (!orders[targetKey]) return null;

  const updated: ProductionOrder = {
    ...orders[targetKey],
    ...updates
  };

  // Se requer_laser ou requerLaser foi alterado, sincroniza propriedades e recalcula a rota oficial da OP
  const hasLaserUpdate = updates.requer_laser !== undefined || (updates as any).requerLaser !== undefined;
  if (hasLaserUpdate) {
    const isLaser = Boolean(updates.requer_laser !== undefined ? updates.requer_laser : (updates as any).requerLaser);
    updated.requer_laser = isLaser;
    (updated as any).requerLaser = isLaser;
    const { steps } = getRouteForOp(updated);
    updated.rota = steps;
  }

  orders[targetKey] = updated;
  localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(orders));

  // Sincronização assíncrona com API local Express/SQLite via PUT /api/ordens/:id e /api/ordens/update-laser
  try {
    const cleanId = cleanOpId(targetKey);
    const localUrl = getLocalServerUrl();
    const bodyPayload: any = {
      status: updated.status,
      etapas: updated.etapas
    };
    if (hasLaserUpdate) {
      bodyPayload.requerLaser = Boolean(updated.requer_laser);
      bodyPayload.requer_laser = Boolean(updated.requer_laser);
    }
    fetch(`${localUrl}/api/ordens/${cleanId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    }).catch(() => {});

    if (hasLaserUpdate) {
      const laserPayload = {
        requerLaser: Boolean(updated.requer_laser),
        requer_laser: Boolean(updated.requer_laser)
      };

      // Endpoint REST: /api/ordens/:identificador/laser
      fetch(`${localUrl}/api/ordens/${encodeURIComponent(cleanId)}/laser`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(laserPayload)
      }).catch(() => {});

      // Fallback para /api/ordens/update-laser
      fetch(`${localUrl}/api/ordens/update-laser`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: cleanId,
          opNumero: targetKey,
          ...laserPayload
        })
      }).catch(() => {});
    }
  } catch {}

  broadcastUpdate();
  return updated;
}

/**
 * Adiciona uma mensagem/recado à conversa de uma OP
 */
export async function addOpMessage(
  opNumero: string,
  message: { autor: string; texto: string; papel?: string }
): Promise<void> {
  ensureInitialData();
  const orders = await fetchProductionOrders();
  let targetKey = opNumero;
  if (!orders[targetKey]) {
    const foundKey = Object.keys(orders).find(
      k => k.replace(/[-_\s]/g, '').replace(/^OP/i, '') === opNumero.replace(/[-_\s]/g, '').replace(/^OP/i, '')
    );
    if (foundKey) targetKey = foundKey;
  }

  if (!orders[targetKey]) return;

  const currentOp = orders[targetKey];
  const nowStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const newMsg = {
    id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    autor: message.autor,
    papel: message.papel || 'Produção',
    texto: message.texto,
    data_hora: nowStr
  };

  const existingMsgs = currentOp.mensagens || [];
  currentOp.mensagens = [...existingMsgs, newMsg];
  currentOp.ultimo_aviso = {
    autor: `${message.autor}${message.papel ? ` (${message.papel})` : ''}`,
    texto: message.texto,
    data_hora: nowStr
  };

  orders[targetKey] = currentOp;
  localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(orders));
  
  broadcastUpdate();
}

/**
 * Retorna lista de ocorrências da OP ordenadas por data/hora (mais recentes primeiro).
 */
export function obterOcorrenciasDaOp(order?: ProductionOrder | null): OpOcorrencia[] {
  if (!order || !order.ocorrencias) return [];
  if (Array.isArray(order.ocorrencias)) {
    return [...order.ocorrencias].sort((a, b) => new Date(b.dataHora).getTime() - new Date(a.dataHora).getTime());
  }
  if (typeof order.ocorrencias === 'object') {
    return Object.values(order.ocorrencias).sort((a, b) => new Date(b.dataHora).getTime() - new Date(a.dataHora).getTime());
  }
  return [];
}

/**
 * Registra uma ocorrência / motivo de atraso na OP sem travar ou pausar a produção.
 * Grava no Firebase Realtime Database:
 * Caminho: ordens/${opId}/ocorrencias/${Date.now()}
 */
export async function addOpOccurrence(
  opNumero: string,
  occurrence: {
    operador?: string;
    posto?: string;
    terminal?: number | string;
    descricao: string;
  }
): Promise<OpOcorrencia> {
  const timestamp = Date.now().toString();
  const novaOcorrencia: OpOcorrencia = {
    id: timestamp,
    dataHora: new Date().toISOString(),
    operador: occurrence.operador || 'Não identificado',
    posto: occurrence.posto || 'Posto Geral',
    terminal: occurrence.terminal || 1,
    descricao: occurrence.descricao.trim()
  };

  const opId = opNumero.trim();
  const opKey = toFirebaseKey(opId);

  

  // 2. Atualiza LocalStorage para disponibilidade imediata na tela
  try {
    const raw = localStorage.getItem(STORAGE_ORDERS_KEY);
    if (raw) {
      const orders = JSON.parse(raw);
      const foundKey = Object.keys(orders).find(
        k => k === opId || toFirebaseKey(k) === opKey || k.replace(/[-_\s]/g, '').replace(/^OP/i, '') === opId.replace(/[-_\s]/g, '').replace(/^OP/i, '')
      );
      if (foundKey && orders[foundKey]) {
        if (!orders[foundKey].ocorrencias) orders[foundKey].ocorrencias = {};
        if (Array.isArray(orders[foundKey].ocorrencias)) {
          orders[foundKey].ocorrencias.push(novaOcorrencia);
        } else {
          orders[foundKey].ocorrencias[timestamp] = novaOcorrencia;
        }
        localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(orders));
      }
    }
  } catch (err) {
    console.warn('Erro ao atualizar ocorrência no LocalStorage:', err);
  }

  try {
    const localUrl = getLocalServerUrl();
    fetch(`${localUrl}/api/ordens/${cleanOpId(opNumero)}/ocorrencias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...novaOcorrencia, opNumero })
    }).catch(() => {});
  } catch {}

  broadcastUpdate();
  return novaOcorrencia;
}

/**
 * Limpa todas as OPs ou apenas as de teste
 */
export async function clearAllOrders(): Promise<void> {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify({}));
  localStorage.removeItem('pcp_orders');
  try {
    const localUrl = getLocalServerUrl();
    fetch(`${localUrl}/api/ordens`, { method: 'DELETE' }).catch(() => {});
  } catch {}
  broadcastUpdate();
}

export interface SaveMultipleOrdersResult {
  count: number;
  orders: Record<string, ProductionOrder>;
  valueOf(): number;
}

/**
 * Salva múltiplas OPs importadas em lote (ex: importação do Nomus HTML)
 * Implementa BLINDAGEM com Upsert Condicional no Firestore e Realtime Database:
 * 1. Se a OP não existir: cria com statusExecucao = 'pendente', apontamentos = {}, rota inicial padrão.
 * 2. Se a OP já existir: NUNCA sobrescreve com setDoc integral. Atualiza APENAS metadados do ERP
 *    (prazoEntrega, statusNomus, observacoesNomus, cliente, etc.) e PRESERVA OBRIGATORIAMENTE
 *    apontamentos, statusExecucao, pecas, requerLaser/requerRouter, operadores, iniciadoEm/concluidoEm, etc.
 */
export async function saveMultipleOrders(
  newOrders: ProductionOrder[],
  replaceAll: boolean = false
): Promise<SaveMultipleOrdersResult> {
  const currentOrders = await fetchProductionOrders();
  const orders: Record<string, ProductionOrder> = {};

  if (replaceAll) {
    // Modo "Substituir lista atual": Preserva OPs que já foram iniciadas na fábrica
    Object.entries(currentOrders).forEach(([k, o]) => {
      const isStarted = o.status === 'EM_PRODUCAO' || 
        o.statusExecucao === 'em_andamento' || 
        (o.apontamentos && Object.keys(o.apontamentos).length > 0) ||
        (Array.isArray(o.etapas) && o.etapas.some((e: any) => e && (e.concluidas > 0 || e.status === 'EM_PRODUCAO' || e.status === 'CONCLUIDO')));
      if (isStarted) {
        const cleanK = cleanOpId(k);
        orders[`OP ${cleanK}`] = o;
      }
    });
  } else {
    // Modo "Mesclar / Atualizar existentes": Mantém todas as OPs pré-existentes
    Object.entries(currentOrders).forEach(([k, o]) => {
      const cleanK = cleanOpId(k);
      orders[`OP ${cleanK}`] = o;
    });
  }

  let count = 0;
  const updates: Record<string, any> = {};

  for (const opImportada of newOrders) {
    const rawNum = String(
      (opImportada as any).numeroOp ||
      (opImportada as any).numeroOP ||
      opImportada.op_numero ||
      opImportada.numero ||
      (opImportada as any).id ||
      ''
    ).trim();

    const cleanNum = cleanOpId(rawNum);
    if (!cleanNum) continue;
    const formattedDocId = `OP ${cleanNum}`;

    // Normalização para busca em memória
    const normNumeroOp = cleanNum.toUpperCase();
    const existingOrderKey = Object.keys(orders).find((k) => {
      const normK = cleanOpId(k).toUpperCase();
      return normK === normNumeroOp;
    });
    const existingLocalOrder = existingOrderKey ? orders[existingOrderKey] : undefined;

    const isExisting = Boolean(existingLocalOrder);
    const qtd = obterQuantidadeTotal(opImportada);
    const rotaInfo = processarRotaProduto(opImportada);
    const rotasCalculadas = rotaInfo.rota && rotaInfo.rota.length > 0 ? rotaInfo.rota : obterEtapasDaRota(opImportada);
    const etapaInicial = rotasCalculadas[0] || 'Corte';
    const statusInicial = `Aguardando Início em: ${etapaInicial}`;
    const opKey = toFirebaseKey(formattedDocId);

    if (!isExisting) {
      // 2. Se a OP NÃO existir: crie o registro normalmente com os campos padrão da rota e status inicial
      const cleanNewOp: ProductionOrder = {
        ...opImportada,
        id: formattedDocId,
        op_numero: formattedDocId,
        numero: formattedDocId,
        numeroOP: formattedDocId,
        numeroOp: formattedDocId,
        quantidade_total: qtd,
        quantidade: qtd,
        familia: rotaInfo.familia,
        tipoMontagem: rotaInfo.tipoMontagem,
        rota: rotasCalculadas,
        statusAtual: rotaInfo.statusAtual || statusInicial,
        etapas: rotasCalculadas,
        etapaAtual: etapaInicial,
        statusEtapa: statusInicial,
        status: statusInicial,
        status_fabrica: opImportada.status_fabrica || 'Produzindo Hoje',
        statusExecucao: 'pendente',
        apontamentos: {},
        prazoEntrega: opImportada.prazoEntrega || opImportada.data_entrega || '',
        data_entrega: opImportada.data_entrega || opImportada.prazoEntrega || '',
        statusNomus: opImportada.statusNomus || opImportada.status_nomus || 'Liberada',
        status_nomus: opImportada.status_nomus || opImportada.statusNomus || 'Liberada',
        observacoes: opImportada.observacoes || opImportada.observacoesNomus || opImportada.observacao || '',
        observacoesNomus: opImportada.observacoesNomus || opImportada.observacoes || opImportada.observacao || '',
        observacao: opImportada.observacao || opImportada.observacoes || '',
        cliente: opImportada.cliente || 'Nomus ERP',
        criadoEm: new Date().toISOString(),
        data_criacao: new Date().toISOString(),
        importadoEm: new Date().toISOString()
      };

      const serializableNew = JSON.parse(JSON.stringify(cleanNewOp));
      updates[`ordens_producao/${opKey}`] = serializableNew;
      if (existingOrderKey && existingOrderKey !== formattedDocId) {
        delete orders[existingOrderKey];
      }
      orders[formattedDocId] = cleanNewOp;
      count++;
    } else {
      // 3. Se a OP JÁ existir:
      // - NUNCA substitua o objeto completo no banco (merge: true).
      // - Atualize APENAS os metadados vindos do ERP (prazoEntrega, observacoesNomus, statusNomus, cliente).
      // - PRESERVE OBRIGATORIAMENTE apontamentos, pecas, statusExecucao, operadores, etc.
      const dadosAtuais: any = existingLocalOrder;

      const prazoEntregaVal = opImportada.prazoEntrega || opImportada.data_entrega || dadosAtuais.prazoEntrega || dadosAtuais.data_entrega || '';
      const statusNomusVal = opImportada.statusNomus || opImportada.status_nomus || dadosAtuais.statusNomus || dadosAtuais.status_nomus || 'Liberada';
      const observacoesVal = opImportada.observacoes || opImportada.observacoesNomus || opImportada.observacao || dadosAtuais.observacoes || dadosAtuais.observacoesNomus || dadosAtuais.observacao || '';
      const clienteVal = opImportada.cliente || dadosAtuais.cliente || 'Nomus ERP';

      const metadadosParaAtualizar: Record<string, any> = {
        prazoEntrega: prazoEntregaVal,
        data_entrega: prazoEntregaVal,
        statusNomus: statusNomusVal,
        status_nomus: statusNomusVal,
        observacoes: observacoesVal,
        observacoesNomus: observacoesVal,
        observacao: observacoesVal,
        cliente: clienteVal,
        atualizadoPeloPcpEm: new Date().toISOString()
      };

      if (opImportada.descricao && !dadosAtuais.descricao) metadadosParaAtualizar.descricao = opImportada.descricao;
      if (opImportada.codigo && !dadosAtuais.codigo) metadadosParaAtualizar.codigo = opImportada.codigo;
      if (opImportada.codigoProduto && !dadosAtuais.codigoProduto) metadadosParaAtualizar.codigoProduto = opImportada.codigoProduto;
      if (opImportada.lote && (!dadosAtuais.lote || dadosAtuais.lote === '—')) metadadosParaAtualizar.lote = opImportada.lote;

      const semApontamentos = !dadosAtuais.apontamentos || Object.keys(dadosAtuais.apontamentos).length === 0;
      let etapasFinais = dadosAtuais.etapas || rotasCalculadas;
      let etapaAtualFinal = dadosAtuais.etapaAtual || etapaInicial;
      let statusEtapaFinal = dadosAtuais.statusEtapa || `Aguardando Início em: ${etapaAtualFinal}`;

      const codRawChecagem = String(opImportada.codigo || dadosAtuais.codigo || (opImportada as any).codigoProduto || (dadosAtuais as any).codigoProduto || '').trim();
      const codChecagem = codRawChecagem.replace(/[^0-9]/g, '');
      const descChecagem = String(opImportada.descricao || dadosAtuais.descricao || '').toUpperCase();
      const ehGiro = descChecagem.includes('PT GIR') || descChecagem.includes('GIRAT') || descChecagem.includes('GIRO') || codChecagem.startsWith('001') || codChecagem.startsWith('002') || codChecagem.startsWith('003') || codChecagem.startsWith('004');
      const ehGiroPadrao = Boolean(
        (codRawChecagem && (CODIGOS_PORTAS_GIRO_PADRAO.has(codRawChecagem) || CODIGOS_GIRATORIA_PADRAO.has(codRawChecagem))) ||
        (codChecagem && (CODIGOS_PORTAS_GIRO_PADRAO.has(codChecagem) || CODIGOS_GIRATORIA_PADRAO.has(codChecagem)))
      );

      if (ehGiro && ehGiroPadrao && semApontamentos) {
        etapasFinais = [
          'Instalação de Gaxeta',
          'Montagem de Portas Giratórias'
        ];
        etapaAtualFinal = 'Instalação de Gaxeta';
        statusEtapaFinal = 'Aguardando Início em: Instalação de Gaxeta';
        metadadosParaAtualizar.etapas = etapasFinais;
        metadadosParaAtualizar.etapaAtual = etapaAtualFinal;
        metadadosParaAtualizar.statusEtapa = statusEtapaFinal;
        metadadosParaAtualizar.status = statusEtapaFinal;
        metadadosParaAtualizar.rota = etapasFinais;
        metadadosParaAtualizar.familia = 'Porta Giratória Padrão';
        metadadosParaAtualizar.tipoMontagem = 'Porta Giratória Padrão';
        metadadosParaAtualizar.statusAtual = 'AGUARDANDO INÍCIO EM: Instalação de Gaxeta';
      } else if (ehGiro && !ehGiroPadrao && semApontamentos) {
        etapasFinais = [
          'Corte',
          'Dobra',
          'Preparação de Folha',
          'Injeção',
          'Instalação de Gaxeta',
          'Montagem de Portas Giratória Padrão e Especial'
        ];
        etapaAtualFinal = 'Corte';
        statusEtapaFinal = 'Aguardando Início em: Corte';
        metadadosParaAtualizar.etapas = etapasFinais;
        metadadosParaAtualizar.etapaAtual = etapaAtualFinal;
        metadadosParaAtualizar.statusEtapa = statusEtapaFinal;
        metadadosParaAtualizar.status = statusEtapaFinal;
        metadadosParaAtualizar.rota = etapasFinais;
        metadadosParaAtualizar.familia = 'Porta Giratória Especial';
        metadadosParaAtualizar.tipoMontagem = 'Porta Giratória Especial';
        metadadosParaAtualizar.statusAtual = 'AGUARDANDO INÍCIO EM: Corte';
      }

      const ehCorrer =
        descChecagem.includes('PT COR') ||
        descChecagem.includes('PORTA CORRER') ||
        descChecagem.includes('PORTA DE CORRER') ||
        descChecagem.includes('CORRER') ||
        descChecagem.includes('EMENDAD') ||
        codChecagem.startsWith('005') ||
        codChecagem.startsWith('006') ||
        codChecagem.startsWith('007') ||
        codChecagem.startsWith('008') ||
        codChecagem.startsWith('029') ||
        codChecagem.startsWith('025');

      const ehCorrerPadrao =
        (isPortaCorrerPadrao(codRawChecagem || codChecagem, descChecagem) ||
          Boolean(
            (codRawChecagem && (CODIGOS_PORTAS_CORRER_PADRAO.has(codRawChecagem) || CODIGOS_PADRAO_CORRER.has(codRawChecagem))) ||
            (codChecagem && (CODIGOS_PORTAS_CORRER_PADRAO.has(codChecagem) || CODIGOS_PADRAO_CORRER.has(codChecagem)))
          )) &&
        !descChecagem.includes('EMENDAD') &&
        !descChecagem.includes('EMENDA') &&
        !descChecagem.includes('INOX') &&
        !descChecagem.includes('I304') &&
        !descChecagem.includes('I430') &&
        !descChecagem.includes('ESPECIAL') &&
        !descChecagem.includes('ESP') &&
        !codChecagem.startsWith('006') &&
        !codChecagem.startsWith('008') &&
        !codChecagem.startsWith('029') &&
        !codChecagem.startsWith('025');

      if (ehCorrer && ehCorrerPadrao && semApontamentos) {
        const totalQtd = dadosAtuais.quantidadeFisica || dadosAtuais.quantidade || 1;
        etapasFinais = [
          {
            nome: 'Montagem Portas de Correr Padrão e Especial',
            ordem: 1,
            status: 'pendente',
            quantidadeProduzida: 0,
            total: totalQtd
          }
        ];
        etapaAtualFinal = 'Montagem Portas de Correr Padrão e Especial';
        statusEtapaFinal = 'Aguardando Início em: Montagem Portas de Correr Padrão e Especial';
        metadadosParaAtualizar.etapas = etapasFinais;
        metadadosParaAtualizar.etapaAtual = etapaAtualFinal;
        metadadosParaAtualizar.statusEtapa = statusEtapaFinal;
        metadadosParaAtualizar.status = statusEtapaFinal;
        metadadosParaAtualizar.rota = ['Montagem Portas de Correr Padrão e Especial'];
        metadadosParaAtualizar.tipoOrdem = 'Porta de Correr Padrão (Montagem Final)';
        metadadosParaAtualizar.familia = 'Porta de Correr Padrão';
        metadadosParaAtualizar.tipoMontagem = 'Porta de Correr Padrão';
        metadadosParaAtualizar.statusAtual = 'AGUARDANDO INÍCIO EM: Montagem Portas de Correr Padrão e Especial';
      } else if (ehCorrer && !ehCorrerPadrao && semApontamentos) {
        etapasFinais = [
          'Corte',
          'Dobra',
          'Preparação de Folha',
          'Injeção',
          'Montagem Portas de Correr Padrão e Especial'
        ];
        etapaAtualFinal = 'Corte';
        statusEtapaFinal = 'Aguardando Início em: Corte';
        metadadosParaAtualizar.etapas = etapasFinais;
        metadadosParaAtualizar.etapaAtual = etapaAtualFinal;
        metadadosParaAtualizar.statusEtapa = statusEtapaFinal;
        metadadosParaAtualizar.status = statusEtapaFinal;
        metadadosParaAtualizar.rota = etapasFinais;
        metadadosParaAtualizar.tipoOrdem = 'Especial Sob Medida (Fabricação Completa)';
        metadadosParaAtualizar.familia = 'Porta de Correr Especial';
        metadadosParaAtualizar.tipoMontagem = 'Porta de Correr Especial';
        metadadosParaAtualizar.statusAtual = 'AGUARDANDO INÍCIO EM: Corte';
      } else if (ehCorrer) {
        metadadosParaAtualizar.tipoOrdem = ehCorrerPadrao
          ? 'Porta de Correr Padrão (Montagem Final)'
          : 'Especial Sob Medida (Fabricação Completa)';
        metadadosParaAtualizar.familia = ehCorrerPadrao ? 'Porta de Correr Padrão' : 'Porta de Correr Especial';
        metadadosParaAtualizar.tipoMontagem = ehCorrerPadrao ? 'Porta de Correr Padrão' : 'Porta de Correr Especial';
      }

      // Preservação mandatória dos dados de chão de fábrica para Realtime Database e memória
      const opPreservada: ProductionOrder = {
        ...dadosAtuais,
        ...metadadosParaAtualizar,
        apontamentos: dadosAtuais.apontamentos ?? {},
        statusExecucao: dadosAtuais.statusExecucao || dadosAtuais.status || 'pendente',
        status: dadosAtuais.status || 'EM_PRODUCAO',
        status_fabrica: dadosAtuais.status_fabrica || 'Produzindo Hoje',
        statusEtapa: statusEtapaFinal,
        etapaAtual: etapaAtualFinal,
        etapas: etapasFinais,
        pecas: dadosAtuais.pecas !== undefined ? dadosAtuais.pecas : undefined,
        requerLaser: dadosAtuais.requerLaser !== undefined ? dadosAtuais.requerLaser : dadosAtuais.requer_laser,
        requer_laser: dadosAtuais.requer_laser !== undefined ? dadosAtuais.requer_laser : dadosAtuais.requerLaser,
        requerRouter: dadosAtuais.requerRouter !== undefined ? dadosAtuais.requerRouter : dadosAtuais.requer_router,
        requer_router: dadosAtuais.requer_router !== undefined ? dadosAtuais.requer_router : dadosAtuais.requerRouter,
        encaminhar_router: dadosAtuais.encaminhar_router !== undefined ? dadosAtuais.encaminhar_router : (dadosAtuais.requerRouter || dadosAtuais.requer_router),
        requer_solda: dadosAtuais.requer_solda,
        operadores: dadosAtuais.operadores,
        operadorAtual: dadosAtuais.operadorAtual,
        colaboradorIniciou: dadosAtuais.colaboradorIniciou,
        iniciadoEm: dadosAtuais.iniciadoEm || dadosAtuais.dataInicio,
        dataInicio: dadosAtuais.dataInicio || dadosAtuais.iniciadoEm,
        concluidoEm: dadosAtuais.concluidoEm || dadosAtuais.dataConclusao,
        dataConclusao: dadosAtuais.dataConclusao || dadosAtuais.concluidoEm,
        qtde_produzida: dadosAtuais.qtde_produzida !== undefined ? dadosAtuais.qtde_produzida : (opImportada.qtde_produzida || 0),
        progressoPostos: dadosAtuais.progressoPostos,
        mensagens: dadosAtuais.mensagens,
        ultimo_aviso: dadosAtuais.ultimo_aviso,
        criadoEm: dadosAtuais.criadoEm || dadosAtuais.data_criacao
      };

      const serializablePreserved = JSON.parse(JSON.stringify(opPreservada));
      updates[`ordens_producao/${opKey}`] = serializablePreserved;
      if (existingOrderKey && existingOrderKey !== formattedDocId) {
        delete orders[existingOrderKey];
      }
      orders[formattedDocId] = opPreservada;
      count++;
    }
  }

  localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(orders));

  // Sincroniza em background com a API local SQLite se online
  try {
    const localUrl = getLocalServerUrl();
    const ordensArray = Object.values(orders);
    fetch(`${localUrl}/api/ordens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ordens: ordensArray,
        replaceAll,
        modoImportacao: replaceAll ? 'substituir' : 'mesclar'
      })
    }).catch(() => {});
  } catch {}

  broadcastUpdate();
  return {
    count,
    orders,
    valueOf() {
      return this.count;
    }
  };
}

/**
 * Executa a deduplicação de ordens no SQLite e sincroniza a lista limpa
 */
export async function limparOrdensDuplicadas(): Promise<{ success: boolean; removidas: number; total: number }> {
  try {
    const localUrl = getLocalServerUrl();
    const res = await fetch(`${localUrl}/api/ordens/limpar-duplicadas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();

    // Atualiza armazenamento local com a lista limpa
    const orders = await fetchProductionOrders();
    localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(orders));
    broadcastUpdate();
    return data;
  } catch (err: any) {
    return { success: false, removidas: 0, total: 0 };
  }
}

/**
 * Reseta os dados de apontamento para os dados de fábrica padrão
 */
export function resetFactoryData(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify({}));
  localStorage.setItem(STORAGE_APONTAMENTOS_KEY, JSON.stringify({}));
  
  broadcastUpdate();
}

/**
 * Inscreve-se para mudanças em tempo real (mesmo de outros terminais/abas)
 */
export function subscribeToMesUpdates(callback: () => void): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

/**
 * Conclui uma etapa gravando o cálculo de duração líquida (descontando pausas programadas)
 */
export async function handleConcluirEtapa(
  op: any,
  etapaNome: string,
  colaboradorId?: string
) {
  const agora = Date.now();
  const inicioTimestamp = op.etapas?.[etapaNome]?.timestampInicio || op.etapas?.[etapaNome]?.inicio || agora;
  const inicioMs = typeof inicioTimestamp === 'string' ? new Date(inicioTimestamp).getTime() : Number(inicioTimestamp);
  const duracaoLiquidaMs = !isNaN(inicioMs) ? calcularDuracaoLiquidaMs(inicioMs, agora) : 0;
  const duracaoMinutos = Math.max(1, Math.round(duracaoLiquidaMs / 60000));

  const rawOpId = op.id || op.numero || op.op_numero || '';
  const opKey = String(rawOpId).replace(/^OP\s*/i, '').trim();

  const etapaAtualizada = {
    ...op.etapas?.[etapaNome],
    status: 'CONCLUIDO',
    concluidas: op.quantidade_total || op.quantidade || 1,
    timestampFim: agora,
    duracaoMs: duracaoLiquidaMs,
    duracaoMinutos: duracaoMinutos,
    duracaoFormatada: `${duracaoMinutos} min`,
    colaboradorFinalizou: colaboradorId || op.colaborador || op.operador || 'Operador'
  };

  const updates: Record<string, any> = {};
  updates[`ordens/${opKey}/etapas/${etapaNome}`] = etapaAtualizada;
  updates[`ordens_producao/${opKey}/etapas/${etapaNome}`] = etapaAtualizada;

  try {
    const localUrl = getLocalServerUrl();
    fetch(`${localUrl}/api/ordens/${cleanOpId(opKey)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ etapas: { [etapaNome]: etapaAtualizada } })
    }).catch(() => {});
  } catch {}

  broadcastUpdate();
  return etapaAtualizada;
}
