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
  OpOcorrencia
} from '../types/mes';
import { deducePhysicalUnitsFromM2, processarRotaProduto } from '../utils/nomusParser';
import { getRouteForOp, doesSectorMatchStep, matchStepName, initOrSyncOrderEtapas, obterQuantidadeTotal, obterEtapasDaRota, isEligibleForRouter } from '../utils/routeEngine';
import { db, firestore, doc, updateDoc, deleteDoc, arrayRemove, setDoc, getDoc, ref, set, get, onValue, update, push, writeBatch } from './firebase';

export { db, ref, set, get, onValue, update, push };

export function toFirebaseKey(key: string): string {
  return (key || '').trim().replace(/[.#$\[\]\/]/g, '_');
}

const STORAGE_ORDERS_KEY = 'mes_pcp_orders';
const STORAGE_APONTAMENTOS_KEY = 'mes_apontamentos';
const STORAGE_TERMINAL_KEY = 'mes_selected_terminal';
const STORAGE_FIREBASE_CONFIG_KEY = 'mes_firebase_config';
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

  // 1. Atualiza no Firestore (usando cliente autenticado do navegador)
  try {
    const cleanId = docId.trim();
    const firestoreRef = doc(firestore, 'ordens_producao', cleanId);
    updateDoc(firestoreRef, dadosParaAtualizar).catch(() => {
      const altId = cleanId.startsWith('OP ') ? cleanId.replace(/^OP\s*/i, '').trim() : `OP ${cleanId}`;
      updateDoc(doc(firestore, 'ordens_producao', altId), dadosParaAtualizar).catch(() => {});
    });
  } catch {}

  // 2. Atualiza no Realtime Database (em segundo plano sem travar render)
  try {
    const key = toFirebaseKey(docId);
    update(ref(db, `ordens_producao/${key}`), dadosParaAtualizar).catch(() => {});
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
    Boolean(
      (codRaw && (CODIGOS_PORTAS_CORRER_PADRAO.has(codRaw) || CODIGOS_PADRAO_CORRER.has(codRaw))) ||
      (codNormalizado && (CODIGOS_PORTAS_CORRER_PADRAO.has(codNormalizado) || CODIGOS_PADRAO_CORRER.has(codNormalizado)))
    ) &&
    !desc.includes('EMENDAD') &&
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
    const rotaAtual = Array.isArray(op.rota) && op.rota.length > 0 ? op.rota : (Array.isArray(op.etapas) ? op.etapas : []);
    const semApts = !op.apontamentos || Object.keys(op.apontamentos).length === 0;

    if (semApts && (rotaAtual.length > 1 || rotaAtual.includes('Corte') || op.familia === 'Porta de Correr Especial')) {
      const novaRota = ['Montagem Portas de Correr Padrão e Especial'];
      op.rota = novaRota;
      op.etapas = novaRota;
      op.familia = 'Porta de Correr Padrão';
      op.tipoMontagem = 'Porta de Correr Padrão';
      op.etapaAtual = 'Montagem Portas de Correr Padrão e Especial';
      op.statusEtapa = 'Aguardando Início em: Montagem Portas de Correr Padrão e Especial';
      op.status = 'Aguardando Início em: Montagem Portas de Correr Padrão e Especial';
      op.statusAtual = 'AGUARDANDO INÍCIO EM: Montagem Portas de Correr Padrão e Especial';

      if (docId) {
        persistirCorrecaoOp(docId, {
          rota: novaRota,
          etapas: novaRota,
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
      op.familia = 'Porta de Correr Especial';
      op.tipoMontagem = 'Porta de Correr Especial';

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
          familia: 'Porta de Correr Especial',
          tipoMontagem: 'Porta de Correr Especial',
          etapaAtual: op.etapaAtual,
          statusEtapa: op.statusEtapa,
          status: op.status,
          statusAtual: op.statusAtual
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

// Inicializa no carregamento
ensureInitialData();
startFirebaseBackgroundSync();
initFirebaseRealtimeListeners();

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
  firebasePut('config/operators', cleaned);
  try {
    const fbMap: Record<string, any> = {};
    cleaned.forEach((op) => {
      fbMap[op.id] = op;
    });
    set(ref(db, 'config_colaboradores'), fbMap);
    set(ref(db, 'config_operadores'), cleaned);
  } catch {}
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

  try {
    await update(ref(db, `config_colaboradores/${id}`), {
      id,
      name: nome,
      nome,
      badge,
      codigo: badge,
      role,
      setor: setores[0] || '',
      setores: [...setores],
      sectors: [...setores],
      setoresPorTerminal: payload.setoresPorTerminal || null,
      terminais: [...terminais],
      especialista,
      ativo: payload.ativo
    });
  } catch (err) {
    console.error(`[Firebase] Erro ao atualizar config_colaboradores/${id}:`, err);
  }
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
  firebasePut('config/terminals', cleaned);
  try {
    set(ref(db, 'config_terminais'), cleaned);
    set(ref(db, 'config_setores'), setoresMap);
    cleaned.forEach((term) => {
      set(ref(db, `configuracoes_terminais/${term.id}`), {
        id: String(term.id),
        nome: term.name,
        label: term.label,
        setores: term.sectors,
        sectors: term.sectors,
        atualizadoEm: new Date().toISOString()
      });
    });
  } catch (err) {
    console.error('[mesStorage] Erro ao sincronizar terminais/setores no Firebase:', err);
  }
  broadcastUpdate();
  window.dispatchEvent(new CustomEvent('metalrib_sectors_updated'));
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

  // 1. Salva nos armazenamentos locais e no Firebase RTDB (config_terminais, config_setores, configuracoes_terminais)
  saveTerminalsConfig(terminals);

  // 2. Garante persistência explícita e atômica no RTDB
  try {
    await set(ref(db, `configuracoes_terminais/${termIdStr}`), {
      id: termIdStr,
      nome: term.name,
      label: term.label,
      setores: term.sectors,
      sectors: term.sectors,
      atualizadoEm: new Date().toISOString()
    });
  } catch (rtdbErr) {
    console.warn('[mesStorage] Erro ao sincronizar configuracoes_terminais no RTDB:', rtdbErr);
  }

  // 3. Atualiza no Firebase Firestore se disponível
  try {
    const terminalRef = doc(firestore, 'configuracoes_terminais', termIdStr);
    await updateDoc(terminalRef, {
      setores: arrayRemove(clean),
      sectors: arrayRemove(clean),
      atualizadoEm: new Date().toISOString()
    });
  } catch (fsErr) {
    console.warn('[mesStorage] Firestore updateDoc em configuracoes_terminais (RTDB garantiu persistência):', fsErr);
  }

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

export interface FirebaseConnectionConfig {
  databaseURL: string;
  apiKey?: string;
  projectId?: string;
  enabled: boolean;
}

export function getSavedFirebaseConfig(): FirebaseConnectionConfig {
  const defaultConfig: FirebaseConnectionConfig = {
    databaseURL: 'https://apontamentoop-default-rtdb.firebaseio.com',
    apiKey: 'AIzaSyCF7Q6J8I6fBZ3kaGbxq4rlefVzFaQrUnA',
    projectId: 'apontamentoop',
    enabled: true
  };

  if (typeof window === 'undefined') {
    return defaultConfig;
  }
  try {
    const raw = localStorage.getItem(STORAGE_FIREBASE_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.databaseURL) return parsed;
    }
  } catch {
    // fallback
  }

  // Fallback para variáveis de ambiente VITE_
  const envUrl = (import.meta as any).env?.VITE_FIREBASE_DATABASE_URL || '';
  const envKey = (import.meta as any).env?.VITE_FIREBASE_API_KEY || '';
  const envProject = (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID || '';
  if (envUrl) {
    return {
      databaseURL: envUrl,
      apiKey: envKey || defaultConfig.apiKey,
      projectId: envProject || defaultConfig.projectId,
      enabled: true
    };
  }

  return defaultConfig;
}

let isFirebaseListenerInitialized = false;
export function initFirebaseRealtimeListeners(): void {
  if (typeof window === 'undefined' || isFirebaseListenerInitialized) return;
  isFirebaseListenerInitialized = true;

  try {
    const ordensRef = ref(db, 'ordens_producao');
    onValue(ordensRef, (snapshot) => {
      try {
        if (!snapshot.exists()) {
          // Nó ordens_producao vazio ou todas as OPs foram deletadas
          localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify({}));
          broadcastUpdate();
          return;
        }

        const ordersMap: Record<string, ProductionOrder> = {};
        snapshot.forEach((child) => {
          const item = child.val();
          if (item && typeof item === 'object') {
            const key = child.key || '';
            const opNumero = (item.op_numero || item.numeroOP || item.numero || item.id || key).trim();
            if (opNumero && !TEST_DUMMY_OPS.has(opNumero)) {
              const qtd = obterQuantidadeTotal(item);
              const syncedItem = initOrSyncOrderEtapas({
                ...item,
                op_numero: opNumero,
                numero: item.numero || opNumero,
                quantidade_total: qtd,
                quantidade: qtd
              });
              const correctedItem = verificarECorrigirRotaOp(syncedItem);
              ordersMap[opNumero] = correctedItem;
            }
          }
        });

        localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(ordersMap));
        broadcastUpdate();
      } catch (err) {
        console.error('[Firebase] Erro no listener de ordens_producao:', err);
      }
    });

    const aptsRef = ref(db, 'historico_apontamentos');
    onValue(aptsRef, (snapshot) => {
      try {
        if (!snapshot.exists()) {
          localStorage.setItem(STORAGE_APONTAMENTOS_KEY, JSON.stringify({}));
          broadcastUpdate();
          return;
        }

        const val = snapshot.val();
        if (val && typeof val === 'object') {
          const tree: Record<string, Record<string, Apontamento>> = {};

          Object.entries(val).forEach(([firebasePushKey, item]: [string, any]) => {
            if (item && item.op_numero) {
              const cleanOp = item.op_numero.trim().toUpperCase();
              if (!tree[cleanOp]) tree[cleanOp] = {};
              const aptId = item.id || firebasePushKey;
              const existing = tree[cleanOp][aptId];
              // Dá prioridade absoluta para status FINALIZADO sobre EM_ANDAMENTO
              if (!existing || item.status === 'FINALIZADO' || (item.hora_fim && !existing.hora_fim)) {
                tree[cleanOp][aptId] = { ...item, id: aptId, firebaseKey: firebasePushKey };
              }
            }
          });

          localStorage.setItem(STORAGE_APONTAMENTOS_KEY, JSON.stringify(tree));
          broadcastUpdate();
        }
      } catch (err) {
        console.error('[Firebase] Erro no listener de historico_apontamentos:', err);
      }
    });

    const colabRef = ref(db, 'config_colaboradores');
    onValue(colabRef, (snapshot) => {
      try {
        if (!snapshot.exists()) {
          // Nó ainda não existe no Firebase - NUNCA auto-seeda para não apagar edições
          return;
        }

        const val = snapshot.val();
        if (!val || (typeof val === 'object' && Object.keys(val).length === 0)) {
          return;
        }

        const list: Operator[] = Array.isArray(val)
          ? val.filter(Boolean)
          : Object.values(val || {});

        if (list.length > 0) {
          const rawLocal = localStorage.getItem(STORAGE_OPERATORS_KEY);
          const serialized = JSON.stringify(list);
          if (rawLocal !== serialized) {
            localStorage.setItem(STORAGE_OPERATORS_KEY, serialized);
            broadcastUpdate();
            window.dispatchEvent(new CustomEvent('metalrib_operators_updated'));
          }
        }
      } catch (err) {
        console.error('[Firebase] Erro no listener de config_colaboradores:', err);
      }
    });

    const termRef = ref(db, 'config_terminais');
    onValue(termRef, (snapshot) => {
      try {
        const val = snapshot.val();
        if (Array.isArray(val) && val.length > 0) {
          const { terminals: sanitized } = sanitizeTerminalSectors(val);
          const rawLocal = localStorage.getItem(STORAGE_TERMINALS_KEY);
          const serialized = JSON.stringify(sanitized);
          if (rawLocal !== serialized) {
            localStorage.setItem(STORAGE_TERMINALS_KEY, serialized);
            const setoresMap = buildSetoresMap(sanitized);
            localStorage.setItem('metalrib_setores_por_terminal', JSON.stringify(setoresMap));
            broadcastUpdate();
            window.dispatchEvent(new CustomEvent('metalrib_sectors_updated'));
          }
        }
      } catch (err) {
        console.error('[Firebase] Erro no listener de config_terminais:', err);
      }
    });

    const cfgTermRef = ref(db, 'configuracoes_terminais');
    onValue(cfgTermRef, (snapshot) => {
      try {
        const val = snapshot.val();
        if (val && typeof val === 'object') {
          const currentTerms = fetchTerminalsConfig();
          let changed = false;
          const updated = currentTerms.map((t) => {
            const termData = val[t.id] || val[String(t.id)];
            if (termData) {
              const secs = Array.isArray(termData.setores)
                ? termData.setores
                : Array.isArray(termData.sectors)
                ? termData.sectors
                : null;
              if (secs && JSON.stringify(t.sectors) !== JSON.stringify(secs)) {
                changed = true;
                return { ...t, sectors: [...secs], setores: [...secs] };
              }
            }
            return t;
          });
          if (changed) {
            const { terminals: sanitized } = sanitizeTerminalSectors(updated);
            localStorage.setItem(STORAGE_TERMINALS_KEY, JSON.stringify(sanitized));
            const newSetoresMap = buildSetoresMap(sanitized);
            localStorage.setItem('metalrib_setores_por_terminal', JSON.stringify(newSetoresMap));
            broadcastUpdate();
            window.dispatchEvent(new CustomEvent('metalrib_sectors_updated'));
          }
        }
      } catch (err) {
        console.error('[Firebase] Erro no listener de configuracoes_terminais:', err);
      }
    });
  } catch (err) {
    console.warn('[Firebase] Não foi possível iniciar listeners em tempo real:', err);
  }
}

export function saveFirebaseConfig(config: FirebaseConnectionConfig) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_FIREBASE_CONFIG_KEY, JSON.stringify(config));
  broadcastUpdate();
}

/**
 * Funções utilitárias de comunicação REST com Firebase Realtime Database
 */
function getFirebaseUrl(path: string): string | null {
  const cfg = getSavedFirebaseConfig();
  if (!cfg.enabled || !cfg.databaseURL) return null;
  let base = cfg.databaseURL.trim().replace(/\/+$/, '');
  if (!base.startsWith('http://') && !base.startsWith('https://')) {
    base = `https://${base}`;
  }
  const cleanPath = path.replace(/^\/+/, '');
  const authQuery = cfg.apiKey ? `?auth=${encodeURIComponent(cfg.apiKey.trim())}` : '';
  return `${base}/${cleanPath}.json${authQuery}`;
}

let bgSyncTimer: any = null;
export function startFirebaseBackgroundSync(): void {
  // Sincronização em tempo real é gerenciada diretamente pelos listeners nativos WebSocket do Firebase Realtime DB
  // (initFirebaseRealtimeListeners). O polling REST legado de 'pcp/orders' foi desativado para eliminar qualquer risco
  // de sobreposição assíncrona ou perda de ordens.
}

export async function firebaseGet<T>(path: string): Promise<T | null> {
  const url = getFirebaseUrl(path);
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn(`[Firebase] Falha ao ler ${path}:`, err);
    return null;
  }
}

export async function firebasePut(path: string, data: any): Promise<boolean> {
  const url = getFirebaseUrl(path);
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.ok;
  } catch (err) {
    console.warn(`[Firebase] Falha ao gravar ${path}:`, err);
    return false;
  }
}

export async function firebasePatch(path: string, data: any): Promise<boolean> {
  const url = getFirebaseUrl(path);
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.ok;
  } catch (err) {
    console.warn(`[Firebase] Falha ao atualizar ${path}:`, err);
    return false;
  }
}

