const { parse } = require('node-html-parser');

// =========================================================================
// TABELAS E WHITELISTS OFICIAIS METALRIB
// =========================================================================

// Portas Giratórias Resfriados (001) e Congelados (003) - Whitelist Oficial Metalrib
const CODIGOS_PORTAS_GIRO_PADRAO = new Set([
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
  // Versões normalizadas sem pontos (001)
  '0010100', '0010101', '0010102', '0010103', '0010104', '0010105',
  '0010106', '0010107', '0010108', '0010109', '0010110', '0010111',
  '0010112', '0010113', '0010114', '0010115', '0010116', '0010117',
  '0010118', '0010119', '0010120', '0010121', '0010122', '0010123',
  '0010124', '0010125', '0010126', '0010127', '0010128', '0010129',
  '0010130', '0010131', '0010132', '0010134', '0010135', '0010136',
  '0010137', '0010138',
  // Versões normalizadas sem pontos (003)
  '0030100', '0030101', '0030102', '0030103', '0030104', '0030105',
  '0030106', '0030107', '0030108', '0030109', '0030110', '0030111',
  '0030112', '0030113', '0030114', '0030115', '0030116', '0030117',
  '0030118', '0030119', '0030120', '0030121', '0030122', '0030123',
  '0030124', '0030125', '0030126', '0030127', '0030128', '0030129',
  '0030130', '0030131', '0030132', '0030134', '0030135', '0030136',
  '0030137', '0030138'
]);

// Portas de Correr Padrão (Whitelist fechada de catálogo: 0100 a 0111)
const CODIGOS_PORTAS_CORRER_PADRAO = new Set([
  // Resfriadas (005.*)
  '005.0100', '005.0101', '005.0102', '005.0103', '005.0104',
  '005.0105', '005.0106', '005.0107', '005.0110', '005.0111',
  // Congeladas (007.*)
  '007.0100', '007.0101', '007.0102', '007.0103', '007.0104',
  '007.0105', '007.0106', '007.0107', '007.0108', '007.0109',
  '007.0110', '007.0111',
  // Versões normalizadas sem pontos (005)
  '0050100', '0050101', '0050102', '0050103', '0050104',
  '0050105', '0050106', '0050107', '0050110', '0050111',
  // Versões normalizadas sem pontos (007)
  '0070100', '0070101', '0070102', '0070103', '0070104',
  '0070105', '0070106', '0070107', '0070108', '0070109',
  '0070110', '0070111'
]);

// Códigos exclusivos Laser
const CODIGOS_ROTA_EXCLUSIVA_LASER = [
  '021.0037', '021.0038', '024.0321', '024.0320', '024.0020', '024.0019', '021.0049'
];

// Códigos Laser + Dobra
const CODIGOS_ROTA_LASER_DOBRA = [
  '024.0022', '024.0021'
];

// Códigos exclusivos Router
const CODIGOS_ROTA_EXCLUSIVA_ROUTER = [
  '027.0006'
];

// =========================================================================
// FUNÇÕES AUXILIARES DE NORMALIZAÇÃO E LIMPEZA
// =========================================================================

const normalizarIdOP = (op) => String(op || '').toUpperCase().replace(/^(\s*OP\s*)+/i, '').trim();

const formatarNumeroOP = (op) => {
  const clean = normalizarIdOP(op);
  return clean ? `OP ${clean}` : '';
};

