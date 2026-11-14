import {
  ProductionOrder,
  CODIGOS_PADRAO_GIRO,
  CODIGOS_PADRAO_CORRER,
  CODIGOS_TRILHOS_LGT_PADRAO,
  CODIGOS_FOLHAS_PADRAO,
  CODIGOS_BATENTES_PADRAO,
  CODIGOS_ANCORAS_PADRAO
} from '../types/mes';
import { extractProductCode, normalizeText } from './routeEngine';
import { verificarSeExigeEmenda } from './routeValidation';

export type FamiliaProduto =
  | 'PORTA_GIRATORIA'
  | 'VAI_VEM'
  | 'PORTA_CORRER'
  | 'FOLHA'
  | 'BATENTE'
  | 'PORTA_EMENDADA'
  | 'ACESSORIOS'
  | 'GERAL'
  | 'OUTROS';

/**
 * Classificador inteligente da Família do Produto da Ordem de Produção (OP)
 * HIERARQUIA RIGOROSA: PREFIXO DO CÓDIGO TEM PRIORIDADE MÁXIMA SOBRE TEXTO.
 */
export function identificarFamiliaProduto(
  input?: ProductionOrder | { codigo?: string; descricao?: string } | string | null,
  explicitCodigo?: string
): FamiliaProduto {
  if (!input && !explicitCodigo) {
    return 'GERAL';
  }

  const rawDesc = typeof input === 'object' && input !== null
    ? (input.descricao || '')
    : typeof input === 'string'
    ? input
    : '';

  const rawCode = explicitCodigo
    ? explicitCodigo
    : typeof input === 'object' && input !== null
    ? (input.codigo || '')
    : '';

  const norm = normalizeText(rawDesc);
  const code = (rawCode ? extractProductCode(rawCode) : extractProductCode(rawDesc) || '').trim();

  // 1. PORTA EMENDADA (Tabela técnica oficial baseada em dimensões ou texto explícito)
  if (
    verificarSeExigeEmenda(rawDesc) ||
    norm.includes('EMENDADA') ||
    norm.includes('EMENDADO') ||
    norm.includes('EME-') ||
    /\bEME\b/.test(norm) ||
    code.startsWith('002.')
  ) {
    return 'PORTA_EMENDADA';
  }

  // 1. FOLHAS (Prioridade absoluta se iniciar com FOLHA ou código da família de folhas)
  if (
    norm.startsWith('FOLHA') ||
    code.startsWith('020.001') ||
    code.startsWith('020.002') ||
    code.startsWith('020.0030') ||
    code.startsWith('020.0031') ||
    CODIGOS_FOLHAS_PADRAO.has(code)
  ) {
    return 'FOLHA';
  }

  // 2. BATENTES (Se a descrição começar com BAT/BATENTE ou código for de batente - SOMENTE SE NÃO FOR FOLHA)
  // IMPORTANTE: NÃO usar desc.includes('BAT') puro, pois '3BAT' e '4BAT' são atributos da porta!
  const isBatenteCode =
    !norm.startsWith('FOLHA') &&
    (['020.0005', '020.0006', '020.0007', '020.0008', '020.003', '020.004', '020.005'].some(prefix => code.startsWith(prefix)) ||
    CODIGOS_BATENTES_PADRAO.has(code));

  const isBatenteDesc =
    !norm.startsWith('FOLHA') &&
    (norm.startsWith('BAT ') ||
    norm.startsWith('BAT-') ||
    norm.startsWith('BATENTE ') ||
    norm.startsWith('BATENTES '));

  if (isBatenteCode || isBatenteDesc) {
    return 'BATENTE';
  }

  // 3. PORTAS GIRATÓRIAS (Códigos 001.xxx e 003.xxx - EXCLUI BATENTES E FOLHAS)
  if (
    code.startsWith('001.') ||
    code.startsWith('003.') ||
    CODIGOS_PADRAO_GIRO.has(code) ||
    ((norm.includes('PT GIR') || norm.includes('PORTA GIR') || norm.includes('PORTA GIRATORIA')) && !norm.startsWith('BAT ') && !norm.startsWith('BATENTE ') && !norm.startsWith('FOLHA'))
  ) {
    return 'PORTA_GIRATORIA';
  }

  // 4. PORTAS VAI-VEM (Código 011.xxx)
  if (
    code.startsWith('011.') ||
    norm.includes('VAI VEM') ||
    norm.includes('VAI-VEM') ||
    norm.includes('VAIVEM')
  ) {
    return 'VAI_VEM';
  }

  // 5. PORTAS DE CORRER (Códigos 005.xxx e 007.xxx - EXCLUI BATENTES E FOLHAS)
  if (
    code.startsWith('005.') ||
    code.startsWith('007.') ||
    CODIGOS_PADRAO_CORRER.has(code) ||
    ((norm.includes('CORRER') || norm.includes('PT COR') || norm.includes('PORTA COR')) && !norm.startsWith('BAT ') && !norm.startsWith('BATENTE ') && !norm.startsWith('FOLHA'))
  ) {
    return 'PORTA_CORRER';
  }

  // 6. ACESSÓRIOS / MIUDEZAS (Âncoras, Trilhos, Perfis)
  if (
    code.startsWith('021.') ||
    code.startsWith('022.') ||
    code.startsWith('028.') ||
    CODIGOS_ANCORAS_PADRAO.has(code) ||
    CODIGOS_TRILHOS_LGT_PADRAO.has(code) ||
    norm.includes('ANCORA') ||
    norm.includes('TRILHO') ||
    norm.includes('PERFIL') ||
    norm.includes('MIUDEZA') ||
    norm.includes('ROLDANA') ||
    norm.includes('PUXADOR')
  ) {
    return 'ACESSORIOS';
  }

  return 'GERAL';
}

