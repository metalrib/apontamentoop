import {
  ProductionOrder,
  Apontamento,
  ROUTE_RULES,
  DEFAULT_ROUTE,
  RouteRule,
  CODIGOS_PORTAS_GIRO_PADRAO,
  CODIGOS_PORTAS_CORRER_PADRAO,
  CODIGOS_GIRATORIA_PADRAO,
  CODIGOS_PADRAO_GIRO,
  CODIGOS_PADRAO_CORRER,
  CODIGOS_TRILHOS_LGT_PADRAO,
  CODIGOS_FOLHAS_PADRAO,
  CODIGOS_BATENTES_PADRAO,
  CODIGOS_ANCORAS_PADRAO,
  normalizarCodigo,
  OpEtapaState,
  isPortaCorrerPadrao,
  CODIGOS_CORRER_PADRAO,
  classificarPortaCorrer,
  CODIGOS_ROTA_EXCLUSIVA_LASER,
  CODIGOS_ROTA_LASER_DOBRA,
  CODIGOS_ROTA_EXCLUSIVA_ROUTER,
  isRotaExclusivaLaser,
  isRotaLaserDobra,
  isRotaExclusivaRouter,
  isOfficeDoorGiro
} from '../types/mes';

export {
  isPortaCorrerPadrao,
  CODIGOS_CORRER_PADRAO,
  classificarPortaCorrer,
  CODIGOS_ROTA_EXCLUSIVA_LASER,
  CODIGOS_ROTA_LASER_DOBRA,
  CODIGOS_ROTA_EXCLUSIVA_ROUTER,
  isRotaExclusivaLaser,
  isRotaLaserDobra,
  isRotaExclusivaRouter,
  isOfficeDoorGiro
};
import {
  verificarSeExigeEmenda,
  definirRotaProduto,
  getRotaTrilhoCorrer,
  getRotaEstanteCompleta,
  getRotaQuadroEstante,
  getRotaPeEstanteSemPintura,
  getRotaPeEstanteComPintura,
  getRotaResistenciaPiso,
  getRotaAbrigoDoca,
  getRotaPerfilPP,
  getRotaKitGaxetaU,
  getRotaBatente,
  obterEtapasDaRota,
  etapaPertenceARota,
  isEligibleForRouter,
  isEstanteCompleta,
  isQuadroEstante,
  isPeEstanteSemPintura,
  isPeEstanteComPintura,
  isResistenciaPiso,
  isAbrigoDoca,
  isPerfilPP,
  isKitGaxetaU,
  isTrilhoCorrer,
  isBatente,
  isEtapaConcluida,
  isEtapaIniciadaOuConcluida,
  validarPostoIndustrial,
  validarPostoTrilho,
  verificarRouterLiberada,
  verificarDobraLiberada,
  verificarPreparacaoFolhasLiberada,
  isFolhaOrder,
  isVaiVemOuOfficeDoor,
  isOfficeDoorCorrer,
  verificarInjecaoLiberada,
  verificarLiberacaoMontagemVaiVemOuOfficeDoor
} from './routeValidation';

export {
  CODIGOS_PORTAS_GIRO_PADRAO,
  CODIGOS_PORTAS_CORRER_PADRAO,
  CODIGOS_GIRATORIA_PADRAO,
  CODIGOS_PADRAO_GIRO,
  CODIGOS_PADRAO_CORRER,
  isFolhaOrder,
  isVaiVemOuOfficeDoor,
  isOfficeDoorCorrer,
  verificarInjecaoLiberada,
  verificarLiberacaoMontagemVaiVemOuOfficeDoor,
  verificarSeExigeEmenda,
  getRotaTrilhoCorrer,
  getRotaEstanteCompleta,
  getRotaQuadroEstante,
  getRotaPeEstanteSemPintura,
  getRotaPeEstanteComPintura,
  getRotaResistenciaPiso,
  getRotaAbrigoDoca,
  getRotaPerfilPP,
  getRotaKitGaxetaU,
  getRotaBatente,
  obterEtapasDaRota,
  etapaPertenceARota,
  isEligibleForRouter,
  isEstanteCompleta,
  isQuadroEstante,
  isPeEstanteSemPintura,
  isPeEstanteComPintura,
  isResistenciaPiso,
  isAbrigoDoca,
  isPerfilPP,
  isKitGaxetaU,
  isTrilhoCorrer,
  isBatente,
  isEtapaConcluida,
  isEtapaIniciadaOuConcluida,
  validarPostoIndustrial,
  validarPostoTrilho,
  verificarRouterLiberada,
  verificarDobraLiberada,
  verificarPreparacaoFolhasLiberada
};

/**
 * Extrai e sanitiza com segurança a quantidade total da OP,
 * tratando variações como quantidade, qtd, qtde, quantidadePlanejada,
 * qtdTotal, quantidade_total, números com vírgula ou campos vazios/NaN.
 */
export const obterQuantidadeTotal = (op: any): number => {
  if (!op) return 1;
  // Prioridade 1: quantidade física explícita salva pelo operador/PCP
  if (op.quantidadeFisica !== undefined && op.quantidadeFisica !== null && !isNaN(Number(op.quantidadeFisica)) && Number(op.quantidadeFisica) > 0) {
    return Number(op.quantidadeFisica);
  }

  // Prioridade 2: quantidadeFolhas se definida
  if (op.quantidadeFolhas !== undefined && op.quantidadeFolhas !== null && !isNaN(Number(op.quantidadeFolhas)) && Number(op.quantidadeFolhas) > 0) {
    return Number(op.quantidadeFolhas);
  }

  const desc = String(op.descricao || op.produto || '').toUpperCase();
  const cod = String(op.codigo || op.codigoProduto || (op as any).cod || '').trim();
  const ehDupla = desc.includes('DUPLA') || desc.includes('DUPLO') || Boolean(op.isDupla);

  const valor = op.quantidade ?? op.qtd ?? op.qtde ?? op.quantidadePlanejada ?? op.qtdTotal ?? op.quantidade_total ?? 1;
  const num = Number(String(valor).replace(',', '.').replace(/[^0-9.]/g, ''));
  const base = !isNaN(num) && num > 0 ? num : 1;

  // Se for porta dupla cadastrada no Nomus como 1 conjunto (ex: OP 024490-01, OP 024537-01), fisicamente são 2 folhas
  if (ehDupla) {
    return base === 1 ? 2 : base;
  }

  const fallbackNum = Number(String(op.quantidade_total).replace(',', '.').replace(/[^0-9.]/g, ''));
  return isNaN(fallbackNum) || fallbackNum <= 0 ? base : fallbackNum;
};

/**
 * Identifica se uma ordem de produção é de porta dupla
 */
export function isDuplaOrder(op: any): boolean {
  if (!op) return false;
  if (op.isDupla === true) return true;
  const desc = String(op.descricao || op.produto || '').toUpperCase();
  return desc.includes('DUPLA') || desc.includes('DUPLO');
}

/**
 * Identifica se uma ordem de produção pertence à família de Portas Vai-Vem
 */
export function isVaiVemOrder(op: any): boolean {
  if (!op) return false;
  const desc = String(op.descricao || op.produto || '').toUpperCase();
  const cod = String(op.codigo || op.codigoProduto || (op as any).cod || '').trim();
  return (
    cod.startsWith('011.') ||
    cod.startsWith('011') ||
    cod.includes('011.0117') ||
    cod.includes('011.0013') ||
    cod.includes('011.0012') ||
    desc.includes('VAI VEM') ||
    desc.includes('VAI-VEM') ||
    desc.includes('VV') ||
    Boolean(op.familia?.toLowerCase().includes('vai e vem'))
  );
}



/**
 * Regra geral para exibição do seletor de quantidade física a produzir: [-] [ QTD ] [+]
 * Renderizado sempre que:
 * a) O código pertencer à família de Vai-Vem (011.0012, 011.0013, 011.0117 ou qualquer código iniciado por 011.); OU
 * b) A descrição contiver o termo DUPLA ou VAI VEM; OU
 * c) For produto faturado em M² (fracionado ou inteiro); OU
 * d) O usuário desejar ajustar a quantidade física manualmente
 */
export function shouldShowPhysicalQuantitySelector(op: any): boolean {
  if (!op) return false;
  const descUpper = (op.descricao || op.produto || '').toUpperCase();
  const codeClean = String(op.codigo || op.codigoProduto || '').trim();
  const isFamilia011 =
    codeClean.startsWith('011.') ||
    codeClean.startsWith('011') ||
    codeClean.includes('011.0012') ||
    codeClean.includes('011.0013') ||
    codeClean.includes('011.0117');
  const isFamilia010 =
    codeClean.startsWith('010.') ||
    codeClean.startsWith('010') ||
    codeClean === '010.0008';
  const isOfficeDoor =
    isFamilia010 ||
    descUpper.includes('OFFICE DOOR') ||
    descUpper.includes('OFFICE-DOOR');
  const isDupla = descUpper.includes('DUPLA') || descUpper.includes('DUPLO') || Boolean(op.isDupla);
  const isVaiVem = descUpper.includes('VAI VEM') || descUpper.includes('VV') || isFamilia011;
  const isM2 = Boolean(op.unidade_medida === 'M²' || op.quantidade_m2);
  const m2Num = Number(op.quantidade_m2 ?? (op.unidade_medida === 'M²' ? (op.quantidade ?? op.quantidade_total) : 0));
  const isM2Fracionado = isM2 && m2Num > 0 && !Number.isInteger(m2Num);

  return isFamilia011 || isFamilia010 || isOfficeDoor || isDupla || isVaiVem || isM2 || isM2Fracionado;
}

/**
 * Normaliza strings para comparação insensível a maiúsculas e acentos
 */
export function normalizeText(text: string): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

/**
 * Extrai e normaliza o código do produto (ex: 001.0118)
 */
export function extractProductCode(
  input: string | { descricao: string; codigo?: string },
  explicitCodigo?: string
): string {
  if (explicitCodigo && explicitCodigo.trim()) {
    return cleanCode(explicitCodigo);
  }
  if (typeof input === 'object' && input !== null) {
    if (input.codigo && input.codigo.trim()) {
      return cleanCode(input.codigo);
    }
    return extractCodeFromText(input.descricao || '');
  }
  return extractCodeFromText(input || '');
}

function cleanCode(code: string): string {
  const trimmed = code.trim();
  const match = trimmed.match(/^(\d{3})\.?(\d{4})$/);
  if (match) {
    return `${match[1]}.${match[2]}`;
  }
  return trimmed;
}

function extractCodeFromText(text: string): string {
  const match = text.match(/\b(\d{3})\.?(\d{4})\b/);
  if (match) {
    return `${match[1]}.${match[2]}`;
  }
  return '';
}

/**
 * Identifica se a ordem pertence à família de Âncoras (código 021 ou palavra ANCORA)
 */
export function isAncoraOrder(
  input: string | { descricao: string; codigo?: string },
  explicitCodigo?: string
): boolean {
  const code = extractProductCode(input, explicitCodigo);
  const desc = typeof input === 'object' && input !== null ? input.descricao : input;
  const norm = normalizeText(desc || '');
  return Boolean((code && code.startsWith('021.')) || norm.includes('ANCORA'));
}

/**
 * Identifica a rota de produção base a partir da descrição e código da OP
 */
