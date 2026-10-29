import React, { useState, useEffect } from 'react';
import {
  X,
  Clock,
  Sparkles,
  ChevronRight,
  Layers,
  CheckCircle2,
  AlertCircle,
  Search,
  Filter,
  UserCheck
} from 'lucide-react';
import { Operator, Apontamento, ProductionOrder } from '../types/mes';

export type TerminalFilterType = 'TODOS' | 'T1' | 'T2' | 'T3_T4' | 'T5';

export interface TeamProductivityProps {
  operators: Operator[];
  apontamentos: Apontamento[];
  orders?: Record<string, ProductionOrder>;
  onSelectOp?: (opNumero: string) => void;
}

const TERMINAL_FILTERS: { id: TerminalFilterType; label: string }[] = [
  { id: 'TODOS', label: 'Todos' },
  { id: 'T1', label: 'T1 - Corte / Dobra / Laser' },
  { id: 'T2', label: 'T2 - Injeção' },
  { id: 'T3_T4', label: 'T3/T4 - Montagem Portas' },
  { id: 'T5', label: 'T5 - Serralharia / Solda / Estantes' }
];

const normalizeStr = (s?: string): string => {
  if (!s) return '';
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
};

export const isSameOperator = (apt: Apontamento, op: Operator): boolean => {
  const aptOp = normalizeStr(apt.operador || apt.colaborador);
  const opName = normalizeStr(op.name || op.nome);
  const opId = normalizeStr(op.id);
  const opBadge = normalizeStr(op.badge || op.codigo);
  if (!aptOp) return false;
  return aptOp === opName || aptOp === opId || aptOp === opBadge;
};

export const isOperatorInTerminalFilter = (op: Operator, filter: TerminalFilterType): boolean => {
  if (filter === 'TODOS') return true;

  const rawTerminais = Array.isArray(op.terminais) ? op.terminais.map((t) => t.toUpperCase()) : [];
  const setoresPorTerm = op.setoresPorTerminal || {};
  const sectors = (op.sectors || op.setores || []).map((s) => normalizeStr(s));
  const role = (op.role || '').toUpperCase();

  const matchesTerminal = (termId: string) => {
    if (rawTerminais.includes(termId)) return true;
    if (setoresPorTerm[termId] && setoresPorTerm[termId].length > 0) return true;
    if (role.includes(termId)) return true;
    return false;
  };

  if (filter === 'T1') {
    if (matchesTerminal('T1')) return true;
    return sectors.some((s) => ['corte', 'dobra', 'laser'].some((k) => s.includes(k)));
  }

  if (filter === 'T2') {
    if (matchesTerminal('T2')) return true;
    return sectors.some((s) => ['injecao', 'preparacao de folhas', 'folhas'].some((k) => s.includes(k)));
  }

  if (filter === 'T3_T4') {
    if (matchesTerminal('T3') || matchesTerminal('T4')) return true;
    return sectors.some((s) =>
      ['batente', 'emendada', 'office door', 'gaxeta', 'giratoria', 'vai vem', 'trilho'].some((k) =>
        s.includes(k)
      )
    );
  }

  if (filter === 'T5') {
    if (matchesTerminal('T5')) return true;
    return sectors.some((s) =>
      ['estante', 'solda', 'router', 'eletrica', 'cortina', 'abrigo', 'doca', 'correr'].some((k) =>
        s.includes(k)
      )
    );
  }

  return true;
};

export const isTodayApt = (apt: Apontamento): boolean => {
  if (apt.status === 'EM_ANDAMENTO') return true;
  const isDateToday = (dStr?: string) => {
    if (!dStr) return false;
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return false;
    const today = new Date();
    return (
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear()
    );
  };
  return (
    isDateToday(apt.hora_inicio) ||
    isDateToday(apt.horaInicio) ||
    isDateToday(apt.hora_fim) ||
    isDateToday(apt.horaFim)
  );
};

