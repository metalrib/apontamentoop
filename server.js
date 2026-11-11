// Entrypoint unificado do servidor local Node.js MES Metalrib
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Resiliência do processo Node.js contra encerramentos inesperados
process.on('uncaughtException', (err) => {
  console.error('[Process Error] Erro não tratado no servidor:', err);
});
process.on('unhandledRejection', (reason, p) => {
  console.error('[Process Rejection] Promise rejeitada no servidor:', reason);
});

require('./server/index.js');