function resolveBaseRoute(
  input: string | { descricao: string; codigo?: string; requer_solda?: boolean; requer_laser?: boolean },
  explicitCodigo?: string
): { rule: RouteRule; steps: string[]; badge: string; isStandardLine: boolean } {
  const desc = typeof input === 'object' && input !== null ? input.descricao : input;
  const norm = normalizeText(desc || '');
  const code = extractProductCode(input, explicitCodigo);
  const opObj = typeof input === 'object' && input !== null ? input : { descricao: desc, codigo: code };

  // MATRIZ OFICIAL DE ROTEAMENTO INDUSTRIAL ESPECIAL:

  // A) ROTA EXCLUSIVA DE LASER (["Laser"]): Âncoras Rebite Rosca, Pendurais Inox e Âncora Vai-Vem Alvenaria
  if (isRotaExclusivaLaser(opObj)) {
    const rule: RouteRule = {
      keyword: 'LASER EXCLUSIVO',
      label: 'Corte Laser CNC (Exclusivo)',
      steps: ['Laser'],
      badge: 'Laser CNC Exclusivo',
      isStandardLine: true
    };
    return { rule, steps: ['Laser'], badge: rule.badge!, isStandardLine: true };
  }

  // B) ROTA LASER + DOBRA (["Laser", "Dobra"]): Trilhos Inox para Cortina
  if (isRotaLaserDobra(opObj)) {
    const rule: RouteRule = {
      keyword: 'LASER E DOBRA',
      label: 'Laser CNC e Dobra',
      steps: ['Laser', 'Dobra'],
      badge: 'Laser + Dobra',
      isStandardLine: true
    };
    return { rule, steps: ['Laser', 'Dobra'], badge: rule.badge!, isStandardLine: true };
  }

  // C) ROTA EXCLUSIVA DE ROUTER (["Router"]): Visor de Policarbonato
  if (isRotaExclusivaRouter(opObj)) {
    const rule: RouteRule = {
      keyword: 'ROUTER EXCLUSIVO',
      label: 'Router CNC (Exclusivo)',
      steps: ['Router'],
      badge: 'Router CNC Exclusivo',
      isStandardLine: true
    };
    return { rule, steps: ['Router'], badge: rule.badge!, isStandardLine: true };
  }

  // 0. Batentes (Família 020 / BAT - Padrão, Inox e com Resistência) - PRIORIDADE ABSOLUTA SOBRE PORTAS E FOLHAS
  const isBatenteOrder =
    isBatente(opObj || input) ||
    (code && CODIGOS_BATENTES_PADRAO.has(code)) ||
    ['0200005', '0200006', '0200007', '0200008'].includes(normalizarCodigo(code || '')) ||
    ['020.0005', '020.0006', '020.0007', '020.0008'].includes(code || '') ||
    norm.startsWith('BAT ') ||
    norm.startsWith('BAT-') ||
    norm.startsWith('BAT_') ||
    norm.startsWith('BATENTE') ||
    (norm.includes('BATENTE') && !norm.startsWith('PT ') && !norm.startsWith('PORTA ')) ||
    desc.startsWith('BAT') ||
    (code && code.startsWith('020.') && !norm.startsWith('FOLHA') && !norm.includes('FOLHA') && parseInt(code.slice(4) || '0', 10) >= 32);

  if (isBatenteOrder) {
    const rule: RouteRule = {
      keyword: 'BATENTE PADRAO',
      label: 'Fabricação de Batente Padrão',
      steps: ['Corte', 'Dobra', 'Preparação de Batentes', 'Injeção e Finalização de Batentes'],
      badge: 'Batente de Linha Padrão',
      isStandardLine: true
    };
    return { rule, steps: [...rule.steps], badge: rule.badge!, isStandardLine: true };
  }

  // 0.1 Office Door de Correr (código 010.xxxx, 010.0008 ou descrição com OFFICE DOOR COR)
  if (isOfficeDoorCorrer(opObj || { codigo: code, descricao: desc, tipoOrdem: desc })) {
    const temRouter = Boolean(
      opObj?.requerRouter || opObj?.requer_router || opObj?.encaminhar_router ||
      (Array.isArray(opObj?.etapas) && opObj.etapas.includes('Router')) ||
      (opObj?.etapas && typeof opObj.etapas === 'object' && 'Router' in opObj.etapas) ||
      opObj?.etapaAtual === 'Router'
    );
    const steps = temRouter
      ? ['Corte', 'Corte Alumínio', 'Preparação Office Door Correr', 'Injeção', 'Router', 'Montagem Office de Correr']
      : ['Corte', 'Corte Alumínio', 'Preparação Office Door Correr', 'Injeção', 'Montagem Office de Correr'];
    const rule: RouteRule = {
      keyword: 'OFFICE DOOR COR',
      label: 'Porta Office Door de Correr',
      steps,
      badge: 'Office Door Correr',
      isStandardLine: false
    };
    return { rule, steps, badge: rule.badge!, isStandardLine: false };
  }

  // 0.1 Office Door de Giro (código 009.xxxx ou descrição com OFFICE DOOR GIR / OFFICE DOOR)
  if (isOfficeDoorGiro(opObj || { codigo: code, descricao: desc, tipoOrdem: desc })) {
    const temLaser = Boolean(
      opObj?.requerLaser || opObj?.requer_laser ||
      (Array.isArray(opObj?.etapas) && opObj.etapas.includes('Laser')) ||
      (opObj?.etapas && typeof opObj.etapas === 'object' && 'Laser' in opObj.etapas) ||
      opObj?.etapaAtual === 'Laser'
    );
    const temRouter = Boolean(
      opObj?.requerRouter || opObj?.requer_router || opObj?.encaminhar_router ||
      (Array.isArray(opObj?.etapas) && opObj.etapas.includes('Router')) ||
      (opObj?.etapas && typeof opObj.etapas === 'object' && 'Router' in opObj.etapas) ||
      opObj?.etapaAtual === 'Router'
    );
    const steps: string[] = ['Corte'];
    if (temLaser) steps.push('Laser');
    steps.push('Dobra', 'Preparação de Folha', 'Injeção de Folhas');
    if (temRouter) steps.push('Router');
    steps.push('Instalação de Gaxeta', 'Montagem de Office Door Giro');
    const rule: RouteRule = {
      keyword: 'OFFICE DOOR GIR',
      label: 'Porta Office Door de Giro',
      steps,
      badge: 'Office Door Giro',
      isStandardLine: false
    };
    return { rule, steps, badge: rule.badge!, isStandardLine: false };
  }

  // 1. Estantes Walk-in: Estante Completa (família 015.xxxx ou ESTANTE WALK-IN sem QUADRO)
  if (isEstanteCompleta(opObj)) {
    const rule: RouteRule = {
      keyword: 'ESTANTE COMPLETA',
      label: 'Estante Walk-in Completa',
      steps: ['Montagem Estante'],
      badge: 'Estante Walk-in (Montagem T5)',
      isStandardLine: true
    };
    return { rule, steps: [...rule.steps], badge: rule.badge!, isStandardLine: true };
  }

  // 2. Estantes Walk-in: Pé da Estante com pintura (Montagem Estante T5)
  if (isPeEstanteComPintura(opObj)) {
    const rule: RouteRule = {
      keyword: 'PE ESTANTE COM PINTURA',
      label: 'Pé de Estante Pintado',
      steps: ['Montagem Estante'],
      badge: 'Montagem Estante (T5)',
      isStandardLine: true
    };
    return { rule, steps: [...rule.steps], badge: rule.badge!, isStandardLine: true };
  }

  // 3. Estantes Walk-in: Quadro Estante Walk-in
  if (isQuadroEstante(opObj)) {
    const rule: RouteRule = {
      keyword: 'QUADRO ESTANTE',
      label: 'Quadro Estante Walk-in',
      steps: getRotaQuadroEstante(),
      badge: 'Estante Walk-in',
      isStandardLine: true
    };
    return { rule, steps: [...rule.steps], badge: rule.badge!, isStandardLine: true };
  }

  // 4. Estantes Walk-in: Pé da Estante sem pintura (Serralheria T5)
  if (isPeEstanteSemPintura(opObj)) {
    const rule: RouteRule = {
      keyword: 'PE ESTANTE SEM PINTURA',
      label: 'Pé de Estante (Sem Pintura)',
      steps: getRotaPeEstanteSemPintura(),
      badge: 'Serralheria Estante',
      isStandardLine: true
    };
    return { rule, steps: [...rule.steps], badge: rule.badge!, isStandardLine: true };
  }

  // 4. Resistência de Piso 70W/MT
  if (isResistenciaPiso(opObj)) {
    const rule: RouteRule = {
      keyword: 'RESIST PISO',
      label: 'Resistência de Piso 70W/MT',
      steps: getRotaResistenciaPiso(),
      badge: 'Resistência de Piso (T3/T4)',
      isStandardLine: true
    };
    return { rule, steps: [...rule.steps], badge: rule.badge!, isStandardLine: true };
  }

  // 5. Abrigo de Doca Retrátil
  if (isAbrigoDoca(opObj)) {
    const rule: RouteRule = {
      keyword: 'ABRIGO DOCA',
      label: 'Abrigo de Doca Retrátil',
      steps: getRotaAbrigoDoca(),
      badge: 'Abrigo de Doca (T5)',
      isStandardLine: true
    };
    return { rule, steps: [...rule.steps], badge: rule.badge!, isStandardLine: true };
  }

  // 6. Perfis de Chapa / PP
  if (isPerfilPP(opObj)) {
    const rule: RouteRule = {
      keyword: 'PERFIL PP',
      label: 'Perfil PP (Chapa)',
      steps: getRotaPerfilPP(),
      badge: 'Perfil PP (T1)',
      isStandardLine: true
    };
    return { rule, steps: [...rule.steps], badge: rule.badge!, isStandardLine: true };
  }

  // 7. Kit Gaxeta U
  if (isKitGaxetaU(opObj)) {
    const rule: RouteRule = {
      keyword: 'KIT GAXETA',
      label: 'Kit Gaxeta U',
      steps: getRotaKitGaxetaU(),
      badge: 'Kit Gaxeta (T3/T4)',
      isStandardLine: true
    };
    return { rule, steps: [...rule.steps], badge: rule.badge!, isStandardLine: true };
  }

  // 8. Trilhos para Portas de Correr (família 028., código em CODIGOS_TRILHOS_LGT_PADRAO ou descrição com TRILHO)
  // Rota Oficial Padronizada: Corte -> Montagem nos Terminais 3, 4 e 5
  if (isTrilhoCorrer(opObj)) {
    const rule: RouteRule = {
      keyword: 'TRILHO',
      label: 'Trilho Porta de Correr (Corte e Montagem)',
      steps: getRotaTrilhoCorrer(),
      badge: 'Trilho Correr',
      isStandardLine: true
    };
    return { rule, steps: [...rule.steps], badge: rule.badge!, isStandardLine: true };
  }

  // 2. Folhas Padrão (se o código estiver em CODIGOS_FOLHAS_PADRAO)
  // Rota: "Fabricação de Folha Padrão"
  // Etapas: Corte - Guilhotina (T1) -> Dobra e Preparação (T1) -> Preparação de Folhas (T2) -> Injetora de Folhas (T2).
  // Destino: Estoque de Folhas (não exige montagem de ferragens nem gaxeta).
  // Badge: "Folha de Linha Padrão".
  if (code && CODIGOS_FOLHAS_PADRAO.has(code)) {
    const rule: RouteRule = {
      keyword: 'FOLHA PADRAO',
      label: 'Fabricação de Folha Padrão',
      steps: ['Corte', 'Dobra', 'Preparação', 'Injeção'],
      badge: 'Folha de Linha Padrão',
      isStandardLine: true
    };
    return { rule, steps: [...rule.steps], badge: rule.badge!, isStandardLine: true };
  }

  // 3. Batentes Padrão (se o código estiver em CODIGOS_BATENTES_PADRAO ou for da família 020 / BAT)
  if ((code && CODIGOS_BATENTES_PADRAO.has(code)) || isBatente(input)) {
    const rule: RouteRule = {
      keyword: 'BATENTE PADRAO',
      label: 'Fabricação de Batente Padrão',
      steps: ['Corte', 'Dobra', 'Preparação de Batentes', 'Injeção e Finalização de Batentes'],
      badge: 'Batente de Linha Padrão',
      isStandardLine: true
    };
    return { rule, steps: [...rule.steps], badge: rule.badge!, isStandardLine: true };
  }

  // 4. Âncoras (família 021 ou descrição com ANCORA):
  // Rota Padrão Base: Corte -> Dobra (T1).
  // Conclusão padrão na Dobra. Solda sob demanda (Terminal 5).
  if (isAncoraOrder(input, explicitCodigo)) {
    const requerSolda = typeof input === 'object' && input !== null && Boolean((input as ProductionOrder).requer_solda);
    if (requerSolda) {
      const rule: RouteRule = {
        keyword: 'ANCORA',
        label: 'Fabricação de Âncora (Com Solda)',
        steps: ['Corte', 'Dobra', 'Solda e Montagem'],
        badge: 'Âncora C/ Solda',
        isStandardLine: true
      };
      return { rule, steps: [...rule.steps], badge: rule.badge!, isStandardLine: true };
    } else {
      const rule: RouteRule = {
        keyword: 'ANCORA',
        label: 'Fabricação de Âncora (Sem Solda)',
        steps: ['Corte', 'Dobra'],
        badge: 'Âncora Padrão (Sem Solda)',
        isStandardLine: true
      };
      return { rule, steps: [...rule.steps], badge: rule.badge!, isStandardLine: true };
    }
  }

  // 5. Portas Giratórias (REGRA RESTRITIVA: WHITELIST ESTRITA POR CÓDIGO - EXCLUI OFFICE DOOR E BATENTES)
  const isGiro =
    !isBatente(opObj || { codigo: code, descricao: desc, tipoOrdem: desc }) &&
    !isOfficeDoorGiro(opObj || { codigo: code, descricao: desc, tipoOrdem: desc }) &&
    !norm.startsWith('BAT ') &&
    !norm.startsWith('BAT-') &&
    !norm.startsWith('BAT_') &&
    !norm.startsWith('BATENTE') &&
    !desc.startsWith('BAT') &&
    !code.startsWith('020.') &&
    !norm.includes('OFFICE DOOR') &&
    !norm.includes('OFFICE-DOOR') &&
    (
      norm.includes('PT GIR') ||
      norm.includes('PORTA GIRATORIA') ||
      norm.includes('PORTA GIRATÓRIA') ||
      norm.includes('PORTA GIR') ||
      norm.includes('GIRATORIA') ||
      norm.includes('GIRATÓRIA') ||
      norm.includes('GIRO') ||
      (code && (code.startsWith('001.') || code.startsWith('003.')))
    );

  if (isGiro) {
    const codLimpo = normalizarCodigo(code || '');
    const ehCodigoPadrao = Boolean(
      (code && (CODIGOS_PORTAS_GIRO_PADRAO.has(code) || CODIGOS_GIRATORIA_PADRAO.has(code))) ||
      (codLimpo && (CODIGOS_PORTAS_GIRO_PADRAO.has(codLimpo) || CODIGOS_GIRATORIA_PADRAO.has(codLimpo)))
    );

    if (ehCodigoPadrao) {
      const rule: RouteRule = {
        keyword: 'PT GIR',
        label: 'Porta Giratória Padrão',
        steps: ['Instalação de Gaxeta', 'Montagem de Portas Giratórias'],
        badge: 'Porta Giratória Padrão (Montagem Final)',
        isStandardLine: true
      };
      return { rule, steps: [...rule.steps], badge: rule.badge!, isStandardLine: true };
    } else {
      // Se NÃO for código padrão (como 003.0140), é OBRIGATORIAMENTE Especial (Rota Completa)
      const steps = [
        'Corte',
        'Dobra',
        'Preparação de Folha',
        'Injeção',
        'Instalação de Gaxeta',
        'Montagem de Portas Giratória Padrão e Especial'
      ];
      const rule: RouteRule = {
        keyword: 'PT GIR ESPECIAL',
        label: 'Porta Giratória Especial',
        steps,
        badge: 'Especial Sob Medida (Fabricação Completa)',
        isStandardLine: false
      };
      return { rule, steps: [...rule.steps], badge: rule.badge!, isStandardLine: false };
    }
  }

  // 6. Linha Super Cong de Correr / Especiais Sob Medida
  const codLimpoCorrer = normalizarCodigo(code || '');
  const ehCodigoCorrerPadrao = isPortaCorrerPadrao(code || codLimpoCorrer, desc || '');

  const ehSuperCong =
    !ehCodigoCorrerPadrao &&
    (norm.includes('SUPER CONG') ||
    norm.includes('SUPER CONGELADO') ||
    norm.includes('PORTA ESPECIAL'));

  if (ehSuperCong) {
    const steps = ['Corte', 'Dobra', 'Preparação de Folha', 'Injeção', 'Montagem Portas de Correr Padrão e Especial'];
    const rule: RouteRule = {
      keyword: 'PT COR ESPECIAL',
      label: 'Rota 13/14 - Porta Especial de Correr Super Cong',
      steps,
      badge: 'Especial Sob Medida (Fabricação Completa)',
      isStandardLine: false
    };
    return { rule, steps: [...rule.steps], badge: rule.badge!, isStandardLine: false };
  }

  // 7. Portas de Correr (Padrão vs Especial e Emendadas - EXCLUI BATENTES)
  if (
    !isBatente(opObj || { codigo: code, descricao: desc, tipoOrdem: desc }) &&
    !norm.startsWith('BAT ') &&
    !norm.startsWith('BAT-') &&
    !norm.startsWith('BAT_') &&
    !norm.startsWith('BATENTE') &&
    !desc.startsWith('BAT') &&
    !code.startsWith('020.') &&
    (
      norm.includes('PT COR') ||
      norm.includes('PORTA CORRER') ||
      norm.includes('PORTA DE CORRER') ||
      norm.includes('EMENDADA') ||
      isPortaCorrerPadrao(code || '', desc || '') ||
      (code && (code.startsWith('007.') || code.startsWith('005.')))
    )
  ) {
    const exigeEmenda = desc.toUpperCase().includes('EMENDA') || verificarSeExigeEmenda(desc || '');
    const codLimpo = normalizarCodigo(code || '');
    const ehCodigoPadrao = isPortaCorrerPadrao(code || codLimpo, desc || '');
    const isEspecial = !ehCodigoPadrao || norm.includes('ESPECIAL') || norm.includes('ESP') || norm.includes('INOX') || (!ehCodigoPadrao && norm.includes('SUPER CONG')) || exigeEmenda;
    const montagemStep = 'Montagem Portas de Correr Padrão e Especial';

    if (!isEspecial) {
      const rule: RouteRule = {
        keyword: 'PT COR',
        label: 'Rota 16 - Porta Padrão Correr',
        steps: [montagemStep],
        badge: 'Porta de Correr Padrão (Montagem Final)',
        isStandardLine: true
      };
      return { rule, steps: [...rule.steps], badge: rule.badge!, isStandardLine: true };
    } else {
      const rule: RouteRule = {
        keyword: 'PT COR ESPECIAL',
        label: 'Rota 13/14 - Porta Especial de Correr e Emendadas',
        steps: ['Corte', 'Dobra', 'Preparação de Folha', 'Injeção', montagemStep],
        badge: 'Especial Sob Medida (Fabricação Completa)',
        isStandardLine: false
      };
      return { rule, steps: [...rule.steps], badge: rule.badge!, isStandardLine: false };
    }
  }

  // 7. Demais Produtos (Vai e Vem, Batentes especiais, Folhas especiais, Office Door, Cortina):
  const priorityOrder = [
    'OFFICE DOOR',
    'PT VAI VEM',
    'FOLHA',
    'BAT',
    'CORTINA'
  ];

  for (const key of priorityOrder) {
    if (norm.includes(key)) {
      const found = ROUTE_RULES.find(r => r.keyword === key);
      if (found) {
        return {
          rule: found,
          steps: [...found.steps],
          badge: found.badge || 'Padrão por Categoria',
          isStandardLine: !!found.isStandardLine
        };
      }
    }
  }

  // Fallback
  const defaultRule: RouteRule = {
    keyword: 'PADRAO',
    label: 'Rota Padrão',
    steps: DEFAULT_ROUTE,
    badge: 'Rota Padrão Fábrica',
    isStandardLine: false
  };
  return {
    rule: defaultRule,
    steps: [...DEFAULT_ROUTE],
    badge: defaultRule.badge!,
    isStandardLine: false
  };
}

