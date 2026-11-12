/**
 * MES Chão de Fábrica - Definições de Tipos e Constantes
 */

export interface TerminalConfig {
  id: number;
  name: string;
  label: string;
  sectors: string[];
}

import { POSTOS_POR_TERMINAL } from '../data/terminais';

export { POSTOS_POR_TERMINAL };

export const TERMINALS: TerminalConfig[] = [
  {
    id: 1,
    name: "Terminal 1",
    label: "Corte, Dobra e Laser",
    sectors: POSTOS_POR_TERMINAL.T1
  },
  {
    id: 2,
    name: "Terminal 2",
    label: "Preparação e Injetora de folhas",
    sectors: POSTOS_POR_TERMINAL.T2
  },
  {
    id: 3,
    name: "Terminal 3",
    label: "Batentes e Portas Office/Emendadas",
    sectors: POSTOS_POR_TERMINAL.T3
  },
  {
    id: 4,
    name: "Terminal 4",
    label: "Portas Giratórias e Montagem Porta Vai-Vem",
    sectors: POSTOS_POR_TERMINAL.T4
  },
  {
    id: 5,
    name: "Terminal 5",
    label: "Elétrica, Router, Solda e Acabamentos",
    sectors: POSTOS_POR_TERMINAL.T5
  }
];

export interface RouteRule {
  keyword: string;
  label: string;
  steps: string[];
  badge?: string;
  isStandardLine?: boolean;
}

export const normalizarCodigo = (c: string) => (c || '').replace(/\D/g, '');

// Tabela oficial de CÓDIGOS DE PORTAS GIRATÓRIAS PADRÃO (WHITELIST OFICIAL METALRIB)
// Portas Giratórias Resfriados (001) e Congelados (003) da Linha Padrão Oficial Metalrib
export const CODIGOS_PORTAS_GIRO_PADRAO = new Set([
  // PORTAS GIRATÓRIAS RESFRIADOS (001)
  '001.0100', '001.0101', '001.0102', '001.0103', '001.0104', '001.0105',
  '001.0106', '001.0107', '001.0108', '001.0109', '001.0110', '001.0111',
  '001.0112', '001.0113', '001.0114', '001.0115', '001.0116', '001.0117',
  '001.0118', '001.0119', '001.0120', '001.0121', '001.0122', '001.0123',
  '001.0124', '001.0125', '001.0126', '001.0127', '001.0128', '001.0129',
  '001.0130', '001.0131', '001.0132', '001.0134', '001.0135', '001.0136',
  '001.0137', '001.0138',

  // PORTAS GIRATÓRIAS CONGELADOS (003)
  '003.0100', '003.0101', '003.0102', '003.0103', '003.0104', '003.0105',
  '003.0106', '003.0107', '003.0108', '003.0109', '003.0110', '003.0111',
  '003.0112', '003.0113', '003.0114', '003.0115', '003.0116', '003.0117',
  '003.0118', '003.0119', '003.0120', '003.0121', '003.0122', '003.0123',
  '003.0124', '003.0125', '003.0126', '003.0127', '003.0128', '003.0129',
  '003.0130', '003.0131', '003.0132', '003.0134', '003.0135', '003.0136',
  '003.0137', '003.0138',

  // Versões normalizadas sem pontos (para checagens com normalizarCodigo)
  '0010100', '0010101', '0010102', '0010103', '0010104', '0010105',
  '0010106', '0010107', '0010108', '0010109', '0010110', '0010111',
  '0010112', '0010113', '0010114', '0010115', '0010116', '0010117',
  '0010118', '0010119', '0010120', '0010121', '0010122', '0010123',
  '0010124', '0010125', '0010126', '0010127', '0010128', '0010129',
  '0010130', '0010131', '0010132', '0010134', '0010135', '0010136',
  '0010137', '0010138',
  '0030100', '0030101', '0030102', '0030103', '0030104', '0030105',
  '0030106', '0030107', '0030108', '0030109', '0030110', '0030111',
  '0030112', '0030113', '0030114', '0030115', '0030116', '0030117',
  '0030118', '0030119', '0030120', '0030121', '0030122', '0030123',
  '0030124', '0030125', '0030126', '0030127', '0030128', '0030129',
  '0030130', '0030131', '0030132', '0030134', '0030135', '0030136',
  '0030137', '0030138'
]);

