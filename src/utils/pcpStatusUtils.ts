/**
 * Utilitários para Status Macro do PCP, Cálculo de Prazos, Classificação de Famílias e Linha do Tempo
 */

export interface ParsedDate {
  day: number;
  month: number;
  year: number;
  dateObj: Date;
}

/**
 * Converte data em string (DD/MM/AAAA, DD/MM/AA ou YYYY-MM-DD) para objeto Date
 */
export function parseDataEntrega(dataStr?: string | null): ParsedDate | null {
  if (!dataStr || typeof dataStr !== 'string') return null;
  const trimmed = dataStr.trim();
  if (!trimmed || trimmed === '—' || trimmed === '-') return null;

  let year: number, month: number, day: number;

  // DD/MM/YYYY ou DD/MM/AA
  const dmyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (dmyMatch) {
    day = parseInt(dmyMatch[1], 10);
    month = parseInt(dmyMatch[2], 10) - 1; // 0-indexed
    let y = parseInt(dmyMatch[3], 10);
    year = y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y;
  } else {
    // YYYY-MM-DD
    const ymdMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (ymdMatch) {
      year = parseInt(ymdMatch[1], 10);
      month = parseInt(ymdMatch[2], 10) - 1;
      day = parseInt(ymdMatch[3], 10);
    } else {
      const parsedDate = new Date(trimmed);
      if (!isNaN(parsedDate.getTime())) {
        year = parsedDate.getFullYear();
        month = parsedDate.getMonth();
        day = parsedDate.getDate();
      } else {
        return null;
      }
    }
  }

  const dateObj = new Date(year, month, day, 23, 59, 59, 999);
  return { day, month: month + 1, year, dateObj };
}

/**
 * Retorna true se a data de entrega é exatamente hoje
 */
export function isEntregaHoje(dataStr?: string | null, statusMacro?: string | null): boolean {
  if (statusMacro === 'embalada') return false;
  const parsed = parseDataEntrega(dataStr);
  if (!parsed) return false;

  const hoje = new Date();
  return (
    parsed.day === hoje.getDate() &&
    parsed.month === hoje.getMonth() + 1 &&
    parsed.year === hoje.getFullYear()
  );
}

/**
 * Retorna true se o prazo está vencido e não foi concluída
 */
export function isAtrasada(dataStr?: string | null, statusMacro?: string | null): boolean {
  if (statusMacro === 'atrasada') return true;
  if (statusMacro === 'embalada') return false;
  const parsed = parseDataEntrega(dataStr);
  if (!parsed) return false;

  const now = Date.now();
  return parsed.dateObj.getTime() < now;
}

/**
 * Retorna a diferença em dias entre a data de entrega e hoje (número negativo = atraso)
 */
export function getDiasRestantes(dataStr?: string | null): number | null {
  const parsed = parseDataEntrega(dataStr);
  if (!parsed) return null;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const target = new Date(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0);

  const diffMs = target.getTime() - hoje.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export type TimelineBucket = 'atrasadas' | 'hoje' | 'proximos_3_dias' | 'esta_semana' | 'futuro';

/**
 * Agrupa uma OP em um dos 5 buckets da Linha do Tempo
 */
export function classificarBucketTimeline(dataStr?: string | null, statusMacro?: string | null): TimelineBucket {
  if (statusMacro === 'atrasada') return 'atrasadas';
  if (isEntregaHoje(dataStr, statusMacro)) return 'hoje';

  const dias = getDiasRestantes(dataStr);
  if (dias === null) return 'futuro';

  if (dias < 0) return 'atrasadas';
  if (dias === 0) return 'hoje';
  if (dias >= 1 && dias <= 3) return 'proximos_3_dias';
  if (dias >= 4 && dias <= 7) return 'esta_semana';
  return 'futuro';
}
