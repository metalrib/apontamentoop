import React, { useState, useMemo } from 'react';
import { Apontamento, ProductionOrder } from '../types/mes';
import { Search, Trash2, Download, Calendar, Filter, Clock } from 'lucide-react';
import { playClick } from '../utils/audio';

export type DateFilterType = 'hoje' | 'ontem' | '7dias' | 'todos';
export type TerminalFilterChoice = 'TODOS' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5';

export interface AppointmentsHistoryProps {
  apontamentos: Apontamento[];
  orders?: Record<string, ProductionOrder>;
  onClearAll: () => Promise<void> | void;
  onDeleteOne?: (apt: Apontamento) => Promise<void> | void;
  onSelectOp?: (opNumero: string) => void;
  onExportCsv?: () => void;
}

const DATE_PERIODS: { id: DateFilterType; label: string }[] = [
  { id: 'hoje', label: 'Hoje' },
  { id: 'ontem', label: 'Ontem' },
  { id: '7dias', label: 'Últimos 7 dias' },
  { id: 'todos', label: 'Todos os Registros' }
];

const TERMINAL_FILTERS: { id: TerminalFilterChoice; label: string }[] = [
  { id: 'TODOS', label: 'Todos' },
  { id: 'T1', label: 'T1' },
  { id: 'T2', label: 'T2' },
  { id: 'T3', label: 'T3' },
  { id: 'T4', label: 'T4' },
  { id: 'T5', label: 'T5' }
];

export function isAptInDateRange(apt: Apontamento, range: DateFilterType): boolean {
  if (range === 'todos') return true;

  // Se o apontamento estiver em andamento no momento, pertence a "hoje" e "7 dias"
  if (apt.status === 'EM_ANDAMENTO') {
    if (range === 'hoje' || range === '7dias') return true;
    if (range === 'ontem') return false;
  }

  const dateStr = apt.hora_inicio || apt.horaInicio || apt.hora_fim || apt.horaFim;
  if (!dateStr) return false;

  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;

  const now = new Date();

  if (range === 'hoje') {
    return (
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()
    );
  }

  if (range === 'ontem') {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return (
      d.getDate() === yesterday.getDate() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getFullYear() === yesterday.getFullYear()
    );
  }

  if (range === '7dias') {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    return d.getTime() >= sevenDaysAgo.getTime();
  }

  return true;
}

export function doesAptMatchTerminal(apt: Apontamento, termChoice: TerminalFilterChoice): boolean {
  if (termChoice === 'TODOS') return true;
  const targetId = Number(termChoice.replace('T', ''));
  if (apt.terminal_id === targetId) return true;
  const tStr = String(apt.terminal || '').toUpperCase();
  if (tStr.includes(`T${targetId}`) || tStr.includes(String(targetId))) return true;
  return false;
}

export function getEtapaPostoDisplay(apt: Apontamento): string {
  const setor = (apt.setorFisico || apt.setor || '').trim();
  const etapa = (apt.etapaRota || apt.etapa_rota || '').trim();

  if (!etapa && !setor) return '—';
  if (!etapa) return setor;
  if (!setor) return etapa;

  const normSetor = setor.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normEtapa = etapa.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (normSetor === normEtapa) {
    return etapa;
  }

  return `${etapa} (${setor})`;
}