// REGRA OFICIAL DE CATÁLOGO (WHITELIST FECHADA DE PORTAS DE CORRER PADRÃO: 0100 A 0111)
export const CODIGOS_CORRER_PADRAO = new Set([
  // 1. Resfriadas (005.*)
  '005.0100', '005.0101', '005.0102', '005.0103', '005.0104',
  '005.0105', '005.0106', '005.0107', '005.0110', '005.0111',
  // 2. Congeladas (007.*)
  '007.0100', '007.0101', '007.0102', '007.0103', '007.0104',
  '007.0105', '007.0106', '007.0107', '007.0108', '007.0109',
  '007.0110', '007.0111'
]);

// Set completo incluindo versões normalizadas sem ponto para match resiliente
export const CODIGOS_PORTAS_CORRER_PADRAO = new Set([
  ...CODIGOS_CORRER_PADRAO,
  // Versões normalizadas sem pontos (005)
  '0050100', '0050101', '0050102', '0050103', '0050104',
  '0050105', '0050106', '0050107', '0050110', '0050111',
  // Versões normalizadas sem pontos (007)
  '0070100', '0070101', '0070102', '0070103', '0070104',
  '0070105', '0070106', '0070107', '0070108', '0070109',
  '0070110', '0070111'
]);

/**
 * Função de Classificação Oficial de Porta de Correr:
 * Restringe rota direta de 1 etapa estritamente à whitelist fechada de catálogo 0100 a 0111.
 * Todo o restante é Especial Sob Medida com esteira completa de 5 etapas.
 */
export const classificarPortaCorrer = (codigo: string, descricao: string) => {
  const codLimpo = String(codigo || '').trim();
  const codSemPontos = codLimpo.replace(/[-_.\s]/g, '');
  const descLimpa = String(descricao || '').toUpperCase();

  // 1. Se for porta de emenda
  if (descLimpa.includes('EMENDA') || codLimpo.startsWith('029.') || codLimpo.startsWith('025.')) {
    return { tipo: 'EMENDA', rota: 'ROTA_EMENDA' };
  }

  // 2. Se pertencer à lista fechada de catálogo padrão (0100 a 0111):
  if (CODIGOS_CORRER_PADRAO.has(codLimpo) || CODIGOS_PORTAS_CORRER_PADRAO.has(codSemPontos)) {
    return {
      tipo: 'Porta de Correr Padrão (Montagem Final)',
      tipoOrdem: 'Porta de Correr Padrão (Montagem Final)',
      etapas: [
        {
          nome: "Montagem Portas de Correr Padrão e Especial",
          ordem: 1,
          status: "pendente",
          quantidadeProduzida: 0,
          total: 1
        }
      ]
    };
  }

  // 3. Todo o restante é Especial Sob Medida (Fabricação Completa com Corte, Dobra, Injeção...):
  return {
    tipo: 'Especial Sob Medida (Fabricação Completa)',
    tipoOrdem: 'Especial Sob Medida (Fabricação Completa)',
    rota: 'FABRICACAO_COMPLETA'
  };
};

// Função validadora de portas de correr padrão: RESTRITA À WHITELIST FECHADA DE CATÁLOGO (0100 A 0111)
export const isPortaCorrerPadrao = (codigo?: string, descricao?: string): boolean => {
  const codLimpo = String(codigo || '').trim();
  const codSemPontos = codLimpo.replace(/[-_.\s]/g, '');
  const descLimpa = String(descricao || '').toUpperCase();

  // 1. Excluir portas de emenda (mantêm rota dedicada de emenda)
  if (descLimpa.includes('EMENDA') || descLimpa.includes('PORTAS EMENDA') || codLimpo.startsWith('029.') || codLimpo.startsWith('025.')) {
    return false;
  }

  // 2. Se contiver termos de porta especial / inox / sob medida, NÃO é padrão
  if (
    descLimpa.includes('ESPECIAL') ||
    descLimpa.includes('ESP') ||
    descLimpa.includes('INOX') ||
    descLimpa.includes('I304') ||
    descLimpa.includes('I430') ||
    codLimpo.startsWith('006.') ||
    codLimpo.startsWith('008.')
  ) {
    return false;
  }

  // 3. Whitelist FECHADA no Set oficial de catálogo padrão (0100 a 0111):
  if (
    CODIGOS_CORRER_PADRAO.has(codLimpo) ||
    CODIGOS_PORTAS_CORRER_PADRAO.has(codLimpo) ||
    CODIGOS_PORTAS_CORRER_PADRAO.has(codSemPontos)
  ) {
    return true;
  }

  // Todo o restante (como 005.0225, 007.0150, etc.) NÃO é padrão
  return false;
};