/**
 * Identifica a rota de produção a partir da descrição e código da OP,
 * incorporando a etapa intermediária de Laser CNC caso requer_laser seja verdadeiro.
 */
export function getRouteForOp(
  input: string | { descricao: string; codigo?: string; requer_solda?: boolean; requer_laser?: boolean; etapas?: any; codigoProduto?: string; cod?: string },
  explicitCodigo?: string
): { rule: RouteRule; steps: string[]; badge: string; isStandardLine: boolean } {
  const resolved = resolveBaseRoute(input, explicitCodigo);

  // A) ROTA EXCLUSIVA DE LASER (["Laser"]): strictly 1 step without Corte or Dobra
  if (isRotaExclusivaLaser(input)) {
    return {
      ...resolved,
      steps: ['Laser']
    };
  }

  // B) ROTA LASER + DOBRA (["Laser", "Dobra"]): starts at Laser, ends at Dobra
  if (isRotaLaserDobra(input)) {
    return {
      ...resolved,
      steps: ['Laser', 'Dobra']
    };
  }

  // C) ROTA EXCLUSIVA DE ROUTER (["Router"]): strictly 1 step Router
  if (isRotaExclusivaRouter(input)) {
    return {
      ...resolved,
      steps: ['Router']
    };
  }

  const requerLaser = typeof input === 'object' && input !== null && Boolean((input as any).requer_laser || (input as any).requerLaser);

  // Define as etapas oficiais dinâmicas a partir do gerador centralizado por produto (Matriz Oficial Metalrib)
  const dynamicSteps = obterEtapasDaRota(input);
  const stepsCopy = dynamicSteps.length > 0 ? [...dynamicSteps] : [...resolved.steps];

  if (requerLaser) {
    const hasLaser = stepsCopy.some((s) => s.toUpperCase().includes('LASER'));
    if (!hasLaser) {
      const corteIdx = stepsCopy.findIndex((s) => s.toUpperCase().includes('CORTE'));
      if (corteIdx >= 0) {
        stepsCopy.splice(corteIdx + 1, 0, 'Laser');
      } else {
        const dobraIdx = stepsCopy.findIndex((s) => s.toUpperCase().includes('DOBRA'));
        if (dobraIdx >= 0) {
          stepsCopy.splice(dobraIdx, 0, 'Laser');
        } else {
          stepsCopy.unshift('Laser');
        }
      }
    }
  }

  // Âncoras com Solda sob Demanda
  if (isAncoraOrder(input, explicitCodigo) && typeof input === 'object' && input !== null && Boolean((input as ProductionOrder).requer_solda)) {
    if (!stepsCopy.some(s => s.toUpperCase().includes('SOLDA'))) {
      stepsCopy.push('Solda e Montagem');
    }
  }

  // Encaminhar para Router sob Demanda (Vai-Vem e Office Door)
  const opObj = typeof input === 'object' && input !== null ? (input as any) : null;
  const isEligible = isEligibleForRouter(input);
  const temRouter = isEligible && (
    Boolean(opObj?.encaminhar_router) ||
    Boolean(opObj?.requer_router) ||
    Boolean(opObj?.requerRouter) ||
    (Array.isArray(opObj?.etapas) && opObj.etapas.includes('Router')) ||
    (opObj?.etapas && typeof opObj.etapas === 'object' && 'Router' in opObj.etapas) ||
    opObj?.etapaAtual === 'Router'
  );

  if (temRouter && !stepsCopy.includes('Router')) {
    const injIdx = stepsCopy.findIndex((s: string) => s.includes('Injeção') || s.includes('Injecao'));
    if (injIdx !== -1) {
      stepsCopy.splice(injIdx + 1, 0, 'Router');
    } else {
      const montIdx = stepsCopy.findIndex((s: string) => s.includes('Montagem'));
      if (montIdx !== -1) {
        stepsCopy.splice(montIdx, 0, 'Router');
      } else {
        stepsCopy.push('Router');
      }
    }
  }

  return {
    ...resolved,
    steps: stepsCopy
  };
}

