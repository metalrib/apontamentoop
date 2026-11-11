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

import {
  CODIGOS_TRILHOS_LGT_PADRAO,
  CODIGOS_PORTAS_GIRO_PADRAO,
  CODIGOS_PORTAS_CORRER_PADRAO,
  CODIGOS_CORRER_PADRAO,
  classificarPortaCorrer,
  CODIGOS_GIRATORIA_PADRAO,
  CODIGOS_PADRAO_CORRER,
  CODIGOS_FOLHAS_PADRAO,
  CODIGOS_BATENTES_PADRAO,
  normalizarCodigo,
  isPortaCorrerPadrao,
  CODIGOS_ROTA_EXCLUSIVA_LASER,
  CODIGOS_ROTA_LASER_DOBRA,
  CODIGOS_ROTA_EXCLUSIVA_ROUTER,
  isRotaExclusivaLaser,
  isRotaLaserDobra,
  isRotaExclusivaRouter
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
  isRotaExclusivaRouter
};

export function normalizeValidationText(text: string): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

/**
 * Identifica se uma OP ou especificação de produto refere-se a Ordens de Folhas
 * ('Folha de Linha Padrão', 'Folha Especial', 'FOLHA GIR', 'FOLHA COR', códigos 020.0009 a 020.0031, etc.).
 */
export function isFolhaOrder(op: any, explicitCodigo?: string): boolean {
  if (!op) return false;
  const desc = normalizeValidationText(
    typeof op === 'string'
      ? op
      : op.descricao || op.produto || op.description || ''
  );
  const fam = normalizeValidationText(
    typeof op === 'object' && op !== null
      ? (op.familia || '')
      : ''
  );
  let rawCod = String(
    explicitCodigo ||
    (typeof op === 'object' && op !== null
      ? op.codigoProduto || op.cod || op.codigo || op.code || ''
      : '')
  ).trim();

  const matchCode = rawCod.match(/^(\d{3})\.?(\d{4})$/);
  if (matchCode) {
    rawCod = `${matchCode[1]}.${matchCode[2]}`;
  }
  const cleanDigits = rawCod.replace(/\D/g, '');

  if (CODIGOS_FOLHAS_PADRAO.has(rawCod)) return true;
  if (fam.includes('FOLHA')) return true;
  if (
    desc.includes('FOLHA') ||
    desc.includes('FOLHAS') ||
    desc.includes('FLH ') ||
    desc.includes('FLH-')
  ) {
    return true;
  }
  if ((rawCod >= '020.0009' && rawCod <= '020.0031') || (rawCod.startsWith('020.') && !CODIGOS_BATENTES_PADRAO.has(rawCod)) || cleanDigits.startsWith('020')) {
    if (CODIGOS_BATENTES_PADRAO.has(rawCod)) return false;
    if (desc.startsWith('BAT ') || desc.startsWith('BAT-') || desc.startsWith('BATENTE')) return false;
    return true;
  }
  return false;
}

/**
 * Validação tolerante / normalizada de correspondência de etapa na rota da OP
 */