// Aliases para retrocompatibilidade em todo o sistema
export const CODIGOS_GIRATORIA_PADRAO = CODIGOS_PORTAS_GIRO_PADRAO;
export const CODIGOS_PADRAO_GIRO = CODIGOS_PORTAS_GIRO_PADRAO;
export const CODIGOS_PADRAO_CORRER = CODIGOS_PORTAS_CORRER_PADRAO;

// Trilhos LGT Alumínio (Porta de Correr)
export const CODIGOS_TRILHOS_LGT_PADRAO = new Set([
  '028.0009', '028.0010', '028.0013', '028.0014', '028.0017', 
  '028.0018', '028.0021', '028.0022', '028.0025', '028.0026'
]);

// Folhas Padrão (Giratória e Correr - 60mm e 100mm)
export const CODIGOS_FOLHAS_PADRAO = new Set([
  '020.0009', '020.0010', '020.0011', '020.0012', '020.0013', '020.0014', 
  '020.0015', '020.0016', '020.0017', '020.0018', '020.0019', '020.0020', '020.0021',
  '020.0022', '020.0023', '020.0024', '020.0025', '020.0026', '020.0027', 
  '020.0028', '020.0029', '020.0030', '020.0031'
]);

// Batentes Padrão (Giratória e Correr - 3BAT e 4BAT)
export const CODIGOS_BATENTES_PADRAO = new Set([
  '020.0032', '020.0033', '020.0034', '020.0035', '020.0036', '020.0037', 
  '020.0038', '020.0039', '020.0040', '020.0041', '020.0042', '020.0043', 
  '020.0044', '020.0045', '020.0046', '020.0047',
  '020.0048', '020.0049', '020.0050', '020.0051', '020.0052', '020.0053', 
  '020.0054', '020.0055', '020.0056', '020.0057'
]);

// Âncoras Padrão
export const CODIGOS_ANCORAS_PADRAO = new Set([
  '021.0001', '021.0002', '021.0003', '021.0004', '021.0005',
  '021.0006', '021.0007', '021.0008', '021.0009', '021.0010',
  '021.0037', '021.0038', '021.0049'
]);

// -------------------------------------------------------------
// MAPEAMENTO AUTOMÁTICO DE ROTAS POR CÓDIGO E DESCRIÇÃO NOMUS
// -------------------------------------------------------------

// A) ROTA EXCLUSIVA DE LASER (["Laser"]):
// - 021.0037 - ANCORA REBITE ROSCA BAT GIRO 50X95
// - 021.0038 - ANCORA REBITE ROSCA BAT CORRER 70X115
// - 024.0321 - PENDURAL INOX P/ CORTINA 300MM (290 X 38)
// - 024.0320 - PENDURAL INOX P/ CORTINA 300MM (290 X 19)
// - 024.0020 - PENDURAL INOX P/ CORTINA 200MM (190 X 38)
// - 024.0019 - PENDURAL INOX P/ CORTINA 200MM (190 X 19)
// - 021.0049 - ANCORA VAI VEM ALVENARIA 200 X 100 X 2,65MM
export const CODIGOS_ROTA_EXCLUSIVA_LASER = [
  '021.0037',
  '021.0038',
  '024.0321',
  '024.0320',
  '024.0020',
  '024.0019',
  '021.0049'
];

// B) ROTA LASER + DOBRA (["Laser", "Dobra"]):
// - 024.0022 - TRILHO INOX 1.200MM P/ CORTINA
// - 024.0021 - TRILHO INOX 1.000MM P/ CORTINA
export const CODIGOS_ROTA_LASER_DOBRA = [
  '024.0022',
  '024.0021'
];

