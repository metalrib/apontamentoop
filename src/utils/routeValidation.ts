/**
 * Validação de regras dimensionais técnicas para determinação de rotas e postos de trabalho.
 * Baseada na Tabela Técnica Oficial da fábrica Metalrib.
 */

/**
 * Verifica se uma porta exige o posto "Montagem Portas Emendadas"
 * com base na matriz dimensional oficial (modelo, temperatura e limites de altura/largura).
 *
 * REGRAS DA MATRIZ (TABELA TÉCNICA):
 * A) PORTAS DE CORRER (COR / CORRER):
 *    - Largura > 1300 mm (qualquer espessura/temperatura)
 *    - Altura > 2825 mm (se Resfriados / RESF)
 *    - Altura > 2745 mm (se Congelados / CONG)
 *    - Altura > 2705 mm (se Supercongelados / SUPER / SCONG)
 *
 * B) PORTAS DE GIRO (GIR / GIRO / GIRATÓRIA):
 *    - Largura > 1350 mm (qualquer espessura/temperatura)
 *    - Altura > 2900 mm (se Resfriados / RESF)
 *    - Altura > 2820 mm (se Congelados / CONG)
 *    - Altura > 2780 mm (se Supercongelados / SUPER / SCONG)
 */
export function verificarSeExigeEmenda(descricao: string): boolean {
  if (!descricao) return false;

  const descUpper = descricao.toUpperCase().replace(/\./g, '');

  // Se já contiver termo explícito de emenda na descrição
  if (/EMENDAD[AO]|EME-|\bEME\b/.test(descUpper)) {
    return true;
  }

  // 1. Extração de Altura e Largura (ex: "2100A X 1400L", "2100 X 1400", "2100ALT X 1400LARG")
  let altura = 0;
  let largura = 0;

  const matchAlt = descUpper.match(/(\d{3,4})\s*(A|ALT|ALTURA)/);
  const matchLarg = descUpper.match(/(\d{3,4})\s*(L|LARG|LARGURA)/);

  if (matchAlt && matchLarg) {
    altura = parseInt(matchAlt[1], 10);
    largura = parseInt(matchLarg[1], 10);
  } else {
    const matchDimensoes = descUpper.match(/(\d{3,4})\s*[Xx*]\s*(\d{3,4})/);
    if (matchDimensoes) {
      // Por padrão em portas industriais: primeira dimensão costuma ser altura, segunda largura
      altura = parseInt(matchDimensoes[1], 10);
      largura = parseInt(matchDimensoes[2], 10);
    }
  }

  if (!altura && !largura) return false;

  // 2. Identificação do Modelo (Correr vs Giro)
  const isCorrer = /COR|CORRER/.test(descUpper);
  const isGiro = /GIR|GIRO|GIRATORIA/.test(descUpper);

  // 3. Identificação da Temperatura / Espessura
  const isSuper = /SUPER|SCONG/.test(descUpper);
  const isCong = /CONG|CONGELAD/.test(descUpper) && !isSuper;
  const isResf = /RESF|RESFRIAD/.test(descUpper) || (!isSuper && !isCong);

  // 4. Aplicação da Tabela Técnica Oficial
  if (isCorrer) {
    if (largura > 1300) return true;
    if (isSuper && altura > 2705) return true;
    if (isCong && altura > 2745) return true;
    if (isResf && altura > 2825) return true;
  } else if (isGiro) {
    if (largura > 1350) return true;
    if (isSuper && altura > 2780) return true;
    if (isCong && altura > 2820) return true;
    if (isResf && altura > 2900) return true;
  } else {
    // Caso genérico: adota o limite conservador
    if (largura > 1300 || altura > 2705) return true;
  }

  return false;
}

import { CODIGOS_TRILHOS_LGT_PADRAO } from '../types/mes';

export function normalizeValidationText(text: string): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

