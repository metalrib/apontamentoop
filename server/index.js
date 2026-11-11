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
  if (rows.length === 0) return [];
  return rows.map(r => {
    let extra = {};
    try { extra = JSON.parse(r.dados || '{}'); } catch {}
    return {
      ...extra,
      id: r.id,
      nome: r.nome,
      name: r.nome,
      badge: r.badge,
      codigo: r.codigo,
      terminais: JSON.parse(r.terminais || '[]'),
      setores: JSON.parse(r.setores || '[]'),
      sectors: JSON.parse(r.setores || '[]'),
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
      const laserVal = Boolean(item.requerLaser || item.requer_laser) ? 1 : 0;

      stmt.run({
        id: formattedNum,
        numero: formattedNum,
        codigo: item.codigo || item.codigoProduto || '',
        descricao: item.descricao || item.produto || '',
        cliente: item.cliente || '',
        tipoOrdem: item.tipoOrdem || 'Padrão',
        status: item.status || 'pendente',
        etapas: JSON.stringify(item.etapas || []),
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

// 6. Rota para Toggle de Laser CNC
app.post('/api/ordens/:identificador/laser', (req, res) => {
  const { identificador } = req.params;
  const { requerLaser, requer_laser } = req.body;
  const laserBool = Boolean(requerLaser !== undefined ? requerLaser : requer_laser);
  const valor = laserBool ? 1 : 0;
  const cleanId = String(identificador || '').replace(/^(\s*OP\s*)+/i, '').trim();
  const formatId = `OP ${cleanId}`;

  // Busca ordem atual para atualizar etapas no SQLite
  const opRow = db.prepare('SELECT * FROM ordens WHERE id = ? OR id = ? OR numero = ? OR numero = ?').get(identificador, cleanId, formatId, cleanId);
  let novasEtapas = null;
  if (opRow) {
    try {
      const etapasAtuais = JSON.parse(opRow.etapas || '[]');
      if (Array.isArray(etapasAtuais)) {
        if (laserBool) {
          if (!etapasAtuais.some(e => String(e).toLowerCase().includes('laser'))) {
            const corteIdx = etapasAtuais.findIndex(e => String(e).toLowerCase().includes('corte'));
            if (corteIdx >= 0) {
              etapasAtuais.splice(corteIdx + 1, 0, 'Laser');
            } else {
              etapasAtuais.unshift('Laser');
            }
          }
        } else {
          const laserIdx = etapasAtuais.findIndex(e => String(e).toLowerCase().includes('laser'));
          if (laserIdx >= 0) {
            etapasAtuais.splice(laserIdx, 1);
          }
        }
        novasEtapas = JSON.stringify(etapasAtuais);
      }
    } catch {}
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
    identificador,
    cleanId,
    formatId
  });

  const todas = obterTodasOrdens();
  io.emit('ordens_atualizadas', todas);
  return res.json({ success: true, requerLaser: laserBool });
});

app.put('/api/ordens/:identificador/laser', (req, res, next) => {
  app._router.handle({ ...req, method: 'POST' }, res, next);
});
app.patch('/api/ordens/:identificador/laser', (req, res, next) => {
  app._router.handle({ ...req, method: 'POST' }, res, next);
});

// Fallback de compatibilidade
app.post('/api/ordens/update-laser', (req, res) => {
  const { id, opNumero, requerLaser, requer_laser } = req.body;
  const targetId = id || opNumero;
  if (!targetId) return res.status(400).json({ error: 'ID ou opNumero obrigatório' });
  req.params.identificador = targetId;
  app._router.handle({ ...req, url: `/api/ordens/${encodeURIComponent(targetId)}/laser` }, res);
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
