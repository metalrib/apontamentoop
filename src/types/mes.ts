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
    label: "Portas Giratórias e Finalização Vai Vem",
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

// Códigos Padrão de Linha (Exclusivamente Chapa Branca - Portas de Inox caem na rota Especial Completa)
export const CODIGOS_PADRAO_GIRO = new Set([
  // Chapa Branca Resfriado (36)
  '001.0100', '001.0101', '001.0102', '001.0103', '001.0104', '001.0105', '001.0106', '001.0107',
  '001.0108', '001.0109', '001.0110', '001.0111', '001.0112', '001.0113', '001.0114', '001.0115',
  '001.0116', '001.0117', '001.0118', '001.0119', '001.0120', '001.0121', '001.0122', '001.0123',
  '001.0124', '001.0125', '001.0126', '001.0127', '001.0128', '001.0129', '001.0130', '001.0131',
  '001.0135', '001.0136', '001.0137', '001.0138',

  // Chapa Branca Congelado (36)
  '003.0100', '003.0101', '003.0102', '003.0103', '003.0104', '003.0105', '003.0106', '003.0107',
  '003.0108', '003.0109', '003.0110', '003.0111', '003.0112', '003.0113', '003.0114', '003.0115',
  '003.0116', '003.0117', '003.0118', '003.0119', '003.0120', '003.0121', '003.0122', '003.0123',
  '003.0124', '003.0125', '003.0126', '003.0127', '003.0128', '003.0129', '003.0130', '003.0131',
  '003.0135', '003.0136', '003.0137', '003.0138'
]);

export const CODIGOS_PADRAO_CORRER = new Set([
  // Chapa Branca Resfriado (12)
  '005.0100', '005.0101', '005.0102', '005.0103', '005.0104', '005.0105',
  '005.0106', '005.0107', '005.0108', '005.0109', '005.0110', '005.0111',

  // Chapa Branca Congelado (12)
  '007.0100', '007.0101', '007.0102', '007.0103', '007.0104', '007.0105',
  '007.0106', '007.0107', '007.0108', '007.0109', '007.0110', '007.0111'
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
  // Rota 15 - Porta Padrão Giratória (Apenas Chapa Branca Padrão - Terminal 4)
  {
    keyword: "PT GIR",
    label: "Rota 15 - Porta Padrão Giratória",
    steps: ["Instalação de Gaxeta", "Montagem de Portas Giratória"],
    badge: "Linha Padrão (Montagem Direta)",
    isStandardLine: true
  },
  // Rota 12 - Porta Especial Giratória (Inox ou Medida Especial - T1 -> T2 -> T4)
  {
    keyword: "PT GIR ESPECIAL",
    label: "Rota 12 - Porta Especial Giratória",
    steps: ["Corte", "Dobra", "Preparação", "Injeção", "Instalação de Gaxeta", "Montagem de Portas Giratória"],
    badge: "Especial sob Medida (Fabricação Completa)",
    isStandardLine: false
  },
  // Rota 16 - Porta Padrão Correr (Apenas Chapa Branca Padrão - Terminal 3)
  {
    keyword: "PT COR",
    label: "Rota 16 - Porta Padrão Correr",
    steps: ["Montagem de Portas Emendadas"],
    badge: "Linha Padrão (Montagem Direta)",
    isStandardLine: true
  },
  // Rota 13/14 - Porta Especial de Correr (Inox ou Medida Especial - T1 -> T2 -> T3)
  {
    keyword: "PT COR ESPECIAL",
    label: "Rota 13/14 - Porta Especial de Correr",
    steps: ["Corte", "Dobra", "Preparação", "Injeção", "Montagem de Portas Emendadas"],
    badge: "Especial sob Medida (Fabricação Completa)",
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
    steps: ["Corte", "Preparação Vai Vem", "Injeção", "Router", "Finalização Vai Vem"]
  },
  {
    keyword: "TRILHO",
    label: "Trilho Porta de Correr (Corte e Montagem)",
    steps: ["Montagem de Portas Emendadas"]
  },
  {
    keyword: "CORTINA",
    label: "Cortina de PVC",
    steps: ["Cortina"]
  }
];

export const DEFAULT_ROUTE = ["Corte", "Dobra", "Preparação", "Injeção"];

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
  descricao: string;              // ex: BAT GIRO 600A X 600L 4BAT C/ RESIST
  codigo?: string;                // ex: 020.0033
  quantidade_total: number;       // ex: 4
  quantidade?: number;            // alias de quantidade
  quantidade_m2?: number;         // ex: 6.60 (quando em m²)
  qtde_produzida?: number;        // ex: 0
  lote: string;                   // ex: Lote / Ordem
  data_entrega?: string;          // ex: 10/09/2026
  status_nomus?: string;          // ex: Requisitada totalmente, Liberada, etc.
  status_fabrica?: FactoryStatus; // ex: Produzindo Hoje, Falta Injetar, Atrasada, etc.
  observacao?: string;            // ex: Observações
  unidade_medida?: string;        // ex: PC ou M²
  data_criacao?: string;
  cliente?: string;
  status: "PLANEJADA" | "EM_PRODUCAO" | "FINALIZADA";
  favorita?: boolean;
  pausada?: boolean;
  requer_solda?: boolean; // Inclusão sob demanda de Solda e Montagem (Terminal 5) para Âncoras
  requer_laser?: boolean; // Inclusão sob demanda de Laser CNC no Terminal 1 antes da Dobra
  etapas?: Record<string, OpEtapaState>; // Estado individual isolado de cada etapa da rota
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
  T1: ['Corte - Guilhotina', 'Dobra e Preparação', 'Laser'],
  T2: ['Preparação', 'Injetora de folhas'],
  T3: ['Preparação de Batentes', 'Injeção e Finalização Batentes', 'Montagem Office Door', 'Montagem de Portas Emendadas'],
  T4: ['Instalação de Gaxeta', 'Montagem de Portas Giratórias', 'Finalização Vai Vem'],
  T5: ['Elétrica', 'Router', 'Solda e Montagem', 'Preparação Vai Vem', 'Cortina']
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