export function etapaPertenceARota(etapaSelecionada: string, rota: string[]): boolean {
  if (!etapaSelecionada || !Array.isArray(rota)) return false;

  const normalizar = (str: string) => 
    (str || '')
       .toLowerCase()
       .normalize('NFD')
       .replace(/[\u0300-\u036f]/g, '')
       .replace(/[-_]/g, ' ')
       .replace(/\s+/g, ' ')
       .trim();

  const selecionadaNorm = normalizar(etapaSelecionada);
  
  return rota.some(etapa => {
    const etapaNorm = normalizar(etapa);
    // Casamento exato ou equivalente para Montagem Vai-Vem
    if (selecionadaNorm === etapaNorm) return true;
    if (
      selecionadaNorm.includes('vai vem') &&
      etapaNorm.includes('vai vem') && 
      (selecionadaNorm.includes('montagem') || selecionadaNorm.includes('finalizacao')) && 
      (etapaNorm.includes('montagem') || etapaNorm.includes('finalizacao'))
    ) {
      return true;
    }
    // Casamento de Preparação e Montagem de Office Door
    if (
      selecionadaNorm.includes('office door') &&
      etapaNorm.includes('office door')
    ) {
      if (selecionadaNorm.includes('preparacao') || etapaNorm.includes('preparacao')) {
        return selecionadaNorm.includes('preparacao') && etapaNorm.includes('preparacao');
      }
      if (selecionadaNorm.includes('montagem') || etapaNorm.includes('montagem')) {
        return selecionadaNorm.includes('montagem') && etapaNorm.includes('montagem');
      }
      return true;
    }
    return false;
  });
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
 * Identifica se a OP pertence a uma das famílias elegíveis para encaminhamento ao Router:
 * 1. PORTA VAI E VEM (Cód iniciando com "011." ou descrição contendo "VAI VEM" / "VAI-VEM")
 * 2. OFFICE DOOR GIRATÓRIA (Cód iniciando com "009." ou descrição contendo "OFFICE DOOR GIR" / "OFFICE DOOR")
 * 3. OFFICE DOOR CORRER (Cód iniciando com "010." ou descrição contendo "OFFICE DOOR COR")
 */
export function isEligibleForRouter(op: any): boolean {
  if (!op) return false;
  const cod = String(op?.codigoProduto || op?.cod || op?.codigo || op?.code || '').trim();
  const desc = String(op?.descricao || op?.produto || op?.description || '').toUpperCase();

  // 1. PORTA VAI E VEM
  if (cod.startsWith('011.') || desc.includes('VAI VEM') || desc.includes('VAI-VEM')) {
    return true;
  }

  // 2. OFFICE DOOR GIRATÓRIA
  if (cod.startsWith('009.') || desc.includes('OFFICE DOOR GIR') || desc.includes('OFFICE DOOR')) {
    return true;
  }

  // 3. OFFICE DOOR CORRER
  if (
    cod.startsWith('010.') ||
    cod === '010.0008' ||
    desc.includes('OFFICE DOOR COR') ||
    desc.includes('OFFICE-DOOR COR') ||
    (desc.includes('OFFICE DOOR') && (desc.includes('CORRER') || desc.includes('COR ')))
  ) {
    return true;
  }

  return false;
}

/**
 * Identifica se a OP é de Porta Office Door de Correr (código 010.xxxx ou descrição correspondente)
 */
export function isOfficeDoorCorrer(op: any): boolean {
  if (!op) return false;
  const cod = String(op?.codigoProduto || op?.cod || op?.codigo || op?.code || '').trim();
  const desc = String(op?.descricao || op?.produto || op?.description || '').toUpperCase();
  return (
    cod.startsWith('010.') ||
    cod.startsWith('010') ||
    cod === '010.0008' ||
    desc.includes('OFFICE DOOR COR') ||
    desc.includes('OFFICE-DOOR COR') ||
    (desc.includes('OFFICE DOOR') && (desc.includes('CORRER') || desc.includes('COR ')))
  );
}

/**
 * Identifica se a OP pertence à família Porta Vai-Vem ou Office Door:
 * 1. Vai-Vem: código iniciando por "011." ou contendo "VAI VEM" / "VAI-VEM"
 * 2. Office Door: descrição contendo "OFFICE DOOR" / "OFFICE-DOOR" ou códigos "009." / "010."
 */
export function isVaiVemOuOfficeDoor(op: any): boolean {
  if (!op) return false;
  const cod = String(op?.codigoProduto || op?.cod || op?.codigo || op?.code || '').trim();
  const desc = String(op?.descricao || op?.produto || op?.description || '').toUpperCase();
  return (
    cod.startsWith('011.') ||
    cod.startsWith('009.') ||
    cod.startsWith('010.') ||
    desc.includes('VAI VEM') ||
    desc.includes('VAI-VEM') ||
    desc.includes('OFFICE DOOR') ||
    desc.includes('OFFICE-DOOR')
  );
}

/**
 * Verifica se a etapa de Injeção de Folhas (Terminal 2) já foi iniciada ou concluída para a OP.
 * Avalia apontamentos ativos (status 'EM_ANDAMENTO', 'EM_PRODUCAO', etc.) ou concluídos,
 * bem como op.apontamentos, op.etapas e op.progressoPostos.
 */
export function verificarInjecaoLiberada(
  op: any,
  apontamentos: any[] = []
): { injecaoLiberada: boolean; motivo?: string } {
  if (!op) return { injecaoLiberada: false, motivo: '🔒 Aguardando Início da Injeção de Folhas' };

  // 1. Apontamentos na lista em memória / realtime
  if (Array.isArray(apontamentos) && apontamentos.length > 0) {
    const cleanOp = (op.op_numero || op.numero || op.id || '').trim().toUpperCase();
    const cleanNorm = cleanOp.replace(/^OP\s*/i, '').replace(/[-_\s]/g, '');

    const hasInjApt = apontamentos.some((a) => {
      const aOp = (a.op_numero || a.op || '').trim().toUpperCase();
      const aNorm = aOp.replace(/^OP\s*/i, '').replace(/[-_\s]/g, '');
      const matchOp = aOp === cleanOp || aNorm === cleanNorm;
      if (!matchOp) return false;

      const sec = String(a.setorFisico || a.setor || '').toLowerCase();
      const stp = String(a.etapa_rota || a.etapaRota || '').toLowerCase();
      const isInj = sec.includes('injec') || stp.includes('injec') || sec.includes('injet') || stp.includes('injet');
      if (!isInj) return false;

      const s = String(a.status || '').toUpperCase().trim();
      return (
        s === 'EM_ANDAMENTO' ||
        s === 'EM_PRODUCAO' ||
        s === 'FINALIZADO' ||
        s === 'CONCLUIDO' ||
        Boolean((a.hora_inicio || a.horaInicio) && !a.hora_fim && !a.horaFim) ||
        ((a.quantidade_produzida || a.qtdProduzida || 0) > 0)
      );
    });

    if (hasInjApt) {
      return { injecaoLiberada: true };
    }
  }

  // 2. Checagem em op.apontamentos
  const opApts = op.apontamentos;
  if (opApts && typeof opApts === 'object') {
    const injKey = Object.keys(opApts).find((k) => k.toLowerCase().includes('injec') || k.toLowerCase().includes('injet'));
    if (injKey) {
      const aptInj = opApts[injKey];
      const statusRaw = String(aptInj?.status || '').toLowerCase().trim();
      if (
        statusRaw === 'em_andamento' ||
        statusRaw === 'em andamento' ||
        statusRaw === 'em_producao' ||
        statusRaw === 'em producao' ||
        statusRaw === 'concluido' ||
        statusRaw === 'concluida' ||
        statusRaw === 'finalizado' ||
        statusRaw === 'finalizada' ||
        Boolean(aptInj?.hora_inicio || aptInj?.horaInicio || aptInj?.inicio) ||
        (typeof aptInj?.qtdProduzida === 'number' && aptInj.qtdProduzida > 0) ||
        (typeof aptInj?.concluidas === 'number' && aptInj.concluidas > 0) ||
        Boolean(aptInj?.iniciado)
      ) {
        return { injecaoLiberada: true };
      }
    }
  }

  // 3. Checagem em op.etapas
  if (op.etapas && typeof op.etapas === 'object' && !Array.isArray(op.etapas)) {
    const injEtapaKey = Object.keys(op.etapas).find((k) => k.toLowerCase().includes('injec') || k.toLowerCase().includes('injet'));
    if (injEtapaKey) {
      const etapaInfo = op.etapas[injEtapaKey];
      const statusRaw = String(etapaInfo?.status || '').toLowerCase().trim();
      if (
        statusRaw === 'em_andamento' ||
        statusRaw === 'em andamento' ||
        statusRaw === 'em_producao' ||
        statusRaw === 'em producao' ||
        statusRaw === 'concluido' ||
        statusRaw === 'concluida' ||
        statusRaw === 'finalizado' ||
        statusRaw === 'finalizada' ||
        (typeof etapaInfo?.concluidas === 'number' && etapaInfo.concluidas > 0) ||
        Boolean(etapaInfo?.inicio || etapaInfo?.horaInicio || etapaInfo?.hora_inicio)
      ) {
        return { injecaoLiberada: true };
      }
    }
  }

  // 4. Checagem em op.progressoPostos
  if (op.progressoPostos && typeof op.progressoPostos === 'object') {
    const progKey = Object.keys(op.progressoPostos).find((k) => k.toLowerCase().includes('injec') || k.toLowerCase().includes('injet'));
    if (progKey) {
      const progInfo = op.progressoPostos[progKey];
      const statusRaw = String(progInfo?.status || '').toLowerCase().trim();
      if (
        progInfo?.iniciado ||
        statusRaw === 'em_andamento' ||
        statusRaw === 'em andamento' ||
        statusRaw === 'em_producao' ||
        statusRaw === 'em producao' ||
        statusRaw === 'concluido' ||
        statusRaw === 'concluida' ||
        statusRaw === 'finalizado' ||
        statusRaw === 'finalizada' ||
        (typeof progInfo?.concluidas === 'number' && progInfo.concluidas > 0)
      ) {
        return { injecaoLiberada: true };
      }
    }
  }

  // 5. Se a etapa atual já passou da injeção (ex: Router ou Montagem já em andamento)
  const etapaAtualNorm = String(op.etapaAtual || op.statusEtapa || '').toUpperCase();
  if (
    etapaAtualNorm.includes('ROUTER') ||
    (etapaAtualNorm.includes('MONTAGEM') && !etapaAtualNorm.includes('AGUARDANDO'))
  ) {
    return { injecaoLiberada: true };
  }

  return {
    injecaoLiberada: false,
    motivo: '🔒 Aguardando Início da Injeção de Folhas'
  };
}

/**
 * Regra de Liberação Condicional da Montagem de Porta Vai-Vem e Office Door (Terminal 5):
 * 1. Se a OP NÃO possuir a etapa Router:
 *    Permanece bloqueada com "🔒 Aguardando Início da Injeção de Folhas" até a Injeção de Folhas receber início ou conclusão.
 * 2. Se a OP possuir a etapa Router:
 *    Permanece bloqueada com "🔒 Aguardando Início na Router" até a Router receber início ou conclusão.
 */
export function verificarLiberacaoMontagemVaiVemOuOfficeDoor(
  op: any,
  apontamentos: any[] = []
): { liberada: boolean; motivo?: string } {
  if (!op || !isVaiVemOuOfficeDoor(op)) {
    return { liberada: true };
  }

  // 1. SE FOR OFFICE DOOR DE CORRER (010.*):
  // Regra Oficial: A etapa Router é Opcional/Condicional (usinagem de visores quando aplicável).
  // A Montagem Office Door Correr pode ser iniciada se a Injeção estiver concluída ou iniciada,
  // ou se a etapa de Router já tiver recebido início/conclusão.
  if (isOfficeDoorCorrer(op)) {
    const injCheck = verificarInjecaoLiberada(op, apontamentos);
    const { routerLiberada } = verificarRouterLiberada(op, apontamentos);
    if (injCheck.injecaoLiberada || routerLiberada) {
      return { liberada: true };
    }
    return {
      liberada: false,
      motivo: '🔒 Aguardando Início da Injeção (Router Opcional)'
    };
  }

  const { requerRouter, routerLiberada } = verificarRouterLiberada(op, apontamentos);

  // 2. SE A OP POSSUIR A ETAPA ROUTER (marcada na rota):
  if (requerRouter) {
    if (!routerLiberada) {
      return {
        liberada: false,
        motivo: '🔒 Aguardando Início na Router'
      };
    }
    return { liberada: true };
  }

  // 3. SE A OP NÃO POSSUIR A ETAPA ROUTER:
  const injCheck = verificarInjecaoLiberada(op, apontamentos);
  if (!injCheck.injecaoLiberada) {
    return {
      liberada: false,
      motivo: '🔒 Aguardando Início da Injeção de Folhas'
    };
  }

  return { liberada: true };
}

/**
 * Verifica se a etapa Router é requerida para a OP e se já está liberada
 * (iniciada com status em_andamento ou já concluída) para permitir o paralelismo da Montagem de Vai-Vem.
 */
export function verificarRouterLiberada(
  op: any,
  apontamentos: any[] = []
): { requerRouter: boolean; routerLiberada: boolean } {
  if (!op) return { requerRouter: false, routerLiberada: true };

  // 1. Identificação se a rota da OP contempla a etapa Router
  const rotaList: string[] = [];
  if (Array.isArray(op.rota)) rotaList.push(...op.rota);
  if (typeof op.rota === 'string') {
    rotaList.push(...op.rota.split(/[➔\->,;|]/).map((s: string) => s.trim()));
  }
  if (Array.isArray(op.etapas)) rotaList.push(...op.etapas);

  const temRouterNaRota = rotaList.some((r) => r.toLowerCase().includes('router'));
  const requerRouter = Boolean(
    temRouterNaRota ||
    op.requerRouter ||
    op.requer_router ||
    op.encaminhar_router ||
    (op.etapas &&
      typeof op.etapas === 'object' &&
      !Array.isArray(op.etapas) &&
      Object.keys(op.etapas).some((k) => k.toLowerCase().includes('router'))) ||
    (op.etapaAtual && op.etapaAtual.toLowerCase().includes('router')) ||
    (op.apontamentos &&
      typeof op.apontamentos === 'object' &&
      Object.keys(op.apontamentos).some((k) => k.toLowerCase().includes('router')))
  );

  if (!requerRouter) {
    return { requerRouter: false, routerLiberada: true };
  }

  // 2. Se requer Router, verifica se a etapa já iniciou (em_andamento) ou concluiu (concluido)
  // A) Checagem em op.apontamentos
  const opApts = op.apontamentos;
  if (opApts && typeof opApts === 'object') {
    const routerKey = Object.keys(opApts).find((k) => k.toLowerCase().includes('router'));
    if (routerKey) {
      const aptRouter = opApts[routerKey];
      const statusRaw = String(aptRouter?.status || '').toLowerCase().trim();
      if (
        statusRaw === 'em_andamento' ||
        statusRaw === 'em andamento' ||
        statusRaw === 'em_producao' ||
        statusRaw === 'em producao' ||
        statusRaw === 'concluido' ||
        statusRaw === 'concluida' ||
        statusRaw === 'finalizado' ||
        statusRaw === 'finalizada' ||
        (typeof aptRouter?.qtdProduzida === 'number' && aptRouter.qtdProduzida > 0) ||
        (typeof aptRouter?.concluidas === 'number' && aptRouter.concluidas > 0) ||
        Boolean(aptRouter?.iniciado)
      ) {
        return { requerRouter: true, routerLiberada: true };
      }
    }
  }

  // B) Checagem na lista de apontamentos
  if (Array.isArray(apontamentos) && apontamentos.length > 0) {
    const hasRouterApt = apontamentos.some((a) => {
      const matchOp = a.op_numero === op.op_numero || a.op === op.op_numero;
      if (!matchOp) return false;
      const setorNorm = (a.setorFisico || a.setor || '').toLowerCase();
      const etapaNorm = (a.etapa_rota || a.etapaRota || '').toLowerCase();
      const isRouter = setorNorm.includes('router') || etapaNorm.includes('router');
      if (!isRouter) return false;
      const statusNorm = String(a.status || '').toUpperCase().trim();
      return (
        statusNorm === 'EM_ANDAMENTO' ||
        statusNorm === 'FINALIZADO' ||
        statusNorm === 'CONCLUIDO'
      );
    });

    if (hasRouterApt) {
      return { requerRouter: true, routerLiberada: true };
    }
  }

  // C) Checagem em op.etapas['Router']
  if (op.etapas && typeof op.etapas === 'object' && !Array.isArray(op.etapas)) {
    const routerEtapaKey = Object.keys(op.etapas).find((k) => k.toLowerCase().includes('router'));
    if (routerEtapaKey) {
      const etapaInfo = op.etapas[routerEtapaKey];
      const statusEtapa = String(etapaInfo?.status || '').toUpperCase().trim();
      if (
        statusEtapa === 'EM_ANDAMENTO' ||
        statusEtapa === 'EM_PRODUCAO' ||
        statusEtapa === 'CONCLUIDO' ||
        statusEtapa === 'FINALIZADO' ||
        (etapaInfo?.concluidas && etapaInfo.concluidas > 0)
      ) {
        return { requerRouter: true, routerLiberada: true };
      }
    }
  }

  // D) Checagem em op.progressoPostos
  if (op.progressoPostos && typeof op.progressoPostos === 'object') {
    const progKey = Object.keys(op.progressoPostos).find((k) => k.toLowerCase().includes('router'));
    if (progKey) {
      const prog = op.progressoPostos[progKey];
      const progStatus = String(prog?.status || '').toUpperCase().trim();
      if (
        prog?.iniciado ||
        prog?.concluido ||
        (prog?.concluidas && prog.concluidas > 0) ||
        progStatus === 'EM_ANDAMENTO' ||
        progStatus === 'EM_PRODUCAO' ||
        progStatus === 'CONCLUIDO' ||
        progStatus === 'FINALIZADO'
      ) {
        return { requerRouter: true, routerLiberada: true };
      }
    }
  }

  return { requerRouter: true, routerLiberada: false };
}

/**
 * Verifica se uma etapa já foi iniciada (em andamento) ou concluída na OP.
 * Avalia op.apontamentos, op.progressoPostos, op.etapas, lista de apontamentos e op.etapaAtual.
 */
export function isEtapaIniciadaOuConcluida(op: any, etapaNome: string, apontamentos: any[] = []): boolean {
  if (!op || !etapaNome) return false;
  const normEtapa = normalizeValidationText(etapaNome);

  // 1. op.apontamentos (objeto indexado por posto ou etapa)
  const opApts = op.apontamentos;
  if (opApts && typeof opApts === 'object') {
    for (const key of Object.keys(opApts)) {
      const normKey = normalizeValidationText(key);
      if (normKey.includes(normEtapa) || normEtapa.includes(normKey)) {
        const apt = opApts[key];
        const statusRaw = String(apt?.status || '').toLowerCase().trim();
        if (
          statusRaw === 'em_andamento' ||
          statusRaw === 'em andamento' ||
          statusRaw === 'em_producao' ||
          statusRaw === 'em producao' ||
          statusRaw === 'concluido' ||
          statusRaw === 'concluida' ||
          statusRaw === 'finalizado' ||
          statusRaw === 'finalizada' ||
          (typeof apt?.qtdProduzida === 'number' && apt.qtdProduzida > 0) ||
          (typeof apt?.concluidas === 'number' && apt.concluidas > 0) ||
          Boolean(apt?.iniciado)
        ) {
          return true;
        }
      }
    }
  }

  // 2. op.progressoPostos
  if (op.progressoPostos && typeof op.progressoPostos === 'object') {
    for (const key of Object.keys(op.progressoPostos)) {
      const normKey = normalizeValidationText(key);
      if (normKey.includes(normEtapa) || normEtapa.includes(normKey)) {
        const p = op.progressoPostos[key];
        const progStatus = String(p?.status || '').toUpperCase().trim();
        if (
          p?.iniciado ||
          p?.concluido ||
          progStatus === 'EM_PRODUCAO' ||
          progStatus === 'EM_ANDAMENTO' ||
          progStatus === 'CONCLUIDO' ||
          progStatus === 'FINALIZADO' ||
          (typeof p?.concluidas === 'number' && p.concluidas > 0)
        ) {
          return true;
        }
      }
    }
  }

  // 3. op.etapas (Array)
  if (Array.isArray(op.etapas)) {
    const found = op.etapas.find((e: any) => {
      const stepName = normalizeValidationText(typeof e === 'string' ? e : e.nome || e.step || '');
      return stepName.includes(normEtapa) || normEtapa.includes(stepName);
    });
    if (found) {
      const statusRaw = String(found.status || '').toLowerCase().trim();
      if (
        found.concluido ||
        found.iniciado ||
        statusRaw === 'em_producao' ||
        statusRaw === 'em_andamento' ||
        statusRaw === 'concluido' ||
        statusRaw === 'concluida' ||
        statusRaw === 'finalizado' ||
        statusRaw === 'finalizada' ||
        (typeof found.concluidas === 'number' && found.concluidas > 0)
      ) {
        return true;
      }
    }
  }

  // 4. op.etapas (Objeto)
  if (op.etapas && typeof op.etapas === 'object' && !Array.isArray(op.etapas)) {
    for (const key of Object.keys(op.etapas)) {
      const normKey = normalizeValidationText(key);
      if (normKey.includes(normEtapa) || normEtapa.includes(normKey)) {
        const etapaObj = op.etapas[key];
        const statusRaw = String(etapaObj?.status || '').toLowerCase().trim();
        if (
          statusRaw === 'em_producao' ||
          statusRaw === 'em_andamento' ||
          statusRaw === 'concluido' ||
          statusRaw === 'concluida' ||
          statusRaw === 'finalizado' ||
          statusRaw === 'finalizada' ||
          etapaObj?.concluido ||
          etapaObj?.iniciado ||
          (typeof etapaObj?.concluidas === 'number' && etapaObj.concluidas > 0)
        ) {
          return true;
        }
      }
    }
  }

  // 5. Apontamentos na coleção global (em andamento ou finalizados)
  if (Array.isArray(apontamentos) && apontamentos.length > 0) {
    const cleanOp = (op.op_numero || op.numero || op.id || '').trim().toUpperCase();
    const cleanNorm = cleanOp.replace(/^OP\s*/i, '').replace(/[-_\s]/g, '');

    const hasMatch = apontamentos.some((a: any) => {
      const aOp = (a.op_numero || a.op || '').trim().toUpperCase();
      const aNorm = aOp.replace(/^OP\s*/i, '').replace(/[-_\s]/g, '');
      const matchOp = aOp === cleanOp || aNorm === cleanNorm;
      if (!matchOp) return false;

      const aptEtapa = normalizeValidationText(a.etapa_rota || a.etapaRota || a.setor || a.setorFisico || '');
      const matchesEtapa = aptEtapa.includes(normEtapa) || normEtapa.includes(aptEtapa);
      if (!matchesEtapa) return false;

      const s = String(a.status || '').toUpperCase().trim();
      return (
        s === 'EM_ANDAMENTO' ||
        s === 'EM_PRODUCAO' ||
        s === 'FINALIZADO' ||
        s === 'CONCLUIDO' ||
        Boolean((a.hora_inicio || a.horaInicio) && !a.hora_fim && !a.horaFim)
      );
    });

    if (hasMatch) return true;
  }

  // 6. op.etapaAtual
  if (op.etapaAtual) {
    const normAtual = normalizeValidationText(op.etapaAtual);
    if (normAtual.includes(normEtapa) || normEtapa.includes(normAtual)) {
      return true;
    }
  }

  return false;
}

/**
 * REGRA DE FLUXO PARALELO: Liberação antecipada de Dobra.
 * A Dobra NÃO deve exigir que o Corte ou o Laser estejam 100% concluídos.
 * Se a etapa Corte OU a etapa Laser estiver com status 'em_andamento' ou 'concluido', a Dobra está liberada.
 */
export function verificarDobraLiberada(
  op: any,
  apontamentos: any[] = []
): { dobraLiberada: boolean; motivo?: string } {
  if (!op) return { dobraLiberada: true };

  // Se Corte ou Laser iniciou ou concluiu, a Dobra está liberada
  const corteIniciado = isEtapaIniciadaOuConcluida(op, 'Corte', apontamentos);
  const laserIniciado = isEtapaIniciadaOuConcluida(op, 'Laser', apontamentos) ||
    isEtapaIniciadaOuConcluida(op, 'Corte a Laser', apontamentos);

  if (corteIniciado || laserIniciado) {
    return { dobraLiberada: true };
  }

  // Verifica se a rota possui Corte ou Laser
  const etapasPermitidas: string[] = [];
  if (Array.isArray(op.rota)) etapasPermitidas.push(...op.rota);
  if (typeof op.rota === 'string') {
    etapasPermitidas.push(...op.rota.split(/[➔\->,;|]/).map((s: string) => s.trim()));
  }
  if (etapasPermitidas.length === 0) {
    etapasPermitidas.push(...obterEtapasDaRota(op));
  }

  const etapasNorm = etapasPermitidas.map((e) => normalizeValidationText(e));
  const temCorteNaRota = etapasNorm.some((e) => e.includes('CORTE'));
  const temLaserNaRota = etapasNorm.some((e) => e.includes('LASER')) || Boolean(op.requer_laser);

  // Se não possui Corte nem Laser como etapa predecessora, está liberada
  if (!temCorteNaRota && !temLaserNaRota) {
    return { dobraLiberada: true };
  }

  return {
    dobraLiberada: false,
    motivo: 'Aguardando início da etapa Corte ou Laser'
  };
}

/**
 * REGRA DE FLUXO PARALELO: Liberação antecipada de Preparação de Folhas.
 * Elimina a dependência de lote fechado 100% concluído da Dobra.
 * Assim que a Dobra (ou Corte/Laser) estiver em andamento ou concluída, a Preparação de Folhas está liberada.
 */
export function verificarPreparacaoFolhasLiberada(
  op: any,
  apontamentos: any[] = []
): { preparacaoLiberada: boolean; motivo?: string } {
  if (!op) return { preparacaoLiberada: true };

  const dobraIniciada = isEtapaIniciadaOuConcluida(op, 'Dobra', apontamentos);
  if (dobraIniciada) {
    return { preparacaoLiberada: true };
  }

  const corteIniciado = isEtapaIniciadaOuConcluida(op, 'Corte', apontamentos);
  const laserIniciado = isEtapaIniciadaOuConcluida(op, 'Laser', apontamentos) ||
    isEtapaIniciadaOuConcluida(op, 'Corte a Laser', apontamentos);

  const etapasPermitidas: string[] = [];
  if (Array.isArray(op.rota)) etapasPermitidas.push(...op.rota);
  if (typeof op.rota === 'string') {
    etapasPermitidas.push(...op.rota.split(/[➔\->,;|]/).map((s: string) => s.trim()));
  }
  if (etapasPermitidas.length === 0) {
    etapasPermitidas.push(...obterEtapasDaRota(op));
  }

  const etapasNorm = etapasPermitidas.map((e) => normalizeValidationText(e));
  const temDobraNaRota = etapasNorm.some((e) => e.includes('DOBRA'));

  if (!temDobraNaRota && (corteIniciado || laserIniciado)) {
    return { preparacaoLiberada: true };
  }

  return {
    preparacaoLiberada: false,
    motivo: 'Aguardando início da etapa Dobra'
  };
}

/**
 * Gerador Dinâmico Oficial de Etapas da Rota por Produto
 * Define as etapas visíveis no card de status e na esteira de produção.
 */
export function obterEtapasDaRota(op: any): string[] {
  let cod = String(op?.codigoProduto || op?.cod || op?.codigo || op?.code || '').trim();
  const matchCode = cod.match(/^(\d{3})\.?(\d{4})$/);
  if (matchCode) {
    cod = `${matchCode[1]}.${matchCode[2]}`;
  }
  const desc = String(op?.descricao || op?.produto || op?.description || '').toUpperCase();

  let steps: string[] = [];

  // A) ROTA EXCLUSIVA DE LASER (["Laser"]): Âncoras Rebite Rosca, Pendurais Inox e Âncora Vai-Vem Alvenaria
  if (isRotaExclusivaLaser(op)) {
    return ['Laser'];
  }

  // B) ROTA LASER + DOBRA (["Laser", "Dobra"]): Trilhos Inox para Cortina
  if (isRotaLaserDobra(op)) {
    return ['Laser', 'Dobra'];
  }

  // C) ROTA EXCLUSIVA DE ROUTER (["Router"]): Visor de Policarbonato
  if (isRotaExclusivaRouter(op)) {
    return ['Router'];
  }

  // 1. ÂNCORAS DE FIXAÇÃO (021.xxxx ou descrição ANCORA) -> Terminal 1 (Corte/Dobra)
  if (cod.startsWith('021.') || desc.startsWith('ANCORA') || desc.includes('ANCORA')) {
    steps = ['Corte', 'Dobra'];
  }

  // 2. TRILHOS (028.xxxx)
  else if (cod.startsWith('028.') || desc.startsWith('TRILHO')) {
    steps = ['Corte de Trilho', 'Montagem de Trilho'];
  }

  // 3. FOLHAS AVULSAS (020.0009 a 020.0031 ou início FOLHA)
  else if ((cod >= '020.0009' && cod <= '020.0021') || (cod >= '020.0022' && cod <= '020.0031') || desc.startsWith('FOLHA ') || desc.startsWith('FOLHA')) {
    steps = ['Corte', 'Dobra', 'Preparação de Folha', 'Injeção de Folhas'];
  }

  // 4. BATENTES AVULSOS (020.0032 a 020.0057 ou início BAT)
  else if ((cod >= '020.0032' && cod <= '020.0057') || ['020.0005', '020.0006', '020.0007', '020.0008'].includes(cod) || desc.startsWith('BAT ') || desc.startsWith('BATENTE')) {
    steps = ['Corte', 'Dobra', 'Preparação de Batentes', 'Injeção e Finalização de Batentes'];
  }

  // 5. PORTA VAI E VEM (TODAS - PADRÃO OU FORA DE MEDIDA / FAMÍLIA 011.xxxx)
  else if (cod.startsWith('011.') || desc.includes('VAI VEM')) {
    steps = [
      'Corte',
      'Corte Alumínio',
      'Preparação Vai Vem',
      'Injeção',
      'Montagem Porta Vai-Vem'
    ];
  }

  // 6. OFFICE DOOR (GIRO OU CORRER / FAMÍLIAS 009.xxxx E 010.xxxx) - SEMPRE ESPECIAL
  else if (cod.startsWith('009.') || desc.includes('OFFICE DOOR GIR')) {
    steps = [
      'Corte',
      'Dobra',
      'Preparação de Folha',
      'Injeção de Folhas',
      'Instalação de Gaxeta',
      'Montagem Office Door Giratória'
    ];
  }
  else if (
    cod.startsWith('010.') ||
    cod === '010.0008' ||
    desc.includes('OFFICE DOOR COR') ||
    desc.includes('OFFICE-DOOR COR') ||
    (desc.includes('OFFICE DOOR') && (desc.includes('CORRER') || desc.includes('COR ')))
  ) {
    steps = [
      'Corte',
      'Corte Alumínio',
      'Preparação Office Door',
      'Injeção',
      'Router',
      'Montagem Office Door Correr'
    ];
  }

  // 7. PORTAS GIRATÓRIAS (REGRA RESTRITIVA: WHITELIST ESTRITA POR CÓDIGO)
  else if (
    cod.startsWith('001.') ||
    cod.startsWith('002.') ||
    cod.startsWith('003.') ||
    cod.startsWith('004.') ||
    desc.includes('PT GIR') ||
    desc.includes('PORTA GIR') ||
    desc.includes('GIRATORIA') ||
    desc.includes('GIRATÓRIA') ||
    desc.includes('GIRO')
  ) {
    const codLimpo = normalizarCodigo(cod);
    const ehCodigoPadrao = Boolean(
      (cod && (CODIGOS_PORTAS_GIRO_PADRAO.has(cod) || CODIGOS_GIRATORIA_PADRAO.has(cod))) ||
      (codLimpo && (CODIGOS_PORTAS_GIRO_PADRAO.has(codLimpo) || CODIGOS_GIRATORIA_PADRAO.has(codLimpo)))
    );

    if (ehCodigoPadrao) {
      // Porta Giratória Padrão (Whitelist): 2 etapas
      steps = [
        'Instalação de Gaxeta',
        'Montagem de Portas Giratórias'
      ];
    } else {
      // Porta Giratória Especial (Fora da Whitelist): ROTA COMPLETA de fabricação
      steps = [
        'Corte',
        'Dobra',
        'Preparação de Folha',
        'Injeção',
        'Instalação de Gaxeta',
        'Montagem de Portas Giratória Padrão e Especial'
      ];
    }
  }

  // 8. PORTAS DE CORRER (PADRÃO, ESPECIAL E EMENDADAS)
  else if (
    cod.startsWith('005.') ||
    cod.startsWith('006.') ||
    cod.startsWith('007.') ||
    cod.startsWith('008.') ||
    cod.startsWith('029.') ||
    cod.startsWith('025.') ||
    desc.includes('PT COR') ||
    desc.includes('PORTA CORRER') ||
    desc.includes('PORTA DE CORRER') ||
    desc.includes('EMENDAD')
  ) {
    const codLimpo = normalizarCodigo(cod);
    const ehInox = 
      desc.includes('I304') || 
      desc.includes('I430') || 
      desc.includes('INOX') || 
      cod.startsWith('006.') || 
      cod.startsWith('008.');

    const ehSuperCong = desc.includes('SUPER CONG') || desc.includes('SUPER CONGELADO') || cod === '007.0011';
    const ehEmendada = desc.includes('EMENDAD') || cod.startsWith('029.') || cod.startsWith('025.');

    // WHITELIST ESTRITA POR CÓDIGO DO PRODUTO:
    // Uma porta de correr SÓ recebe rota curta de 1 etapa se constar explicitamente na Whitelist (005.* e 007.*) ou isPortaCorrerPadrao
    // E não contiver indicadores especiais (Inox, Emendada, etc.)
    const ehCodigoPadrao = (
      isPortaCorrerPadrao(cod || codLimpo, desc) ||
      Boolean(
        (cod && (CODIGOS_PORTAS_CORRER_PADRAO.has(cod) || CODIGOS_PADRAO_CORRER.has(cod))) ||
        (codLimpo && (CODIGOS_PORTAS_CORRER_PADRAO.has(codLimpo) || CODIGOS_PADRAO_CORRER.has(codLimpo)))
      )
    ) &&
      !ehInox &&
      !ehEmendada &&
      !desc.includes('ESP') &&
      !desc.includes('ESPECIAL') &&
      !cod.startsWith('006.') &&
      !cod.startsWith('008.') &&
      !cod.startsWith('029.') &&
      !cod.startsWith('025.');

    if (ehCodigoPadrao) {
      // Porta de Correr Padrão -> 1 etapa direta (Terminal 4)
      steps = [
        'Montagem Portas de Correr Padrão e Especial'
      ];
    } else {
      // Porta de Correr Especial / Sob Medida / Fora da Whitelist (ex: 005.0149) -> 5 etapas completas
      steps = [
        'Corte',
        'Dobra',
        'Preparação de Folha',
        'Injeção',
        'Montagem Portas de Correr Padrão e Especial'
      ];
    }
  }

  // 9. DEMAIS ESPECÍFICOS INDUSTRIAIS
  else if (cod.startsWith('022.') || desc.startsWith('PERFIL PP')) steps = ['Corte', 'Dobra'];
  else if (cod.startsWith('014.') || desc.includes('ABRIGO DOCA')) steps = ['Corte', 'Solda', 'Montagem Abrigo Doca'];
  else if (cod.startsWith('015.') || cod === '090.0001') steps = ['Montagem Estante'];
  else if (cod === '090.0004' || cod === '090.0005') steps = ['Laser', 'Dobra', 'Solda', 'Montagem Estante'];
  else if (cod === '090.0002') steps = ['Corte', 'Solda', 'Montagem Estante'];
  else steps = ['Montagem Portas de Correr Padrão e Especial'];

  // Encaminhar para Laser (sob demanda via checkbox Requer Laser no Terminal 1)
  const temLaser = Boolean(op?.requer_laser || op?.requerLaser);
  if (temLaser && !steps.some((s) => s.toUpperCase().includes('LASER'))) {
    const corteIdx = steps.findIndex((s) => s.toUpperCase().includes('CORTE'));
    if (corteIdx >= 0) {
      steps.splice(corteIdx + 1, 0, 'Laser');
    } else {
      const dobraIdx = steps.findIndex((s) => s.toUpperCase().includes('DOBRA'));
      if (dobraIdx >= 0) {
        steps.splice(dobraIdx, 0, 'Laser');
      } else {
        steps.unshift('Laser');
      }
    }
  }

  // Encaminhar para Router (sob demanda para Vai-Vem e Office Door)
  const isEligible = isEligibleForRouter(op);
  const temRouter = isEligible && (
    Boolean(op?.encaminhar_router) ||
    Boolean(op?.requer_router) ||
    (Array.isArray(op?.etapas) && op.etapas.includes('Router')) ||
    op?.etapaAtual === 'Router'
  );

  if (temRouter && !steps.includes('Router')) {
    const injIdx = steps.findIndex((s: string) => s.includes('Injeção') || s.includes('Injecao'));
    if (injIdx !== -1) {
      steps.splice(injIdx + 1, 0, 'Router');
    } else {
      steps.push('Router');
    }
  }

  return steps;
}

/**
 * Define a rota do produto com prioridade absoluta por código (Whitelist).
 * Uma porta giratória SÓ recebe rota curta de 2 etapas se o código estiver
 * presente explicitamente em CODIGOS_GIRATORIA_PADRAO. Caso contrário,
 * é obrigatoriamente Porta Giratória Especial (Rota Completa de 6 etapas).
 */
export function definirRotaProduto(op: {
  codigo?: string;
  codigoProduto?: string;
  cod?: string;
  descricao?: string;
  produto?: string;
}): { familia: string; rota: string[] } {
  const codRaw = String(op?.codigoProduto || (op as any)?.cod || op?.codigo || '').trim();
  const desc = String(op?.descricao || (op as any)?.produto || '').toUpperCase();
  let cod = codRaw;
  if (!cod && desc) {
    const match = desc.match(/\b(\d{3}[\.-]?\d{4})\b/);
    if (match) cod = match[1];
  }
  const codLimpo = normalizarCodigo(cod);

  // Subcomponentes delegam diretamente para obterEtapasDaRota
  const ehSubcomponenteOuOutro =
    isRotaExclusivaLaser(op) ||
    isRotaLaserDobra(op) ||
    isRotaExclusivaRouter(op) ||
    codLimpo.startsWith('020') ||
    codLimpo.startsWith('021') ||
    codLimpo.startsWith('028') ||
    codLimpo.startsWith('011') ||
    codLimpo.startsWith('009') ||
    codLimpo.startsWith('010') ||
    codLimpo.startsWith('014') ||
    codLimpo.startsWith('015') ||
    codLimpo.startsWith('022') ||
    codLimpo.startsWith('024') ||
    codLimpo.startsWith('027') ||
    codLimpo.startsWith('090') ||
    desc.startsWith('BAT') ||
    desc.startsWith('BATENTE') ||
    desc.startsWith('FOLHA') ||
    desc.startsWith('TRILHO') ||
    desc.includes('ANCORA') ||
    desc.includes('PENDURAL') ||
    desc.includes('VISOR') ||
    desc.includes('VAI VEM') ||
    desc.includes('OFFICE DOOR') ||
    desc.includes('ABRIGO DOCA') ||
    desc.includes('ESTANTE') ||
    desc.startsWith('PERFIL PP');

  if (ehSubcomponenteOuOutro) {
    let familia = 'Geral';
    if (isRotaExclusivaLaser(op)) familia = 'Laser CNC';
    else if (isRotaLaserDobra(op)) familia = 'Laser e Dobra';
    else if (isRotaExclusivaRouter(op)) familia = 'Router CNC';
    else if (codLimpo.startsWith('020') || desc.startsWith('BAT') || desc.startsWith('BATENTE')) familia = 'Batente';
    else if (codLimpo.startsWith('028') || desc.startsWith('TRILHO')) familia = 'Trilho';
    else if (desc.startsWith('FOLHA')) familia = 'Folha Avulsa';
    else if (codLimpo.startsWith('021') || desc.includes('ANCORA')) familia = 'Âncora';
    else if (codLimpo.startsWith('011') || desc.includes('VAI VEM')) familia = 'Porta Vai e Vem';
    else if (codLimpo.startsWith('009') || codLimpo.startsWith('010') || desc.includes('OFFICE DOOR')) familia = 'Office Door';

    return {
      familia,
      rota: obterEtapasDaRota(op)
    };
  }

  // 1. Verifica se é da família Giratória
  const ehFamiliaGiratoria =
    desc.includes('PT GIR') ||
    desc.includes('PORTA GIRATORIA') ||
    desc.includes('PORTA GIRATÓRIA') ||
    desc.includes('PORTA GIR') ||
    desc.includes('GIRATÓRIA') ||
    desc.includes('GIRATORIA') ||
    desc.includes('GIRO') ||
    codLimpo.startsWith('001') ||
    codLimpo.startsWith('002') ||
    codLimpo.startsWith('003') ||
    codLimpo.startsWith('004');

  if (ehFamiliaGiratoria) {
    const ehCodigoPadrao = Boolean(
      (cod && (CODIGOS_PORTAS_GIRO_PADRAO.has(cod) || CODIGOS_GIRATORIA_PADRAO.has(cod))) ||
      (codRaw && (CODIGOS_PORTAS_GIRO_PADRAO.has(codRaw) || CODIGOS_GIRATORIA_PADRAO.has(codRaw))) ||
      (codLimpo && (CODIGOS_PORTAS_GIRO_PADRAO.has(codLimpo) || CODIGOS_GIRATORIA_PADRAO.has(codLimpo)))
    );

    if (ehCodigoPadrao) {
      return {
        familia: 'Porta Giratória Padrão',
        rota: [
          'Instalação de Gaxeta',
          'Montagem de Portas Giratórias'
        ]
      };
    }

    // Se NÃO for código padrão (como 003.0140), é OBRIGATORIAMENTE Especial (Rota Completa)
    return {
      familia: 'Porta Giratória Especial',
      rota: [
        'Corte',
        'Dobra',
        'Preparação de Folha',
        'Injeção',
        'Instalação de Gaxeta',
        'Montagem de Portas Giratória Padrão e Especial'
      ]
    };
  }

  // 2. Verifica se é da família de Correr
  const ehFamiliaCorrer =
    desc.includes('PT COR') ||
    desc.includes('PORTA CORRER') ||
    desc.includes('PORTA DE CORRER') ||
    desc.includes('EMENDAD') ||
    codLimpo.startsWith('005') ||
    codLimpo.startsWith('006') ||
    codLimpo.startsWith('007') ||
    codLimpo.startsWith('008') ||
    codLimpo.startsWith('029') ||
    codLimpo.startsWith('025');

  if (ehFamiliaCorrer) {
    const ehInox = 
      desc.includes('I304') || 
      desc.includes('I430') || 
      desc.includes('INOX') || 
      cod.startsWith('006.') || 
      cod.startsWith('008.');
    const ehSuperCong = desc.includes('SUPER CONG') || desc.includes('SUPER CONGELADO') || cod === '007.0011';
    const ehEmendada = desc.includes('EMENDAD') || cod.startsWith('029.') || cod.startsWith('025.');

    const ehCodigoPadrao = (
      isPortaCorrerPadrao(cod || codRaw || codLimpo, desc) ||
      Boolean(
        (cod && (CODIGOS_PORTAS_CORRER_PADRAO.has(cod) || CODIGOS_PADRAO_CORRER.has(cod))) ||
        (codRaw && (CODIGOS_PORTAS_CORRER_PADRAO.has(codRaw) || CODIGOS_PADRAO_CORRER.has(codRaw))) ||
        (codLimpo && (CODIGOS_PORTAS_CORRER_PADRAO.has(codLimpo) || CODIGOS_PADRAO_CORRER.has(codLimpo)))
      )
    ) &&
      !ehInox &&
      !ehEmendada &&
      !desc.includes('ESP') &&
      !desc.includes('ESPECIAL') &&
      !cod.startsWith('006.') &&
      !cod.startsWith('008.') &&
      !cod.startsWith('029.') &&
      !cod.startsWith('025.');

    if (ehCodigoPadrao) {
      return {
        familia: 'Porta de Correr Padrão',
        rota: ['Montagem Portas de Correr Padrão e Especial']
      };
    }

    return {
      familia: 'Porta de Correr Especial',
      rota: [
        'Corte',
        'Dobra',
        'Preparação de Folha',
        'Injeção',
        'Montagem Portas de Correr Padrão e Especial'
      ]
    };
  }

  // Demais famílias delegam para o roteador central
  return {
    familia: 'Outros',
    rota: obterEtapasDaRota(op)
  };
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

  // Blindagem: se for porta frigorífica ou folha avulsa, NUNCA é batente avulso
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
    norm.includes('PORTA DE CORRER') ||
    desc.startsWith('FOLHA') ||
    norm.startsWith('FOLHA') ||
    (code >= '020.0009' && code <= '020.0031')
  ) {
    return false;
  }

  const isBatenteCode =
    (code >= '020.0032' && code <= '020.0057') ||
    ['020.0005', '020.0006', '020.0007', '020.0008'].includes(code);

  return (
    isBatenteCode ||
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

  const normPostoUpper = postoSelecionado.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[-_]/g, ' ');

  // REGRA DE FLUXO DIRETO / SOB DEMANDA: Laser no Terminal 1
  const isLaser = normPostoUpper.includes('LASER');
  if (isLaser) {
    if (Boolean(op?.requer_laser) || Boolean(op?.requerLaser) || terminalId === 1) {
      return { valido: true };
    }
  }

  // REGRA DE FLUXO PARALELO: Liberação antecipada de Dobra
  const isDobra = normPostoUpper.includes('DOBRA');
  if (isDobra) {
    const etapasPermitidas: string[] = [];
    if (Array.isArray(op?.rota)) etapasPermitidas.push(...op.rota);
    if (typeof op?.rota === 'string') {
      etapasPermitidas.push(...op.rota.split(/[➔\->,;|]/).map((s: string) => s.trim()));
    }
    if (etapasPermitidas.length === 0) {
      etapasPermitidas.push(...obterEtapasDaRota(op));
    }

    const pertence = etapaPertenceARota(postoSelecionado, etapasPermitidas) ||
      etapasPermitidas.some(e => normalizeValidationText(e).includes('DOBRA'));

    if (!pertence) {
      return {
        valido: false,
        motivo: `O setor ${postoSelecionado} não consta na rota de produção desta peça (${etapasPermitidas.join(' ➔ ')}).`
      };
    }

    const dobraCheck = verificarDobraLiberada(op, apontamentos);
    if (!dobraCheck.dobraLiberada) {
      return {
        valido: false,
        motivo: dobraCheck.motivo || 'Aguardando início da etapa Corte ou Laser'
      };
    }
    return { valido: true };
  }

  // REGRA DE FLUXO PARALELO: Liberação antecipada de Preparação de Folhas
  const isPrepFolhas = (normPostoUpper.includes('PREPARACAO') && normPostoUpper.includes('FOLHA')) ||
    normPostoUpper === 'PREPARACAO DE FOLHAS' ||
    normPostoUpper === 'PREPARACAO DE FOLHA';
  if (isPrepFolhas) {
    const etapasPermitidas: string[] = [];
    if (Array.isArray(op?.rota)) etapasPermitidas.push(...op.rota);
    if (typeof op?.rota === 'string') {
      etapasPermitidas.push(...op.rota.split(/[➔\->,;|]/).map((s: string) => s.trim()));
    }
    if (etapasPermitidas.length === 0) {
      etapasPermitidas.push(...obterEtapasDaRota(op));
    }

    const pertence = etapaPertenceARota(postoSelecionado, etapasPermitidas) ||
      etapasPermitidas.some(e => normalizeValidationText(e).includes('PREPARACAO'));

    if (!pertence) {
      return {
        valido: false,
        motivo: `O setor ${postoSelecionado} não consta na rota de produção desta peça (${etapasPermitidas.join(' ➔ ')}).`
      };
    }

    const prepCheck = verificarPreparacaoFolhasLiberada(op, apontamentos);
    if (!prepCheck.preparacaoLiberada) {
      return {
        valido: false,
        motivo: prepCheck.motivo || 'Aguardando início da etapa Dobra'
      };
    }
    return { valido: true };
  }

  // 0. LINHA SUPER CONGELADA E PORTAS ESPECIAIS (FABRICAÇÃO COMPLETA)
  const codNorm = String(op?.codigoProduto || op?.cod || op?.codigo || '').trim();
  const descNorm = String(op?.descricao || op?.produto || '').toUpperCase();

  const ehPadraoCorrer = isPortaCorrerPadrao(codNorm, descNorm);
  const ehSuperCongOuEspecial = 
    !ehPadraoCorrer && (
      codNorm.startsWith('007.') || 
      codNorm.startsWith('003.') || 
      codNorm.startsWith('009.') || 
      codNorm.startsWith('010.') || 
      codNorm.startsWith('011.') || 
      codNorm.startsWith('002.') || 
      codNorm.startsWith('004.') || 
      codNorm.startsWith('006.') || 
      codNorm.startsWith('008.') || 
      descNorm.includes('SUPER CONG') ||
      descNorm.includes('SUPER CONGELADO') ||
      descNorm.includes('VAI VEM') ||
      descNorm.includes('OFFICE DOOR') ||
      descNorm.includes('INOX') ||
      descNorm.includes('I304') ||
      descNorm.includes('I430')
    );

  if (ehSuperCongOuEspecial) {
    const etapasPermitidas = obterEtapasDaRota(op);

    // REGRA DE BLOQUEIO CONDICIONAL: Montagem de Vai-Vem e Office Door (Terminal 5)
    const normPostoUpper = postoSelecionado.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[-_]/g, ' ');
    const isPostoMontagem = normPostoUpper.includes('MONTAGEM') || normPostoUpper.includes('FINALIZACAO');
    if (isPostoMontagem && isVaiVemOuOfficeDoor(op)) {
      const montagemCheck = verificarLiberacaoMontagemVaiVemOuOfficeDoor(op, apontamentos);
      if (!montagemCheck.liberada) {
        return {
          valido: false,
          motivo: montagemCheck.motivo
        };
      }
      return { valido: true };
    }

    if (etapaPertenceARota(postoSelecionado, etapasPermitidas)) {
      return { valido: true };
    }

    const normPosto = postoSelecionado.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[-_]/g, ' ');
    const isPostoValido = etapasPermitidas.some(step => {
      const normStep = step.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[-_]/g, ' ');
      if (normPosto === normStep) return true;
      if (normStep.includes('CORTE') && normPosto.includes('CORTE')) return true;
      if (normStep.includes('DOBRA') && normPosto.includes('DOBRA')) return true;
      if (normStep.includes('LASER') && normPosto.includes('LASER')) return true;
      if (normStep.includes('PREPARACAO') && normPosto.includes('PREPARACAO')) return true;
      if (normStep.includes('INJECAO') && normPosto.includes('INJECAO')) return true;
      if (normStep.includes('GAXETA') && normPosto.includes('GAXETA')) return true;
      if (normStep.includes('MONTAGEM') && normPosto.includes('MONTAGEM')) {
        if (normStep.includes('VAI VEM') || normPosto.includes('VAI VEM')) {
          return normStep.includes('VAI VEM') && normPosto.includes('VAI VEM');
        }
        return true;
      }
      if (normStep.includes('OFFICE DOOR') && normPosto.includes('OFFICE DOOR')) return true;
      if (normStep.includes('VAI VEM') && normPosto.includes('VAI VEM')) return true;
      if (normStep.includes('ROUTER') && normPosto.includes('ROUTER')) return true;
      return false;
    }) || 
    (normPosto.includes('LASER') && (Boolean(op?.requer_laser) || terminalId === 1 || isFolhaOrder(op))) ||
    (normPosto.includes('ROUTER') && (Boolean(op?.requer_router) || Boolean(op?.encaminhar_router) || terminalId === 5 || isEligibleForRouter(op)));

    if (isPostoValido) {
      return { valido: true };
    } else {
      return {
        valido: false,
        motivo: `O setor ${postoSelecionado} não consta na rota de produção desta peça (${etapasPermitidas.join(' ➔ ')}).`
      };
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
    if (postoSelecionado === 'Dobra' && !isEtapaIniciadaOuConcluida(op, 'Laser', apontamentos) && !isEtapaIniciadaOuConcluida(op, 'Corte', apontamentos)) {
      return { valido: false, motivo: 'A Dobra do Quadro Estante só pode ser iniciada após o início do Laser ou Corte (T1).' };
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
    if (postoSelecionado === 'Dobra' && !isEtapaIniciadaOuConcluida(op, 'Corte', apontamentos) && !isEtapaIniciadaOuConcluida(op, 'Laser', apontamentos)) {
      return { valido: false, motivo: 'A Dobra do Perfil PP só pode ser iniciada após o início do Corte (T1).' };
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
