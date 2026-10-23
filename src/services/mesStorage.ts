import { ProductionOrder, Apontamento, Operator, OPERATORS, TerminalConfig, TERMINALS } from '../types/mes';
import { deducePhysicalUnitsFromM2 } from '../utils/nomusParser';
import { getRouteForOp, doesSectorMatchStep, matchStepName, initOrSyncOrderEtapas } from '../utils/routeEngine';
import { db, ref, set, get, onValue, update, push } from './firebase';

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

/**
 * Inicializa dados caso o localStorage esteja vazio e purga ordens de teste fictícias
 */
export function ensureInitialData() {
  if (typeof window === 'undefined') return;
  const existingOrdersRaw = localStorage.getItem(STORAGE_ORDERS_KEY);
  if (!existingOrdersRaw) {
    localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(INITIAL_ORDERS));
  } else {
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

  // Inicializa equipe de colaboradores (caso vazio no storage)
  const existingOps = localStorage.getItem(STORAGE_OPERATORS_KEY);
  if (!existingOps) {
    localStorage.setItem(STORAGE_OPERATORS_KEY, JSON.stringify(OPERATORS));
  } else {
    try {
      JSON.parse(existingOps);
    } catch {
      localStorage.setItem(STORAGE_OPERATORS_KEY, JSON.stringify(OPERATORS));
    }
  }

  // Inicializa configuração dos 5 terminais e setores
  const existingTerms = localStorage.getItem(STORAGE_TERMINALS_KEY);
  if (!existingTerms) {
    localStorage.setItem(STORAGE_TERMINALS_KEY, JSON.stringify(TERMINALS));
  } else {
    try {
      const terms: TerminalConfig[] = JSON.parse(existingTerms);
      let termsModified = false;
      const t3 = terms.find(t => t.id === 3);
      if (t3) {
        const hasOld = t3.sectors.some(s => s.toLowerCase().includes('montagem e injeção') || s.toLowerCase().includes('montagem e injecao'));
        const hasPrep = t3.sectors.some(s => s.toLowerCase().includes('preparação de batentes') || s.toLowerCase().includes('preparacao de batentes'));
        const hasInj = t3.sectors.some(s => s.toLowerCase().includes('injeção e finalização') || s.toLowerCase().includes('injecao e finalizacao'));
        if (hasOld || !hasPrep || !hasInj) {
          const preserved = t3.sectors.filter(s => !s.toLowerCase().includes('montagem e inje'));
          const target = ['Preparação de Batentes', 'Injeção e Finalização Batentes'];
          if (preserved.includes('Montagem Office Door')) target.push('Montagem Office Door');
          if (preserved.includes('Montagem de Portas Emendadas')) target.push('Montagem de Portas Emendadas');
          preserved.forEach(s => {
            if (!target.includes(s) && !s.toLowerCase().includes('montagem e inje')) {
              target.push(s);
            }
          });
          t3.sectors = target;
          termsModified = true;
        }
      }

      const t4 = terms.find(t => t.id === 4);
      if (t4) {
        if (!t4.sectors.some(s => s.toLowerCase().includes('finalizacao vai vem') || s.toLowerCase().includes('finalização vai vem'))) {
          t4.sectors = Array.from(new Set([...t4.sectors, 'Finalização Vai Vem']));
          termsModified = true;
        }
      }
      const t5 = terms.find(t => t.id === 5);
      if (t5) {
        if (!t5.sectors.some(s => s.toLowerCase().includes('preparacao vai vem') || s.toLowerCase().includes('preparação vai vem'))) {
          t5.sectors = Array.from(new Set([...t5.sectors, 'Preparação Vai Vem']));
          termsModified = true;
        }
      }
      if (termsModified) {
        localStorage.setItem(STORAGE_TERMINALS_KEY, JSON.stringify(terms));
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

        return {
          ...op,
          badge,
          codigo: badge,
          setor: primarySetor,
          setores: uniqueSectors,
          sectors: uniqueSectors,
          ativo: op.ativo !== false,
          especialistaVolante: Boolean(op.especialistaVolante ?? op.isRoaming),
          isRoaming: Boolean(op.isRoaming ?? op.especialistaVolante)
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

    return {
      ...op,
      badge,
      codigo: badge,
      setor: primarySetor,
      setores: uniqueSectors,
      sectors: uniqueSectors,
      ativo: op.ativo !== false,
      especialistaVolante: Boolean(op.especialistaVolante ?? op.isRoaming),
      isRoaming: Boolean(op.isRoaming ?? op.especialistaVolante)
    };
  });
  localStorage.setItem(STORAGE_OPERATORS_KEY, JSON.stringify(cleaned));
  firebasePut('config/operators', cleaned);
  try {
    set(ref(db, 'config_operadores'), cleaned);
  } catch {}
  broadcastUpdate();
}

export function addOperator(newOp: Omit<Operator, 'id'> & { id?: string }): Operator {
  const current = fetchOperators();
  const id = newOp.id || `op_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const initials = newOp.initials || newOp.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'OP';
  const rawSectors = Array.isArray(newOp.sectors) ? newOp.sectors : (newOp.setores || []);
  const uniqueSectors = Array.from(new Set(rawSectors.map(s => s.trim()).filter(Boolean)));
  const badge = (newOp.badge || newOp.codigo || '').trim().toUpperCase();

  const operator: Operator = {
    ...newOp,
    id,
    badge,
    codigo: badge,
    initials,
    setor: uniqueSectors[0] || '',
    setores: uniqueSectors,
    sectors: uniqueSectors,
    isRoaming: Boolean(newOp.isRoaming ?? newOp.especialistaVolante),
    especialistaVolante: Boolean(newOp.especialistaVolante ?? newOp.isRoaming),
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

  const normalized: Operator = {
    ...(index >= 0 ? current[index] : {}),
    ...updatedOp,
    id: updatedOp.id || (index >= 0 ? current[index].id : `op_${Date.now()}`),
    name: updatedOp.name.trim(),
    badge,
    codigo: badge,
    role: updatedOp.role || 'Operador',
    setor: uniqueSectors[0] || '',
    setores: [...uniqueSectors],
    sectors: [...uniqueSectors],
    isRoaming: Boolean(updatedOp.isRoaming ?? updatedOp.especialistaVolante),
    especialistaVolante: Boolean(updatedOp.especialistaVolante ?? updatedOp.isRoaming),
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
export function fetchTerminalsConfig(): TerminalConfig[] {
  if (typeof window === 'undefined') return [...TERMINALS];
  ensureInitialData();
  const raw = localStorage.getItem(STORAGE_TERMINALS_KEY);
  if (!raw) return [...TERMINALS];
  try {
    const list: TerminalConfig[] = JSON.parse(raw);
    if (Array.isArray(list) && list.length > 0) {
      return list.map((t) => ({
        ...t,
        sectors: Array.from(new Set(t.sectors ? t.sectors.map((s) => s.trim()).filter(Boolean) : []))
      }));
    }
    return [...TERMINALS];
  } catch {
    return [...TERMINALS];
  }
}

export function saveTerminalsConfig(terminals: TerminalConfig[]): void {
  if (typeof window === 'undefined') return;
  const cleaned = terminals.map((t) => ({
    ...t,
    sectors: Array.from(new Set(t.sectors ? t.sectors.map((s) => s.trim()).filter(Boolean) : []))
  }));
  localStorage.setItem(STORAGE_TERMINALS_KEY, JSON.stringify(cleaned));
  firebasePut('config/terminals', cleaned);
  try {
    set(ref(db, 'config_terminais'), cleaned);
  } catch {}
  broadcastUpdate();
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

export function addSectorToTerminal(terminalId: number, sectorName: string): boolean {
  const clean = sectorName.trim();
  if (!clean) return false;
  const terminals = fetchTerminalsConfig();
  const term = terminals.find((t) => t.id === terminalId);
  if (!term) return false;
  if (!term.sectors) term.sectors = [];
  if (!term.sectors.some((s) => s.toLowerCase() === clean.toLowerCase())) {
    term.sectors.push(clean);
    saveTerminalsConfig(terminals);
    return true;
  }
  return false;
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
  });
  saveOperators(operators);
}

export function resetTerminalsConfigToDefault(): TerminalConfig[] {
  if (typeof window === 'undefined') return [...TERMINALS];
  localStorage.setItem(STORAGE_TERMINALS_KEY, JSON.stringify(TERMINALS));
  broadcastUpdate();
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
        const val = snapshot.val();
        if (!val || Object.keys(val).length === 0) {
          localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify({}));
          broadcastUpdate();
          return;
        }

        const ordersMap: Record<string, ProductionOrder> = {};
        if (typeof val === 'object') {
          Object.values(val).forEach((item: any) => {
            if (item && item.op_numero && !TEST_DUMMY_OPS.has(item.op_numero)) {
              ordersMap[item.op_numero] = item;
            }
          });
        }

        localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(ordersMap));
        broadcastUpdate();
      } catch (err) {
        console.error('[Firebase] Erro no listener de ordens_producao:', err);
      }
    });

    const aptsRef = ref(db, 'historico_apontamentos');
    onValue(aptsRef, (snapshot) => {
      try {
        const val = snapshot.val();
        if (val && typeof val === 'object') {
          const rawLocal = localStorage.getItem(STORAGE_APONTAMENTOS_KEY);
          let tree: Record<string, Record<string, Apontamento>> = {};
          try {
            tree = rawLocal ? JSON.parse(rawLocal) : {};
          } catch {
            tree = {};
          }

          Object.entries(val).forEach(([firebasePushKey, item]: [string, any]) => {
            if (item && item.op_numero) {
              const cleanOp = item.op_numero.trim().toUpperCase();
              if (!tree[cleanOp]) tree[cleanOp] = {};
              const aptId = item.id || firebasePushKey;
              tree[cleanOp][aptId] = { ...item, id: aptId, firebaseKey: firebasePushKey };
            }
          });

          localStorage.setItem(STORAGE_APONTAMENTOS_KEY, JSON.stringify(tree));
          broadcastUpdate();
        }
      } catch (err) {
        console.error('[Firebase] Erro no listener de historico_apontamentos:', err);
      }
    });

    const colabRef = ref(db, 'config_operadores');
    onValue(colabRef, (snapshot) => {
      try {
        const val = snapshot.val();
        if (Array.isArray(val) && val.length > 0) {
          const rawLocal = localStorage.getItem(STORAGE_OPERATORS_KEY);
          const serialized = JSON.stringify(val);
          if (rawLocal !== serialized) {
            localStorage.setItem(STORAGE_OPERATORS_KEY, serialized);
            broadcastUpdate();
          }
        }
      } catch (err) {
        console.error('[Firebase] Erro no listener de config_operadores:', err);
      }
    });

    const termRef = ref(db, 'config_terminais');
    onValue(termRef, (snapshot) => {
      try {
        const val = snapshot.val();
        if (Array.isArray(val) && val.length > 0) {
          const rawLocal = localStorage.getItem(STORAGE_TERMINALS_KEY);
          const serialized = JSON.stringify(val);
          if (rawLocal !== serialized) {
            localStorage.setItem(STORAGE_TERMINALS_KEY, serialized);
            broadcastUpdate();
          }
        }
      } catch (err) {
        console.error('[Firebase] Erro no listener de config_terminais:', err);
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
  if (typeof window === 'undefined' || bgSyncTimer) return;
  bgSyncTimer = setInterval(async () => {
    const cfg = getSavedFirebaseConfig();
    if (!cfg.enabled || !cfg.databaseURL) return;
    try {
      const cloudOrders = await firebaseGet<Record<string, ProductionOrder>>('pcp/orders');
      if (cloudOrders && typeof cloudOrders === 'object' && Object.keys(cloudOrders).length > 0) {
        const local = localStorage.getItem(STORAGE_ORDERS_KEY);
        const serialized = JSON.stringify(cloudOrders);
        if (local !== serialized) {
          localStorage.setItem(STORAGE_ORDERS_KEY, serialized);
          broadcastUpdate();
        }
      }
    } catch {
      // silent network retry
    }

    try {
      const cloudApts = await firebaseGet<Record<string, Record<string, Apontamento>>>('apontamentos');
      if (cloudApts && typeof cloudApts === 'object') {
        const local = localStorage.getItem(STORAGE_APONTAMENTOS_KEY);
        const serialized = JSON.stringify(cloudApts);
        if (local !== serialized) {
          localStorage.setItem(STORAGE_APONTAMENTOS_KEY, serialized);
          broadcastUpdate();
        }
      }
    } catch {
      // silent network retry
    }
  }, 5000);
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

  let raw = localStorage.getItem(STORAGE_ORDERS_KEY);
  if (!raw || raw === '{}') {
    try {
      const snapshot = await get(ref(db, 'ordens_producao'));
      if (snapshot.exists()) {
        const val = snapshot.val();
        const ordersMap: Record<string, ProductionOrder> = {};
        if (typeof val === 'object' && val !== null) {
          Object.values(val).forEach((item: any) => {
            if (item && item.op_numero && !TEST_DUMMY_OPS.has(item.op_numero)) {
              ordersMap[item.op_numero] = item;
            }
          });
        }
        raw = JSON.stringify(ordersMap);
        localStorage.setItem(STORAGE_ORDERS_KEY, raw);
      } else {
        raw = '{}';
        localStorage.setItem(STORAGE_ORDERS_KEY, raw);
      }
    } catch (err) {
      console.warn('[Firebase] Falha na leitura inicial de ordens:', err);
    }
  }

  if (!raw) return {};
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

  let raw = localStorage.getItem(STORAGE_APONTAMENTOS_KEY);
  if (!raw || raw === '{}') {
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
              tree[cleanOp][aptId] = { ...item, id: aptId, firebaseKey: firebasePushKey };
            }
          });
          raw = JSON.stringify(tree);
          localStorage.setItem(STORAGE_APONTAMENTOS_KEY, raw);
        }
      }
    } catch (err) {
      console.warn('[Firebase] Falha na leitura inicial de apontamentos:', err);
    }
  }
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
    push(ref(db, 'historico_apontamentos'), novoApontamento);
  } catch (err) {
    console.warn('[Firebase] Erro ao gravar historico_apontamentos:', err);
  }
  try {
    push(ref(db, 'historico_apontamentos'), novoApontamento);
  } catch (err) {
    console.warn('[Firebase] Erro ao gravar historico_apontamentos:', err);
  }

  try {
    const rawOrders = localStorage.getItem(STORAGE_ORDERS_KEY);
    if (rawOrders) {
      const ordersMap: Record<string, ProductionOrder> = JSON.parse(rawOrders);
      const targetOrder = ordersMap[cleanOp];
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
          concluidas: targetOrder.etapas[matchedStepKey]?.concluidas || 0
        };
        targetOrder.status = 'EM_PRODUCAO';
        targetOrder.status_fabrica = 'Produzindo Hoje';
        localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(ordersMap));
        firebasePut('pcp/orders', ordersMap);
        try {
          update(ref(db, `ordens_producao/${toFirebaseKey(cleanOp)}`), targetOrder);
        } catch (err) {
          console.warn('[Firebase] Erro ao atualizar ordem:', err);
        }
      }
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
export async function finishUnit(apontamentoId: string, opNumero: string): Promise<Apontamento> {
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
    push(ref(db, 'historico_apontamentos'), updated);
  } catch (err) {
    console.warn('[Firebase] Erro ao gravar historico_apontamentos:', err);
  }
  try {
    push(ref(db, 'historico_apontamentos'), updated);
  } catch (err) {
    console.warn('[Firebase] Erro ao gravar historico_apontamentos:', err);
  }

  try {
    const rawOrders = localStorage.getItem(STORAGE_ORDERS_KEY);
    if (rawOrders) {
      const ordersMap: Record<string, ProductionOrder> = JSON.parse(rawOrders);
      const targetOrder = ordersMap[cleanOp];
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
          }
        } else {
          targetOrder.etapas[matchedStep] = {
            status: 'EM_PRODUCAO',
            concluidas: finishedCount
          };
        }

        localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(ordersMap));
        firebasePut('pcp/orders', ordersMap);
        try {
          update(ref(db, `ordens_producao/${toFirebaseKey(cleanOp)}`), targetOrder);
        } catch (err) {
          console.warn('[Firebase] Erro ao atualizar ordem:', err);
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
    push(ref(db, 'historico_apontamentos'), novoApontamento);
  } catch (err) {
    console.warn('[Firebase] Erro ao gravar historico_apontamentos:', err);
  }

  // Atualiza status da OP para EM_PRODUCAO com data/hora e colaborador
  try {
    const rawOrders = localStorage.getItem(STORAGE_ORDERS_KEY);
    if (rawOrders) {
      const ordersMap: Record<string, ProductionOrder> = JSON.parse(rawOrders);
      const targetOrder = ordersMap[cleanOp];
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
          concluidas: targetOrder.etapas[matchedStepKey]?.concluidas || 0
        };
        targetOrder.status = 'EM_PRODUCAO';
        targetOrder.status_fabrica = 'Produzindo Hoje';
        localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(ordersMap));
        firebasePut('pcp/orders', ordersMap);
        try {
          update(ref(db, `ordens_producao/${toFirebaseKey(cleanOp)}`), targetOrder);
        } catch (err) {
          console.warn('[Firebase] Erro ao atualizar ordem:', err);
        }
      }
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
  options?: { quantidadeRefugo?: number; quantidadeProduzida?: number }
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
    push(ref(db, 'historico_apontamentos'), updated);
  } catch (err) {
    console.warn('[Firebase] Erro ao gravar historico_apontamentos:', err);
  }
  try {
    const rawOrders = localStorage.getItem(STORAGE_ORDERS_KEY);
    if (rawOrders) {
      const ordersMap: Record<string, ProductionOrder> = JSON.parse(rawOrders);
      const targetOrder = ordersMap[cleanOp];
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
          targetOrder.status = 'EM_PRODUCAO';
          targetOrder.status_fabrica = 'Produzindo Hoje';
        }
        localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(ordersMap));
        firebasePut('pcp/orders', ordersMap);
        try {
          update(ref(db, `ordens_producao/${toFirebaseKey(cleanOp)}`), targetOrder);
        } catch (err) {
          console.warn('[Firebase] Erro ao atualizar ordem:', err);
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
  } else {
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
      if (fbKey) {
        set(ref(db, `historico_apontamentos/${fbKey}`), null);
      }
    } catch {}
    broadcastUpdate();
  }
  return deleted;
}

/**
 * Limpa todo o histórico de apontamentos
 */
export async function clearAllApontamentos(): Promise<void> {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_APONTAMENTOS_KEY, JSON.stringify({}));
  firebaseDelete('apontamentos');
  try {
    set(ref(db, 'historico_apontamentos'), null);
  } catch {}
  broadcastUpdate();
}

/**
 * Adiciona uma nova OP (para supervisão / teste)
 */
export async function addProductionOrder(order: ProductionOrder): Promise<void> {
  ensureInitialData();
  const orders = await fetchProductionOrders();
  orders[order.op_numero] = order;
  localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(orders));
  firebasePut('pcp/orders', orders);
  try {
    set(ref(db, `ordens_producao/${toFirebaseKey(order.op_numero)}`), order);
  } catch {}
  broadcastUpdate();
}

/**
 * Remove uma OP individual do sistema
 */
export async function deleteProductionOrder(opNumero: string): Promise<void> {
  ensureInitialData();
  const orders = await fetchProductionOrders();
  if (orders[opNumero]) {
    delete orders[opNumero];
    localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(orders));
    firebasePut('pcp/orders', orders);
    try {
      set(ref(db, `ordens_producao/${toFirebaseKey(opNumero)}`), null);
    } catch {}
    broadcastUpdate();
  }
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
  firebasePut('pcp/orders', orders);
  try {
    update(ref(db, `ordens_producao/${toFirebaseKey(targetKey)}`), updated);
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
  firebasePut('pcp/orders', orders);
  try {
    update(ref(db, `ordens_producao/${toFirebaseKey(targetKey)}`), currentOp);
  } catch {}
  broadcastUpdate();
}

/**
 * Limpa todas as OPs ou apenas as de teste
 */
export async function clearAllOrders(): Promise<void> {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify({}));
  localStorage.removeItem('pcp_orders');
  firebaseDelete('pcp/orders');
  try {
    set(ref(db, 'ordens_producao'), null);
  } catch {}
  broadcastUpdate();
}

/**
 * Salva múltiplas OPs importadas em lote (ex: importação do Nomus)
 */
export async function saveMultipleOrders(newOrders: ProductionOrder[], replaceAll: boolean = false): Promise<number> {
  ensureInitialData();
  const orders = replaceAll ? {} : await fetchProductionOrders();
  let count = 0;
  const fbUpdates: Record<string, ProductionOrder> = {};
  for (const o of newOrders) {
    if (o.op_numero) {
      orders[o.op_numero] = o;
      fbUpdates[toFirebaseKey(o.op_numero)] = o;
      count++;
    }
  }
  localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(orders));
  firebasePut('pcp/orders', orders);
  try {
    if (replaceAll) {
      set(ref(db, 'ordens_producao'), fbUpdates);
    } else {
      update(ref(db, 'ordens_producao'), fbUpdates);
    }
  } catch {}
  broadcastUpdate();
  return count;
}

/**
 * Reseta os dados de apontamento para os dados de fábrica padrão
 */
export function resetFactoryData(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify({}));
  localStorage.setItem(STORAGE_APONTAMENTOS_KEY, JSON.stringify({}));
  firebasePut('pcp/orders', {});
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