export const formatHour = (isoStr?: string): string => {
  if (!isoStr) return '--:--';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

export const calculateDurationText = (apt: Apontamento): string => {
  if (apt.duracao_minutos && apt.duracao_minutos > 0) {
    return `${Math.round(apt.duracao_minutos)} min`;
  }
  const start = new Date(apt.hora_inicio || apt.horaInicio || '').getTime();
  if (isNaN(start)) return '';

  if (apt.status === 'EM_ANDAMENTO') {
    const elapsed = Math.max(0, Math.round((Date.now() - start) / 60000));
    return `${elapsed} min`;
  }

  const end = new Date(apt.hora_fim || apt.horaFim || '').getTime();
  if (!isNaN(end) && end >= start) {
    const mins = Math.round((end - start) / 60000);
    return `${mins} min`;
  }
  return '';
};

export const TeamProductivity: React.FC<TeamProductivityProps> = ({
  operators,
  apontamentos,
  orders = {},
  onSelectOp
}) => {
  const [selectedTerminalFilter, setSelectedTerminalFilter] = useState<TerminalFilterType>('TODOS');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedOperatorForDrawer, setSelectedOperatorForDrawer] = useState<Operator | null>(null);
  const [tooltipOpenId, setTooltipOpenId] = useState<string | null>(null);

  // Escuta tecla ESC para fechar gaveta
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedOperatorForDrawer(null);
        setTooltipOpenId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Fecha tooltip ao clicar fora
  useEffect(() => {
    const handleClickOutside = () => {
      setTooltipOpenId(null);
    };
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  const filteredOperators = operators.filter((op) => {
    if (!isOperatorInTerminalFilter(op, selectedTerminalFilter)) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = normalizeStr(searchQuery);
      const matchName = normalizeStr(op.name || op.nome).includes(q);
      const matchBadge = normalizeStr(op.badge || op.codigo).includes(q);
      const matchRole = normalizeStr(op.role).includes(q);
      if (!matchName && !matchBadge && !matchRole) return false;
    }
    return true;
  });

  // Apontamentos do operador selecionado para a gaveta do dia atual
  const todayAptsForDrawer = selectedOperatorForDrawer
    ? apontamentos
        .filter((a) => isSameOperator(a, selectedOperatorForDrawer) && isTodayApt(a))
        .sort((a, b) => {
          const timeA = new Date(a.hora_inicio || a.horaInicio || 0).getTime();
          const timeB = new Date(b.hora_inicio || b.horaInicio || 0).getTime();
          return timeB - timeA;
        })
    : [];

  return (
    <div className="space-y-6">
      {/* Barra de Filtros e Busca no Topo */}
      <div className="bg-[#0c142b] border border-blue-900/60 p-4 sm:p-5 rounded-2xl shadow-xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-extrabold text-white font-mono tracking-wide uppercase flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-blue-400" />
              Gestão de Produtividade da Equipe
            </h3>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Acompanhamento ao vivo de alocações, status operacional e histórico do turno
            </p>
          </div>

          <div className="text-xs font-mono text-slate-400 bg-slate-950 px-3.5 py-1.5 rounded-xl border border-slate-800 shrink-0 flex items-center gap-2">
            <span>Exibindo:</span>
            <strong className="text-emerald-400">{filteredOperators.length}</strong>
            <span>de {operators.length} colaboradores</span>
          </div>
        </div>

        {/* Botões de Filtro Rápido por Terminal */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs font-mono">
          {TERMINAL_FILTERS.map((filter) => {
            const isSelected = selectedTerminalFilter === filter.id;
            const count = operators.filter((op) => isOperatorInTerminalFilter(op, filter.id)).length;

            return (
              <button
                key={filter.id}
                type="button"
                onClick={() => setSelectedTerminalFilter(filter.id)}
                className={`px-3.5 py-2 rounded-xl font-bold flex items-center gap-2 transition cursor-pointer shrink-0 ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-900/50 border border-blue-400'
                    : 'bg-slate-950/80 border border-slate-800 text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <span>{filter.label}</span>
                <span
                  className={`px-1.5 py-0.2 rounded text-[10px] ${
                    isSelected ? 'bg-blue-800 text-white' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Campo de Busca Rápida por Colaborador */}
        <div className="relative">
          <Search className="w-4 h-4 text-blue-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filtrar operador por nome ou crachá..."
            className="w-full pl-10 pr-10 py-2 bg-slate-950/90 border border-blue-900/60 rounded-xl font-mono text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-xs font-mono p-1"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Grade de Cartões de Colaboradores */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredOperators.map((op) => {
          const operatorApts = apontamentos.filter((a) => isSameOperator(a, op));
          const finished = operatorApts.filter((a) => a.status === 'FINALIZADO');
          const activeApt = operatorApts.find((a) => a.status === 'EM_ANDAMENTO');
          const sectors = Array.from(new Set(op.sectors || op.setores || []));

          return (
            <div
              key={op.id}
              onClick={() => setSelectedOperatorForDrawer(op)}
              className="bg-[#0c142b] border border-blue-900/60 hover:border-blue-500/60 p-5 rounded-2xl flex flex-col justify-between shadow-lg transition-all duration-200 cursor-pointer hover:shadow-blue-950/50 hover:shadow-xl min-h-[250px] group select-none"
            >
              <div>
                {/* Cabeçalho do Card */}
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-xl bg-[#1C2F8A] text-white flex items-center justify-center font-bold text-base border border-blue-400/40 shrink-0 shadow-md">
                      {op.initials}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-white text-base truncate group-hover:text-blue-300 transition">
                        {op.name || op.nome}
                      </h4>
                      <span className="text-[11px] font-mono text-slate-400 block truncate">
                        {op.badge || op.codigo} · {op.role}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-blue-400 group-hover:translate-x-0.5 transition shrink-0" />
                </div>

                {/* Status Operacional em Tempo Real */}
                <div className="mb-3">
                  {activeApt ? (
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-semibold w-full">
                      <span className="relative flex h-2.5 w-2.5 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                      </span>
                      <span className="truncate">
                        🟢 Em curso: <strong className="text-white font-mono">{activeApt.op_numero || activeApt.op}</strong> • {activeApt.setor || activeApt.etapa_rota || 'Posto Fabril'}
                      </span>
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/70 border border-slate-800 text-slate-400 text-xs font-medium w-full">
                      <span className="w-2.5 h-2.5 rounded-full bg-slate-600 shrink-0" />
                      <span>⚪ Disponível / Sem ordem ativa</span>
                    </div>
                  )}
                </div>

                {/* Métricas do Card */}
                <div className="space-y-1 text-xs font-mono text-slate-300">
                  <div className="flex justify-between items-center py-1.5 border-b border-blue-950/70">
                    <span className="text-slate-400">Unidades Finalizadas:</span>
                    <span className="font-bold text-emerald-400 text-sm">{finished.length}</span>
                  </div>
                  {/* Tempo Médio de Ciclo oculto enquanto a cronoanálise interna estiver em andamento */}
                  {/*
                  <div className="flex justify-between py-1">
                    <span className="text-slate-400">Tempo Médio de Ciclo:</span>
                    <span className="font-bold text-blue-300">— min</span>
                  </div>
                  */}
                </div>
              </div>

              {/* Rodapé: Compactação Inteligente de Setores */}
              <div className="mt-4 pt-3 border-t border-blue-950/70">
                {sectors.length === 0 ? (
                  <span className="text-[11px] font-mono text-slate-500">Sem setores definidos</span>
                ) : sectors.length <= 2 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {sectors.map((sec, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded-md bg-blue-950/80 border border-blue-900/60 text-[11px] font-mono text-slate-300 truncate max-w-[180px]"
                        title={sec}
                      >
                        {sec}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="relative group/tooltip inline-block">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setTooltipOpenId(tooltipOpenId === op.id ? null : op.id);
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-950/80 hover:bg-blue-900/50 border border-blue-800/60 text-[11px] font-semibold text-blue-300 transition cursor-help"
                    >
                      <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
                      <span>Especialista Multissetorial</span>
                      <span className="px-1.5 py-0.2 bg-blue-900/80 rounded text-[10px] font-mono text-blue-200">
                        {sectors.length} setores
                      </span>
                    </button>

                    {/* Tooltip flutuante no hover ou clique */}
                    <div
                      className={`absolute bottom-full left-0 mb-2 w-64 p-3 bg-slate-900/98 border border-blue-600/70 rounded-xl shadow-2xl z-30 text-xs backdrop-blur-md transition-all ${
                        tooltipOpenId === op.id
                          ? 'flex flex-col'
                          : 'hidden group-hover/tooltip:flex group-hover/tooltip:flex-col'
                      }`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-slate-800 text-[10px] font-bold text-blue-400 uppercase tracking-wider">
                        <span>Setores Habilitados ({sectors.length})</span>
                        <span className="text-slate-500 font-mono text-[9px]">{op.name || op.nome}</span>
                      </div>
                      <div className="flex flex-wrap gap-1 max-h-48 overflow-y-auto">
                        {sectors.map((sec, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-[11px] font-mono text-slate-200"
                          >
                            {sec}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* PAINEL LATERAL DESLIZANTE DE HISTÓRICO DO TURNO (DRAWER / SHEET) */}
      {selectedOperatorForDrawer && (
        <div className="fixed inset-0 z-50 overflow-hidden animate-in fade-in duration-200">
          {/* Backdrop com blur escuro */}
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
            onClick={() => setSelectedOperatorForDrawer(null)}
          />

          {/* Drawer Deslizante à Direita */}
          <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] md:w-[540px] bg-[#070d1e] border-l border-blue-900/70 shadow-2xl flex flex-col">
            {/* Cabeçalho do Drawer */}
            <div className="p-5 border-b border-blue-900/60 bg-[#0c142b] flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[#1C2F8A] text-white flex items-center justify-center font-bold text-sm border border-blue-400/40 shrink-0">
                  {selectedOperatorForDrawer.initials}
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-extrabold text-white font-mono truncate">
                    Histórico do Turno — {selectedOperatorForDrawer.name || selectedOperatorForDrawer.nome}
                  </h3>
                  <p className="text-xs text-slate-400 font-mono">
                    {selectedOperatorForDrawer.badge || selectedOperatorForDrawer.codigo} · {selectedOperatorForDrawer.role}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedOperatorForDrawer(null)}
                className="px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-mono font-bold flex items-center gap-1.5 transition shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" />
                <span>Fechar</span>
              </button>
            </div>

            {/* Corpo do Drawer com Linha do Tempo */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {todayAptsForDrawer.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center text-slate-400 space-y-3">
                  <Clock className="w-12 h-12 text-slate-600 stroke-[1.5]" />
                  <p className="font-mono text-sm font-semibold text-slate-300">
                    Nenhum apontamento registado para este operador hoje.
                  </p>
                  <p className="text-xs text-slate-500 max-w-xs font-mono">
                    Os apontamentos iniciados ou finalizados durante o turno de hoje serão apresentados nesta linha do tempo.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Resumo do Turno */}
                  <div className="grid grid-cols-2 gap-3 pb-2">
                    <div className="bg-[#0c142b] border border-blue-950 p-3 rounded-xl font-mono text-xs">
                      <span className="text-slate-400 block text-[11px]">Total Apontamentos Hoje:</span>
                      <strong className="text-white text-base">{todayAptsForDrawer.length}</strong>
                    </div>
                    <div className="bg-[#0c142b] border border-blue-950 p-3 rounded-xl font-mono text-xs">
                      <span className="text-slate-400 block text-[11px]">Finalizados Hoje:</span>
                      <strong className="text-emerald-400 text-base">
                        {todayAptsForDrawer.filter((a) => a.status === 'FINALIZADO').length}
                      </strong>
                    </div>
                  </div>

                  {/* Linha do Tempo */}
                  <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-blue-900/60">
                    {todayAptsForDrawer.map((apt, idx) => {
                      const isActive = apt.status === 'EM_ANDAMENTO';
                      const opNum = apt.op_numero || apt.op || '';
                      const matchedOrder = orders[opNum] || Object.values(orders).find(
                        (o) => o.op_numero === opNum || o.numero === opNum || o.numeroOP === opNum
                      );
                      const productDesc = matchedOrder?.descricao || apt.observacao || 'Produto Fabril Metalrib';
                      const durationStr = calculateDurationText(apt);
                      const sectorWorked = apt.setor || apt.etapa_rota || apt.setorFisico || 'Posto Fabril';
                      
                      // Quantidade produzida
                      const qtdProduced = apt.is_lote || apt.modo === 'LOTE' || (apt.quantidade_lote && apt.quantidade_lote > 1)
                        ? `${apt.quantidade_lote || 1} un (Lote)`
                        : apt.unidade_numero
                        ? `Unidade #${apt.unidade_numero}`
                        : '1 un';

                      return (
                        <div key={apt.id || idx} className="relative group">
                          {/* Marcador na Linha do Tempo */}
                          <div
                            className={`absolute -left-[19px] top-4 w-3.5 h-3.5 rounded-full border-2 ${
                              isActive
                                ? 'bg-emerald-400 border-emerald-300 ring-4 ring-emerald-500/20 animate-pulse'
                                : 'bg-blue-600 border-blue-400'
                            }`}
                          />

                          <div
                            onClick={() => {
                              if (onSelectOp && opNum) {
                                onSelectOp(opNum);
                              }
                            }}
                            className={`bg-[#0c142b] border ${
                              isActive ? 'border-emerald-500/40 shadow-emerald-950/20' : 'border-blue-900/60'
                            } hover:border-blue-700/80 rounded-xl p-4 shadow-md transition space-y-2.5 ${
                              onSelectOp ? 'cursor-pointer hover:bg-[#101b3a]' : ''
                            }`}
                          >
                            {/* Topo do Item: Status e Horários */}
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                {isActive ? (
                                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-bold">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                                    Em andamento
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-950 text-blue-300 border border-blue-800/40 text-[11px] font-bold">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                    Finalizado
                                  </span>
                                )}
                              </div>

                              <div className="text-xs font-mono text-slate-300 flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5 text-blue-400" />
                                <span>{formatHour(apt.hora_inicio || apt.horaInicio)}</span>
                                <span className="text-slate-500">→</span>
                                <span>{isActive ? 'Agora' : formatHour(apt.hora_fim || apt.horaFim)}</span>
                                {durationStr && (
                                  <span className="text-slate-400 text-[11px] font-sans">({durationStr})</span>
                                )}
                              </div>
                            </div>

                            {/* Informações da OP e Produto */}
                            <div>
                              <div className="font-mono font-bold text-white text-sm">
                                {opNum || 'OP sem número'}
                              </div>
                              <p className="text-xs text-slate-300 font-mono mt-0.5 line-clamp-2">
                                {productDesc}
                              </p>
                            </div>

                            {/* Rodapé: Posto / Setor e Quantidade Produzida */}
                            <div className="pt-2 border-t border-blue-950 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                              <div className="flex items-center gap-1.5 text-slate-300">
                                <Layers className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                                <span>{sectorWorked}</span>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <span className="text-slate-400">Qtd:</span>
                                <span className="font-bold text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md">
                                  {qtdProduced}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
