import { ProductionOrder, FactoryStatus } from '../types/mes';
import { obterEtapasDaRota } from './routeValidation';

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
  const rows = Array.from(doc.querySelectorAll('tr'));

  if (rows.length === 0) {
    return { orders: [], rawCount: 0, warnings: ['Nenhuma linha de tabela encontrada no HTML fornecido.'] };
  }

  // 1. Localização dinâmica da linha de cabeçalho (<tr class="chRow"> ou primeira <tr> com <td> ou <th> de cabeçalho)
  let headerRow: HTMLTableRowElement | null = doc.querySelector('tr.chRow') as HTMLTableRowElement | null;

  if (!headerRow) {
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('th, td'));
      if (cells.length < 5) continue;
      const texts = cells.map((c) => normalizeHeader(c.textContent));

      const hasOp = texts.some((t) => (t.includes('ordem') || t.includes('op')) && !t.includes('entrega') && !t.includes('status'));
      const hasDescOrCod = texts.some((t) => t.includes('desc') || t.includes('cod') || t.includes('produto'));
      const hasEntrega = texts.some((t) => t.includes('entrega') || t.includes('prazo'));

      if ((hasOp && (hasDescOrCod || hasEntrega)) || (hasDescOrCod && hasEntrega)) {
        headerRow = row;
        break;
      }
    }
  }

  if (!headerRow) {
    const thRow = rows.find((r) => r.querySelectorAll('th').length >= 5);
    if (thRow) {
      headerRow = thRow;
    }
  }

  // 2. Mapeamento dinâmico de cabeçalhos (sem índice fixo)
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
    const headerCells = Array.from(headerRow.querySelectorAll('th, td'));
    headerCells.forEach((cell, idx) => {
      const norm = normalizeHeader(cell.textContent);

      // 'entrega' -> Data de Entrega
      if (norm.includes('entrega') || norm.includes('prazo') || norm.includes('previsao')) {
        idxEntrega = idx;
      }
      // 'status' -> Status no ERP Nomus
      else if (norm.includes('status') || norm.includes('situacao')) {
        idxStatus = idx;
      }
      // 'qtde' ou 'quantidade' (que não contenha 'produzida') -> Quantidade Total
      else if (norm.includes('qtde') || norm.includes('quantidade') || norm.includes('qtd')) {
        if (norm.includes('produz') || norm.includes('prod')) {
          idxQtdeProduzida = idx;
        } else {
          idxQtde = idx;
        }
      }
      // 'ordem' ou 'op' -> Índice da OP
      else if (norm.includes('ordem') || norm.includes('op') || norm.includes('numero') || norm.includes('num op') || norm.includes('nº op')) {
        idxOp = idx;
      }
      // 'descricao' -> Descrição do Produto
      else if (norm.includes('desc') || norm.includes('produto') || norm.includes('item')) {
        idxDescricao = idx;
      }
      // 'codigo' -> Código do Produto
      else if (norm.includes('cod') || norm.includes('ref')) {
        idxCodigo = idx;
      }
      // 'lote' -> Informações do Lote
      else if (norm.includes('lote')) {
        idxLote = idx;
      }
      // 'observacao' -> Observações
      else if (norm.includes('observ') || norm.includes('obs') || norm.includes('nota')) {
        idxObservacao = idx;
      }
    });
  }

  // Fallback inteligente caso algum cabeçalho não tenha sido mapeado
  if (idxOp === -1) {
    const sampleRow = rows.find((r) => r !== headerRow && r.querySelectorAll('td').length >= 8);
    const colCount = sampleRow ? sampleRow.querySelectorAll('td').length : 10;
    if (colCount >= 10) {
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

  // 3. Tratamento de agrupamentos e células vazias (&nbsp;) com memória carry-down
  let ultimaDataEntrega = '';
  let ultimoStatus = '';
  let ultimaDescricaoValida = '';
  let ultimoCodigoValido = '';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row === headerRow) {
      continue;
    }

    // Ignore linhas de subtotais e resumo (class="sL", class="sR", class="tL", class="tR" ou que contenham 'Resumo Geral')
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

    // Ignora linhas de cabeçalho secundárias repetidas
    if (row.querySelector('th') && !row.querySelector('td')) {
      continue;
    }
    if (rowLower.includes('entrega op') && (rowLower.includes('ordem') || rowLower.includes('descricao'))) {
      continue;
    }

    const cells = Array.from(row.querySelectorAll('td'));
    if (cells.length === 0) {
      continue;
    }

    // 1. Atualização prioritária da memória carry-down (Data, Status, Descrição e Código)
    // Se a célula de 'Entrega OP' tiver texto válido, atualize ultimaDataEntrega. Se estiver vazia ou com &nbsp;, use ultimaDataEntrega
    const rawEntrega = idxEntrega >= 0 && cells[idxEntrega] ? cleanCellText(cells[idxEntrega]) : '';
    if (isValidDataValue(rawEntrega)) {
      ultimaDataEntrega = rawEntrega;
    }
    const dataEntrega = ultimaDataEntrega;

    // Se a célula de 'Status' tiver texto válido, atualize ultimoStatus. Se estiver vazia ou com &nbsp;, use ultimoStatus
    const rawStatus = idxStatus >= 0 && cells[idxStatus] ? cleanCellText(cells[idxStatus]) : '';
    if (isValidDataValue(rawStatus)) {
      ultimoStatus = rawStatus;
    }
    const statusNomus = ultimoStatus || 'Liberada';

    // Descrição do Produto (com memória carry-down para células mescladas)
    const celulaDescricao = idxDescricao >= 0 && cells[idxDescricao] ? cells[idxDescricao] : null;
    let descTexto = celulaDescricao ? cleanCellText(celulaDescricao) : '';
    if (descTexto && isValidDataValue(descTexto)) {
      ultimaDescricaoValida = descTexto;
    } else {
      descTexto = ultimaDescricaoValida; // Herda imediatamente da linha anterior
    }

    // Código do Produto (com memória carry-down para células mescladas)
    const celulaCodigo = idxCodigo >= 0 && cells[idxCodigo] ? cells[idxCodigo] : null;
    let codTexto = celulaCodigo ? cleanCellText(celulaCodigo) : '';
    if (codTexto && isValidDataValue(codTexto)) {
      ultimoCodigoValido = codTexto;
    } else {
      codTexto = ultimoCodigoValido; // Herda imediatamente da linha anterior
    }

    // 2. Extraia o texto da célula de Ordem de Produção
    let rawOpCellText = '';
    if (idxOp >= 0 && cells[idxOp]) {
      rawOpCellText = cleanCellText(cells[idxOp]);
    }

    const isOpPattern = (txt: string) => /OP\s*\d+/i.test(txt) || /\b\d{4,8}[\-_/]\d{1,3}\b/.test(txt);

    // Se o índice mapeado não contiver padrão de OP, busca dinamicamente em qualquer outra célula da linha como tolerância
    if (!isOpPattern(rawOpCellText)) {
      const foundCell = cells.find((c) => isOpPattern(cleanCellText(c)));
      if (!foundCell) {
        // Linha sem OP (ex: linha de agrupamento/cabeçalho de grupo).
        // Como a memória carry-down já foi atualizada acima, ignora a linha sem perder os dados herdáveis.
        continue;
      }
      rawOpCellText = cleanCellText(foundCell);
    }

    // Formate o número da OP sempre no padrão OP XXXXXX-XX
    const opMatch = rawOpCellText.match(/OP\s*(\d+[\-_/]\d+)/i) || rawOpCellText.match(/(\d{4,8}[\-_/]\d{1,3})/i);
    let numero = '';
    if (opMatch) {
      const cleanCode = opMatch[1].replace(/[_/]/g, '-');
      numero = `OP ${cleanCode}`;
    } else {
      const cleanCode = rawOpCellText.replace(/^(\s*OP\s*)+/i, '').trim();
      numero = cleanCode.startsWith('OP') ? cleanCode : `OP ${cleanCode}`;
    }

    // Regra mandatória de herança imediata:
    // Se a célula de descrição ou código vier vazia/&nbsp;, herda imediatamente da linha anterior
    const fallbackDesc = numero.startsWith('OP') ? `PRODUTO ${numero}` : `PRODUTO OP ${numero}`;
    const descricao = descTexto || ultimaDescricaoValida || fallbackDesc;
    const codigo = codTexto || ultimoCodigoValido || undefined;

    // Informações do Lote
    const rawLote = idxLote >= 0 && cells[idxLote] ? cleanCellText(cells[idxLote]) : '';
    const lote = isValidDataValue(rawLote) ? rawLote : '—';

    // Observações
    const rawObs = idxObservacao >= 0 && cells[idxObservacao] ? cleanCellText(cells[idxObservacao]) : '';
    const observacao = isValidDataValue(rawObs) ? rawObs : undefined;

    // Converta a coluna 'Qtde' substituindo vírgulas por pontos antes de aplicar parseFloat (ex: 15.00 ou 6,60)
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

    // Identificação de Quantidade em M²
    const isDecimal = Math.abs(parsedQtd - Math.round(parsedQtd)) > 0.001;
    const descUpper = descricao.toUpperCase();
    const hasM2InDesc = descUpper.includes('M2') || descUpper.includes('M²') || descUpper.includes('VAI VEM');
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

    // Quantidade Produzida
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

    // Status da fábrica baseado no prazo e situação
    const deadline = calculateDeadlineInfo(dataEntrega);
    let defaultFactoryStatus: FactoryStatus = 'Produzindo Hoje';
    if (deadline.isDelayed) {
      defaultFactoryStatus = 'Atrasada';
    } else if (statusNomus.toUpperCase().includes('LIBERADA')) {
      defaultFactoryStatus = 'Falta Injetar';
    }

    const novaOp: ProductionOrder = {
      op_numero: numero,
      numero: numero,
      numeroOP: numero,
      descricao: descricao.toUpperCase(),
      codigo: codigo,
      codigoProduto: codigo || '',
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
    };

    const codStr = String(novaOp.codigoProduto || (novaOp as any).cod || novaOp.codigo || '').trim();

    // SE FOR LINHA SUPER CONG (007, 003 OU TEXTO SUPER CONG)
    if (
      codStr.startsWith('007.') ||
      codStr.startsWith('003.') ||
      codStr.startsWith('007') ||
      codStr.startsWith('003') ||
      descUpper.includes('007.') ||
      descUpper.includes('003.') ||
      descUpper.includes('SUPER CONG') ||
      descUpper.includes('SUPER CONGELADO')
    ) {
      if (
        codStr.startsWith('003.') ||
        codStr.startsWith('003') ||
        descUpper.includes('003.') ||
        descUpper.includes('PT GIR') ||
        descUpper.includes('GIRO')
      ) {
        novaOp.etapas = [
          'Corte',
          'Dobra',
          'Preparação de Folhas',
          'Injeção de Folhas',
          'Montagem de Portas Giratória'
        ];
      } else {
        novaOp.etapas = [
          'Corte',
          'Dobra',
          'Preparação de Folhas',
          'Injeção de Folhas',
          'Montagem Portas de Correr Padrão e Especial'
        ];
      }
      novaOp.etapaAtual = 'Corte';
      novaOp.statusEtapa = 'Aguardando Início em: Corte';
      novaOp.status = 'Aguardando Início em: Corte';
    } else {
      const rotasCalculadas = obterEtapasDaRota(novaOp);
      novaOp.etapas = rotasCalculadas;
      novaOp.etapaAtual = rotasCalculadas[0] || 'Corte';
      novaOp.statusEtapa = `Aguardando Início em: ${novaOp.etapaAtual}`;
      novaOp.status = `Aguardando Início em: ${novaOp.etapaAtual}`;
    }

    orders.push(novaOp);
  }

  // Deduplicação garantida por op_numero
  const uniqueMap = new Map<string, ProductionOrder>();
  orders.forEach((o) => {
    uniqueMap.set(o.op_numero, o);
  });

  const finalOrders = Array.from(uniqueMap.values());

  // SOBREPOSIÇÃO OBRIGATÓRIA DE ROTA INDUSTRIAL (FABRICAÇÃO COMPLETA)
  finalOrders.forEach((op: any) => {
    const codNorm = String(op.codigoProduto || op.cod || op.codigo || '').trim();
    const descNorm = String(op.descricao || op.produto || '').toUpperCase();

    const ehSuperCong = 
      codNorm.startsWith('007.') || 
      codNorm.startsWith('003.') || 
      descNorm.includes('SUPER CONG');

    if (ehSuperCong) {
      if (codNorm.startsWith('003.') || descNorm.includes('PT GIR')) {
        // Porta de Giro Super Congelada
        op.etapas = [
          'Corte',
          'Dobra',
          'Preparação de Folhas',
          'Injeção de Folhas',
          'Montagem de Portas Giratória'
        ];
      } else {
        // Porta de Correr Super Congelada (ex: OP 024048-01 e OP 024049-01)
        op.etapas = [
          'Corte',
          'Dobra',
          'Preparação de Folhas',
          'Injeção de Folhas',
          'Montagem Portas de Correr Padrão e Especial'
        ];
      }
      op.etapaAtual = 'Corte';
      op.statusEtapa = 'Aguardando Início em: Corte';
    }
  });

  if (finalOrders.length === 0) {
    warnings.push(
      'Nenhuma OP válida encontrada no relatório HTML do Nomus. Certifique-se de que o arquivo possui ordens com o padrão "OP XXXXXX-XX".'
    );
  }

  return {
    orders: finalOrders,
    rawCount: finalOrders.length,
    warnings
  };
}