/**
 * Mapeia e verifica se um Setor de Terminal Físico atende a uma Etapa da Rota
 */
export function doesSectorMatchStep(sector: string, step: string): boolean {
  const normSector = normalizeText(sector);
  const normStep = normalizeText(step);

  // Mapeamentos diretos e equivalências industriais
  if (normSector === normStep) return true;

  // Isolamento estrito entre famílias industriais incompatíveis:
  // 1. Office Door vs Não-Office
  const isStepOffice = normStep.includes('OFFICE');
  const isSectorOffice = normSector.includes('OFFICE');
  if (isStepOffice !== isSectorOffice) {
    return false;
  }

  // 2. Vai-Vem vs Não-Vai-Vem
  const isStepVaiVem = normStep.includes('VAI VEM') || normStep.includes('VV');
  const isSectorVaiVem = normSector.includes('VAI VEM') || normSector.includes('VV');
  if (isStepVaiVem !== isSectorVaiVem) {
    return false;
  }

  // 3. Batentes vs Não-Batente
  const isStepBatente = normStep.includes('BATENTE');
  const isSectorBatente = normSector.includes('BATENTE');
  if (isStepBatente !== isSectorBatente) {
    const isStepInjFin = normStep.includes('INJECAO') || normStep.includes('FINALIZACAO');
    const isSectorInjFin = normSector.includes('INJECAO') || normSector.includes('FINALIZACAO');
    const isStepPrep = normStep.includes('PREPARACAO');
    const isSectorPrep = normSector.includes('PREPARACAO');
    if (!(isStepInjFin && isSectorInjFin) && !(isStepPrep && isSectorPrep)) {
      return false;
    }
  }

  // 4. Trilhos vs Não-Trilho
  const isStepTrilho = normStep.includes('TRILHO');
  const isSectorTrilho = normSector.includes('TRILHO');
  if (isStepTrilho !== isSectorTrilho) {
    return false;
  }

  // 5. Estantes vs Não-Estante
  const isStepEstante = normStep.includes('ESTANTE');
  const isSectorEstante = normSector.includes('ESTANTE');
  if (isStepEstante !== isSectorEstante) {
    return false;
  }

  // 6. Abrigo de Doca vs Não-Abrigo
  const isStepAbrigo = normStep.includes('ABRIGO');
  const isSectorAbrigo = normSector.includes('ABRIGO');
  if (isStepAbrigo !== isSectorAbrigo) {
    return false;
  }

  // 7. Alumínio vs Não-Alumínio
  const isStepAlum = normStep.includes('ALUMINIO');
  const isSectorAlum = normSector.includes('ALUMINIO');
  if (isStepAlum !== isSectorAlum) {
    return false;
  }

  // 8. Portas Giratórias vs Portas de Correr (sem gaxeta)
  const isStepGiro = (normStep.includes('GIRAT') || normStep.includes('GIRO')) && !normStep.includes('GAXETA');
  const isSectorGiro = (normSector.includes('GIRAT') || normSector.includes('GIRO')) && !normSector.includes('GAXETA');
  const isStepCorrer = (normStep.includes('CORRER') || normStep.includes('COR ')) && !normStep.includes('GAXETA');
  const isSectorCorrer = (normSector.includes('CORRER') || normSector.includes('COR ')) && !normSector.includes('GAXETA');
  if ((isStepGiro && isSectorCorrer) || (isStepCorrer && isSectorGiro)) {
    return false;
  }

  // Trilhos de Portas de Correr (Corte e Montagem)
  if (normStep.includes('TRILHO')) {
    if (normStep.includes('CORTE')) {
      return normSector.includes('TRILHO') && normSector.includes('CORTE');
    }
    if (normStep.includes('MONTAGEM')) {
      return normSector.includes('TRILHO') && normSector.includes('MONTAGEM');
    }
    return normSector.includes('TRILHO');
  }

  // Setores exclusivos de Trilho não atendem etapas convencionais
  if (normSector.includes('TRILHO')) {
    return false;
  }

  // Setor Montagem Estante
  if (normStep.includes('ESTANTE')) {
    return normSector.includes('ESTANTE');
  }
  if (normSector.includes('ESTANTE')) {
    return false;
  }

  // Setor Montagem Abrigo Doca
  if (normStep.includes('ABRIGO DOCA')) {
    return normSector.includes('ABRIGO DOCA') || normSector === 'MONTAGEM';
  }
  if (normSector.includes('ABRIGO DOCA')) {
    return false;
  }

  // Corte Alumínio (Terminal 5) vs Corte Guilhotina (Terminal 1)
  if (normStep.includes('ALUMINIO') || normSector.includes('ALUMINIO')) {
    return normStep.includes('ALUMINIO') && normSector.includes('ALUMINIO');
  }

  if (normStep === 'CORTE' && (normSector.includes('CORTE') || normSector.includes('GUILHOTINA'))) {
    return !normSector.includes('ALUMINIO');
  }

  if (normStep === 'DOBRA' && normSector.includes('DOBRA')) {
    return true;
  }

  if (normStep.includes('LASER') && normSector.includes('LASER')) {
    return true;
  }

  // Isolamento absoluto: Setores de Folha NUNCA casam com etapas de Batente e vice-versa
  const isSectorFolha = normSector.includes('FOLHA');
  const isStepFolha = normStep.includes('FOLHA');
  const isSectorBat = normSector.includes('BATENTE');
  const isStepBat = normStep.includes('BATENTE');
  if ((isSectorFolha && isStepBat) || (isSectorBat && isStepFolha)) {
    return false;
  }

  // Preparação de Batentes (Terminal 3)
  const isSectorPrepBat = normSector.includes('PREPARACAO') && normSector.includes('BATENTE');
  const isStepPrepBat = normStep.includes('PREPARACAO') && normStep.includes('BATENTE');
  if (isSectorPrepBat && (isStepPrepBat || normStep === 'PREPARACAO')) {
    return true;
  }
  if (isStepPrepBat && (isSectorPrepBat || normSector === 'PREPARACAO')) {
    return true;
  }

  // Injeção e Finalização Batentes (Terminal 3)
  const isSectorInjFinBat =
    (normSector.includes('INJECAO') || normSector.includes('INJETORA')) &&
    (normSector.includes('BATENTE') || normSector.includes('FINALIZACAO'));
  const isStepInjFinBat =
    (normStep.includes('INJECAO') || normStep.includes('INJETORA')) &&
    (normStep.includes('BATENTE') || normStep.includes('FINALIZACAO'));
  if (isSectorInjFinBat && isStepInjFinBat) {
    return true;
  }
  if (isSectorInjFinBat && (normStep === 'INJECAO' || normStep === 'FINALIZACAO' || normStep.includes('FINALIZACAO'))) {
    return true;
  }
  if (isStepInjFinBat && (normSector === 'INJECAO' || normSector === 'FINALIZACAO' || normSector.includes('FINALIZACAO'))) {
    return true;
  }

  // Compatibilidade com setor antigo: Montagem e Injeção de Batentes
  if (normStep.includes('MONTAGEM E INJECAO DE BATENTES')) {
    return normSector.includes('BATENTE');
  }

  // Preparação Office Door
  if (normStep.includes('PREPARACAO') && normStep.includes('OFFICE DOOR')) {
    const isStepCorrer = normStep.includes('CORRER') || normStep.includes('COR ');
    const isSectorCorrer = normSector.includes('CORRER') || normSector.includes('COR ');
    if (isStepCorrer && !isSectorCorrer && (normSector.includes('GIRO') || normSector.includes('GIRAT'))) return false;
    if (!isStepCorrer && isSectorCorrer) return false;
    if (normSector.includes('PREPARACAO') && normSector.includes('OFFICE DOOR')) return true;
    if (normSector.includes('PREPARACAO') && !normSector.includes('DOBRA') && !normSector.includes('BATENTE') && !normSector.includes('VAI VEM')) return true;
    return false;
  }

  // Preparação de Folhas / Geral (Terminal 2) - NUNCA deve casar com setor de Dobra (Terminal 1)
  if (normStep === 'PREPARACAO' && normSector.includes('PREPARACAO') && !normSector.includes('DOBRA') && !normSector.includes('VAI VEM') && !normSector.includes('BATENTE')) {
    return true;
  }

  if (normStep.includes('PREPARACAO') && normStep.includes('VAI VEM')) {
    return normSector.includes('PREPARACAO') && normSector.includes('VAI VEM') && !normSector.includes('FINALIZACAO');
  }

  // Injeção de Folhas / Geral (Terminal 2)
  if ((normStep === 'INJECAO' || normStep === 'INJETORA' || normStep === 'INJECAO DE FOLHAS' || normStep.includes('INJECAO DE FOLHA')) && (
    normSector.includes('INJETORA') || 
    (normSector.includes('INJECAO') && !normSector.includes('BATENTE'))
  )) {
    return true;
  }

  // Montagem Geral (Portas Convencionais T3 / T4)
  if (normStep === 'MONTAGEM' || normStep === 'MONTAGEM DE PORTAS') {
    return normSector.includes('MONTAGEM') && !normSector.includes('ESTANTE') && !normSector.includes('TRILHO') && !normSector.includes('ABRIGO');
  }

  if (normStep.includes('MONTAGEM') && (normStep.includes('OFFICE DOOR') || normStep.includes('OFFICE'))) {
    const isStepCorrer = normStep.includes('CORRER') || normStep.includes('COR ');
    const isSectorCorrer = normSector.includes('CORRER') || normSector.includes('COR ');
    const isStepGiro = normStep.includes('GIRO') || normStep.includes('GIRAT');
    const isSectorGiro = normSector.includes('GIRO') || normSector.includes('GIRAT');

    // NUNCA casar Giro com Correr
    if (isStepCorrer && (isSectorGiro || normSector.includes('GIRO') || normSector.includes('GIRAT'))) return false;
    if (isStepGiro && (isSectorCorrer || normSector.includes('CORRER') || normSector.includes('COR '))) return false;

    if (isStepCorrer && isSectorCorrer && normSector.includes('MONTAGEM')) return true;
    if (isStepGiro && isSectorGiro && normSector.includes('MONTAGEM')) return true;
    if (normSector.includes('MONTAGEM') && normSector.includes('OFFICE') && !isSectorCorrer && !isStepCorrer) return true;
    return false;
  }

  if (normStep.includes('GIRATORIA') && !normStep.includes('GAXETA')) {
    return normSector.includes('GIRATORIA') && !normSector.includes('GAXETA') && !normSector.includes('EMENDADA');
  }

  if (normStep.includes('EMENDADA')) {
    return normSector.includes('EMENDADA');
  }

  if (normStep.includes('CORRER')) {
    return normSector.includes('CORRER') && !normSector.includes('EMENDADA');
  }

  // Comparação normalizada e tolerante para Montagem / Finalização Vai-Vem
  if (etapaPertenceARota(sector, [step])) {
    return true;
  }

  const normStepClean = normStep.replace(/[-_]/g, ' ');
  const normSectorClean = normSector.replace(/[-_]/g, ' ');
  if (normStepClean.includes('VAI VEM')) {
    if (normSectorClean.includes('VAI VEM')) {
      if (
        (normStepClean.includes('MONTAGEM') || normStepClean.includes('FINALIZACAO')) &&
        (normSectorClean.includes('MONTAGEM') || normSectorClean.includes('FINALIZACAO'))
      ) {
        return true;
      }
      if (normStepClean.includes('PREPARACAO') && normSectorClean.includes('PREPARACAO')) {
        return true;
      }
      if (!normSectorClean.includes('PREPARACAO') && !normStepClean.includes('PREPARACAO')) {
        return true;
      }
    }
  }

  if (normStep.includes('SOLDA') && normSector.includes('SOLDA')) {
    return true;
  }

  if (normStep.includes('ROUTER') && normSector.includes('ROUTER')) {
    return true;
  }

  if (normStep.includes('ELETRICA') && normSector.includes('ELETRICA')) {
    return true;
  }

  if (normStep.includes('CORTINA') && normSector.includes('CORTINA')) {
    return true;
  }

  if (normStep.includes('GAXETA') && normSector.includes('GAXETA')) {
    return true;
  }

  return false;
}