export function extractValidationCode(op: any): string {
  if (!op) return '';
  const rawCode = String(op.codigo || op.codigoProduto || op.code || '').trim();
  if (rawCode) {
    const match = rawCode.match(/^(\d{3})\.?(\d{4})$/);
    if (match) return `${match[1]}.${match[2]}`;
    return rawCode;
  }
  const desc = String(op.descricao || op.description || '');
  const matchDesc = desc.match(/\b(\d{3})\.?(\d{4})\b/);
  if (matchDesc) return `${matchDesc[1]}.${matchDesc[2]}`;
  return '';
}

/**
 * Retorna as etapas oficiais da rota de fabricação de Trilhos de Portas de Correr.
 */
export function getRotaTrilhoCorrer(): string[] {
  return [
    'Corte de Trilho p/ Porta Correr',
    'Montagem de Trilho p/ Porta Correr'
  ];
}

/**
 * Retorna as etapas oficiais da Estante Walk-in Completa.
 */
export function getRotaEstanteCompleta(): string[] {
  return ['Montagem Estante'];
}

/**
 * Retorna as etapas oficiais do Quadro Estante Walk-in.
 */
export function getRotaQuadroEstante(): string[] {
  return ['Laser', 'Dobra', 'Solda', 'Montagem Estante'];
}

/**
 * Retorna as etapas oficiais do Pé da Estante sem pintura (Serralheria T5).
 */
export function getRotaPeEstanteSemPintura(): string[] {
  return ['Corte', 'Solda', 'Montagem Estante'];
}

/**
 * Retorna as etapas oficiais do Pé da Estante com pintura (Montagem Estante T5).
 */
export function getRotaPeEstanteComPintura(): string[] {
  return ['Montagem Estante'];
}

/**
 * Retorna as etapas oficiais da Resistência de Piso 70W/MT.
 */
export function getRotaResistenciaPiso(): string[] {
  return ['Montagem Portas Emendadas'];
}

/**
 * Retorna as etapas oficiais do Abrigo de Doca Retrátil.
 */
export function getRotaAbrigoDoca(): string[] {
  return ['Corte', 'Solda', 'Montagem Abrigo Doca'];
}

/**
 * Retorna as etapas oficiais dos Perfis PP (Chapa).
 */
export function getRotaPerfilPP(): string[] {
  return ['Corte', 'Dobra'];
}

/**
 * Retorna as etapas oficiais do Kit Gaxeta U.
 */
export function getRotaKitGaxetaU(): string[] {
  return ['Montagem Portas Emendadas'];
}

/**
 * Retorna as etapas oficiais de Batentes (Família 020.xxxx ou BATENTE / BAT).
 * Rota completa de 4 etapas: Corte -> Dobra -> Preparação de Batentes -> Injeção e Finalização de Batentes.
 */
export function getRotaBatente(): string[] {
  return [
    'Corte',
    'Dobra',
    'Preparação de Batentes',
    'Injeção e Finalização de Batentes'
  ];
}

/**
 * Gerador Dinâmico Oficial de Etapas da Rota por Produto
 * Define as etapas visíveis no card de status e na esteira de produção.
 */
