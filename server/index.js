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
const Database = require('better-sqlite3');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
  }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const db = new Database(path.join(__dirname, 'metalrib_mes.db'));

// Garantir colunas de controle de processos sob demanda (Laser CNC) e ocorrências
try {
  db.exec(`ALTER TABLE ordens ADD COLUMN requerLaser INTEGER DEFAULT 0;`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE ordens ADD COLUMN requer_laser INTEGER DEFAULT 0;`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE ordens ADD COLUMN ocorrencias TEXT;`);
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
    terminais TEXT,
    setores TEXT,
    especialista INTEGER DEFAULT 0,
    ativo INTEGER DEFAULT 1,
    dados TEXT,
    atualizadoEm INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_colaboradores_nome ON colaboradores(nome);
`);

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

// Inicialização com os 5 terminais oficiais caso esteja vazio
try {
  const countTerms = db.prepare('SELECT COUNT(*) as count FROM terminais').get();
  if (!countTerms || countTerms.count === 0) {
    const defaultTerms = [
      { id: 1, name: 'Terminal 1', label: 'Corte, Dobra e Laser', sectors: JSON.stringify(['Corte', 'Laser', 'Dobra', 'Preparação de Folha']) },
      { id: 2, name: 'Terminal 2', label: 'Preparação e Injetora de folhas', sectors: JSON.stringify(['Preparação de Folha', 'Preparação Office Door', 'Injeção', 'Injeção de Folhas']) },
      { id: 3, name: 'Terminal 3', label: 'Batentes e Portas Office/Emendadas', sectors: JSON.stringify(['Preparação de Batentes', 'Injeção e Finalização de Batentes', 'Montagem Portas Emendadas', 'Montagem Portas Office Door', 'Montagem Office Door Correr', 'Montagem Portas de Correr Padrão e Especial', 'Montagem de Portas Giratória Padrão e Especial', 'Montagem de Portas Giratórias', 'Instalação de Gaxeta', 'Finalização Vai Vem', 'Corte de Trilho p/ Porta Correr', 'Montagem de Trilho p/ Porta Correr']) },
      { id: 4, name: 'Terminal 4', label: 'Montagem Vai-Vem & Gaxeta', sectors: JSON.stringify(['Montagem Porta Vai-Vem', 'Montagem Portas Office Door', 'Instalação de Gaxeta', 'Montagem de Portas Giratória Padrão e Especial', 'Montagem Portas de Correr Padrão e Especial', 'Corte de Trilho p/ Porta Correr', 'Montagem de Trilho p/ Porta Correr']) },
      { id: 5, name: 'Terminal 5', label: 'Router, Solda e Especiais', sectors: JSON.stringify(['Corte Alumínio', 'Preparação Vai Vem', 'Router', 'Solda', 'Solda e Montagem', 'Montagem Estante', 'Elétrica', 'Cortina', 'Montagem Portas de Correr Padrão e Especial']) }
    ];
    const insertTerm = db.prepare('INSERT INTO terminais (id, name, label, sectors, atualizadoEm) VALUES (?, ?, ?, ?, ?)');
    for (const dt of defaultTerms) {
      insertTerm.run(dt.id, dt.name, dt.label, dt.sectors, Date.now());
    }
  }
} catch (e) {
  console.warn('[SQLite] Erro ao inicializar terminais padrão:', e);
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
  { id: 'victor', nome: 'Victor', badge: 'ROU-01', codigo: 'ROU-01', terminais: ['T5'], setores: ['Montagem Portas de Correr Padrão e Especial'], especialista: 0, ativo: 1 },
  { id: 'cristiane', nome: 'Cristiane', badge: 'ELE-01', codigo: 'ELE-01', terminais: ['T5'], setores: ['Montagem Portas de Correr Padrão e Especial'], especialista: 0, ativo: 1 },
  { id: 'marcio', nome: 'Marcio', badge: 'ELE-02', codigo: 'ELE-02', terminais: ['T5'], setores: ['Montagem Portas de Correr Padrão e Especial'], especialista: 0, ativo: 1 },
  { id: 'gabriele', nome: 'Gabriele', badge: 'COR-01', codigo: 'COR-01', terminais: ['T5'], setores: ['Montagem Estante', 'Cortina', 'Montagem Portas de Correr Padrão e Especial'], especialista: 0, ativo: 1 },
  { id: 'yasmin', nome: 'Yasmin', badge: 'PVV-01', codigo: 'PVV-01', terminais: ['T5'], setores: ['Montagem Portas de Correr Padrão e Especial'], especialista: 0, ativo: 1 },
  { id: 'carol', nome: 'Carol', badge: 'T5-01', codigo: 'T5-01', terminais: ['T5'], setores: ['Montagem Portas de Correr Padrão e Especial'], especialista: 0, ativo: 1 },
  { id: 'nathan', nome: 'Nathan', badge: 'SOL-01', codigo: 'SOL-01', terminais: ['T5'], setores: ['Solda', 'Montagem Portas de Correr Padrão e Especial'], especialista: 0, ativo: 1 },
  { id: 'fabio', nome: 'Fabio', badge: 'ESP-T5', codigo: 'ESP-T5', terminais: ['T5'], setores: ['Montagem Portas de Correr Padrão e Especial', 'Solda'], especialista: 1, ativo: 1 },

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
    // Saneamento compulsório de Eliel, Elionai e Leonardo Henrique no banco
    const sanitizarStmt = db.prepare(`
      UPDATE colaboradores 
      SET setores = @setores, atualizadoEm = @atualizadoEm
      WHERE id = @id
    `);
    sanitizarStmt.run({ id: 'eliel', setores: JSON.stringify(['Corte']), atualizadoEm: Date.now() });
    sanitizarStmt.run({ id: 'elionai', setores: JSON.stringify(['Corte']), atualizadoEm: Date.now() });
    sanitizarStmt.run({ id: 'leonardo_h', setores: JSON.stringify(['Preparação de Folha']), atualizadoEm: Date.now() });
  }
} catch (e) {
  console.warn('[SQLite] Erro ao inicializar colaboradores padrão:', e);
}

// Limpeza preventiva de duplicações e padronização de IDs
try {
  db.exec(`
    DELETE FROM ordens 
    WHERE rowid NOT IN (
      SELECT MIN(rowid) 
      FROM ordens 
      GROUP BY numero
    );
  `);
} catch (e) {}

// Garantir índice UNIQUE em numero para suportar UPSERT nativo
try {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ordens_numero ON ordens(numero);`);
} catch (e) {}

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
  }

  if (ordensAtualizadasCount > 0) {
    console.log(`[SQLite Migration] Total de ordens saneadas para novas rotas Nomus: ${ordensAtualizadasCount}`);
  }
} catch (e) {
  console.warn('[SQLite Migration] Erro na varredura retroativa de rotas:', e);
}