function normalizeHeader(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

function cleanCellText(cell) {
  if (!cell) return '';
  const text = typeof cell === 'string' ? cell : (cell.textContent || '');
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

function isValidDataValue(val) {
  if (!val) return false;
  const clean = val.replace(/\s+/g, '').replace(/\u00a0/g, '').replace(/&nbsp;/gi, '');
  return (
    clean !== '' &&
    clean !== '-' &&
    clean !== '—' &&
    clean.toLowerCase() !== 'null' &&
    clean.toLowerCase() !== 'undefined'
  );
}

function isDescricaoValida(desc) {
  if (!desc || typeof desc !== 'string') return false;
  const t = desc.trim().toUpperCase();
  if (!isValidDataValue(t)) return false;
  if (t.endsWith(':')) return false;
  if (
    t.includes('COLUNA') ||
    t.includes('LINHA') ||
    t.includes('FILTRO') ||
    t.includes('DADO') ||
    t.includes('EXPORTAR') ||
    t.includes('DETALHE') ||
    t.includes('INCLUIR') ||
    t.includes('ZOHO') ||
    t.includes('TABELA DINAMICA') ||
    t.includes('TABELA DINÂMICA')
  ) return false;
  if (t.startsWith('ORDEM OP') || t.startsWith('ORDEM DE PRODU') || t.startsWith('PRODUTO OP') || t.startsWith('OP ')) return false;
  if (t.startsWith('PRODUTO 0') || (t.startsWith('PRODUTO ') && t.includes('-'))) return false;
  if (t === 'PRODUTO' || t === 'DESCRIÇÃO' || t === 'DESCRICAO' || t === 'ITEM' || t === 'LIBERADA' || t === 'EM PRODUÇÃO' || t === 'FINALIZADA') return false;
  return true;
}

function parseDimensions(desc) {
  if (!desc) return null;
  const regex = /(\d+(?:[.,]\d+)?)\s*(?:a|alt|h|mm)?\s*[xX*]\s*(\d+(?:[.,]\d+)?)\s*(?:l|larg|w|mm)?/i;
  const match = desc.match(regex);
  if (!match) return null;

  let h = parseFloat(match[1].replace(',', '.'));
  let w = parseFloat(match[2].replace(',', '.'));
  if (isNaN(h) || isNaN(w) || h <= 0 || w <= 0) return null;

  if (h > 50) h = h / 1000;
  if (w > 50) w = w / 1000;

  if (h < 0.3 || h > 10 || w < 0.3 || w > 10) return null;

  const area = Number((h * w).toFixed(4));
  return { heightMeters: h, widthMeters: w, area };
}

function deducePhysicalUnitsFromM2(descricao, m2) {
  if (!m2 || m2 <= 0) return 1;

  const dims = parseDimensions(descricao);
  if (dims && dims.area > 0.05) {
    const rawSets = m2 / dims.area;
    const isVaiVem = descricao.toUpperCase().includes('VAI VEM') || descricao.toUpperCase().includes('VV');

    const roundSets = Math.round(rawSets);
    if (Math.abs(rawSets - roundSets) < 0.15 && roundSets >= 1) {
      return isVaiVem ? roundSets * 2 : roundSets;
    }

    const leafArea = dims.area / 2;
    const rawLeaves = m2 / leafArea;
    const roundLeaves = Math.round(rawLeaves);
    if (Math.abs(rawLeaves - roundLeaves) < 0.15 && roundLeaves >= 1) {
      return roundLeaves;
    }
  }

  const rounded = Math.round(m2);
  return rounded >= 1 ? rounded : 1;
}

function parseDateBR(dateStr) {
  if (!dateStr || dateStr === '—' || dateStr.trim() === '') return null;
  const parts = dateStr.trim().split(/[\/\.-]/);
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  let year = parseInt(parts[2], 10);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  if (year < 100) year += 2000;
  const date = new Date(year, month, day);
  return isNaN(date.getTime()) ? null : date;
}

function calculateDeadlineInfo(dataEntrega) {
  if (!dataEntrega || dataEntrega === '—' || !dataEntrega.trim()) {
    return { isDelayed: false, daysDiff: 0, label: 'Sem Prazo' };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDate = parseDateBR(dataEntrega);
  if (targetDate) {
    targetDate.setHours(0, 0, 0, 0);
    const diffTime = today.getTime() - targetDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays > 0) {
      return { isDelayed: diffDays <= 60, daysDiff: -diffDays, label: `${diffDays}d atraso` };
    }
    return { isDelayed: false, daysDiff: Math.abs(diffDays), label: 'No Prazo' };
  }
  return { isDelayed: false, daysDiff: 0, label: dataEntrega };
}

// =========================================================================
// REGRAS DE ROTEAMENTO INDUSTRIAL METALRIB
// =========================================================================

function normalizarCod(c) {
  return String(c || '').replace(/\D/g, '');
}

function normalizarTexto(t) {
  return String(t || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isLaserExclusivo(codigo, descricao) {
  const cRaw = String(codigo || '').trim();
  const cNorm = normalizarCod(cRaw);
  if (CODIGOS_ROTA_EXCLUSIVA_LASER.some(code => cRaw === code || cNorm === normalizarCod(code))) {
    return true;
  }
  const desc = normalizarTexto(descricao);
  if (desc.includes('ANCORA REBITE ROSCA') || desc.includes('ANCORA VAI VEM ALVENARIA')) {
    return true;
  }
  if (desc.includes('PENDURAL') && (desc.includes('INOX') || desc.includes('CORTINA'))) {
    return true;
  }
  return false;
}

function isLaserDobra(codigo, descricao) {
  const cRaw = String(codigo || '').trim();
  const cNorm = normalizarCod(cRaw);
  if (CODIGOS_ROTA_LASER_DOBRA.some(code => cRaw === code || cNorm === normalizarCod(code))) {
    return true;
  }
  const desc = normalizarTexto(descricao);
  if (desc.includes('TRILHO INOX') && desc.includes('CORTINA')) {
    return true;
  }
  return false;
}

function isRouterExclusivo(codigo, descricao) {
  const cRaw = String(codigo || '').trim();
  const cNorm = normalizarCod(cRaw);
  if (CODIGOS_ROTA_EXCLUSIVA_ROUTER.some(code => cRaw === code || cNorm === normalizarCod(code))) {
    return true;
  }
  const desc = normalizarTexto(descricao);
  if (desc.includes('VISOR POLICARBONATO') || desc.includes('VISOR DE POLICARBONATO')) {
    return true;
  }
  return false;
}

function isOfficeDoorCorrer(codigo, descricao, tipoOrdem) {
  const cod = String(codigo || '').trim();
  const desc = normalizarTexto(descricao);
  const tipo = normalizarTexto(tipoOrdem);

  if (cod.startsWith('010.') || cod.startsWith('010') || cod === '010.0008') return true;
  if (desc.includes('OFFICE DOOR COR') || desc.includes('OFFICE-DOOR COR')) return true;
  if ((desc.includes('OFFICE DOOR') || desc.includes('OFFICE-DOOR') || desc.includes('OFFICE') || tipo.includes('OFFICE')) && 
      (desc.includes('CORRER') || desc.includes('COR ') || desc.endsWith(' COR') || desc.includes('CORR') || tipo.includes('CORRER'))) {
    return true;
  }
  return false;
}

function isOfficeDoorGiro(codigo, descricao, tipoOrdem) {
  if (isOfficeDoorCorrer(codigo, descricao, tipoOrdem)) return false;
  const cod = String(codigo || '').trim();
  const desc = normalizarTexto(descricao);
  const tipo = normalizarTexto(tipoOrdem);

  if (cod.startsWith('009.') || cod.startsWith('009')) return true;
  if (desc.includes('OFFICE DOOR GIR') || desc.includes('OFFICE-DOOR GIR')) return true;
  if (desc.includes('OFFICE DOOR') || desc.includes('OFFICE-DOOR') || desc.includes('OFFICE') || tipo.includes('OFFICE')) {
    return true;
  }
  return false;
}

function processarRotaProduto(op) {
  const codRaw = String(op.codigoProduto || op.codigo || '').trim();
  const codNormalizado = codRaw.replace(/[^0-9]/g, '');
  const desc = String(op.descricao || '').toUpperCase();
  const tipoOrdem = String(op.tipoOrdem || '');

  // A) Rota exclusiva Laser
  if (isLaserExclusivo(codRaw, desc)) {
    return {
      familia: 'Laser CNC',
      tipoMontagem: 'Laser CNC Exclusivo',
      rota: ['Laser'],
      statusAtual: 'AGUARDANDO INÍCIO EM: LASER',
      requerLaser: true
    };
  }

  // B) Rota Laser + Dobra
  if (isLaserDobra(codRaw, desc)) {
    return {
      familia: 'Laser e Dobra',
      tipoMontagem: 'Laser e Dobra',
      rota: ['Laser', 'Dobra'],
      statusAtual: 'AGUARDANDO INÍCIO EM: LASER',
      requerLaser: true
    };
  }

  // C) Rota exclusiva Router
  if (isRouterExclusivo(codRaw, desc)) {
    return {
      familia: 'Router CNC',
      tipoMontagem: 'Router CNC Exclusivo',
      rota: ['Router'],
      statusAtual: 'AGUARDANDO INÍCIO EM: ROUTER',
      requerRouter: true
    };
  }

  // 1. Batentes (020.xxxx / BAT - Padrão, Inox e com Resistência)
  if (
    (codNormalizado.startsWith('020') && (desc.startsWith('BAT') || desc.startsWith('BATENTE') || parseInt(codNormalizado.slice(3) || '0', 10) >= 32 || ['0200005', '0200006', '0200007', '0200008'].includes(codNormalizado))) ||
    desc.startsWith('BAT ') ||
    desc.startsWith('BAT-') ||
    desc.startsWith('BAT_') ||
    desc.startsWith('BATENTE') ||
    (desc.includes('BATENTE') && !desc.startsWith('PT ') && !desc.startsWith('PORTA '))
  ) {
    return {
      familia: 'Batente',
      tipoMontagem: 'Batente',
      rota: ['Corte', 'Dobra', 'Preparação de Batentes', 'Injeção e Finalização de Batentes'],
      statusAtual: 'AGUARDANDO INÍCIO EM: Corte'
    };
  }

  // 2. Trilhos (028.xxxx / TRILHO)
  if (codNormalizado.startsWith('028') || desc.startsWith('TRILHO')) {
    return {
      familia: 'Trilho',
      tipoMontagem: 'Trilho',
      rota: ['Corte de Trilho', 'Montagem de Trilho'],
      statusAtual: 'AGUARDANDO INÍCIO EM: Corte de Trilho'
    };
  }

  // 3. Folhas Avulsas (020.0009 a 020.0031 / FOLHA)
  if (desc.startsWith('FOLHA') || (codNormalizado.startsWith('020') && parseInt(codNormalizado.slice(3) || '0', 10) <= 31)) {
    return {
      familia: 'Folha Avulsa',
      tipoMontagem: 'Folha Avulsa',
      rota: ['Corte', 'Dobra', 'Preparação de Folha', 'Injeção de Folhas'],
      statusAtual: 'AGUARDANDO INÍCIO EM: Corte'
    };
  }

  // 4. Âncoras (021.xxxx / ANCORA)
  if (codNormalizado.startsWith('021') || desc.includes('ANCORA')) {
    return {
      familia: 'Âncora',
      tipoMontagem: 'Âncora',
      rota: ['Corte', 'Dobra'],
      statusAtual: 'AGUARDANDO INÍCIO EM: Corte'
    };
  }

  // 5. Porta Vai e Vem (Família 011 / VAI VEM / VV)
  if (codNormalizado.startsWith('011') || desc.includes('VAI VEM') || desc.includes('VV')) {
    return {
      familia: 'Porta Vai e Vem',
      tipoMontagem: 'Porta Vai e Vem',
      rota: ['Corte', 'Corte Alumínio', 'Preparação Vai Vem', 'Injeção', 'Montagem Porta Vai-Vem'],
      statusAtual: 'AGUARDANDO INÍCIO EM: Corte'
    };
  }

  // 6. Office Door de Correr (Família 010 / OFFICE DOOR CORRER)
  if (isOfficeDoorCorrer(codRaw, desc, tipoOrdem)) {
    const querRouter = Boolean(op.requerRouter || op.requer_router || op.encaminhar_router);
    const rota = querRouter
      ? ['Corte', 'Corte Alumínio', 'Preparação Office Door Correr', 'Injeção', 'Router', 'Montagem Office de Correr']
      : ['Corte', 'Corte Alumínio', 'Preparação Office Door Correr', 'Injeção', 'Montagem Office de Correr'];
    return {
      familia: 'Porta Office Door de Correr',
      tipoMontagem: 'Porta Office Door de Correr',
      rota,
      statusAtual: 'AGUARDANDO INÍCIO EM: Corte'
    };
  }

  // 7. Office Door de Giro (Família 009 / OFFICE DOOR GIRO)
  if (isOfficeDoorGiro(codRaw, desc, tipoOrdem)) {
    const querLaser = Boolean(op.requerLaser || op.requer_laser);
    const querRouter = Boolean(op.requerRouter || op.requer_router || op.encaminhar_router);
    const rota = ['Corte'];
    if (querLaser) rota.push('Laser');
    rota.push('Dobra', 'Preparação de Folha', 'Injeção de Folhas');
    if (querRouter) rota.push('Router');
    rota.push('Instalação de Gaxeta', 'Montagem de Office Door Giro');
    return {
      familia: 'Porta Office Door de Giro',
      tipoMontagem: 'Porta Office Door de Giro',
      rota,
      statusAtual: 'AGUARDANDO INÍCIO EM: Corte'
    };
  }

  // 8. Portas Giratórias (Exclui Office Door)
  const ehGiratoria =
    !isOfficeDoorGiro(codRaw, desc, tipoOrdem) &&
    !desc.includes('OFFICE DOOR') &&
    !desc.includes('OFFICE-DOOR') &&
    (
      desc.includes('PT GIR') ||
      desc.includes('PORTA GIR') ||
      desc.includes('GIRATORIA') ||
      desc.includes('GIRATÓRIA') ||
      desc.includes('GIRO') ||
      codNormalizado.startsWith('001') ||
      codNormalizado.startsWith('002') ||
      codNormalizado.startsWith('003') ||
      codNormalizado.startsWith('004')
    );

  if (ehGiratoria) {
    const ehPadrao = CODIGOS_PORTAS_GIRO_PADRAO.has(codRaw) || CODIGOS_PORTAS_GIRO_PADRAO.has(codNormalizado);
    if (ehPadrao) {
      return {
        familia: 'Porta Giratória Padrão',
        tipoMontagem: 'Porta Giratória Padrão',
        rota: ['Instalação de Gaxeta', 'Montagem de Portas Giratórias'],
        statusAtual: 'AGUARDANDO INÍCIO EM: Instalação de Gaxeta'
      };
    }
    return {
      familia: 'Porta Giratória Especial',
      tipoMontagem: 'Porta Giratória Especial',
      rota: [
        'Corte',
        'Dobra',
        'Preparação de Folha',
        'Injeção',
        'Instalação de Gaxeta',
        'Montagem de Portas Giratória Padrão e Especial'
      ],
      statusAtual: 'AGUARDANDO INÍCIO EM: Corte'
    };
  }

  // 9. Portas de Correr (Exclui Office Door)
  const ehCorrer =
    !isOfficeDoorCorrer(codRaw, desc, tipoOrdem) &&
    !desc.includes('OFFICE DOOR') &&
    !desc.includes('OFFICE-DOOR') &&
    (
      desc.includes('PT COR') ||
      desc.includes('PORTA CORRER') ||
      desc.includes('PORTA DE CORRER') ||
      desc.includes('CORRER') ||
      desc.includes('EMENDAD') ||
      codNormalizado.startsWith('005') ||
      codNormalizado.startsWith('006') ||
      codNormalizado.startsWith('007') ||
      codNormalizado.startsWith('008') ||
      codNormalizado.startsWith('029') ||
      codNormalizado.startsWith('025')
    );

  if (ehCorrer) {
    const ehInox = desc.includes('INOX') || desc.includes('I304') || desc.includes('I430') || codNormalizado.startsWith('006') || codNormalizado.startsWith('008');
    const ehEmendada = desc.includes('EMENDAD') || desc.includes('EMENDA') || codNormalizado.startsWith('029') || codNormalizado.startsWith('025');
    const ehPadrao = (CODIGOS_PORTAS_CORRER_PADRAO.has(codRaw) || CODIGOS_PORTAS_CORRER_PADRAO.has(codNormalizado)) &&
      !ehInox &&
      !ehEmendada &&
      !desc.includes('ESP') &&
      !desc.includes('ESPECIAL');

    if (ehPadrao) {
      return {
        familia: 'Porta de Correr Padrão',
        tipoMontagem: 'Porta de Correr Padrão',
        rota: ['Montagem Portas de Correr Padrão e Especial'],
        statusAtual: 'AGUARDANDO INÍCIO EM: Montagem Portas de Correr Padrão e Especial'
      };
    }

    return {
      familia: 'Porta de Correr Especial',
      tipoMontagem: 'Porta de Correr Especial',
      rota: [
        'Corte',
        'Dobra',
        'Preparação de Folha',
        'Injeção',
        'Montagem Portas de Correr Padrão e Especial'
      ],
      statusAtual: 'AGUARDANDO INÍCIO EM: Corte'
    };
  }

  // 10. Perfil PP
  if (codNormalizado.startsWith('022') || desc.startsWith('PERFIL PP')) {
    return {
      familia: 'Perfil PP',
      tipoMontagem: 'Perfil PP',
      rota: ['Corte', 'Dobra'],
      statusAtual: 'AGUARDANDO INÍCIO EM: Corte'
    };
  }

  // 11. Abrigo Doca
  if (codNormalizado.startsWith('014') || desc.includes('ABRIGO DOCA')) {
    return {
      familia: 'Abrigo Doca',
      tipoMontagem: 'Abrigo Doca',
      rota: ['Corte', 'Solda', 'Montagem Abrigo Doca'],
      statusAtual: 'AGUARDANDO INÍCIO EM: Corte'
    };
  }

  // 12. Estante
  if (codNormalizado.startsWith('015') || codRaw === '090.0001' || codNormalizado === '0900001') {
    return {
      familia: 'Estante',
      tipoMontagem: 'Estante',
      rota: ['Montagem Estante'],
      statusAtual: 'AGUARDANDO INÍCIO EM: Montagem Estante'
    };
  }

  // Fallback Geral
  return {
    familia: 'Geral',
    tipoMontagem: 'Padrão',
    rota: ['Corte', 'Dobra', 'Preparação de Folha', 'Injeção', 'Montagem Portas de Correr Padrão e Especial'],
    statusAtual: 'AGUARDANDO INÍCIO EM: Corte'
  };
}

// =========================================================================
// PARSER PRINCIPAL DO HTML DO NOMUS ERP (TABELAS TR, DIV GRID & REGEX FALLBACK)
// =========================================================================

function parseNomusHtml(htmlContent) {
  const warnings = [];
  const orders = [];

  if (!htmlContent || typeof htmlContent !== 'string') {
    return { orders: [], rawCount: 0, warnings: ['Conteúdo HTML vazio ou inválido.'] };
  }

  const doc = parse(htmlContent);

  // STRATEGY 1: Localização de linhas (tr tradicionais ou divs role="row" / grid-row)
  let rows = doc.querySelectorAll('tr');
  if (rows.length === 0) {
    rows = doc.querySelectorAll('[role="row"], div.row, div.grid-row, div.report-row, div[class*="row"], div[class*="Row"]');
  }

  const isOpPattern = (txt) => /OP\s*\d+/i.test(txt) || /\b\d{4,8}[\-_/]\d{1,3}\b/.test(txt);

  if (rows.length > 0) {
    // 1. Localização dinâmica da linha de cabeçalho
    let headerRow = doc.querySelector('tr.chRow, [role="row"].chRow, div.chRow, thead tr');

    if (!headerRow) {
      for (const row of rows) {
        const cells = row.querySelectorAll('th, td, [role="columnheader"], [role="gridcell"], div[class*="cell"], div[class*="col"]');
        if (cells.length < 5) continue;
        const texts = cells.map((c) => normalizeHeader(c.textContent));

        const hasOp = texts.some((t) => (t.includes('ordem') || t.includes('op')) && !t.includes('entrega') && !t.includes('status'));
        const hasDescOrCod = texts.some((t) => t.includes('desc') || t.includes('cod') || t.includes('produto') || t.includes('item'));
        const hasEntrega = texts.some((t) => t.includes('entrega') || t.includes('prazo') || t.includes('previsao'));

        if ((hasOp && (hasDescOrCod || hasEntrega)) || (hasDescOrCod && hasEntrega)) {
          headerRow = row;
          break;
        }
      }
    }

    if (!headerRow) {
      const thRow = rows.find((r) => r.querySelectorAll('th, [role="columnheader"]').length >= 5);
      if (thRow) {
        headerRow = thRow;
      }
    }

    // 2. Mapeamento dinâmico de cabeçalhos
    let idxOp = -1;
    let idxDescricao = -1;
    let idxCodigo = -1;
    let idxQtde = -1;
    let idxQtdeProduzida = -1;
    let idxEntrega = -1;
    let idxStatus = -1;
    let idxLote = -1;
    let idxObservacao = -1;

    if (headerRow) {
      const headerCells = headerRow.querySelectorAll('th, td, [role="columnheader"], [role="gridcell"], div[class*="cell"], div[class*="col"]');
      headerCells.forEach((cell, idx) => {
        const norm = normalizeHeader(cell.textContent);

        if (norm.includes('entrega') || norm.includes('prazo') || norm.includes('previsao') || norm.includes('dt. entrega') || norm.includes('data entrega')) {
          idxEntrega = idx;
        } else if (norm.includes('status') || norm.includes('situacao') || norm.includes('fase')) {
          idxStatus = idx;
        } else if (norm.includes('qtde') || norm.includes('quantidade') || norm.includes('qtd') || norm.includes('quant')) {
          if (norm.includes('produz') || norm.includes('prod')) {
            idxQtdeProduzida = idx;
          } else {
            idxQtde = idx;
          }
        } else if (norm.includes('ordem') || norm.includes('op') || norm.includes('numero') || norm.includes('num op') || norm.includes('nº op') || norm.includes('n° op')) {
          idxOp = idx;
        } else if (norm.includes('cod') || norm.includes('ref')) {
          idxCodigo = idx;
        } else if (
          !norm.includes('incluir') &&
          !norm.includes('coluna') &&
          !norm.includes('linha') &&
          !norm.includes('filtro') &&
          !norm.includes('dado') &&
          !norm.includes('exportar') &&
          !norm.includes('detalhe') &&
          !norm.includes('acao') &&
          !norm.includes('acoes') &&
          (norm.includes('desc') || norm.includes('item') || (norm.includes('produto') && !norm.includes('cod')) || norm.includes('especificacao'))
        ) {
          idxDescricao = idx;
        } else if (norm.includes('lote')) {
          idxLote = idx;
        } else if (norm.includes('observ') || norm.includes('obs') || norm.includes('nota')) {
          idxObservacao = idx;
        }
      });
    }

    // Inferência inteligente de colunas a partir das células de dados caso o cabeçalho não tenha sido mapeado
    if (idxOp === -1) {
      const sampleRow = rows.find((r) => {
        if (r === headerRow) return false;
        const c = r.querySelectorAll('td, [role="gridcell"], div[class*="cell"]');
        return c.length >= 7;
      });
      const cellsCount = sampleRow ? sampleRow.querySelectorAll('td, [role="gridcell"], div[class*="cell"]').length : 9;
      if (cellsCount >= 10) {
        if (idxEntrega === -1) idxEntrega = 1;
        if (idxStatus === -1) idxStatus = 2;
        if (idxDescricao === -1) idxDescricao = 3;
        if (idxCodigo === -1) idxCodigo = 4;
        if (idxLote === -1) idxLote = 5;
        if (idxObservacao === -1) idxObservacao = 6;
        if (idxOp === -1) idxOp = 7;
        if (idxQtde === -1) idxQtde = 8;
        if (idxQtdeProduzida === -1) idxQtdeProduzida = 9;
      } else {
        if (idxEntrega === -1) idxEntrega = 0;
        if (idxStatus === -1) idxStatus = 1;
        if (idxDescricao === -1) idxDescricao = 2;
        if (idxCodigo === -1) idxCodigo = 3;
        if (idxLote === -1) idxLote = 4;
        if (idxObservacao === -1) idxObservacao = 5;
        if (idxOp === -1) idxOp = 6;
        if (idxQtde === -1) idxQtde = 7;
        if (idxQtdeProduzida === -1) idxQtdeProduzida = 8;
      }
    }

    // 3. Tratamento de agrupamentos e células mescladas com memória carry-down
    let ultimaDataEntrega = '';
    let ultimoStatus = '';
    let ultimaDescricaoValida = '';
    let ultimoCodigoValido = '';

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row === headerRow) continue;

      const rowClass = (row.getAttribute('class') || '').trim();
      const hasSubtotalClass =
        /\b(sL|sR|tL|tR)\b/i.test(rowClass) ||
        Boolean(row.querySelector('td.sL, td.sR, td.tL, td.tR, th.sL, th.sR, th.tL, th.tR'));

      const rowText = (row.textContent || '').replace(/\u00a0/g, ' ').trim();
      const rowLower = normalizeHeader(rowText);

      if (
        hasSubtotalClass ||
        rowLower.includes('resumo geral') ||
        rowLower.includes('subtotal') ||
        rowLower.includes('total geral') ||
        rowLower.includes('registros encontrados')
      ) {
        continue;
      }

      if (row.querySelector('th') && !row.querySelector('td') && !row.querySelector('[role="gridcell"]')) continue;
      if (rowLower.includes('entrega op') && (rowLower.includes('ordem') || rowLower.includes('descricao'))) continue;

      let cells = row.querySelectorAll('td, [role="gridcell"], div[class*="cell"], div[class*="col"]');
      if (cells.length === 0) {
        cells = Array.from(row.childNodes).filter((n) => n.nodeType === 1);
      }
      if (cells.length === 0) continue;

      // Atualização da memória carry-down
      const rawEntrega = idxEntrega >= 0 && cells[idxEntrega] ? cleanCellText(cells[idxEntrega]) : '';
      if (isValidDataValue(rawEntrega)) {
        ultimaDataEntrega = rawEntrega;
      }
      const dataEntrega = ultimaDataEntrega;

      const rawStatus = idxStatus >= 0 && cells[idxStatus] ? cleanCellText(cells[idxStatus]) : '';
      if (isValidDataValue(rawStatus)) {
        ultimoStatus = rawStatus;
      }
      const statusNomus = ultimoStatus || 'Liberada';

      const celulaDescricao = idxDescricao >= 0 && cells[idxDescricao] ? cells[idxDescricao] : null;
      let descTexto = celulaDescricao ? cleanCellText(celulaDescricao) : '';

      // Se a célula mapeada contiver "INCLUIR ITENS" ou for inválida, busca nas outras células da linha
      if (!isDescricaoValida(descTexto)) {
        const candidata = cells.find((c) => {
          const t = cleanCellText(c);
          if (!isDescricaoValida(t)) return false;
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(t.trim())) return false;
          if (/^\d{3}[\.-]?\d{4}$/.test(t.trim())) return false;
          if (/^(?:OP\s*)?\d{4,8}[-_/]\d{1,3}$/i.test(t.trim())) return false;
          if (/^\d+([.,]\d+)?$/.test(t.trim())) return false;
          return t.length >= 4;
        });
        if (candidata) {
          descTexto = cleanCellText(candidata);
        }
      }

      if (descTexto && isDescricaoValida(descTexto)) {
        ultimaDescricaoValida = descTexto;
      } else {
        descTexto = isDescricaoValida(ultimaDescricaoValida) ? ultimaDescricaoValida : '';
      }

      const celulaCodigo = idxCodigo >= 0 && cells[idxCodigo] ? cells[idxCodigo] : null;
      let codTexto = celulaCodigo ? cleanCellText(celulaCodigo) : '';

      if (!codTexto || !isValidDataValue(codTexto) || !/^\d{3}[\.-]?\d{4}$/.test(codTexto.trim())) {
        const celulaComCod = cells.find((c) => {
          const txt = cleanCellText(c).trim();
          return /^\d{3}[\.-]\d{4}$/.test(txt) || (/^\d{7}$/.test(txt) && !txt.startsWith('202'));
        });
        if (celulaComCod) {
          codTexto = cleanCellText(celulaComCod).trim();
        }
      }

      if (!codTexto || !isValidDataValue(codTexto)) {
        const matchInDesc = (descTexto || '').match(/\b(\d{3}[\.-]\d{4})\b/);
        if (matchInDesc) {
          codTexto = matchInDesc[1];
        }
      }

      if (codTexto && isValidDataValue(codTexto)) {
        ultimoCodigoValido = codTexto;
      } else {
        codTexto = ultimoCodigoValido;
      }

      // Leitura da célula da OP
      let rawOpCellText = '';
      if (idxOp >= 0 && cells[idxOp]) {
        rawOpCellText = cleanCellText(cells[idxOp]);
      }

      if (!isOpPattern(rawOpCellText)) {
        const foundCell = cells.find((c) => isOpPattern(cleanCellText(c)));
        if (foundCell) {
          rawOpCellText = cleanCellText(foundCell);
        }
      }

      if (!rawOpCellText || !isOpPattern(rawOpCellText)) {
        const candidateCell = cells.find((c) => {
          const txt = cleanCellText(c).trim();
          return /^\d{5,8}$/.test(txt) && !/^\d{2}\/\d{2}\/\d{4}$/.test(txt) && !txt.startsWith('202');
        });
        if (candidateCell) {
          rawOpCellText = cleanCellText(candidateCell);
        }
      }

      if (!rawOpCellText || (!isOpPattern(rawOpCellText) && !/^\d{5,8}$/.test(rawOpCellText.trim()))) {
        continue;
      }

      const opMatch = rawOpCellText.match(/OP\s*(\d+[\-_/]\d+)/i) || rawOpCellText.match(/(\d{4,8}[\-_/]\d{1,3})/i) || rawOpCellText.match(/(\d{5,8})/);
      let numero = '';
      if (opMatch) {
        const cleanCode = opMatch[1].replace(/[_/]/g, '-');
        numero = cleanCode.startsWith('OP') ? cleanCode : `OP ${cleanCode}`;
      } else {
        const cleanCode = rawOpCellText.replace(/^(\s*OP\s*)+/i, '').trim();
        numero = cleanCode.startsWith('OP') ? cleanCode : `OP ${cleanCode}`;
      }

      const fallbackDesc = numero.startsWith('OP') ? `PRODUTO ${numero}` : `PRODUTO OP ${numero}`;
      let descricao = (descTexto || ultimaDescricaoValida || '').trim().toUpperCase();
      if (!isDescricaoValida(descricao)) {
        descricao = fallbackDesc;
      }
      const codigo = codTexto || ultimoCodigoValido || '';

      const rawLote = idxLote >= 0 && cells[idxLote] ? cleanCellText(cells[idxLote]) : '';
      const lote = isValidDataValue(rawLote) ? rawLote : '—';

      const rawObs = idxObservacao >= 0 && cells[idxObservacao] ? cleanCellText(cells[idxObservacao]) : '';
      const observacao = isValidDataValue(rawObs) ? rawObs : '';

      const rawQtdText = idxQtde >= 0 && cells[idxQtde] ? cleanCellText(cells[idxQtde]) : '1';
      let parsedQtd = 1;
      if (rawQtdText) {
        let cleanQtd = rawQtdText.replace(/\s+/g, '');
        if (cleanQtd.includes('.') && cleanQtd.includes(',')) {
          cleanQtd = cleanQtd.replace(/\./g, '').replace(',', '.');
        } else if (cleanQtd.includes(',')) {
          cleanQtd = cleanQtd.replace(',', '.');
        }
        cleanQtd = cleanQtd.replace(/[^\d.]/g, '');
        const num = parseFloat(cleanQtd);
        parsedQtd = isNaN(num) || num <= 0 ? 1 : num;
      }

      const isDecimal = Math.abs(parsedQtd - Math.round(parsedQtd)) > 0.001;
      const descUpper = descricao.toUpperCase();
      const isM2 = (isDecimal || descUpper.includes('M2') || descUpper.includes('M²')) && parsedQtd > 0;

      let quantidadeTotal = 1;
      let quantidadeM2 = undefined;
      let unidadeMedida = 'PC';

      if (isM2) {
        unidadeMedida = 'M²';
        quantidadeM2 = Number(parsedQtd.toFixed(2));
        quantidadeTotal = deducePhysicalUnitsFromM2(descricao, parsedQtd);
      } else {
        quantidadeTotal = Math.round(parsedQtd);
      }

      const isDupla = descUpper.includes('DUPLA') || descUpper.includes('DUPLO');
      const quantidadeFolhas = isDupla ? (quantidadeTotal > 1 ? quantidadeTotal * 2 : 2) : quantidadeTotal;
      const quantidadeFisicaInicial = isDupla && quantidadeTotal === 1 ? 2 : quantidadeTotal;

      let qtdeProduzida = 0;
      if (idxQtdeProduzida >= 0 && cells[idxQtdeProduzida]) {
        const rawProd = cleanCellText(cells[idxQtdeProduzida]);
        if (rawProd) {
          let cleanProd = rawProd.replace(/\s+/g, '');
          if (cleanProd.includes('.') && cleanProd.includes(',')) {
            cleanProd = cleanProd.replace(/\./g, '').replace(',', '.');
          } else if (cleanProd.includes(',')) {
            cleanProd = cleanProd.replace(',', '.');
          }
          cleanProd = cleanProd.replace(/[^\d.]/g, '');
          const num = parseFloat(cleanProd);
          if (!isNaN(num) && num >= 0) {
            qtdeProduzida = Math.round(num);
          }
        }
      }

      const deadline = calculateDeadlineInfo(dataEntrega);
      let defaultFactoryStatus = 'Produzindo Hoje';
      if (deadline.isDelayed) {
        defaultFactoryStatus = 'Atrasada';
      } else if (statusNomus.toUpperCase().includes('LIBERADA')) {
        defaultFactoryStatus = 'Falta Injetar';
      }

      const cleanId = normalizarIdOP(numero);
      const docId = formatarNumeroOP(cleanId);

      const novaOp = {
        id: docId,
        numero: docId,
        op_numero: docId,
        numero_normalizado: cleanId,
        codigo,
        codigoProduto: codigo,
        descricao,
        cliente: 'Nomus ERP',
        lote,
        observacao,
        observacoes: observacao,
        observacoesNomus: observacao,
        quantidadeFisica: quantidadeFisicaInicial,
        quantidade_total: quantidadeFisicaInicial,
        quantidade: quantidadeFisicaInicial,
        quantidadeFolhas,
        isDupla,
        ...(quantidadeM2 !== undefined ? { quantidade_m2: quantidadeM2 } : {}),
        qtde_produzida: qtdeProduzida,
        data_entrega: dataEntrega || '',
        prazoEntrega: dataEntrega || '',
        status_nomus: statusNomus || 'Liberada',
        statusNomus: statusNomus || 'Liberada',
        status_fabrica: defaultFactoryStatus,
        unidade_medida: unidadeMedida,
        status: 'EM_PRODUCAO',
        criadoEm: Date.now(),
        atualizadoEm: Date.now()
      };

      const rotaInfo = processarRotaProduto(novaOp);
      novaOp.familia = rotaInfo.familia;
      novaOp.tipoMontagem = rotaInfo.tipoMontagem;
      novaOp.tipoOrdem = rotaInfo.familia;
      novaOp.rota = rotaInfo.rota;
      novaOp.etapas = rotaInfo.rota;
      novaOp.statusAtual = rotaInfo.statusAtual;
      novaOp.etapaAtual = rotaInfo.rota[0] || 'Corte';
      novaOp.statusEtapa = `Aguardando Início em: ${novaOp.etapaAtual}`;
      novaOp.status = `Aguardando Início em: ${novaOp.etapaAtual}`;

      if (rotaInfo.requerLaser) {
        novaOp.requerLaser = 1;
        novaOp.requer_laser = 1;
      }
      if (rotaInfo.requerRouter) {
        novaOp.requerRouter = 1;
        novaOp.requer_router = 1;
        novaOp.encaminhar_router = 1;
      }

      orders.push(novaOp);
    }
  }

  // STRATEGY 2: Fallback por Regex e varredura de tags contextuais caso Strategy 1 não tenha encontrado OPs
  if (orders.length === 0) {
    const opRegex = /(?:OP\s*)?(\d{4,8}[-_/]\d{1,3})/gi;
    const matches = [...htmlContent.matchAll(opRegex)];
    const seenOps = new Set();

    for (const match of matches) {
      const rawOp = match[1].replace(/[_/]/g, '-');
      const canonicalNum = formatarNumeroOP(rawOp);
      const cleanId = normalizarIdOP(canonicalNum);
      if (seenOps.has(cleanId)) continue;
      seenOps.add(cleanId);

      const matchIdx = match.index || 0;
      const windowStart = Math.max(0, matchIdx - 700);
      const windowEnd = Math.min(htmlContent.length, matchIdx + 700);
      const contextWindow = htmlContent.substring(windowStart, windowEnd);

      // Data de entrega
      const dateMatch = contextWindow.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
      const dataEntrega = dateMatch ? dateMatch[1] : '';

      // Código do produto
      const codMatch = contextWindow.match(/\b(0\d{2}[\.-]\d{4})\b/) || contextWindow.match(/\b(\d{3}[\.-]\d{4})\b/);
      const codigo = codMatch ? codMatch[1] : '';

      // Status Nomus
      const statusMatch = contextWindow.match(/\b(Liberada|Em Produção|Produzindo|Planejada|Finalizada|Suspensa)\b/i);
      const statusNomus = statusMatch ? statusMatch[1] : 'Liberada';

      // Quantidade
      const qtdMatch = contextWindow.match(/\b(?:Qtde|Qtd)?\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(?:PC|PÇ|UN|M2|M²)?\b/i);
      let parsedQtd = qtdMatch ? parseFloat(qtdMatch[1].replace(',', '.')) : 1;
      if (isNaN(parsedQtd) || parsedQtd <= 0) parsedQtd = 1;

      // Descrição limpa de tags
      let descricao = '';
      const tagTextMatches = [...contextWindow.matchAll(/>([^<>]{3,120})</g)]
        .map((m) => m[1].replace(/\u00a0/g, ' ').replace(/&nbsp;/gi, ' ').trim())
        .filter((t) => isValidDataValue(t) && isDescricaoValida(t) && !t.includes('<') && !t.includes('>'));

      for (const t of tagTextMatches) {
        if (
          !/^\d{2}\/\d{2}\/\d{4}$/.test(t) &&
          !/^\d{3}[\.-]?\d{4}$/.test(t) &&
          !/^(?:OP\s*)?\d{4,8}[-_/]\d{1,3}$/i.test(t) &&
          !/^\d+$/.test(t) &&
          !/^(?:liberada|produzindo|em produção|planejada|finalizada|suspensa)$/i.test(t) &&
          !/^(?:resumo geral|total geral|subtotal)$/i.test(t) &&
          !/incluir/i.test(t)
        ) {
          if (/(?:PT|PORTA|FOLHA|PERFIL|ABRIGO|ESTANTE|BATENTE|OFFICE|GUIA|TRILHO|GIR|COR)/i.test(t)) {
            descricao = t.toUpperCase();
            break;
          }
        }
      }

      if (!descricao) {
        const textWindow = contextWindow.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
        const descMatch = textWindow.match(/\b((?:PT|PORTA|FOLHA|PERFIL|ABRIGO|ESTANTE|BATENTE|OFFICE|GUIA|TRILHO)[A-Z0-9\s\.\/\-\,\+]{3,60})/i);
        if (descMatch) {
          descricao = descMatch[1].trim().toUpperCase();
        } else {
          descricao = `PRODUTO ${canonicalNum}`;
        }
      }

      const isDecimal = Math.abs(parsedQtd - Math.round(parsedQtd)) > 0.001;
      const descUpper = descricao.toUpperCase();
      const isM2 = (isDecimal || descUpper.includes('M2') || descUpper.includes('M²')) && parsedQtd > 0;

      let quantidadeTotal = 1;
      let quantidadeM2 = undefined;
      let unidadeMedida = 'PC';

      if (isM2) {
        unidadeMedida = 'M²';
        quantidadeM2 = Number(parsedQtd.toFixed(2));
        quantidadeTotal = deducePhysicalUnitsFromM2(descricao, parsedQtd);
      } else {
        quantidadeTotal = Math.round(parsedQtd);
      }

      const isDupla = descUpper.includes('DUPLA') || descUpper.includes('DUPLO');
      const quantidadeFolhas = isDupla ? (quantidadeTotal > 1 ? quantidadeTotal * 2 : 2) : quantidadeTotal;
      const quantidadeFisicaInicial = isDupla && quantidadeTotal === 1 ? 2 : quantidadeTotal;

      const deadline = calculateDeadlineInfo(dataEntrega);
      let defaultFactoryStatus = 'Produzindo Hoje';
      if (deadline.isDelayed) {
        defaultFactoryStatus = 'Atrasada';
      } else if (statusNomus.toUpperCase().includes('LIBERADA')) {
        defaultFactoryStatus = 'Falta Injetar';
      }

      const novaOp = {
        id: canonicalNum,
        numero: canonicalNum,
        op_numero: canonicalNum,
        numero_normalizado: cleanId,
        codigo,
        codigoProduto: codigo,
        descricao,
        cliente: 'Nomus ERP',
        lote: '—',
        observacao: '',
        observacoes: '',
        observacoesNomus: '',
        quantidadeFisica: quantidadeFisicaInicial,
        quantidade_total: quantidadeFisicaInicial,
        quantidade: quantidadeFisicaInicial,
        quantidadeFolhas,
        isDupla,
        ...(quantidadeM2 !== undefined ? { quantidade_m2: quantidadeM2 } : {}),
        qtde_produzida: 0,
        data_entrega: dataEntrega || '',
        prazoEntrega: dataEntrega || '',
        status_nomus: statusNomus,
        statusNomus: statusNomus,
        status_fabrica: defaultFactoryStatus,
        unidade_medida: unidadeMedida,
        status: 'EM_PRODUCAO',
        criadoEm: Date.now(),
        atualizadoEm: Date.now()
      };

      const rotaInfo = processarRotaProduto(novaOp);
      novaOp.familia = rotaInfo.familia;
      novaOp.tipoMontagem = rotaInfo.tipoMontagem;
      novaOp.tipoOrdem = rotaInfo.familia;
      novaOp.rota = rotaInfo.rota;
      novaOp.etapas = rotaInfo.rota;
      novaOp.statusAtual = rotaInfo.statusAtual;
      novaOp.etapaAtual = rotaInfo.rota[0] || 'Corte';
      novaOp.statusEtapa = `Aguardando Início em: ${novaOp.etapaAtual}`;
      novaOp.status = `Aguardando Início em: ${novaOp.etapaAtual}`;

      if (rotaInfo.requerLaser) {
        novaOp.requerLaser = 1;
        novaOp.requer_laser = 1;
      }
      if (rotaInfo.requerRouter) {
        novaOp.requerRouter = 1;
        novaOp.requer_router = 1;
        novaOp.encaminhar_router = 1;
      }

      orders.push(novaOp);
    }
  }

  // Deduplicação por número normalizado
  const uniqueMap = new Map();
  orders.forEach((o) => {
    uniqueMap.set(o.numero_normalizado, o);
  });

  const finalOrders = Array.from(uniqueMap.values());

  if (finalOrders.length === 0) {
    warnings.push('Nenhuma OP válida encontrada no relatório HTML do Nomus.');
  }

  return {
    orders: finalOrders,
    rawCount: finalOrders.length,
    warnings
  };
}

module.exports = {
  parseNomusHtml,
  processarRotaProduto,
  normalizarIdOP,
  formatarNumeroOP,
  calculateDeadlineInfo,
  deducePhysicalUnitsFromM2,
  parseDimensions
};
