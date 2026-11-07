import assert from 'assert';
import { verificarECorrigirRotaOp } from '../src/services/mesStorage';

console.log('=== TESTE DE AUTO-CORREÇÃO NO RUNTIME DO FRONTEND ===\n');

// 1. OP 023865-01 com rota curta de 1 etapa (vinda com dados defasados do banco)
const opCorrerAntiga: any = {
  op_numero: 'OP 023865-01',
  numero: 'OP 023865-01',
  codigo: '005.0149',
  descricao: 'PT COR RESF 2.100A X 1.000L',
  etapas: ['Montagem Portas de Correr Padrão e Especial'],
  rota: ['Montagem Portas de Correr Padrão e Especial'],
  etapaAtual: 'Montagem Portas de Correr Padrão e Especial',
  statusAtual: 'AGUARDANDO INÍCIO EM: Montagem Portas de Correr Padrão e Especial',
  statusEtapa: 'Aguardando Início em: Montagem Portas de Correr Padrão e Especial',
  status: 'Aguardando Início em: Montagem Portas de Correr Padrão e Especial',
  apontamentos: {}
};

const opCorrerCorrigida = verificarECorrigirRotaOp(opCorrerAntiga);
console.log('[TESTE 1] OP 023865-01 (Porta de Correr Especial 005.0149):');
console.log('  Família corrigida:', opCorrerCorrigida.familia);
console.log('  Rota corrigida (5 etapas):', opCorrerCorrigida.rota);
console.log('  Etapa Atual:', opCorrerCorrigida.etapaAtual);
console.log('  Status Atual:', opCorrerCorrigida.statusAtual);

assert.strictEqual(opCorrerCorrigida.familia, 'Porta de Correr Especial');
assert.deepStrictEqual(opCorrerCorrigida.rota, [
  'Corte',
  'Dobra',
  'Preparação de Folha',
  'Injeção',
  'Montagem Portas de Correr Padrão e Especial'
]);
assert.deepStrictEqual(opCorrerCorrigida.etapas, opCorrerCorrigida.rota);
assert.strictEqual(opCorrerCorrigida.etapaAtual, 'Corte');
assert.strictEqual(opCorrerCorrigida.statusAtual, 'AGUARDANDO INÍCIO EM: Corte');
console.log('✅ TESTE 1 APROVADO!');

// 2. OP 024352-01 com rota curta de 2 etapas (vinda com dados defasados do banco)
const opGiroAntiga: any = {
  op_numero: 'OP 024352-01',
  numero: 'OP 024352-01',
  codigo: '003.0140',
  descricao: 'PT GIR CONG 1.800A X 700L',
  etapas: ['Instalação de Gaxeta', 'Montagem de Portas Giratória Padrão e Especial'],
  rota: ['Instalação de Gaxeta', 'Montagem de Portas Giratória Padrão e Especial'],
  etapaAtual: 'Instalação de Gaxeta',
  statusAtual: 'AGUARDANDO INÍCIO EM: Instalação de Gaxeta',
  statusEtapa: 'Aguardando Início em: Instalação de Gaxeta',
  status: 'Aguardando Início em: Instalação de Gaxeta',
  apontamentos: {}
};

const opGiroCorrigida = verificarECorrigirRotaOp(opGiroAntiga);
console.log('\n[TESTE 2] OP 024352-01 (Porta Giratória Especial 700L 003.0140):');
console.log('  Família corrigida:', opGiroCorrigida.familia);
console.log('  Rota corrigida (6 etapas):', opGiroCorrigida.rota);
console.log('  Etapa Atual:', opGiroCorrigida.etapaAtual);
console.log('  Status Atual:', opGiroCorrigida.statusAtual);

assert.strictEqual(opGiroCorrigida.familia, 'Porta Giratória Especial');
assert.deepStrictEqual(opGiroCorrigida.rota, [
  'Corte',
  'Dobra',
  'Preparação de Folha',
  'Injeção',
  'Instalação de Gaxeta',
  'Montagem de Portas Giratória Padrão e Especial'
]);
assert.deepStrictEqual(opGiroCorrigida.etapas, opGiroCorrigida.rota);
assert.strictEqual(opGiroCorrigida.etapaAtual, 'Corte');
assert.strictEqual(opGiroCorrigida.statusAtual, 'AGUARDANDO INÍCIO EM: Corte');
console.log('✅ TESTE 2 APROVADO!');

// 3. Batente avulso não deve ser transformado em porta
const opBatente: any = {
  op_numero: 'OP 023870-01',
  codigo: '020.0046',
  descricao: 'BAT GIRO 2.000A X 1.200L 3BAT',
  etapas: ['Corte', 'Dobra', 'Preparação de Batentes', 'Injeção e Finalização de Batentes'],
  rota: ['Corte', 'Dobra', 'Preparação de Batentes', 'Injeção e Finalização de Batentes']
};
const batenteVerificado = verificarECorrigirRotaOp(opBatente);
assert.deepStrictEqual(batenteVerificado.rota, opBatente.rota);
console.log('\n✅ TESTE 3: Subcomponente Batente preservado sem interferência!');

// 4. Porta Giratória padrão (Whitelist 800L) deve manter 2 etapas
const opGiroPadrao: any = {
  op_numero: 'OP 024100-01',
  codigo: '001.0100',
  descricao: 'PT GIR RESFR 1.800A X 800L',
  etapas: ['Instalação de Gaxeta', 'Montagem de Portas Giratória Padrão e Especial'],
  rota: ['Instalação de Gaxeta', 'Montagem de Portas Giratória Padrão e Especial']
};
const giroPadraoVerificado = verificarECorrigirRotaOp(opGiroPadrao);
assert.deepStrictEqual(giroPadraoVerificado.rota, opGiroPadrao.rota);
console.log('✅ TESTE 4: Porta Giratória Padrão (Whitelist) preservada com 2 etapas!');

console.log('\n🎉 TODOS OS TESTES DE RUNTIME PASSARAM COM SUCESSO!');
process.exit(0);
