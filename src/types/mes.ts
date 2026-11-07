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

// Tabela oficial de CÓDIGOS DE PORTAS GIRATÓRIAS PADRÃO (WHITELIST RESTRITIVA)
// Exclusivamente Chapa Branca Resfriado da Linha Padrão Oficial Metalrib (Família 001.01xx)
// Portas Congeladas (003.xxxx) e Especiais caem OBRIGATORIAMENTE na rota Especial Completa.
const CODIGOS_GIRATORIA_BASE = [
  '0010100', '0010101', '0010102', '0010103', '0010104', '0010105', '0010106', '0010107',
  '0010108', '0010109', '0010110', '0010111', '0010112', '0010113', '0010114', '0010115',
  '0010116', '0010117', '0010118', '0010119', '0010120', '0010121', '0010122', '0010123',
  '0010124', '0010125', '0010126', '0010127', '0010128', '0010129', '0010130', '0010131',
  '0010135', '0010136', '0010137', '0010138'
];

export const CODIGOS_GIRATORIA_PADRAO = new Set([
  ...CODIGOS_GIRATORIA_BASE,
  ...CODIGOS_GIRATORIA_BASE.map(c => `${c.slice(0, 3)}.${c.slice(3)}`)
]);

export const CODIGOS_PADRAO_GIRO = new Set([
  ...Array.from(CODIGOS_GIRATORIA_PADRAO).map(c => `${c.slice(0, 3)}.${c.slice(3)}`),
  ...Array.from(CODIGOS_GIRATORIA_PADRAO)
]);

export const CODIGOS_PADRAO_CORRER = new Set([
  // Chapa Branca Resfriado / Padrão (Família 002 e 005)
  '002.0100', '002.0101', '002.0102', '002.0103', '002.0104', '002.0105',
  '002.0106', '002.0107', '002.0108', '002.0109', '002.0110', '002.0111',
  '005.0100', '005.0101', '005.0102', '005.0103', '005.0104', '005.0105',
  '005.0106', '005.0107', '005.0108', '005.0109', '005.0110', '005.0111'
]);

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
  '021.0006', '021.0007', '021.0008', '021.0009', '021.0010'
]);

export const ROUTE_RULES: RouteRule[] = [
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
    badge: "Especial sob Medida (Fabricação Completa)",
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
    badge: "Especial sob Medida (Fabricação Completa)",
    isStandardLine: false
  },
  // Rota 16 - Porta Padrão Correr (Terminal 4)
  {
    keyword: "PT COR",
    label: "Rota 16 - Porta Padrão Correr",
    steps: ["Montagem Portas de Correr Padrão e Especial"],
    badge: "Linha Padrão (Montagem Direta)",
    isStandardLine: true
  },
  // Rota 13/14 - Porta Especial de Correr (T1 -> T2/T3 -> T4)
  {
    keyword: "PT COR ESPECIAL",
    label: "Rota 13/14 - Porta Especial de Correr",
    steps: ["Corte", "Dobra", "Preparação de Folha", "Injeção", "Montagem Portas de Correr Padrão e Especial"],
    badge: "Especial sob Medida (Fabricação Completa)",
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
    keyword: "OFFICE DOOR",
    label: "Office Door",
    steps: ["Corte", "Laser", "Dobra", "Preparação", "Injeção", "Montagem Office Door"]
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
  status: "EM_ANDAMENTO" | "FINALIZADO";
  observacao?: string;
  is_lote?: boolean;
  quantidade_lote?: number;
  quantidade_refugo?: number;
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
  T1: ['Corte', 'Dobra', 'Laser'],
  T2: ['Preparação de Folhas', 'Injeção'],
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
