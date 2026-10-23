import { ProductionOrder, FactoryStatus } from '../types/mes';

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
      className: cls
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
      // Vencida: Exibir Badge Vermelho com os dias exatos de atraso
      const text = `⚠ ${diffDays}d atraso`;
      const cls = 'bg-red-950/80 text-red-400 border border-red-800';
      return {
        isDelayed: true,
        daysDiff: -diffDays,
        label: text,
        text,
        badgeClass: cls,
        className: cls
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
        className: cls
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
        className: cls
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
    className: cls
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

function cleanProducedNumber(val: string | undefined): number {
  if (!val) return 0;
  const cleaned = val.replace(/\s+/g, '').replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) || num < 0 ? 0 : Math.round(num);
}

/**
 * Parser especializado do relatório Status_Ordem_Producao_Diario do Nomus ERP
 * 
 * Regras estritas (10 colunas):
 * - td[0]: Número sequencial da linha (ex: "26") -> IGNORAR/DESCARTAR.
 * - td[1]: data_entrega -> Ex: "16/10/26" (se vier em branco por mesclagem, herdar da linha anterior válida).
 * - td[2]: status_nomus -> Ex: "Requisitada totalmente" (herdar se vazio).
 * - td[3]: descricao -> Ex: "PT GIR RESF 2.000A X 1.000L 4BAT REV CH" (Descrição do Produto).
 * - td[4]: codigo -> Ex: "001.0123" (Código do Item).
 * - td[5]: lote -> Se vier &nbsp; ou vazio, preencher com "—".
 * - td[6]: observacao -> Ex: "BOLHA / ESTOQUE" ou "TRANSPORTE".
 * - td[7]: numero -> Ex: "OP 023912-01" (apenas uma ocorrência, NUNCA duplicar "OP OP").
 * - td[8]: quantidade -> parseFloat(td[8].innerText.replace(',', '.')) -> Ex: 4.00.
 * - td[9]: qtde_produzida -> Ex: 0.00.
 * 
 * Descarte obrigatório:
 * - Ignore linhas de cabeçalho (<th> ou linhas com texto "Entrega OP").
 * - Ignore qualquer <tr> que não contenha "OP " na coluna td[7].
 * - Ignore linhas com texto "Resumo Geral".
 */