// Helper para formatar ordens
function obterTodasOrdens() {
  return db.prepare('SELECT * FROM ordens').all().map(r => ({
    ...r,
    requerLaser: Boolean(r.requerLaser || r.requer_laser),
    requer_laser: Boolean(r.requerLaser || r.requer_laser),
    etapas: JSON.parse(r.etapas || '[]'),
    ocorrencias: JSON.parse(r.ocorrencias || '[]')
  }));
}

// Rotas da API REST

// Helper para formatar colaboradores
function obterColaboradores() {
  const rows = db.prepare('SELECT * FROM colaboradores').all();
  if (rows.length === 0) {
    return COLABORADORES_PADRAO.map(c => {
      const p = (c.nome || '').trim().split(/\s+/).filter(Boolean);
      const inits = p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
      return { ...c, initials: inits, name: c.nome, sectors: c.setores };
    });
  }
  return rows.map(r => {
    let extra = {};
    try { extra = JSON.parse(r.dados || '{}'); } catch {}
    const parsedTerminais = JSON.parse(r.terminais || '[]');
    const parsedSetores = JSON.parse(r.setores || '[]');
    const partesNome = (r.nome || '').trim().split(/\s+/).filter(Boolean);
    const initials = (extra.initials && String(extra.initials).trim())
      ? String(extra.initials).trim().toUpperCase()
      : (partesNome.length === 1
        ? partesNome[0].slice(0, 2).toUpperCase()
        : partesNome.length >= 2
        ? (partesNome[0][0] + partesNome[partesNome.length - 1][0]).toUpperCase()
        : 'OP');
    return {
      ...extra,
      id: r.id,
      nome: r.nome,
      name: r.nome,
      initials,
      badge: r.badge,
      codigo: r.codigo,
      terminais: parsedTerminais,
      setores: parsedSetores,
      sectors: parsedSetores,
      especialista: Boolean(r.especialista),
      ativo: Boolean(r.ativo)
    };
  });
}

// 1. Listagem de ordens
app.get('/api/ordens', (req, res) => {
  res.json(obterTodasOrdens());
});

