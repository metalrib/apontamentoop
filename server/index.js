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

// 1. Listagem de ordens
app.get('/api/ordens', (req, res) => {
  res.json(obterTodasOrdens());
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

  stmt.run({
    id: String(apt.id),
    op_numero: formatOp,
    unidade_numero: Number(apt.unidade_numero || 0),
    unidade: apt.unidade || '',
    modo: apt.modo || 'LOTE',
    setor: apt.setor || '',
    setorFisico: apt.setorFisico || apt.setor || '',
    etapa_rota: apt.etapa_rota || apt.etapaRota || '',
    terminal_id: Number(apt.terminal_id || 1),
    terminal: apt.terminal || `T${apt.terminal_id || 1}`,
    operador: apt.operador || apt.colaborador || '',
    colaborador: apt.colaborador || apt.operador || '',
    hora_inicio: apt.hora_inicio || apt.horaInicio || new Date().toISOString(),
    hora_fim: apt.hora_fim || apt.horaFim || null,
    duracao_minutos: Number(apt.duracao_minutos || apt.duracao || 0),
    duracaoMs: Number(apt.duracaoMs || 0),
    status: apt.status || 'EM_ANDAMENTO',
    observacao: apt.observacao || '',
    is_lote: apt.is_lote ? 1 : 0,
    quantidade_lote: Number(apt.quantidade_lote || 0),
    quantidade_refugo: Number(apt.quantidade_refugo || 0),
    criadoEm: Date.now()
  });

  const todosApts = db.prepare('SELECT * FROM apontamentos ORDER BY criadoEm DESC').all();
  io.emit('apontamentos_atualizados', todosApts);
  res.json({ success: true, apontamento: apt });
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
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor MES a correr em http://192.168.0.12:${PORT}`);
});