/**
 * Encontra a etapa da rota que corresponde ao setor selecionado no terminal
 */
export function findStepForSector(sector: string, routeSteps: string[]): string | null {
  if (!sector || !Array.isArray(routeSteps)) return null;
  for (const step of routeSteps) {
    if (doesSectorMatchStep(sector, step)) {
      return step;
    }
  }
  // Fallback tolerante para compatibilidade de rotas (incluindo variações de Vai-Vem)
  for (const step of routeSteps) {
    if (etapaPertenceARota(sector, [step])) {
      return step;
    }
  }
  return null;
}

/**
 * Compara dois nomes de etapa de forma dinâmica e insensível a variações
 */
export function matchStepName(stepA?: string, stepB?: string): boolean {
  if (!stepA || !stepB) return false;
  if (etapaPertenceARota(stepA, [stepB])) return true;
  const normA = normalizeText(stepA);
  const normB = normalizeText(stepB);
  if (normA === normB) return true;

  // Corte Alumínio (Terminal 5) vs Corte Guilhotina (Terminal 1)
  if (normA.includes('ALUMINIO') || normB.includes('ALUMINIO')) {
    return normA.includes('ALUMINIO') && normB.includes('ALUMINIO');
  }

  // Laser vs Laser CNC
  if (normA.includes('LASER') && normB.includes('LASER')) return true;

  // Corte vs Corte - Guilhotina
  if (normA.includes('CORTE') && normB.includes('CORTE')) return true;

  // Batentes
  const aIsPrepBat = normA.includes('PREPARACAO') && (normA.includes('BATENTE') || normB.includes('BATENTE'));
  const bIsPrepBat = normB.includes('PREPARACAO') && (normA.includes('BATENTE') || normB.includes('BATENTE'));
  if (aIsPrepBat && bIsPrepBat) return true;

  const aIsInjFinBat = (normA.includes('INJECAO') || normA.includes('FINALIZACAO')) && (normA.includes('BATENTE') || normB.includes('BATENTE') || normA.includes('FINALIZACAO') || normB.includes('FINALIZACAO'));
  const bIsInjFinBat = (normB.includes('INJECAO') || normB.includes('FINALIZACAO')) && (normA.includes('BATENTE') || normB.includes('BATENTE') || normA.includes('FINALIZACAO') || normB.includes('FINALIZACAO'));
  if (aIsInjFinBat && bIsInjFinBat) return true;

  // Dobra (T1): NUNCA deve ser compatível com Preparação (T2)
  if ((normA.includes('DOBRA') && !normB.includes('DOBRA')) || (normB.includes('DOBRA') && !normA.includes('DOBRA'))) {
    return false;
  }

  // Preparação de Folhas (T2)
  if (normA.includes('PREPARACAO') && normB.includes('PREPARACAO') && !normA.includes('VAI VEM') && !normB.includes('VAI VEM')) {
    return true;
  }

  // Injeção / Injetora (T2)
  if ((normA.includes('INJEC') || normA.includes('INJET')) &&
      (normB.includes('INJEC') || normB.includes('INJET')) &&
      !normA.includes('BATENTE') && !normB.includes('BATENTE')) {
    return true;
  }

  // Trilhos (Corte e Montagem)
  if (normA.includes('TRILHO') && normB.includes('TRILHO')) {
    if (normA.includes('CORTE') && normB.includes('CORTE')) return true;
    if (normA.includes('MONTAGEM') && normB.includes('MONTAGEM')) return true;
    return true;
  }

  // Isolamento estrito entre famílias de produtos incompatíveis
  const aOffice = normA.includes('OFFICE');
  const bOffice = normB.includes('OFFICE');
  if (aOffice !== bOffice) {
    return false; // Um é Office e o outro não: NUNCA podem coincidir!
  }
  if (aOffice && bOffice) {
    const aCorrer = normA.includes('CORRER') || normA.includes('COR ');
    const bCorrer = normB.includes('CORRER') || normB.includes('COR ');
    const aGiro = normA.includes('GIRO') || normA.includes('GIRAT');
    const bGiro = normB.includes('GIRO') || normB.includes('GIRAT');
    if ((aCorrer && bGiro) || (aGiro && bCorrer)) {
      return false; // NUNCA casar Giro com Correr!
    }
    if (normA.includes('PREPARACAO') || normB.includes('PREPARACAO')) {
      return normA.includes('PREPARACAO') && normB.includes('PREPARACAO');
    }
    if (normA.includes('MONTAGEM') || normB.includes('MONTAGEM')) {
      return normA.includes('MONTAGEM') && normB.includes('MONTAGEM');
    }
    return true;
  }

  const aVaiVem = normA.includes('VAI VEM') || normA.includes('VV');
  const bVaiVem = normB.includes('VAI VEM') || normB.includes('VV');
  if (aVaiVem !== bVaiVem) {
    return false;
  }

  const aBatente = normA.includes('BATENTE');
  const bBatente = normB.includes('BATENTE');
  if (aBatente !== bBatente) {
    const aInjFin = normA.includes('INJECAO') || normA.includes('FINALIZACAO');
    const bInjFin = normB.includes('INJECAO') || normB.includes('FINALIZACAO');
    const aPrep = normA.includes('PREPARACAO');
    const bPrep = normB.includes('PREPARACAO');
    if (!(aInjFin && bInjFin) && !(aPrep && bPrep)) {
      return false;
    }
  }

  const aTrilho = normA.includes('TRILHO');
  const bTrilho = normB.includes('TRILHO');
  if (aTrilho !== bTrilho) {
    return false;
  }

  const aGiro = (normA.includes('GIRATORIA') || normA.includes('GIRO')) && !normA.includes('GAXETA');
  const bGiro = (normB.includes('GIRATORIA') || normB.includes('GIRO')) && !normB.includes('GAXETA');
  const aCorrer = (normA.includes('CORRER') || normA.includes('COR ')) && !normA.includes('GAXETA');
  const bCorrer = (normB.includes('CORRER') || normB.includes('COR ')) && !normB.includes('GAXETA');
  if ((aGiro && bCorrer) || (aCorrer && bGiro)) {
    return false;
  }

  // Vai-Vem: Preparação e Montagem são etapas distintas e NUNCA devem ser equivalentes
  const normAClean = normA.replace(/[-_]/g, ' ');
  const normBClean = normB.replace(/[-_]/g, ' ');
  if (normAClean.includes('VAI VEM') && normBClean.includes('VAI VEM')) {
    if (normAClean.includes('PREPARACAO') && normBClean.includes('PREPARACAO')) return true;
    if ((normAClean.includes('MONTAGEM') || normAClean.includes('FINALIZACAO')) && (normBClean.includes('MONTAGEM') || normBClean.includes('FINALIZACAO'))) return true;
    return false;
  }

  // Portas Giratórias
  if (normA.includes('GIRATORIA') && normB.includes('GIRATORIA')) {
    if (!normA.includes('GAXETA') && !normB.includes('GAXETA') && !normA.includes('EMENDADA') && !normB.includes('EMENDADA')) return true;
  }

  // Portas de Correr
  if (normA.includes('CORRER') && normB.includes('CORRER')) {
    if (!normA.includes('EMENDADA') && !normB.includes('EMENDADA') && !normA.includes('TRILHO') && !normB.includes('TRILHO')) return true;
  }

  // Instalação de Gaxeta
  if (normA.includes('GAXETA') && normB.includes('GAXETA')) {
    return true;
  }

  // Montagem Geral (Portas Convencionais)
  if (normA === 'MONTAGEM' || normB === 'MONTAGEM') {
    if (normA.includes('MONTAGEM') && normB.includes('MONTAGEM') && !normA.includes('ESTANTE') && !normB.includes('ESTANTE') && !normA.includes('TRILHO') && !normB.includes('TRILHO')) return true;
  }

  return false;
}

/**
 * Garante que a OP possua seu dicionário de etapas isolado, inicializando
 * cada etapa da rota como PENDENTE (concluidas: 0) ou sincronizando com apontamentos reais.
 */
