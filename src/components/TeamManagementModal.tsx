import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Operator, TerminalConfig, TERMINALS } from '../types/mes';
import {
  fetchOperators,
  saveOperators,
  addOperator,
  updateOperator,
  deleteOperator,
  resetOperatorsToDefault,
  fetchTerminalsConfig,
  saveTerminalsConfig,
  fetchAllSectors,
  addSectorToTerminal,
  renameSectorGlobally,
  deleteSectorGlobally,
  resetTerminalsConfigToDefault,
  exportFactoryConfiguration,
  importFactoryConfiguration,
  subscribeToMesUpdates
} from '../services/mesStorage';
import { playClick, playSuccessStart } from '../utils/audio';
import {
  Users,
  UserPlus,
  Trash2,
  Edit2,
  Check,
  X,
  RotateCcw,
  Search,
  Sparkles,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  FolderTree,
  Plus,
  Layers,
  ArrowRight,
  Download,
  Upload
} from 'lucide-react';

interface TeamManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOperatorsUpdated?: () => void;
}

export const TeamManagementModal: React.FC<TeamManagementModalProps> = ({
  isOpen,
  onClose,
  onOperatorsUpdated
}) => {
  // Aba ativa do modal: Colaboradores ou Gestão de Setores
  const [activeTab, setActiveTab] = useState<'operators' | 'sectors'>('operators');

  // Estado dos Operadores e Terminais
  const [operators, setOperators] = useState<Operator[]>([]);
  const [terminals, setTerminals] = useState<TerminalConfig[]>([]);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filterSector, setFilterSector] = useState<string>('all');

  // Referências para rolagem, foco e importação
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const formContainerRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Estado do Formulário de Colaborador (Novo ou Edição)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState<string>('');
  const [formBadge, setFormBadge] = useState<string>('');
  const [formRole, setFormRole] = useState<string>('');
  const [formSectors, setFormSectors] = useState<string[]>([]);
  const [formIsRoaming, setFormIsRoaming] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Estado de Gestão de Setores
  const [newSectorName, setNewSectorName] = useState<string>('');
  const [newSectorTerminalId, setNewSectorTerminalId] = useState<number>(1);
  const [sectorError, setSectorError] = useState<string | null>(null);
  const [renamingSector, setRenamingSector] = useState<{ oldName: string; newName: string } | null>(null);
  const [sectorToDelete, setSectorToDelete] = useState<string | null>(null);
  const [showResetSectorsModal, setShowResetSectorsModal] = useState<boolean>(false);

  // Modais de Confirmação In-App (100% livres de window.confirm)
  const [operatorToDelete, setOperatorToDelete] = useState<Operator | null>(null);
  const [showResetConfirmModal, setShowResetConfirmModal] = useState<boolean>(false);

  // Lista dinâmica consolidada de setores de todos os terminais
  const allFactorySectors = useMemo(() => {
    const set = new Set<string>();
    terminals.forEach((t) => {
      if (Array.isArray(t.sectors)) {
        t.sectors.forEach((s) => {
          if (s && s.trim()) set.add(s.trim());
        });
      }
    });
    return Array.from(set);
  }, [terminals]);

  // Carrega operadores e terminais salvos
  const loadData = () => {
    const listOps = fetchOperators();
    setOperators(listOps);
    const listTerms = fetchTerminalsConfig();
    setTerminals(listTerms);
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
      resetForm();
    }
    const unsub = subscribeToMesUpdates(() => {
      loadData();
    });
    return () => unsub();
  }, [isOpen]);

  const showNotification = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => setSuccessToast(null), 3500);
  };

  const resetForm = () => {
    setEditingId(null);
    setFormName('');
    setFormBadge('');
    setFormRole('');
    setFormSectors([]);
    setFormIsRoaming(false);
    setFormError(null);
  };

  // Mapeia setores do colaborador para os setores ativos da fábrica preservando a grafia exata
  function matchSectorToFactory(sec: string): string {
    const clean = sec.trim();
    if (!clean) return '';
    const exact = allFactorySectors.find((s) => s.trim().toLowerCase() === clean.toLowerCase());
    return exact || clean;
  }

  const handleEditClick = (op: Operator) => {
    playClick();
    setEditingId(op.id);
    setFormName(op.name);
    setFormBadge(op.badge || '');
    setFormRole(op.role || '');

    // Converte os setores do operador preservando os setores reais configurados sem duplicidade
    const matchedSectors = Array.from(new Set(op.sectors.map(matchSectorToFactory).filter(Boolean)));
    setFormSectors(matchedSectors);
    setFormIsRoaming(!!op.isRoaming);
    setFormError(null);

    // Rola o container interno do modal para o topo suavemente
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
    setTimeout(() => {
      nameInputRef.current?.focus();
    }, 150);
  };

  const handleToggleSector = (sector: string) => {
    playClick();
    const clean = sector.trim();
    setFormSectors((prev) => {
      const exists = prev.some((s) => s.trim().toLowerCase() === clean.toLowerCase());
      if (exists) {
        return prev.filter((s) => s.trim().toLowerCase() !== clean.toLowerCase());
      } else {
        return [...prev, clean];
      }
    });
  };

  const handleRemoveFormSector = (sector: string) => {
    playClick();
    const clean = sector.trim().toLowerCase();
    setFormSectors((prev) => prev.filter((s) => s.trim().toLowerCase() !== clean));
  };

  const handleSelectAllSectors = () => {
    playClick();
    if (formSectors.length === allFactorySectors.length) {
      setFormSectors([]);
    } else {
      setFormSectors([...allFactorySectors]);
    }
  };

  // Exportar Backup Completo da Configuração da Fábrica para subir no GitHub/Vercel
  const handleExportBackup = () => {
    playClick();
    const data = exportFactoryConfiguration();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `metalrib_escala_setores_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotification('Backup da escala e setores exportado com sucesso!');
  };

  // Importar Backup da Configuração da Fábrica
  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        const res = importFactoryConfiguration(parsed);
        if (res.success) {
          playSuccessStart();
          loadData();
          showNotification(res.message);
          if (onOperatorsUpdated) onOperatorsUpdated();
        } else {
          alert(res.message);
        }
      } catch (err: any) {
        alert('Erro ao processar arquivo JSON: ' + (err?.message || 'Arquivo inválido'));
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setFormError('Informe o nome do colaborador.');
      return;
    }

    if (formSectors.length === 0 && !formIsRoaming) {
      setFormError('Selecione pelo menos um setor de atuação ou marque como Especialista Volante.');
      return;
    }

    const initials = formName
      .trim()
      .split(' ')
      .filter(Boolean)
      .map((p) => p[0])
      .join('')
      .substring(0, 2)
      .toUpperCase() || 'OP';

    const defaultRole = formRole.trim() || (formIsRoaming ? 'Especialista Volante' : formSectors[0] || 'Operador');
    const badge = formBadge.trim().toUpperCase() || `OP-${Math.floor(10 + Math.random() * 90)}`;

    if (editingId) {
      // Atualizar colaborador existente
      const existing = operators.find(o => o.id === editingId);
      const updated: Operator = {
        ...(existing || {}),
        id: editingId,
        name: formName.trim(),
        initials,
        badge,
        codigo: badge,
        role: defaultRole,
        setor: formSectors[0] || '',
        setores: [...formSectors],
        sectors: [...formSectors],
        postos: formSectors.length > 0 ? [...formSectors] : (existing?.postos || []),
        familias: Array.isArray(existing?.familias) ? existing.familias : ['TODAS'],
        isRoaming: formIsRoaming,
        especialistaVolante: formIsRoaming,
        ativo: true
      };
      updateOperator(updated);
      showNotification(`Colaborador "${updated.name}" atualizado com sucesso!`);
    } else {
      // Criar novo colaborador
      const newOp = addOperator({
        name: formName.trim(),
        badge,
        codigo: badge,
        role: defaultRole,
        setor: formSectors[0] || '',
        setores: [...formSectors],
        sectors: [...formSectors],
        postos: [...formSectors],
        familias: ['TODAS'],
        isRoaming: formIsRoaming,
        especialistaVolante: formIsRoaming,
        initials,
        ativo: true
      });
      showNotification(`Colaborador "${newOp.name}" cadastrado com sucesso!`);
    }

    playSuccessStart();
    loadData();
    resetForm();
    if (onOperatorsUpdated) onOperatorsUpdated();
  };

  // Exclusão de Operador com Modal In-App
  const confirmDeleteAction = () => {
    if (!operatorToDelete) return;
    playClick();
    deleteOperator(operatorToDelete.id);
    loadData();
    if (editingId === operatorToDelete.id) {
      resetForm();
    }
    showNotification(`Colaborador "${operatorToDelete.name}" removido com sucesso.`);
    setOperatorToDelete(null);
    if (onOperatorsUpdated) onOperatorsUpdated();
  };

  // Restauração de Operadores com Modal In-App
  const confirmResetAction = () => {
    playClick();
    resetOperatorsToDefault();
    loadData();
    resetForm();
    setShowResetConfirmModal(false);
    showNotification('Equipe restaurada para os operadores padrão de fábrica!');
    if (onOperatorsUpdated) onOperatorsUpdated();
  };

  // Criação de Novo Setor
  const handleCreateSector = (e: React.FormEvent) => {
    e.preventDefault();
    setSectorError(null);
    const clean = newSectorName.trim();
    if (!clean) {
      setSectorError('Informe o nome do setor a ser criado.');
      return;
    }

    const added = addSectorToTerminal(newSectorTerminalId, clean);
    if (!added) {
      setSectorError(`O setor "${clean}" já existe neste terminal.`);
      return;
    }

    playSuccessStart();
    setNewSectorName('');
    loadData();
    showNotification(`Setor "${clean}" adicionado ao Terminal ${newSectorTerminalId}!`);
    if (onOperatorsUpdated) onOperatorsUpdated();
  };

  // Renomear Setor
  const handleConfirmRenameSector = () => {
    if (!renamingSector) return;
    const oldName = renamingSector.oldName.trim();
    const newName = renamingSector.newName.trim();
    if (!newName) {
      alert('Informe o novo nome do setor.');
      return;
    }
    if (oldName === newName) {
      setRenamingSector(null);
      return;
    }

    playSuccessStart();
    renameSectorGlobally(oldName, newName);
    loadData();
    setRenamingSector(null);
    showNotification(`Setor "${oldName}" renomeado para "${newName}" com sucesso!`);
    if (onOperatorsUpdated) onOperatorsUpdated();
  };

  // Excluir Setor
  const handleConfirmDeleteSector = () => {
    if (!sectorToDelete) return;
    playClick();
    deleteSectorGlobally(sectorToDelete);
    loadData();
    showNotification(`Setor "${sectorToDelete}" removido da fábrica e dos colaboradores.`);
    setSectorToDelete(null);
    if (onOperatorsUpdated) onOperatorsUpdated();
  };

  // Restaurar Setores Padrão
  const handleConfirmResetSectors = () => {
    playClick();
    resetTerminalsConfigToDefault();
    loadData();
    setShowResetSectorsModal(false);
    showNotification('Configuração original dos setores e terminais restaurada!');
    if (onOperatorsUpdated) onOperatorsUpdated();
  };

  // Filtragem da lista de operadores
  const filteredOperators = useMemo(() => {
    return operators.filter((op) => {
      const matchesSearch =
        op.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        op.badge.toLowerCase().includes(searchTerm.toLowerCase()) ||
        op.role.toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchesSearch) return false;

      if (filterSector === 'all') return true;
      if (filterSector === 'roaming') return !!op.isRoaming;
      return op.sectors.includes(filterSector);
    });
  }, [operators, searchTerm, filterSector]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-[#0b1122] border-2 border-blue-900/80 w-full max-w-5xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] my-auto relative">
        {/* Cabeçalho do Modal */}
        <div className="bg-[#0e172e] border-b border-blue-900/80 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center justify-center font-bold">
              {activeTab === 'operators' ? <Users className="w-5 h-5" /> : <FolderTree className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-lg font-black text-white tracking-wide font-mono flex items-center gap-2">
                <span>CONFIGURAÇÃO DE FÁBRICA & ESCALA</span>
              </h2>
              <p className="text-xs text-slate-400 font-mono">
                {activeTab === 'operators'
                  ? 'Cadastre colaboradores e defina onde cada um trabalha nos Totens'
                  : 'Crie novos setores, renomeie ou exclua setores dos 5 terminais'}
              </p>
            </div>
          </div>

          {/* Alternador de Abas: Colaboradores vs Setores */}
          <div className="flex items-center gap-2">
            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => {
                  playClick();
                  setActiveTab('operators');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'operators'
                    ? 'bg-[#1C2F8A] text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Colaboradores ({operators.length})</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  playClick();
                  setActiveTab('sectors');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'sectors'
                    ? 'bg-amber-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <FolderTree className="w-3.5 h-3.5" />
                <span>Setores da Fábrica ({allFactorySectors.length})</span>
              </button>
            </div>

            {/* Botões de Exportar / Importar Backup da Fábrica */}
            <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={handleExportBackup}
                title="Baixar arquivo JSON com todos os colaboradores e setores para subir no GitHub/Vercel"
                className="px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold text-slate-300 hover:text-emerald-300 hover:bg-emerald-950/40 border border-transparent hover:border-emerald-800 transition flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden sm:inline">Exportar JSON</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Importar arquivo JSON de backup em qualquer ambiente (Vercel, Totem, etc.)"
                className="px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold text-slate-300 hover:text-cyan-300 hover:bg-cyan-950/40 border border-transparent hover:border-cyan-800 transition flex items-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-cyan-400" />
                <span className="hidden sm:inline">Importar JSON</span>
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImportBackup}
                accept=".json"
                className="hidden"
              />
            </div>

            <button
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-slate-900 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 border border-slate-700 flex items-center justify-center font-bold text-sm transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Notificação Toast */}
        {successToast && (
          <div className="bg-emerald-950/90 border-b border-emerald-500/50 px-6 py-2.5 text-xs font-mono font-bold text-emerald-300 flex items-center gap-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{successToast}</span>
          </div>
        )}

        <div ref={scrollContainerRef} className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* ======================================================== */}
          {/* ABA 1: COLABORADORES E ESCALA */}
          {/* ======================================================== */}
          {activeTab === 'operators' && (
            <>
              {/* Formulário de Cadastro / Edição de Colaborador */}
              <div
                ref={formContainerRef}
                className={`border-2 rounded-2xl p-5 shadow-lg transition-all ${
                  editingId
                    ? 'bg-amber-950/20 border-amber-500/70 ring-2 ring-amber-500/30'
                    : 'bg-[#070b16] border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-black text-white font-mono flex items-center gap-2">
                    {editingId ? (
                      <>
                        <Edit2 className="w-4 h-4 text-amber-400" />
                        <span className="text-amber-300">MODO DE EDIÇÃO ATIVO</span>
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4 text-blue-400" />
                        <span>CADASTRAR NOVO COLABORADOR</span>
                      </>
                    )}
                  </h3>
                  {editingId && (
                    <button
                      type="button"
                      onClick={resetForm}
                      className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs rounded-lg border border-slate-700 flex items-center gap-1 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Cancelar Edição</span>
                    </button>
                  )}
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Nome */}
                    <div className="sm:col-span-1">
                      <label className="text-[11px] font-mono text-slate-400 block mb-1">
                        NOME COMPLETO *
                      </label>
                      <input
                        ref={nameInputRef}
                        type="text"
                        required
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        placeholder="Ex: João da Silva"
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs font-sans focus:outline-none focus:border-amber-400"
                      />
                    </div>

                    {/* Matrícula / ID */}
                    <div>
                      <label className="text-[11px] font-mono text-slate-400 block mb-1">
                        MATRÍCULA / CRACHÁ (OPCIONAL)
                      </label>
                      <input
                        type="text"
                        value={formBadge}
                        onChange={(e) => setFormBadge(e.target.value)}
                        placeholder="Ex: GIR-05 ou OP-22"
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs font-mono uppercase focus:outline-none focus:border-amber-400"
                      />
                    </div>

                    {/* Cargo / Especialidade */}
                    <div>
                      <label className="text-[11px] font-mono text-slate-400 block mb-1">
                        CARGO / FUNÇÃO (OPCIONAL)
                      </label>
                      <input
                        type="text"
                        value={formRole}
                        onChange={(e) => setFormRole(e.target.value)}
                        placeholder="Ex: Montagem Porta Giratória"
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs font-sans focus:outline-none focus:border-amber-400"
                      />
                    </div>
                  </div>

                  {/* Checkbox Volante */}
                  <div className="flex items-center justify-between p-3 bg-blue-950/20 border border-blue-900/60 rounded-xl">
                    <button
                      type="button"
                      onClick={() => {
                        playClick();
                        setFormIsRoaming(!formIsRoaming);
                      }}
                      className="flex items-center gap-2.5 cursor-pointer text-left"
                    >
                      <div
                        className={`w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 transition ${
                          formIsRoaming
                            ? 'bg-amber-500 border-amber-400 text-black font-bold'
                            : 'border-slate-600 bg-slate-950'
                        }`}
                      >
                        {formIsRoaming && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                      <div>
                        <span className="text-xs font-bold text-blue-200 flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                          Especialista Volante / Cobre Vários Setores
                        </span>
                        <span className="text-[10px] text-slate-400 block">
                          Aparecerá como opção em todos os postos e setores do totem
                        </span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={handleSelectAllSectors}
                      className="text-[10px] text-slate-400 hover:text-white underline cursor-pointer"
                    >
                      {formSectors.length === allFactorySectors.length
                        ? 'Desmarcar todos'
                        : 'Marcar todos os setores'}
                    </button>
                  </div>

                  {/* Setores de Atuação */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-mono text-slate-400">
                        SETORES DE ATUAÇÃO (Clique nos botões abaixo para marcar ou desmarcar):
                      </label>
                      {formSectors.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            playClick();
                            setFormSectors([]);
                          }}
                          className="text-[10px] font-mono text-rose-400 hover:text-rose-300 underline cursor-pointer"
                        >
                          Limpar todos ({formSectors.length})
                        </button>
                      )}
                    </div>

                    {/* Chips de setores atualmente selecionados com botão X para remoção instantânea */}
                    {formSectors.length > 0 && (
                      <div className="mb-3 p-3 bg-blue-950/40 border border-blue-900/60 rounded-xl">
                        <span className="text-[10px] font-mono font-bold text-blue-300 uppercase block mb-1.5">
                          Setores Vinculados ({formSectors.length}) - Clique no "X" para remover qualquer setor indesejado:
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {formSectors.map((secName, sIdx) => (
                            <span
                              key={`chip_${secName}_${sIdx}`}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-600/30 text-blue-100 border border-blue-400/60 rounded-lg text-xs font-mono font-bold shadow-sm"
                            >
                              <span>{secName}</span>
                              <button
                                type="button"
                                onClick={() => handleRemoveFormSector(secName)}
                                title={`Remover ${secName}`}
                                className="w-4 h-4 rounded-full bg-blue-950 hover:bg-rose-900 text-blue-300 hover:text-white flex items-center justify-center transition cursor-pointer"
                              >
                                <X className="w-3 h-3 stroke-[2.5]" />
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-56 overflow-y-auto p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl">
                      {Array.from(new Set([...allFactorySectors, ...formSectors])).map((sector, idx) => {
                        const isChecked = formSectors.some(
                          (s) => s.trim().toLowerCase() === sector.trim().toLowerCase()
                        );
                        return (
                          <button
                            type="button"
                            key={`form_sec_${sector}_${idx}`}
                            onClick={() => handleToggleSector(sector)}
                            className={`flex items-center gap-2 p-2.5 rounded-xl border text-xs cursor-pointer transition select-none text-left ${
                              isChecked
                                ? 'bg-blue-600/35 border-blue-400 text-white font-bold ring-1 ring-blue-400/50 shadow-sm'
                                : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-200 hover:bg-slate-850'
                            }`}
                          >
                            <div
                              className={`w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 transition ${
                                isChecked
                                  ? 'bg-blue-500 border-blue-400 text-white'
                                  : 'border-slate-600 bg-slate-950'
                              }`}
                            >
                              {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                            </div>
                            <span className="truncate">{sector}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {formError && (
                    <div className="text-xs text-rose-400 font-mono flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                      <span>{formError}</span>
                    </div>
                  )}

                  {/* Botões do Formulário */}
                  <div className="flex items-center justify-end gap-2 pt-2">
                    {editingId && (
                      <button
                        type="button"
                        onClick={resetForm}
                        className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 font-mono text-xs rounded-xl border border-slate-700 transition cursor-pointer"
                      >
                        Cancelar
                      </button>
                    )}
                    <button
                      type="submit"
                      className={`px-5 py-2 font-bold font-mono text-xs rounded-xl border shadow-lg flex items-center gap-2 transition cursor-pointer active:scale-95 ${
                        editingId
                          ? 'bg-amber-600 hover:bg-amber-500 text-white border-amber-400 shadow-amber-950'
                          : 'bg-[#1C2F8A] hover:bg-blue-600 text-white border-blue-400/40 shadow-blue-950'
                      }`}
                    >
                      <Check className="w-4 h-4" />
                      <span>{editingId ? 'Salvar Alterações' : 'Cadastrar Colaborador'}</span>
                    </button>
                  </div>
                </form>
              </div>

              {/* Barra de Filtros e Busca na Tabela */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="relative w-full sm:w-72">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar por nome ou crachá..."
                    className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs font-mono focus:outline-none focus:border-blue-400"
                  />
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <span className="text-xs font-mono text-slate-400 whitespace-nowrap">Filtrar Setor:</span>
                  <select
                    value={filterSector}
                    onChange={(e) => setFilterSector(e.target.value)}
                    className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs font-mono focus:outline-none focus:border-blue-400 cursor-pointer max-w-[200px]"
                  >
                    <option value="all">Todos os Setores ({operators.length})</option>
                    <option value="roaming">Especialistas Volantes</option>
                    {Array.from(new Set(allFactorySectors)).map((s, idx) => (
                      <option key={`filter_sec_${s}_${idx}`} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => {
                      playClick();
                      setShowResetConfirmModal(true);
                    }}
                    className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-700 text-xs font-mono transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    title="Restaurar lista de colaboradores originais de fábrica"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                    <span className="hidden sm:inline">Restaurar Equipe</span>
                  </button>
                </div>
              </div>

              {/* Tabela de Colaboradores */}
              <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/60 shadow-xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-[#0e172e] text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-3 px-4">COLABORADOR</th>
                        <th className="py-3 px-4">CRACHÁ</th>
                        <th className="py-3 px-4">FUNÇÃO</th>
                        <th className="py-3 px-4">SETORES DE ATUAÇÃO</th>
                        <th className="py-3 px-4 text-right">AÇÕES</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {filteredOperators.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-500">
                            Nenhum colaborador encontrado com os filtros aplicados.
                          </td>
                        </tr>
                      ) : (
                        filteredOperators.map((op) => {
                          const isCurrentlyEditing = editingId === op.id;

                          return (
                            <tr
                              key={op.id}
                              className={`transition ${
                                isCurrentlyEditing
                                  ? 'bg-amber-950/30 border-l-4 border-l-amber-400 font-bold'
                                  : 'hover:bg-slate-900/50'
                              }`}
                            >
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-3">
                                  <div
                                    className={`w-8 h-8 rounded-xl border flex items-center justify-center font-bold text-xs ${
                                      isCurrentlyEditing
                                        ? 'bg-amber-500 text-black border-amber-300'
                                        : 'bg-slate-800 border-slate-700 text-slate-200'
                                    }`}
                                  >
                                    {op.initials}
                                  </div>
                                  <div>
                                    <div className="font-bold text-white text-xs flex items-center gap-1.5 flex-wrap">
                                      <span>{op.nome || op.name}</span>
                                      {op.especialista && (
                                        <span className="text-[9px] bg-purple-500/20 text-purple-300 border border-purple-500/40 px-1.5 py-0.2 rounded font-bold">
                                          ★ ESPECIALISTA
                                        </span>
                                      )}
                                      {op.isRoaming && !op.especialista && (
                                        <span className="text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.2 rounded font-bold">
                                          ★ VOLANTE
                                        </span>
                                      )}
                                      {Array.isArray(op.terminais) && op.terminais.length > 0 && (
                                        <span className="text-[9px] bg-cyan-950/80 text-cyan-300 border border-cyan-800/80 px-1.5 py-0.2 rounded font-bold font-mono">
                                          {op.terminais.join(', ')}
                                        </span>
                                      )}
                                      {isCurrentlyEditing && (
                                        <span className="text-[9px] bg-amber-400 text-black font-bold px-1.5 py-0.2 rounded animate-pulse">
                                          EM EDIÇÃO
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              <td className="py-3 px-4 font-bold text-slate-300">
                                {op.badge}
                              </td>

                              <td className="py-3 px-4 text-slate-400">
                                {op.role}
                              </td>

                              <td className="py-3 px-4">
                                <div className="flex flex-wrap gap-1 max-w-md">
                                  {op.isRoaming ? (
                                    <span className="text-[10px] bg-blue-950 text-blue-300 px-2 py-0.5 rounded border border-blue-800">
                                      Todos os setores da fábrica
                                    </span>
                                  ) : op.sectors.length > 0 ? (
                                    Array.from(new Set(op.sectors)).map((sec, sIdx) => (
                                      <span
                                        key={`op_${op.id}_sec_${sec}_${sIdx}`}
                                        className="text-[10px] bg-slate-900 text-slate-300 px-2 py-0.5 rounded border border-slate-800"
                                      >
                                        {sec}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-[10px] text-slate-600 italic">
                                      Sem setores vinculados
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td className="py-3 px-4 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {/* Botão Editar */}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleEditClick(op);
                                    }}
                                    className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold transition flex items-center gap-1 cursor-pointer active:scale-95 ${
                                      isCurrentlyEditing
                                        ? 'bg-amber-500 text-black border-amber-300'
                                        : 'bg-blue-950/80 hover:bg-blue-800 text-blue-300 hover:text-white border-blue-700/60'
                                    }`}
                                    title="Editar dados e setores deste colaborador"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                    <span>{isCurrentlyEditing ? 'Editando' : 'Editar'}</span>
                                  </button>

                                  {/* Botão Excluir */}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      playClick();
                                      setOperatorToDelete(op);
                                    }}
                                    className="px-2.5 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 hover:text-white border border-rose-800/60 transition flex items-center gap-1 cursor-pointer active:scale-95"
                                    title="Excluir este colaborador da fábrica"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>Excluir</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* ======================================================== */}
          {/* ABA 2: GESTÃO DE SETORES E TERMINAIS (CRIAR/EDITAR/EXCLUIR) */}
          {/* ======================================================== */}
          {activeTab === 'sectors' && (
            <div className="space-y-6">
              {/* Formulário: Adicionar Novo Setor */}
              <div className="bg-[#070b16] border-2 border-slate-800 rounded-2xl p-5 shadow-lg">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-black text-white font-mono flex items-center gap-2">
                    <Plus className="w-4 h-4 text-emerald-400" />
                    <span>ADICIONAR NOVO SETOR À FÁBRICA</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      playClick();
                      setShowResetSectorsModal(true);
                    }}
                    className="text-xs text-amber-400 hover:text-amber-300 underline font-mono flex items-center gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Restaurar Setores Padrão</span>
                  </button>
                </div>

                <form onSubmit={handleCreateSector} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="text-[11px] font-mono text-slate-400 block mb-1">
                        NOME DO NOVO SETOR *
                      </label>
                      <input
                        type="text"
                        required
                        value={newSectorName}
                        onChange={(e) => setNewSectorName(e.target.value)}
                        placeholder="Ex: Embalagem / Expedição, Pintura, Controle de Qualidade..."
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs font-sans focus:outline-none focus:border-emerald-400"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-mono text-slate-400 block mb-1">
                        TERMINAL DE DESTINO
                      </label>
                      <select
                        value={newSectorTerminalId}
                        onChange={(e) => setNewSectorTerminalId(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs font-mono focus:outline-none focus:border-emerald-400 cursor-pointer"
                      >
                        {terminals.map((t) => (
                          <option key={t.id} value={t.id}>
                            Terminal {t.id} - {t.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {sectorError && (
                    <div className="text-xs text-rose-400 font-mono flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                      <span>{sectorError}</span>
                    </div>
                  )}

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold font-mono text-xs rounded-xl border border-emerald-400/50 shadow-lg shadow-emerald-950 flex items-center gap-2 transition cursor-pointer active:scale-95"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Criar e Vincular Setor</span>
                    </button>
                  </div>
                </form>
              </div>

              {/* Lista dos 5 Terminais e seus respectivos Setores */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black text-slate-300 font-mono uppercase tracking-wider flex items-center gap-2">
                    <Layers className="w-4 h-4 text-blue-400" />
                    <span>SETORES DISTRIBUÍDOS POR TERMINAL FÍSICO</span>
                  </h3>
                  <span className="text-xs text-slate-500 font-mono">
                    {allFactorySectors.length} setores ativos no total
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {terminals.map((term) => (
                    <div
                      key={term.id}
                      className="bg-[#0e172e] border border-blue-900/60 rounded-2xl p-4 shadow-lg space-y-3"
                    >
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                        <div>
                          <span className="text-[10px] bg-blue-900/50 text-blue-300 border border-blue-700/50 px-2 py-0.5 rounded font-mono font-bold">
                            TERMINAL {term.id}
                          </span>
                          <h4 className="text-sm font-bold text-white mt-1">
                            {term.name} - {term.label}
                          </h4>
                        </div>
                        <span className="text-[11px] font-mono text-slate-400">
                          {term.sectors.length} {term.sectors.length === 1 ? 'setor' : 'setores'}
                        </span>
                      </div>

                      <div className="space-y-2">
                        {term.sectors.length === 0 ? (
                          <div className="text-xs text-slate-500 italic py-2">
                            Nenhum setor vinculado a este terminal.
                          </div>
                        ) : (
                          Array.from(new Set(term.sectors || [])).map((sec, secIdx) => {
                            // Conta operadores alocados neste setor
                            const assignedCount = operators.filter(
                              (op) => op.isRoaming || op.sectors.includes(sec)
                            ).length;

                            return (
                              <div
                                key={`terminal_${term.id}_sector_${sec}_${secIdx}`}
                                className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 hover:border-slate-700 transition"
                              >
                                <div className="flex-1 mr-2 min-w-0">
                                  <div className="text-xs font-bold text-white truncate">
                                    {sec}
                                  </div>
                                  <div className="text-[10px] font-mono text-slate-400">
                                    {assignedCount} colaboradores habilitados
                                  </div>
                                </div>

                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  {/* Renomear Setor */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      playClick();
                                      setRenamingSector({ oldName: sec, newName: sec });
                                    }}
                                    className="p-1.5 rounded-lg bg-blue-950 hover:bg-blue-900 text-blue-300 border border-blue-800/40 text-xs transition cursor-pointer"
                                    title={`Renomear setor "${sec}"`}
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>

                                  {/* Excluir Setor */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      playClick();
                                      setSectorToDelete(sec);
                                    }}
                                    className="p-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800/40 text-xs transition cursor-pointer"
                                    title={`Excluir setor "${sec}"`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Rodapé do Modal */}
        <div className="bg-[#0e172e] border-t border-blue-900/80 px-6 py-3 flex items-center justify-between text-xs font-mono text-slate-400">
          <span>Persistência garantida em localStorage / Firebase (metalrib_operators & metalrib_terminals_sectors)</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold transition cursor-pointer"
          >
            Fechar
          </button>
        </div>

        {/* Modal de Confirmação: Renomear Setor */}
        {renamingSector && (
          <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-[#0c142b] border-2 border-blue-500/80 w-full max-w-md rounded-3xl p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/20 text-blue-400 border border-blue-500/40 flex items-center justify-center mx-auto">
                <Edit2 className="w-6 h-6" />
              </div>

              <div className="text-center">
                <h3 className="text-base font-bold text-white">Renomear Setor da Fábrica</h3>
                <p className="text-xs text-slate-400 mt-1">
                  O novo nome será atualizado automaticamente nos terminais e na escala de todos os colaboradores vinculados.
                </p>
              </div>

              <div>
                <label className="text-[11px] font-mono text-slate-400 block mb-1">
                  NOME DO SETOR
                </label>
                <input
                  type="text"
                  autoFocus
                  value={renamingSector.newName}
                  onChange={(e) =>
                    setRenamingSector({ ...renamingSector, newName: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs font-sans focus:outline-none focus:border-blue-400"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setRenamingSector(null)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmRenameSector}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-bold transition cursor-pointer shadow-lg shadow-blue-950 border border-blue-400"
                >
                  Salvar Nome
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de Confirmação: Excluir Setor */}
        {sectorToDelete && (
          <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-[#0c142b] border-2 border-rose-500/80 w-full max-w-md rounded-3xl p-6 shadow-2xl text-center space-y-4 animate-in fade-in zoom-in-95">
              <div className="w-14 h-14 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/40 flex items-center justify-center mx-auto">
                <Trash2 className="w-7 h-7" />
              </div>

              <h3 className="text-lg font-bold text-white">Excluir Setor da Fábrica?</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Deseja realmente remover o setor{' '}
                <strong className="text-rose-400 font-bold font-mono">
                  "{sectorToDelete}"
                </strong>{' '}
                da fábrica?
                <br />
                <span className="text-slate-400 mt-1 block">
                  Ele deixará de aparecer nos terminais dos totens e será desvinculado dos colaboradores.
                </span>
              </p>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSectorToDelete(null)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeleteSector}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white text-xs font-bold transition cursor-pointer shadow-lg shadow-rose-950 border border-rose-400"
                >
                  Sim, Excluir Setor
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de Confirmação: Restaurar Setores Padrão */}
        {showResetSectorsModal && (
          <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-[#0c142b] border-2 border-amber-500/80 w-full max-w-md rounded-3xl p-6 shadow-2xl text-center space-y-4 animate-in fade-in zoom-in-95">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center justify-center mx-auto">
                <AlertTriangle className="w-7 h-7" />
              </div>

              <h3 className="text-lg font-bold text-white">Restaurar Setores de Fábrica Padrão?</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Esta ação redefinirá a distribuição dos setores para o padrão original da Metalrib nos 5 terminais.
              </p>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowResetSectorsModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmResetSectors}
                  className="flex-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 active:scale-95 text-white text-xs font-bold transition cursor-pointer shadow-lg shadow-amber-950 border border-amber-400"
                >
                  Sim, Restaurar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de Confirmação: Excluir Colaborador */}
        {operatorToDelete && (
          <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-[#0c142b] border-2 border-rose-500/80 w-full max-w-md rounded-3xl p-6 shadow-2xl text-center space-y-4 animate-in fade-in zoom-in-95">
              <div className="w-14 h-14 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/40 flex items-center justify-center mx-auto">
                <Trash2 className="w-7 h-7" />
              </div>

              <h3 className="text-lg font-bold text-white">Excluir Colaborador?</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Deseja realmente remover o colaborador{' '}
                <strong className="text-rose-400 font-bold font-mono">
                  {operatorToDelete.name} ({operatorToDelete.badge})
                </strong>{' '}
                da escala da fábrica?
                <br />
                <span className="text-slate-400 mt-1 block">
                  Ele deixará de aparecer como opção nos totens de apontamento.
                </span>
              </p>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setOperatorToDelete(null)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteAction}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white text-xs font-bold transition cursor-pointer shadow-lg shadow-rose-950 border border-rose-400"
                >
                  Sim, Excluir
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de Confirmação: Restaurar Colaboradores Padrão */}
        {showResetConfirmModal && (
          <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-[#0c142b] border-2 border-amber-500/80 w-full max-w-md rounded-3xl p-6 shadow-2xl text-center space-y-4 animate-in fade-in zoom-in-95">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center justify-center mx-auto">
                <AlertTriangle className="w-7 h-7" />
              </div>

              <h3 className="text-lg font-bold text-white">Restaurar Colaboradores Padrão?</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Esta ação redefinirá a equipe para a lista original de colaboradores da fábrica da Metalrib (Eliel, Leonardo, Nalysson, Afonso, etc.).
              </p>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowResetConfirmModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmResetAction}
                  className="flex-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 active:scale-95 text-white text-xs font-bold transition cursor-pointer shadow-lg shadow-amber-950 border border-amber-400"
                >
                  Sim, Restaurar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