export function parseNomusHtml(htmlContent: string): NomusParseResult {
  const warnings: string[] = [];
  const orders: ProductionOrder[] = [];

  if (!htmlContent || typeof htmlContent !== 'string') {
    return { orders: [], rawCount: 0, warnings: ['Conteúdo HTML vazio ou inválido.'] };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');
  const rows = Array.from(doc.querySelectorAll('tr'));

  let lastValidEntrega = '';
  let lastValidStatus = '';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowText = (row.textContent || '').replace(/\u00a0/g, ' ').trim();

    // 1. Descarte: Linhas com "Resumo Geral", paginação, subtotais
    const rowLower = rowText.toLowerCase();
    if (
      rowLower.includes('resumo geral') ||
      rowLower.includes('subtotal') ||
      rowLower.includes('total geral') ||
      rowLower.includes('registros encontrados')
    ) {
      continue;
    }

    // 2. Descarte: Linhas de cabeçalho (<th> ou texto "Entrega OP")
    if (row.querySelector('th') && !row.querySelector('td')) {
      continue;
    }
    if (rowLower.includes('entrega op')) {
      continue;
    }

    const cells = Array.from(row.querySelectorAll('td'));
    // É necessário ter pelo menos 8 colunas para alcançar td[7]
    if (cells.length < 8) {
      continue;
    }

    // td[7]: numero -> Ex: "OP 023912-01"
    const rawNumeroCell = (cells[7]?.textContent || '').replace(/\u00a0/g, ' ').trim();

    // Regra OBRIGATÓRIA: Ignore qualquer <tr> que não contenha "OP " na coluna td[7]
    if (!rawNumeroCell.toUpperCase().startsWith('OP ')) {
      continue;
    }

    // Garante que o número da OP tenha apenas uma ocorrência de "OP " e nunca duplique "OP OP"
    const numero = rawNumeroCell.replace(/^(\s*OP\s*)+/i, 'OP ').trim();

    // td[0]: Número sequencial (descartado)

    // td[1]: data_entrega -> Ex: "16/10/26" (herança de célula mesclada válida)
    const rawEntrega = (cells[1]?.textContent || '').replace(/\u00a0/g, ' ').trim();
    let dataEntrega = rawEntrega;
    if (dataEntrega && dataEntrega !== '-' && dataEntrega !== '—') {
      lastValidEntrega = dataEntrega;
    } else {
      dataEntrega = lastValidEntrega;
    }

    // td[2]: status_nomus -> Ex: "Requisitada totalmente" (herança de célula mesclada)
    const rawStatus = (cells[2]?.textContent || '').replace(/\u00a0/g, ' ').trim();
    let statusNomus = rawStatus;
    if (statusNomus && statusNomus !== '-' && statusNomus !== '—') {
      lastValidStatus = statusNomus;
    } else {
      statusNomus = lastValidStatus;
    }

    // td[3]: descricao -> Ex: "PT GIR RESF 2.000A X 1.000L 4BAT REV CH" (Descrição do Produto)
    let descricao = (cells[3]?.textContent || '').replace(/\u00a0/g, ' ').trim();
    if (!descricao) {
      descricao = `PRODUTO ${numero}`;
    }

    // td[4]: codigo -> Ex: "001.0123" (Código do Item)
    const rawCodigo = (cells[4]?.textContent || '').replace(/\u00a0/g, ' ').trim();
    const codigo = rawCodigo && rawCodigo !== '-' && rawCodigo !== '—' ? rawCodigo : undefined;

    // td[5]: lote -> Se vier &nbsp; ou vazio, preencher com "—"
    const rawLote = (cells[5]?.textContent || '').replace(/\u00a0/g, ' ').trim();
    const lote = rawLote && rawLote !== '-' ? rawLote : '—';

    // td[6]: observacao -> Ex: "BOLHA / ESTOQUE" ou "TRANSPORTE"
    const rawObs = (cells[6]?.textContent || '').replace(/\u00a0/g, ' ').trim();
    const observacao = rawObs && rawObs !== '-' && rawObs !== '—' ? rawObs : undefined;

    // td[8]: quantidade -> parseFloat(td[8].innerText.replace(',', '.')) -> Ex: 4.00 ou 6.60
    const rawQtd = cells[8] ? (cells[8].textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, '').replace(',', '.') : '1';
    const parsedQtd = parseFloat(rawQtd);

    // Identificação de Quantidade em M² (valores decimais como 6.60, 3.30, 2.64 ou menção na descrição/código)
    const isDecimal = !isNaN(parsedQtd) && Math.abs(parsedQtd - Math.round(parsedQtd)) > 0.001;
    const descUpper = descricao.toUpperCase();
    const hasM2InDesc = descUpper.includes('M2') || descUpper.includes('M²') || descUpper.includes('VAI VEM');
    const isM2 = (isDecimal || descUpper.includes('M2') || descUpper.includes('M²')) && !isNaN(parsedQtd) && parsedQtd > 0;

    let quantidadeTotal = 1;
    let quantidadeM2: number | undefined = undefined;
    let unidadeMedida = 'PC';

    if (isM2) {
      unidadeMedida = 'M²';
      quantidadeM2 = Number(parsedQtd.toFixed(2));
      quantidadeTotal = deducePhysicalUnitsFromM2(descricao, parsedQtd);
    } else {
      quantidadeTotal = isNaN(parsedQtd) || parsedQtd <= 0 ? 1 : Math.round(parsedQtd);
    }

    // td[9]: qtde_produzida -> Ex: 0.00
    const rawProd = cells[9] ? (cells[9].textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, '').replace(',', '.') : '0';
    const parsedProd = parseFloat(rawProd);
    const qtdeProduzida = isNaN(parsedProd) || parsedProd < 0 ? 0 : Math.round(parsedProd);

    // Status da fábrica baseado no prazo e situação
    const deadline = calculateDeadlineInfo(dataEntrega);
    let defaultFactoryStatus: FactoryStatus = 'Produzindo Hoje';
    if (deadline.isDelayed) {
      defaultFactoryStatus = 'Atrasada';
    } else if (statusNomus.toUpperCase().includes('LIBERADA')) {
      defaultFactoryStatus = 'Falta Injetar';
    }

    orders.push({
      op_numero: numero,
      numero: numero,
      descricao: descricao.toUpperCase(),
      codigo: codigo,
      lote: lote,
      observacao: observacao,
      quantidade_total: quantidadeTotal,
      quantidade: quantidadeTotal,
      quantidade_m2: quantidadeM2,
      qtde_produzida: qtdeProduzida,
      data_entrega: dataEntrega || undefined,
      status_nomus: statusNomus || 'Liberada',
      status_fabrica: defaultFactoryStatus,
      unidade_medida: unidadeMedida,
      cliente: 'Nomus ERP',
      status: 'EM_PRODUCAO',
      data_criacao: new Date().toISOString()
    });
  }

  // Deduplicação garantida por op_numero
  const uniqueMap = new Map<string, ProductionOrder>();
  orders.forEach((o) => {
    uniqueMap.set(o.op_numero, o);
  });

  const finalOrders = Array.from(uniqueMap.values());

  if (finalOrders.length === 0) {
    warnings.push('Nenhuma OP válida encontrada no HTML. Certifique-se de que as linhas contêm a coluna td[7] iniciando com "OP ".');
  }

  return {
    orders: finalOrders,
    rawCount: finalOrders.length,
    warnings
  };
}
