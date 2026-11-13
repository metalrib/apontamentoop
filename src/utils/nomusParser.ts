import {
  ProductionOrder,
  FactoryStatus,
  CODIGOS_PORTAS_GIRO_PADRAO,
  CODIGOS_PORTAS_CORRER_PADRAO,
  CODIGOS_GIRATORIA_PADRAO,
  CODIGOS_PADRAO_CORRER,
  isPortaCorrerPadrao,
  isRotaExclusivaLaser,
  isRotaLaserDobra,
  isRotaExclusivaRouter,
  isOfficeDoorCorrer,
  isOfficeDoorGiro
} from '../types/mes';
import { obterEtapasDaRota } from './routeValidation';

/**
 * Normaliza o identificador da OP removendo prefixos "OP", repetições "OP OP" e espaços extras (ex: "024552-01")
 */
export const normalizarIdOP = (opNum?: string | number | null): string => {
  if (!opNum) return '';
  return String(opNum).toUpperCase().replace(/^(\s*OP\s*)+/i, '').trim();
};

export const cleanOpId = normalizarIdOP;
export const cleanOpid = normalizarIdOP;

/**
 * Formata o número da OP garantindo prefixo único "OP XXXXXX-XX" sem duplicações (ex: "OP OP ...")
 */
export const formatarNumeroOP = (opNum?: string | null): string => {
  const limpo = normalizarIdOP(opNum);
  return limpo ? `OP ${limpo}` : '';
};