export function obterEtapasDaRota(op: any): string[] {
  const rawCod = String(op?.codigoProduto || op?.cod || op?.codigo || op?.codProduto || '').trim();
  const rawDesc = String(op?.descricao || op?.produto || op?.nome || (typeof op === 'string' ? op : '')).toUpperCase();
  const cod = rawCod;
  const desc = rawDesc;
  const normDesc = desc.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 1. PRODUTOS ESPECÍFICOS DIRETOS
  if (cod.startsWith('022.') || desc.startsWith('PERFIL PP')) {
    return ['Corte', 'Dobra'];
  }

  if (
    cod.startsWith('015.') || 
    cod === '090.0001' || 
    (desc.includes('ESTANTE WALK') && !desc.includes('QUADRO'))
  ) {
    return ['Montagem Estante'];
  }

  if (cod === '090.0004' || cod === '090.0005' || desc.includes('QUADRO ESTANTE')) {
    return ['Laser', 'Dobra', 'Solda', 'Montagem Estante'];
  }

  if (
    cod === '090.0002' || 
    ((desc.includes('PÉ ESTANTE') || normDesc.includes('PE ESTANTE')) && desc.includes('SEM PINTURA'))
  ) {
    return ['Corte', 'Solda', 'Montagem Estante'];
  }

  if (cod.startsWith('028.') || desc.startsWith('TRILHO')) {
    return ['Corte de Trilho', 'Montagem de Trilho'];
  }

  if (cod.startsWith('029.') || cod.startsWith('025.') || desc.includes('RESIST PISO') || desc.includes('KIT GAXETA')) {
    return ['Montagem Portas Emendadas'];
  }

  if (cod.startsWith('014.') || desc.includes('ABRIGO DOCA')) {
    return ['Corte', 'Solda', 'Montagem Abrigo Doca'];
  }

  // 2. TODA A FAMÍLIA SUPER CONG (007.xxxx, 003.xxxx ou texto SUPER CONG): 5 ETAPAS COMPLETAS
  if (
    cod.startsWith('007.') || 
    cod.startsWith('003.') || 
    desc.includes('SUPER CONG') ||
    desc.includes('SUPER CONGELADO') ||
    desc.includes('PORTA ESPECIAL')
  ) {
    // Se for Porta de Giro Super Congelada (ex: 003.0011 / PT GIR SUPER CONG):
    if (desc.includes('PT GIR') || desc.includes('GIRO') || cod.startsWith('003.') || cod.startsWith('001.')) {
      return [
        'Corte',
        'Dobra',
        'Preparação de Folhas',
        'Injeção de Folhas',
        'Montagem de Portas Giratória'
      ];
    }

    // Se for Porta de Correr Super Congelada (ex: 007.0011 / PT COR SUPER CONG / OP 024048-01 e OP 024049-01):
    return [
      'Corte',
      'Dobra',
      'Preparação de Folhas',
      'Injeção de Folhas',
      'Montagem Portas de Correr Padrão e Especial'
    ];
  }

  // 3. PORTAS DE GIRO PADRÃO (Família 001.xxxx / PT GIR) -> 2 ETAPAS DIRETAS NA MONTAGEM
  const ehPortaGiroPadrao = 
    cod.startsWith('001.') || 
    desc.startsWith('PT GIR') || 
    desc.startsWith('PORTA GIRO') || 
    desc.includes('PORTA GIRATÓRIA') ||
    desc.includes('PORTA GIRATORIA');

  if (ehPortaGiroPadrao) {
    return [
      'Instalação de Gaxeta',
      'Montagem de Portas Giratória'
    ];
  }

  // 4. BATENTES AVULSOS (ESTRITAMENTE 020.xxxx OU INÍCIO "BATENTE") -> 4 ETAPAS
  // NUNCA pesquisar substring solta "BAT" para não colidir com "3BAT"/"4BAT" de portas
  const ehBatenteAvulso = 
    cod.startsWith('020.') || 
    desc.startsWith('BATENTE') || 
    desc.startsWith('BAT ');

  if (ehBatenteAvulso) {
    return [
      'Corte',
      'Dobra',
      'Preparação de Batentes',
      'Injeção e Finalização de Batentes'
    ];
  }

  // 5. PORTAS DE CORRER PADRÃO (Família 002.xxxx / PT COR PADRÃO) E DEMAIS PORTAS
  return [
    'Instalação de Gaxeta',
    'Montagem Portas de Correr Padrão e Especial'
  ];
}

// Funções de Classificação de Produtos Industriais
export function isEstanteCompleta(op: any): boolean {
  const code = extractValidationCode(op);
  const norm = normalizeValidationText(op?.descricao);
  if (code.startsWith('015.')) return true;
  if (
    (norm.includes('ESTANTE WALK-IN') || norm.includes('ESTANTE WALK IN') || (norm.includes('ESTANTE') && norm.includes('WALK'))) &&
    !norm.includes('QUADRO') &&
    !norm.includes('PE ESTANTE') &&
    !norm.includes('PE DA ESTANTE')
  ) {
    return true;
  }
  return false;
}