export async function firebaseDelete(path: string): Promise<boolean> {
  const url = getFirebaseUrl(path);
  if (!url) return false;
  try {
    const res = await fetch(url, { method: 'DELETE' });
    return res.ok;
  } catch (err) {
    console.warn(`[Firebase] Falha ao deletar ${path}:`, err);
    return false;
  }
}

/**
 * Salva e recupera o Terminal Físico ativo para este computador
 */
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
    const snapshot = await get(ref(db, 'ordens_producao'));
    if (snapshot.exists()) {
      const ordersMap: Record<string, ProductionOrder> = {};
      snapshot.forEach((child) => {
        const item = child.val();
        if (item && typeof item === 'object') {
          const key = child.key || '';
          const opNumero = (item.op_numero || item.numeroOP || item.numero || item.id || key).trim();
          if (opNumero && !TEST_DUMMY_OPS.has(opNumero)) {
            const qtd = obterQuantidadeTotal(item);
            const syncedItem = initOrSyncOrderEtapas({
              ...item,
              op_numero: opNumero,
              numero: item.numero || opNumero,
              quantidade_total: qtd,
              quantidade: qtd
            });
            const correctedItem = verificarECorrigirRotaOp(syncedItem);
            ordersMap[opNumero] = correctedItem;
          }
        }
      });
      localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(ordersMap));
      return ordersMap;
    } else {
      localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify({}));
      return {};
    }
  } catch (err) {
    console.warn('[Firebase] Falha na leitura de ordens_producao, usando cache local:', err);
  }

  const raw = localStorage.getItem(STORAGE_ORDERS_KEY);
  if (!raw || raw === '{}') return {};
  try {
    const orders: Record<string, ProductionOrder> = JSON.parse(raw);
    let modified = false;
    for (const key of Object.keys(orders)) {
      if (TEST_DUMMY_OPS.has(key)) {
        delete orders[key];
        modified = true;
        continue;
      }
      const o = orders[key];
      if (o) {
        orders[key] = verificarECorrigirRotaOp(o);
        const qtd = obterQuantidadeTotal(o);
        if (o.quantidade_total !== qtd || o.quantidade !== qtd) {
          o.quantidade_total = qtd;
          o.quantidade = qtd;
          modified = true;
        }
      }
      if (o && typeof o.quantidade_total === 'number') {
        const isDecimal = Math.abs(o.quantidade_total - Math.round(o.quantidade_total)) > 0.001;
        if (isDecimal) {
          o.quantidade_m2 = o.quantidade_m2 || Number(o.quantidade_total.toFixed(2));
          o.unidade_medida = 'M²';
          o.quantidade_total = deducePhysicalUnitsFromM2(o.descricao || '', o.quantidade_total);
          o.quantidade = o.quantidade_total;
          modified = true;
        }
      }
      if (o) {
        const synced = initOrSyncOrderEtapas(o);
        if (JSON.stringify(synced.etapas) !== JSON.stringify(o.etapas)) {
          o.etapas = synced.etapas;
          modified = true;
        }
      }
    }
    if (modified) {
      localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(orders));
    }
    return orders;
  } catch {
    return {};
  }
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
    const snapshot = await get(ref(db, 'historico_apontamentos'));
    if (snapshot.exists()) {
      const val = snapshot.val();
      if (val && typeof val === 'object') {
        const tree: Record<string, Record<string, Apontamento>> = {};
        Object.entries(val).forEach(([firebasePushKey, item]: [string, any]) => {
          if (item && item.op_numero) {
            const cleanOp = item.op_numero.trim().toUpperCase();
            if (!tree[cleanOp]) tree[cleanOp] = {};
            const aptId = item.id || firebasePushKey;
            const existing = tree[cleanOp][aptId];
            if (!existing || item.status === 'FINALIZADO' || (item.hora_fim && !existing.hora_fim)) {
              tree[cleanOp][aptId] = { ...item, id: aptId, firebaseKey: firebasePushKey };
            }
          }
        });
        localStorage.setItem(STORAGE_APONTAMENTOS_KEY, JSON.stringify(tree));
      }
    } else {
      localStorage.setItem(STORAGE_APONTAMENTOS_KEY, JSON.stringify({}));
    }
  } catch (err) {
    console.warn('[Firebase] Falha na leitura de apontamentos, usando cache:', err);
  }

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

  // Ordena por hora de início decrescente
  return list.sort((a, b) => new Date(b.hora_inicio).getTime() - new Date(a.hora_inicio).getTime());
}