export function initOrSyncOrderEtapas(
  order: ProductionOrder,
  apontamentos: Apontamento[] = []
): ProductionOrder {
  const listaApontamentos: Apontamento[] = Array.isArray(apontamentos)
    ? apontamentos
    : (apontamentos && typeof apontamentos === 'object' && !('then' in (apontamentos as any)) ? (Object.values(apontamentos) as Apontamento[]) : []);
  const safeApontamentos = listaApontamentos;
  const { steps } = getRouteForOp(order);
  const total = obterQuantidadeTotal(order);
  const rawEtapas = order.etapas && !Array.isArray(order.etapas) && typeof order.etapas === 'object'
    ? order.etapas
    : {};
  const currentEtapas: Record<string, OpEtapaState> = {};

  steps.forEach((step) => {
    const stepApontamentos = listaApontamentos.filter((a) => {
      if (!a) return false;
      if (a.op_numero !== order.op_numero && a.op !== order.op_numero) return false;
      const aptEtapa = a.etapa_rota || a.etapaRota;
      if (aptEtapa) {
        return matchStepName(aptEtapa, step);
      }
      return doesSectorMatchStep(a.setorFisico || a.setor, step);
    });

    const finishedBatch = stepApontamentos.find(
      (a) => (a.is_lote || a.unidade_numero === 0) && a.status === 'FINALIZADO'
    );
    const activeBatch = stepApontamentos.find(
      (a) => (a.is_lote || a.unidade_numero === 0) && a.status === 'EM_ANDAMENTO'
    );
    const finishedUnits = stepApontamentos.filter(
      (a) => a.status === 'FINALIZADO' && !a.is_lote && a.unidade_numero > 0
    ).length;
    const activeUnits = stepApontamentos.filter(
      (a) => a.status === 'EM_ANDAMENTO' && !a.is_lote && a.unidade_numero > 0
    ).length;

    const totalFinished = finishedBatch
      ? Math.max(finishedUnits, finishedBatch.quantidade_lote || total)
      : finishedUnits;
    const totalActive = activeBatch
      ? Math.max(activeUnits, activeBatch.quantidade_lote || total)
      : activeUnits;

    const existingKey = Object.keys(rawEtapas).find((k) => matchStepName(k, step));
    const existing = existingKey ? rawEtapas[existingKey] : undefined;

    if (!existing) {
      if (totalFinished >= total) {
        currentEtapas[step] = { status: 'CONCLUIDO', concluidas: totalFinished, total };
      } else if (totalActive > 0) {
        currentEtapas[step] = { status: 'EM_PRODUCAO', concluidas: totalFinished, total };
      } else {
        currentEtapas[step] = { status: 'PENDENTE', concluidas: 0, total };
      }
    } else {
      // Se não há apontamentos reais para esta etapa e totalFinished === 0 (ex: após reset de OP), reseta para PENDENTE com 0 concluídas
      if (totalFinished === 0 && totalActive === 0 && stepApontamentos.length === 0) {
        currentEtapas[step] = { status: 'PENDENTE', concluidas: 0, total };
      } else {
        const concluidas = Math.max(existing.concluidas || 0, totalFinished);
        const status = concluidas >= total
          ? 'CONCLUIDO'
          : (concluidas > 0 || totalActive > 0 ? 'EM_PRODUCAO' : existing.status);
        currentEtapas[step] = {
          ...existing,
          status,
          concluidas,
          total: existing.total || total
        };
      }
    }
  });

  let etapaAtual = order.etapaAtual;
  let statusEtapa = order.statusEtapa;
  let status = order.status;

  // Alinhamento mandatório de flags de processo para rotas especiais Nomus
  if (isRotaExclusivaLaser(order) || isRotaLaserDobra(order)) {
    (order as any).requerLaser = true;
    (order as any).requer_laser = true;
  }
  if (isRotaExclusivaRouter(order)) {
    (order as any).requerRouter = true;
    (order as any).requer_router = true;
  }

  // Auto-correção caso uma OP sem apontamentos esteja com etapa inicial desalinhada (ex: Laser, Router ou Corte)
  if (
    steps.length > 0 &&
    safeApontamentos.length === 0 &&
    (!order.statusExecucao || order.statusExecucao === 'pendente' || String(status || '').includes('Aguardando Início') || !status)
  ) {
    if (steps[0] === 'Laser' || steps[0] === 'Router' || steps[0] === 'Corte') {
      etapaAtual = steps[0];
      statusEtapa = `Aguardando Início em: ${steps[0]}`;
      if (!status || status.includes('Aguardando Início') || status === 'pendente') {
        status = `Aguardando Início em: ${steps[0]}`;
      }
    }
  }

  // Auto-correção caso uma porta especial estava com etapa inicial incorreta em Gaxeta/Montagem sem apontamento
  if (
    steps[0] === 'Corte' &&
    (!etapaAtual ||
      etapaAtual === 'Instalação de Gaxeta' ||
      etapaAtual === 'Montagem de Portas Giratória Padrão e Especial' ||
      etapaAtual === 'Montagem Portas de Correr Padrão e Especial' ||
      etapaAtual.includes('Montagem')) &&
    safeApontamentos.length === 0 &&
    (!order.statusExecucao || order.statusExecucao === 'pendente' || String(status || '').includes('Aguardando Início'))
  ) {
    etapaAtual = 'Corte';
    statusEtapa = 'Aguardando Início em: Corte';
    if (!status || status.includes('Aguardando Início')) {
      status = 'Aguardando Início em: Corte';
    }
  }

  return {
    ...order,
    rota: steps,
    etapaAtual,
    statusEtapa,
    status,
    statusAtual: order.statusAtual && !order.statusAtual.includes('Aguardando Início') ? order.statusAtual : `AGUARDANDO INÍCIO EM: ${etapaAtual}`,
    etapas: currentEtapas
  };
}

/**
 * Lista oficial de postos unitários para ativação da interface de peças individuais
 */
export const POSTOS_UNITARIOS = [
  'Instalação de Gaxeta',
  'Montagem de Portas Giratórias',
  'Montagem de Portas Giratória Padrão e Especial',
  'Preparação Vai Vem',
  'Montagem Porta Vai-Vem',
  'Montagem Portas de Correr Padrão e Especial'
];

/**
 * Verifica se o posto e quantidade ativam o modo de interface unitária (cartões de peças individuais)
 */
export const isModoUnitario = (posto: string, qtde: number): boolean => 
  (POSTOS_UNITARIOS.some(p => p.toLowerCase().trim() === (posto || '').toLowerCase().trim()) || isPostoUnitario(posto)) && qtde >= 1;

/**
 * Verifica se um posto pertence à lista de postos unitários com comparação tolerante
 */
export function isPostoUnitario(posto?: string | null): boolean {
  if (!posto) return false;
  const pTrim = posto.trim().toLowerCase();
  if (POSTOS_UNITARIOS.some(p => p.toLowerCase().trim() === pTrim)) return true;
  const pNorm = normalizeText(posto);
  return POSTOS_UNITARIOS.some(pu => {
    const puNorm = normalizeText(pu);
    if (pNorm === puNorm) return true;
    if (pNorm.includes('GAXETA') && puNorm.includes('GAXETA')) return true;
    if (pNorm.includes('VAI VEM') && puNorm.includes('VAI VEM') && pNorm.includes('MONTAGEM') && puNorm.includes('MONTAGEM')) return true;
    if (pNorm.includes('VAI VEM') && puNorm.includes('VAI VEM') && pNorm.includes('PREPARACAO') && puNorm.includes('PREPARACAO')) return true;
    if (pNorm.includes('GIRATORIA') && puNorm.includes('GIRATORIA') && pNorm.includes('MONTAGEM')) return true;
    if (pNorm.includes('CORRER') && puNorm.includes('CORRER') && pNorm.includes('MONTAGEM')) return true;
    return false;
  });
}

/**
 * Determina se a OP / Etapa deve ser apontada em Lote Completo ou Peça a Peça (Unitário)
 */
export function isBatchTracking(
  order: ProductionOrder | { descricao: string; codigo?: string },
  sector?: string | null
): boolean {
  // 1. Postos Unitários Oficiais operam SEMPRE no modo unitário (peça a peça)
  if (isPostoUnitario(sector)) {
    return false;
  }

  const desc = typeof order === 'object' && order !== null ? order.descricao : String(order || '');
  const norm = normalizeText(desc || '');
  const code = extractProductCode(order);
  const secNorm = normalizeText(sector || '');

  // 1. Manutenção do Modo Unitário (Peça a Peça) EXCLUSIVAMENTE para portas completas montadas:
  // - Posto de Instalação de Gaxeta opera sempre unitário para fluxo contínuo
  if (secNorm.includes('GAXETA')) {
    return false;
  }

  // - Portas Giratórias (nos setores de Instalação de Gaxeta e Montagem Giratória)
  const isPortaGiro = norm.includes('PT GIR') || norm.includes('PORTA GIRATORIA') || (norm.includes('GIRATORIA') && !norm.includes('BAT') && !norm.includes('FOLHA'));
  if (isPortaGiro && (secNorm.includes('GAXETA') || secNorm.includes('GIRAT') || secNorm.includes('MONTAGEM'))) {
    return false;
  }

  // Produtos Especiais Industriais são apontados em Lote Completo:
  // - Resistência de Piso e Kit Gaxeta U (mesmo apontados no setor Montagem Portas Emendadas)
  if (isResistenciaPiso(order) || isKitGaxetaU(order)) {
    return true;
  }
  // - Estantes Walk-in, Abrigo de Doca e Perfis PP
  if (isEstanteCompleta(order) || isQuadroEstante(order) || isPeEstanteSemPintura(order) || isPeEstanteComPintura(order) || isAbrigoDoca(order) || isPerfilPP(order)) {
    return true;
  }

  // - Portas de Correr e Portas Emendadas (nos setores de Montagem)
  const isTrilho = (code && code.startsWith('028.')) || (code && CODIGOS_TRILHOS_LGT_PADRAO.has(code)) || norm.includes('TRILHO');
  const isPortaCorrer = !isTrilho && (norm.includes('PT COR') || norm.includes('PORTA CORRER') || norm.includes('PORTA DE CORRER'));
  if (isPortaCorrer && (secNorm.includes('EMENDAD') || secNorm.includes('CORRER') || secNorm.includes('GAXETA') || secNorm.includes('MONTAGEM'))) {
    return false;
  }
  if (secNorm.includes('EMENDAD')) {
    return false;
  }

  // - Portas Vai-Vem (nos setores de Montagem / Finalização Vai-Vem)
  const isVaiVem = norm.includes('PT VAI VEM') || norm.includes('VAI VEM') || norm.includes('VV');
  if (isVaiVem && (secNorm.includes('FINALIZACAO') || secNorm.includes('MONTAGEM') || secNorm.includes('VAI VEM'))) {
    return false;
  }

  // 2. Definição das Categorias de Apontamento em Lote / OP Completa:
  // - Folhas Padrão (código em CODIGOS_FOLHAS_PADRAO ou descrição FOLHA)
  if ((code && CODIGOS_FOLHAS_PADRAO.has(code)) || norm.includes('FOLHA')) {
    return true;
  }

  // - Batentes Padrão (código em CODIGOS_BATENTES_PADRAO ou descrição BAT) ou setores de Batentes / Laser
  if ((code && CODIGOS_BATENTES_PADRAO.has(code)) || norm.includes('BAT') || secNorm.includes('BATENTE') || secNorm.includes('LASER')) {
    return true;
  }

  // - Âncoras com e sem solda (código em CODIGOS_ANCORAS_PADRAO ou descrição ANCORA)
  if (isAncoraOrder(order) || (code && (code.startsWith('021.') || CODIGOS_ANCORAS_PADRAO.has(code))) || norm.includes('ANCORA')) {
    return true;
  }

  // - Trilhos para porta de correr (família 028, código em CODIGOS_TRILHOS_LGT_PADRAO ou descrição TRILHO)
  if ((code && code.startsWith('028.')) || (code && CODIGOS_TRILHOS_LGT_PADRAO.has(code)) || norm.includes('TRILHO')) {
    return true;
  }

  // - Pendurais (descrição contendo "PENDURAL" ou código de pendurais)
  if (norm.includes('PENDURAL') || (code && code.startsWith('025.'))) {
    return true;
  }

  // - Trilhos de Cortina (descrição contendo "TRILHO CORTINA" ou código)
  if (norm.includes('TRILHO CORTINA')) {
    return true;
  }

  // - Cortinas (descrição contendo "CORTINA" ou família 024)
  if (norm.includes('CORTINA') || (code && code.startsWith('024.'))) {
    return true;
  }

  // - QC Comando (descrição contendo "QC", "QUADRO DE COMANDO" ou "COMANDO")
  if (norm.includes('QC') || norm.includes('QUADRO DE COMANDO') || norm.includes('COMANDO')) {
    return true;
  }

  // Se não for porta completa montada em setor de acabamento, é lote por padrão
  if (!isPortaGiro && !isPortaCorrer && !isVaiVem) {
    return true;
  }

  return true;
}

export interface StepStatus {
  step: string;
  stepIndex: number;
  isFirst: number;
  totalQtd: number;
  finalizadas: number;
  emAndamento: number;
  activeApontamentos: Apontamento[];
  finishedApontamentos: Apontamento[];
  canStartNextUnit: boolean;
  nextUnitNumber: number;
  blockingReason?: string;
  previousStepName?: string;
  previousStepFinalizadas?: number;
}

/**
 * Avalia o progresso detalhado de cada etapa da rota para uma OP
 */