// 1.1 Status e cronômetro em tempo real de uma OP
app.get('/api/ordens/:identificador/status', (req, res) => {
  const { identificador } = req.params;
  const cleanId = String(identificador || '').replace(/^(\s*OP\s*)+/i, '').trim();
  const formatId = `OP ${cleanId}`;
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
  const lista = Array.isArray(req.body) ? req.body : (Array.isArray(req.body.colaboradores) ? req.body.colaboradores : [req.body]);
  const stmt = db.prepare(`
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
      dados = excluded.dados,
      atualizadoEm = excluded.atualizadoEm
  `);

  const tx = db.transaction((items) => {
    for (const item of items) {
      if (!item || (!item.id && !item.nome && !item.name)) continue;
      const id = String(item.id || item.nome || item.name).toLowerCase().replace(/\s+/g, '_');
      const nome = item.nome || item.name || '';
      stmt.run({
        id,
        nome,
        badge: item.badge || item.codigo || '',
        codigo: item.codigo || item.badge || '',
        terminais: JSON.stringify(item.terminais || []),
        setores: JSON.stringify(item.setores || item.sectors || []),
        especialista: (item.especialista || item.isRoaming || item.especialistaVolante) ? 1 : 0,
        ativo: item.ativo !== false ? 1 : 0,
        dados: JSON.stringify(item),
        atualizadoEm: Date.now()
      });
    }
  });

  tx(lista);
  const todos = obterColaboradores();
  io.emit('colaboradores_atualizados', todos);
  res.json({ success: true, count: todos.length });
});

function obterTerminais() {
  const rows = db.prepare('SELECT * FROM terminais ORDER BY id ASC').all();
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    label: r.label,
    sectors: JSON.parse(r.sectors || '[]'),
    setores: JSON.parse(r.sectors || '[]'),
    atualizadoEm: r.atualizadoEm
  }));
}

