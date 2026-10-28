import React, { useState } from 'react';
import { ProductionOrder, Apontamento, TERMINALS, ROUTE_RULES } from '../types/mes';
import { getRouteForOp, getRouteEvaluation, obterEtapasDaRota } from '../utils/routeEngine';
import { resetFactoryData, addProductionOrder, getSavedFirebaseConfig, saveFirebaseConfig, FirebaseConnectionConfig } from '../services/mesStorage';
import { X, Factory, RefreshCw, Download, Database, Plus, CheckCircle2, Clock, Monitor, ExternalLink } from 'lucide-react';
import { playClick } from '../utils/audio';

interface SupervisorDashboardProps {
  orders: Record<string, ProductionOrder>;
  apontamentos: Apontamento[];
  onClose: () => void;
  onSelectOp: (opNumero: string) => void;
}

export const SupervisorDashboard: React.FC<SupervisorDashboardProps> = ({
  orders,
  apontamentos,
  onClose,
  onSelectOp
}) => {
  const [activeTab, setActiveTab] = useState<'ops' | 'terminals' | 'logs' | 'firebase'>('ops');
  const [showNewOpModal, setShowNewOpModal] = useState<boolean>(false);
  const [newOpNumber, setNewOpNumber] = useState<string>('');
  const [newOpDesc, setNewOpDesc] = useState<string>('FOLHA PORTA INOX 304 2200x1000');
  const [newOpQtd, setNewOpQtd] = useState<number>(5);
  const [newOpLote, setNewOpLote] = useState<string>('LT-2026-X1');

  // Firebase Config State
  const [firebaseConfig, setFirebaseConfig] = useState<FirebaseConnectionConfig>(getSavedFirebaseConfig());
  const [fbSaveMessage, setFbSaveMessage] = useState<string | null>(null);

  const orderList = Object.values(orders);
  const activeApontamentos = apontamentos.filter(a => a.status === 'EM_ANDAMENTO');

  const handleCreateOp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOpNumber.trim()) return;

    await addProductionOrder({
      op_numero: newOpNumber.trim().toUpperCase(),
      descricao: newOpDesc.trim().toUpperCase(),
      quantidade_total: Number(newOpQtd) || 1,
      lote: newOpLote.trim().toUpperCase(),
      status: 'EM_PRODUCAO',
      data_criacao: new Date().toISOString()
    });

    setShowNewOpModal(false);
    setNewOpNumber('');
  };

  const handleSaveFirebase = (e: React.FormEvent) => {
    e.preventDefault();
    saveFirebaseConfig(firebaseConfig);
    setFbSaveMessage('Configurações salvas com sucesso!');
    setTimeout(() => setFbSaveMessage(null), 3000);
  };

  const handleDownloadStandaloneHtml = () => {
    playClick();
    // Faz o download do index.html standalone pronto para produção
    const link = document.createElement('a');
    link.href = '/standalone.html';
    link.download = 'index.html';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
      <div className="bg-[#0e131f] border-2 border-slate-700 w-full max-w-6xl max-h-[92vh] rounded-3xl flex flex-col shadow-2xl overflow-hidden">
        {/* Header do Modal */}
        <div className="p-5 sm:p-6 bg-[#0a0d14] border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-black flex items-center justify-center font-bold">
              <Factory className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-white">
                PAINEL DE SUPERVISÃO MES
              </h2>
              <p className="text-xs text-slate-400 font-mono">
                Visão Geral Chão de Fábrica · 5 Terminais Totem · Firebase Realtime DB
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadStandaloneHtml}
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-md"
              title="Baixar ficheiro único index.html com React 18 Standalone + Tailwind CDN"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Baixar index.html Único</span>
            </button>

            <button
              onClick={() => {
                playClick();
                onClose();
              }}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Abas de Navegação */}
        <div className="flex items-center gap-1 px-6 pt-3 border-b border-slate-800 bg-[#0c101a] text-xs font-semibold overflow-x-auto">
          <button
            onClick={() => setActiveTab('ops')}
            className={`px-4 py-2.5 border-b-2 transition whitespace-nowrap cursor-pointer ${
              activeTab === 'ops'
                ? 'border-amber-400 text-amber-400 bg-amber-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Ordens de Produção ({orderList.length})
          </button>
          <button
            onClick={() => setActiveTab('terminals')}
            className={`px-4 py-2.5 border-b-2 transition whitespace-nowrap cursor-pointer ${
              activeTab === 'terminals'
                ? 'border-amber-400 text-amber-400 bg-amber-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Status dos 5 Terminais ({activeApontamentos.length} ativas)
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`px-4 py-2.5 border-b-2 transition whitespace-nowrap cursor-pointer ${
              activeTab === 'logs'
                ? 'border-amber-400 text-amber-400 bg-amber-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Apontamentos Registados ({apontamentos.length})
          </button>
          <button
            onClick={() => setActiveTab('firebase')}
            className={`px-4 py-2.5 border-b-2 transition whitespace-nowrap cursor-pointer ${
              activeTab === 'firebase'
                ? 'border-amber-400 text-amber-400 bg-amber-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Conexão Firebase Realtime DB
          </button>
        </div>

        {/* Conteúdo das Abas */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* TAB 1: ORDENS DE PRODUÇÃO */}
          {activeTab === 'ops' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-mono text-slate-400 uppercase">
                  Lista sincronizada do Firebase (ordens_producao)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowNewOpModal(true)}
                    className="px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs rounded-xl flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Criar Nova OP</span>
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Deseja resetar todas as OPs e apontamentos para o estado inicial de fábrica?')) {
                        resetFactoryData();
                      }
                    }}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Restaurar Fábrica</span>
                  </button>
                </div>
              </div>

              {/* Tabela de OPs */}
              <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/70">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="p-3.5">Nº OP</th>
                      <th className="p-3.5">DESCRIÇÃO</th>
                      <th className="p-3.5">ROTA IDENTIFICADA</th>
                      <th className="p-3.5 text-center">LOTE / TOTAL</th>
                      <th className="p-3.5">PROGRESSO</th>
                      <th className="p-3.5 text-right">AÇÃO</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {orderList.map((op) => {
                      const { rule } = getRouteForOp(op);
                      const steps = obterEtapasDaRota(op);
                      const evalResult = getRouteEvaluation(op, apontamentos, steps);
                      const lastStep = steps[steps.length - 1];
                      const finishedCount = evalResult[lastStep]?.finalizadas || 0;
                      const percent = Math.round((finishedCount / op.quantidade_total) * 100);

                      return (
                        <tr key={op.op_numero} className="hover:bg-slate-900/60 transition">
                          <td className="p-3.5 font-bold text-amber-400 font-mono text-sm">
                            {op.op_numero}
                          </td>
                          <td className="p-3.5 font-sans font-semibold text-slate-100 max-w-xs truncate">
                            {op.descricao}
                          </td>
                          <td className="p-3.5">
                            <div className="flex flex-col gap-1 items-start">
                              <span className="px-2 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20 text-[11px] font-bold">
                                {rule.label}
                              </span>
                              {rule.badge && (
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                  rule.isStandardLine
                                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                    : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                                }`}>
                                  {rule.badge}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3.5 text-center text-slate-300">
                            {op.lote} ({op.quantidade_total} un)
                          </td>
                          <td className="p-3.5">
                            <div className="flex items-center gap-2">
                              <div className="w-24 h-2 bg-slate-800 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-emerald-500 rounded-full"
                                  style={{ width: `${percent}%` }}
                                />
                              </div>
                              <span className="text-slate-400 text-[10px]">{percent}%</span>
                            </div>
                          </td>
                          <td className="p-3.5 text-right">
                            <button
                              onClick={() => {
                                playClick();
                                onSelectOp(op.op_numero);
                                onClose();
                              }}
                              className="px-3 py-1.5 bg-slate-800 hover:bg-amber-500 hover:text-black text-slate-200 rounded-lg font-bold text-xs transition cursor-pointer"
                            >
                              Carregar no Totem
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: TERMINAIS */}
          {activeTab === 'terminals' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {TERMINALS.map((term) => {
                  const activeInTerminal = apontamentos.filter(
                    a => a.terminal_id === term.id && a.status === 'EM_ANDAMENTO'
                  );

                  return (
                    <div
                      key={term.id}
                      className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-slate-800 text-amber-400 flex items-center justify-center font-bold text-base border border-slate-700">
                              T{term.id}
                            </div>
                            <div>
                              <h3 className="font-bold text-white text-base">{term.name}</h3>
                              <p className="text-xs text-slate-400 font-mono">{term.label}</p>
                            </div>
                          </div>

                          <span
                            className={`w-3 h-3 rounded-full ${
                              activeInTerminal.length > 0
                                ? 'bg-emerald-400 animate-pulse'
                                : 'bg-slate-600'
                            }`}
                          />
                        </div>

                        {/* Setores vinculados */}
                        <div className="space-y-1 mb-4">
                          {term.sectors.map(s => (
                            <div
                              key={s}
                              className="text-xs text-slate-300 bg-slate-950/60 px-2.5 py-1 rounded border border-slate-800/80"
                            >
                              {s}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="pt-3 border-t border-slate-800 text-xs font-mono">
                        {activeInTerminal.length > 0 ? (
                          <div className="text-emerald-400 font-bold">
                            ● {activeInTerminal.length} unidade(s) sendo trabalhada(s) agora!
                          </div>
                        ) : (
                          <div className="text-slate-500">Nenhum operador ativo no momento</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: LOGS DE APONTAMENTOS */}
          {activeTab === 'logs' && (
            <div className="space-y-4">
              <span className="text-xs font-mono text-slate-400 uppercase">
                Histórico de apontamentos sob apontamentos/&lt;op_numero&gt;/&lt;id_unico&gt;
              </span>

              {apontamentos.length === 0 ? (
                <div className="p-8 text-center text-slate-500 bg-slate-950 rounded-2xl border border-slate-800">
                  Nenhum apontamento realizado ainda. Inicie ou finalize uma unidade no Totem!
                </div>
              ) : (
                <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/70">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="p-3">OP</th>
                        <th className="p-3">UNIDADE</th>
                        <th className="p-3">SETOR / ETAPA</th>
                        <th className="p-3">OPERADOR</th>
                        <th className="p-3">INÍCIO</th>
                        <th className="p-3">FIM</th>
                        <th className="p-3">DURAÇÃO</th>
                        <th className="p-3 text-right">STATUS</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {apontamentos.map((apt) => (
                        <tr key={apt.id} className="hover:bg-slate-900/50">
                          <td className="p-3 font-bold text-amber-400">{apt.op_numero}</td>
                          <td className="p-3 text-white font-bold">Un #{apt.unidade_numero}</td>
                          <td className="p-3 text-slate-200">
                            {apt.setor} <span className="text-slate-500">({apt.etapa_rota})</span>
                          </td>
                          <td className="p-3 text-slate-300">{apt.operador}</td>
                          <td className="p-3 text-slate-400">
                            {new Date(apt.hora_inicio).toLocaleTimeString('pt-BR')}
                          </td>
                          <td className="p-3 text-slate-400">
                            {apt.hora_fim ? new Date(apt.hora_fim).toLocaleTimeString('pt-BR') : '—'}
                          </td>
                          <td className="p-3 font-bold text-slate-200">
                            {apt.duracao_minutos ? `${apt.duracao_minutos} min` : 'Em andamento'}
                          </td>
                          <td className="p-3 text-right">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                apt.status === 'FINALIZADO'
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/30 animate-pulse'
                              }`}
                            >
                              {apt.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: FIREBASE REALTIME DB CONFIG */}
          {activeTab === 'firebase' && (
            <div className="space-y-6 max-w-2xl mx-auto py-4">
              <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-2xl">
                <div className="flex items-center gap-3 mb-3">
                  <Database className="w-6 h-6 text-amber-400" />
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      Conexão com Firebase Realtime Database
                    </h3>
                    <p className="text-xs text-slate-400">
                      O sistema opera nativamente em tempo real entre abas e terminais. Você também pode apontar para sua instância Google Firebase.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleSaveFirebase} className="space-y-4 mt-4">
                  <div>
                    <label className="text-xs font-mono text-slate-400 block mb-1">
                      DATABASE URL (Ex: https://meu-projeto-default-rtdb.firebaseio.com)
                    </label>
                    <input
                      type="text"
                      value={firebaseConfig.databaseURL}
                      onChange={(e) => setFirebaseConfig({ ...firebaseConfig, databaseURL: e.target.value })}
                      placeholder="https://sua-empresa-mes-rtdb.firebaseio.com"
                      className="w-full px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono text-sm focus:border-amber-400 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-mono text-slate-400 block mb-1">
                      API KEY (Opcional)
                    </label>
                    <input
                      type="text"
                      value={firebaseConfig.apiKey || ''}
                      onChange={(e) => setFirebaseConfig({ ...firebaseConfig, apiKey: e.target.value })}
                      placeholder="AIzaSy..."
                      className="w-full px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono text-sm focus:border-amber-400 focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="fb_enabled"
                      checked={firebaseConfig.enabled}
                      onChange={(e) => setFirebaseConfig({ ...firebaseConfig, enabled: e.target.checked })}
                      className="w-4 h-4 accent-amber-500 rounded"
                    />
                    <label htmlFor="fb_enabled" className="text-xs text-slate-300 font-semibold cursor-pointer">
                      Ativar sincronização externa com Firebase Cloud
                    </label>
                  </div>

                  {fbSaveMessage && (
                    <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs rounded-xl flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{fbSaveMessage}</span>
                    </div>
                  )}

                  <div className="pt-2">
                    <button
                      type="submit"
                      className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs rounded-xl transition"
                    >
                      Salvar Parâmetros
                    </button>
                  </div>
                </form>
              </div>

              {/* Informações sobre Roteiro e Chaves */}
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 text-xs text-slate-400 space-y-2">
                <div className="font-bold text-slate-200">Estrutura de Nós do Firebase Realtime DB:</div>
                <div className="font-mono text-slate-300">
                  📁 <span className="text-amber-400">ordens_producao/</span>&lt;op_numero&gt;<br />
                  📁 <span className="text-emerald-400">apontamentos/</span>&lt;op_numero&gt;/&lt;id_unico&gt;
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal de Criação de Nova OP */}
      {showNewOpModal && (
        <div className="fixed inset-0 z-60 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-[#0f1420] border-2 border-slate-700 w-full max-w-md rounded-3xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Criar Nova OP (PCP)</h3>
              <button
                onClick={() => setShowNewOpModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateOp} className="space-y-4">
              <div>
                <label className="text-xs font-mono text-slate-400 block mb-1">
                  NÚMERO DA OP (Ex: 023838-09)
                </label>
                <input
                  type="text"
                  required
                  value={newOpNumber}
                  onChange={(e) => setNewOpNumber(e.target.value.toUpperCase())}
                  placeholder="023838-09"
                  className="w-full px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono text-sm focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-mono text-slate-400 block mb-1">
                  DESCRIÇÃO (Inclua keywords: FOLHA, BAT, ANCORA, OFFICE DOOR, PT GIR, PT VAI VEM, TRILHO, CORTINA)
                </label>
                <input
                  type="text"
                  required
                  value={newOpDesc}
                  onChange={(e) => setNewOpDesc(e.target.value.toUpperCase())}
                  className="w-full px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white font-sans text-sm focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-mono text-slate-400 block mb-1">
                    QUANTIDADE TOTAL
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    required
                    value={newOpQtd}
                    onChange={(e) => setNewOpQtd(parseInt(e.target.value, 10))}
                    className="w-full px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono text-sm focus:border-amber-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-mono text-slate-400 block mb-1">
                    LOTE
                  </label>
                  <input
                    type="text"
                    required
                    value={newOpLote}
                    onChange={(e) => setNewOpLote(e.target.value.toUpperCase())}
                    className="w-full px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono text-sm focus:border-amber-400 focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewOpModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs rounded-xl transition"
                >
                  Salvar OP
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