export function processarRotaProduto(op: { codigo?: string; codigoProduto?: string; cod?: string; descricao?: string; produto?: string; quantidadeFisica?: number; quantidade?: number }): {
  familia: string;
  tipoMontagem: string;
  rota: string[];
  etapas?: any;
  statusAtual: string;
} {
  const codigoProduto = String(op?.codigoProduto || op?.codigo || (op as any)?.cod || '').trim();
  const codRaw = codigoProduto;
  let codNormalizado = codRaw.replace(/[^0-9]/g, '');
  const desc = String(op.descricao || (op as any).produto || '').toUpperCase();

  // Se o código não veio explícito, tenta extrair da descrição (ex: "003.0140 - PT GIR...")
  if (!codNormalizado && desc) {
    const matchCod = desc.match(/\b(\d{3}[\.-]?\d{4})\b/);
    if (matchCod) {
      codNormalizado = matchCod[1].replace(/[^0-9]/g, '');
    }
  }

  // A) ROTA EXCLUSIVA DE LASER (["Laser"]): Âncoras Rebite Rosca, Pendurais Inox e Âncora Vai-Vem Alvenaria
  if (isRotaExclusivaLaser(op)) {
    return {
      familia: 'Laser CNC',
      tipoMontagem: 'Laser CNC Exclusivo',
      rota: ['Laser'],
      statusAtual: 'AGUARDANDO INÍCIO EM: LASER'
    };
  }

  // B) ROTA LASER + DOBRA (["Laser", "Dobra"]): Trilhos Inox para Cortina
  if (isRotaLaserDobra(op)) {
    return {
      familia: 'Laser e Dobra',
      tipoMontagem: 'Laser e Dobra',
      rota: ['Laser', 'Dobra'],
      statusAtual: 'AGUARDANDO INÍCIO EM: LASER'
    };
  }

  // C) ROTA EXCLUSIVA DE ROUTER (["Router"]): Visor de Policarbonato
  if (isRotaExclusivaRouter(op)) {
    return {
      familia: 'Router CNC',
      tipoMontagem: 'Router CNC Exclusivo',
      rota: ['Router'],
      statusAtual: 'AGUARDANDO INÍCIO EM: ROUTER'
    };
  }

  // Se for subcomponente (Batente, Folha, Trilho, Âncora, Vai-Vem, Office Door, etc.), delega para obterEtapasDaRota
  const ehSubcomponenteOuOutro =
    codNormalizado.startsWith('020') ||
    codNormalizado.startsWith('021') ||
    codNormalizado.startsWith('024') ||
    codNormalizado.startsWith('027') ||
    codNormalizado.startsWith('028') ||
    codNormalizado.startsWith('011') ||
    codNormalizado.startsWith('009') ||
    codNormalizado.startsWith('010') ||
    codNormalizado.startsWith('014') ||
    codNormalizado.startsWith('015') ||
    codNormalizado.startsWith('022') ||
    codNormalizado.startsWith('090') ||
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
    const rotas = obterEtapasDaRota(op);
    let familia = 'Geral';
    if (codNormalizado.startsWith('020') || desc.startsWith('BAT') || desc.startsWith('BATENTE')) familia = 'Batente';
    else if (codNormalizado.startsWith('028') || desc.startsWith('TRILHO')) familia = 'Trilho';
    else if (desc.startsWith('FOLHA')) familia = 'Folha Avulsa';
    else if (codNormalizado.startsWith('021') || desc.includes('ANCORA')) familia = 'Âncora';
    else if (codNormalizado.startsWith('011') || desc.includes('VAI VEM')) familia = 'Porta Vai e Vem';
    else if (isOfficeDoorCorrer(op)) familia = 'Porta Office Door de Correr';
    else if (isOfficeDoorGiro(op)) familia = 'Porta Office Door de Giro';
    else if (codNormalizado.startsWith('009') || codNormalizado.startsWith('010') || desc.includes('OFFICE DOOR')) familia = 'Office Door';
    else if (codNormalizado.startsWith('024') || desc.includes('PENDURAL')) familia = 'Cortina / Pendural';
    else if (codNormalizado.startsWith('027') || desc.includes('VISOR')) familia = 'Visor';

    return {
      familia,
      tipoMontagem: familia,
      rota: rotas,
      statusAtual: `AGUARDANDO INÍCIO EM: ${rotas[0] || 'Corte'}`
    };
  }

  // 0. FAMÍLIA OFFICE DOOR (GIRO E CORRER)
  if (isOfficeDoorCorrer(op)) {
    const querRouter = Boolean((op as any)?.requerRouter || (op as any)?.requer_router || (op as any)?.encaminhar_router);
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

  if (isOfficeDoorGiro(op)) {
    const querLaser = Boolean((op as any)?.requerLaser || (op as any)?.requer_laser);
    const querRouter = Boolean((op as any)?.requerRouter || (op as any)?.requer_router || (op as any)?.encaminhar_router);
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

  // 1. FAMÍLIA PORTA GIRATÓRIA (PADRÃO VS ESPECIAL - EXCLUI OFFICE DOOR)
  const ehGiratoria =
    !isOfficeDoorGiro(op) &&
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
    // REGRA RESTRITIVA (WHITELIST POR CÓDIGO NORMALIZADO):
    // Uma porta giratória SÓ é padrão se o código constar na Whitelist Oficial Metalrib
    const ehPadrao = Boolean(
      (codNormalizado && (CODIGOS_PORTAS_GIRO_PADRAO.has(codNormalizado) || CODIGOS_GIRATORIA_PADRAO.has(codNormalizado))) ||
      (codigoProduto && (CODIGOS_PORTAS_GIRO_PADRAO.has(codigoProduto) || CODIGOS_GIRATORIA_PADRAO.has(codigoProduto)))
    );

    if (ehPadrao) {
      return {
        familia: 'Porta Giratória Padrão',
        tipoMontagem: 'Porta Giratória Padrão',
        rota: [
          'Instalação de Gaxeta',
          'Montagem de Portas Giratórias'
        ],
        statusAtual: 'AGUARDANDO INÍCIO EM: Instalação de Gaxeta'
      };
    }

    // Qualquer outro código cai compulsoriamente aqui (ex: 003.0140, 700L ou qualquer medida especial):
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

  // 2. FAMÍLIA PORTAS DE CORRER (PADRÃO VS ESPECIAL / SOB MEDIDA / EMENDADA)
  const ehCorrer =
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
    codNormalizado.startsWith('025');

  if (ehCorrer) {
    const totalQtd = op.quantidadeFisica || op.quantidade || 1;
    // Uma porta de correr SÓ é padrão se constar na Whitelist (005.* e 007.*) ou isPortaCorrerPadrao e não for sob medida/especial
    const ehPadrao =
      (isPortaCorrerPadrao(codigoProduto || codNormalizado, desc) ||
        Boolean(
          (codNormalizado && (CODIGOS_PORTAS_CORRER_PADRAO.has(codNormalizado) || CODIGOS_PADRAO_CORRER.has(codNormalizado))) ||
          (codigoProduto && (CODIGOS_PORTAS_CORRER_PADRAO.has(codigoProduto) || CODIGOS_PADRAO_CORRER.has(codigoProduto)))
        )) &&
      !desc.includes('EMENDAD') &&
      !desc.includes('EMENDA') &&
      !desc.includes('INOX') &&
      !desc.includes('I304') &&
      !desc.includes('I430') &&
      !desc.includes('ESPECIAL') &&
      !desc.includes('ESP') &&
      !codNormalizado.startsWith('006') &&
      !codNormalizado.startsWith('008') &&
      !codNormalizado.startsWith('029') &&
      !codNormalizado.startsWith('025');

    if (ehPadrao) {
      return {
        familia: 'Porta de Correr Padrão',
        tipoMontagem: 'Porta de Correr Padrão',
        tipoOrdem: 'Porta de Correr Padrão (Montagem Final)',
        rota: [
          'Montagem Portas de Correr Padrão e Especial'
        ],
        etapas: [
          {
            nome: 'Montagem Portas de Correr Padrão e Especial',
            ordem: 1,
            status: 'pendente',
            quantidadeProduzida: 0,
            total: totalQtd
          }
        ],
        statusAtual: 'AGUARDANDO INÍCIO EM: Montagem Portas de Correr Padrão e Especial'
      };
    }

    // Se NÃO for código padrão (ex: OP 023865-01 / Cód: 005.0149, medidas fora de padrão):
    return {
      familia: 'Porta de Correr Especial',
      tipoMontagem: 'Porta de Correr Especial',
      tipoOrdem: 'Especial Sob Medida (Fabricação Completa)',
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

  // Demais famílias delegam para o roteador central
  const rotas = obterEtapasDaRota(op);
  return {
    familia: 'Geral',
    tipoMontagem: 'Padrão',
    rota: rotas,
    statusAtual: `AGUARDANDO INÍCIO EM: ${rotas[0] || 'Corte'}`
  };
}

export interface NomusParseResult {
  orders: ProductionOrder[];
  rawCount: number;
  warnings: string[];
}

/**
 * Converte com segurança datas em formato brasileiro DD/MM/AA ou DD/MM/AAAA
 */
export function parseDateBR(dateStr?: string): Date | null {
  if (!dateStr || dateStr === '—' || dateStr.trim() === '') return null;
  const parts = dateStr.trim().split(/[\/\.-]/);
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // Mês base 0 no JS
  let year = parseInt(parts[2], 10);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  if (year < 100) year += 2000; // Converte '26' para 2026
  const date = new Date(year, month, day);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Utilitário para cálculo de prazo e dias de atraso (compatível com DD/MM/AA)
 */
export function calculateDeadlineInfo(dataEntrega?: string): {
  isDelayed: boolean;
  daysDiff: number;
  label: string;
  text: string;
  badgeClass: string;
  className: string;
  isHistoric?: boolean;
} {
  if (!dataEntrega || dataEntrega === '—' || !dataEntrega.trim()) {
    const text = '📅 Sem Prazo';
    const cls = 'bg-gray-800 text-gray-400 border border-gray-700';
    return {
      isDelayed: false,
      daysDiff: 0,
      label: text,
      text,
      badgeClass: cls,
      className: cls,
      isHistoric: false
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const targetDate = parseDateBR(dataEntrega);
  if (targetDate) {
    targetDate.setHours(0, 0, 0, 0);
    const diffTime = today.getTime() - targetDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 0) {
      // Trava de Alerta de Atraso Antigo (> 60 dias): Renderiza badge neutro/cinza
      if (diffDays > 60) {
        const text = 'Lote Anterior';
        const cls = 'bg-slate-800 text-slate-400 border border-slate-700';
        return {
          isDelayed: false,
          daysDiff: -diffDays,
          label: text,
          text,
          badgeClass: cls,
          className: cls,
          isHistoric: true
        };
      }

      // Vencida recente (<= 60 dias): Exibir Badge Vermelho com os dias exatos de atraso
      const text = `⚠ ${diffDays}d atraso`;
      const cls = 'bg-red-950/80 text-red-400 border border-red-800';
      return {
        isDelayed: true,
        daysDiff: -diffDays,
        label: text,
        text,
        badgeClass: cls,
        className: cls,
        isHistoric: false
      };
    } else if (diffDays === 0) {
      // Entrega Hoje
      const text = `📅 Hoje`;
      const cls = 'bg-amber-950/80 text-amber-300 border border-amber-800';
      return {
        isDelayed: false,
        daysDiff: 0,
        label: text,
        text,
        badgeClass: cls,
        className: cls,
        isHistoric: false
      };
    } else {
      // No Prazo (Futura): Exibe a data de entrega ou quantos dias faltam
      const text = `📅 ${dataEntrega.trim()}`;
      const cls = 'bg-gray-800 text-gray-300 border border-gray-700';
      return {
        isDelayed: false,
        daysDiff: Math.abs(diffDays),
        label: text,
        text,
        badgeClass: cls,
        className: cls,
        isHistoric: false
      };
    }
  }

  const text = `📅 ${dataEntrega.trim()}`;
  const cls = 'bg-gray-800 text-gray-300 border border-gray-700';
  return {
    isDelayed: false,
    daysDiff: 0,
    label: text,
    text,
    badgeClass: cls,
    className: cls,
    isHistoric: false
  };
}

/**
 * Converte strings numéricas em número limpo (ex: "4,00", "4.0", " 12 ")
 */
function cleanNumber(val: string | undefined, defaultValue: number = 1): number {
  if (!val) return defaultValue;
  const cleaned = val.replace(/\s+/g, '').replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) || num <= 0 ? defaultValue : Math.round(num);
}

/**
 * Extrai dimensões (altura e largura em metros) a partir da descrição da OP
 * Suporta formatos:
 * "2.200A X 1.500L", "2200A X 1500L", "2.000A X 1.000L", "2000 X 1000", "2,20 X 1,50"
 */
export function parseDimensions(desc: string): { heightMeters: number; widthMeters: number; area: number } | null {
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

/**
 * Deduz a quantidade física de portas/folhas a partir da quantidade em M² e da descrição
 * Exemplos:
 * - PT VAI VEM 2.200A X 1.500L (vão 3.30 m²): 6.60 m² -> 2 vãos = 4 folhas/portas físicas
 * - PT VAI VEM 2.200A X 1.500L: 13.20 m² -> 4 vãos = 8 folhas/portas físicas
 * - PT VAI VEM 2.200A X 1.200L (vão 2.64 m²): 2.64 m² -> 1 vão = 2 folhas/portas físicas
 */
export function deducePhysicalUnitsFromM2(descricao: string, m2: number): number {
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

/**
 * Normaliza textos de cabeçalho para comparação (sem acentos, minúsculo, sem pontuação)
 */
function normalizeHeader(str?: string | null): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

/**
 * Limpa o texto da célula removendo &nbsp;, espaços duplicados e quebras
 */
function cleanCellText(cell?: Element | null): string {
  if (!cell) return '';
  return (cell.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

/**
 * Valida se um valor de texto não está vazio nem preenchido com hífen/nulo
 */
function isValidDataValue(val?: string | null): boolean {
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

function isDescricaoValida(desc?: string | null): boolean {
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

/**
 * Parser inteligente do relatório de Ordem de Produção do Nomus ERP
 * Suporta layouts dinâmicos (9 ou 10 colunas, com ou sem coluna sequencial),
 * mapeamento por nome de cabeçalho e herança de células agrupadas (&nbsp;).
 */
export function parseNomusHtml(htmlContent: string): NomusParseResult {
  const warnings: string[] = [];
  const orders: ProductionOrder[] = [];

  if (!htmlContent || typeof htmlContent !== 'string') {
    return { orders: [], rawCount: 0, warnings: ['Conteúdo HTML vazio ou inválido.'] };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');

  // STRATEGY 1: Localização de linhas (tr tradicionais ou divs role="row" / grid-row)
  let rows = Array.from(doc.querySelectorAll('tr'));
  if (rows.length === 0) {
    rows = Array.from(doc.querySelectorAll('[role="row"], div.row, div.grid-row, div.report-row, div[class*="row"], div[class*="Row"]'));
  }

  const isOpPattern = (txt: string) => /OP\s*\d+/i.test(txt) || /\b\d{4,8}[\-_/]\d{1,3}\b/.test(txt);

  if (rows.length > 0) {
    // 1. Localização dinâmica da linha de cabeçalho
    let headerRow: HTMLElement | null = doc.querySelector('tr.chRow, [role="row"].chRow, div.chRow, thead tr') as HTMLElement | null;

    if (!headerRow) {
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('th, td, [role="columnheader"], [role="gridcell"], div[class*="cell"], div[class*="col"]'));
        if (cells.length < 5) continue;
        const texts = cells.map((c) => normalizeHeader(c.textContent));

        const hasOp = texts.some((t) => (t.includes('ordem') || t.includes('op')) && !t.includes('entrega') && !t.includes('status'));
        const hasDescOrCod = texts.some((t) => t.includes('desc') || t.includes('cod') || t.includes('produto') || t.includes('item'));
        const hasEntrega = texts.some((t) => t.includes('entrega') || t.includes('prazo') || t.includes('previsao'));

        if ((hasOp && (hasDescOrCod || hasEntrega)) || (hasDescOrCod && hasEntrega)) {
          headerRow = row as HTMLElement;
          break;
        }
      }
    }

    if (!headerRow) {
      const thRow = rows.find((r) => r.querySelectorAll('th, [role="columnheader"]').length >= 5);
      if (thRow) {
        headerRow = thRow as HTMLElement;
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
      const headerCells = Array.from(headerRow.querySelectorAll('th, td, [role="columnheader"], [role="gridcell"], div[class*="cell"], div[class*="col"]'));
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

      const rowClass = (row.className || '').trim();
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

      let cells = Array.from(row.querySelectorAll('td, [role="gridcell"], div[class*="cell"], div[class*="col"]'));
      if (cells.length === 0) {
        cells = Array.from(row.childNodes).filter((n) => n.nodeType === 1) as HTMLElement[];
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
        numero = `OP ${cleanCode}`;
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
      let quantidadeM2: number | undefined = undefined;
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
      let defaultFactoryStatus: FactoryStatus = 'Produzindo Hoje';
      if (deadline.isDelayed) {
        defaultFactoryStatus = 'Atrasada';
      } else if (statusNomus.toUpperCase().includes('LIBERADA')) {
        defaultFactoryStatus = 'Falta Injetar';
      }

      const cleanId = normalizarIdOP(numero);
      const docId = formatarNumeroOP(cleanId);

      const novaOp: ProductionOrder = {
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
        novaOp.requerLaser = 1 as any;
        novaOp.requer_laser = 1 as any;
      }
      if (rotaInfo.requerRouter) {
        novaOp.requerRouter = 1 as any;
        novaOp.requer_router = 1 as any;
        (novaOp as any).encaminhar_router = 1;
      }

      orders.push(novaOp);
    }
  }

  // STRATEGY 2: Fallback por Regex e varredura de tags contextuais caso Strategy 1 não tenha encontrado OPs
  if (orders.length === 0) {
    const opRegex = /(?:OP\s*)?(\d{4,8}[-_/]\d{1,3})/gi;
    const matches = Array.from(htmlContent.matchAll(opRegex));
    const seenOps = new Set<string>();

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
      const tagTextMatches = Array.from(contextWindow.matchAll(/>([^<>]{3,120})</g))
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
      let quantidadeM2: number | undefined = undefined;
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
      let defaultFactoryStatus: FactoryStatus = 'Produzindo Hoje';
      if (deadline.isDelayed) {
        defaultFactoryStatus = 'Atrasada';
      } else if (statusNomus.toUpperCase().includes('LIBERADA')) {
        defaultFactoryStatus = 'Falta Injetar';
      }

      const novaOp: ProductionOrder = {
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
        novaOp.requerLaser = 1 as any;
        novaOp.requer_laser = 1 as any;
      }
      if (rotaInfo.requerRouter) {
        novaOp.requerRouter = 1 as any;
        novaOp.requer_router = 1 as any;
        (novaOp as any).encaminhar_router = 1;
      }

      orders.push(novaOp);
    }
  }

  // Deduplicação por número normalizado
  const uniqueMap = new Map<string, ProductionOrder>();
  orders.forEach((o) => {
    uniqueMap.set(o.numero_normalizado || o.numero || o.op_numero, o);
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

/**
 * Retorna o número da OP formatado de forma segura e padronizada com o prefixo 'OP '.
 * Ex: '024455-01'       -> 'OP 024455-01'
 *     'OP OP 024455-01' -> 'OP 024455-01'
 */
export const formatOpNumber = (rawId: string | number | null | undefined): string => {
  const clean = normalizarIdOP(rawId);
  return clean ? `OP ${clean}` : '';
};

