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
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const db = new Database(path.join(__dirname, 'metalrib_mes.db'));

// Garantir colunas de controle de processos sob demanda (Laser CNC)
try {
  db.exec(`ALTER TABLE ordens ADD COLUMN requerLaser INTEGER DEFAULT 0;`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE ordens ADD COLUMN requer_laser INTEGER DEFAULT 0;`);
} catch (e) {}

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

// Rotas da API REST
app.get('/api/ordens', (req, res) => {
  const rows = db.prepare('SELECT * FROM ordens').all();
  const formatadas = rows.map(r => ({
    ...r,
    requerLaser: Boolean(r.requerLaser || r.requer_laser),
    requer_laser: Boolean(r.requerLaser || r.requer_laser),
    etapas: JSON.parse(r.etapas || '[]')
  }));
  res.json(formatadas);
});

// Endpoint dedicado para limpeza de registros duplicados
app.post('/api/ordens/limpar-duplicadas', (req, res) => {
  const info = db.prepare(`
    DELETE FROM ordens 
    WHERE rowid NOT IN (
      SELECT MIN(rowid) 
      FROM ordens 
      GROUP BY numero
    )
  `).run();

  const todas = db.prepare('SELECT * FROM ordens').all().map(r => ({
    ...r,
    requerLaser: Boolean(r.requerLaser || r.requer_laser),
    requer_laser: Boolean(r.requerLaser || r.requer_laser),
    etapas: JSON.parse(r.etapas || '[]')
  }));
  io.emit('ordens_atualizadas', todas);
  res.json({ success: true, removidas: info.changes, total: todas.length });
});

app.post('/api/ordens', (req, res) => {
  const { ordens, replaceAll, modoImportacao } = req.body;
  if (!Array.isArray(ordens)) return res.status(400).json({ error: 'Formato inválido' });

  // Se o modo for 'substituir' ou replaceAll for true:
  // Remove APENAS as ordens não iniciadas para renovar a carga de trabalho sem apagar OPs em andamento
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
  
  const todas = db.prepare('SELECT * FROM ordens').all().map(r => ({
    ...r,
    requerLaser: Boolean(r.requerLaser || r.requer_laser),
    requer_laser: Boolean(r.requerLaser || r.requer_laser),
    etapas: JSON.parse(r.etapas || '[]')
  }));
  io.emit('ordens_atualizadas', todas);
  res.json({ success: true, count: todas.length });
});

app.put('/api/ordens/:id', (req, res) => {
  const { id } = req.params;
  const dados = req.body;
  const cleanId = String(id || '').replace(/^OP\s*/i, '').trim();
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

  const todas = db.prepare('SELECT * FROM ordens').all().map(r => ({
    ...r,
    requerLaser: Boolean(r.requerLaser || r.requer_laser),
    requer_laser: Boolean(r.requerLaser || r.requer_laser),
    etapas: JSON.parse(r.etapas || '[]')
  }));
  io.emit('ordens_atualizadas', todas);
  io.emit('op_resetada', { id: cleanId, opNumero: formatId, etapas: dados.etapas, status: dados.status, requerLaser: Boolean(laserInt) });
  res.json({ success: true });
});

app.post('/api/ordens/update-laser', (req, res) => {
  const { id, opNumero, requerLaser, requer_laser } = req.body;
  const targetId = id || opNumero;
  if (!targetId) return res.status(400).json({ error: 'ID ou opNumero obrigatório' });

  const cleanId = String(targetId).replace(/^OP\s*/i, '').trim();
  const formatId = `OP ${cleanId}`;
  const laserBool = Boolean(requerLaser !== undefined ? requerLaser : requer_laser);
  const laserInt = laserBool ? 1 : 0;

  // Busca ordem atual para atualizar ou recalcular etapas se necessário
  const opRow = db.prepare('SELECT * FROM ordens WHERE id = ? OR id = ? OR numero = ? OR numero = ?').get(targetId, cleanId, formatId, cleanId);
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
    UPDATE ordens SET
      requerLaser = @laserInt,
      requer_laser = @laserInt,
      etapas = COALESCE(@novasEtapas, etapas),
      atualizadoEm = @atualizadoEm
    WHERE id = @targetId OR id = @cleanId OR numero = @targetId OR numero = @formatId OR numero = @cleanId
  `);

  stmt.run({
    targetId,
    cleanId,
    formatId,
    laserInt,
    novasEtapas,
    atualizadoEm: Date.now()
  });

  const todas = db.prepare('SELECT * FROM ordens').all().map(r => ({
    ...r,
    requerLaser: Boolean(r.requerLaser || r.requer_laser),
    requer_laser: Boolean(r.requerLaser || r.requer_laser),
    etapas: JSON.parse(r.etapas || '[]')
  }));
  io.emit('ordens_atualizadas', todas);
  res.json({ success: true, requerLaser: laserBool });
});

app.delete('/api/ordens/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM ordens WHERE id = ?').run(id);
  const todas = db.prepare('SELECT * FROM ordens').all().map(r => ({ ...r, etapas: JSON.parse(r.etapas || '[]') }));
  io.emit('ordens_atualizadas', todas);
  res.json({ success: true });
});

app.delete('/api/ordens', (req, res) => {
  db.prepare('DELETE FROM ordens').run();
  io.emit('ordens_atualizadas', []);
  res.json({ success: true });
});

io.on('connection', (socket) => {
  console.log('Cliente ligado via WebSocket:', socket.id);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor MES a correr em http://192.168.0.12:${PORT}`);
});