// C) ROTA EXCLUSIVA DE ROUTER (["Router"]):
// - 027.0006 - VISOR POLICARBONATO 500 X 340 X 3MM
export const CODIGOS_ROTA_EXCLUSIVA_ROUTER = [
  '027.0006'
];

// Sets de consulta rápida normalizados (com e sem pontuação)
export const SET_CODIGOS_ROTA_EXCLUSIVA_LASER = new Set([
  ...CODIGOS_ROTA_EXCLUSIVA_LASER,
  ...CODIGOS_ROTA_EXCLUSIVA_LASER.map(c => c.replace(/\D/g, ''))
]);

export const SET_CODIGOS_ROTA_LASER_DOBRA = new Set([
  ...CODIGOS_ROTA_LASER_DOBRA,
  ...CODIGOS_ROTA_LASER_DOBRA.map(c => c.replace(/\D/g, ''))
]);

export const SET_CODIGOS_ROTA_EXCLUSIVA_ROUTER = new Set([
  ...CODIGOS_ROTA_EXCLUSIVA_ROUTER,
  ...CODIGOS_ROTA_EXCLUSIVA_ROUTER.map(c => c.replace(/\D/g, ''))
]);

/**
 * Identifica se a ordem de produção pertence à rota exclusiva de Laser (["Laser"])
 */
export function isRotaExclusivaLaser(op: any): boolean {
  if (!op) return false;
  const codRaw = String(op?.codigoProduto || op?.cod || op?.codigo || op?.code || '').trim();
  const codLimpo = codRaw.replace(/\D/g, '');
  if (codRaw && (SET_CODIGOS_ROTA_EXCLUSIVA_LASER.has(codRaw) || SET_CODIGOS_ROTA_EXCLUSIVA_LASER.has(codLimpo))) {
    return true;
  }
  const desc = String(op?.descricao || op?.produto || op?.description || '').toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (desc.includes('ANCORA REBITE ROSCA') || desc.includes('ANCORA VAI VEM ALVENARIA')) {
    return true;
  }
  if (desc.includes('PENDURAL') && (desc.includes('INOX') || desc.includes('CORTINA'))) {
    return true;
  }
  return false;
}

/**
 * Identifica se a ordem de produção pertence à rota Laser + Dobra (["Laser", "Dobra"])
 */
export function isRotaLaserDobra(op: any): boolean {
  if (!op) return false;
  const codRaw = String(op?.codigoProduto || op?.cod || op?.codigo || op?.code || '').trim();
  const codLimpo = codRaw.replace(/\D/g, '');
  if (codRaw && (SET_CODIGOS_ROTA_LASER_DOBRA.has(codRaw) || SET_CODIGOS_ROTA_LASER_DOBRA.has(codLimpo))) {
    return true;
  }
  const desc = String(op?.descricao || op?.produto || op?.description || '').toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (desc.includes('TRILHO INOX') && desc.includes('CORTINA')) {
    return true;
  }
  return false;
}

/**
 * Identifica se a ordem de produção pertence à rota exclusiva de Router (["Router"])
 */
export function isRotaExclusivaRouter(op: any): boolean {
  if (!op) return false;
  const codRaw = String(op?.codigoProduto || op?.cod || op?.codigo || op?.code || '').trim();
  const codLimpo = codRaw.replace(/\D/g, '');
  if (codRaw && (SET_CODIGOS_ROTA_EXCLUSIVA_ROUTER.has(codRaw) || SET_CODIGOS_ROTA_EXCLUSIVA_ROUTER.has(codLimpo))) {
    return true;
  }
  const desc = String(op?.descricao || op?.produto || op?.description || '').toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (desc.includes('VISOR POLICARBONATO') || desc.includes('VISOR DE POLICARBONATO')) {
    return true;
  }
  return false;
}

/**
 * Identifica se a ordem de produção pertence à família Porta Office Door de Correr
 */
export function isOfficeDoorCorrer(op: any): boolean {
  if (!op) return false;
  const codRaw = String(op?.codigoProduto || op?.cod || op?.codigo || op?.code || '').trim();
  const desc = String(op?.descricao || op?.produto || op?.description || '').toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const tipo = String(op?.tipoOrdem || op?.tipo || '').toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (codRaw.startsWith('010.') || codRaw.startsWith('010') || codRaw === '010.0008') return true;
  if (desc.includes('OFFICE DOOR COR') || desc.includes('OFFICE-DOOR COR')) return true;
  if ((desc.includes('OFFICE DOOR') || desc.includes('OFFICE-DOOR') || desc.includes('OFFICE') || tipo.includes('OFFICE')) && (desc.includes('CORRER') || desc.includes('COR ') || desc.endsWith(' COR') || desc.includes('CORR') || tipo.includes('CORRER'))) {
    return true;
  }
  return false;
}