app.get('/api/terminais', (req, res) => {
  try {
    const list = obterTerminais();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/terminais', (req, res) => {
  try {
    const { terminals } = req.body;
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
        const secs = Array.isArray(t.sectors) ? t.sectors : (Array.isArray(t.setores) ? t.setores : []);
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

app.post('/api/terminais/:id/setores', (req, res) => {
  try {
    const termId = Number(req.params.id);
    const { sectorName, setor } = req.body;
    const clean = String(sectorName || setor || '').trim();
    if (!clean) return res.status(400).json({ error: 'Nome do setor obrigatório' });

    const row = db.prepare('SELECT * FROM terminais WHERE id = ?').get(termId);
    let sectors = [];
    if (row) {
      sectors = JSON.parse(row.sectors || '[]');
    }
    if (!sectors.some(s => s.toLowerCase() === clean.toLowerCase())) {
      sectors.push(clean);
    }

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

// 2. Limpeza de duplicadas
app.post('/api/ordens/limpar-duplicadas', (req, res) => {
  const info = db.prepare(`
    DELETE FROM ordens 
    WHERE rowid NOT IN (
      SELECT MIN(rowid) 
      FROM ordens 
      GROUP BY numero
    )
  `).run();

  const todas = obterTodasOrdens();
  io.emit('ordens_atualizadas', todas);
  res.json({ success: true, removidas: info.changes, total: todas.length });
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
      id, numero, codigo, descricao, cliente, tipoOrdem, status, etapas, quantidadeFisica, requerLaser, requer_laser, criadoEm, atualizadoEm
    ) VALUES (
      @id, @numero, @codigo, @descricao, @cliente, @tipoOrdem, @status, @etapas, @quantidadeFisica, @requerLaser, @requer_laser, @criadoEm, @atualizadoEm
    )
    ON CONFLICT(numero) DO UPDATE SET
      codigo = CASE WHEN excluded.codigo != '' THEN excluded.codigo ELSE ordens.codigo END,
      descricao = CASE WHEN excluded.descricao != '' THEN excluded.descricao ELSE ordens.descricao END,
      cliente = CASE WHEN excluded.cliente != '' THEN excluded.cliente ELSE ordens.cliente END,
      tipoOrdem = CASE WHEN excluded.tipoOrdem != '' THEN excluded.tipoOrdem ELSE ordens.tipoOrdem END,
      quantidadeFisica = excluded.quantidadeFisica,
      requerLaser = CASE WHEN excluded.requerLaser = 1 THEN 1 ELSE ordens.requerLaser END,
      requer_laser = CASE WHEN excluded.requer_laser = 1 THEN 1 ELSE ordens.requer_laser END,
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
      const rawNum = String(item.numero || item.id || '').replace(/^(\s*OP\s*)+/i, '').trim();
      if (!rawNum) continue;
      const formattedNum = `OP ${rawNum}`;
      let laserVal = Boolean(item.requerLaser || item.requer_laser) ? 1 : 0;
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
        criadoEm: Number(item.criadoEm || Date.now()),
        atualizadoEm: Date.now()
      });
    }
  });

  transacao(ordens);

  // Garantia absoluta de deduplicação pós-inserção
  db.prepare(`
    DELETE FROM ordens 
    WHERE rowid NOT IN (
      SELECT MIN(rowid) 
      FROM ordens 
      GROUP BY numero
    )
  `).run();
  
  const todas = obterTodasOrdens();
  io.emit('ordens_atualizadas', todas);
  res.json({ success: true, count: todas.length });
});

// 4. Atualização de ordem por ID / Número
app.put('/api/ordens/:id', (req, res) => {
  const { id } = req.params;
  const dados = req.body;
  const cleanId = String(id || '').replace(/^(\s*OP\s*)+/i, '').trim();
  const formatId = `OP ${cleanId}`;

  const hasLaser = dados.requerLaser !== undefined || dados.requer_laser !== undefined;
  const laserInt = hasLaser ? (Boolean(dados.requerLaser || dados.requer_laser) ? 1 : 0) : null;

  const stmt = db.prepare(`
    UPDATE ordens SET
      status = COALESCE(@status, status),
      etapas = COALESCE(@etapas, etapas),
      requerLaser = COALESCE(@laserInt, requerLaser),
      requer_laser = COALESCE(@laserInt, requer_laser),
      atualizadoEm = @atualizadoEm
    WHERE id = @id OR id = @cleanId OR numero = @id OR numero = @formatId OR numero = @cleanId
  `);

  stmt.run({
    id,
    cleanId,
    formatId,
    status: dados.status || null,
    etapas: dados.etapas ? (typeof dados.etapas === 'string' ? dados.etapas : JSON.stringify(dados.etapas)) : null,
    laserInt,
    atualizadoEm: Date.now()
  });

  const todas = obterTodasOrdens();
  io.emit('ordens_atualizadas', todas);
  res.json({ success: true });
});

// 5. Rota oficial de RESET DE OP (limpar apontamentos daquela OP no banco e zerar status)
app.post(['/api/ordens/:identificador/reset', '/api/ordens/reset'], (req, res) => {
  const identificador = req.params.identificador || req.body.id || req.body.opNumero;
  if (!identificador) return res.status(400).json({ error: 'Identificador de OP obrigatório' });

  const cleanId = String(identificador).replace(/^(\s*OP\s*)+/i, '').trim();
  const formatId = `OP ${cleanId}`;

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
  const cleanNumero = String(numeroRaw).replace(/^(\s*OP\s*)+/i, '').trim();
  const formatNumero = `OP ${cleanNumero}`;
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
  const cleanId = String(identificadorRaw || '').replace(/^(\s*OP\s*)+/i, '').trim();
  const formatId = `OP ${cleanId}`;
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
  const cleanId = String(identificador).replace(/^(\s*OP\s*)+/i, '').trim();
  const formatId = `OP ${cleanId}`;
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

  const cleanOp = String(apt.op_numero || apt.op || '').replace(/^(\s*OP\s*)+/i, '').trim();
  const formatOp = `OP ${cleanOp}`;

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
    if (apt.status === 'EM_ANDAMENTO') {
      novoStatus = 'EM_PRODUCAO';
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
  const cleanId = String(identificador).replace(/^(\s*OP\s*)+/i, '').trim();
  const formatId = `OP ${cleanId}`;
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
  const cleanId = String(targetOp).replace(/^(\s*OP\s*)+/i, '').trim();
  const formatId = `OP ${cleanId}`;
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
  const cleanId = String(id).replace(/^(\s*OP\s*)+/i, '').trim();
  const formatId = `OP ${cleanId}`;
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
    const clean = String(data.sectorName || data.setor || '').trim();
    if (!clean) return;
    const row = db.prepare('SELECT * FROM terminais WHERE id = ?').get(termId);
    let sectors = [];
    if (row) {
      sectors = JSON.parse(row.sectors || '[]');
    }
    if (!sectors.some(s => s.toLowerCase() === clean.toLowerCase())) {
      sectors.push(clean);
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
        const secs = Array.isArray(t.sectors) ? t.sectors : (Array.isArray(t.setores) ? t.setores : []);
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

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor MES a correr em http://192.168.0.12:${PORT}`);
});
