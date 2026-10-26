export interface ColaboradorRaw {
  id: string;
  nome: string;
  terminais: string[];
  setores: string[];
  especialista: boolean;
}

export const colaboradores: ColaboradorRaw[] = [
  // TERMINAL 1
  { id: 'eliel', nome: 'Eliel', terminais: ['T1'], setores: ['Corte', 'Dobra'], especialista: false },
  { id: 'elionai', nome: 'Elionai', terminais: ['T1'], setores: ['Corte', 'Dobra'], especialista: false },
  { id: 'bruno_c', nome: 'Bruno Constancio', terminais: ['T1'], setores: ['Corte', 'Dobra', 'Laser'], especialista: true },
  { id: 'leonardo_c', nome: 'Leonardo Constancio', terminais: ['T1'], setores: ['Dobra'], especialista: false },
  { id: 'danielson', nome: 'Danielson', terminais: ['T1'], setores: ['Corte'], especialista: false },
  { id: 'leonardo_h', nome: 'Leonardo Henrique', terminais: ['T1', 'T2'], setores: ['Dobra', 'Preparação de Folhas'], especialista: false },

  // TERMINAL 2
  { id: 'magna', nome: 'Magna', terminais: ['T2'], setores: ['Preparação de Folhas', 'Injeção de Folhas'], especialista: false },
  { id: 'donizete', nome: 'Donizete', terminais: ['T2'], setores: ['Preparação de Folhas', 'Injeção de Folhas'], especialista: false },

  // TERMINAL 3
  { id: 'aparecido', nome: 'Aparecido', terminais: ['T3'], setores: ['Preparação de Batentes', 'Injeção e Finalização de Batentes'], especialista: false },
  { id: 'antonio_m', nome: 'Antonio Massena', terminais: ['T3'], setores: ['Preparação de Batentes', 'Injeção e Finalização de Batentes'], especialista: false },
  { id: 'salatiel', nome: 'Salatiel', terminais: ['T3'], setores: ['Preparação de Batentes', 'Injeção e Finalização de Batentes'], especialista: false },
  { id: 'yuri', nome: 'Yuri', terminais: ['T3'], setores: ['Preparação de Batentes', 'Injeção e Finalização de Batentes'], especialista: false },
  { id: 'sergio', nome: 'Sergio', terminais: ['T3'], setores: ['Preparação de Batentes', 'Injeção e Finalização de Batentes', 'Montagem Portas Emendadas'], especialista: true },
  { id: 'jose_lucas', nome: 'Jose Lucas', terminais: ['T3'], setores: ['Preparação de Batentes', 'Injeção e Finalização de Batentes'], especialista: false },
  { id: 'ademir', nome: 'Ademir', terminais: ['T3'], setores: ['Montagem Portas Emendadas'], especialista: false },
  { id: 'francisco_h', nome: 'Francisco Henrique', terminais: ['T3'], setores: ['Montagem Portas Emendadas'], especialista: false },
  { id: 'denis', nome: 'Denis', terminais: ['T3'], setores: ['Montagem Portas Emendadas'], especialista: false },
  { id: 'jonathan', nome: 'Jonathan', terminais: ['T3'], setores: ['Montagem Portas Emendadas'], especialista: false },
  { id: 'jose_aparecido', nome: 'José Aparecido', terminais: ['T3', 'T4'], setores: ['Preparação de Batentes', 'Injeção e Finalização de Batentes', 'Instalação de Gaxeta', 'Montagem de Portas Giratória Padrão e Especial'], especialista: false },
  { id: 'deilson', nome: 'Deilson', terminais: ['T3', 'T4'], setores: ['Preparação de Batentes', 'Injeção e Finalização de Batentes', 'Instalação de Gaxeta', 'Montagem de Portas Giratória Padrão e Especial'], especialista: false },

  // TERMINAL 4
  { id: 'joao_p', nome: 'João Paulo', terminais: ['T4'], setores: ['Montagem Vai Vem'], especialista: false },
  { id: 'alessandra', nome: 'Alessandra', terminais: ['T4'], setores: ['Montagem Vai Vem'], especialista: false },
  { id: 'gustavo_n', nome: 'Gustavo Naves', terminais: ['T4'], setores: ['Instalação de Gaxeta', 'Montagem de Portas Giratória Padrão e Especial'], especialista: false },
  { id: 'fabiano', nome: 'Fabiano', terminais: ['T4'], setores: ['Instalação de Gaxeta', 'Montagem de Portas Giratória Padrão e Especial'], especialista: false },
  { id: 'vinicius', nome: 'Vinicius', terminais: ['T4'], setores: ['Instalação de Gaxeta', 'Montagem de Portas Giratória Padrão e Especial'], especialista: false },
  { id: 'nalysson', nome: 'Nalysson', terminais: ['T4'], setores: ['Instalação de Gaxeta', 'Montagem de Portas Giratória Padrão e Especial'], especialista: false },

  // TERMINAL 5
  { id: 'victor', nome: 'Victor', terminais: ['T5'], setores: ['Montagem Portas de Correr Padrão e Especial'], especialista: false },
  { id: 'cristiane', nome: 'Cristiane', terminais: ['T5'], setores: ['Montagem Portas de Correr Padrão e Especial'], especialista: false },
  { id: 'marcio', nome: 'Marcio', terminais: ['T5'], setores: ['Montagem Portas de Correr Padrão e Especial'], especialista: false },
  { id: 'gabriele', nome: 'Gabriele', terminais: ['T5'], setores: ['Montagem Portas de Correr Padrão e Especial'], especialista: false },
  { id: 'yasmin', nome: 'Yasmin', terminais: ['T5'], setores: ['Montagem Portas de Correr Padrão e Especial'], especialista: false },
  { id: 'carol', nome: 'Carol', terminais: ['T5'], setores: ['Montagem Portas de Correr Padrão e Especial'], especialista: false },
  { id: 'nathan', nome: 'Nathan', terminais: ['T5'], setores: ['Solda', 'Montagem Portas de Correr Padrão e Especial'], especialista: false },
  { id: 'fabio', nome: 'Fabio', terminais: ['T5'], setores: ['Montagem Portas de Correr Padrão e Especial', 'Solda'], especialista: true },

  // ESPECIALISTA MULTI-TERMINAL
  { id: 'afonso', nome: 'Afonso', terminais: ['T1', 'T3', 'T4', 'T5'], setores: ['TODOS'], especialista: true }
];