export type ModeloProduto =
  | 'Portas Giratória'
  | 'Portas Correr'
  | 'Vai vem'
  | 'Office Door'
  | 'Batentes'
  | 'Folha'
  | 'Ancoras'
  | 'Trilhos'
  | 'Pendurais'
  | 'Cortina'
  | 'QC Comando'
  | 'Outros';

export const MODELOS_PRODUTO: ModeloProduto[] = [
  'Portas Giratória',
  'Portas Correr',
  'Vai vem',
  'Office Door',
  'Batentes',
  'Folha',
  'Ancoras',
  'Trilhos',
  'Pendurais',
  'Cortina',
  'QC Comando',
  'Outros'
];

/**
 * Classificador oficial de Modelo / Categoria de Produto para a visualização no Portal PCP
 * Analisa descrição, categoria e código do produto e retorna um dos modelos padronizados.
 */
export function classificarModeloOP(op?: any): ModeloProduto {
  if (!op) return 'Outros';

  const norm = (str?: any) =>
    String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .trim();

  let dadosObj: any = {};
  try {
    if (op.dados) {
      dadosObj = typeof op.dados === 'string' ? JSON.parse(op.dados) : op.dados;
    }
  } catch {}

  const desc = norm(op.descricao || op.produto || dadosObj.descricao || dadosObj.produto);
  const cat = norm(op.categoria || dadosObj.categoria);
  const cod = norm(
    op.codigo ||
    op.codigo_produto ||
    op.codigoProduto ||
    dadosObj.codigo ||
    dadosObj.codigo_produto ||
    dadosObj.codigoProduto
  );

  // 1. Office Door: se contiver OFFICE DOOR ou OFFICE
  if (
    desc.includes('OFFICE DOOR') ||
    desc.includes('OFFICE') ||
    cat.includes('OFFICE') ||
    cod.startsWith('009.') ||
    cod.startsWith('010.')
  ) {
    return 'Office Door';
  }

  // 2. Folha: se começar com FOLHA ou código de folha
  if (desc.startsWith('FOLHA') || (cod.startsWith('020.') && parseInt(cod.slice(4) || '0', 10) <= 31)) {
    return 'Folha';
  }

  // 3. Batentes: se começar com BATENTE ou BAT ou código iniciar com 020. (desde que não seja folha)
  if (
    !desc.startsWith('FOLHA') &&
    (
      desc.startsWith('BATENTE') ||
      desc.startsWith('BAT ') ||
      desc.startsWith('BAT-') ||
      (cod.startsWith('020.') && parseInt(cod.slice(4) || '0', 10) >= 32) ||
      ['020.0005', '020.0006', '020.0007', '020.0008'].includes(cod)
    )
  ) {
    return 'Batentes';
  }

  // 4. Trilhos: se contiver TRILHO
  if (desc.includes('TRILHO') || cat.includes('TRILHO')) {
    return 'Trilhos';
  }

  // 5. Pendurais: se contiver PENDURAL ou PENDURAIS
  if (desc.includes('PENDURAL') || desc.includes('PENDURAIS') || cat.includes('PENDURAL')) {
    return 'Pendurais';
  }

  // 6. Cortina: se contiver CORTINA
  if (desc.includes('CORTINA') || cat.includes('CORTINA')) {
    return 'Cortina';
  }

  // 7. QC Comando: se contiver QUADRO, QC , COMANDO ou PAINEL ELETRICO
  if (
    desc.includes('QUADRO') ||
    desc.includes('QC ') ||
    desc.includes('COMANDO') ||
    desc.includes('PAINEL ELETRICO') ||
    cat.includes('QUADRO') ||
    cat.includes('COMANDO')
  ) {
    return 'QC Comando';
  }

  // 8. Ancoras: se contiver ANCORA
  if (desc.includes('ANCORA') || cat.includes('ANCORA')) {
    return 'Ancoras';
  }

  // 9. Vai vem: se contiver VAI VEM ou VAI-VEM ou código iniciar com 011.
  if (
    desc.includes('VAI VEM') ||
    desc.includes('VAI-VEM') ||
    desc.includes('VAIVEM') ||
    cod.startsWith('011.') ||
    cat.includes('VAI VEM') ||
    cat.includes('VAI-VEM')
  ) {
    return 'Vai vem';
  }

  // 10. Portas Giratória: se contiver PT GIR ou PORTA GIR ou código iniciar com 001. ou 003. (e não começar com BATENTE ou FOLHA)
  const isGir =
    (desc.includes('PT GIR') ||
      desc.includes('PORTA GIR') ||
      desc.includes('PORTA DE GIRO') ||
      (desc.includes('PORTA') && desc.includes('GIRO')) ||
      cod.startsWith('001.') ||
      cod.startsWith('003.') ||
      cat.includes('GIRATORIA') ||
      cat.includes('GIRO')) &&
    !desc.startsWith('BATENTE') &&
    !desc.startsWith('BAT ') &&
    !desc.startsWith('BAT-') &&
    !desc.startsWith('FOLHA');
  if (isGir) {
    return 'Portas Giratória';
  }

  // 11. Portas Correr: se contiver PT COR ou PORTA COR ou código iniciar com 005. (e não começar com BATENTE, FOLHA ou TRILHO)
  const isCor =
    (desc.includes('PT COR') ||
      desc.includes('PORTA COR') ||
      desc.includes('PORTA DE CORRER') ||
      (desc.includes('PORTA') && desc.includes('CORRER')) ||
      cod.startsWith('005.') ||
      cod.startsWith('007.') ||
      cat.includes('CORRER')) &&
    !desc.startsWith('BATENTE') &&
    !desc.startsWith('BAT ') &&
    !desc.startsWith('BAT-') &&
    !desc.startsWith('FOLHA') &&
    !desc.startsWith('TRILHO');
  if (isCor) {
    return 'Portas Correr';
  }

  return 'Outros';
}
