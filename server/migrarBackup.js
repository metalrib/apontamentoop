const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'metalrib_mes.db');
const jsonPath = path.join(__dirname, 'apontamentoop-default-rtdb-export.json');

if (!fs.existsSync(jsonPath)) {
  console.error("Ficheiro de exportação não encontrado!");
  process.exit(1);
}

const db = new Database(dbPath);

// Criação da tabela
db.exec(`
  CREATE TABLE IF NOT EXISTS ordens (
    id TEXT PRIMARY KEY,
    numero TEXT,
    codigo TEXT,
    descricao TEXT,
    cliente TEXT,
    tipoOrdem TEXT,
    status TEXT,
    etapas TEXT,
    quantidadeFisica INTEGER DEFAULT 1,
    requerLaser INTEGER DEFAULT 0,
    requer_laser INTEGER DEFAULT 0,
    criadoEm INTEGER,
    atualizadoEm INTEGER
  );
`);

console.log("A carregar ordens do ficheiro JSON...");
const rawData = fs.readFileSync(jsonPath, 'utf-8');
const data = JSON.parse(rawData);

const ordensFonte = data.ordens || data.ordens_producao || {};
const chaves = Object.keys(ordensFonte);

console.log(`Encontradas ${chaves.length} ordens para migrar.`);

const stmt = db.prepare(`
  INSERT OR REPLACE INTO ordens (
    id, numero, codigo, descricao, cliente, tipoOrdem, status, etapas, quantidadeFisica, criadoEm, atualizadoEm
  ) VALUES (
    @id, @numero, @codigo, @descricao, @cliente, @tipoOrdem, @status, @etapas, @quantidadeFisica, @criadoEm, @atualizadoEm
  )
`);

const insertMuitos = db.transaction((ordens) => {
  for (const item of ordens) {
    stmt.run(item);
  }
});

const lista = chaves.map((chave) => {
  const item = ordensFonte[chave];
  const opId = String(item.id || item.numero || chave).replace(/^OP\s*/i, '').trim();
  return {
    id: opId,
    numero: item.numero || opId,
    codigo: item.codigo || '',
    descricao: item.descricao || item.produto || '',
    cliente: item.cliente || '',
    tipoOrdem: item.tipoOrdem || 'Padrão',
    status: item.status || 'pendente',
    etapas: JSON.stringify(item.etapas || []),
    quantidadeFisica: Number(item.quantidadeFisica || item.quantidade || 1),
    criadoEm: Number(item.criadoEm || item.timestampCriacao || Date.now()),
    atualizadoEm: Number(item.atualizadoEm || item.ultimaAtualizacao || Date.now())
  };
});

insertMuitos(lista);
console.log("Migração concluída com sucesso para o SQLite!");