export const BADGES_MAP: Record<string, string> = {
  eliel: 'CORTE-01',
  elionai: 'T1-01',
  bruno_c: 'ESP-T1',
  leonardo_c: 'DOB-01',
  danielson: 'DOB-02',
  leonardo_h: 'T1-T2',
  magna: 'INJ-01',
  donizete: 'INJ-02',
  aparecido: 'BAT-01',
  antonio_m: 'BAT-02',
  salatiel: 'BAT-03',
  yuri: 'BAT-04',
  sergio: 'ESP-T3',
  jose_lucas: 'OFF-01',
  ademir: 'EME-01',
  francisco_h: 'EME-02',
  denis: 'EME-03',
  jonathan: 'EME-04',
  jose_aparecido: 'T3-T4',
  deilson: 'T3-T4B',
  joao_p: 'VV-01',
  alessandra: 'VV-02',
  gustavo_n: 'GIR-01',
  fabiano: 'GIR-02',
  vinicius: 'GIR-03',
  nalysson: 'GIR-04',
  victor: 'ROU-01',
  cristiane: 'ELE-01',
  marcio: 'ELE-02',
  gabriele: 'COR-01',
  yasmin: 'PVV-01',
  carol: 'T5-01',
  fabio: 'ESP-T5',
  nathan: 'SOL-01',
  afonso: 'ESP-MULTI'
};
