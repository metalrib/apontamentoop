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

export type FamiliaProduto =
  | 'VAI_VEM'
  | 'PORTA_GIRATORIA'
  | 'BATENTE'
  | 'FOLHA'
  | 'PORTA_CORRER'
  | 'PORTA_EMENDADA'
  | 'ACESSORIOS'
  | 'OUTROS';

/**
 * Classificador inteligente da Família do Produto da Ordem de Produção (OP)
 * Analisa o código do produto e a descrição oficial do ERP Nomus.
 */
export function identificarFamiliaProduto(
  input?: ProductionOrder | { codigo?: string; descricao?: string } | string | null,
  explicitCodigo?: string
): FamiliaProduto {
  if (!input && !explicitCodigo) {
    return 'OUTROS';
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

  // 1. FAMÍLIA VAI_VEM:
  // Se contiver 'VAI VEM' ou código iniciar com '011.'
  if (
    code.startsWith('011.') ||
    norm.includes('VAI VEM') ||
    norm.includes('VAI-VEM') ||
    norm.includes('VAIVEM')
  ) {
    return 'VAI_VEM';
  }

  // 2. FAMÍLIA BATENTE:
  // Se contiver 'BAT' ou 'BATENTE' ou códigos '020.0005', '020.0006', '020.0007', '020.0008', '020.003', '020.004', '020.005'
  // (Nota: Checado antes de PORTA_GIRATORIA pois itens como "BAT GIRO" são batentes, não folhas/portas giratórias)
  const isBatenteCode =
    code.startsWith('020.0005') ||
    code.startsWith('020.0006') ||
    code.startsWith('020.0007') ||
    code.startsWith('020.0008') ||
    code.startsWith('020.003') ||
    code.startsWith('020.004') ||
    code.startsWith('020.005') ||
    CODIGOS_BATENTES_PADRAO.has(code);

  const isBatenteDesc =
    norm.includes('BATENTE') ||
    norm.includes('BATENTES') ||
    norm.startsWith('BAT ') ||
    norm.includes(' BAT ') ||
    norm.includes('4BAT') ||
    norm.includes('3BAT') ||
    /\bBAT\b/.test(norm);

  if (isBatenteCode || isBatenteDesc) {
    return 'BATENTE';
  }

  // 3. FAMÍLIA FOLHA:
  // Se contiver 'FOLHA' ou códigos '020.001'
  if (
    code.startsWith('020.001') ||
    CODIGOS_FOLHAS_PADRAO.has(code) ||
    norm.includes('FOLHA') ||
    norm.includes('FOLHAS')
  ) {
    return 'FOLHA';
  }

  // 4. FAMÍLIA PORTA_EMENDADA:
  // Se contiver 'EMENDADA' ou tag 'EME'
  if (
    norm.includes('EMENDADA') ||
    norm.includes('EMENDADO') ||
    norm.includes('EMENDADAS') ||
    norm.includes('EMENDADOS') ||
    /\bEME\b/.test(norm)
  ) {
    return 'PORTA_EMENDADA';
  }

  // 5. FAMÍLIA PORTA_GIRATORIA:
  // Se contiver 'GIR' e ('PT ' ou 'PORTA') ou códigos '001.', '003.' (exceto batentes já tratados)
  const isGiroCode =
    code.startsWith('001.') ||
    code.startsWith('003.') ||
    CODIGOS_PADRAO_GIRO.has(code);

  const isGiroDesc =
    (norm.includes('GIR') || norm.includes('GIRO') || norm.includes('GIRATORIA') || norm.includes('GIRATORIAS')) &&
    (norm.includes('PT ') || norm.includes('PORTA') || norm.includes('PORTAS') || norm.startsWith('PT-') || norm.startsWith('PORTA-'));

  if (isGiroCode || isGiroDesc) {
    return 'PORTA_GIRATORIA';
  }

  // 6. FAMÍLIA PORTA_CORRER:
  // Se contiver 'CORRER' ou 'PT COR' ou códigos '005.', '007.'
  const isCorrerCode =
    code.startsWith('005.') ||
    code.startsWith('007.') ||
    CODIGOS_PADRAO_CORRER.has(code);

  const isCorrerDesc =
    norm.includes('CORRER') ||
    norm.includes('PT COR') ||
    norm.includes('PORTA COR');

  if (isCorrerCode || isCorrerDesc) {
    return 'PORTA_CORRER';
  }

  // 7. FAMÍLIA ACESSORIOS:
  // Se for miudeza/trilho/âncora ('021.', '022.', '028.', 'ANCORA', 'TRILHO', 'PERFIL')
  const isAcessorioCode =
    code.startsWith('021.') ||
    code.startsWith('022.') ||
    code.startsWith('028.') ||
    CODIGOS_ANCORAS_PADRAO.has(code) ||
    CODIGOS_TRILHOS_LGT_PADRAO.has(code);

  const isAcessorioDesc =
    norm.includes('ANCORA') ||
    norm.includes('TRILHO') ||
    norm.includes('PERFIL') ||
    norm.includes('MIUDEZA') ||
    norm.includes('ROLDANA') ||
    norm.includes('PUXADOR');

  if (isAcessorioCode || isAcessorioDesc) {
    return 'ACESSORIOS';
  }

  return 'OUTROS';
}