/**
 * Identifica se a ordem de produção pertence à família Porta Office Door de Giro
 */
export function isOfficeDoorGiro(op: any): boolean {
  if (!op) return false;
  if (isOfficeDoorCorrer(op)) return false;
  const codRaw = String(op?.codigoProduto || op?.cod || op?.codigo || op?.code || '').trim();
  const desc = String(op?.descricao || op?.produto || op?.description || '').toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const tipo = String(op?.tipoOrdem || op?.tipo || '').toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (codRaw.startsWith('009.') || codRaw.startsWith('009')) return true;
  if (desc.includes('OFFICE DOOR GIR') || desc.includes('OFFICE-DOOR GIR')) return true;
  if (desc.includes('OFFICE DOOR') || desc.includes('OFFICE-DOOR') || desc.includes('OFFICE') || tipo.includes('OFFICE')) {
    return true;
  }
  return false;
}

export const ROUTE_RULES: RouteRule[] = [
  // Office Door (Giro e Correr) - Prioridade Máxima sobre regras genéricas de PT GIR / PT COR
  {
    keyword: "OFFICE DOOR GIR",
    label: "Porta Office Door de Giro",
    steps: ["Instalação de Gaxeta", "Montagem de Office Door Giro"],
    badge: "Office Door Giro",
    isStandardLine: false
  },
  {
    keyword: "OFFICE DOOR COR",
    label: "Porta Office Door de Correr",
    steps: ["Corte", "Corte Alumínio", "Preparação Office Door Correr", "Injeção", "Montagem Office de Correr"],
    badge: "Office Door Correr",
    isStandardLine: false
  },
  {
    keyword: "OFFICE DOOR",
    label: "Porta Office Door de Giro",
    steps: ["Instalação de Gaxeta", "Montagem de Office Door Giro"],
    badge: "Office Door Giro",
    isStandardLine: false
  },
  // Rota 15 - Porta Giratória Padrão (Whitelist Exclusiva - Terminal 4: Montagem Direta)
  {
    keyword: "PT GIR PADRAO",
    label: "Porta Giratória Padrão",
    steps: ["Instalação de Gaxeta", "Montagem de Portas Giratória Padrão e Especial"],
    badge: "Linha Padrão (Montagem Direta)",
    isStandardLine: true
  },
  // Rota Completa - Porta Giratória Especial (Padrão para qualquer PT GIR fora da Whitelist - T1 -> T2 -> T4)
  {
    keyword: "PT GIR",
    label: "Porta Giratória Especial",
    steps: [
      "Corte",
      "Dobra",
      "Preparação de Folha",
      "Injeção",
      "Instalação de Gaxeta",
      "Montagem de Portas Giratória Padrão e Especial"
    ],
    badge: "Especial Sob Medida (Fabricação Completa)",
    isStandardLine: false
  },
  {
    keyword: "PT GIR ESPECIAL",
    label: "Porta Giratória Especial",
    steps: [
      "Corte",
      "Dobra",
      "Preparação de Folha",
      "Injeção",
      "Instalação de Gaxeta",
      "Montagem de Portas Giratória Padrão e Especial"
    ],
    badge: "Especial Sob Medida (Fabricação Completa)",
    isStandardLine: false
  },
  // Rota 16 - Porta Padrão Correr (Whitelist Exclusiva - Terminal 4: Montagem Direta)
  {
    keyword: "PT COR PADRAO",
    label: "Porta de Correr Padrão",
    steps: ["Montagem Portas de Correr Padrão e Especial"],
    badge: "Porta de Correr Padrão (Montagem Final)",
    isStandardLine: true
  },
  // Rota Completa - Porta Especial de Correr / Sob Medida (Padrão para qualquer PT COR fora da Whitelist)
  {
    keyword: "PT COR",
    label: "Porta de Correr Especial",
    steps: ["Corte", "Dobra", "Preparação de Folha", "Injeção", "Montagem Portas de Correr Padrão e Especial"],
    badge: "Especial Sob Medida (Fabricação Completa)",
    isStandardLine: false
  },
  {
    keyword: "PT COR ESPECIAL",
    label: "Porta de Correr Especial",
    steps: ["Corte", "Dobra", "Preparação de Folha", "Injeção", "Montagem Portas de Correr Padrão e Especial"],
    badge: "Especial Sob Medida (Fabricação Completa)",
    isStandardLine: false
  },
  // Porta Emendada (Dimensões Excedentes ou Modelo Emendado)
  {
    keyword: "PT EMENDADA",
    label: "Porta Emendada (Correr/Giro)",
    steps: ["Corte", "Dobra", "Preparação de Folha", "Injeção", "Montagem Portas de Correr Padrão e Especial"],
    badge: "Porta Emendada",
    isStandardLine: false
  },
  {
    keyword: "FOLHA",
    label: "Folha Standard / Isotérmica",
    steps: ["Corte", "Laser", "Dobra", "Preparação", "Injeção"]
  },
  {
    keyword: "BAT",
    label: "Batente",
    steps: ["Corte", "Dobra", "Preparação de Batentes", "Injeção e Finalização Batentes"]
  },
  {
    keyword: "ANCORA",
    label: "Âncora / Fixação",
    steps: ["Corte", "Laser", "Dobra", "Solda e Montagem"]
  },
  {
    keyword: "PT VAI VEM",
    label: "Porta Vai Vem",
    steps: ["Corte", "Corte Alumínio", "Preparação Vai Vem", "Injeção", "Montagem Porta Vai-Vem"]
  },
  {
    keyword: "TRILHO",
    label: "Trilho Porta de Correr (Corte e Montagem)",
    steps: ["Corte de Trilho p/ Porta Correr", "Montagem de Trilho p/ Porta Correr"]
  },
  {
    keyword: "ESTANTE COMPLETA",
    label: "Estante Walk-in Completa",
    steps: ["Montagem Estante"],
    badge: "Estante Walk-in (Montagem T5)"
  },
  {
    keyword: "QUADRO ESTANTE",
    label: "Quadro Estante Walk-in",
    steps: ["Laser", "Dobra", "Solda", "Montagem Estante"],
    badge: "Estante Walk-in"
  },
  {
    keyword: "PE ESTANTE SEM PINTURA",
    label: "Pé de Estante (Sem Pintura)",
    steps: ["Corte", "Solda", "Montagem Estante"],
    badge: "Serralheria Estante"
  },
  {
    keyword: "PE ESTANTE COM PINTURA",
    label: "Pé de Estante Pintado",
    steps: ["Montagem Estante"],
    badge: "Montagem Estante (T5)"
  },
  {
    keyword: "RESIST PISO",
    label: "Resistência de Piso 70W/MT",
    steps: ["Montagem Portas Emendadas"],
    badge: "Resistência de Piso (T3/T4)"
  },
  {
    keyword: "ABRIGO DOCA",
    label: "Abrigo de Doca Retrátil",
    steps: ["Corte", "Solda", "Montagem Abrigo Doca"],
    badge: "Abrigo de Doca (T5)"
  },
  {
    keyword: "PERFIL PP",
    label: "Perfil PP (Chapa)",
    steps: ["Corte", "Dobra"],
    badge: "Perfil PP (T1)"
  },
  {
    keyword: "KIT GAXETA",
    label: "Kit Gaxeta U",
    steps: ["Montagem Portas Emendadas"],
    badge: "Kit Gaxeta (T3/T4)"
  },
  {
    keyword: "CORTINA",
    label: "Cortina de PVC",
    steps: ["Cortina"]
  }
];