export function isQuadroEstante(op: any): boolean {
  const code = extractValidationCode(op);
  const norm = normalizeValidationText(op?.descricao);
  if (code === '090.0004' || code === '090.0005') return true;
  if (norm.includes('QUADRO ESTANTE') || (norm.includes('QUADRO') && norm.includes('ESTANTE'))) return true;
  return false;
}

export function isPeEstanteSemPintura(op: any): boolean {
  const code = extractValidationCode(op);
  const norm = normalizeValidationText(op?.descricao);
  if (code === '090.0002') return true;
  const isPe = norm.includes('PE ESTANTE') || norm.includes('PE DA ESTANTE') || (norm.includes('PE') && norm.includes('ESTANTE'));
  const isSemPintura = norm.includes('SEM PINTURA') || norm.includes('S/ PINTURA') || norm.includes('S/PINTURA') || norm.includes('S PINTURA');
  return Boolean(isPe && isSemPintura);
}

export function isPeEstanteComPintura(op: any): boolean {
  const code = extractValidationCode(op);
  const norm = normalizeValidationText(op?.descricao);
  if (code === '090.0001') return true;
  const isPe = norm.includes('PE ESTANTE') || norm.includes('PE DA ESTANTE') || (norm.includes('PE') && norm.includes('ESTANTE'));
  const isSemPintura = norm.includes('SEM PINTURA') || norm.includes('S/ PINTURA') || norm.includes('S/PINTURA') || norm.includes('S PINTURA');
  return Boolean(isPe && !isSemPintura);
}

export function isResistenciaPiso(op: any): boolean {
  const code = extractValidationCode(op);
  const norm = normalizeValidationText(op?.descricao);
  if (code === '029.0014' || code.startsWith('029.')) return true;
  if (norm.includes('RESIST PISO') || norm.includes('RESISTENCIA DE PISO') || norm.includes('RESISTENCIA PISO') || norm.includes('RESIST. PISO')) return true;
  return false;
}

export function isAbrigoDoca(op: any): boolean {
  const code = extractValidationCode(op);
  const norm = normalizeValidationText(op?.descricao);
  if (code === '014.0010' || code.startsWith('014.')) return true;
  if (norm.includes('ABRIGO DOCA') || norm.includes('ABRIGO DE DOCA')) return true;
  return false;
}

export function isPerfilPP(op: any): boolean {
  const code = extractValidationCode(op);
  const norm = normalizeValidationText(op?.descricao);
  if (code.startsWith('022.')) return true;
  if (norm.startsWith('PERFIL PP') || norm.includes('PERFIL PP')) return true;
  return false;
}

export function isKitGaxetaU(op: any): boolean {
  const code = extractValidationCode(op);
  const norm = normalizeValidationText(op?.descricao);
  if (code === '025.0006' || (code.startsWith('025.') && norm.includes('GAXETA'))) return true;
  if (norm.includes('KIT GAXETA') || norm.includes('KIT DE GAXETA')) return true;
  return false;
}

export function isTrilhoCorrer(op: any): boolean {
  const code = extractValidationCode(op);
  const norm = normalizeValidationText(op?.descricao);
  if (code.startsWith('028.') || (code && CODIGOS_TRILHOS_LGT_PADRAO.has(code))) return true;
  if (norm.includes('TRILHO') && !norm.includes('TRILHO CORTINA')) return true;
  return false;
}

