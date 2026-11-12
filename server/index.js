// Resiliência do processo Node.js contra encerramentos inesperados
process.on('uncaughtException', (err) => {
  console.error('[Server Error] Erro não tratado:', err);
});
process.on('unhandledRejection', (reason, p) => {
  console.error('[Server Rejection] Promise rejeitada:', reason);
});
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const { parseNomusHtml } = require('./nomusParser');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
  }
});

// Configuração robusta de CORS e limites de payload (30MB+ suportando JSON, texto puro e formulário)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['*']
}));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, *');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.text({ limit: '50mb', type: ['text/*', 'application/xhtml+xml', 'application/xml'] }));

// =========================================================================
// ZERO-DOWNTIME: SERVIR BUILD DE PRODUÇÃO (DIST) E WATCH DE AUTO-ATUALIZAÇÃO
// =========================================================================
const distPath = path.resolve(__dirname, '..', 'dist');
const distIndexPath = path.join(distPath, 'index.html');

// Servir frontend compilado estático
app.use(express.static(distPath));

let watchDebounceTimer = null;
let lastVersionEmitted = 0;

function notificarSistemaAtualizado(origem = 'watch') {
  const now = Date.now();
  if (now - lastVersionEmitted < 2000) return;
  lastVersionEmitted = now;
  console.log(`[Zero-Downtime] Emitindo 'sistema_atualizado' (${origem})... Versão: ${now}`);
  io.emit('sistema_atualizado', { versao: now, timestamp: new Date().toISOString() });
}

function initDistWatcher() {
  try {
    if (!fs.existsSync(distPath)) {
      fs.mkdirSync(distPath, { recursive: true });
    }
    fs.watch(distPath, (eventType, filename) => {
      if (filename && (filename.toLowerCase().includes('index.html') || filename.toLowerCase().includes('assets'))) {
        if (watchDebounceTimer) clearTimeout(watchDebounceTimer);
        watchDebounceTimer = setTimeout(() => {
          if (fs.existsSync(distIndexPath)) {
            notificarSistemaAtualizado(`fs.watch:${eventType}:${filename}`);
          }
        }, 2000); // Debounce de 2 segundos após o build concluir
      }
    });
    console.log(`[Zero-Downtime] fs.watch ativo em ${distPath}`);
  } catch (wErr) {
    console.warn(`[Zero-Downtime] Aviso ao iniciar fs.watch em ${distPath}:`, wErr.message);
  }
}
initDistWatcher();

// Endpoint chamado pelo script de build atômico para emissão imediata
app.post('/api/sistema-atualizado', (req, res) => {
  notificarSistemaAtualizado('api-build');
  res.json({ ok: true, versao: lastVersionEmitted });
});
// =========================================================================

const db = new Database(path.join(__dirname, 'metalrib_mes.db'));

// Garantir colunas de controle de processos sob demanda (Laser CNC e Router) e ocorrências
try {
  db.exec(`ALTER TABLE ordens ADD COLUMN requerLaser INTEGER DEFAULT 0;`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE ordens ADD COLUMN requer_laser INTEGER DEFAULT 0;`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE ordens ADD COLUMN requerRouter INTEGER DEFAULT 0;`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE ordens ADD COLUMN requer_router INTEGER DEFAULT 0;`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE ordens ADD COLUMN encaminhar_router INTEGER DEFAULT 0;`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE ordens ADD COLUMN ocorrencias TEXT;`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE ordens ADD COLUMN data_entrega TEXT;`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE ordens ADD COLUMN prazoEntrega TEXT;`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE ordens ADD COLUMN lote TEXT;`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE ordens ADD COLUMN observacao TEXT;`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE ordens ADD COLUMN observacoes TEXT;`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE ordens ADD COLUMN status_nomus TEXT;`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE ordens ADD COLUMN statusNomus TEXT;`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE ordens ADD COLUMN dados TEXT;`);
} catch (e) {}

// Tabela de Apontamentos para histórico e rastreabilidade industrial
db.exec(`
  CREATE TABLE IF NOT EXISTS apontamentos (
    id TEXT PRIMARY KEY,
    op_numero TEXT NOT NULL,
    unidade_numero INTEGER DEFAULT 0,
    unidade TEXT,
    modo TEXT,
    setor TEXT,
    setorFisico TEXT,
    etapa_rota TEXT,
    terminal_id INTEGER,
    terminal TEXT,
    operador TEXT,
    colaborador TEXT,
    hora_inicio TEXT,
    hora_fim TEXT,
    duracao_minutos REAL,
    duracaoMs INTEGER,
    status TEXT,
    observacao TEXT,
    is_lote INTEGER DEFAULT 0,
    quantidade_lote INTEGER DEFAULT 0,
    quantidade_refugo INTEGER DEFAULT 0,
    criadoEm INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_apontamentos_op ON apontamentos(op_numero);
`);

// Tabela de Ocorrências e Motivos de Atraso
db.exec(`
  CREATE TABLE IF NOT EXISTS ocorrencias (
    id TEXT PRIMARY KEY,
    op_numero TEXT NOT NULL,
    dataHora TEXT,
    operador TEXT,
    posto TEXT,
    terminal TEXT,
    descricao TEXT,
    criadoEm INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_ocorrencias_op ON ocorrencias(op_numero);
`);

// Tabela de Colaboradores para sincronização entre terminais e web
db.exec(`
  CREATE TABLE IF NOT EXISTS colaboradores (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    badge TEXT,
    codigo TEXT,
    cracha TEXT,
    funcao TEXT,
    terminais TEXT,
    setores TEXT,
    especialista INTEGER DEFAULT 0,
    ativo INTEGER DEFAULT 1,
    dados TEXT,
    atualizadoEm INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_colaboradores_nome ON colaboradores(nome);
`);
try { db.exec("ALTER TABLE colaboradores ADD COLUMN cracha TEXT;"); } catch {}
try { db.exec("ALTER TABLE colaboradores ADD COLUMN funcao TEXT;"); } catch {}

// Tabela de Terminais e Setores para sincronização em tempo real entre PCP e Totens
db.exec(`
  CREATE TABLE IF NOT EXISTS terminais (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    label TEXT,
    sectors TEXT,
    atualizadoEm INTEGER
  );
`);

// Tabela de status de sincronização com o Nomus ERP
db.exec(`
  CREATE TABLE IF NOT EXISTS sync_status (
    chave TEXT PRIMARY KEY,
    dados TEXT,
    atualizadoEm INTEGER
  );
`);

let ultimaSyncNomus = null;
try {
  const row = db.prepare("SELECT dados FROM sync_status WHERE chave = 'nomus'").get();
  if (row && row.dados) {
    ultimaSyncNomus = JSON.parse(row.dados);
    console.log('[Sync Status] Último status de sync recuperado do SQLite:', ultimaSyncNomus);
  }
} catch (e) {
  console.warn('[Sync Status] Aviso ao recuperar status do banco:', e.message);
}

function registrarSyncNomus(totalProcessadas, origem = 'tampermonkey') {
  const syncObj = {
    timestamp: new Date().toISOString(),
    totalProcessadas: Number(totalProcessadas || 0),
    origem: String(origem || 'manual')
  };
  ultimaSyncNomus = syncObj;
  try {
    db.prepare(`
      INSERT INTO sync_status (chave, dados, atualizadoEm)
      VALUES ('nomus', ?, ?)
      ON CONFLICT(chave) DO UPDATE SET
        dados = excluded.dados,
        atualizadoEm = excluded.atualizadoEm
    `).run(JSON.stringify(syncObj), Date.now());
  } catch (e) {
    console.warn('[Sync Status] Erro ao persistir sync_status no SQLite:', e.message);
  }
  io.emit('nomus_sync_status', syncObj);
  console.log(`[Nomus Sync] Emitido 'nomus_sync_status': ${JSON.stringify(syncObj)}`);
  return syncObj;
}

// Inicialização com os 5 terminais oficiais caso esteja vazio
try {
  const countTerms = db.prepare('SELECT COUNT(*) as count FROM terminais').get();
  if (!countTerms || countTerms.count === 0) {
    const defaultTerms = [
      { id: 1, name: 'Terminal 1', label: 'Corte, Dobra e Laser', sectors: JSON.stringify(['Corte', 'Laser', 'Dobra', 'Preparação de Folha']) },
      { id: 2, name: 'Terminal 2', label: 'Preparação e Injetora de folhas', sectors: JSON.stringify(['Preparação de Folha', 'Preparação Office Door', 'Preparação Office Door Correr', 'Injeção', 'Injeção de Folhas']) },
      { id: 3, name: 'Terminal 3', label: 'Batentes e Portas Office/Emendadas', sectors: JSON.stringify(['Preparação de Batentes', 'Injeção e Finalização de Batentes', 'Montagem Portas Emendadas', 'Montagem de Office Door Giro', 'Montagem Office de Correr', 'Montagem Portas Office Door', 'Montagem Office Door Correr', 'Montagem Portas de Correr Padrão e Especial', 'Montagem de Portas Giratória Padrão e Especial', 'Montagem de Portas Giratórias', 'Instalação de Gaxeta', 'Finalização Vai Vem', 'Corte de Trilho p/ Porta Correr', 'Montagem de Trilho p/ Porta Correr']) },
      { id: 4, name: 'Terminal 4', label: 'Montagem Vai-Vem & Gaxeta', sectors: JSON.stringify(['Montagem Porta Vai-Vem', 'Montagem de Office Door Giro', 'Montagem Office de Correr', 'Montagem Portas Office Door', 'Montagem Office Door Correr', 'Instalação de Gaxeta', 'Montagem de Portas Giratória Padrão e Especial', 'Montagem de Portas Giratórias', 'Montagem Portas de Correr Padrão e Especial', 'Montagem Portas Emendadas', 'Corte de Trilho p/ Porta Correr', 'Montagem de Trilho p/ Porta Correr']) },
      { id: 5, name: 'Terminal 5', label: 'Router, Solda e Especiais', sectors: JSON.stringify(['Corte Alumínio', 'Preparação Vai Vem', 'Preparação Office Door', 'Preparação Office Door Correr', 'Router', 'Corte', 'Solda', 'Solda e Montagem', 'Montagem Estante', 'Montagem Abrigo Doca', 'Cortina', 'Elétrica']) }
    ];
    const insertTerm = db.prepare('INSERT INTO terminais (id, name, label, sectors, atualizadoEm) VALUES (?, ?, ?, ?, ?)');
    for (const dt of defaultTerms) {
      insertTerm.run(dt.id, dt.name, dt.label, dt.sectors, Date.now());
    }
  } else {
    // Saneamento e inclusão dos postos oficiais Office Door nos terminais existentes
    const ensureSectorInTerminal = (termId, sectorName) => {
      const row = db.prepare('SELECT * FROM terminais WHERE id = ?').get(termId);
      if (row) {
        let secs = JSON.parse(row.sectors || '[]');
        if (!secs.some(s => s.toLowerCase() === sectorName.toLowerCase())) {
          secs.push(sectorName);
          db.prepare('UPDATE terminais SET sectors = ?, atualizadoEm = ? WHERE id = ?').run(JSON.stringify(secs), Date.now(), termId);
        }
      }
    };

    ensureSectorInTerminal(2, 'Preparação Office Door Correr');
    ensureSectorInTerminal(3, 'Montagem de Office Door Giro');
    ensureSectorInTerminal(3, 'Montagem Office de Correr');
    ensureSectorInTerminal(4, 'Montagem de Office Door Giro');
    ensureSectorInTerminal(4, 'Montagem Office de Correr');
    ensureSectorInTerminal(5, 'Preparação Office Door Correr');

    // Saneamento de Terminal 5 para expurgar setores de montagem indevidos
    const t5Row = db.prepare('SELECT * FROM terminais WHERE id = 5').get();
    if (t5Row) {
      let t5Secs = JSON.parse(t5Row.sectors || '[]');
      const forbiddenT5 = [
        'montagem portas de correr padrao e especial',
        'montagem de portas giratoria padrao e especial',
        'montagem de portas giratorias',
        'montagem portas emendadas',
        'montagem porta vai-vem',
        'corte de trilho p/ porta correr',
        'montagem de trilho p/ porta correr',
        'montagem de office door giro',
        'montagem office de correr'
      ];
      const cleaned = t5Secs.filter(s => !forbiddenT5.includes(s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()));
      if (cleaned.length !== t5Secs.length) {
        db.prepare('UPDATE terminais SET sectors = ?, atualizadoEm = ? WHERE id = 5').run(JSON.stringify(cleaned), Date.now());
        console.log('[SQLite] Terminal 5 saneado com sucesso (removidos setores de montagem indevidos)');
      }
    }
  }
} catch (e) {
  console.warn('[SQLite] Erro ao inicializar terminais padrão:', e);
}

// Função global para normalização e saneamento de encoding de setores (UTF-8 limpo)
function sanitizeSectorEncoding(name) {
  if (!name || typeof name !== 'string') return name;
  const trimmed = name.trim();
  const normalized = trimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (
    normalized === 'preparacao de folha' ||
    normalized === 'preparacao de folhas' ||
    /preparao/i.test(trimmed) ||
    (trimmed.includes('\uFFFD') && /folha/i.test(trimmed)) ||
    (/^prepara.*folha/i.test(normalized))
  ) {
    return 'Preparação de Folha';
  }
  return trimmed;
}

// Sanitização compulsória de encoding UTF-8 no SQLite na inicialização do servidor
try {
  const allTerms = db.prepare('SELECT id, sectors FROM terminais').all();
  for (const t of allTerms) {
    if (!t.sectors) continue;
    try {
      const secs = JSON.parse(t.sectors);
      if (Array.isArray(secs)) {
        let changed = false;
        const cleanSecs = secs.map(s => {
          const clean = sanitizeSectorEncoding(s);
          if (clean !== s) changed = true;
          return clean;
        });
        if (changed) {
          db.prepare('UPDATE terminais SET sectors = ?, atualizadoEm = ? WHERE id = ?')
            .run(JSON.stringify(Array.from(new Set(cleanSecs))), Date.now(), t.id);
          console.log(`[SQLite] Terminal ${t.id} sanitizado com sucesso para UTF-8 limpo.`);
        }
      }
    } catch {}
  }

  const allColabs = db.prepare('SELECT id, setores, dados FROM colaboradores').all();
  for (const c of allColabs) {
    let changed = false;
    let cleanSetores = null;
    let cleanDados = null;
    if (c.setores) {
      try {
        const secs = JSON.parse(c.setores);
        if (Array.isArray(secs)) {
          const mapped = secs.map(s => {
            const clean = sanitizeSectorEncoding(s);
            if (clean !== s) changed = true;
            return clean;
          });
          if (changed) cleanSetores = JSON.stringify(Array.from(new Set(mapped)));
        }
      } catch {}
    }
    if (c.dados) {
      try {
        const d = JSON.parse(c.dados);
        if (d.setoresPorTerminal && typeof d.setoresPorTerminal === 'object') {
          for (const key of Object.keys(d.setoresPorTerminal)) {
            if (Array.isArray(d.setoresPorTerminal[key])) {
              const mapped = d.setoresPorTerminal[key].map(s => {
                const clean = sanitizeSectorEncoding(s);
                if (clean !== s) changed = true;
                return clean;
              });
              d.setoresPorTerminal[key] = Array.from(new Set(mapped));
            }
          }
          if (changed) cleanDados = JSON.stringify(d);
        }
      } catch {}
    }
    if (changed) {
      if (cleanSetores && cleanDados) {
        db.prepare('UPDATE colaboradores SET setores = ?, dados = ?, atualizadoEm = ? WHERE id = ?').run(cleanSetores, cleanDados, Date.now(), c.id);
      } else if (cleanSetores) {
        db.prepare('UPDATE colaboradores SET setores = ?, atualizadoEm = ? WHERE id = ?').run(cleanSetores, Date.now(), c.id);
      }
      console.log(`[SQLite] Colaborador ${c.id} sanitizado com sucesso para UTF-8 limpo.`);
    }
  }
} catch (err) {
  console.warn('[SQLite] Erro na rotina de sanitização UTF-8:', err);
}

// Lista oficial e padronizada de Colaboradores da Fábrica Metalrib
const COLABORADORES_PADRAO = [
  // TERMINAL 1
  { id: 'eliel', nome: 'Eliel', badge: 'CORTE-01', codigo: 'CORTE-01', terminais: ['T1'], setores: ['Corte'], especialista: 0, ativo: 1 },
  { id: 'elionai', nome: 'Elionai', badge: 'T1-01', codigo: 'T1-01', terminais: ['T1'], setores: ['Corte'], especialista: 0, ativo: 1 },
  { id: 'bruno_c', nome: 'Bruno Constancio', badge: 'ESP-T1', codigo: 'ESP-T1', terminais: ['T1'], setores: ['Corte', 'Dobra', 'Laser'], especialista: 1, ativo: 1 },
  { id: 'leonardo_c', nome: 'Leonardo Constancio', badge: 'DOB-01', codigo: 'DOB-01', terminais: ['T1'], setores: ['Dobra', 'Preparação de Folha'], especialista: 0, ativo: 1 },
  { id: 'danielson', nome: 'Danielson', badge: 'DOB-02', codigo: 'DOB-02', terminais: ['T1'], setores: ['Dobra', 'Preparação de Folha'], especialista: 0, ativo: 1 },
  { id: 'leonardo_h', nome: 'Leonardo Henrique', badge: 'T1-T2', codigo: 'T1-T2', terminais: ['T1', 'T2'], setores: ['Preparação de Folha'], especialista: 0, ativo: 1 },

  // TERMINAL 2
  { id: 'magna', nome: 'Magna', badge: 'INJ-01', codigo: 'INJ-01', terminais: ['T2'], setores: ['Preparação de Folha', 'Injeção de Folhas'], especialista: 0, ativo: 1 },
  { id: 'donizete', nome: 'Donizete', badge: 'INJ-02', codigo: 'INJ-02', terminais: ['T2'], setores: ['Preparação de Folha', 'Injeção de Folhas'], especialista: 0, ativo: 1 },

  // TERMINAL 3
  { id: 'aparecido', nome: 'Aparecido', badge: 'BAT-01', codigo: 'BAT-01', terminais: ['T3'], setores: ['Preparação de Batentes', 'Injeção e Finalização de Batentes'], especialista: 0, ativo: 1 },
  { id: 'antonio_m', nome: 'Antonio Massena', badge: 'BAT-02', codigo: 'BAT-02', terminais: ['T3'], setores: ['Preparação de Batentes', 'Injeção e Finalização de Batentes'], especialista: 0, ativo: 1 },
  { id: 'salatiel', nome: 'Salatiel', badge: 'BAT-03', codigo: 'BAT-03', terminais: ['T3'], setores: ['Preparação de Batentes', 'Injeção e Finalização de Batentes'], especialista: 0, ativo: 1 },
  { id: 'yuri', nome: 'Yuri', badge: 'BAT-04', codigo: 'BAT-04', terminais: ['T3'], setores: ['Preparação de Batentes', 'Injeção e Finalização de Batentes'], especialista: 0, ativo: 1 },
  { id: 'sergio', nome: 'Sergio', badge: 'ESP-T3', codigo: 'ESP-T3', terminais: ['T3'], setores: ['Preparação de Batentes', 'Injeção e Finalização de Batentes', 'Montagem Portas Emendadas'], especialista: 1, ativo: 1 },
  { id: 'jose_lucas', nome: 'Jose Lucas', badge: 'OFF-01', codigo: 'OFF-01', terminais: ['T3'], setores: ['Preparação de Batentes', 'Injeção e Finalização de Batentes'], especialista: 0, ativo: 1 },
  { id: 'ademir', nome: 'Ademir', badge: 'EME-01', codigo: 'EME-01', terminais: ['T3'], setores: ['Montagem Portas Emendadas'], especialista: 0, ativo: 1 },
  { id: 'francisco_h', nome: 'Francisco Henrique', badge: 'EME-02', codigo: 'EME-02', terminais: ['T3'], setores: ['Montagem Portas Emendadas'], especialista: 0, ativo: 1 },
  { id: 'denis', nome: 'Denis', badge: 'EME-03', codigo: 'EME-03', terminais: ['T3'], setores: ['Montagem Portas Emendadas'], especialista: 0, ativo: 1 },
  { id: 'jonathan', nome: 'Jonathan', badge: 'EME-04', codigo: 'EME-04', terminais: ['T3'], setores: ['Montagem Portas Emendadas'], especialista: 0, ativo: 1 },
  { id: 'jose_aparecido', nome: 'José Aparecido', badge: 'T3-T4', codigo: 'T3-T4', terminais: ['T3', 'T4'], setores: ['Preparação de Batentes', 'Injeção e Finalização de Batentes', 'Instalação de Gaxeta', 'Montagem de Portas Giratória Padrão e Especial'], especialista: 0, ativo: 1 },
  { id: 'deilson', nome: 'Deilson', badge: 'T3-T4B', codigo: 'T3-T4B', terminais: ['T3', 'T4'], setores: ['Preparação de Batentes', 'Injeção e Finalização de Batentes', 'Instalação de Gaxeta', 'Montagem de Portas Giratória Padrão e Especial'], especialista: 0, ativo: 1 },

  // TERMINAL 4
  { id: 'joao_p', nome: 'João Paulo', badge: 'VV-01', codigo: 'VV-01', terminais: ['T4'], setores: ['Montagem Vai Vem'], especialista: 0, ativo: 1 },
  { id: 'alessandra', nome: 'Alessandra', badge: 'VV-02', codigo: 'VV-02', terminais: ['T4'], setores: ['Montagem Vai Vem'], especialista: 0, ativo: 1 },
  { id: 'gustavo_n', nome: 'Gustavo Naves', badge: 'GIR-01', codigo: 'GIR-01', terminais: ['T4'], setores: ['Instalação de Gaxeta', 'Montagem de Portas Giratória Padrão e Especial'], especialista: 0, ativo: 1 },
  { id: 'fabiano', nome: 'Fabiano', badge: 'GIR-02', codigo: 'GIR-02', terminais: ['T4'], setores: ['Instalação de Gaxeta', 'Montagem de Portas Giratória Padrão e Especial'], especialista: 0, ativo: 1 },
  { id: 'vinicius', nome: 'Vinicius', badge: 'GIR-03', codigo: 'GIR-03', terminais: ['T4'], setores: ['Instalação de Gaxeta', 'Montagem de Portas Giratória Padrão e Especial'], especialista: 0, ativo: 1 },
  { id: 'nalysson', nome: 'Nalysson', badge: 'GIR-04', codigo: 'GIR-04', terminais: ['T4'], setores: ['Instalação de Gaxeta', 'Montagem de Portas Giratória Padrão e Especial'], especialista: 0, ativo: 1 },

  // TERMINAL 5
  { id: 'vitor', nome: 'Vitor', badge: 'ROU-01', codigo: 'ROU-01', cracha: 'ROU-01', funcao: 'Operador Router', terminais: ['T5'], setores: ['Router', 'Corte Alumínio', 'Preparação Vai Vem'], especialista: 0, ativo: 1 },
  { id: 'cristiane', nome: 'Cristiane', badge: 'ELE-01', codigo: 'ELE-01', terminais: ['T5'], setores: ['Elétrica'], especialista: 0, ativo: 1 },
  { id: 'marcio', nome: 'Marcio', badge: 'ELE-02', codigo: 'ELE-02', terminais: ['T5'], setores: ['Elétrica'], especialista: 0, ativo: 1 },
  { id: 'gabriele', nome: 'Gabriele', badge: 'COR-01', codigo: 'COR-01', terminais: ['T5'], setores: ['Montagem Estante', 'Cortina'], especialista: 0, ativo: 1 },
  { id: 'yasmin', nome: 'Yasmin', badge: 'PVV-01', codigo: 'PVV-01', terminais: ['T5'], setores: ['Preparação Vai Vem', 'Corte Alumínio'], especialista: 0, ativo: 1 },
  { id: 'carol', nome: 'Carol', badge: 'T5-01', codigo: 'T5-01', terminais: ['T5'], setores: ['Preparação Vai Vem', 'Corte Alumínio'], especialista: 0, ativo: 1 },
  { id: 'nathan', nome: 'Nathan', badge: 'SOL-01', codigo: 'SOL-01', terminais: ['T5'], setores: ['Solda', 'Solda e Montagem'], especialista: 0, ativo: 1 },
  { id: 'fabio', nome: 'Fabio', badge: 'ESP-T5', codigo: 'ESP-T5', terminais: ['T5'], setores: ['Solda', 'Solda e Montagem', 'Router', 'Corte Alumínio', 'Elétrica'], especialista: 1, ativo: 1 },

  // ESPECIALISTA MULTI-TERMINAL
  { id: 'afonso', nome: 'Afonso', badge: 'ESP-MULTI', codigo: 'ESP-MULTI', terminais: ['T1', 'T3', 'T4', 'T5'], setores: ['TODOS'], especialista: 1, ativo: 1 }
];

// Inicialização e Saneamento Compulsório de Colaboradores no SQLite
try {
  const insertColab = db.prepare(`
    INSERT INTO colaboradores (id, nome, badge, codigo, terminais, setores, especialista, ativo, dados, atualizadoEm)
    VALUES (@id, @nome, @badge, @codigo, @terminais, @setores, @especialista, @ativo, @dados, @atualizadoEm)
    ON CONFLICT(id) DO UPDATE SET
      nome = excluded.nome,
      badge = excluded.badge,
      codigo = excluded.codigo,
      terminais = excluded.terminais,
      setores = excluded.setores,
      especialista = excluded.especialista,
      ativo = excluded.ativo,
      atualizadoEm = excluded.atualizadoEm
  `);

  const countColabs = db.prepare('SELECT COUNT(*) as count FROM colaboradores').get();
  if (!countColabs || countColabs.count === 0) {
    const seedTx = db.transaction((list) => {
      for (const c of list) {
        insertColab.run({
          id: c.id,
          nome: c.nome,
          badge: c.badge,
          codigo: c.codigo,
          terminais: JSON.stringify(c.terminais),
          setores: JSON.stringify(c.setores),
          especialista: c.especialista ? 1 : 0,
          ativo: c.ativo ? 1 : 0,
          dados: JSON.stringify({}),
          atualizadoEm: Date.now()
        });
      }
    });
    seedTx(COLABORADORES_PADRAO);
    console.log('[SQLite] Colaboradores oficiais inicializados no banco:', COLABORADORES_PADRAO.length);
  } else {
    // Saneamento compulsório de colaboradores no banco
    const sanitizarStmt = db.prepare(`
      UPDATE colaboradores 
      SET setores = @setores, atualizadoEm = @atualizadoEm
      WHERE id = @id
    `);
    sanitizarStmt.run({ id: 'eliel', setores: JSON.stringify(['Corte']), atualizadoEm: Date.now() });
    sanitizarStmt.run({ id: 'elionai', setores: JSON.stringify(['Corte']), atualizadoEm: Date.now() });
    sanitizarStmt.run({ id: 'leonardo_h', setores: JSON.stringify(['Preparação de Folha']), atualizadoEm: Date.now() });

    // Migração de Victor para Vitor com permissão de Router no Terminal 5
    const victorRow = db.prepare("SELECT * FROM colaboradores WHERE id = 'victor' OR LOWER(nome) = 'victor'").get();
    if (victorRow) {
      let secs = [];
      try { secs = JSON.parse(victorRow.setores || '[]'); } catch {}
      if (!secs.includes('Router')) secs.unshift('Router');
      db.prepare(`
        UPDATE colaboradores 
        SET id = 'vitor', nome = 'Vitor', badge = 'ROU-01', codigo = 'ROU-01', cracha = 'ROU-01', funcao = 'Operador Router', setores = ?, atualizadoEm = ?
        WHERE id = ?
      `).run(JSON.stringify(secs), Date.now(), victorRow.id);
      console.log('[SQLite] Colaborador Victor atualizado para Vitor com setor Router');
    }

    const vitorRow = db.prepare("SELECT * FROM colaboradores WHERE id = 'vitor' OR LOWER(nome) = 'vitor'").get();
    if (vitorRow) {
      let secs = [];
      try { secs = JSON.parse(vitorRow.setores || '[]'); } catch {}
      if (!secs.includes('Router')) {
        secs.unshift('Router');
        db.prepare("UPDATE colaboradores SET setores = ?, atualizadoEm = ? WHERE id = 'vitor'").run(JSON.stringify(secs), Date.now());
      }
    }
  }
} catch (e) {
  console.warn('[SQLite] Erro ao inicializar colaboradores padrão:', e);
}

// =============================================================
// FUNÇÕES OFICIAIS DE NORMALIZAÇÃO DE IDENTIFICADORES DE OP
// =============================================================
const normalizarIdOP = (op) => String(op || '').toUpperCase().replace(/^(\s*OP\s*)+/i, '').trim();
const formatarNumeroOP = (op) => {
  const clean = normalizarIdOP(op);
  return clean ? `OP ${clean}` : '';
};

// Limpeza preventiva de duplicações e padronização absoluta de IDs e Números no SQLite
try {
  const todasOrdensBrutas = db.prepare('SELECT rowid, id, numero, atualizadoEm FROM ordens ORDER BY atualizadoEm DESC').all();
  const seenNorm = new Set();
  const idsParaExcluir = [];
  const paraNormalizar = [];

  for (const row of todasOrdensBrutas) {
    const clean = normalizarIdOP(row.numero || row.id);
    if (!clean) {
      idsParaExcluir.push(row.rowid);
      continue;
    }
    if (seenNorm.has(clean)) {
      idsParaExcluir.push(row.rowid);
    } else {
      seenNorm.add(clean);
      const canonicalNum = formatarNumeroOP(clean);
      if (row.id !== canonicalNum || row.numero !== canonicalNum) {
        paraNormalizar.push({ rowid: row.rowid, canonicalNum });
      }
    }
  }

  if (idsParaExcluir.length > 0) {
    const delStmt = db.prepare('DELETE FROM ordens WHERE rowid = ?');
    const delTx = db.transaction((list) => {
      for (const rid of list) delStmt.run(rid);
    });
    delTx(idsParaExcluir);
    console.log(`[SQLite Migration] Excluídas ${idsParaExcluir.length} ordens duplicadas.`);
  }

  if (paraNormalizar.length > 0) {
    const normStmt = db.prepare('UPDATE ordens SET id = ?, numero = ? WHERE rowid = ?');
    const normTx = db.transaction((list) => {
      for (const item of list) {
        normStmt.run(item.canonicalNum, item.canonicalNum, item.rowid);
      }
    });
    normTx(paraNormalizar);
    console.log(`[SQLite Migration] Padronizadas ${paraNormalizar.length} ordens para chave única ("OP ...").`);
  }

  // Garantir índice UNIQUE em numero para suportar UPSERT nativo
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ordens_numero ON ordens(numero);`);
} catch (e) {
  console.warn('[SQLite Migration] Erro no saneamento inicial de ordens:', e);
}

// -------------------------------------------------------------
// SANEAMENTO E MAPEAMENTO DE ROTAS OFICIAIS NOMUS NO SQLITE
// -------------------------------------------------------------
const CODIGOS_ROTA_EXCLUSIVA_LASER = [
  '021.0037', '021.0038', '024.0321', '024.0320', '024.0020', '024.0019', '021.0049'
];

const CODIGOS_ROTA_LASER_DOBRA = [
  '024.0022', '024.0021'
];

const CODIGOS_ROTA_EXCLUSIVA_ROUTER = [
  '027.0006'
];

function normalizarCodSql(c) {
  return String(c || '').replace(/\D/g, '');
}

function normalizarTextoSql(t) {
  return String(t || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isLaserExclusivoSql(codigo, descricao) {
  const cRaw = String(codigo || '').trim();
  const cNorm = normalizarCodSql(cRaw);
  if (CODIGOS_ROTA_EXCLUSIVA_LASER.some(code => cRaw === code || cNorm === normalizarCodSql(code))) {
    return true;
  }
  const desc = normalizarTextoSql(descricao);
  if (desc.includes('ANCORA REBITE ROSCA') || desc.includes('ANCORA VAI VEM ALVENARIA')) {
    return true;
  }
  if (desc.includes('PENDURAL') && (desc.includes('INOX') || desc.includes('CORTINA'))) {
    return true;
  }
  return false;
}

function isLaserDobraSql(codigo, descricao) {
  const cRaw = String(codigo || '').trim();
  const cNorm = normalizarCodSql(cRaw);
  if (CODIGOS_ROTA_LASER_DOBRA.some(code => cRaw === code || cNorm === normalizarCodSql(code))) {
    return true;
  }
  const desc = normalizarTextoSql(descricao);
  if (desc.includes('TRILHO INOX') && desc.includes('CORTINA')) {
    return true;
  }
  return false;
}

function isRouterExclusivoSql(codigo, descricao) {
  const cRaw = String(codigo || '').trim();
  const cNorm = normalizarCodSql(cRaw);
  if (CODIGOS_ROTA_EXCLUSIVA_ROUTER.some(code => cRaw === code || cNorm === normalizarCodSql(code))) {
    return true;
  }
  const desc = normalizarTextoSql(descricao);
  if (desc.includes('VISOR POLICARBONATO') || desc.includes('VISOR DE POLICARBONATO')) {
    return true;
  }
  return false;
}

function isOfficeDoorCorrerSql(codigo, descricao, tipoOrdem) {
  const cod = String(codigo || '').trim();
  const desc = normalizarTextoSql(descricao);
  const tipo = normalizarTextoSql(tipoOrdem);

  if (cod.startsWith('010.') || cod.startsWith('010') || cod === '010.0008') return true;
  if (desc.includes('OFFICE DOOR COR') || desc.includes('OFFICE-DOOR COR')) return true;
  if ((desc.includes('OFFICE DOOR') || desc.includes('OFFICE-DOOR') || desc.includes('OFFICE') || tipo.includes('OFFICE')) && (desc.includes('CORRER') || desc.includes('COR ') || desc.endsWith(' COR') || desc.includes('CORR') || tipo.includes('CORRER'))) {
    return true;
  }
  return false;
}

function isOfficeDoorGiroSql(codigo, descricao, tipoOrdem) {
  if (isOfficeDoorCorrerSql(codigo, descricao, tipoOrdem)) return false;
  const cod = String(codigo || '').trim();
  const desc = normalizarTextoSql(descricao);
  const tipo = normalizarTextoSql(tipoOrdem);

  if (cod.startsWith('009.') || cod.startsWith('009')) return true;
  if (desc.includes('OFFICE DOOR GIR') || desc.includes('OFFICE-DOOR GIR')) return true;
  if (desc.includes('OFFICE DOOR') || desc.includes('OFFICE-DOOR') || desc.includes('OFFICE') || tipo.includes('OFFICE')) {
    return true;
  }
  return false;
}

function isEligibleForRouterSql(codigo, descricao, tipoOrdem) {
  if (isOfficeDoorCorrerSql(codigo, descricao, tipoOrdem)) return true;
  if (isOfficeDoorGiroSql(codigo, descricao, tipoOrdem)) return true;
  const desc = normalizarTextoSql(descricao);
  const tipo = normalizarTextoSql(tipoOrdem);
  const cod = String(codigo || '').trim();
  const regex = /VAI[\s-]?E?[\s-]?VEM|OFFICE[\s-]?DOOR|\bVV\b/i;
  if (regex.test(desc) || regex.test(tipo)) return true;
  if (cod.startsWith('011.') || cod.startsWith('011') || desc.includes('VAI VEM')) return true;
  return false;
}

function inserirEtapaRouterNaOrdem(opRow, requerRouter) {
  if (!opRow) return null;
  let etapasArr = [];
  let isObj = false;
  let etapasObj = {};

  try {
    const parsed = typeof opRow.etapas === 'string' ? JSON.parse(opRow.etapas || '[]') : (opRow.etapas || []);
    if (Array.isArray(parsed)) {
      etapasArr = [...parsed];
    } else if (parsed && typeof parsed === 'object') {
      isObj = true;
      etapasObj = { ...parsed };
      etapasArr = Object.keys(etapasObj);
    }
  } catch {
    etapasArr = [];
  }

  const routerAtivo = requerRouter !== undefined 
    ? Boolean(requerRouter) 
    : Boolean(opRow.requerRouter || opRow.requer_router || opRow.encaminhar_router);

  if (routerAtivo) {
    const hasRouter = etapasArr.some(e => String(e).toLowerCase().includes('router'));
    if (!hasRouter) {
      const injIdx = etapasArr.findIndex(e => String(e).toLowerCase().includes('inje'));
      if (injIdx !== -1) {
        etapasArr.splice(injIdx + 1, 0, 'Router');
      } else {
        const montIdx = etapasArr.findIndex(e => String(e).toLowerCase().includes('montagem'));
        if (montIdx !== -1) {
          etapasArr.splice(montIdx, 0, 'Router');
        } else {
          etapasArr.push('Router');
        }
      }
    }

    if (isObj) {
      if (!etapasObj['Router']) {
        etapasObj['Router'] = {
          status: 'PENDENTE',
          concluidas: 0,
          total: opRow.quantidadeFisica || opRow.quantidade || 1
        };
      }
    }

    const novasEtapasStr = JSON.stringify(isObj ? etapasObj : etapasArr);
    const novoStatus = 'Aguardando Início em: Router';
    const nowMs = Date.now();

    db.prepare(`
      UPDATE ordens SET
        etapas = ?,
        status = ?,
        requerRouter = 1,
        requer_router = 1,
        encaminhar_router = 1,
        atualizadoEm = ?
      WHERE id = ? OR numero = ?
    `).run(novasEtapasStr, novoStatus, nowMs, opRow.id, opRow.numero);

    opRow.etapas = novasEtapasStr;
    opRow.status = novoStatus;
    opRow.requerRouter = 1;
    opRow.requer_router = 1;
    opRow.encaminhar_router = 1;
  }

  return opRow;
}

// Varredura retroativa nas ordens existentes
try {
  const todasOrdens = db.prepare('SELECT * FROM ordens').all();
  let ordensAtualizadasCount = 0;

  const updateStmt = db.prepare(`
    UPDATE ordens 
    SET etapas = @etapas,
        requerLaser = @requerLaser,
        requer_laser = @requer_laser,
        status = @status,
        atualizadoEm = @atualizadoEm
    WHERE id = @id
  `);

  for (const o of todasOrdens) {
    const rawNum = o.numero || o.id;
    const isSpecific024644 = String(rawNum).includes('024644-01');
    const isLaserExc = isLaserExclusivoSql(o.codigo, o.descricao) || isSpecific024644;
    const isLaserDob = !isLaserExc && isLaserDobraSql(o.codigo, o.descricao);
    const isRouterExc = !isLaserExc && !isLaserDob && isRouterExclusivoSql(o.codigo, o.descricao);

    // Checar se a OP ainda está pendente ou não iniciada (ou se é a OP 024644-01)
    const semApontamento = !db.prepare('SELECT 1 FROM apontamentos WHERE op_numero = ? OR op_numero = ? LIMIT 1').get(o.id, o.numero);
    const podeAtualizar = semApontamento || isSpecific024644;

    if (isLaserExc && podeAtualizar) {
      let etapas = [];
      try { etapas = JSON.parse(o.etapas || '[]'); } catch {}
      const precisaAtualizar = !Array.isArray(etapas) || etapas.length !== 1 || etapas[0] !== 'Laser' || !o.requerLaser || String(o.status || '').includes('Corte');
      if (precisaAtualizar) {
        updateStmt.run({
          id: o.id,
          etapas: JSON.stringify(['Laser']),
          requerLaser: 1,
          requer_laser: 1,
          status: 'Aguardando Início em: Laser',
          atualizadoEm: Date.now()
        });
        ordensAtualizadasCount++;
        console.log(`[SQLite Migration] OP ${o.numero} (${o.codigo}) atualizada para Rota Exclusiva Laser`);
      }
    } else if (isLaserDob && podeAtualizar) {
      let etapas = [];
      try { etapas = JSON.parse(o.etapas || '[]'); } catch {}
      const precisaAtualizar = !Array.isArray(etapas) || JSON.stringify(etapas) !== JSON.stringify(['Laser', 'Dobra']) || !o.requerLaser;
      if (precisaAtualizar) {
        updateStmt.run({
          id: o.id,
          etapas: JSON.stringify(['Laser', 'Dobra']),
          requerLaser: 1,
          requer_laser: 1,
          status: 'Aguardando Início em: Laser',
          atualizadoEm: Date.now()
        });
        ordensAtualizadasCount++;
        console.log(`[SQLite Migration] OP ${o.numero} (${o.codigo}) atualizada para Laser + Dobra`);
      }
    } else if (isRouterExc && podeAtualizar) {
      let etapas = [];
      try { etapas = JSON.parse(o.etapas || '[]'); } catch {}
      const precisaAtualizar = !Array.isArray(etapas) || etapas.length !== 1 || etapas[0] !== 'Router' || !String(o.status || '').includes('Router');
      if (precisaAtualizar) {
        updateStmt.run({
          id: o.id,
          etapas: JSON.stringify(['Router']),
          requerLaser: 0,
          requer_laser: 0,
          status: 'Aguardando Início em: Router',
          atualizadoEm: Date.now()
        });
        ordensAtualizadasCount++;
        console.log(`[SQLite Migration] OP ${o.numero} (${o.codigo}) atualizada para Rota Exclusiva Router`);
      }
    }

    // Saneamento de Rotas Oficiais Office Door (Giro e Correr)
    const isOdCorrer = isOfficeDoorCorrerSql(o.codigo, o.descricao, o.tipoOrdem);
    const isOdGiro = !isOdCorrer && isOfficeDoorGiroSql(o.codigo, o.descricao, o.tipoOrdem);

    if (isOdGiro && (podeAtualizar || o.status !== 'FINALIZADA')) {
      const querRouter = Boolean(o.requerRouter || o.requer_router || o.encaminhar_router);
      const targetSteps = querRouter
        ? ['Instalação de Gaxeta', 'Router', 'Montagem de Office Door Giro']
        : ['Instalação de Gaxeta', 'Montagem de Office Door Giro'];

      let precisaAtualizar = false;
      let novasEtapas = targetSteps;
      let novoStatus = o.status;

      try {
        const parsed = JSON.parse(o.etapas || '[]');
        if (Array.isArray(parsed)) {
          if (JSON.stringify(parsed) !== JSON.stringify(targetSteps)) {
            precisaAtualizar = true;
            novasEtapas = targetSteps;
          }
        } else if (parsed && typeof parsed === 'object') {
          const obj = { ...parsed };

          // 1. Migrar etapas antigas ou indevidas de montagem para "Montagem de Office Door Giro"
          const oldMontagemGiro =
            obj['Montagem de Portas Giratória Padrão e Especial'] ||
            obj['Montagem de Portas Giratórias'] ||
            obj['Montagem Office Door Giratória'] ||
            obj['Montagem Office Door'] ||
            obj['Montagem Portas Office Door'];

          if (oldMontagemGiro) {
            if (!obj['Montagem de Office Door Giro'] || obj['Montagem de Office Door Giro'].status === 'PENDENTE') {
              obj['Montagem de Office Door Giro'] = oldMontagemGiro;
            }
            delete obj['Montagem de Portas Giratória Padrão e Especial'];
            delete obj['Montagem de Portas Giratórias'];
            delete obj['Montagem Office Door Giratória'];
            delete obj['Montagem Office Door'];
            delete obj['Montagem Portas Office Door'];
            precisaAtualizar = true;
          }

          // 2. Remover compulsoriamente etapas fabris de corte/laser/dobra/preparação/injeção
          const etapasFabrisRemover = [
            'Corte',
            'Laser',
            'Dobra',
            'Preparação de Folha',
            'Preparação',
            'Injeção',
            'Injeção de Folhas',
            'Montagem de Portas Giratória Padrão e Especial',
            'Montagem de Portas Giratórias'
          ];
          for (const etapaNome of etapasFabrisRemover) {
            if (obj[etapaNome]) {
              delete obj[etapaNome];
              precisaAtualizar = true;
            }
          }

          // 3. Garantir etapas oficiais no objeto
          for (const step of targetSteps) {
            if (!obj[step]) {
              obj[step] = { status: 'PENDENTE', concluidas: 0, total: o.quantidadeFisica || 1 };
              precisaAtualizar = true;
            }
          }

          // 4. Remover Router se não for requerido
          if (!querRouter && obj['Router'] && obj['Router'].status === 'PENDENTE') {
            delete obj['Router'];
            precisaAtualizar = true;
          }

          // 5. Preservar apontamentos reais da OP
          try {
            const aptsGaxeta = db.prepare("SELECT * FROM apontamentos WHERE op_numero = ? AND etapa_rota = 'Instalação de Gaxeta' AND status = 'FINALIZADO'").all(o.numero);
            if (aptsGaxeta && aptsGaxeta.length > 0 && obj['Instalação de Gaxeta']) {
              if (obj['Instalação de Gaxeta'].status !== 'CONCLUIDA') {
                obj['Instalação de Gaxeta'] = {
                  ...obj['Instalação de Gaxeta'],
                  status: 'CONCLUIDA',
                  concluidas: o.quantidadeFisica || 1
                };
                precisaAtualizar = true;
              }
            }
            const aptsMontagem = db.prepare("SELECT * FROM apontamentos WHERE op_numero = ? AND (etapa_rota = 'Montagem de Office Door Giro' OR setor LIKE '%Office Door%' OR setor LIKE '%Girat%') AND status = 'EM_ANDAMENTO'").all(o.numero);
            if (aptsMontagem && aptsMontagem.length > 0 && obj['Montagem de Office Door Giro']) {
              const apt = aptsMontagem[0];
              if (obj['Montagem de Office Door Giro'].status !== 'EM_PRODUCAO') {
                obj['Montagem de Office Door Giro'] = {
                  ...obj['Montagem de Office Door Giro'],
                  status: 'EM_PRODUCAO',
                  inicio: apt.hora_inicio,
                  horaInicio: apt.hora_inicio,
                  operador: apt.operador || apt.colaborador,
                  operadorNome: apt.operador || apt.colaborador
                };
                precisaAtualizar = true;
              }
            }
          } catch (errSync) {
            console.warn(`[Office Door Migration] Erro ao sincronizar status da OP ${o.numero}:`, errSync);
          }

          if (precisaAtualizar) {
            novasEtapas = obj;
          }
        } else {
          precisaAtualizar = true;
          novasEtapas = targetSteps;
        }
      } catch {
        precisaAtualizar = true;
        novasEtapas = targetSteps;
      }

      const isPendenteOuAguardando = !o.status || o.status === 'pendente' || o.status.toLowerCase().startsWith('aguardando início') || o.status.toLowerCase().startsWith('aguardando inicio');
      if (isPendenteOuAguardando && semApontamento) {
        novoStatus = 'Aguardando Início em: Instalação de Gaxeta';
      } else if (novasEtapas && typeof novasEtapas === 'object' && !Array.isArray(novasEtapas)) {
        if (novasEtapas['Montagem de Office Door Giro'] && (novasEtapas['Montagem de Office Door Giro'].status === 'EM_PRODUCAO' || novasEtapas['Montagem de Office Door Giro'].status === 'EM_ANDAMENTO')) {
          novoStatus = 'EM_PRODUCAO';
        }
      }

      if (precisaAtualizar) {
        db.prepare(`
          UPDATE ordens 
          SET etapas = ?,
              status = COALESCE(?, status),
              atualizadoEm = ?
          WHERE id = ?
        `).run(JSON.stringify(novasEtapas), novoStatus, Date.now(), o.id);
        ordensAtualizadasCount++;
        console.log(`[SQLite Migration] OP ${o.numero} (${o.codigo}) saneada para rota oficial Office Door Giro`);
      }
    } else if (isOdCorrer && (podeAtualizar || o.status !== 'FINALIZADA')) {
      const querRouter = Boolean(o.requerRouter || o.requer_router || o.encaminhar_router);
      const targetSteps = querRouter
        ? ['Corte', 'Corte Alumínio', 'Preparação Office Door Correr', 'Injeção', 'Router', 'Montagem Office de Correr']
        : ['Corte', 'Corte Alumínio', 'Preparação Office Door Correr', 'Injeção', 'Montagem Office de Correr'];

      let precisaAtualizar = false;
      let novasEtapas = targetSteps;
      let novoStatus = o.status;

      try {
        const parsed = JSON.parse(o.etapas || '[]');
        if (Array.isArray(parsed)) {
          if (JSON.stringify(parsed) !== JSON.stringify(targetSteps)) {
            precisaAtualizar = true;
            novasEtapas = targetSteps;
          }
        } else if (parsed && typeof parsed === 'object') {
          const obj = { ...parsed };
          if (obj['Preparação Office Door']) {
            obj['Preparação Office Door Correr'] = obj['Preparação Office Door'];
            delete obj['Preparação Office Door'];
            precisaAtualizar = true;
          }
          if (obj['Montagem Office Door Correr']) {
            obj['Montagem Office de Correr'] = obj['Montagem Office Door Correr'];
            delete obj['Montagem Office Door Correr'];
            precisaAtualizar = true;
          }
          if (querRouter && !obj['Router']) {
            obj['Router'] = { status: 'PENDENTE', concluidas: 0, total: o.quantidadeFisica || 1 };
            precisaAtualizar = true;
          }
          if (precisaAtualizar) {
            novasEtapas = obj;
          }
        } else {
          precisaAtualizar = true;
          novasEtapas = targetSteps;
        }
      } catch {
        precisaAtualizar = true;
        novasEtapas = targetSteps;
      }

      const isPendenteOuAguardando = !o.status || o.status === 'pendente' || o.status.toLowerCase().startsWith('aguardando início') || o.status.toLowerCase().startsWith('aguardando inicio');
      if (isPendenteOuAguardando && semApontamento) {
        novoStatus = 'Aguardando Início em: Corte';
      }

      if (precisaAtualizar) {
        db.prepare(`
          UPDATE ordens 
          SET etapas = ?,
              status = COALESCE(?, status),
              atualizadoEm = ?
          WHERE id = ?
        `).run(JSON.stringify(novasEtapas), novoStatus, Date.now(), o.id);
        ordensAtualizadasCount++;
        console.log(`[SQLite Migration] OP ${o.numero} (${o.codigo}) saneada para rota oficial Office Door Correr`);
      }
    }
  }

  // Migração retroativa de apontamentos de Office Door Giro
  try {
    const resApts = db.prepare(`
      UPDATE apontamentos
      SET setor = 'Montagem de Office Door Giro',
          setorFisico = 'Montagem de Office Door Giro',
          etapa_rota = 'Montagem de Office Door Giro'
      WHERE (
        setor LIKE '%Montagem%Girat%' OR 
        etapa_rota LIKE '%Montagem%Girat%' OR
        setor LIKE '%Montagem%Office%' OR
        etapa_rota LIKE '%Montagem%Office%'
      )
      AND op_numero IN (
        SELECT numero FROM ordens 
        WHERE (descricao LIKE '%OFFICE DOOR%' AND (descricao LIKE '%GIR%' OR descricao LIKE '%GIRO%'))
           OR codigo LIKE '009.%'
      )
    `).run();
    if (resApts.changes > 0) {
      console.log(`[SQLite Migration] ${resApts.changes} apontamento(s) de Office Door Giro migrado(s) para 'Montagem de Office Door Giro'`);
    }
  } catch (errApts) {
    console.error('[SQLite Migration] Erro ao migrar apontamentos de Office Door Giro:', errApts);
  }

  if (ordensAtualizadasCount > 0) {
    console.log(`[SQLite Migration] Total de ordens saneadas para novas rotas Nomus: ${ordensAtualizadasCount}`);
  }
} catch (e) {
  console.warn('[SQLite Migration] Erro na varredura retroativa de rotas:', e);
}

// Helper para formatar ordens
function obterTodasOrdens() {
  return db.prepare('SELECT * FROM ordens').all().map(r => {
    let extra = {};
    try { if (r.dados) extra = JSON.parse(r.dados); } catch {}
    return {
      ...extra,
      ...r,
      requerLaser: Boolean(r.requerLaser || r.requer_laser || extra.requerLaser || extra.requer_laser),
      requer_laser: Boolean(r.requerLaser || r.requer_laser || extra.requerLaser || extra.requer_laser),
      requerRouter: Boolean(r.requerRouter || r.requer_router || r.encaminhar_router || extra.requerRouter || extra.requer_router),
      requer_router: Boolean(r.requerRouter || r.requer_router || r.encaminhar_router || extra.requerRouter || extra.requer_router),
      encaminhar_router: Boolean(r.requerRouter || r.requer_router || r.encaminhar_router || extra.encaminhar_router),
      etapas: typeof r.etapas === 'string' ? JSON.parse(r.etapas || '[]') : (r.etapas || []),
      ocorrencias: typeof r.ocorrencias === 'string' ? JSON.parse(r.ocorrencias || '[]') : (r.ocorrencias || [])
    };
  });
}

// Rotas da API REST

// Helper para formatar colaboradores
function obterColaboradores() {
  const rows = db.prepare('SELECT * FROM colaboradores WHERE ativo = 1 OR ativo IS NULL').all();
  if (rows.length === 0) {
    return COLABORADORES_PADRAO.map(c => {
      const p = (c.nome || '').trim().split(/\s+/).filter(Boolean);
      const inits = p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
      return {
        ...c,
        initials: inits,
        name: c.nome,
        cracha: c.badge || c.codigo || '',
        funcao: c.funcao || (c.especialista ? 'Especialista' : 'Operador'),
        sectors: c.setores
      };
    });
  }
  return rows.map(r => {
    let extra = {};
    try { extra = JSON.parse(r.dados || '{}'); } catch {}
    const parsedTerminais = typeof r.terminais === 'string' ? JSON.parse(r.terminais || '[]') : (r.terminais || []);
    const parsedSetores = typeof r.setores === 'string' ? JSON.parse(r.setores || '[]') : (r.setores || []);
    const partesNome = (r.nome || '').trim().split(/\s+/).filter(Boolean);
    const initials = (extra.initials && String(extra.initials).trim())
      ? String(extra.initials).trim().toUpperCase()
      : (partesNome.length === 1
        ? partesNome[0].slice(0, 2).toUpperCase()
        : partesNome.length >= 2
        ? (partesNome[0][0] + partesNome[partesNome.length - 1][0]).toUpperCase()
        : 'OP');
    const badgeVal = r.badge || r.codigo || r.cracha || extra.badge || '';
    const funcaoVal = r.funcao || extra.funcao || extra.role || (r.especialista ? 'Especialista' : 'Operador');

    return {
      ...extra,
      id: r.id,
      nome: r.nome,
      name: r.nome,
      initials,
      badge: badgeVal,
      codigo: badgeVal,
      cracha: badgeVal,
      funcao: funcaoVal,
      role: funcaoVal,
      terminais: parsedTerminais,
      setores: parsedSetores,
      sectors: parsedSetores,
      setoresPorTerminal: extra.setoresPorTerminal || undefined,
      especialista: Boolean(r.especialista),
      especialistaVolante: Boolean(r.especialista),
      isRoaming: Boolean(r.especialista || extra.isRoaming),
      ativo: Boolean(r.ativo !== 0)
    };
  });
}

// 1.0 Status da última sincronização do Nomus ERP (em tempo real)
app.get('/api/sync-status', (req, res) => {
  res.json(ultimaSyncNomus || { timestamp: null, totalProcessadas: 0, origem: null });
});

// 1. Listagem de ordens
app.get('/api/ordens', (req, res) => {
  if (ultimaSyncNomus) {
    res.setHeader('X-Nomus-Sync-Timestamp', ultimaSyncNomus.timestamp || '');
    res.setHeader('X-Nomus-Sync-Total', String(ultimaSyncNomus.totalProcessadas || 0));
  }
  res.json(obterTodasOrdens());
});

// 1.1 Status e cronômetro em tempo real de uma OP
app.get('/api/ordens/:identificador/status', (req, res) => {
  const { identificador } = req.params;
  const cleanId = normalizarIdOP(identificador);
  const formatId = formatarNumeroOP(cleanId);
  const opRow = db.prepare('SELECT * FROM ordens WHERE id = ? OR id = ? OR numero = ? OR numero = ?').get(identificador, cleanId, formatId, cleanId);
  if (!opRow) return res.status(404).json({ error: 'Ordem não encontrada' });

  const apts = db.prepare(`
    SELECT * FROM apontamentos 
    WHERE op_numero = ? OR op_numero = ? OR op_numero = ?
    ORDER BY criadoEm DESC
  `).all(identificador, cleanId, formatId);

  res.json({
    id: opRow.id,
    numero: opRow.numero,
    status: opRow.status,
    etapas: JSON.parse(opRow.etapas || '[]'),
    requerLaser: Boolean(opRow.requerLaser || opRow.requer_laser),
    requer_laser: Boolean(opRow.requerLaser || opRow.requer_laser),
    requerRouter: Boolean(opRow.requerRouter || opRow.requer_router || opRow.encaminhar_router),
    requer_router: Boolean(opRow.requerRouter || opRow.requer_router || opRow.encaminhar_router),
    encaminhar_router: Boolean(opRow.requerRouter || opRow.requer_router || opRow.encaminhar_router),
    quantidadeFisica: opRow.quantidadeFisica,
    atualizadoEm: opRow.atualizadoEm,
    apontamentos: apts,
    serverTime: new Date().toISOString(),
    serverTimestamp: Date.now()
  });
});

// 1.2 Gestão e Sincronização de Colaboradores
app.get('/api/colaboradores', (req, res) => {
  res.json(obterColaboradores());
});

app.post('/api/colaboradores', (req, res) => {
  try {
    console.log('[API] Colaborador atualizado e emitido via socket:', req.body);
    const lista = Array.isArray(req.body)
      ? req.body
      : (Array.isArray(req.body?.colaboradores) ? req.body.colaboradores : [req.body]);

    const stmt = db.prepare(`
      INSERT INTO colaboradores (id, nome, badge, codigo, cracha, funcao, terminais, setores, especialista, ativo, dados, atualizadoEm)
      VALUES (@id, @nome, @badge, @codigo, @cracha, @funcao, @terminais, @setores, @especialista, @ativo, @dados, @atualizadoEm)
      ON CONFLICT(id) DO UPDATE SET
        nome = excluded.nome,
        badge = excluded.badge,
        codigo = excluded.codigo,
        cracha = excluded.cracha,
        funcao = excluded.funcao,
        terminais = excluded.terminais,
        setores = excluded.setores,
        especialista = excluded.especialista,
        ativo = excluded.ativo,
        dados = excluded.dados,
        atualizadoEm = excluded.atualizadoEm
    `);

    const now = Date.now();
    const tx = db.transaction((items) => {
      for (const item of items) {
        if (!item || (!item.id && !item.nome && !item.name)) continue;
        const nome = String(item.nome || item.name || '').trim();
        const id = String(item.id || nome).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '_').substring(0, 30);
        const cracha = String(item.cracha || item.badge || item.codigo || '').trim();
        const funcao = String(item.funcao || item.role || '').trim();
        const terminaisJson = JSON.stringify(Array.isArray(item.terminais) ? item.terminais : []);
        const setoresJson = JSON.stringify(Array.isArray(item.setores) ? item.setores : (Array.isArray(item.sectors) ? item.sectors : []));
        const especialista = (item.especialista || item.isRoaming || item.especialistaVolante) ? 1 : 0;
        const ativo = item.ativo !== false ? 1 : 0;

        stmt.run({
          id,
          nome,
          badge: cracha,
          codigo: cracha,
          cracha,
          funcao,
          terminais: terminaisJson,
          setores: setoresJson,
          especialista,
          ativo,
          dados: JSON.stringify(item),
          atualizadoEm: now
        });
      }
    });

    tx(lista);
    const todosColabs = obterColaboradores();
    io.emit('colaboradores_atualizados', todosColabs);
    res.json({ success: true, colaboradores: todosColabs, count: todosColabs.length });
  } catch (err) {
    console.error('[API] Erro ao cadastrar colaborador:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/colaboradores/:id', (req, res) => {
  try {
    const paramId = req.params.id;
    const body = req.body || {};
    console.log('[API] Colaborador atualizado e emitido via socket:', body);

    const nome = String(body.nome || body.name || paramId).trim();
    const targetId = String(body.id || paramId).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '_').substring(0, 30);
    const cracha = String(body.cracha || body.badge || body.codigo || '').trim();
    const funcao = String(body.funcao || body.role || '').trim();
    const terminaisJson = JSON.stringify(Array.isArray(body.terminais) ? body.terminais : []);
    const setoresJson = JSON.stringify(Array.isArray(body.setores) ? body.setores : (Array.isArray(body.sectors) ? body.sectors : []));
    const especialista = (body.especialista || body.isRoaming || body.especialistaVolante) ? 1 : 0;
    const ativo = body.ativo !== false ? 1 : 0;
    const dados = JSON.stringify(body);
    const now = Date.now();

    const existing = db.prepare('SELECT id FROM colaboradores WHERE id = ? OR LOWER(nome) = LOWER(?)').get(paramId, paramId);
    if (existing) {
      db.prepare(`
        UPDATE colaboradores 
        SET id = ?, nome = ?, badge = ?, codigo = ?, cracha = ?, funcao = ?, terminais = ?, setores = ?, especialista = ?, ativo = ?, dados = ?, atualizadoEm = ?
        WHERE id = ?
      `).run(targetId, nome, cracha, cracha, cracha, funcao, terminaisJson, setoresJson, especialista, ativo, dados, now, existing.id);
    } else {
      db.prepare(`
        INSERT INTO colaboradores (id, nome, badge, codigo, cracha, funcao, terminais, setores, especialista, ativo, dados, atualizadoEm)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          nome = excluded.nome,
          badge = excluded.badge,
          codigo = excluded.codigo,
          cracha = excluded.cracha,
          funcao = excluded.funcao,
          terminais = excluded.terminais,
          setores = excluded.setores,
          especialista = excluded.especialista,
          ativo = excluded.ativo,
          dados = excluded.dados,
          atualizadoEm = excluded.atualizadoEm
      `).run(targetId, nome, cracha, cracha, cracha, funcao, terminaisJson, setoresJson, especialista, ativo, dados, now);
    }

    const todosColabs = obterColaboradores();
    io.emit('colaboradores_atualizados', todosColabs);
    res.json({ success: true, colaboradores: todosColabs });
  } catch (err) {
    console.error('[API] Erro ao atualizar colaborador:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/colaboradores/:id', (req, res) => {
  try {
    const { id } = req.params;
    console.log('[API] Colaborador removido e emitido via socket:', id);
    db.prepare('DELETE FROM colaboradores WHERE id = ? OR LOWER(nome) = LOWER(?)').run(id, id);
    const todosColabs = obterColaboradores();
    io.emit('colaboradores_atualizados', todosColabs);
    res.json({ success: true, colaboradores: todosColabs });
  } catch (err) {
    console.error('[API] Erro ao excluir colaborador:', err);
    res.status(500).json({ error: err.message });
  }
});

function obterTerminais() {
  const rows = db.prepare('SELECT * FROM terminais ORDER BY id ASC').all();
  return rows.map(r => {
    let secs = [];
    try {
      secs = JSON.parse(r.sectors || '[]');
    } catch {}
    const cleanSecs = Array.isArray(secs)
      ? Array.from(new Set(secs.map(sanitizeSectorEncoding).filter(Boolean)))
      : [];
    return {
      id: r.id,
      name: r.name,
      label: r.label,
      sectors: cleanSecs,
      setores: cleanSecs,
      atualizadoEm: r.atualizadoEm
    };
  });
}

app.get('/api/terminais', (req, res) => {
  try {
    const list = obterTerminais();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post(['/api/terminais', '/api/configuracoes/terminais'], (req, res) => {
  try {
    const terminals = req.body.terminals || req.body.terminais || (Array.isArray(req.body) ? req.body : null);
    if (!Array.isArray(terminals)) return res.status(400).json({ error: 'Terminais inválidos' });

    const stmt = db.prepare(`
      INSERT INTO terminais (id, name, label, sectors, atualizadoEm)
      VALUES (@id, @name, @label, @sectors, @atualizadoEm)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        label = excluded.label,
        sectors = excluded.sectors,
        atualizadoEm = excluded.atualizadoEm
    `);

    const now = Date.now();
    const tx = db.transaction((terms) => {
      for (const t of terms) {
        const rawSecs = Array.isArray(t.sectors) ? t.sectors : (Array.isArray(t.setores) ? t.setores : []);
        const secs = Array.from(new Set(rawSecs.map(sanitizeSectorEncoding).filter(Boolean)));
        stmt.run({
          id: Number(t.id),
          name: String(t.name || `Terminal ${t.id}`),
          label: String(t.label || ''),
          sectors: JSON.stringify(secs),
          atualizadoEm: now
        });
      }
    });

    tx(terminals);
    const atualizados = obterTerminais();
    io.emit('terminais_atualizados', atualizados);
    io.emit('setores_atualizados', atualizados);
    res.json({ success: true, count: atualizados.length, terminals: atualizados });
  } catch (err) {
    console.error('Erro ao salvar terminais:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/terminais/:id', (req, res) => {
  try {
    const termId = Number(req.params.id);
    const { name, label, sectors, setores } = req.body;
    const rawSecs = Array.isArray(sectors) ? sectors : (Array.isArray(setores) ? setores : []);
    const secs = Array.from(new Set(rawSecs.map(sanitizeSectorEncoding).filter(Boolean)));

    const existing = db.prepare('SELECT * FROM terminais WHERE id = ?').get(termId);
    const now = Date.now();
    const finalName = name || (existing ? existing.name : `Terminal ${termId}`);
    const finalLabel = label !== undefined ? label : (existing ? existing.label : '');

    db.prepare(`
      INSERT INTO terminais (id, name, label, sectors, atualizadoEm)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        label = excluded.label,
        sectors = excluded.sectors,
        atualizadoEm = excluded.atualizadoEm
    `).run(termId, finalName, finalLabel, JSON.stringify(secs), now);

    const atualizados = obterTerminais();
    io.emit('terminais_atualizados', atualizados);
    io.emit('setores_atualizados', atualizados);
    res.json({ success: true, terminalId: termId, terminals: atualizados });
  } catch (err) {
    console.error('Erro ao atualizar terminal via PUT:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/terminais/:id/setores/:setor', (req, res) => {
  try {
    const termId = Number(req.params.id);
    const sectorName = decodeURIComponent(req.params.setor || '').trim();
    if (!sectorName) return res.status(400).json({ error: 'Nome do setor obrigatório' });

    const row = db.prepare('SELECT * FROM terminais WHERE id = ?').get(termId);
    if (!row) return res.status(404).json({ error: 'Terminal não encontrado' });

    let sectors = JSON.parse(row.sectors || '[]');
    sectors = sectors.filter(s => s.toLowerCase() !== sectorName.toLowerCase());

    const now = Date.now();
    db.prepare('UPDATE terminais SET sectors = ?, atualizadoEm = ? WHERE id = ?')
      .run(JSON.stringify(sectors), now, termId);

    const atualizados = obterTerminais();
    io.emit('terminais_atualizados', atualizados);
    io.emit('setores_atualizados', atualizados);
    res.json({ success: true, terminalId: termId, sectorRemoved: sectorName, terminals: atualizados });
  } catch (err) {
    console.error('Erro ao remover setor do terminal:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/terminais/:id/setores', (req, res) => {
  try {
    const termId = Number(req.params.id);
    const { sectorName, setor } = req.body;
    const rawClean = String(sectorName || setor || '').trim();
    if (!rawClean) return res.status(400).json({ error: 'Nome do setor obrigatório' });
    const clean = sanitizeSectorEncoding(rawClean);

    const row = db.prepare('SELECT * FROM terminais WHERE id = ?').get(termId);
    let sectors = [];
    if (row) {
      sectors = JSON.parse(row.sectors || '[]');
    }
    sectors = sectors.map(sanitizeSectorEncoding);
    if (!sectors.some(s => s.toLowerCase() === clean.toLowerCase())) {
      sectors.push(clean);
    }
    sectors = Array.from(new Set(sectors));

    const now = Date.now();
    db.prepare(`
      INSERT INTO terminais (id, name, label, sectors, atualizadoEm)
      VALUES (@id, @name, @label, @sectors, @atualizadoEm)
      ON CONFLICT(id) DO UPDATE SET
        sectors = excluded.sectors,
        atualizadoEm = excluded.atualizadoEm
    `).run({
      id: termId,
      name: row ? row.name : `Terminal ${termId}`,
      label: row ? row.label : '',
      sectors: JSON.stringify(sectors),
      atualizadoEm: now
    });

    const atualizados = obterTerminais();
    io.emit('terminais_atualizados', atualizados);
    io.emit('setores_atualizados', atualizados);
    res.json({ success: true, terminalId: termId, sector: clean, terminals: atualizados });
  } catch (err) {
    console.error('Erro ao adicionar setor ao terminal:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Limpeza de duplicadas com normalização rigorosa
app.post('/api/ordens/limpar-duplicadas', (req, res) => {
  const todasOrdensBrutas = db.prepare('SELECT rowid, id, numero, atualizadoEm FROM ordens ORDER BY atualizadoEm DESC').all();
  const seenNorm = new Set();
  const idsParaExcluir = [];
  const paraNormalizar = [];

  for (const row of todasOrdensBrutas) {
    const clean = normalizarIdOP(row.numero || row.id);
    if (!clean) {
      idsParaExcluir.push(row.rowid);
      continue;
    }
    if (seenNorm.has(clean)) {
      idsParaExcluir.push(row.rowid);
    } else {
      seenNorm.add(clean);
      const canonicalNum = formatarNumeroOP(clean);
      if (row.id !== canonicalNum || row.numero !== canonicalNum) {
        paraNormalizar.push({ rowid: row.rowid, canonicalNum });
      }
    }
  }

  if (idsParaExcluir.length > 0) {
    const delStmt = db.prepare('DELETE FROM ordens WHERE rowid = ?');
    const delTx = db.transaction((list) => {
      for (const rid of list) delStmt.run(rid);
    });
    delTx(idsParaExcluir);
  }

  if (paraNormalizar.length > 0) {
    const normStmt = db.prepare('UPDATE ordens SET id = ?, numero = ? WHERE rowid = ?');
    const normTx = db.transaction((list) => {
      for (const item of list) {
        normStmt.run(item.canonicalNum, item.canonicalNum, item.rowid);
      }
    });
    normTx(paraNormalizar);
  }

  const todas = obterTodasOrdens();
  io.emit('ordens_atualizadas', todas);
  res.json({ success: true, removidas: idsParaExcluir.length, padronizadas: paraNormalizar.length, total: todas.length });
});

// 3. Importação ou criação de ordens (com UPSERT anti-duplicação)
app.post('/api/ordens', (req, res) => {
  const { ordens, replaceAll, modoImportacao } = req.body;
  if (!Array.isArray(ordens)) return res.status(400).json({ error: 'Formato inválido' });

  // Se substituir: remove APENAS ordens não iniciadas para renovar a carga sem apagar OPs em andamento
  const deveSubstituir = modoImportacao === 'substituir' || replaceAll === true;
  if (deveSubstituir) {
    db.prepare(`
      DELETE FROM ordens 
      WHERE (
        status = 'pendente' 
        OR status LIKE 'Aguardando Início%' 
        OR status = 'Liberada' 
        OR status = 'LIBERADA'
        OR status = 'Produzindo Hoje'
        OR status = 'Falta Injetar'
        OR status IS NULL
      )
    `).run();
  }

  // UPSERT inteligente com ON CONFLICT(numero)
  const stmt = db.prepare(`
    INSERT INTO ordens (
      id, numero, codigo, descricao, cliente, tipoOrdem, status, etapas, quantidadeFisica, requerLaser, requer_laser, requerRouter, requer_router, encaminhar_router, criadoEm, atualizadoEm
    ) VALUES (
      @id, @numero, @codigo, @descricao, @cliente, @tipoOrdem, @status, @etapas, @quantidadeFisica, @requerLaser, @requer_laser, @requerRouter, @requer_router, @encaminhar_router, @criadoEm, @atualizadoEm
    )
    ON CONFLICT(numero) DO UPDATE SET
      id = excluded.id,
      codigo = CASE WHEN excluded.codigo != '' THEN excluded.codigo ELSE ordens.codigo END,
      descricao = CASE WHEN excluded.descricao != '' THEN excluded.descricao ELSE ordens.descricao END,
      cliente = CASE WHEN excluded.cliente != '' THEN excluded.cliente ELSE ordens.cliente END,
      tipoOrdem = CASE WHEN excluded.tipoOrdem != '' THEN excluded.tipoOrdem ELSE ordens.tipoOrdem END,
      quantidadeFisica = excluded.quantidadeFisica,
      requerLaser = CASE WHEN excluded.requerLaser = 1 THEN 1 ELSE ordens.requerLaser END,
      requer_laser = CASE WHEN excluded.requer_laser = 1 THEN 1 ELSE ordens.requer_laser END,
      requerRouter = CASE WHEN excluded.requerRouter = 1 THEN 1 ELSE ordens.requerRouter END,
      requer_router = CASE WHEN excluded.requer_router = 1 THEN 1 ELSE ordens.requer_router END,
      encaminhar_router = CASE WHEN excluded.encaminhar_router = 1 THEN 1 ELSE ordens.encaminhar_router END,
      status = CASE 
        WHEN ordens.status = 'pendente' OR ordens.status LIKE 'Aguardando Início%' OR ordens.status = 'Liberada' OR ordens.status = 'LIBERADA' OR ordens.status IS NULL 
        THEN excluded.status 
        ELSE ordens.status 
      END,
      etapas = CASE 
        WHEN ordens.status = 'pendente' OR ordens.status LIKE 'Aguardando Início%' OR ordens.status = 'Liberada' OR ordens.status = 'LIBERADA' OR ordens.status IS NULL 
        THEN excluded.etapas 
        ELSE ordens.etapas 
      END,
      atualizadoEm = excluded.atualizadoEm
  `);

  const transacao = db.transaction((lista) => {
    for (const item of lista) {
      const cleanId = normalizarIdOP(item.numero || item.id);
      if (!cleanId) continue;
      const formattedNum = formatarNumeroOP(cleanId);
      let laserVal = Boolean(item.requerLaser || item.requer_laser) ? 1 : 0;
      let routerVal = Boolean(item.requerRouter || item.requer_router || item.encaminhar_router) ? 1 : 0;
      let etapasVal = item.etapas || [];
      let statusVal = item.status || 'pendente';

      const codItem = item.codigo || item.codigoProduto || '';
      const descItem = item.descricao || item.produto || '';

      if (isLaserExclusivoSql(codItem, descItem) || formattedNum.includes('024644-01')) {
        etapasVal = ['Laser'];
        laserVal = 1;
        if (!statusVal || statusVal.includes('Aguardando Início') || statusVal === 'pendente') {
          statusVal = 'Aguardando Início em: Laser';
        }
      } else if (isLaserDobraSql(codItem, descItem)) {
        etapasVal = ['Laser', 'Dobra'];
        laserVal = 1;
        if (!statusVal || statusVal.includes('Aguardando Início') || statusVal === 'pendente') {
          statusVal = 'Aguardando Início em: Laser';
        }
      } else if (isRouterExclusivoSql(codItem, descItem)) {
        etapasVal = ['Router'];
        routerVal = 1;
        if (!statusVal || statusVal.includes('Aguardando Início') || statusVal === 'pendente') {
          statusVal = 'Aguardando Início em: Router';
        }
      }

      stmt.run({
        id: formattedNum,
        numero: formattedNum,
        codigo: item.codigo || item.codigoProduto || '',
        descricao: item.descricao || item.produto || '',
        cliente: item.cliente || '',
        tipoOrdem: item.tipoOrdem || 'Padrão',
        status: statusVal,
        etapas: JSON.stringify(etapasVal),
        quantidadeFisica: Number(item.quantidadeFisica || item.quantidade_total || item.quantidade || 1),
        requerLaser: laserVal,
        requer_laser: laserVal,
        requerRouter: routerVal,
        requer_router: routerVal,
        encaminhar_router: routerVal,
        criadoEm: Number(item.criadoEm || Date.now()),
        atualizadoEm: Date.now()
      });
    }
  });

  transacao(ordens);

  // Garantia absoluta de deduplicação pós-inserção
  const todasOrdensBrutas = db.prepare('SELECT rowid, id, numero, atualizadoEm FROM ordens ORDER BY atualizadoEm DESC').all();
  const seenNorm = new Set();
  const idsParaExcluir = [];
  for (const row of todasOrdensBrutas) {
    const clean = normalizarIdOP(row.numero || row.id);
    if (!clean || seenNorm.has(clean)) {
      idsParaExcluir.push(row.rowid);
    } else {
      seenNorm.add(clean);
    }
  }
  if (idsParaExcluir.length > 0) {
    const delStmt = db.prepare('DELETE FROM ordens WHERE rowid = ?');
    const delTx = db.transaction((list) => {
      for (const rid of list) delStmt.run(rid);
    });
    delTx(idsParaExcluir);
  }
  
  const todas = obterTodasOrdens();
  io.emit('ordens_atualizadas', todas);
  registrarSyncNomus(ordens.length, req.body.origem || (deveSubstituir ? 'substituir' : 'manual'));
  res.json({ success: true, count: todas.length });
});

// =========================================================================
// 3.1 ENDPOINT RECEPTOR AUTOMÁTICO DO NOMUS (TAMPERMONKEY USERSCRIPT)
// =========================================================================
app.options('/api/importar-nomus-auto', cors());

app.post('/api/importar-nomus-auto', (req, res) => {
  try {
    const rawHtml = (typeof req.body === 'string' ? req.body : req.body?.html) || '';
    if (!rawHtml || !rawHtml.trim()) {
      return res.status(400).json({ ok: false, error: 'HTML do Nomus não informado no payload (esperado req.body.html)' });
    }

    console.log(`[Nomus Auto] Recebida requisição de importação automática do Nomus (${rawHtml.length} bytes)...`);
    const { orders, warnings } = parseNomusHtml(rawHtml);

    if (!orders || orders.length === 0) {
      console.warn('[Nomus Auto] Nenhuma OP válida encontrada no HTML recebido.');
      return res.json({ ok: true, processadas: 0, aviso: 'Nenhuma OP válida encontrada no relatório HTML.' });
    }

    console.log(`[Nomus Auto] Parsed com sucesso: ${orders.length} OPs válidas.`);

    const upsertStmt = db.prepare(`
      INSERT INTO ordens (
        id, numero, codigo, descricao, cliente, tipoOrdem, status, etapas, quantidadeFisica,
        requerLaser, requer_laser, requerRouter, requer_router, encaminhar_router,
        lote, observacao, observacoes, data_entrega, prazoEntrega, status_nomus, statusNomus,
        dados, criadoEm, atualizadoEm
      ) VALUES (
        @id, @numero, @codigo, @descricao, @cliente, @tipoOrdem, @status, @etapas, @quantidadeFisica,
        @requerLaser, @requer_laser, @requerRouter, @requer_router, @encaminhar_router,
        @lote, @observacao, @observacoes, @data_entrega, @prazoEntrega, @status_nomus, @statusNomus,
        @dados, @criadoEm, @atualizadoEm
      )
      ON CONFLICT(numero) DO UPDATE SET
        id = excluded.id,
        codigo = CASE WHEN excluded.codigo != '' THEN excluded.codigo ELSE ordens.codigo END,
        descricao = CASE WHEN excluded.descricao != '' THEN excluded.descricao ELSE ordens.descricao END,
        cliente = CASE WHEN excluded.cliente != '' THEN excluded.cliente ELSE ordens.cliente END,
        tipoOrdem = CASE WHEN excluded.tipoOrdem != '' THEN excluded.tipoOrdem ELSE ordens.tipoOrdem END,
        lote = CASE WHEN excluded.lote != '' AND excluded.lote != '—' THEN excluded.lote ELSE ordens.lote END,
        observacao = CASE WHEN excluded.observacao != '' THEN excluded.observacao ELSE ordens.observacao END,
        observacoes = CASE WHEN excluded.observacoes != '' THEN excluded.observacoes ELSE ordens.observacoes END,
        data_entrega = CASE WHEN excluded.data_entrega != '' THEN excluded.data_entrega ELSE ordens.data_entrega END,
        prazoEntrega = CASE WHEN excluded.prazoEntrega != '' THEN excluded.prazoEntrega ELSE ordens.prazoEntrega END,
        status_nomus = CASE WHEN excluded.status_nomus != '' THEN excluded.status_nomus ELSE ordens.status_nomus END,
        statusNomus = CASE WHEN excluded.statusNomus != '' THEN excluded.statusNomus ELSE ordens.statusNomus END,
        dados = excluded.dados,
        quantidadeFisica = CASE 
          WHEN ordens.status = 'pendente' OR ordens.status LIKE 'Aguardando Início%' OR ordens.status = 'Liberada' OR ordens.status = 'LIBERADA' OR ordens.status IS NULL 
          THEN excluded.quantidadeFisica 
          ELSE ordens.quantidadeFisica 
        END,
        requerLaser = CASE WHEN excluded.requerLaser = 1 THEN 1 ELSE ordens.requerLaser END,
        requer_laser = CASE WHEN excluded.requer_laser = 1 THEN 1 ELSE ordens.requer_laser END,
        requerRouter = CASE WHEN excluded.requerRouter = 1 THEN 1 ELSE ordens.requerRouter END,
        requer_router = CASE WHEN excluded.requer_router = 1 THEN 1 ELSE ordens.requer_router END,
        encaminhar_router = CASE WHEN excluded.encaminhar_router = 1 THEN 1 ELSE ordens.encaminhar_router END,
        status = CASE 
          WHEN ordens.status = 'pendente' OR ordens.status LIKE 'Aguardando Início%' OR ordens.status = 'Liberada' OR ordens.status = 'LIBERADA' OR ordens.status IS NULL 
          THEN excluded.status 
          ELSE ordens.status 
        END,
        etapas = CASE 
          WHEN ordens.status = 'pendente' OR ordens.status LIKE 'Aguardando Início%' OR ordens.status = 'Liberada' OR ordens.status = 'LIBERADA' OR ordens.status IS NULL 
          THEN excluded.etapas 
          ELSE ordens.etapas 
        END,
        atualizadoEm = excluded.atualizadoEm
    `);

    const now = Date.now();
    const tx = db.transaction((lista) => {
      for (const op of lista) {
        const canonicalNum = formatarNumeroOP(op.numero_normalizado || op.numero || op.id);
        if (!canonicalNum) continue;

        upsertStmt.run({
          id: canonicalNum,
          numero: canonicalNum,
          codigo: op.codigo || op.codigoProduto || '',
          descricao: op.descricao || '',
          cliente: op.cliente || 'Nomus ERP',
          tipoOrdem: op.tipoOrdem || op.familia || 'Padrão',
          status: op.status || 'Aguardando Início em: Corte',
          etapas: JSON.stringify(op.etapas || op.rota || ['Corte']),
          quantidadeFisica: Number(op.quantidadeFisica || op.quantidade || 1),
          requerLaser: op.requerLaser ? 1 : 0,
          requer_laser: op.requerLaser ? 1 : 0,
          requerRouter: op.requerRouter ? 1 : 0,
          requer_router: op.requerRouter ? 1 : 0,
          encaminhar_router: op.requerRouter ? 1 : 0,
          lote: op.lote || '—',
          observacao: op.observacao || op.observacoes || '',
          observacoes: op.observacoes || op.observacao || '',
          data_entrega: op.data_entrega || op.prazoEntrega || '',
          prazoEntrega: op.prazoEntrega || op.data_entrega || '',
          status_nomus: op.status_nomus || op.statusNomus || 'Liberada',
          statusNomus: op.statusNomus || op.status_nomus || 'Liberada',
          dados: JSON.stringify(op),
          criadoEm: op.criadoEm || now,
          atualizadoEm: now
        });
      }
    });

    tx(orders);

    // Limpeza preventiva pós-importação
    const todasOrdensBrutas = db.prepare('SELECT rowid, id, numero, atualizadoEm FROM ordens ORDER BY atualizadoEm DESC').all();
    const seenNorm = new Set();
    const idsParaExcluir = [];
    for (const row of todasOrdensBrutas) {
      const clean = normalizarIdOP(row.numero || row.id);
      if (!clean || seenNorm.has(clean)) {
        idsParaExcluir.push(row.rowid);
      } else {
        seenNorm.add(clean);
      }
    }
    if (idsParaExcluir.length > 0) {
      const delStmt = db.prepare('DELETE FROM ordens WHERE rowid = ?');
      const delTx = db.transaction((list) => {
        for (const rid of list) delStmt.run(rid);
      });
      delTx(idsParaExcluir);
    }

    const ordensAtualizadas = obterTodasOrdens();
    console.log(`[Nomus Auto] Emitindo 'ordens_atualizadas' com ${ordensAtualizadas.length} ordens.`);
    io.emit('ordens_atualizadas', ordensAtualizadas);
    registrarSyncNomus(orders.length, req.body.origem || 'tampermonkey');

    return res.json({ ok: true, processadas: orders.length });
  } catch (err) {
    console.error('[Nomus Auto] Erro ao processar importação automática:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// 4. Atualização de ordem por ID / Número (com proteção anti-loop de idempotência)
app.put('/api/ordens/:id', (req, res) => {
  const { id } = req.params;
  const dados = req.body;
  const cleanId = normalizarIdOP(id);
  const formatId = formatarNumeroOP(cleanId);
  if (!cleanId) return res.status(400).json({ error: 'ID inválido' });

  // Buscar ordem existente no SQLite
  const opRow = db.prepare('SELECT * FROM ordens WHERE id = ? OR id = ? OR numero = ? OR numero = ?')
    .get(formatId, cleanId, formatId, cleanId);
  if (!opRow) return res.status(404).json({ error: 'Ordem não encontrada' });

  const hasLaser = dados.requerLaser !== undefined || dados.requer_laser !== undefined;
  const laserInt = hasLaser ? (Boolean(dados.requerLaser || dados.requer_laser) ? 1 : 0) : null;

  const hasRouter = dados.requerRouter !== undefined || dados.requer_router !== undefined || dados.encaminhar_router !== undefined;
  const routerInt = hasRouter ? (Boolean(dados.requerRouter || dados.requer_router || dados.encaminhar_router) ? 1 : 0) : null;

  const rawQtd = dados.quantidadeFisica ?? dados.quantidadeAjustada ?? dados.quantidade_total ?? dados.quantidade;
  const qtdFisicaInt = (rawQtd !== undefined && rawQtd !== null && !isNaN(Number(rawQtd))) 
    ? Math.max(1, Math.round(Number(rawQtd))) 
    : null;

  let etapasJson = null;
  if (dados.etapas) {
    let etapasVal = typeof dados.etapas === 'string' ? JSON.parse(dados.etapas) : dados.etapas;
    if (routerInt === 1) {
      if (Array.isArray(etapasVal) && !etapasVal.some(e => String(e).toLowerCase().includes('router'))) {
        const injIdx = etapasVal.findIndex(e => String(e).toLowerCase().includes('inje'));
        if (injIdx !== -1) {
          etapasVal.splice(injIdx + 1, 0, 'Router');
        } else {
          const montIdx = etapasVal.findIndex(e => String(e).toLowerCase().includes('montagem'));
          if (montIdx !== -1) {
            etapasVal.splice(montIdx, 0, 'Router');
          } else {
            etapasVal.push('Router');
          }
        }
      } else if (etapasVal && typeof etapasVal === 'object' && !Array.isArray(etapasVal) && !etapasVal['Router']) {
        etapasVal['Router'] = { status: 'PENDENTE', concluidas: 0 };
      }
    }
    // Sincroniza total de todas as etapas se for objeto
    if (qtdFisicaInt !== null && etapasVal && typeof etapasVal === 'object' && !Array.isArray(etapasVal)) {
      Object.keys(etapasVal).forEach(k => {
        if (etapasVal[k] && typeof etapasVal[k] === 'object') {
          etapasVal[k].total = qtdFisicaInt;
        }
      });
    }
    etapasJson = JSON.stringify(etapasVal);
  } else if (qtdFisicaInt !== null && opRow.etapas) {
    try {
      let etapasVal = JSON.parse(opRow.etapas);
      if (etapasVal && typeof etapasVal === 'object' && !Array.isArray(etapasVal)) {
        Object.keys(etapasVal).forEach(k => {
          if (etapasVal[k] && typeof etapasVal[k] === 'object') {
            etapasVal[k].total = qtdFisicaInt;
          }
        });
        etapasJson = JSON.stringify(etapasVal);
      }
    } catch {}
  }

  const novoStatus = dados.status !== undefined ? dados.status : opRow.status;
  const novoTipoOrdem = dados.tipoOrdem ? String(dados.tipoOrdem).trim() : opRow.tipoOrdem;
  const novoCliente = dados.cliente ? String(dados.cliente).trim() : opRow.cliente;
  const novasEtapas = etapasJson !== null ? etapasJson : opRow.etapas;
  const novaQtd = qtdFisicaInt !== null ? qtdFisicaInt : opRow.quantidadeFisica;
  const novoLaser = laserInt !== null ? laserInt : opRow.requerLaser;
  const novoRouter = routerInt !== null ? routerInt : opRow.requerRouter;

  const houveMudanca = 
    opRow.id !== formatId ||
    opRow.numero !== formatId ||
    novoStatus !== opRow.status ||
    novasEtapas !== opRow.etapas ||
    novaQtd !== opRow.quantidadeFisica ||
    novoLaser !== opRow.requerLaser ||
    novoRouter !== opRow.requerRouter ||
    (novoTipoOrdem && novoTipoOrdem !== opRow.tipoOrdem) ||
    (novoCliente && novoCliente !== opRow.cliente);

  // PROTEÇÃO ANTI-LOOP: Se os dados forem idênticos aos já gravados no banco, retorna sem reemitir socket
  if (!houveMudanca) {
    return res.json({ success: true, unchanged: true });
  }

  const stmt = db.prepare(`
    UPDATE ordens SET
      id = @formatId,
      numero = @formatId,
      status = @novoStatus,
      etapas = @novasEtapas,
      tipoOrdem = @novoTipoOrdem,
      cliente = @novoCliente,
      quantidadeFisica = @novaQtd,
      requerLaser = @novoLaser,
      requer_laser = @novoLaser,
      requerRouter = @novoRouter,
      requer_router = @novoRouter,
      encaminhar_router = @novoRouter,
      atualizadoEm = @atualizadoEm
    WHERE id = @id OR id = @cleanId OR numero = @id OR numero = @formatId OR numero = @cleanId
  `);

  stmt.run({
    id,
    cleanId,
    formatId,
    novoStatus,
    novasEtapas,
    novoTipoOrdem,
    novoCliente,
    novaQtd,
    novoLaser,
    novoRouter,
    atualizadoEm: Date.now()
  });

  // Se houver apontamento em andamento desta OP, atualiza a quantidade_lote
  if (qtdFisicaInt !== null) {
    try {
      db.prepare(`
        UPDATE apontamentos SET
          quantidade_lote = ?,
          unidade = 'Lote (' || ? || ' PC)'
        WHERE (op_numero = ? OR op_numero = ? OR op_numero = ?) AND status = 'EM_ANDAMENTO'
      `).run(qtdFisicaInt, qtdFisicaInt, id, cleanId, formatId);
    } catch {}
  }

  const todas = obterTodasOrdens();
  io.emit('ordens_atualizadas', todas);
  res.json({ success: true, updated: true });
});

// 4.0 Início de etapa oficial (com persistência de flags do lote como requerRouter e quantidadeAjustada)
app.post(['/api/ordens/:id/iniciar-etapa', '/api/ordens/iniciar-etapa'], (req, res) => {
  try {
    const id = req.params.id || req.body.id || req.body.op_numero || req.body.numero;
    if (!id) return res.status(400).json({ error: 'ID da ordem obrigatório' });

    const { etapa, setor, operador, requerRouter, encaminharRouter, requer_router, quantidadeAjustada, quantidadeFisica, quantidade_total } = req.body;
    const cleanId = normalizarIdOP(id);
    const formatId = formatarNumeroOP(cleanId);

    const opRow = db.prepare('SELECT * FROM ordens WHERE id = ? OR id = ? OR numero = ? OR numero = ?')
      .get(id, cleanId, formatId, cleanId);
    if (!opRow) return res.status(404).json({ error: 'Ordem não encontrada' });

    const hasRouterFlag = requerRouter !== undefined || encaminharRouter !== undefined || requer_router !== undefined;
    const routerVal = hasRouterFlag ? (Boolean(requerRouter || encaminharRouter || requer_router) ? 1 : 0) : null;
    const nowMs = Date.now();

    const rawQtd = quantidadeAjustada ?? quantidadeFisica ?? quantidade_total;
    const qtdFisicaInt = (rawQtd !== undefined && rawQtd !== null && !isNaN(Number(rawQtd))) 
      ? Math.max(1, Math.round(Number(rawQtd))) 
      : (opRow.quantidadeFisica || 1);

    // Atualiza etapas com o total correto
    let etapasAtualizadas = opRow.etapas;
    try {
      let parsed = JSON.parse(opRow.etapas || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.keys(parsed).forEach(k => {
          if (parsed[k] && typeof parsed[k] === 'object') {
            parsed[k].total = qtdFisicaInt;
          }
        });
        const etapaAlvo = etapa || setor;
        if (etapaAlvo) {
          const matchKey = Object.keys(parsed).find(k => k.toLowerCase() === etapaAlvo.toLowerCase()) || etapaAlvo;
          parsed[matchKey] = {
            ...(parsed[matchKey] || {}),
            status: 'EM_PRODUCAO',
            total: qtdFisicaInt,
            concluidas: parsed[matchKey]?.concluidas || 0,
            operador: operador || parsed[matchKey]?.operador || 'Operador',
            inicio: new Date().toISOString()
          };
        }
        etapasAtualizadas = JSON.stringify(parsed);
      }
    } catch {}

    db.prepare(`
      UPDATE ordens SET
        status = 'EM_PRODUCAO',
        etapas = ?,
        quantidadeFisica = ?,
        requerRouter = COALESCE(?, requerRouter),
        requer_router = COALESCE(?, requer_router),
        encaminhar_router = COALESCE(?, encaminhar_router),
        atualizadoEm = ?
      WHERE id = ? OR id = ? OR numero = ? OR numero = ?
    `).run(etapasAtualizadas, qtdFisicaInt, routerVal, routerVal, routerVal, nowMs, id, cleanId, formatId, cleanId);

    // Se houver apontamento em andamento desta OP, atualiza a quantidade_lote
    try {
      db.prepare(`
        UPDATE apontamentos SET
          quantidade_lote = ?,
          unidade = 'Lote (' || ? || ' PC)'
        WHERE (op_numero = ? OR op_numero = ? OR op_numero = ?) AND status = 'EM_ANDAMENTO'
      `).run(qtdFisicaInt, qtdFisicaInt, id, cleanId, formatId);
    } catch {}

    const todas = obterTodasOrdens();
    io.emit('ordens_atualizadas', todas);
    return res.json({
      success: true,
      quantidadeFisica: qtdFisicaInt,
      requerRouter: routerVal === 1,
      status: 'EM_PRODUCAO'
    });
  } catch (err) {
    console.error('[/api/ordens/iniciar-etapa] Erro:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.put(['/api/ordens/:id/iniciar-etapa', '/api/ordens/iniciar-etapa'], (req, res, next) => {
  req.method = 'POST';
  app._router.handle(req, res, next);
});

// 4.1 Conclusão de etapa oficial (com inserção dinâmica de Router e propagação de quantidade para próximas etapas)
app.post(['/api/ordens/:id/concluir-etapa', '/api/ordens/concluir-etapa'], (req, res) => {
  const id = req.params.id || req.body.id || req.body.op_numero;
  const { etapa, setor, requerRouter, encaminharRouter, quantidadeAjustada, quantidadeFisica, quantidadeProduzida, quantidade_total } = req.body;
  if (!id) return res.status(400).json({ error: 'ID da ordem obrigatório' });

  const cleanId = normalizarIdOP(id);
  const formatId = formatarNumeroOP(cleanId);

  const opRow = db.prepare('SELECT * FROM ordens WHERE id = ? OR id = ? OR numero = ? OR numero = ?').get(id, cleanId, formatId, cleanId);
  if (!opRow) return res.status(404).json({ error: 'Ordem não encontrada' });

  const rawQtd = quantidadeAjustada ?? quantidadeFisica ?? quantidadeProduzida ?? quantidade_total;
  const qtdFisicaInt = (rawQtd !== undefined && rawQtd !== null && !isNaN(Number(rawQtd))) 
    ? Math.max(1, Math.round(Number(rawQtd))) 
    : (opRow.quantidadeFisica || 1);

  const querRouter = Boolean(
    requerRouter ||
    encaminharRouter ||
    opRow.requerRouter ||
    opRow.requer_router ||
    opRow.encaminhar_router
  );

  const isInjecao = Boolean(
    (etapa && /inje/i.test(etapa)) ||
    (setor && /inje/i.test(setor)) ||
    (opRow.status && /inje/i.test(opRow.status))
  );

  let updatedRow = opRow;
  if (querRouter && isInjecao) {
    updatedRow = inserirEtapaRouterNaOrdem(opRow, true);
  }

  // Atualiza etapas: marca etapa atual como concluída (concluidas = qtdFisicaInt, total = qtdFisicaInt)
  // e propaga total = qtdFisicaInt para todas as etapas da OP (Dobra, Preparação, Injeção e Montagem)
  try {
    let parsed = JSON.parse(updatedRow.etapas || '[]');
    let novoStatus = updatedRow.status;
    const nowMs = Date.now();

    if (Array.isArray(parsed) && etapa) {
      const idx = parsed.findIndex(e => String(e).toLowerCase() === String(etapa).toLowerCase());
      if (idx !== -1 && idx < parsed.length - 1) {
        const prox = parsed[idx + 1];
        novoStatus = `Aguardando Início em: ${prox}`;
      } else if (idx === parsed.length - 1) {
        novoStatus = 'FINALIZADA';
      }
    } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const etapaAlvo = etapa || setor;
      const stepKeys = Object.keys(parsed);
      const idx = stepKeys.findIndex(k => k.toLowerCase() === String(etapaAlvo).toLowerCase());
      
      // Propaga o novo total para todas as etapas da OP
      stepKeys.forEach(k => {
        if (parsed[k] && typeof parsed[k] === 'object') {
          parsed[k].total = qtdFisicaInt;
        }
      });

      if (idx !== -1) {
        const currentKey = stepKeys[idx];
        parsed[currentKey] = {
          ...(parsed[currentKey] || {}),
          status: 'CONCLUIDO',
          concluidas: qtdFisicaInt,
          total: qtdFisicaInt,
          timestampFim: nowMs
        };

        if (idx < stepKeys.length - 1) {
          const prox = stepKeys[idx + 1];
          novoStatus = `Aguardando Início em: ${prox}`;
          if (parsed[prox]) {
            parsed[prox].status = parsed[prox].status === 'EM_PRODUCAO' ? 'EM_PRODUCAO' : 'PENDENTE';
            parsed[prox].total = qtdFisicaInt;
          }
        } else {
          novoStatus = 'FINALIZADA';
        }
      }
    }

    const etapasStr = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
    db.prepare(`
      UPDATE ordens SET
        status = ?,
        etapas = ?,
        quantidadeFisica = ?,
        atualizadoEm = ?
      WHERE id = ? OR numero = ?
    `).run(novoStatus, etapasStr, qtdFisicaInt, nowMs, opRow.id, opRow.numero);

    updatedRow.status = novoStatus;
    updatedRow.quantidadeFisica = qtdFisicaInt;
    updatedRow.etapas = etapasStr;
  } catch (err) {
    console.error('[/api/ordens/concluir-etapa] Erro ao atualizar etapas:', err);
  }

  // Atualiza apontamento concluído no SQLite
  try {
    db.prepare(`
      UPDATE apontamentos SET
        quantidade_lote = ?,
        unidade = 'Lote (' || ? || ' PC)'
      WHERE (op_numero = ? OR op_numero = ? OR op_numero = ?) AND (status = 'FINALIZADO' OR status = 'EM_ANDAMENTO')
    `).run(qtdFisicaInt, qtdFisicaInt, id, cleanId, formatId);
  } catch {}

  const todas = obterTodasOrdens();
  const todosApts = db.prepare('SELECT * FROM apontamentos ORDER BY criadoEm DESC').all();
  io.emit('ordens_atualizadas', todas);
  io.emit('apontamentos_atualizados', todosApts);

  res.json({
    success: true,
    quantidadeFisica: qtdFisicaInt,
    status: updatedRow?.status || 'EM_PRODUCAO',
    etapas: typeof updatedRow?.etapas === 'string' ? JSON.parse(updatedRow.etapas || '[]') : updatedRow?.etapas
  });
});

app.put('/api/ordens/:id/concluir-etapa', (req, res, next) => {
  req.method = 'POST';
  app._router.handle(req, res, next);
});

// 5. Rota oficial de RESET DE OP (limpar apontamentos daquela OP no banco e zerar status)
app.post(['/api/ordens/:identificador/reset', '/api/ordens/reset'], (req, res) => {
  const identificador = req.params.identificador || req.body.id || req.body.opNumero;
  if (!identificador) return res.status(400).json({ error: 'Identificador de OP obrigatório' });

  const cleanId = normalizarIdOP(identificador);
  const formatId = formatarNumeroOP(cleanId);

  // 1. Limpa todos os apontamentos vinculados a esta OP no SQLite
  db.prepare(`
    DELETE FROM apontamentos 
    WHERE op_numero = ? OR op_numero = ? OR op_numero = ? OR op_numero LIKE ?
  `).run(identificador, cleanId, formatId, `%${cleanId}%`);

  // 2. Busca ordem atual para determinar primeira etapa e restaurar rota limpa
  const opRow = db.prepare('SELECT * FROM ordens WHERE id = ? OR id = ? OR numero = ? OR numero = ?').get(identificador, cleanId, formatId, cleanId);
  let etapasResetadas = '[]';
  let primeiraEtapa = 'Corte';

  if (opRow) {
    try {
      const parsed = JSON.parse(opRow.etapas || '[]');
      if (Array.isArray(parsed) && parsed.length > 0) {
        primeiraEtapa = typeof parsed[0] === 'string' ? parsed[0] : (parsed[0].nome || 'Corte');
        etapasResetadas = JSON.stringify(parsed.map(e => {
          if (typeof e === 'string') return e;
          return { ...e, status: 'PENDENTE', concluidas: 0, inicio: null, fim: null, operador: null };
        }));
      }
    } catch {}
  }

  const novoStatus = `Aguardando Início em: ${primeiraEtapa}`;

  db.prepare(`
    UPDATE ordens SET
      status = ?,
      etapas = ?,
      atualizadoEm = ?
    WHERE id = ? OR id = ? OR numero = ? OR numero = ?
  `).run(novoStatus, etapasResetadas, Date.now(), identificador, cleanId, formatId, cleanId);

  const todas = obterTodasOrdens();
  const todosApts = db.prepare('SELECT * FROM apontamentos ORDER BY criadoEm DESC').all();

  io.emit('op_resetada', { id: cleanId, opNumero: formatId, status: novoStatus });
  io.emit('ordens_atualizadas', todas);
  io.emit('apontamentos_atualizados', todosApts);

  res.json({ success: true, message: `OP ${formatId} resetada com sucesso`, status: novoStatus });
});

app.put('/api/ordens/:identificador/reset', (req, res, next) => {
  app._router.handle({ ...req, method: 'POST' }, res, next);
});

// 5b. Função reutilizável e rota oficial de ESTORNO / RESET DE ETAPA de uma OP
function executarResetEtapa(numeroRaw, etapaRaw) {
  if (!numeroRaw) throw new Error('Número da OP é obrigatório');
  const cleanNumero = normalizarIdOP(numeroRaw);
  const formatNumero = formatarNumeroOP(cleanNumero);
  const cleanEtapa = String(etapaRaw || '').trim();

  // 1. Limpa apontamentos ativos/em andamento ou sem hora_fim desta etapa no SQLite
  try {
    if (cleanEtapa) {
      db.prepare(`
        DELETE FROM apontamentos 
        WHERE (op_numero = ? OR op_numero = ? OR op_numero = ?) 
          AND (
            LOWER(TRIM(COALESCE(setor, ''))) = LOWER(?) 
            OR LOWER(TRIM(COALESCE(setorFisico, ''))) = LOWER(?) 
            OR LOWER(TRIM(COALESCE(etapa_rota, ''))) = LOWER(?)
            OR etapa_rota LIKE ? 
            OR setor LIKE ?
          )
          AND (status = 'EM_ANDAMENTO' OR status = 'EM_PRODUCAO' OR hora_fim IS NULL OR hora_fim = '')
      `).run(
        formatNumero, cleanNumero, numeroRaw,
        cleanEtapa, cleanEtapa, cleanEtapa,
        `%${cleanEtapa}%`, `%${cleanEtapa}%`
      );
    } else {
      db.prepare(`
        DELETE FROM apontamentos 
        WHERE (op_numero = ? OR op_numero = ? OR op_numero = ?)
          AND (status = 'EM_ANDAMENTO' OR status = 'EM_PRODUCAO' OR hora_fim IS NULL OR hora_fim = '')
      `).run(formatNumero, cleanNumero, numeroRaw);
    }
  } catch (errDb) {
    console.warn('[executarResetEtapa] Aviso ao remover apontamentos:', errDb);
  }

  // 2. Busca ordem atual no SQLite para resetar o status da etapa
  const opRow = db.prepare('SELECT * FROM ordens WHERE id = ? OR id = ? OR numero = ? OR numero = ?')
    .get(numeroRaw, cleanNumero, formatNumero, cleanNumero);

  let etapasSerialized = null;
  let previousStatus = 'Aguardando Início';

  if (opRow && opRow.etapas) {
    try {
      const parsed = JSON.parse(opRow.etapas);
      if (Array.isArray(parsed)) {
        const etapasArr = parsed.map((e) => {
          const nome = typeof e === 'string' ? e : (e.nome || e.etapa || e.step);
          const isMatch = cleanEtapa ? (
            nome && (
              nome.toLowerCase().trim() === cleanEtapa.toLowerCase().trim() ||
              nome.toLowerCase().includes(cleanEtapa.toLowerCase()) ||
              cleanEtapa.toLowerCase().includes(nome.toLowerCase())
            )
          ) : true;

          if (isMatch) {
            if (typeof e === 'string') return e;
            return {
              ...e,
              status: 'PENDENTE',
              emAndamento: 0,
              inicio: null,
              horaInicio: null,
              hora_inicio: null,
              fim: null,
              operador: null,
              operadorId: null,
              operadorNome: null,
              colaborador: null,
              pecas: Array.isArray(e.pecas) ? e.pecas.map(p => ({
                ...p,
                status: 'PENDENTE',
                inicio: null,
                fim: null,
                operadorId: null,
                operadorNome: null
              })) : undefined
            };
          }
          return e;
        });

        const hasActive = etapasArr.some(e => typeof e === 'object' && (e.status === 'EM_ANDAMENTO' || e.status === 'EM_PRODUCAO'));
        const hasCompleted = etapasArr.some(e => typeof e === 'object' && ((e.status === 'CONCLUIDO') || ((e.concluidas || 0) > 0)));
        if (hasActive) {
          previousStatus = 'EM_PRODUCAO';
        } else if (hasCompleted) {
          previousStatus = 'EM_PRODUCAO';
        } else {
          previousStatus = `Aguardando Início em: ${cleanEtapa || 'Corte'}`;
        }
        etapasSerialized = JSON.stringify(etapasArr);
      } else if (parsed && typeof parsed === 'object') {
        const etapasObj = { ...parsed };
        for (const [k, v] of Object.entries(etapasObj)) {
          const isMatch = cleanEtapa ? (
            k.toLowerCase().trim() === cleanEtapa.toLowerCase().trim() ||
            k.toLowerCase().includes(cleanEtapa.toLowerCase()) ||
            cleanEtapa.toLowerCase().includes(k.toLowerCase())
          ) : true;

          if (isMatch && v && typeof v === 'object') {
            etapasObj[k] = {
              ...v,
              status: 'PENDENTE',
              emAndamento: 0,
              inicio: null,
              horaInicio: null,
              hora_inicio: null,
              fim: null,
              operadorId: null,
              operadorNome: null,
              colaborador: null,
              pecas: Array.isArray(v.pecas) ? v.pecas.map(p => ({
                ...p,
                status: 'PENDENTE',
                inicio: null,
                fim: null,
                operadorId: null,
                operadorNome: null
              })) : undefined
            };
          }
        }
        const values = Object.values(etapasObj);
        const hasActive = values.some(v => v && typeof v === 'object' && (v.status === 'EM_ANDAMENTO' || v.status === 'EM_PRODUCAO'));
        const hasCompleted = values.some(v => v && typeof v === 'object' && ((v.status === 'CONCLUIDO') || ((v.concluidas || 0) > 0)));
        if (hasActive) {
          previousStatus = 'EM_PRODUCAO';
        } else if (hasCompleted) {
          previousStatus = 'EM_PRODUCAO';
        } else {
          previousStatus = `Aguardando Início em: ${cleanEtapa || 'Corte'}`;
        }
        etapasSerialized = JSON.stringify(etapasObj);
      }
    } catch (err) {
      console.warn('[executarResetEtapa] Erro ao parsear etapas:', err);
    }
  }

  // 3. Atualiza registro da OP no SQLite
  try {
    db.prepare(`
      UPDATE ordens SET
        status = COALESCE(?, status),
        etapas = COALESCE(?, etapas),
        atualizadoEm = ?
      WHERE id = ? OR id = ? OR numero = ? OR numero = ?
    `).run(
      previousStatus,
      etapasSerialized,
      Date.now(),
      numeroRaw, cleanNumero, formatNumero, cleanNumero
    );
  } catch (errUp) {
    console.warn('[executarResetEtapa] Erro ao atualizar tabela ordens:', errUp);
  }

  // 4. Busca listas sincronizadas para broadcast
  const todas = obterTodasOrdens();
  const todosApts = db.prepare('SELECT * FROM apontamentos ORDER BY criadoEm DESC').all();

  // Emissões Socket.io para TODOS os clientes conectados
  io.emit('ordens_atualizadas', todas);
  io.emit('apontamentos_atualizados', todosApts);
  io.emit('ordem_resetada', {
    id: cleanNumero,
    numero: formatNumero,
    opNumero: formatNumero,
    etapa: cleanEtapa,
    status: previousStatus
  });
  io.emit('op_resetada', {
    id: cleanNumero,
    opNumero: formatNumero,
    etapa: cleanEtapa,
    status: previousStatus
  });

  return {
    success: true,
    message: `Etapa ${cleanEtapa} da OP ${formatNumero} estornada/resetada com sucesso`,
    status: previousStatus,
    numero: formatNumero,
    etapa: cleanEtapa
  };
}

// Rota oficial de estorno / reset de etapa específica de uma OP
app.post(['/api/ordens/:numero/reset-etapa', '/api/ordens/:numero/estorno', '/api/ordens/reset-etapa', '/api/ordens/estorno'], (req, res) => {
  try {
    const numero = req.params.numero || req.body.numero || req.body.opNumero || req.body.id;
    const etapa = req.body.etapa || req.body.setor || req.body.step || req.body.setorOuEtapa;
    const result = executarResetEtapa(numero, etapa);
    res.json(result);
  } catch (err) {
    console.error('[reset-etapa] Erro ao estornar etapa:', err);
    res.status(500).json({ error: err.message || 'Erro ao estornar etapa' });
  }
});

app.put(['/api/ordens/:numero/reset-etapa', '/api/ordens/:numero/estorno'], (req, res, next) => {
  app._router.handle({ ...req, method: 'POST' }, res, next);
});

// 6. Rota para Toggle de Laser CNC
function executarAtualizarLaser(identificadorRaw, requerLaserRaw) {
  if (!identificadorRaw) {
    throw new Error('Identificador da OP (numero/id/opNumero) é obrigatório');
  }
  const cleanId = normalizarIdOP(identificadorRaw);
  const formatId = formatarNumeroOP(cleanId);
  const laserBool = Boolean(requerLaserRaw);
  const valor = laserBool ? 1 : 0;

  // Busca ordem atual para atualizar etapas no SQLite
  const opRow = db.prepare('SELECT * FROM ordens WHERE id = ? OR id = ? OR numero = ? OR numero = ?')
    .get(identificadorRaw, cleanId, formatId, cleanId);

  let novasEtapas = null;
  if (opRow) {
    try {
      const etapasAtuais = JSON.parse(opRow.etapas || '[]');
      if (Array.isArray(etapasAtuais)) {
        if (laserBool) {
          if (!etapasAtuais.some(e => String(typeof e === 'string' ? e : (e?.nome || '')).toLowerCase().includes('laser'))) {
            const corteIdx = etapasAtuais.findIndex(e => String(typeof e === 'string' ? e : (e?.nome || '')).toLowerCase().includes('corte'));
            if (corteIdx >= 0) {
              etapasAtuais.splice(corteIdx + 1, 0, 'Laser');
            } else {
              etapasAtuais.unshift('Laser');
            }
          }
        } else {
          const laserIdx = etapasAtuais.findIndex(e => String(typeof e === 'string' ? e : (e?.nome || '')).toLowerCase().includes('laser'));
          if (laserIdx >= 0) {
            etapasAtuais.splice(laserIdx, 1);
          }
        }
        novasEtapas = JSON.stringify(etapasAtuais);
      }
    } catch (errJson) {
      console.warn('[executarAtualizarLaser] Erro ao parsear etapas:', errJson);
    }
  }

  const stmt = db.prepare(`
    UPDATE ordens 
    SET requer_laser = @valor, requerLaser = @valor, etapas = COALESCE(@novasEtapas, etapas), atualizadoEm = @atualizadoEm
    WHERE id = @identificador OR id = @cleanId OR numero = @identificador OR numero = @formatId OR numero = @cleanId
  `);

  stmt.run({
    valor,
    novasEtapas,
    atualizadoEm: Date.now(),
    identificador: identificadorRaw,
    cleanId,
    formatId
  });

  const todas = obterTodasOrdens();
  io.emit('ordens_atualizadas', todas);
  return { success: true, requerLaser: laserBool, numero: formatId };
}

// Endpoint oficial /api/ordens/update-laser
app.post(['/api/ordens/update-laser', '/api/ordens/laser'], (req, res) => {
  try {
    const numero = req.body.numero || req.body.id || req.body.opNumero || req.body.op_numero;
    const requerLaser = req.body.requerLaser !== undefined ? req.body.requerLaser : req.body.requer_laser;
    if (!numero) {
      return res.status(200).json({ success: false, error: 'Campo "numero" ou "id" obrigatório no corpo da requisição' });
    }
    const result = executarAtualizarLaser(numero, requerLaser);
    return res.json(result);
  } catch (err) {
    console.error('[update-laser] Erro ao atualizar status do laser:', err);
    return res.status(200).json({ success: false, error: err.message || 'Erro interno ao atualizar laser' });
  }
});

app.post('/api/ordens/:identificador/laser', (req, res) => {
  try {
    const identificador = req.params.identificador || req.body.numero || req.body.id || req.body.opNumero;
    const requerLaser = req.body.requerLaser !== undefined ? req.body.requerLaser : req.body.requer_laser;
    const result = executarAtualizarLaser(identificador, requerLaser);
    return res.json(result);
  } catch (err) {
    console.error('[/api/ordens/:identificador/laser] Erro ao atualizar status do laser:', err);
    return res.status(200).json({ success: false, error: err.message || 'Erro interno ao atualizar laser' });
  }
});

app.put(['/api/ordens/:identificador/laser', '/api/ordens/update-laser'], (req, res, next) => {
  app._router.handle({ ...req, method: 'POST' }, res, next);
});
app.patch(['/api/ordens/:identificador/laser', '/api/ordens/update-laser'], (req, res, next) => {
  app._router.handle({ ...req, method: 'POST' }, res, next);
});

// 7. Rota de Apontamentos (Lote / Unitário - Iniciar e Finalizar Etapa)
app.get('/api/apontamentos', (req, res) => {
  const rows = db.prepare('SELECT * FROM apontamentos ORDER BY criadoEm DESC').all();
  res.json(rows);
});

app.get('/api/ordens/:identificador/apontamentos', (req, res) => {
  const { identificador } = req.params;
  const cleanId = normalizarIdOP(identificador);
  const formatId = formatarNumeroOP(cleanId);
  const rows = db.prepare(`
    SELECT * FROM apontamentos 
    WHERE op_numero = ? OR op_numero = ? OR op_numero = ?
    ORDER BY criadoEm DESC
  `).all(identificador, cleanId, formatId);
  res.json(rows);
});

app.post('/api/apontamentos', (req, res) => {
  const apt = req.body;
  if (!apt || !apt.id) return res.status(400).json({ error: 'Dados do apontamento obrigatórios' });

  const cleanOp = normalizarIdOP(apt.op_numero || apt.op);
  const formatOp = formatarNumeroOP(cleanOp);

  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const isFinalizado = apt.status === 'FINALIZADO';
  const horaInicio = apt.hora_inicio || apt.horaInicio || nowIso;
  const horaFim = isFinalizado ? (apt.hora_fim || apt.horaFim || nowIso) : null;
  let duracaoMinutos = Number(apt.duracao_minutos || apt.duracao || 0);
  let duracaoMs = Number(apt.duracaoMs || 0);

  if (isFinalizado && (!duracaoMs || duracaoMs <= 0) && horaInicio && horaFim) {
    duracaoMs = Math.max(0, new Date(horaFim).getTime() - new Date(horaInicio).getTime());
    duracaoMinutos = Math.max(0.1, Number((duracaoMs / 60000).toFixed(1)));
  }

  const stmt = db.prepare(`
    INSERT INTO apontamentos (
      id, op_numero, unidade_numero, unidade, modo, setor, setorFisico, etapa_rota,
      terminal_id, terminal, operador, colaborador, hora_inicio, hora_fim,
      duracao_minutos, duracaoMs, status, observacao, is_lote, quantidade_lote,
      quantidade_refugo, criadoEm
    ) VALUES (
      @id, @op_numero, @unidade_numero, @unidade, @modo, @setor, @setorFisico, @etapa_rota,
      @terminal_id, @terminal, @operador, @colaborador, @hora_inicio, @hora_fim,
      @duracao_minutos, @duracaoMs, @status, @observacao, @is_lote, @quantidade_lote,
      @quantidade_refugo, @criadoEm
    )
    ON CONFLICT(id) DO UPDATE SET
      hora_fim = excluded.hora_fim,
      duracao_minutos = excluded.duracao_minutos,
      duracaoMs = excluded.duracaoMs,
      status = excluded.status,
      quantidade_lote = excluded.quantidade_lote,
      quantidade_refugo = excluded.quantidade_refugo,
      observacao = excluded.observacao
  `);

  const sanitizeSetor = (s) => (s ? String(s).replace(/Preparação de Folhas/g, 'Preparação de Folha').replace(/preparacao de folhas/gi, 'Preparação de Folha') : '');

  stmt.run({
    id: String(apt.id),
    op_numero: formatOp,
    unidade_numero: Number(apt.unidade_numero || 0),
    unidade: apt.unidade || '',
    modo: apt.modo || 'LOTE',
    setor: sanitizeSetor(apt.setor),
    setorFisico: sanitizeSetor(apt.setorFisico || apt.setor),
    etapa_rota: sanitizeSetor(apt.etapa_rota || apt.etapaRota),
    terminal_id: Number(apt.terminal_id || 1),
    terminal: apt.terminal || `T${apt.terminal_id || 1}`,
    operador: apt.operador || apt.colaborador || '',
    colaborador: apt.colaborador || apt.operador || '',
    hora_inicio: horaInicio,
    hora_fim: horaFim,
    duracao_minutos: duracaoMinutos,
    duracaoMs: duracaoMs,
    status: apt.status || 'EM_ANDAMENTO',
    observacao: apt.observacao || '',
    is_lote: apt.is_lote ? 1 : 0,
    quantidade_lote: Number(apt.quantidade_lote || 0),
    quantidade_refugo: Number(apt.quantidade_refugo || 0),
    criadoEm: nowMs
  });

  // Sincroniza status na ordem do SQLite
  const opRow = db.prepare('SELECT * FROM ordens WHERE id = ? OR id = ? OR numero = ? OR numero = ?').get(formatOp, cleanOp, formatOp, cleanOp);
  if (opRow) {
    let novoStatus = opRow.status;
    const hasRouterInApt = apt.requerRouter !== undefined || apt.requer_router !== undefined || apt.encaminharRouter !== undefined || req.body.requerRouter !== undefined || req.body.requer_router !== undefined || req.body.encaminharRouter !== undefined;
    const routerValFromApt = hasRouterInApt ? (Boolean(apt.requerRouter || apt.requer_router || apt.encaminharRouter || req.body.requerRouter || req.body.requer_router || req.body.encaminharRouter) ? 1 : 0) : null;

    if (apt.status === 'EM_ANDAMENTO') {
      novoStatus = 'EM_PRODUCAO';
      if (routerValFromApt !== null) {
        db.prepare(`
          UPDATE ordens SET requerRouter = ?, requer_router = ?, encaminhar_router = ?, atualizadoEm = ?
          WHERE id = ? OR id = ? OR numero = ? OR numero = ?
        `).run(routerValFromApt, routerValFromApt, routerValFromApt, nowMs, formatOp, cleanOp, formatOp, cleanOp);
      }
    } else if (apt.status === 'FINALIZADO') {
      const isInjecaoApt = (apt.setor && /inje/i.test(apt.setor)) || (apt.etapa_rota && /inje/i.test(apt.etapa_rota));
      const querRouter = Boolean(
        apt.requerRouter ||
        apt.encaminharRouter ||
        req.body.requerRouter ||
        req.body.encaminharRouter ||
        opRow.requerRouter ||
        opRow.requer_router ||
        opRow.encaminhar_router
      );
      if (isInjecaoApt && querRouter) {
        inserirEtapaRouterNaOrdem(opRow, true);
        novoStatus = 'Aguardando Início em: Router';
      }
    }
    db.prepare(`
      UPDATE ordens SET status = COALESCE(?, status), atualizadoEm = ?
      WHERE id = ? OR id = ? OR numero = ? OR numero = ?
    `).run(novoStatus, nowMs, formatOp, cleanOp, formatOp, cleanOp);
  }

  const savedApt = {
    ...apt,
    id: String(apt.id),
    op_numero: formatOp,
    hora_inicio: horaInicio,
    hora_fim: horaFim,
    duracao_minutos: duracaoMinutos,
    duracaoMs: duracaoMs,
    criadoEm: nowMs
  };

  const todosApts = db.prepare('SELECT * FROM apontamentos ORDER BY criadoEm DESC').all();
  const todasOrdens = obterTodasOrdens();
  const todosColabs = obterColaboradores();

  io.emit('ordem_apontada', {
    opNumero: formatOp,
    id: cleanOp,
    apontamento: savedApt,
    status: apt.status,
    serverTime: nowIso,
    serverTimestamp: nowMs
  });
  io.emit('ordens_atualizadas', todasOrdens);
  io.emit('apontamentos_atualizados', todosApts);
  if (todosColabs.length > 0) {
    io.emit('colaboradores_atualizados', todosColabs);
  }
  res.json({ success: true, apontamento: savedApt, serverTime: nowIso });
});

app.delete('/api/apontamentos/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM apontamentos WHERE id = ?').run(id);
  const todosApts = db.prepare('SELECT * FROM apontamentos ORDER BY criadoEm DESC').all();
  io.emit('apontamentos_atualizados', todosApts);
  res.json({ success: true });
});

// 8. Rota de Ocorrências e Motivos de Atraso
app.get('/api/ocorrencias', (req, res) => {
  const rows = db.prepare('SELECT * FROM ocorrencias ORDER BY criadoEm DESC').all();
  res.json(rows);
});

app.get('/api/ordens/:identificador/ocorrencias', (req, res) => {
  const { identificador } = req.params;
  const cleanId = normalizarIdOP(identificador);
  const formatId = formatarNumeroOP(cleanId);
  const rows = db.prepare(`
    SELECT * FROM ocorrencias 
    WHERE op_numero = ? OR op_numero = ? OR op_numero = ?
    ORDER BY criadoEm DESC
  `).all(identificador, cleanId, formatId);
  res.json(rows);
});

app.post(['/api/ordens/:identificador/ocorrencias', '/api/ocorrencias'], (req, res) => {
  const idParam = req.params.identificador;
  const body = req.body;
  const targetOp = body.opNumero || body.op_numero || idParam || '';
  const cleanId = normalizarIdOP(targetOp);
  const formatId = formatarNumeroOP(cleanId);
  const occId = String(body.id || Date.now());

  const stmt = db.prepare(`
    INSERT INTO ocorrencias (id, op_numero, dataHora, operador, posto, terminal, descricao, criadoEm)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      descricao = excluded.descricao,
      posto = excluded.posto,
      operador = excluded.operador
  `);

  stmt.run(
    occId,
    formatId,
    body.dataHora || new Date().toISOString(),
    body.operador || 'Não identificado',
    body.posto || 'Posto Geral',
    String(body.terminal || '1'),
    body.descricao || '',
    Date.now()
  );

  // Também atualiza o campo ocorrencias na ordem
  const opRow = db.prepare('SELECT * FROM ordens WHERE id = ? OR id = ? OR numero = ? OR numero = ?').get(targetOp, cleanId, formatId, cleanId);
  if (opRow) {
    let listaOcorrencias = [];
    try {
      listaOcorrencias = JSON.parse(opRow.ocorrencias || '[]');
      if (!Array.isArray(listaOcorrencias)) listaOcorrencias = Object.values(listaOcorrencias);
    } catch {}
    listaOcorrencias.push({
      id: occId,
      dataHora: body.dataHora || new Date().toISOString(),
      operador: body.operador || 'Não identificado',
      posto: body.posto || 'Posto Geral',
      terminal: body.terminal || 1,
      descricao: body.descricao || ''
    });
    db.prepare(`
      UPDATE ordens SET ocorrencias = ?, atualizadoEm = ?
      WHERE id = ? OR id = ? OR numero = ? OR numero = ?
    `).run(JSON.stringify(listaOcorrencias), Date.now(), targetOp, cleanId, formatId, cleanId);
  }

  const todas = obterTodasOrdens();
  io.emit('ordens_atualizadas', todas);
  io.emit('ocorrencia_registrada', { id: occId, opNumero: formatId, ...body });
  res.json({ success: true, id: occId });
});

// 9. Exclusão de ordens
app.delete('/api/ordens/:id', (req, res) => {
  const { id } = req.params;
  const cleanId = normalizarIdOP(id);
  const formatId = formatarNumeroOP(cleanId);
  db.prepare('DELETE FROM ordens WHERE id = ? OR id = ? OR numero = ? OR numero = ?').run(id, cleanId, formatId, cleanId);
  db.prepare('DELETE FROM apontamentos WHERE op_numero = ? OR op_numero = ? OR op_numero = ?').run(id, cleanId, formatId);
  db.prepare('DELETE FROM ocorrencias WHERE op_numero = ? OR op_numero = ? OR op_numero = ?').run(id, cleanId, formatId);
  const todas = obterTodasOrdens();
  io.emit('ordens_atualizadas', todas);
  res.json({ success: true });
});

app.delete('/api/ordens', (req, res) => {
  db.prepare('DELETE FROM ordens').run();
  db.prepare('DELETE FROM apontamentos').run();
  db.prepare('DELETE FROM ocorrencias').run();
  io.emit('ordens_atualizadas', []);
  io.emit('apontamentos_atualizados', []);
  res.json({ success: true });
});

io.on('connection', (socket) => {
  console.log('Cliente ligado via WebSocket:', socket.id);

  // Sincronização imediata de colaboradores e ordens com o Totem/cliente conectado
  try {
    const colabs = obterColaboradores();
    if (colabs && colabs.length > 0) {
      socket.emit('colaboradores_atualizados', colabs);
    }
  } catch (err) {
    console.warn('[Socket connection] Erro ao emitir colaboradores:', err);
  }

  try {
    const ordens = obterTodasOrdens();
    if (ordens && ordens.length > 0) {
      socket.emit('ordens_atualizadas', ordens);
    }
  } catch (err) {
    console.warn('[Socket connection] Erro ao emitir ordens:', err);
  }

  try {
    if (ultimaSyncNomus) {
      socket.emit('nomus_sync_status', ultimaSyncNomus);
    }
  } catch (err) {
    console.warn('[Socket connection] Erro ao emitir nomus_sync_status:', err);
  }

  socket.on('resetar_etapa', (data) => {
    try {
      if (!data) return;
      const num = data.numero || data.opNumero || data.id;
      const etapa = data.etapa || data.setor;
      if (!num) return;
      executarResetEtapa(num, etapa);
    } catch (err) {
      console.error('[Socket resetar_etapa] Erro:', err);
    }
  });

  socket.on('criar_setor', (data) => {
    if (!data) return;
    const termId = Number(data.terminalId || 1);
    const rawClean = String(data.sectorName || data.setor || '').trim();
    if (!rawClean) return;
    const clean = sanitizeSectorEncoding(rawClean);
    const row = db.prepare('SELECT * FROM terminais WHERE id = ?').get(termId);
    let sectors = [];
    if (row) {
      sectors = JSON.parse(row.sectors || '[]');
    }
    sectors = sectors.map(sanitizeSectorEncoding);
    if (!sectors.some(s => s.toLowerCase() === clean.toLowerCase())) {
      sectors.push(clean);
      sectors = Array.from(new Set(sectors));
      db.prepare('UPDATE terminais SET sectors = ?, atualizadoEm = ? WHERE id = ?')
        .run(JSON.stringify(sectors), Date.now(), termId);
      const atualizados = obterTerminais();
      io.emit('terminais_atualizados', atualizados);
      io.emit('setores_atualizados', atualizados);
    }
  });

  socket.on('atualizar_terminais', (terms) => {
    if (!Array.isArray(terms)) return;
    const stmt = db.prepare(`
      INSERT INTO terminais (id, name, label, sectors, atualizadoEm)
      VALUES (@id, @name, @label, @sectors, @atualizadoEm)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        label = excluded.label,
        sectors = excluded.sectors,
        atualizadoEm = excluded.atualizadoEm
    `);
    const now = Date.now();
    const tx = db.transaction((list) => {
      for (const t of list) {
        const rawSecs = Array.isArray(t.sectors) ? t.sectors : (Array.isArray(t.setores) ? t.setores : []);
        const secs = Array.from(new Set(rawSecs.map(sanitizeSectorEncoding).filter(Boolean)));
        stmt.run({
          id: Number(t.id),
          name: String(t.name || `Terminal ${t.id}`),
          label: String(t.label || ''),
          sectors: JSON.stringify(secs),
          atualizadoEm: now
        });
      }
    });
    tx(terms);
    const atualizados = obterTerminais();
    io.emit('terminais_atualizados', atualizados);
    io.emit('setores_atualizados', atualizados);
  });
});

// SPA Fallback: Qualquer rota GET que não seja /api ou /socket.io serve o index.html compilado
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
    return next();
  }
  if (fs.existsSync(distIndexPath)) {
    return res.sendFile(distIndexPath);
  }
  next();
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor MES a correr em http://192.168.0.12:${PORT}`);
});
