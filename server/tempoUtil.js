/**
 * Utilitário Central de Horas Úteis de Expediente e Pausas Programadas Metalrib (Backend Node.js)
 * Desconta automaticamente pausas de café, almoço e fora de expediente sem exigir ações manuais dos operadores.
 */

const PAUSAS_PROGRAMADAS = [
  // Segunda a Sexta: Café da manhã (09:20 às 09:30 - 10 min)
  { nome: 'Café da Manhã', inicioHora: 9, inicioMin: 20, fimHora: 9, fimMin: 30, diasSemana: [1, 2, 3, 4, 5] },
  // Segunda a Sexta: Almoço (12:18 às 13:30 - 1h12 / 72 min)
  { nome: 'Almoço', inicioHora: 12, inicioMin: 18, fimHora: 13, fimMin: 30, diasSemana: [1, 2, 3, 4, 5] },
  // Segunda a Sexta: Café da tarde (15:50 às 16:00 - 10 min)
  { nome: 'Café da Tarde', inicioHora: 15, inicioMin: 50, fimHora: 16, fimMin: 0, diasSemana: [1, 2, 3, 4, 5] },
  // Segunda a Sexta: Fora de Expediente (Noite 18:00 às 23:59)
  { nome: 'Fora de Expediente', inicioHora: 18, inicioMin: 0, fimHora: 23, fimMin: 59, diasSemana: [1, 2, 3, 4, 5] },
  // Segunda a Sexta: Fora de Expediente (Madrugada 00:00 às 08:00)
  { nome: 'Fora de Expediente', inicioHora: 0, inicioMin: 0, fimHora: 8, fimMin: 0, diasSemana: [1, 2, 3, 4, 5] },
  // Sábado: Fora de Expediente (Madrugada 00:00 às 06:00)
  { nome: 'Fora de Expediente', inicioHora: 0, inicioMin: 0, fimHora: 6, fimMin: 0, diasSemana: [6] },
  // Sábado: Fim de Semana (Após 12:00 até 23:59)
  { nome: 'Fim de Semana', inicioHora: 12, inicioMin: 0, fimHora: 23, fimMin: 59, diasSemana: [6] },
  // Domingo: Dia todo
  { nome: 'Domingo', inicioHora: 0, inicioMin: 0, fimHora: 23, fimMin: 59, diasSemana: [0] }
];

function getPausaAtual(data = new Date()) {
  const dia = data.getDay();
  const minutosAtuais = data.getHours() * 60 + data.getMinutes();
  for (const pausa of PAUSAS_PROGRAMADAS) {
    if (pausa.diasSemana.includes(dia)) {
      const minInicio = pausa.inicioHora * 60 + pausa.inicioMin;
      const minFim = pausa.fimHora === 23 && pausa.fimMin === 59 ? 1440 : pausa.fimHora * 60 + pausa.fimMin;
      if (minutosAtuais >= minInicio && minutosAtuais < minFim) {
        return pausa;
      }
    }
  }
  return null;
}

function toTimestampMs(val) {
  if (!val) return 0;
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'number') return val;
  const parsed = new Date(val).getTime();
  return isNaN(parsed) ? 0 : parsed;
}

function calcularDuracaoLiquidaMs(inicio, fim = Date.now()) {
  const inicioMs = toTimestampMs(inicio);
  const fimMs = toTimestampMs(fim);

  if (!inicioMs || fimMs <= inicioMs) return 0;
  let totalMsDescontar = 0;
  const cursor = new Date(inicioMs);
  const dataFim = new Date(fimMs);

  let safetyCounter = 0;
  while (cursor <= dataFim && safetyCounter < 60) {
    safetyCounter++;
    const dia = cursor.getDay();
    const ano = cursor.getFullYear();
    const mes = cursor.getMonth();
    const diaMes = cursor.getDate();

    for (const pausa of PAUSAS_PROGRAMADAS) {
      if (pausa.diasSemana.includes(dia)) {
        const pausaInicio = new Date(ano, mes, diaMes, pausa.inicioHora, pausa.inicioMin, 0, 0).getTime();
        const pausaFim =
          pausa.fimHora === 23 && pausa.fimMin === 59
            ? new Date(ano, mes, diaMes + 1, 0, 0, 0, 0).getTime()
            : new Date(ano, mes, diaMes, pausa.fimHora, pausa.fimMin, 0, 0).getTime();

        const intersecInicio = Math.max(inicioMs, pausaInicio);
        const intersecFim = Math.min(fimMs, pausaFim);

        if (intersecFim > intersecInicio) {
          totalMsDescontar += intersecFim - intersecInicio;
        }
      }
    }

    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }

  const duracaoBruta = fimMs - inicioMs;
  return Math.max(0, duracaoBruta - totalMsDescontar);
}

function calcularSegundosUteis(inicio, fim = Date.now()) {
  const duracaoMs = calcularDuracaoLiquidaMs(inicio, fim);
  return Math.max(0, Math.floor(duracaoMs / 1000));
}

function formatarTempoUteis(segundos) {
  const sec = Math.max(0, Math.floor(segundos));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatarDuracaoMinutos(duracaoMs) {
  const minutos = Math.max(1, Math.round(duracaoMs / 60000));
  if (minutos < 60) {
    return `${minutos} min`;
  }
  const horas = Math.floor(minutos / 60);
  const minRest = minutos % 60;
  return minRest > 0 ? `${horas}h ${minRest}m` : `${horas}h`;
}

module.exports = {
  PAUSAS_PROGRAMADAS,
  getPausaAtual,
  toTimestampMs,
  calcularDuracaoLiquidaMs,
  calcularSegundosUteis,
  formatarTempoUteis,
  formatarDuracaoMinutos
};