export const AppointmentsHistory: React.FC<AppointmentsHistoryProps> = ({
  apontamentos,
  orders = {},
  onClearAll,
  onDeleteOne,
  onSelectOp,
  onExportCsv
}) => {
  // 1. Filtro Temporal com "Hoje" como padrão
  const [dateFilter, setDateFilter] = useState<DateFilterType>('hoje');
  // 2. Filtro Rápido por Terminal
  const [terminalFilter, setTerminalFilter] = useState<TerminalFilterChoice>('TODOS');
  // Busca em texto
  const [searchTerm, setSearchTerm] = useState<string>('');
  // 4. Paginação (25 registros por página)
  const [currentPage, setCurrentPage] = useState<number>(1);
  const ITEMS_PER_PAGE = 25;

  // 5. Modais de confirmação
  const [showClearConfirmModal, setShowClearConfirmModal] = useState<boolean>(false);
  const [aptToDelete, setAptToDelete] = useState<Apontamento | null>(null);

  // Filtragem e ordenação (mais recentes primeiro)
  const filteredApts = useMemo(() => {
    return apontamentos
      .filter((apt) => {
        // Filtro Temporal
        if (!isAptInDateRange(apt, dateFilter)) return false;

        // Filtro por Terminal
        if (!doesAptMatchTerminal(apt, terminalFilter)) return false;

        // Filtro por Texto
        if (searchTerm.trim()) {
          const q = searchTerm.toLowerCase().trim();
          const op = (apt.op || apt.op_numero || '').toLowerCase();
          const colab = (apt.colaborador || apt.operador || '').toLowerCase();
          const setor = (apt.setorFisico || apt.setor || '').toLowerCase();
          const etapa = (apt.etapaRota || apt.etapa_rota || '').toLowerCase();
          const term = (apt.terminal || `t${apt.terminal_id}`).toLowerCase();
          const order = orders[apt.op || apt.op_numero || ''];
          const prod = (order?.descricao || '').toLowerCase();

          if (
            !op.includes(q) &&
            !colab.includes(q) &&
            !setor.includes(q) &&
            !etapa.includes(q) &&
            !term.includes(q) &&
            !prod.includes(q)
          ) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        const timeA = new Date(a.hora_inicio || a.horaInicio || 0).getTime();
        const timeB = new Date(b.hora_inicio || b.horaInicio || 0).getTime();
        return timeB - timeA;
      });
  }, [apontamentos, dateFilter, terminalFilter, searchTerm, orders]);

  // Paginação
  const totalPages = Math.max(1, Math.ceil(filteredApts.length / ITEMS_PER_PAGE));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (safePage - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, filteredApts.length);
  const currentApts = filteredApts.slice(startIndex, endIndex);

  const handlePeriodChange = (p: DateFilterType) => {
    playClick();
    setDateFilter(p);
    setCurrentPage(1);
  };

  const handleTerminalChange = (t: TerminalFilterChoice) => {
    playClick();
    setTerminalFilter(t);
    setCurrentPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Barra de Período Temporal e Ações no Topo */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono text-slate-400">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white font-bold flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-blue-400" />
            Histórico de Apontamentos
          </span>
          <span className="hidden sm:inline text-slate-600">•</span>
          {/* Botões de Seleção Rápida de Período Temporal */}
          <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
            {DATE_PERIODS.map((period) => {
              const isSelected = dateFilter === period.id;
              return (
                <button
                  key={period.id}
                  type="button"
                  onClick={() => handlePeriodChange(period.id)}
                  className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer text-[11px] ${
                    isSelected
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-900/40'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                >
                  {period.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Contador Dinâmico e Botões de Ação */}
        <div className="flex items-center gap-2.5">
          <span className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl text-slate-300 font-bold whitespace-nowrap text-xs">
            Total: <strong className="text-emerald-400">{filteredApts.length}</strong> {filteredApts.length === 1 ? 'registro filtrado' : 'registros filtrados'}
          </span>

          {onExportCsv && (
            <button
              type="button"
              onClick={() => {
                playClick();
                onExportCsv();
              }}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 rounded-xl font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap text-xs"
              title="Exportar registros filtrados para planilha CSV"
            >
              <Download className="w-3.5 h-3.5 text-blue-400" />
              <span>CSV</span>
            </button>
          )}

          {apontamentos.length > 0 && (
            <button
              type="button"
              onClick={() => {
                playClick();
                setShowClearConfirmModal(true);
              }}
              className="px-3.5 py-1.5 bg-rose-950/70 hover:bg-rose-900 text-rose-300 hover:text-white border border-rose-800/80 rounded-xl font-bold transition flex items-center gap-1.5 cursor-pointer active:scale-95 shadow-lg shadow-rose-950/50 whitespace-nowrap text-xs"
              title="Excluir registros do histórico"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              <span>Excluir Histórico</span>
            </button>
          )}
        </div>
      </div>

      {/* Barra de Pesquisa e Filtros por Terminal */}
      <div className="bg-[#0c142b] border border-blue-900/60 p-3.5 rounded-2xl shadow-inner space-y-3">
        {/* Campo de Busca em Texto */}
        <div className="flex items-center gap-2 bg-slate-950/90 border border-blue-900/60 px-3 py-2 rounded-xl">
          <Search className="w-4 h-4 text-blue-400 shrink-0" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Filtrar histórico por OP, Produto, Colaborador, Etapa ou Terminal..."
            className="w-full bg-transparent border-none text-xs font-mono text-white placeholder-slate-500 focus:outline-none"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setCurrentPage(1);
              }}
              className="text-xs text-slate-400 hover:text-white px-2 py-0.5 rounded cursor-pointer font-mono"
              title="Limpar pesquisa"
            >
              ✕
            </button>
          )}
        </div>

        {/* Filtros Rápidos por Terminal */}
        <div className="flex items-center gap-1.5 overflow-x-auto text-xs font-mono pt-0.5">
          <span className="text-slate-400 text-[11px] font-bold mr-1 flex items-center gap-1">
            <Filter className="w-3 h-3 text-blue-400" />
            Terminal:
          </span>
          {TERMINAL_FILTERS.map((tf) => {
            const isSelected = terminalFilter === tf.id;
            return (
              <button
                key={tf.id}
                type="button"
                onClick={() => handleTerminalChange(tf.id)}
                className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer text-xs ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-900/50 border border-blue-400'
                    : 'bg-slate-950/80 border border-slate-800 text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                {tf.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tabela de Histórico de Apontamentos com Colunas Reorganizadas e Unificadas */}
      <div className="border border-blue-900/60 rounded-2xl overflow-hidden bg-[#0c142b] shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono whitespace-nowrap">
            <thead className="bg-[#090F21] text-slate-400 border-b border-blue-950">
              <tr>
                <th className="p-3">OP</th>
                <th className="p-3">QTD / LOTE</th>
                <th className="p-3">PRODUTO</th>
                <th className="p-3">ETAPA / POSTO</th>
                <th className="p-3">COLABORADOR</th>
                <th className="p-3">TERMINAL</th>
                <th className="p-3">INÍCIO</th>
                <th className="p-3">FIM</th>
                <th className="p-3">DURAÇÃO</th>
                <th className="p-3 text-center">STATUS</th>
                <th className="p-3 text-right">AÇÕES</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-blue-950">
              {currentApts.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-500 font-mono">
                    {searchTerm || dateFilter !== 'todos' || terminalFilter !== 'TODOS'
                      ? 'Nenhum apontamento encontrado com os filtros aplicados.'
                      : 'Nenhum apontamento registrado no momento.'}
                  </td>
                </tr>
              ) : (
                currentApts.map((apt) => {
                  const isBatch = apt.is_lote || apt.modo === 'LOTE' || apt.unidade_numero === 0;
                  const unidadeDisplay = apt.unidade || (isBatch ? `Lote (${apt.quantidade_lote || 1} un)` : `Un #${apt.unidade_numero || 1}`);
                  const etapaPostoDisplay = getEtapaPostoDisplay(apt);
                  const operadorDisplay = apt.colaborador || apt.operador || '—';
                  const terminalDisplay = apt.terminal || (apt.terminal_id ? `T${apt.terminal_id}` : '—');
                  const inicioDisplay = apt.horaInicio || apt.hora_inicio;
                  const fimDisplay = apt.horaFim || apt.hora_fim;
                  const duracaoVal = apt.duracao !== undefined ? apt.duracao : apt.duracao_minutos;

                  // Descrição do Produto
                  const opNum = apt.op || apt.op_numero || '';
                  const matchedOrder = orders[opNum] || Object.values(orders).find(
                    (o) => o.op_numero === opNum || o.numero === opNum || o.numeroOP === opNum
                  );
                  const productDesc = matchedOrder?.descricao || apt.observacao || 'Produto Fabril';

                  return (
                    <tr key={apt.id} className="hover:bg-slate-900/60 transition">
                      {/* OP */}
                      <td className="p-3 font-bold text-blue-300">
                        {onSelectOp ? (
                          <button
                            type="button"
                            onClick={() => onSelectOp(opNum)}
                            className="hover:underline hover:text-blue-200 transition text-left cursor-pointer"
                            title={`Selecionar OP ${opNum}`}
                          >
                            {opNum}
                          </button>
                        ) : (
                          opNum
                        )}
                      </td>

                      {/* QTD / LOTE */}
                      <td className="p-3 font-bold">
                        {isBatch ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            {unidadeDisplay}
                          </span>
                        ) : (
                          <span className="text-white font-bold">{unidadeDisplay}</span>
                        )}
                      </td>

                      {/* PRODUTO */}
                      <td className="p-3 text-slate-300 max-w-[240px] truncate" title={productDesc}>
                        {productDesc}
                      </td>

                      {/* ETAPA / POSTO UNIFICADO */}
                      <td className="p-3 font-semibold text-white max-w-[200px] truncate" title={etapaPostoDisplay}>
                        {etapaPostoDisplay}
                      </td>

                      {/* COLABORADOR */}
                      <td className="p-3 font-semibold text-slate-200">{operadorDisplay}</td>

                      {/* TERMINAL */}
                      <td className="p-3 text-slate-400 font-bold">{terminalDisplay}</td>

                      {/* INÍCIO */}
                      <td className="p-3 text-slate-300">
                        {inicioDisplay ? new Date(inicioDisplay).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>

                      {/* FIM */}
                      <td className="p-3 text-slate-300">
                        {fimDisplay ? new Date(fimDisplay).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>

                      {/* DURAÇÃO */}
                      <td className="p-3 font-bold text-slate-100">
                        {duracaoVal !== undefined && duracaoVal !== null ? `${Math.round(duracaoVal)} min` : (
                          <span className="text-emerald-400 font-bold">Em andamento</span>
                        )}
                      </td>

                      {/* STATUS */}
                      <td className="p-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            apt.status === 'FINALIZADO'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse'
                          }`}
                        >
                          {apt.status === 'FINALIZADO' ? 'FINALIZADO' : 'EM ANDAMENTO'}
                        </span>
                      </td>

                      {/* AÇÕES */}
                      <td className="p-3 text-right">
                        {onDeleteOne && (
                          <button
                            type="button"
                            onClick={() => {
                              playClick();
                              setAptToDelete(apt);
                            }}
                            className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition cursor-pointer"
                            title={`Excluir este apontamento (${operadorDisplay} - OP ${opNum})`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 4. Rodapé de Navegação e Paginação da Tabela */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 bg-[#090F21] border-t border-blue-950 text-xs font-mono text-slate-400">
          <div>
            {filteredApts.length === 0 ? (
              <span>Exibindo 0 de 0 registros</span>
            ) : (
              <span>
                Exibindo <strong className="text-white">{startIndex + 1}</strong>-
                <strong className="text-white">{endIndex}</strong> de{' '}
                <strong className="text-white">{filteredApts.length}</strong> registros
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                playClick();
                setCurrentPage((p) => Math.max(1, p - 1));
              }}
              disabled={safePage <= 1}
              className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 font-bold hover:bg-slate-800 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            >
              Anterior
            </button>

            <span className="px-2 font-mono text-slate-400">
              Página <strong className="text-white">{safePage}</strong> de{' '}
              <strong className="text-white">{totalPages}</strong>
            </span>

            <button
              type="button"
              onClick={() => {
                playClick();
                setCurrentPage((p) => Math.min(totalPages, p + 1));
              }}
              disabled={safePage >= totalPages}
              className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 font-bold hover:bg-slate-800 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            >
              Próxima
            </button>
          </div>
        </div>
      </div>

      {/* 5. MODAL DE SEGURANÇA: EXCLUIR HISTÓRICO */}
      {showClearConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#0b1122] border-2 border-rose-900/80 w-full max-w-md rounded-3xl p-6 shadow-2xl relative">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/40 flex items-center justify-center font-bold shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-black text-white font-mono">EXCLUIR HISTÓRICO</h3>
                <p className="text-xs text-rose-300 font-mono">Ação destrutiva e definitiva</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 mb-6 font-mono leading-relaxed">
              Tem certeza que deseja apagar os registros do histórico? Esta ação é irreversível.
            </p>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowClearConfirmModal(false)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 font-mono text-xs rounded-xl border border-slate-700 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  playClick();
                  await onClearAll();
                  setShowClearConfirmModal(false);
                }}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-mono font-bold text-xs rounded-xl border border-rose-400 transition cursor-pointer shadow-lg shadow-rose-950 flex items-center gap-2"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Confirmar Exclusão</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE SEGURANÇA: EXCLUIR APONTAMENTO INDIVIDUAL */}
      {aptToDelete && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#0b1122] border-2 border-rose-900/80 w-full max-w-md rounded-3xl p-6 shadow-2xl relative">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/40 flex items-center justify-center font-bold shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-white font-mono">EXCLUIR APONTAMENTO</h3>
                <p className="text-xs text-slate-400 font-mono">
                  OP {aptToDelete.op || aptToDelete.op_numero} · {aptToDelete.colaborador || aptToDelete.operador}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-300 mb-6 font-mono leading-relaxed">
              Deseja realmente excluir este registro individual de apontamento? Esta ação é irreversível.
            </p>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setAptToDelete(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 font-mono text-xs rounded-xl border border-slate-700 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  playClick();
                  if (onDeleteOne) {
                    await onDeleteOne(aptToDelete);
                  }
                  setAptToDelete(null);
                }}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-mono font-bold text-xs rounded-xl border border-rose-400 transition cursor-pointer shadow-lg shadow-rose-950 flex items-center gap-2"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Confirmar Exclusão</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
