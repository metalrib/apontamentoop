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

// Rotas da API REST
app.get('/api/ordens', (req, res) => {
  const rows = db.prepare('SELECT * FROM ordens').all();
  const formatadas = rows.map(r => ({
    ...r,
    etapas: JSON.parse(r.etapas || '[]')
  }));
  res.json(formatadas);
});

app.post('/api/ordens', (req, res) => {
  const { ordens } = req.body;
  if (!Array.isArray(ordens)) return res.status(400).json({ error: 'Formato inválido' });

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO ordens (
      id, numero, codigo, descricao, cliente, tipoOrdem, status, etapas, quantidadeFisica, criadoEm, atualizadoEm
    ) VALUES (
      @id, @numero, @codigo, @descricao, @cliente, @tipoOrdem, @status, @etapas, @quantidadeFisica, @criadoEm, @atualizadoEm
    )
  `);

  const transacao = db.transaction((lista) => {
    for (const item of lista) {
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
        criadoEm: Number(item.criadoEm || Date.now()),
        atualizadoEm: Date.now()
      });
    }
  });

  transacao(ordens);
  
  const todas = db.prepare('SELECT * FROM ordens').all().map(r => ({ ...r, etapas: JSON.parse(r.etapas || '[]') }));
  io.emit('ordens_atualizadas', todas);
  res.json({ success: true, count: ordens.length });
});

app.put('/api/ordens/:id', (req, res) => {
  const { id } = req.params;
  const dados = req.body;

  const stmt = db.prepare(`
    UPDATE ordens SET
      status = COALESCE(@status, status),
      etapas = COALESCE(@etapas, etapas),
      atualizadoEm = @atualizadoEm
    WHERE id = @id
  `);

  stmt.run({
    id,
    status: dados.status || null,
    etapas: dados.etapas ? JSON.stringify(dados.etapas) : null,
    atualizadoEm: Date.now()
  });

  const todas = db.prepare('SELECT * FROM ordens').all().map(r => ({ ...r, etapas: JSON.parse(r.etapas || '[]') }));
  io.emit('ordens_atualizadas', todas);
  res.json({ success: true });
});

io.on('connection', (socket) => {
  console.log('Cliente ligado via WebSocket:', socket.id);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor MES a correr em http://192.168.0.12:${PORT}`);
});
