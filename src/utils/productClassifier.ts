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

  // 2. PORTAS GIRATÓRIAS (Códigos 001.xxx e 003.xxx são sempre Portas Giratórias, mesmo contendo 3BAT/4BAT)
  if (
    code.startsWith('001.') ||
    code.startsWith('003.') ||
    CODIGOS_PADRAO_GIRO.has(code) ||
    ((norm.includes('PT GIR') || norm.includes('PORTA GIR') || norm.includes('PORTA GIRATORIA')) && !norm.startsWith('BAT ') && !norm.startsWith('BATENTE '))
  ) {
    return 'PORTA_GIRATORIA';
  }

  // 2. PORTAS VAI-VEM (Código 011.xxx)
  if (
    code.startsWith('011.') ||
    norm.includes('VAI VEM') ||
    norm.includes('VAI-VEM') ||
    norm.includes('VAIVEM')
  ) {
    return 'VAI_VEM';
  }

  // 3. PORTAS DE CORRER (Códigos 005.xxx e 007.xxx)
  if (
    code.startsWith('005.') ||
    code.startsWith('007.') ||
    CODIGOS_PADRAO_CORRER.has(code) ||
    norm.includes('CORRER') ||
    norm.includes('PT COR') ||
    norm.includes('PORTA COR')
  ) {
    return 'PORTA_CORRER';
  }

  // 4. FOLHAS (Códigos 020.001x ou texto com FOLHA)
  if (
    norm.includes('FOLHA') ||
    norm.includes('FOLHAS') ||
    code.startsWith('020.001') ||
    CODIGOS_FOLHAS_PADRAO.has(code)
  ) {
    return 'FOLHA';
  }

  // 5. BATENTES (Apenas códigos de batentes específicos ou quando a descrição começa com BAT/BATENTE)
  // IMPORTANTE: NÃO usar desc.includes('BAT') puro, pois '3BAT' e '4BAT' são atributos da porta!
  const isBatenteCode =
    ['020.0005', '020.0006', '020.0007', '020.0008', '020.003', '020.004', '020.005'].some(prefix => code.startsWith(prefix)) ||
    CODIGOS_BATENTES_PADRAO.has(code);

  const isBatenteDesc =
    norm.startsWith('BAT ') ||
    norm.startsWith('BAT-') ||
    norm.startsWith('BATENTE ') ||
    norm.startsWith('BATENTES ');

  if (isBatenteCode || isBatenteDesc) {
    return 'BATENTE';
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