export const DEFAULT_ROUTE = ["Corte", "Dobra", "Injeção de Folhas", "Montagem"];

export type FactoryStatus =
  | 'Produzindo Hoje'
  | 'Falta Injetar'
  | 'Atrasada'
  | 'Falta Embalar'
  | 'Embalada'
  | 'Sinalizar Atraso'
  | 'Planejada'
  | 'Pausada';

export interface OpMessage {
  id: string;
  autor: string;
  papel?: string;
  texto: string;
  data_hora: string;
}

export interface OpOcorrencia {
  id: string;
  dataHora: string;
  operador: string;
  posto: string;
  terminal: number | string;
  descricao: string;
}

export type EtapaStatus = 'PENDENTE' | 'EM_PRODUCAO' | 'CONCLUIDO';

export interface OpEtapaState {
  status: EtapaStatus;
  concluidas: number;
  total?: number;
}

export interface ProductionOrder {
  op_numero: string;              // ex: OP 023010-01 ou 023010-01
  numero?: string;                 // ex: OP 023010-01
  numeroOP?: string;              // alias compatível com Nomus
  numeroOp?: string;              // alias compatível com Nomus
  descricao: string;              // ex: BAT GIRO 600A X 600L 4BAT C/ RESIST
  codigo?: string;                // ex: 020.0033
  codigoProduto?: string;         // alias compatível com Nomus
  quantidade_total: number;       // ex: 4
  quantidade?: number;            // alias de quantidade
  quantidadeFisica?: number;      // ex: 2 (quantidade física a produzir ajustada ou deduzida)
  quantidadeFolhas?: number;      // ex: 2 (quantidade de folhas para portas duplas)
  quantidade_folhas?: number;     // alias de quantidadeFolhas
  isDupla?: boolean;              // flag para portas duplas
  quantidade_m2?: number;         // ex: 6.60 (quando em m²)
  qtde_produzida?: number;        // ex: 0
  lote: string;                   // ex: Lote / Ordem
  data_entrega?: string;          // ex: 10/09/2026
  prazoEntrega?: string;          // alias de data_entrega
  status_nomus?: string;          // ex: Requisitada totalmente, Liberada, etc.
  statusNomus?: string;           // alias de status_nomus
  status_fabrica?: FactoryStatus; // ex: Produzindo Hoje, Falta Injetar, Atrasada, etc.
  observacao?: string;            // ex: Observações
  observacoes?: string;           // alias de observacao
  observacoesNomus?: string;      // alias Nomus
  unidade_medida?: string;        // ex: PC ou M²
  data_criacao?: string;
  criadoEm?: string;
  atualizadoPeloPcpEm?: string;
  importadoEm?: string;
  cliente?: string;
  status: "PLANEJADA" | "EM_PRODUCAO" | "FINALIZADA" | string;
  statusExecucao?: 'pendente' | 'em_andamento' | 'concluido' | string;
  emProducao?: boolean;
  postoAtivo?: string;
  ultimaAtualizacao?: string;
  data_atualizacao?: string;
  favorita?: boolean;
  pausada?: boolean;
  requer_solda?: boolean; // Inclusão sob demanda de Solda e Montagem (Terminal 5) para Âncoras
  requer_laser?: boolean; // Inclusão sob demanda de Laser CNC no Terminal 1 antes da Dobra
  requerLaser?: boolean; // Alias compatível
  encaminhar_router?: boolean; // Inclusão condicional da etapa Router após Injeção para Vai-Vem e Office Door
  requer_router?: boolean; // Alias de encaminhar_router
  requerRouter?: boolean; // Alias compatível
  etapas?: string[] | Record<string, OpEtapaState>; // Lista de etapas oficiais ou estado individual isolado de cada etapa
  rota?: string[];
  familia?: string;
  tipoMontagem?: string;
  tipoOrdem?: string; // ex: "Porta de Correr Padrão (Montagem Final)" ou "Especial Sob Medida (Fabricação Completa)"
  statusAtual?: string;
  etapaAtual?: string;
  statusEtapa?: string;
  cod?: string;
  produto?: string;
  pecas?: any[];
  apontamentos?: Record<string, any> | any[];
  operadores?: any;
  operadorAtual?: string;
  colaboradorIniciou?: string;
  iniciadoEm?: string;
  dataInicio?: string;
  concluidoEm?: string;
  dataConclusao?: string;
  postoSelecionado?: string;
  progressoPostos?: Record<string, { concluido?: boolean; concluidas?: number; dataConclusao?: string }>;
  ultimo_aviso?: {
    autor: string;
    texto: string;
    data_hora: string;
  };
  mensagens?: OpMessage[];
  ocorrencias?: Record<string, OpOcorrencia> | OpOcorrencia[];
}

