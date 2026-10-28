import {
  ProductionOrder,
  Apontamento,
  ROUTE_RULES,
  DEFAULT_ROUTE,
  RouteRule,
  CODIGOS_PADRAO_GIRO,
  CODIGOS_PADRAO_CORRER,
  CODIGOS_TRILHOS_LGT_PADRAO,
  CODIGOS_FOLHAS_PADRAO,
  CODIGOS_BATENTES_PADRAO,
  CODIGOS_ANCORAS_PADRAO
} from '../types/mes';
import {
  verificarSeExigeEmenda,
  getRotaTrilhoCorrer,
  getRotaQuadroEstante,
  getRotaPeEstanteSemPintura,
  getRotaPeEstanteComPintura,
  getRotaResistenciaPiso,
  getRotaAbrigoDoca,
  getRotaPerfilPP,
  getRotaKitGaxetaU,
  obterEtapasDaRota,
  isQuadroEstante,
  isPeEstanteSemPintura,
  isPeEstanteComPintura,
  isResistenciaPiso,
  isAbrigoDoca,
  isPerfilPP,
  isKitGaxetaU,
  isTrilhoCorrer,
  isEtapaConcluida,
  validarPostoIndustrial,
  validarPostoTrilho
} from './routeValidation';

export {
  verificarSeExigeEmenda,
  getRotaTrilhoCorrer,
  getRotaQuadroEstante,
  getRotaPeEstanteSemPintura,
  getRotaPeEstanteComPintura,
  getRotaResistenciaPiso,
  getRotaAbrigoDoca,
  getRotaPerfilPP,
  getRotaKitGaxetaU,
  obterEtapasDaRota,
  isQuadroEstante,
  isPeEstanteSemPintura,
  isPeEstanteComPintura,
  isResistenciaPiso,
  isAbrigoDoca,
  isPerfilPP,
  isKitGaxetaU,
  isTrilhoCorrer,
  isEtapaConcluida,
  validarPostoIndustrial,
  validarPostoTrilho
};

/**
 * Extrai e sanitiza com segurança a quantidade total da OP,
 * tratando variações como quantidade, qtd, qtde, quantidadePlanejada,
 * qtdTotal, quantidade_total, números com vírgula ou campos vazios/NaN.
 */