export function isBatente(op: any): boolean {
  const code = extractValidationCode(op);
  const norm = normalizeValidationText(op?.descricao || (typeof op === 'string' ? op : ''));
  const desc = (typeof op === 'string' ? op : (op?.descricao || op?.description || '')).toUpperCase();

  // Blindagem: se for porta frigorífica, NUNCA é batente avulso
  if (
    code.startsWith('001.') ||
    code.startsWith('002.') ||
    code.startsWith('003.') ||
    code.startsWith('005.') ||
    code.startsWith('007.') ||
    desc.startsWith('PT GIR') ||
    desc.startsWith('PT COR') ||
    desc.includes('PORTA GIRO') ||
    desc.includes('PORTA GIRATÓRIA') ||
    desc.includes('PORTA DE CORRER') ||
    norm.startsWith('PT GIR') ||
    norm.startsWith('PT COR') ||
    norm.includes('PORTA GIRO') ||
    norm.includes('PORTA GIRATORIA') ||
    norm.includes('PORTA DE CORRER')
  ) {
    return false;
  }

  return (
    code.startsWith('020.') ||
    desc.startsWith('BATENTE') ||
    desc.startsWith('BAT ') ||
    norm.startsWith('BATENTE') ||
    norm.startsWith('BAT ')
  );
}

/**
 * Verifica com segurança se uma etapa anterior já foi concluída na OP,
 * conferindo op.progressoPostos, op.etapas (array ou dicionário de estados) e histórico de apontamentos.
 */
export function isEtapaConcluida(op: any, etapaNome: string, apontamentos?: any[]): boolean {
  if (!op || !etapaNome) return false;
  const normEtapa = normalizeValidationText(etapaNome);

  // 1. op.progressoPostos
  if (op.progressoPostos && typeof op.progressoPostos === 'object') {
    for (const key of Object.keys(op.progressoPostos)) {
      if (normalizeValidationText(key) === normEtapa) {
        if (op.progressoPostos[key]?.concluido) return true;
      }
    }
  }

  // 2. op.etapas (Array)
  if (Array.isArray(op.etapas)) {
    const found = op.etapas.find((e: any) => normalizeValidationText(e.nome || e.step) === normEtapa);
    if (found?.concluido || found?.status === 'CONCLUIDO') return true;
  }

  // 3. op.etapas (Record/Objeto)
  if (op.etapas && typeof op.etapas === 'object') {
    for (const key of Object.keys(op.etapas)) {
      if (normalizeValidationText(key) === normEtapa) {
        const etapaObj = op.etapas[key];
        if (etapaObj?.status === 'CONCLUIDO') return true;
        if (typeof etapaObj?.concluidas === 'number' && etapaObj.concluidas > 0 && etapaObj.concluidas >= (etapaObj.total || 1)) {
          return true;
        }
      }
    }
  }

  // 4. Apontamentos finalizados
  if (Array.isArray(apontamentos) && apontamentos.length > 0) {
    const cleanOp = (op.op_numero || op.numero || op.id || '').trim().toUpperCase();
    const cleanNorm = cleanOp.replace(/^OP\s*/i, '').replace(/[-_\s]/g, '');

    const hasFinished = apontamentos.some((a: any) => {
      const aOp = (a.op_numero || a.op || '').trim().toUpperCase();
      const aNorm = aOp.replace(/^OP\s*/i, '').replace(/[-_\s]/g, '');
      const matchOp = aOp === cleanOp || aNorm === cleanNorm;
      if (!matchOp) return false;

      const aptEtapa = a.etapa_rota || a.etapaRota || a.setor || a.setorFisico || '';
      return normalizeValidationText(aptEtapa) === normEtapa && a.status === 'FINALIZADO';
    });
    if (hasFinished) return true;
  }

  return false;
}

/**
 * Matriz Oficial de Roteamento Industrial e Validação Sequencial Estrita.
 * Valida se o posto selecionado pertence à rota oficial do produto,
 * se o terminal físico condiz com o processo,
 * e se as etapas precedentes foram concluídas antes de liberar a próxima etapa.
 */
