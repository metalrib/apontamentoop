import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distTemp = path.join(rootDir, 'dist_temp');
const distDir = path.join(rootDir, 'dist');
const distBackup = path.join(rootDir, 'dist_backup');

console.log('🚀 [Atomic Build] Iniciando compilação do Vite em diretório temporário (dist_temp)...');

// Limpeza preventiva de builds temporários antigos
try {
  if (fs.existsSync(distTemp)) fs.rmSync(distTemp, { recursive: true, force: true });
  if (fs.existsSync(distBackup)) fs.rmSync(distBackup, { recursive: true, force: true });
} catch (e) {
  // Ignora se não conseguir limpar preventivamente
}

// Executar vite build na pasta dist_temp
const viteCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const buildResult = spawnSync(viteCmd, ['vite', 'build', '--outDir', 'dist_temp', '--emptyOutDir'], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: true
});

if (buildResult.status !== 0) {
  console.error('\n❌ [Atomic Build] A compilação FALHOU! O build anterior em "dist/" foi mantido 100% INTACTO.');
  console.error('🛡️ [Zero-Downtime] Os terminais da fábrica não foram impactados e continuam funcionando normalmente.\n');
  try {
    if (fs.existsSync(distTemp)) fs.rmSync(distTemp, { recursive: true, force: true });
  } catch (_) {}
  process.exit(buildResult.status || 1);
}

const tempIndexPath = path.join(distTemp, 'index.html');
if (!fs.existsSync(tempIndexPath)) {
  console.error('\n❌ [Atomic Build] ERRO: dist_temp/index.html não foi gerado. Abortando troca para preservar dist atual.\n');
  process.exit(1);
}

// Funções utilitárias de sincronização em caso de bloqueio de rename pelo Windows
function copyRecursiveSync(src, dest) {
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((child) => {
      copyRecursiveSync(path.join(src, child), path.join(dest, child));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

function cleanDirDiff(currentDir, newDir) {
  if (!fs.existsSync(currentDir) || !fs.existsSync(newDir)) return;
  const currentItems = fs.readdirSync(currentDir);
  const newItems = new Set(fs.readdirSync(newDir));
  for (const item of currentItems) {
    const curPath = path.join(currentDir, item);
    const newPath = path.join(newDir, item);
    if (!newItems.has(item)) {
      fs.rmSync(curPath, { recursive: true, force: true });
    } else if (fs.statSync(curPath).isDirectory() && fs.statSync(newPath).isDirectory()) {
      cleanDirDiff(curPath, newPath);
    }
  }
}

console.log('🔄 [Atomic Build] Compilação concluída com sucesso! Promovendo dist_temp para dist...');

let swapSuccess = false;
if (!fs.existsSync(distDir)) {
  fs.renameSync(distTemp, distDir);
  swapSuccess = true;
} else {
  try {
    // Tentativa 1: Troca atômica rápida via rename
    if (fs.existsSync(distBackup)) fs.rmSync(distBackup, { recursive: true, force: true });
    fs.renameSync(distDir, distBackup);
    fs.renameSync(distTemp, distDir);
    fs.rmSync(distBackup, { recursive: true, force: true });
    swapSuccess = true;
  } catch (err) {
    // Tentativa 2: Se o Windows bloquear o rename de diretório aberto por servidor web
    console.log('[Atomic Build] Renomeação direta restrita pelo SO. Sincronizando arquivos de forma atômica...');
    try {
      copyRecursiveSync(distTemp, distDir);
      cleanDirDiff(distDir, distTemp);
      fs.rmSync(distTemp, { recursive: true, force: true });
      swapSuccess = true;
    } catch (syncErr) {
      console.error('❌ [Atomic Build] Erro ao sincronizar dist:', syncErr);
      process.exit(1);
    }
  }
}

// Garantir toque no index.html para acionar o fs.watch
const targetIndexPath = path.join(distDir, 'index.html');
if (fs.existsSync(targetIndexPath)) {
  try {
    const now = new Date();
    fs.utimesSync(targetIndexPath, now, now);
  } catch (_) {
    try {
      const content = fs.readFileSync(targetIndexPath);
      fs.writeFileSync(targetIndexPath, content);
    } catch (_) {}
  }
}

console.log('✅ [Atomic Build] Publicação atômica concluída com sucesso! dist/ atualizada.');

// Notificação direta via HTTP para o backend MES
const postData = JSON.stringify({ origem: 'build-atomic', timestamp: Date.now() });
const req = http.request({
  hostname: '127.0.0.1',
  port: 3001,
  path: '/api/sistema-atualizado',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  },
  timeout: 1500
}, (res) => {
  res.resume();
});
req.on('error', () => {
  // Ignora se o servidor de backend não estiver ativo na porta 3001
});
req.write(postData);
req.end();

process.exit(0);
