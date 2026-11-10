// Entrypoint unificado do servidor local Node.js MES Metalrib
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('./server/index.js');