export function validarPostoIndustrial(
  op: any,
  postoSelecionado: string,
  apontamentos?: any[],
  terminalId?: number
): { valido: boolean; motivo?: string } {
  if (!postoSelecionado) return { valido: true };

  // 0. LINHA SUPER CONGELADA (007.xxxx E 003.xxxx) -> 5 ETAPAS PERMITIDAS
  const codNorm = String(op?.codigoProduto || op?.cod || op?.codigo || '').trim();
  const descNorm = String(op?.descricao || op?.produto || '').toUpperCase();

  const ehSuperCong = 
    codNorm.startsWith('007.') || 
    codNorm.startsWith('003.') || 
    codNorm.startsWith('007') || 
    codNorm.startsWith('003') || 
    descNorm.includes('007.') || 
    descNorm.includes('003.') || 
    descNorm.includes('SUPER CONG');

  if (ehSuperCong) {
    const isGiro = codNorm.startsWith('003.') || codNorm.startsWith('003') || descNorm.includes('PT GIR') || descNorm.includes('GIRO');
    const rotaPermitida = isGiro
      ? ['Corte', 'Dobra', 'Laser', 'Preparação de Folhas', 'Injeção de Folhas', 'Montagem de Portas Giratória']
      : ['Corte', 'Dobra', 'Laser', 'Preparação de Folhas', 'Injeção de Folhas', 'Montagem Portas de Correr Padrão e Especial'];

    const normPosto = postoSelecionado.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const isPostoValido = rotaPermitida.some(step => {
      const normStep = step.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (normPosto === normStep) return true;
      if (normStep.includes('CORTE') && normPosto.includes('CORTE')) return true;
      if (normStep.includes('DOBRA') && normPosto.includes('DOBRA')) return true;
      if (normStep.includes('LASER') && normPosto.includes('LASER')) return true;
      if (normStep.includes('PREPARACAO') && normPosto.includes('PREPARACAO')) return true;
      if (normStep.includes('INJECAO') && normPosto.includes('INJECAO')) return true;
      if (normStep.includes('MONTAGEM') && normPosto.includes('MONTAGEM')) return true;
      return false;
    });

    if (isPostoValido) {
      return { valido: true };
    }
  }

  // 1. ESTANTES WALK-IN: ESTANTE COMPLETA (015.xxxx / ESTANTE WALK-IN sem QUADRO)
  if (isEstanteCompleta(op)) {
    if (postoSelecionado !== 'Montagem Estante') {
      return {
        valido: false,
        motivo: 'Estante Walk-In Completa possui rota de etapa única exclusiva no posto "Montagem Estante" (Terminal 5).'
      };
    }
    if (terminalId && terminalId !== 5) {
      return { valido: false, motivo: 'A Montagem de Estante Walk-in deve ser realizada no Terminal 5.' };
    }
    return { valido: true };
  }

  // 2. ESTANTES WALK-IN: QUADRO ESTANTE
  if (isQuadroEstante(op)) {
    const rota = getRotaQuadroEstante();
    if (!rota.includes(postoSelecionado)) {
      return {
        valido: false,
        motivo: 'Quadro Estante Walk-in só pode ser apontado na rota: Laser (T1) -> Dobra (T1) -> Solda (T5) -> Montagem Estante (T5).'
      };
    }
    if ((postoSelecionado === 'Laser' || postoSelecionado === 'Dobra') && terminalId && terminalId !== 1) {
      return { valido: false, motivo: `A etapa ${postoSelecionado} do Quadro Estante deve ser realizada no Terminal 1.` };
    }
    if ((postoSelecionado === 'Solda' || postoSelecionado === 'Montagem Estante') && terminalId && terminalId !== 5) {
      return { valido: false, motivo: `A etapa ${postoSelecionado} do Quadro Estante deve ser realizada no Terminal 5.` };
    }
    if (postoSelecionado === 'Dobra' && !isEtapaConcluida(op, 'Laser', apontamentos)) {
      return { valido: false, motivo: 'A Dobra do Quadro Estante só pode ser iniciada após a conclusão do Laser (T1).' };
    }
    if (postoSelecionado === 'Solda' && !isEtapaConcluida(op, 'Dobra', apontamentos)) {
      return { valido: false, motivo: 'A Solda do Quadro Estante só pode ser iniciada após a conclusão da Dobra (T1).' };
    }
    if (postoSelecionado === 'Montagem Estante' && !isEtapaConcluida(op, 'Solda', apontamentos)) {
      return { valido: false, motivo: 'A Montagem do Quadro Estante só pode ser iniciada após a conclusão da Solda (T5).' };
    }
    return { valido: true };
  }

  // 3. ESTANTES WALK-IN: PÉ DA ESTANTE SEM PINTURA
  if (isPeEstanteSemPintura(op)) {
    const rota = getRotaPeEstanteSemPintura();
    if (!rota.includes(postoSelecionado)) {
      return {
        valido: false,
        motivo: 'Pé da Estante sem pintura só pode ser apontado na rota da serralheria: Corte (T5) -> Solda (T5) -> Montagem Estante (T5).'
      };
    }
    if (terminalId && terminalId !== 5) {
      return { valido: false, motivo: 'O processo de Pé da Estante sem pintura é exclusivo da serralheria no Terminal 5.' };
    }
    if (postoSelecionado === 'Solda' && !isEtapaConcluida(op, 'Corte', apontamentos)) {
      return { valido: false, motivo: 'A Solda do Pé de Estante só pode ser iniciada após a conclusão do Corte (T5).' };
    }
    if (postoSelecionado === 'Montagem Estante' && !isEtapaConcluida(op, 'Solda', apontamentos)) {
      return { valido: false, motivo: 'A Montagem do Pé de Estante só pode ser iniciada após a conclusão da Solda (T5).' };
    }
    return { valido: true };
  }

  // 4. ESTANTES WALK-IN: PÉ DA ESTANTE COM PINTURA (PRETA OU BRANCA)
  if (isPeEstanteComPintura(op)) {
    if (postoSelecionado !== 'Montagem Estante' && postoSelecionado !== 'Cortina') {
      return {
        valido: false,
        motivo: 'Pé da Estante com pintura possui rota única no posto "Montagem Estante" (Terminal 5).'
      };
    }
    if (terminalId && terminalId !== 5) {
      return { valido: false, motivo: 'A montagem de Pé de Estante com pintura deve ser feita no Terminal 5.' };
    }
    return { valido: true };
  }

  // 4. RESISTÊNCIA DE PISO 70W/MT
  if (isResistenciaPiso(op)) {
    if (postoSelecionado !== 'Montagem Portas Emendadas') {
      return {
        valido: false,
        motivo: 'Resistência de Piso 70W/MT deve ser apontada exclusivamente no posto "Montagem Portas Emendadas" (Terminal 3 ou 4).'
      };
    }
    if (terminalId && terminalId !== 3 && terminalId !== 4) {
      return { valido: false, motivo: 'Resistência de Piso só pode ser montada no Terminal 3 ou Terminal 4.' };
    }
    return { valido: true };
  }

  // 5. ABRIGO DE DOCA RETRÁTIL
  if (isAbrigoDoca(op)) {
    const isMontagem = postoSelecionado === 'Montagem Abrigo Doca' || postoSelecionado === 'Montagem';
    const isValido = postoSelecionado === 'Corte' || postoSelecionado === 'Solda' || isMontagem;
    if (!isValido) {
      return {
        valido: false,
        motivo: 'Abrigo de Doca Retrátil só pode ser apontado na rota: Corte (T5) -> Solda (T5) -> Montagem Abrigo Doca (T5).'
      };
    }
    if (terminalId && terminalId !== 5) {
      return { valido: false, motivo: 'O Abrigo de Doca Retrátil deve ser fabricado exclusivamente no Terminal 5.' };
    }
    if (postoSelecionado === 'Solda' && !isEtapaConcluida(op, 'Corte', apontamentos)) {
      return { valido: false, motivo: 'A Solda do Abrigo de Doca só pode ser iniciada após a conclusão do Corte (T5).' };
    }
    if (isMontagem && !isEtapaConcluida(op, 'Solda', apontamentos)) {
      return { valido: false, motivo: 'A Montagem do Abrigo de Doca só pode ser iniciada após a conclusão da Solda (T5).' };
    }
    return { valido: true };
  }

  // 6. PERFIS DE CHAPA / PP
  if (isPerfilPP(op)) {
    const rota = getRotaPerfilPP();
    if (!rota.includes(postoSelecionado)) {
      return {
        valido: false,
        motivo: 'Perfil PP só pode ser apontado na rota: Corte (T1) -> Dobra (T1).'
      };
    }
    if (terminalId && terminalId !== 1) {
      return { valido: false, motivo: 'Perfil PP deve ser processado exclusivamente no Terminal 1.' };
    }
    if (postoSelecionado === 'Dobra' && !isEtapaConcluida(op, 'Corte', apontamentos)) {
      return { valido: false, motivo: 'A Dobra do Perfil PP só pode ser iniciada após a conclusão do Corte (T1).' };
    }
    return { valido: true };
  }

  // 7. KIT GAXETA U
  if (isKitGaxetaU(op)) {
    if (postoSelecionado !== 'Montagem Portas Emendadas') {
      return {
        valido: false,
        motivo: 'Kit Gaxeta U deve ser apontado exclusivamente no posto "Montagem Portas Emendadas" (Terminal 3 ou 4).'
      };
    }
    if (terminalId && terminalId !== 3 && terminalId !== 4) {
      return { valido: false, motivo: 'Kit Gaxeta U só pode ser montado no Terminal 3 ou Terminal 4.' };
    }
    return { valido: true };
  }

  // 8. TRILHOS DE PORTA DE CORRER
  if (isTrilhoCorrer(op)) {
    const rota = getRotaTrilhoCorrer();
    if (!rota.includes(postoSelecionado)) {
      return {
        valido: false,
        motivo: 'OP de Trilho só pode ser apontada nos postos de Corte ou Montagem de Trilho.'
      };
    }
    if (postoSelecionado === 'Montagem de Trilho p/ Porta Correr' && !isEtapaConcluida(op, 'Corte de Trilho p/ Porta Correr', apontamentos)) {
      return {
        valido: false,
        motivo: 'A Montagem do Trilho só pode ser iniciada após a conclusão do Corte do Trilho.'
      };
    }
    return { valido: true };
  }

  // 9. PROTEÇÃO CONTRA SELEÇÃO DE POSTOS EXCLUSIVOS POR OUTROS PRODUTOS
  if (postoSelecionado.includes('Trilho p/ Porta Correr') && !isTrilhoCorrer(op)) {
    return { valido: false, motivo: 'Este posto é exclusivo para fabricação de Trilhos de Portas de Correr.' };
  }
  if (
    postoSelecionado === 'Montagem Estante' &&
    !isQuadroEstante(op) &&
    !isPeEstanteSemPintura(op) &&
    !isEstanteCompleta(op) &&
    !isPeEstanteComPintura(op)
  ) {
    return { valido: false, motivo: 'O posto Montagem Estante é exclusivo para fabricação de Estantes Walk-in.' };
  }
  if (postoSelecionado === 'Montagem Abrigo Doca' && !isAbrigoDoca(op)) {
    return { valido: false, motivo: 'O posto Montagem Abrigo Doca é exclusivo para Abrigo de Doca Retrátil.' };
  }

  // 10. POLÍTICA DE CONTINGÊNCIA (ROTA ABERTA / FÁBRICA)
  return { valido: true };
}

/**
 * Validação sequencial e verificação de compatibilidade para Ordens de Produção de Trilhos.
 * Mantida para retrocompatibilidade total com módulos existentes.
 */
export function validarPostoTrilho(
  op: any,
  postoSelecionado: string,
  apontamentos?: any[]
): { valido: boolean; motivo?: string } {
  return validarPostoIndustrial(op, postoSelecionado, apontamentos);
}
