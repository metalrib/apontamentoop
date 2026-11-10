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

app.post('/api/ordens', (req, res) => {
  const { ordens } = req.body;
  if (!Array.isArray(ordens)) return res.status(400).json({ error: 'Formato inválido' });

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO ordens (
      id, numero, codigo, descricao, cliente, tipoOrdem, status, etapas, quantidadeFisica, requerLaser, requer_laser, criadoEm, atualizadoEm
    ) VALUES (
      @id, @numero, @codigo, @descricao, @cliente, @tipoOrdem, @status, @etapas, @quantidadeFisica, @requerLaser, @requer_laser, @criadoEm, @atualizadoEm
    )
  `);

  const transacao = db.transaction((lista) => {
    for (const item of lista) {
      const laserVal = Boolean(item.requerLaser || item.requer_laser) ? 1 : 0;
      stmt.run({
        id: item.id || item.numero,
        numero: item.numero || item.id,
        codigo: item.codigo || '',
        descricao: item.descricao || item.produto || '',
        cliente: item.cliente || '',
        tipoOrdem: item.tipoOrdem || 'Padrão',
        status: item.status || 'pendente',
        etapas: JSON.stringify(item.etapas || []),
        quantidadeFisica: Number(item.quantidadeFisica || item.quantidade || 1),
        requerLaser: laserVal,
        requer_laser: laserVal,
        criadoEm: Number(item.criadoEm || Date.now()),
        atualizadoEm: Date.now()
      });
    }
  });

  transacao(ordens);
  
  const todas = db.prepare('SELECT * FROM ordens').all().map(r => ({
    ...r,
    requerLaser: Boolean(r.requerLaser || r.requer_laser),
    requer_laser: Boolean(r.requerLaser || r.requer_laser),
    etapas: JSON.parse(r.etapas || '[]')
  }));
  io.emit('ordens_atualizadas', todas);
  res.json({ success: true, count: ordens.length });
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