/**
 * Inicia uma unidade de produção para a OP e Setor selecionados
 * Guarda sob a árvore de apontamentos/<op_numero>/<id_unico>
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
  firebasePut(`apontamentos/${cleanOp}/${uniqueId}`, novoApontamento);
  try {
    const aptKey = toFirebaseKey(uniqueId);
    await set(ref(db, `historico_apontamentos/${aptKey}`), novoApontamento);
  } catch (err) {
    console.warn('[Firebase] Erro ao gravar historico_apontamentos:', err);
  }

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
      if (!targetOrder.etapas) {
        targetOrder.etapas = {};
      }
      steps.forEach((s) => {
        if (!targetOrder.etapas![s]) {
          targetOrder.etapas![s] = { status: 'PENDENTE', concluidas: 0 };
        }
      });
      const matchedStepKey = steps.find(s => matchStepName(s, params.etapa_rota) || doesSectorMatchStep(params.setor, s)) || params.etapa_rota;
      targetOrder.etapas[matchedStepKey] = {
        ...targetOrder.etapas[matchedStepKey],
        status: 'EM_PRODUCAO',
        concluidas: targetOrder.etapas[matchedStepKey]?.concluidas || 0,
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
      opUpdates[`etapas/${toFirebaseKey(matchedStepKey)}/status`] = 'EM_PRODUCAO';
      opUpdates[`etapas/${toFirebaseKey(matchedStepKey)}/inicio`] = nowIso;
      opUpdates[`etapas/${toFirebaseKey(matchedStepKey)}/operadorNome`] = params.operador;

      ordersMap[matchedOpKey] = targetOrder;
      localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(ordersMap));
    }

    if (opKey) {
      await update(ref(db, `ordens_producao/${opKey}`), opUpdates);
    }
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
  const diffMinutes = Math.max(0.1, Number(((now.getTime() - start.getTime()) / 60000).toFixed(1)));
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
    status: 'FINALIZADO'
  };

  tree[cleanOp][apontamentoId] = updated;
  localStorage.setItem(STORAGE_APONTAMENTOS_KEY, JSON.stringify(tree));
  firebasePut(`apontamentos/${cleanOp}/${apontamentoId}`, updated);
  try {
    const aptKey = toFirebaseKey(apontamentoId);
    await set(ref(db, `historico_apontamentos/${aptKey}`), updated);
  } catch (err) {
    console.warn('[Firebase] Erro ao gravar historico_apontamentos:', err);
  }

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
            status: 'CONCLUIDO',
            concluidas: totalUnits
          };
          if (!targetOrder.progressoPostos) targetOrder.progressoPostos = {};
          targetOrder.progressoPostos[matchedStep] = {
            concluido: true,
            concluidas: totalUnits,
            dataConclusao: new Date().toISOString()
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

        const opKey = toFirebaseKey(targetOrder.op_numero || targetOrder.numero || matchedOpKey);
        if (opKey) {
          await update(ref(db, `ordens_producao/${opKey}`), {
            status: targetOrder.status,
            status_fabrica: targetOrder.status_fabrica,
            etapas: targetOrder.etapas,
            progressoPostos: targetOrder.progressoPostos,
            etapaAtual: targetOrder.etapaAtual,
            statusEtapa: targetOrder.statusEtapa,
            encaminhar_router: targetOrder.encaminhar_router ?? false,
            requer_router: targetOrder.requer_router ?? false,
            qtde_produzida: targetOrder.qtde_produzida || 0,
            data_atualizacao: new Date().toISOString()
          });
        }
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
  firebasePut(`apontamentos/${cleanOp}/${uniqueId}`, novoApontamento);
  try {
    const aptKey = toFirebaseKey(uniqueId);
    await set(ref(db, `historico_apontamentos/${aptKey}`), novoApontamento);
  } catch (err) {
    console.warn('[Firebase] Erro ao gravar historico_apontamentos:', err);
  }

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
      if (!targetOrder.etapas) {
        targetOrder.etapas = {};
      }
      steps.forEach((s) => {
        if (!targetOrder.etapas![s]) {
          targetOrder.etapas![s] = { status: 'PENDENTE', concluidas: 0 };
        }
      });
      const matchedStepKey = steps.find(s => matchStepName(s, params.etapa_rota) || doesSectorMatchStep(params.setor, s)) || params.etapa_rota;
      targetOrder.etapas[matchedStepKey] = {
        ...targetOrder.etapas[matchedStepKey],
        status: 'EM_PRODUCAO',
        concluidas: targetOrder.etapas[matchedStepKey]?.concluidas || 0,
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
      opUpdates[`etapas/${toFirebaseKey(matchedStepKey)}/status`] = 'EM_PRODUCAO';
      opUpdates[`etapas/${toFirebaseKey(matchedStepKey)}/inicio`] = nowIso;
      opUpdates[`etapas/${toFirebaseKey(matchedStepKey)}/operadorNome`] = params.operador;

      ordersMap[matchedOpKey] = targetOrder;
      localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(ordersMap));
    }

    if (opKey) {
      await update(ref(db, `ordens_producao/${opKey}`), opUpdates);
    }
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
  const diffMinutes = Math.max(0.1, Number(((now.getTime() - start.getTime()) / 60000).toFixed(1)));
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
  firebasePut(`apontamentos/${cleanOp}/${apontamentoId}`, updated);
  try {
    const aptKey = toFirebaseKey(apontamentoId);
    await set(ref(db, `historico_apontamentos/${aptKey}`), updated);
  } catch (err) {
    console.warn('[Firebase] Erro ao gravar historico_apontamentos:', err);
  }
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
          status: 'CONCLUIDO',
          concluidas: totalUnits
        };
        if (!targetOrder.progressoPostos) targetOrder.progressoPostos = {};
        targetOrder.progressoPostos[matchedStep] = {
          concluido: true,
          concluidas: totalUnits,
          dataConclusao: new Date().toISOString()
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

        const opKey = toFirebaseKey(targetOrder.op_numero || targetOrder.numero || matchedOpKey);
        if (opKey) {
          await update(ref(db, `ordens_producao/${opKey}`), {
            status: targetOrder.status,
            status_fabrica: targetOrder.status_fabrica,
            etapas: targetOrder.etapas,
            progressoPostos: targetOrder.progressoPostos,
            etapaAtual: targetOrder.etapaAtual,
            statusEtapa: targetOrder.statusEtapa,
            encaminhar_router: targetOrder.encaminhar_router ?? false,
            requer_router: targetOrder.requer_router ?? false,
            qtde_produzida: targetOrder.qtde_produzida || 0,
            data_atualizacao: new Date().toISOString()
          });
        }
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
    if (opNumero) {
      const cleanOp = opNumero.trim().toUpperCase();
      firebaseDelete(`apontamentos/${cleanOp}/${apontamentoId}`);
    } else {
      firebasePut('apontamentos', tree);
    }
    try {
      const aptKey = toFirebaseKey(apontamentoId);
      await set(ref(db, `historico_apontamentos/${aptKey}`), null);
      if (fbKey && fbKey !== aptKey) {
        await set(ref(db, `historico_apontamentos/${fbKey}`), null);
      }
    } catch (err) {
      console.warn('[Firebase] Erro ao deletar historico_apontamentos:', err);
    }
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
  const cleanOp = opNumero.trim().toUpperCase();

  // 1. Localiza e remove apontamentos EM_ANDAMENTO deste posto
  const rawApts = localStorage.getItem(STORAGE_APONTAMENTOS_KEY);
  let tree: Record<string, Record<string, Apontamento>> = {};
  if (rawApts) {
    try {
      tree = JSON.parse(rawApts);
    } catch {
      tree = {};
    }
  }

  const opTree = tree[cleanOp] || {};
  const aptsParaRemover: string[] = [];

  for (const [id, a] of Object.entries(opTree)) {
    if (a.status === 'EM_ANDAMENTO') {
      const matchId = apontamentoId ? a.id === apontamentoId : true;
      const matchSetor =
        matchStepName(a.etapa_rota || a.etapaRota || '', setorOuEtapa) ||
        doesSectorMatchStep(a.setorFisico || a.setor || '', setorOuEtapa) ||
        (a.setor && a.setor.toLowerCase().trim() === setorOuEtapa.toLowerCase().trim()) ||
        (a.etapa_rota && a.etapa_rota.toLowerCase().trim() === setorOuEtapa.toLowerCase().trim());

      if (matchId && matchSetor) {
        aptsParaRemover.push(id);
      }
    }
  }

  // Se nenhum apontamento coincidiu exatamente pelo setor, mas um ID específico foi fornecido
  if (aptsParaRemover.length === 0 && apontamentoId && opTree[apontamentoId]) {
    aptsParaRemover.push(apontamentoId);
  }

  // Se ainda assim não encontrou pelo cleanOp, procura em todas as chaves
  if (aptsParaRemover.length === 0 && apontamentoId) {
    for (const k of Object.keys(tree)) {
      if (tree[k] && tree[k][apontamentoId]) {
        delete tree[k][apontamentoId];
        try {
          const aptKey = toFirebaseKey(apontamentoId);
          await set(ref(db, `historico_apontamentos/${aptKey}`), null);
          firebaseDelete(`apontamentos/${k}/${apontamentoId}`);
        } catch {}
      }
    }
  }

  // Remove os apontamentos identificados
  for (const id of aptsParaRemover) {
    delete opTree[id];
    try {
      const aptKey = toFirebaseKey(id);
      await set(ref(db, `historico_apontamentos/${aptKey}`), null);
      firebaseDelete(`apontamentos/${cleanOp}/${id}`);
    } catch (err) {
      console.warn('[Firebase] Erro ao deletar apontamento estornado:', err);
    }
  }

  tree[cleanOp] = opTree;
  localStorage.setItem(STORAGE_APONTAMENTOS_KEY, JSON.stringify(tree));

  // 2. Atualiza a Ordem de Produção no localStorage e Realtime Database
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

  // Se não encontrar no localStorage, busca diretamente no Firebase Realtime Database
  if (!targetOrder) {
    try {
      const fbKey = toFirebaseKey(cleanOp);
      const snap = await get(ref(db, `ordens_producao/${fbKey}`));
      if (snap.exists()) {
        targetOrder = snap.val() as ProductionOrder;
        matchedOpKey = cleanOp;
      } else {
        const allSnap = await get(ref(db, 'ordens_producao'));
        if (allSnap.exists()) {
          const allData = allSnap.val() || {};
          const cleanNoPrefix = cleanOp.replace(/^OP\s*/i, '').replace(/[-_\s]/g, '');
          for (const [k, val] of Object.entries(allData)) {
            const kClean = k.replace(/^OP\s*/i, '').replace(/[-_\s]/g, '');
            const valNum = String((val as any)?.op_numero || (val as any)?.numero || '').replace(/^OP\s*/i, '').replace(/[-_\s]/g, '');
            if (kClean === cleanNoPrefix || valNum === cleanNoPrefix) {
              targetOrder = val as ProductionOrder;
              matchedOpKey = k;
              break;
            }
          }
        }
      }
    } catch (e) {
      console.warn('Erro ao buscar OP no Firebase para cancelamento:', e);
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

    // Reseta todas as chaves variantes dessa etapa (com ou sem acento)
    const keysToReset = Object.keys(targetOrder.etapas).filter(
      k => matchStepName(k, matchedStepKey) || doesSectorMatchStep(k, matchedStepKey) || k === matchedStepKey || k === setorOuEtapa
    );
    if (keysToReset.length === 0) keysToReset.push(matchedStepKey);

    for (const k of keysToReset) {
      const etapaAnterior = targetOrder.etapas[k] || { status: 'PENDENTE', concluidas: 0 };
      targetOrder.etapas[k] = {
        status: 'PENDENTE',
        concluidas: etapaAnterior.concluidas || 0,
        total: etapaAnterior.total
      };
      delete (targetOrder.etapas[k] as any).inicio;
      delete (targetOrder.etapas[k] as any).horaInicio;
      delete (targetOrder.etapas[k] as any).hora_inicio;
      delete (targetOrder.etapas[k] as any).operadorId;
      delete (targetOrder.etapas[k] as any).operadorNome;
      delete (targetOrder.etapas[k] as any).operador;
      delete (targetOrder.etapas[k] as any).colaborador;
    }

    if ((targetOrder as any).progressoPostos) {
      for (const k of Object.keys((targetOrder as any).progressoPostos)) {
        if (matchStepName(k, matchedStepKey) || doesSectorMatchStep(k, matchedStepKey)) {
          (targetOrder as any).progressoPostos[k].iniciado = false;
          (targetOrder as any).progressoPostos[k].status = 'PENDENTE';
          delete (targetOrder as any).progressoPostos[k].dataInicio;
        }
      }
    }

    // Verifica se restou alguma outra etapa ativa na OP
    const otherActiveStep = steps.find(
      (s) => s !== matchedStepKey && (targetOrder?.etapas?.[s]?.status === 'EM_PRODUCAO')
    );
    const anyCompletedStep = steps.some(
      (s) => (targetOrder?.etapas?.[s]?.status === 'CONCLUIDO') || ((targetOrder?.etapas?.[s]?.concluidas || 0) > 0)
    );

    if (otherActiveStep) {
      targetOrder.status = 'EM_PRODUCAO';
      targetOrder.etapaAtual = otherActiveStep;
      targetOrder.postoSelecionado = otherActiveStep;
    } else if (anyCompletedStep) {
      targetOrder.status = 'EM_PRODUCAO';
      targetOrder.status_fabrica = 'Produzindo Hoje';
      targetOrder.etapaAtual = undefined;
      targetOrder.postoSelecionado = undefined;
      targetOrder.colaboradorIniciou = undefined;
      targetOrder.operadorAtual = undefined;
    } else {
      targetOrder.status = 'EM_PRODUCAO';
      targetOrder.status_fabrica = 'Falta Injetar';
      targetOrder.etapaAtual = undefined;
      targetOrder.postoSelecionado = undefined;
      targetOrder.colaboradorIniciou = undefined;
      targetOrder.operadorAtual = undefined;
      targetOrder.dataInicio = undefined;
    }

    ordersMap[matchedOpKey] = targetOrder;
    localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(ordersMap));

    // Persistência no Firebase Realtime Database
    const opKey = toFirebaseKey(targetOrder.op_numero || targetOrder.numero || matchedOpKey);
    const fbStepKey = toFirebaseKey(matchedStepKey);

    const proximaEtapaPendente = steps.find(
      (s) => (targetOrder?.etapas?.[s]?.status !== 'CONCLUIDO') && ((targetOrder?.etapas?.[s]?.concluidas || 0) === 0)
    ) || steps[0] || 'Corte';

    if (!otherActiveStep) {
      targetOrder.status = anyCompletedStep ? 'EM_PRODUCAO' : `Aguardando Início em: ${proximaEtapaPendente}`;
      targetOrder.statusEtapa = `Aguardando Início em: ${proximaEtapaPendente}`;
      targetOrder.etapaAtual = proximaEtapaPendente;
    }

    const opUpdates: Record<string, any> = {
      etapas: targetOrder.etapas,
      [`etapas/${fbStepKey}/status`]: 'PENDENTE',
      [`etapas/${fbStepKey}/inicio`]: null,
      [`etapas/${fbStepKey}/operadorId`]: null,
      [`etapas/${fbStepKey}/operadorNome`]: null,
      [`etapas/${fbStepKey}/horaInicio`]: null,
      [`etapas/${fbStepKey}/hora_inicio`]: null,
      [`etapas/${fbStepKey}/duracao`]: null,
      [`etapas/${fbStepKey}/operador`]: null,
      [`etapas/${fbStepKey}/colaborador`]: null,
      [`progressoPostos/${fbStepKey}/iniciado`]: false,
      [`progressoPostos/${fbStepKey}/status`]: 'PENDENTE',
      [`apontamentos/${fbStepKey}/status`]: 'PENDENTE',
      [`apontamentos/${fbStepKey}/inicio`]: null,
      [`apontamentos/${fbStepKey}/horaInicio`]: null,
      [`apontamentos/${fbStepKey}/hora_inicio`]: null,
      [`apontamentos/${fbStepKey}/operador`]: null,
      [`apontamentos/${fbStepKey}/operadorId`]: null,
      [`apontamentos/${fbStepKey}/operadorNome`]: null,
      status: targetOrder.status,
      status_fabrica: targetOrder.status_fabrica,
      data_atualizacao: new Date().toISOString()
    };

    if (!otherActiveStep) {
      opUpdates.etapaAtual = proximaEtapaPendente;
      opUpdates.statusEtapa = targetOrder.statusEtapa;
      opUpdates.postoAtivo = null;
      opUpdates.postoSelecionado = null;
      opUpdates.colaboradorIniciou = null;
      opUpdates.operadorAtual = null;
      if (!anyCompletedStep) {
        opUpdates.dataInicio = null;
      }
    }

    try {
      await update(ref(db, `ordens_producao/${opKey}`), opUpdates);
    } catch (err) {
      console.error('[Firebase] Erro ao estornar etapa no Realtime Database:', err);
    }
  }

  broadcastUpdate();
  return { success: true, message: `Etapa ${setorOuEtapa} estornada com sucesso` };
}