export interface Apontamento {
  id: string;
  op_numero: string;
  op?: string;
  unidade_numero: number;
  unidade?: string;
  modo?: "LOTE" | "UNITARIO";
  setor: string;
  setorFisico?: string;
  etapa_rota: string;
  etapaRota?: string;
  terminal_id: number;
  terminal?: string;
  operador: string;
  colaborador?: string;
  hora_inicio: string; // ISO string
  horaInicio?: string;
  hora_fim?: string;   // ISO string
  horaFim?: string;
  duracao_minutos?: number;
  duracao?: number;
  duracaoMs?: number;
  duracaoFormatada?: string;
  status: "EM_ANDAMENTO" | "FINALIZADO";
  observacao?: string;
  is_lote?: boolean;
  quantidade_lote?: number;
  quantidade_refugo?: number;
  requerRouter?: boolean;
  requer_router?: boolean;
  encaminhar_router?: boolean;
}

export interface Operator {
  id: string;
  name: string;
  nome?: string;
  initials: string;
  badge: string;
  codigo?: string;
  role: string;
  setor?: string;
  setores?: string[];
  sectors: string[];
  setoresPorTerminal?: Record<string, string[]>;
  terminais?: string[];
  especialista?: boolean;
  postos?: string[];
  familias?: string[];
  isRoaming?: boolean; // Especialistas sem setor fixo que podem passar por todos
  especialistaVolante?: boolean;
  ativo?: boolean;
}