export function getRouteEvaluation(
  op: ProductionOrder,
  apontamentos: Apontamento[] = [],
  routeSteps: string[]
): Record<string, StepStatus> {
  const listaApontamentos: Apontamento[] = Array.isArray(apontamentos)
    ? apontamentos
    : (apontamentos && typeof apontamentos === 'object' && !('then' in (apontamentos as any)) ? (Object.values(apontamentos) as Apontamento[]) : []);
  const safeApontamentos = listaApontamentos;
  const result: Record<string, StepStatus> = {};
  const total = obterQuantidadeTotal(op);
  const synchronizedOp = initOrSyncOrderEtapas(op, listaApontamentos);
  const etapas = synchronizedOp.etapas || {};

  const cleanOpNum = String(op.op_numero || op.numero || '').replace(/^(\s*OP\s*)+/i, '').replace(/[-_\s]/g, '').toUpperCase();
  const safeSteps = Array.isArray(routeSteps) && routeSteps.length > 0
    ? routeSteps
    : (Array.isArray(op.rota) && op.rota.length > 0 ? op.rota : obterEtapasDaRota(op));

  safeSteps.forEach((step, index) => {
    // Apontamentos desta etapa (validação estrita por etapa_rota/etapaRota ou fallback de setor seguro)
    const stepApontamentos = listaApontamentos.filter(a => {
      if (!a) return false;
      const cleanAptOp = String(a.op_numero || a.op || '').replace(/^(\s*OP\s*)+/i, '').replace(/[-_\s]/g, '').toUpperCase();
      if (cleanAptOp !== cleanOpNum && a.op_numero !== op.op_numero && a.op !== op.op_numero) return false;
      const aptEtapa = a.etapa_rota || a.etapaRota;
      if (aptEtapa) {
        return matchStepName(aptEtapa, step);
      }
      return doesSectorMatchStep(a.setorFisico || a.setor, step);
    });

    const activeBatch = stepApontamentos.find(a => (a.is_lote || a.unidade_numero === 0) && a.status === 'EM_ANDAMENTO');
    const finishedBatch = stepApontamentos.find(a => (a.is_lote || a.unidade_numero === 0) && a.status === 'FINALIZADO');

    const finished = stepApontamentos.filter(a => a.status === 'FINALIZADO' && !a.is_lote && a.unidade_numero > 0);
    const active = stepApontamentos.filter(a => a.status === 'EM_ANDAMENTO' && !a.is_lote && a.unidade_numero > 0 && !finished.some(f => f.unidade_numero === a.unidade_numero));

    let finalizadasCount = finished.length;
    if (finishedBatch) {
      finalizadasCount = Math.max(finalizadasCount, finishedBatch.quantidade_lote || total);
    }

    let emAndamentoCount = active.length;
    if (activeBatch && !finishedBatch && finalizadasCount < total) {
      emAndamentoCount = Math.max(emAndamentoCount, activeBatch.quantidade_lote || total);
    }

    // Consulta estado individualizado da etapa no objeto da OP
    const etapaStateKey = Object.keys(etapas).find((k) => matchStepName(k, step));
    const etapaState = etapaStateKey ? (etapas as Record<string, any>)[etapaStateKey] : undefined;
    if (etapaState) {
      const st = String(etapaState.status || '').toUpperCase().trim();
      if (st === 'CONCLUIDO' || st === 'FINALIZADO') {
        finalizadasCount = Math.max(finalizadasCount, etapaState.concluidas || total);
      } else if (st === 'EM_PRODUCAO' || st === 'EM_ANDAMENTO' || st === 'IN_PROGRESS') {
        emAndamentoCount = Math.max(emAndamentoCount, etapaState.emAndamento || 1);
      } else if (st === 'PENDENTE' && !finishedBatch && finished.length === 0) {
        finalizadasCount = 0;
      }
    }

    if (finalizadasCount >= total) {
      emAndamentoCount = 0;
    }

    const totalIniciadas = finalizadasCount + emAndamentoCount;
    const nextUnit = totalIniciadas + 1;

    const isBatch = isBatchTracking(op, step);
    let canStart = false;
    let blockingReason: string | undefined = undefined;
    let prevName: string | undefined = undefined;
    let prevFinalizadas: number | undefined = undefined;

    if (finalizadasCount >= total) {
      canStart = false;
      blockingReason = `Lote completo (${total}/${total} peças concluídas nesta etapa)`;
    } else if (emAndamentoCount > 0 && isBatch) {
      canStart = false;
      blockingReason = `Lote já está em andamento nesta etapa`;
    } else if (totalIniciadas >= total && !isBatch) {
      canStart = false;
      blockingReason = `Lote completo (${total}/${total} peças iniciadas/concluídas nesta etapa)`;
    } else if (index === 0) {
      canStart = true;
    } else {
      const previousStep = safeSteps[index - 1];
      prevName = previousStep;

      const prevApontamentos = safeApontamentos.filter(a => {
        if (a.op_numero !== op.op_numero && a.op !== op.op_numero) return false;
        const aptEtapa = a.etapa_rota || a.etapaRota;
        if (aptEtapa) {
          return matchStepName(aptEtapa, previousStep);
        }
        return doesSectorMatchStep(a.setorFisico || a.setor, previousStep);
      });
      const prevFinishedBatch = prevApontamentos.find(a => (a.is_lote || a.unidade_numero === 0) && a.status === 'FINALIZADO');
      let prevFinishedCount = prevApontamentos.filter(a => a.status === 'FINALIZADO' && !a.is_lote && a.unidade_numero > 0).length;
      if (prevFinishedBatch) {
        prevFinishedCount = Math.max(prevFinishedCount, prevFinishedBatch.quantidade_lote || total);
      }

      const prevEtapaStateKey = Object.keys(etapas).find((k) => matchStepName(k, previousStep));
      const prevEtapaState = prevEtapaStateKey ? etapas[prevEtapaStateKey] : undefined;
      if (prevEtapaState && prevEtapaState.status === 'CONCLUIDO') {
        prevFinishedCount = Math.max(prevFinishedCount, prevEtapaState.concluidas || total);
      } else if (prevEtapaState && typeof prevEtapaState.concluidas === 'number') {
        prevFinishedCount = Math.max(prevFinishedCount, prevEtapaState.concluidas);
      }

      // Consulta apontamentos explícitos na OP (op.apontamentos)
      const opApts = (op as any)?.apontamentos;
      if (opApts && typeof opApts === 'object') {
        const prevAptKey = Object.keys(opApts).find((k) => matchStepName(k, previousStep));
        if (prevAptKey) {
          const aptInfo = opApts[prevAptKey];
          const val = aptInfo?.qtdProduzida ?? aptInfo?.concluidas ?? (aptInfo?.status === 'CONCLUIDO' ? total : 0);
          if (typeof val === 'number') prevFinishedCount = Math.max(prevFinishedCount, val);
        }
      }

      // Consulta progressoPostos na OP
      const progressoPrev = (op as any)?.progressoPostos
        ? (op as any).progressoPostos[previousStep] ||
          Object.entries((op as any).progressoPostos).find(([k]) => matchStepName(k, previousStep))?.[1]
        : undefined;

      if (progressoPrev) {
        if (progressoPrev.concluido || progressoPrev.status === 'CONCLUIDO') {
          prevFinishedCount = Math.max(prevFinishedCount, progressoPrev.concluidas || total);
        } else if (typeof progressoPrev.concluidas === 'number') {
          prevFinishedCount = Math.max(prevFinishedCount, progressoPrev.concluidas);
        }
      }

      prevFinalizadas = prevFinishedCount;

      // Verificação de início/andamento da etapa anterior
      const prevActiveBatch = prevApontamentos.find(a => (a.is_lote || a.unidade_numero === 0) && a.status === 'EM_ANDAMENTO');
      const prevActiveUnits = prevApontamentos.filter(a => a.status === 'EM_ANDAMENTO' && !a.is_lote && a.unidade_numero > 0).length;
      const hasActivePrevApontamento = Boolean(
        prevActiveBatch ||
        prevActiveUnits > 0 ||
        prevApontamentos.some(a => a.status === 'EM_ANDAMENTO' || a.status === 'FINALIZADO' || a.status === 'CONCLUIDO')
      );

      const prevEtapaStatus = prevEtapaState?.status;
      const prevEtapaIniciadaOuConcluida = Boolean(
        prevEtapaState && (
          prevEtapaStatus === 'EM_PRODUCAO' ||
          prevEtapaStatus === 'EM_ANDAMENTO' ||
          prevEtapaStatus === 'CONCLUIDO' ||
          prevEtapaStatus === 'FINALIZADO' ||
          (prevEtapaState.concluidas && prevEtapaState.concluidas > 0)
        )
      );

      const prevProgressoIniciado = Boolean(
        progressoPrev && (
          progressoPrev.iniciado ||
          progressoPrev.concluido ||
          (progressoPrev.concluidas && progressoPrev.concluidas > 0) ||
          progressoPrev.status === 'EM_PRODUCAO' ||
          progressoPrev.status === 'CONCLUIDO'
        )
      );

      const prevEtapaAtualMatch = Boolean(
        op.etapaAtual && (matchStepName(op.etapaAtual, previousStep) || doesSectorMatchStep(op.etapaAtual, previousStep))
      );

      const prevIsStartedOrConcluded = Boolean(
        prevFinishedCount > 0 ||
        hasActivePrevApontamento ||
        prevEtapaIniciadaOuConcluida ||
        prevProgressoIniciado ||
        prevEtapaAtualMatch
      );

      const normStep = normalizeText(step);
      const normPrevStep = normalizeText(previousStep);

      const ehGaxetaParaMontagem =
        (normPrevStep.includes('GAXETA') || normPrevStep === 'INSTALACAO DE GAXETA') &&
        normStep.includes('MONTAGEM');

      const ehInjecaoBatenteOuFolha =
        normStep.includes('INJECAO E FINALIZACAO DE BATENTES') ||
        normStep.includes('INJECAO E FINALIZACAO BATENTES') ||
        normStep.includes('INJECAO DE FOLHAS') ||
        normStep.includes('INJETORA DE FOLHAS') ||
        (normStep.includes('INJEC') && (normStep.includes('BATENTE') || normStep.includes('FOLHA')));

      // REGRA DE FLUXO CONTÍNUO: Liberação parcial de peças de Gaxeta para a Montagem
      if (ehGaxetaParaMontagem) {
        let qtdGaxetaPronta = prevFinishedCount;
        let qtdMontagemPronta = finalizadasCount;

        if (opApts && typeof opApts === 'object') {
          const montAptKey = Object.keys(opApts).find((k) => matchStepName(k, step));
          if (montAptKey) {
            const aptInfo = opApts[montAptKey];
            const val = aptInfo?.qtdProduzida ?? aptInfo?.concluidas ?? (aptInfo?.status === 'CONCLUIDO' ? total : 0);
            if (typeof val === 'number') qtdMontagemPronta = Math.max(qtdMontagemPronta, val);
          }
        }

        // Quantidade que já passou pela gaxeta mas ainda não foi montada
        const pecasDisponiveisParaMontar = Math.max(0, qtdGaxetaPronta - qtdMontagemPronta);

        // Validação para o botão de incremento / início da Montagem
        const podeMontarPeca = pecasDisponiveisParaMontar > 0;

        const temSaldoParaIniciar = totalIniciadas < qtdGaxetaPronta;
        if (podeMontarPeca && temSaldoParaIniciar && totalIniciadas < total) {
          canStart = true;
          blockingReason = undefined;
        } else {
          canStart = false;
          if (qtdGaxetaPronta === 0) {
            blockingReason = 'Aguardando término de pelo menos 1 peça na Instalação de Gaxeta';
          } else if (totalIniciadas >= qtdGaxetaPronta) {
            blockingReason = `Aguardando liberação de novas peças pela Gaxeta (${qtdMontagemPronta}/${qtdGaxetaPronta} montadas)`;
          } else {
            blockingReason = 'Sem saldo de peças disponíveis da Gaxeta para Montagem';
          }
        }
      } else if (
        (normStep.includes('MONTAGEM') || normStep.includes('FINALIZACAO')) &&
        (normStep.includes('VAI VEM') || normStep.includes('OFFICE DOOR') || isVaiVemOuOfficeDoor(op))
      ) {
        // REGRA DE BLOQUEIO CONDICIONAL: Montagem de Vai-Vem e Office Door (Terminal 5)
        const montagemCheck = verificarLiberacaoMontagemVaiVemOuOfficeDoor(op, apontamentos);
        if (montagemCheck.liberada) {
          canStart = true;
          blockingReason = undefined;
        } else {
          canStart = false;
          blockingReason = montagemCheck.motivo;
        }
      } else if (normStep.includes('ROUTER')) {
        // REGRA OPERACIONAL: O posto de Router deve poder ser iniciado e apontado a qualquer momento quando solicitado,
        // mesmo que a Injeção ainda esteja em andamento ou já tenha sido concluída (trabalho paralelo e independente).
        canStart = true;
        blockingReason = undefined;
      } else if (ehInjecaoBatenteOuFolha) {
        // REGRA OPERACIONAL: O posto de Injeção de Folhas (Terminal 2) NUNCA deve depender ou esperar pela etapa Router.
        // O operador da Injeção deve conseguir iniciar e concluir o lote livremente (em concorrência com Preparação).
        canStart = true;
        blockingReason = undefined;
      } else if (normStep.includes('DOBRA')) {
        // REGRA DE FLUXO PARALELO: Liberação antecipada da Dobra com Corte ou Laser em andamento ou concluído
        const dobraCheck = verificarDobraLiberada(op, apontamentos);
        if (dobraCheck.dobraLiberada) {
          canStart = true;
          blockingReason = undefined;
        } else {
          canStart = false;
          blockingReason = dobraCheck.motivo || 'Aguardando início da etapa Corte ou Laser';
        }
      } else if (
        (normStep.includes('PREPARACAO') && normStep.includes('FOLHA')) ||
        normStep === 'PREPARACAO DE FOLHAS' ||
        normStep === 'PREPARACAO DE FOLHA' ||
        (normStep === 'PREPARACAO' && normPrevStep.includes('DOBRA'))
      ) {
        // REGRA DE FLUXO PARALELO: Liberação antecipada de Preparação de Folhas com Dobra em andamento ou concluída
        const prepCheck = verificarPreparacaoFolhasLiberada(op, apontamentos);
        if (prepCheck.preparacaoLiberada) {
          canStart = true;
          blockingReason = undefined;
        } else {
          canStart = false;
          blockingReason = prepCheck.motivo || 'Aguardando início da etapa Dobra';
        }
      } else if (
        normStep.includes('LASER') ||
        (normStep.includes('CORTE') && !normStep.includes('ALUMINIO') && normPrevStep.includes('LASER')) ||
        (isFolhaOrder(op) && (normStep.includes('LASER') || (normStep.includes('CORTE') && !normStep.includes('ALUMINIO'))))
      ) {
        // REGRA GERAL DE PARALELISMO: Corte e Laser são postos de entrada em paralelo no Terminal 1.
        // O Laser NUNCA deve ser bloqueado pelo status do Corte ("Aguardando término do lote no setor anterior").
        // O operador deve ter total liberdade para selecionar e iniciar o lote no Laser imediatamente, mesmo que o Corte ainda esteja com 0 peças apontadas ou em andamento.
        canStart = true;
        blockingReason = undefined;
      } else if (isBatch) {
        if (prevFinishedCount === 0) {
          canStart = false;
          blockingReason = `Aguardando término do lote no setor anterior (${previousStep})`;
        } else {
          canStart = true;
        }
      } else {
        if (prevFinishedCount >= total || prevFinishedCount >= nextUnit) {
          canStart = true;
          blockingReason = undefined;
        } else {
          canStart = false;
          blockingReason = `Aguardando etapa anterior`;
        }
      }
    }

    result[step] = {
      step,
      stepIndex: index,
      isFirst: index === 0 ? 1 : 0,
      totalQtd: total,
      finalizadas: finalizadasCount,
      emAndamento: finalizadasCount >= total ? 0 : emAndamentoCount,
      activeApontamentos: finalizadasCount >= total ? [] : (activeBatch ? [activeBatch, ...active] : active),
      finishedApontamentos: finishedBatch ? [finishedBatch, ...finished] : finished,
      canStartNextUnit: canStart,
      nextUnitNumber: nextUnit,
      blockingReason,
      previousStepName: prevName,
      previousStepFinalizadas: prevFinalizadas
    };
  });

  return result;
}