/**
 * Limpa todo o histórico de apontamentos
 */
export async function clearAllApontamentos(): Promise<void> {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_APONTAMENTOS_KEY, JSON.stringify({}));
  firebaseDelete('apontamentos');
  try {
    await set(ref(db, 'historico_apontamentos'), null);
  } catch {}
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
    const opKey = toFirebaseKey(order.op_numero);
    if (opKey) {
      await update(ref(db, `ordens_producao/${opKey}`), cleanOrder);
    }
  } catch (err) {
    console.error('[Firebase] Erro ao adicionar ordem:', err);
  }
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
    const pureNum = cleanInput.replace(/^OP\s*/i, '').trim();
    const keysToDelete = new Set([
      toFirebaseKey(foundKey || ''),
      toFirebaseKey(cleanInput),
      toFirebaseKey(`OP ${pureNum}`),
      toFirebaseKey(pureNum)
    ]);

    for (const k of keysToDelete) {
      if (k) {
        await set(ref(db, `ordens_producao/${k}`), null);
      }
    }

    // Exclusão definitiva também no Firestore
    const firestoreIds = [
      cleanInput.replace(/\//g, '-'),
      pureNum,
      `OP ${pureNum}`
    ];
    for (const fsId of firestoreIds) {
      try {
        await deleteDoc(doc(firestore, 'ordens_producao', fsId));
      } catch {}
    }
  } catch (err) {
    console.error('[Firebase] Erro ao deletar ordem:', err);
  }
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
  orders[targetKey] = updated;
  localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(orders));
  try {
    const opKey = toFirebaseKey(targetKey);
    if (opKey) {
      await update(ref(db, `ordens_producao/${opKey}`), updates);
    }
  } catch (err) {
    console.error('[Firebase] Erro ao atualizar ordem:', err);
  }
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
  try {
    const opKey = toFirebaseKey(targetKey);
    if (opKey) {
      await update(ref(db, `ordens_producao/${opKey}`), {
        mensagens: currentOp.mensagens,
        ultimo_aviso: currentOp.ultimo_aviso
      });
    }
  } catch (err) {
    console.error('[Firebase] Erro ao adicionar mensagem na OP:', err);
  }
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

  // 1. Grava no Firebase Realtime Database (https://apontamentoop-default-rtdb.firebaseio.com)
  try {
    const updates: Record<string, any> = {};
    updates[`ordens/${toFirebaseKey(opId)}/ocorrencias/${timestamp}`] = novaOcorrencia;
    updates[`ordens_producao/${opKey}/ocorrencias/${timestamp}`] = novaOcorrencia;
    await update(ref(db), updates);
  } catch (err) {
    console.warn('[RTDB] Erro ao gravar ocorrência no Realtime Database:', err);
  }

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
    set(ref(db, 'ordens_producao'), null);
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
  const orders: Record<string, ProductionOrder> = replaceAll ? {} : { ...currentOrders };
  let count = 0;
  const updates: Record<string, any> = {};

  for (const opImportada of newOrders) {
    const numeroOp = String(
      (opImportada as any).numeroOp ||
      (opImportada as any).numeroOP ||
      opImportada.op_numero ||
      opImportada.numero ||
      (opImportada as any).id ||
      ''
    ).trim();

    if (!numeroOp) continue;

    // Normalização para busca em memória / RTDB
    const normNumeroOp = numeroOp.replace(/^OP\s*/i, '').replace(/[-_\s]/g, '').toUpperCase();
    const existingOrderKey = Object.keys(orders).find((k) => {
      const normK = k.replace(/^OP\s*/i, '').replace(/[-_\s]/g, '').toUpperCase();
      return k === numeroOp || normK === normNumeroOp;
    });
    const existingLocalOrder = existingOrderKey ? orders[existingOrderKey] : undefined;

    const isExisting = Boolean(existingLocalOrder);
    const qtd = obterQuantidadeTotal(opImportada);
    const rotaInfo = processarRotaProduto(opImportada);
    const rotasCalculadas = rotaInfo.rota && rotaInfo.rota.length > 0 ? rotaInfo.rota : obterEtapasDaRota(opImportada);
    const etapaInicial = rotasCalculadas[0] || 'Corte';
    const statusInicial = `Aguardando Início em: ${etapaInicial}`;
    const opKey = toFirebaseKey(numeroOp);

    if (!isExisting) {
      // 2. Se a OP NÃO existir: crie o registro normalmente com os campos padrão da rota e status inicial
      const cleanNewOp: ProductionOrder = {
        ...opImportada,
        op_numero: numeroOp,
        numero: numeroOp,
        numeroOP: numeroOp,
        numeroOp: numeroOp,
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
      orders[numeroOp] = cleanNewOp;
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
        Boolean(
          (codRawChecagem && (CODIGOS_PORTAS_CORRER_PADRAO.has(codRawChecagem) || CODIGOS_PADRAO_CORRER.has(codRawChecagem))) ||
          (codChecagem && (CODIGOS_PORTAS_CORRER_PADRAO.has(codChecagem) || CODIGOS_PADRAO_CORRER.has(codChecagem)))
        ) &&
        !descChecagem.includes('EMENDAD') &&
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
        etapasFinais = ['Montagem Portas de Correr Padrão e Especial'];
        etapaAtualFinal = 'Montagem Portas de Correr Padrão e Especial';
        statusEtapaFinal = 'Aguardando Início em: Montagem Portas de Correr Padrão e Especial';
        metadadosParaAtualizar.etapas = etapasFinais;
        metadadosParaAtualizar.etapaAtual = etapaAtualFinal;
        metadadosParaAtualizar.statusEtapa = statusEtapaFinal;
        metadadosParaAtualizar.status = statusEtapaFinal;
        metadadosParaAtualizar.rota = etapasFinais;
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
        metadadosParaAtualizar.familia = 'Porta de Correr Especial';
        metadadosParaAtualizar.tipoMontagem = 'Porta de Correr Especial';
        metadadosParaAtualizar.statusAtual = 'AGUARDANDO INÍCIO EM: Corte';
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
      orders[existingOrderKey || numeroOp] = opPreservada;
      count++;
    }
  }

  localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(orders));

  // Gravação direta no Firebase Realtime Database em lotes de 50
  try {
    const updateKeys = Object.keys(updates);
    const CHUNK_SIZE = 50;
    for (let i = 0; i < updateKeys.length; i += CHUNK_SIZE) {
      const chunkKeys = updateKeys.slice(i, i + CHUNK_SIZE);
      const chunkUpdates: Record<string, any> = {};
      for (const k of chunkKeys) {
        chunkUpdates[k] = updates[k];
      }
      await update(ref(db), chunkUpdates);
    }
  } catch (err) {
    console.error('[Firebase RTDB] Erro ao sincronizar ordens via update:', err);
  }

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
 * Reseta os dados de apontamento para os dados de fábrica padrão
 */
export function resetFactoryData(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify({}));
  localStorage.setItem(STORAGE_APONTAMENTOS_KEY, JSON.stringify({}));
  firebaseDelete('apontamentos');
  try {
    set(ref(db, 'ordens_producao'), null);
    set(ref(db, 'historico_apontamentos'), null);
  } catch {}
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
