/**
 * MES Chão de Fábrica - Definições de Tipos e Constantes
 */

export interface TerminalConfig {
  id: number;
  name: string;
  label: string;
  sectors: string[];
}

export const TERMINALS: TerminalConfig[] = [
  {
    id: 1,
    name: "Terminal 1",
    label: "Corte, Dobra e Laser",
    sectors: ["Corte - Guilhotina", "Dobra e Preparação", "Laser"]
  },
  {
    id: 2,
    name: "Terminal 2",
    label: "Preparação e Injetora de folhas",
    sectors: ["Preparação", "Injetora de folhas"]
  },
  {
    id: 3,
    name: "Terminal 3",
    label: "Batentes e Portas Office/Emendadas",
    sectors: [
      "Preparação de Batentes",
      "Injeção e Finalização Batentes",
      "Montagem Office Door",
      "Montagem de Portas Emendadas"
    ]
  },
  {
    id: 4,
    name: "Terminal 4",
    label: "Portas Giratórias e Finalização Vai Vem",
    sectors: ["Instalação de Gaxeta", "Montagem de Portas Giratórias", "Finalização Vai Vem"]
  },
  {
    id: 5,
    name: "Terminal 5",
    label: "Elétrica, Router, Solda e Acabamentos",
    sectors: ["Elétrica", "Router", "Solda e Montagem", "Preparação Vai Vem", "Cortina"]
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
  initials: string;
  badge: string;
  codigo?: string;
  role: string;
  setor?: string;
  setores?: string[];
  sectors: string[];
  isRoaming?: boolean; // Especialistas sem setor fixo que podem passar por todos
  especialistaVolante?: boolean;
  ativo?: boolean;
}

export const OPERATORS: Operator[] = [
  // Setor de Corte
  { id: "eliel", name: "Eliel", initials: "EL", badge: "CORTE-01", codigo: "CORTE-01", role: "Corte", setor: "Corte - Guilhotina", setores: ["Corte - Guilhotina"], sectors: ["Corte - Guilhotina"], ativo: true, especialistaVolante: false },

  // Setor de Dobra
  { id: "leonardo", name: "Leonardo", initials: "LE", badge: "DOB-01", codigo: "DOB-01", role: "Dobra / Prep. Folhas", setor: "Dobra e Preparação", setores: ["Dobra e Preparação"], sectors: ["Dobra e Preparação"], ativo: true, especialistaVolante: false },
  { id: "danielson", name: "Danielson", initials: "DA", badge: "DOB-02", codigo: "DOB-02", role: "Dobra", setor: "Dobra e Preparação", setores: ["Dobra e Preparação"], sectors: ["Dobra e Preparação"], ativo: true, especialistaVolante: false },

  // Setor de Preparação de folhas
  { id: "paulo_henrique", name: "Paulo Henrique", initials: "PH", badge: "PREP-01", codigo: "PREP-01", role: "Preparação de Folhas", setor: "Preparação de folhas", setores: ["Preparação de folhas"], sectors: ["Preparação de folhas"], ativo: true, especialistaVolante: false },

  // Setor de Injeção de folhas
  { id: "magna", name: "Magna", initials: "MA", badge: "INJ-01", codigo: "INJ-01", role: "Injeção de Folhas", setor: "Injetora de folhas", setores: ["Injetora de folhas"], sectors: ["Injetora de folhas"], ativo: true, especialistaVolante: false },
  { id: "donizete", name: "Donizete", initials: "DO", badge: "INJ-02", codigo: "INJ-02", role: "Injeção de Folhas", setor: "Injetora de folhas", setores: ["Injetora de folhas"], sectors: ["Injetora de folhas"], ativo: true, especialistaVolante: false },

  // Setores de Preparação e Injeção de Batentes (Terminal 3)
  { id: "antonio_massena", name: "Antônio Massena", initials: "AM", badge: "BAT-01", codigo: "BAT-01", role: "Preparação / Injeção Batentes", setor: "Preparação de Batentes", setores: ["Preparação de Batentes", "Injeção e Finalização Batentes"], sectors: ["Preparação de Batentes", "Injeção e Finalização Batentes"], ativo: true, especialistaVolante: false },
  { id: "antonio", name: "Antônio", initials: "AN", badge: "BAT-02", codigo: "BAT-02", role: "Preparação / Injeção Batentes", setor: "Preparação de Batentes", setores: ["Preparação de Batentes", "Injeção e Finalização Batentes"], sectors: ["Preparação de Batentes", "Injeção e Finalização Batentes"], ativo: true, especialistaVolante: false },
  { id: "aparecido", name: "Aparecido", initials: "AP", badge: "BAT-03", codigo: "BAT-03", role: "Preparação / Injeção Batentes", setor: "Preparação de Batentes", setores: ["Preparação de Batentes", "Injeção e Finalização Batentes"], sectors: ["Preparação de Batentes", "Injeção e Finalização Batentes"], ativo: true, especialistaVolante: false },
  { id: "yuri", name: "Yuri", initials: "YU", badge: "BAT-04", codigo: "BAT-04", role: "Preparação / Injeção Batentes", setor: "Preparação de Batentes", setores: ["Preparação de Batentes", "Injeção e Finalização Batentes"], sectors: ["Preparação de Batentes", "Injeção e Finalização Batentes"], ativo: true, especialistaVolante: false },

  // Setor de Office Door
  { id: "lucas", name: "Lucas", initials: "LU", badge: "OFF-01", codigo: "OFF-01", role: "Office Door", setor: "Montagem Office Door", setores: ["Montagem Office Door"], sectors: ["Montagem Office Door"], ativo: true, especialistaVolante: false },

  // Setor de Montagem porta emendada (Terminal 3 - NUNCA Terminal 4)
  { id: "ademir", name: "Ademir", initials: "AD", badge: "EME-01", codigo: "EME-01", role: "Montagem Porta Emendada", setor: "Montagem de Portas Emendadas", setores: ["Montagem de Portas Emendadas"], sectors: ["Montagem de Portas Emendadas"], isRoaming: false, especialistaVolante: false, ativo: true },
  { id: "francisco", name: "Francisco", initials: "FR", badge: "EME-02", codigo: "EME-02", role: "Montagem Porta Emendada", setor: "Montagem de Portas Emendadas", setores: ["Montagem de Portas Emendadas"], sectors: ["Montagem de Portas Emendadas"], isRoaming: false, especialistaVolante: false, ativo: true },
  { id: "denis", name: "Denis", initials: "DE", badge: "EME-03", codigo: "EME-03", role: "Montagem Porta Emendada", setor: "Montagem de Portas Emendadas", setores: ["Montagem de Portas Emendadas"], sectors: ["Montagem de Portas Emendadas"], isRoaming: false, especialistaVolante: false, ativo: true },
  { id: "jhonatan", name: "Jhonatan", initials: "JH", badge: "EME-04", codigo: "EME-04", role: "Montagem Porta Emendada", setor: "Montagem de Portas Emendadas", setores: ["Montagem de Portas Emendadas"], sectors: ["Montagem de Portas Emendadas"], isRoaming: false, especialistaVolante: false, ativo: true },
  { id: "jose_aparecido", name: "José Aparecido", initials: "JA", badge: "EME-05", codigo: "EME-05", role: "Montagem Porta Emendada", setor: "Montagem de Portas Emendadas", setores: ["Montagem de Portas Emendadas"], sectors: ["Montagem de Portas Emendadas"], isRoaming: false, especialistaVolante: false, ativo: true },
  { id: "deilson", name: "Deilson", initials: "DL", badge: "EME-06", codigo: "EME-06", role: "Montagem Porta Emendada", setor: "Montagem de Portas Emendadas", setores: ["Montagem de Portas Emendadas"], sectors: ["Montagem de Portas Emendadas"], isRoaming: false, especialistaVolante: false, ativo: true },

  // Setor de finalização de vai vem
  { id: "joao_paulo", name: "João Paulo", initials: "JP", badge: "VV-01", codigo: "VV-01", role: "Finalização Vai Vem", setor: "Finalização Vai Vem", setores: ["Finalização Vai Vem"], sectors: ["Finalização Vai Vem"], isRoaming: false, especialistaVolante: false, ativo: true },
  { id: "alessandra", name: "Alessandra", initials: "AL", badge: "VV-02", codigo: "VV-02", role: "Finalização Vai Vem", setor: "Finalização Vai Vem", setores: ["Finalização Vai Vem"], sectors: ["Finalização Vai Vem"], isRoaming: false, especialistaVolante: false, ativo: true },

  // Setor Montagem de porta Giratória
  { id: "nalysson", name: "Nalysson", initials: "NA", badge: "GIR-01", codigo: "GIR-01", role: "Montagem Porta Giratória", setor: "Montagem de Portas Giratórias", setores: ["Montagem de Portas Giratórias"], sectors: ["Montagem de Portas Giratórias"], isRoaming: false, especialistaVolante: false, ativo: true },
  { id: "vinicius", name: "Vinicius", initials: "VI", badge: "GIR-02", codigo: "GIR-02", role: "Montagem Porta Giratória", setor: "Montagem de Portas Giratórias", setores: ["Montagem de Portas Giratórias"], sectors: ["Montagem de Portas Giratórias"], isRoaming: false, especialistaVolante: false, ativo: true },
  { id: "fabiano", name: "Fabiano", initials: "FA", badge: "GIR-03", codigo: "GIR-03", role: "Montagem Porta Giratória", setor: "Montagem de Portas Giratórias", setores: ["Montagem de Portas Giratórias"], sectors: ["Montagem de Portas Giratórias"], isRoaming: false, especialistaVolante: false, ativo: true },
  { id: "gustavo_naves", name: "Gustavo Naves", initials: "GN", badge: "GIR-04", codigo: "GIR-04", role: "Montagem Porta Giratória", setor: "Montagem de Portas Giratórias", setores: ["Montagem de Portas Giratórias"], sectors: ["Montagem de Portas Giratórias"], isRoaming: false, especialistaVolante: false, ativo: true },

  // Setor de Router
  { id: "victor", name: "Victor", initials: "VC", badge: "ROU-01", codigo: "ROU-01", role: "Router", setor: "Router", setores: ["Router"], sectors: ["Router"], ativo: true, especialistaVolante: false },

  // Setor Laser & Especialistas Jr (volantes - podem passar por todos)
  { id: "afonso", name: "Afonso", initials: "AF", badge: "ESP-JR1", codigo: "ESP-JR1", role: "Especialista Jr (Todos Setores)", setor: "Laser", setores: ["Laser"], sectors: ["Laser"], isRoaming: true, especialistaVolante: true, ativo: true },
  { id: "bruno", name: "Bruno", initials: "BR", badge: "ESP-JR2", codigo: "ESP-JR2", role: "Especialista Jr (Todos Setores)", setor: "Laser", setores: ["Laser"], sectors: ["Laser"], isRoaming: true, especialistaVolante: true, ativo: true },

  // Setor Elétrica
  { id: "marcio", name: "Marcio", initials: "MC", badge: "ELE-01", codigo: "ELE-01", role: "Elétrica", setor: "Elétrica", setores: ["Elétrica"], sectors: ["Elétrica"], ativo: true, especialistaVolante: false },
  { id: "cristiane", name: "Cristiane", initials: "CR", badge: "ELE-02", codigo: "ELE-02", role: "Elétrica", setor: "Elétrica", setores: ["Elétrica"], sectors: ["Elétrica"], ativo: true, especialistaVolante: false },

  // Setor Cortina
  { id: "gabriele", name: "Gabriele", initials: "GA", badge: "COR-01", codigo: "COR-01", role: "Cortina", setor: "Cortina", setores: ["Cortina"], sectors: ["Cortina"], ativo: true, especialistaVolante: false },

  // Setor de Preparação Vai vem
  { id: "yasmin", name: "Yasmin", initials: "YA", badge: "PVV-01", codigo: "PVV-01", role: "Preparação Vai Vem", setor: "Preparação Vai Vem", setores: ["Preparação Vai Vem"], sectors: ["Preparação Vai Vem"], ativo: true, especialistaVolante: false },

  // Setor de Solda e Montagem
  { id: "fabio", name: "Fabio", initials: "FB", badge: "ESP-PL", codigo: "ESP-PL", role: "Especialista Pleno (Solda e Montagem)", setor: "Solda e Montagem", setores: ["Solda e Montagem"], sectors: ["Solda e Montagem"], ativo: true, especialistaVolante: false },
  { id: "nathan", name: "Nathan", initials: "NT", badge: "SOL-01", codigo: "SOL-01", role: "Solda e Montagem", setor: "Solda e Montagem", setores: ["Solda e Montagem"], sectors: ["Solda e Montagem"], ativo: true, especialistaVolante: false }
];