import { colaboradores, BADGES_MAP } from '../data/colaboradores';

export { colaboradores };

const TERMINAL_SECTORS_DEFAULT_MAP: Record<string, string[]> = {
  T1: ['Corte', 'Laser', 'Dobra'],
  T2: ['Preparação de Folha', 'Injeção'],
  T3: ['Preparação de Batentes', 'Injeção e Finalização Batentes', 'Montagem Office Door', 'Montagem de Portas Emendadas'],
  T4: ['Instalação de Gaxeta', 'Montagem de Portas Giratória Padrão e Especial', 'Montagem Portas de Correr Padrão e Especial', 'Montagem Porta Vai-Vem'],
  T5: ['Corte Alumínio', 'Preparação Vai Vem', 'Router', 'Solda e Montagem', 'Montagem Estante', 'Elétrica', 'Cortina']
};

function extractInitials(nome: string): string {
  const parts = nome.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function resolveSectorsForTerminais(terminais: string[]): string[] {
  const set = new Set<string>();
  terminais.forEach((t) => {
    const list = TERMINAL_SECTORS_DEFAULT_MAP[t.toUpperCase().trim()];
    if (list) {
      list.forEach((s) => set.add(s));
    }
  });
  return Array.from(set);
}

export const OPERATORS: Operator[] = colaboradores.map((colab) => {
  const initials = extractInitials(colab.nome);
  const badge = BADGES_MAP[colab.id] || colab.id.toUpperCase();
  const role = colab.especialista
    ? `Especialista (${colab.terminais.join('/')})`
    : colab.terminais.length > 1
    ? `Operador Volante (${colab.terminais.join('/')})`
    : `Operador ${colab.terminais[0]}`;

  const setoresPorTerminal: Record<string, string[]> = {
    T1: [],
    T2: [],
    T3: [],
    T4: [],
    T5: []
  };

  colab.terminais.forEach((t) => {
    const tKey = t.toUpperCase().trim();
    const termSectors = POSTOS_POR_TERMINAL[tKey] || [];
    if (colab.setores.includes('TODOS')) {
      setoresPorTerminal[tKey] = [...termSectors];
    } else {
      setoresPorTerminal[tKey] = colab.setores.filter((s) =>
        termSectors.some((ts) => ts.toLowerCase() === s.toLowerCase())
      );
    }
  });

  return {
    id: colab.id,
    name: colab.nome,
    nome: colab.nome,
    initials,
    badge,
    codigo: badge,
    role,
    setor: colab.setores[0] || '',
    setores: [...colab.setores],
    sectors: [...colab.setores],
    setoresPorTerminal,
    terminais: [...colab.terminais],
    especialista: colab.especialista,
    isRoaming: colab.especialista && colab.terminais.length > 2,
    especialistaVolante: colab.especialista,
    ativo: true
  };
});