/**
 * Verifica se a OP está 100% concluída dinamicamente com base em todas as etapas de sua rota oficial.
 */
export function checkOp100Percent(op: any, apontamentos: any[] = []): boolean {
  if (!op) return false;
  const statusUpper = String(op.status || '').toUpperCase().trim();
  if (statusUpper === 'FINALIZADA' || statusUpper === 'CONCLUIDA') return true;
  if (statusUpper.includes('AGUARDANDO INÍCIO') || statusUpper.includes('AGUARDANDO INICIO') || statusUpper === 'PENDENTE') {
    return false;
  }

  const safeApontamentos: any[] = Array.isArray(apontamentos)
    ? apontamentos
    : (apontamentos && typeof apontamentos === 'object' && !('then' in (apontamentos as any)) ? Object.values(apontamentos) : []);

  const rawSteps = Array.isArray(op.rota) && op.rota.length > 0 ? op.rota : obterEtapasDaRota(op);
  const steps = Array.isArray(rawSteps) ? rawSteps : [];
  if (steps.length === 0) return false;

  const total = Math.max(1, Math.round(obterQuantidadeTotal(op) || op.quantidade_total || 1));
  const evaluation = getRouteEvaluation(op, safeApontamentos, steps);

  return steps.every((s: string) => {
    const st = (!Array.isArray(op.etapas) && typeof op.etapas === 'object') ? (op.etapas as any)?.[s] : undefined;
    const ev = evaluation[s];
    return (
      (st && (st.status === 'CONCLUIDO' || st.status === 'FINALIZADO')) ||
      (ev && ev.finalizadas >= total)
    );
  });
}

/**
 * Helper oficial para identificar se uma OP está com produção ativa no chão de fábrica.
 * Retorna true se:
 * - op.emProducao === true
 * - op.status === 'EM_PRODUCAO' | 'em_producao' | 'EM_ANDAMENTO' | 'em_andamento'
 * - Existir qualquer apontamento ativo (status EM_ANDAMENTO ou sem hora_fim)
 * - Alguma etapa em op.etapas estiver com status 'em_andamento' | 'EM_PRODUCAO' | 'in_progress'
 * - Possuir postoAtivo definido ou dataInicio em execução
 * E desde que a OP NÃO esteja 100% concluída nem cancelada.
 */
export function isOpEmProducao(op: any, apontamentos: any[] = []): boolean {
  if (!op) return false;

  const statusUpper = String(op.status || '').toUpperCase().trim();
  if (statusUpper === 'FINALIZADA' || statusUpper === 'CONCLUIDA' || statusUpper === 'CANCELADA') {
    return false;
  }

  const safeApontamentos: any[] = Array.isArray(apontamentos)
    ? apontamentos
    : (apontamentos && typeof apontamentos === 'object' && !('then' in (apontamentos as any)) ? Object.values(apontamentos) : []);

  // Se já concluiu 100% de todas as etapas da rota, não está mais em produção ativa
  if (checkOp100Percent(op, safeApontamentos)) {
    return false;
  }

  // Se a OP está recém-resetada ou aguardando início sem posto ativo e sem apontamentos ativos, não está em produção
  if (statusUpper.includes('AGUARDANDO INÍCIO') || statusUpper.includes('AGUARDANDO INICIO') || statusUpper === 'PENDENTE') {
    if (!op.emProducao && !op.postoAtivo) {
      const cleanOrderOp = String(op.op_numero || op.numero || '')
        .replace(/^(\s*OP\s*)+/i, '')
        .replace(/[-_\s]/g, '')
        .toUpperCase();
      const hasActive = cleanOrderOp && safeApontamentos.some((a) => {
        if (!a) return false;
        const cleanAptOp = String(a.op_numero || a.op || '')
          .replace(/^(\s*OP\s*)+/i, '')
          .replace(/[-_\s]/g, '')
          .toUpperCase();
        return cleanAptOp === cleanOrderOp && String(a.status || '').toUpperCase().trim() === 'EM_ANDAMENTO';
      });
      if (!hasActive) return false;
    }
  }

  // 1. Flag explícita no nó raiz da OP
  if (op.emProducao === true || String(op.emProducao).toLowerCase() === 'true') {
    return true;
  }

  // 2. Status raiz compatível com produção ativa
  if (
    statusUpper === 'EM_PRODUCAO' ||
    statusUpper === 'EM_ANDAMENTO' ||
    statusUpper === 'IN_PROGRESS' ||
    statusUpper === 'PRODUZINDO' ||
    statusUpper === 'PRODUZINDO HOJE'
  ) {
    return true;
  }

  // 3. Existência de qualquer apontamento ativo para a OP (status EM_ANDAMENTO ou sem hora_fim)
  const cleanOrderOp = String(op.op_numero || op.numero || '')
    .replace(/^(\s*OP\s*)+/i, '')
    .replace(/[-_\s]/g, '')
    .toUpperCase();

  if (safeApontamentos.length > 0 && cleanOrderOp) {
    const hasActiveApontamento = safeApontamentos.some((a) => {
      if (!a) return false;
      const cleanAptOp = String(a.op_numero || a.op || '')
        .replace(/^(\s*OP\s*)+/i, '')
        .replace(/[-_\s]/g, '')
        .toUpperCase();
      if (cleanAptOp !== cleanOrderOp) return false;

      const aptStatus = String(a.status || '').toUpperCase().trim();
      const isActive =
        aptStatus === 'EM_ANDAMENTO' ||
        aptStatus === 'IN_PROGRESS' ||
        (!a.hora_fim && !a.horaFim && Boolean(a.hora_inicio || a.horaInicio));
      return isActive;
    });

    if (hasActiveApontamento) {
      return true;
    }
  }

  // 4. Alguma etapa no objeto op.etapas estiver com status em andamento/produção
  if (op.etapas && typeof op.etapas === 'object') {
    const safeEtapas = Array.isArray(op.etapas) ? op.etapas : Object.values(op.etapas);
    const hasEtapaAtiva = safeEtapas.some((val: any) => {
      if (!val) return false;
      const st = String(val.status || val || '').toUpperCase().trim();
      return (
        st === 'EM_ANDAMENTO' ||
        st === 'EM_PRODUCAO' ||
        st === 'IN_PROGRESS' ||
        (Boolean(val.hora_inicio || val.horaInicio) && !val.hora_fim && !val.horaFim && st !== 'CONCLUIDO')
      );
    });

    if (hasEtapaAtiva) {
      return true;
    }
  }

  // 5. Se possui postoAtivo definido ou dataInicio e não está concluída
  if (op.postoAtivo || (op.dataInicio && (statusUpper.includes('AGUARDANDO INÍCIO') || statusUpper.includes('EM_PRODUCAO')))) {
    return true;
  }

  return false;
}