export const obterQuantidadeTotal = (op: any): number => {
  if (!op) return 1;
  const valor = op.quantidade ?? op.qtd ?? op.qtde ?? op.quantidadePlanejada ?? op.qtdTotal ?? op.quantidade_total ?? 1;
  const num = Number(String(valor).replace(',', '.').replace(/[^0-9.]/g, ''));
  if (!isNaN(num) && num > 0) return num;
  const fallbackNum = Number(String(op.quantidade_total).replace(',', '.').replace(/[^0-9.]/g, ''));
  return isNaN(fallbackNum) || fallbackNum <= 0 ? 1 : fallbackNum;
};

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

  // 1. Estantes Walk-in: Quadro Estante Walk-in
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

  // 2. Estantes Walk-in: Pé da Estante sem pintura (Serralheria T5)
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

  // 3. Estantes Walk-in: Pé da Estante com pintura (Montagem Cortina T5)
  if (isPeEstanteComPintura(opObj)) {
    const rule: RouteRule = {
      keyword: 'PE ESTANTE COM PINTURA',
      label: 'Pé de Estante (Com Pintura)',
      steps: getRotaPeEstanteComPintura(),
      badge: 'Montagem Final (Cortina)',
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

  // 3. Batentes Padrão (se o código estiver em CODIGOS_BATENTES_PADRAO)
  // Rota: "Fabricação de Batente Padrão"
  // Etapas: Corte - Guilhotina (T1) -> Dobra e Preparação (T1) -> Montagem e Injeção de Batentes (Terminal 3).
  // Badge: "Batente de Linha Padrão".
  if (code && CODIGOS_BATENTES_PADRAO.has(code)) {
    const rule: RouteRule = {
      keyword: 'BATENTE PADRAO',
      label: 'Fabricação de Batente Padrão',
      steps: ['Corte', 'Dobra', 'Preparação de Batentes', 'Injeção e Finalização Batentes'],
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

  // 5. Se for Porta Giratória
  if (norm.includes('PT GIR') || norm.includes('PORTA GIRATORIA') || norm.includes('GIRATORIA')) {
    const exigeEmenda = verificarSeExigeEmenda(desc || '');
    const montagemStep = exigeEmenda ? 'Montagem Portas Emendadas' : 'Montagem de Portas Giratória Padrão e Especial';

    if (code && CODIGOS_PADRAO_GIRO.has(code) && !exigeEmenda) {
      const rule: RouteRule = {
        keyword: 'PT GIR',
        label: 'Rota 15 - Porta Padrão Giratória',
        steps: ['Instalação de Gaxeta', montagemStep],
        badge: 'Linha Padrão (Montagem Direta)',
        isStandardLine: true
      };
      return { rule, steps: [...rule.steps], badge: rule.badge!, isStandardLine: true };
    } else {
      const rule: RouteRule = {
        keyword: 'PT GIR ESPECIAL',
        label: exigeEmenda ? 'Rota 12 - Porta Giratória Emendada' : 'Rota 12 - Porta Especial Giratória',
        steps: ['Corte', 'Dobra', 'Preparação', 'Injeção', 'Instalação de Gaxeta', montagemStep],
        badge: exigeEmenda ? 'Porta Emendada (Montagem T3)' : 'Especial sob Medida (Fabricação Completa)',
        isStandardLine: false
      };
      return { rule, steps: [...rule.steps], badge: rule.badge!, isStandardLine: false };
    }
  }

  // 6. Se for Porta de Correr
  if (norm.includes('PT COR') || norm.includes('PORTA CORRER') || norm.includes('PORTA DE CORRER')) {
    const exigeEmenda = verificarSeExigeEmenda(desc || '');
    const montagemStep = exigeEmenda ? 'Montagem Portas Emendadas' : 'Montagem Portas de Correr Padrão e Especial';

    if (code && CODIGOS_PADRAO_CORRER.has(code) && !exigeEmenda) {
      const rule: RouteRule = {
        keyword: 'PT COR',
        label: 'Rota 16 - Porta Padrão Correr',
        steps: [montagemStep],
        badge: 'Linha Padrão (Montagem Direta)',
        isStandardLine: true
      };
      return { rule, steps: [...rule.steps], badge: rule.badge!, isStandardLine: true };
    } else {
      const rule: RouteRule = {
        keyword: 'PT COR ESPECIAL',
        label: exigeEmenda ? 'Rota 13/14 - Porta de Correr Emendada' : 'Rota 13/14 - Porta Especial de Correr',
        steps: ['Corte', 'Dobra', 'Preparação', 'Injeção', montagemStep],
        badge: exigeEmenda ? 'Porta Emendada (Montagem T3)' : 'Especial sob Medida (Fabricação Completa)',
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
  input: string | { descricao: string; codigo?: string; requer_solda?: boolean; requer_laser?: boolean },
  explicitCodigo?: string
): { rule: RouteRule; steps: string[]; badge: string; isStandardLine: boolean } {
  const resolved = resolveBaseRoute(input, explicitCodigo);
  const requerLaser = typeof input === 'object' && input !== null && Boolean(input.requer_laser);

  // Define as etapas oficiais dinâmicas a partir do gerador centralizado por produto
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

  if (normStep === 'CORTE' && (normSector.includes('CORTE') || normSector.includes('GUILHOTINA'))) {
    return true;
  }

  if (normStep === 'DOBRA' && normSector.includes('DOBRA')) {
    return true;
  }

  if (normStep.includes('LASER') && normSector.includes('LASER')) {
    return true;
  }

  // Preparação de Batentes (Terminal 3)
  if (normStep.includes('PREPARACAO') && normStep.includes('BATENTE')) {
    return normSector.includes('PREPARACAO') && normSector.includes('BATENTE');
  }

  // Injeção e Finalização Batentes (Terminal 3)
  if ((normStep.includes('INJECAO') || normStep.includes('FINALIZACAO')) && normStep.includes('BATENTE')) {
    return (normSector.includes('INJECAO') || normSector.includes('FINALIZACAO')) && normSector.includes('BATENTE');
  }

  // Compatibilidade com setor antigo: Montagem e Injeção de Batentes
  if (normStep.includes('MONTAGEM E INJECAO DE BATENTES')) {
    return normSector.includes('BATENTE');
  }

  // Preparação de Folhas / Geral (Terminal 2) - NUNCA deve casar com setor de Dobra (Terminal 1)
  if (normStep === 'PREPARACAO' && normSector.includes('PREPARACAO') && !normSector.includes('DOBRA') && !normSector.includes('VAI VEM') && !normSector.includes('BATENTE')) {
    return true;
  }

  if (normStep === 'PREPARACAO VAI VEM') {
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

  if (normStep.includes('MONTAGEM OFFICE DOOR') && normSector.includes('OFFICE DOOR')) {
    return true;
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

  if (normStep === 'FINALIZACAO VAI VEM' || normStep.includes('FINALIZACAO VAI VEM') || normStep.includes('VAI VEM')) {
    if (normSector.includes('VAI VEM') && !normSector.includes('PREPARACAO')) return true;
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
  for (const step of routeSteps) {
    if (doesSectorMatchStep(sector, step)) {
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
  const normA = normalizeText(stepA);
  const normB = normalizeText(stepB);
  if (normA === normB) return true;

  // Laser vs Laser CNC
  if (normA.includes('LASER') && normB.includes('LASER')) return true;

  // Corte vs Corte - Guilhotina
  if (normA.includes('CORTE') && normB.includes('CORTE')) return true;

  // Batentes
  if (normA.includes('BATENTE') && normB.includes('BATENTE')) {
    if (normA.includes('PREPARACAO') && normB.includes('PREPARACAO')) return true;
    if ((normA.includes('INJECAO') || normA.includes('FINALIZACAO')) && (normB.includes('INJECAO') || normB.includes('FINALIZACAO'))) return true;
    return false;
  }

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

  // Vai-Vem
  if (normA.includes('VAI VEM') && normB.includes('VAI VEM')) {
    if (normA.includes('PREPARACAO') && normB.includes('PREPARACAO')) return true;
    if ((normA.includes('MONTAGEM') || normA.includes('FINALIZACAO')) && (normB.includes('MONTAGEM') || normB.includes('FINALIZACAO'))) return true;
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
  const { steps } = getRouteForOp(order);
  const total = obterQuantidadeTotal(order);
  const currentEtapas = { ...(order.etapas || {}) };

  steps.forEach((step) => {
    const stepApontamentos = apontamentos.filter((a) => {
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

    const existingKey = Object.keys(currentEtapas).find((k) => matchStepName(k, step));
    const existing = existingKey ? currentEtapas[existingKey] : undefined;

    if (!existing) {
      if (totalFinished >= total) {
        currentEtapas[step] = { status: 'CONCLUIDO', concluidas: totalFinished, total };
      } else if (totalActive > 0) {
        currentEtapas[step] = { status: 'EM_PRODUCAO', concluidas: totalFinished, total };
      } else {
        currentEtapas[step] = { status: 'PENDENTE', concluidas: 0, total };
      }
    } else {
      // Se estava marcado como CONCLUIDO mas tem 0 apontamentos reais desta etapa, reverte para PENDENTE (auto-correção)
      if (existing.status === 'CONCLUIDO' && totalFinished === 0 && stepApontamentos.length === 0) {
        currentEtapas[step] = { status: 'PENDENTE', concluidas: 0, total };
      } else {
        currentEtapas[step] = {
          ...existing,
          total: existing.total || total
        };
      }
    }
  });

  return {
    ...order,
    etapas: currentEtapas
  };
}

/**
 * Determina se a OP / Etapa deve ser apontada em Lote Completo ou Peça a Peça (Unitário)
 */
export function isBatchTracking(
  order: ProductionOrder | { descricao: string; codigo?: string },
  sector?: string | null
): boolean {
  const desc = typeof order === 'object' && order !== null ? order.descricao : String(order || '');
  const norm = normalizeText(desc || '');
  const code = extractProductCode(order);
  const secNorm = normalizeText(sector || '');

  // 1. Manutenção do Modo Unitário (Peça a Peça) EXCLUSIVAMENTE para portas completas montadas:
  // - Portas Giratórias (nos setores de Instalação de Gaxeta e Montagem Giratória)
  const isPortaGiro = norm.includes('PT GIR') || norm.includes('PORTA GIRATORIA') || (norm.includes('GIRATORIA') && !norm.includes('BAT') && !norm.includes('FOLHA'));
  if (isPortaGiro && (secNorm.includes('gaxeta') || secNorm.includes('girat'))) {
    return false;
  }

  // Produtos Especiais Industriais são apontados em Lote Completo:
  // - Resistência de Piso e Kit Gaxeta U (mesmo apontados no setor Montagem Portas Emendadas)
  if (isResistenciaPiso(order) || isKitGaxetaU(order)) {
    return true;
  }
  // - Estantes Walk-in, Abrigo de Doca e Perfis PP
  if (isQuadroEstante(order) || isPeEstanteSemPintura(order) || isPeEstanteComPintura(order) || isAbrigoDoca(order) || isPerfilPP(order)) {
    return true;
  }

  // - Portas de Correr e Portas Emendadas (nos setores de Montagem)
  const isTrilho = (code && code.startsWith('028.')) || (code && CODIGOS_TRILHOS_LGT_PADRAO.has(code)) || norm.includes('TRILHO');
  const isPortaCorrer = !isTrilho && (norm.includes('PT COR') || norm.includes('PORTA CORRER') || norm.includes('PORTA DE CORRER'));
  if (isPortaCorrer && (secNorm.includes('emendad') || secNorm.includes('correr'))) {
    return false;
  }
  if (secNorm.includes('emendad')) {
    return false;
  }

  // - Portas Vai-Vem (nos setores de Montagem / Finalização Vai-Vem)
  const isVaiVem = norm.includes('PT VAI VEM') || norm.includes('VAI VEM') || norm.includes('VV');
  if (isVaiVem && (secNorm.includes('finalizacao') || secNorm.includes('montagem'))) {
    return false;
  }

  // 2. Definição das Categorias de Apontamento em Lote / OP Completa:
  // - Folhas Padrão (código em CODIGOS_FOLHAS_PADRAO ou descrição FOLHA)
  if ((code && CODIGOS_FOLHAS_PADRAO.has(code)) || norm.includes('FOLHA')) {
    return true;
  }

  // - Batentes Padrão (código em CODIGOS_BATENTES_PADRAO ou descrição BAT) ou setores de Batentes / Laser
  if ((code && CODIGOS_BATENTES_PADRAO.has(code)) || norm.includes('BAT') || secNorm.includes('batente') || secNorm.includes('laser')) {
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
  apontamentos: Apontamento[],
  routeSteps: string[]
): Record<string, StepStatus> {
  const result: Record<string, StepStatus> = {};
  const total = obterQuantidadeTotal(op);
  const synchronizedOp = initOrSyncOrderEtapas(op, apontamentos);
  const etapas = synchronizedOp.etapas || {};

  routeSteps.forEach((step, index) => {
    // Apontamentos desta etapa (validação estrita por etapa_rota/etapaRota ou fallback de setor seguro)
    const stepApontamentos = apontamentos.filter(a => {
      if (a.op_numero !== op.op_numero && a.op !== op.op_numero) return false;
      const aptEtapa = a.etapa_rota || a.etapaRota;
      if (aptEtapa) {
        return matchStepName(aptEtapa, step);
      }
      return doesSectorMatchStep(a.setorFisico || a.setor, step);
    });

    const activeBatch = stepApontamentos.find(a => (a.is_lote || a.unidade_numero === 0) && a.status === 'EM_ANDAMENTO');
    const finishedBatch = stepApontamentos.find(a => (a.is_lote || a.unidade_numero === 0) && a.status === 'FINALIZADO');

    const finished = stepApontamentos.filter(a => a.status === 'FINALIZADO' && !a.is_lote && a.unidade_numero > 0);
    const active = stepApontamentos.filter(a => a.status === 'EM_ANDAMENTO' && !a.is_lote && a.unidade_numero > 0);

    let finalizadasCount = finished.length;
    if (finishedBatch) {
      finalizadasCount = Math.max(finalizadasCount, finishedBatch.quantidade_lote || total);
    }

    let emAndamentoCount = active.length;
    if (activeBatch) {
      emAndamentoCount = Math.max(emAndamentoCount, activeBatch.quantidade_lote || total);
    }

    // Consulta estado individualizado da etapa no objeto da OP
    const etapaStateKey = Object.keys(etapas).find((k) => matchStepName(k, step));
    const etapaState = etapaStateKey ? etapas[etapaStateKey] : undefined;
    if (etapaState) {
      if (etapaState.status === 'CONCLUIDO') {
        finalizadasCount = Math.max(finalizadasCount, etapaState.concluidas || total);
      } else if (etapaState.status === 'PENDENTE' && !finishedBatch && finished.length === 0) {
        finalizadasCount = 0;
      }
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
      const previousStep = routeSteps[index - 1];
      prevName = previousStep;

      const prevApontamentos = apontamentos.filter(a => {
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
      }
      prevFinalizadas = prevFinishedCount;

      if (isBatch) {
        if (prevFinishedCount === 0) {
          canStart = false;
          blockingReason = `Aguardando término do lote no setor anterior (${previousStep})`;
        } else {
          canStart = true;
        }
      } else {
        if (prevFinishedCount < nextUnit) {
          canStart = false;
          blockingReason = `Aguardando etapa anterior`;
        } else {
          canStart = true;
        }
      }
    }

    result[step] = {
      step,
      stepIndex: index,
      isFirst: index === 0 ? 1 : 0,
      totalQtd: total,
      finalizadas: finalizadasCount,
      emAndamento: emAndamentoCount,
      activeApontamentos: activeBatch ? [activeBatch, ...active] : active,
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
