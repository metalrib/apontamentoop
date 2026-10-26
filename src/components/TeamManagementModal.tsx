import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Operator, TerminalConfig, TERMINALS } from '../types/mes';
import { POSTOS_POR_TERMINAL } from '../data/terminais';
import { db, ref, update, onValue, set } from '../services/firebase';
import {
  fetchOperators,
  saveOperators,
  deleteOperator,
  resetOperatorsToDefault,
  updateColaboradorFirebase,
  fetchTerminalsConfig,
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
  Download,
  Upload,
  Loader2
} from 'lucide-react';

interface TeamManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOperatorsUpdated?: () => void;
}

const ALL_TERMINAIS = ['T1', 'T2', 'T3', 'T4', 'T5'] as const;

const TERMINAL_DETAILS: Record<string, { label: string; desc: string }> = {
  T1: { label: 'Terminal 1', desc: 'Corte, Dobra e Prep. Folhas' },
  T2: { label: 'Terminal 2', desc: 'Preparação & Injeção Folhas' },
  T3: { label: 'Terminal 3', desc: 'Batentes, Portas & Trilhos' },
  T4: { label: 'Terminal 4', desc: 'Montagem Vai-Vem & Gaxeta' },
  T5: { label: 'Terminal 5', desc: 'Router, Elétrica, Solda & Acessórios' },
};

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
  const [filterTerminal, setFilterTerminal] = useState<string>('all');
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
  const [formTerminais, setFormTerminais] = useState<string[]>(['T1']);
  const [formSetoresPorTerminal, setFormSetoresPorTerminal] = useState<Record<string, string[]>>({
    T1: [],
    T2: [],
    T3: [],
    T4: [],
    T5: []
  });

  // Setores ativos consolidados (derivados estritamente dos terminais autorizados)
  const formSectors = useMemo(() => {
    const list: string[] = [];
    formTerminais.forEach((tKey) => {
      const termSectors = formSetoresPorTerminal[tKey] || [];
      termSectors.forEach((s) => {
        if (!list.includes(s)) list.push(s);
      });
    });
    return list;
  }, [formSetoresPorTerminal, formTerminais]);

  // Total de setores vinculados contando ocorrências nos terminais autorizados
  const totalLinkedCount = useMemo(() => {
    return ALL_TERMINAIS.reduce((acc, tKey) => {
      if (!formTerminais.includes(tKey)) return acc;
      return acc + (formSetoresPorTerminal[tKey]?.length || 0);
    }, 0);
  }, [formSetoresPorTerminal, formTerminais]);

  const [formEspecialista, setFormEspecialista] = useState<boolean>(false);
  const [formIsRoaming, setFormIsRoaming] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Estado de Gestão de Setores (Aba 2)
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
    ALL_TERMINAIS.forEach((tKey) => {
      const list = POSTOS_POR_TERMINAL[tKey] || [];
      list.forEach((s) => {
        if (s && s.trim()) set.add(s.trim());
      });
    });
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

      // Sincronização reativa direta no Firebase Realtime Database
      const colabRef = ref(db, 'config_colaboradores');
      const unsubFb = onValue(colabRef, (snapshot) => {
        try {
          if (snapshot.exists()) {
            const val = snapshot.val();
            const list: Operator[] = Array.isArray(val)
              ? val.filter(Boolean)
              : Object.values(val || {});
            if (list.length > 0) {
              setOperators(list);
            }
          }
        } catch (err) {
          console.error('[TeamManagementModal] Erro ao sincronizar Firebase:', err);
        }
      });

      const unsubMes = subscribeToMesUpdates(() => {
        loadData();
      });

      return () => {
        unsubFb();
        unsubMes();
      };
    }
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
    setFormTerminais(['T1']);
    setFormSetoresPorTerminal({ T1: [], T2: [], T3: [], T4: [], T5: [] });
    setFormEspecialista(false);
    setFormIsRoaming(false);
    setFormError(null);
    setIsSaving(false);
  };

  const handleEditClick = (op: Operator) => {
    playClick();
    setEditingId(op.id);
    setFormName(op.nome || op.name);
    setFormBadge(op.badge || op.codigo || '');
    setFormRole(op.role || '');

    // Terminais autorizados
    const opTerminais = Array.isArray(op.terminais) && op.terminais.length > 0
      ? op.terminais.map((t) => String(t).toUpperCase().trim())
      : ['T1'];
    setFormTerminais(opTerminais);

    // Setores vinculados por terminal isolado
    const newSetoresPorTerminal: Record<string, string[]> = {
      T1: [],
      T2: [],
      T3: [],
      T4: [],
      T5: []
    };

    if (op.setoresPorTerminal && typeof op.setoresPorTerminal === 'object') {
      ALL_TERMINAIS.forEach((tKey) => {
        if (opTerminais.includes(tKey)) {
          const list = op.setoresPorTerminal?.[tKey];
          newSetoresPorTerminal[tKey] = Array.isArray(list) ? [...list] : [];
        } else {
          newSetoresPorTerminal[tKey] = [];
        }
      });
    } else {
      // Migração/compatibilidade de dados legados
      const rawSectors = Array.isArray(op.setores) && op.setores.length > 0
        ? op.setores
        : Array.isArray(op.sectors) && op.sectors.length > 0
        ? op.sectors
        : op.setor ? [op.setor] : [];
      const cleanSectors = Array.from(new Set(rawSectors.map((s) => s.trim()).filter(Boolean)));

      ALL_TERMINAIS.forEach((tKey) => {
        if (!opTerminais.includes(tKey)) {
          newSetoresPorTerminal[tKey] = [];
        } else if (cleanSectors.includes('TODOS')) {
          newSetoresPorTerminal[tKey] = [...(POSTOS_POR_TERMINAL[tKey] || [])];
        } else {
          const terminalOfficialSectors = POSTOS_POR_TERMINAL[tKey] || [];
          newSetoresPorTerminal[tKey] = cleanSectors.filter((s) =>
            terminalOfficialSectors.some((ts) => ts.toLowerCase() === s.toLowerCase())
          );
        }
      });
    }

    setFormSetoresPorTerminal(newSetoresPorTerminal);

    // Especialista / Curinga
    setFormEspecialista(Boolean(op.especialista ?? op.especialistaVolante ?? op.isRoaming));
    setFormIsRoaming(Boolean(op.isRoaming));
    setFormError(null);

    // Rola o container interno do modal para o topo suavemente
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
    setTimeout(() => {
      nameInputRef.current?.focus();
    }, 150);
  };

  // Alterna terminal autorizado
  const handleToggleTerminal = (termKey: string) => {
    playClick();
    setFormTerminais((prev) => {
      const isCurrentlySelected = prev.includes(termKey);
      if (isCurrentlySelected) {
        // REGRA 1: Se o usuário desmarcar um terminal lá em cima,
        // desmarque automaticamente todos os setores vinculados àquele terminal.
        setFormSetoresPorTerminal((prevSetores) => ({
          ...prevSetores,
          [termKey]: []
        }));
        return prev.filter((t) => t !== termKey);
      } else {
        return [...prev, termKey];
      }
    });
  };

  // Alterna setor de atuação com chave isolada por terminal
  const handleToggleSector = (terminalKey: string, sector: string) => {
    // REGRA 1: Nenhum checkbox de um terminal desmarcado pode ser clicado
    if (!formTerminais.includes(terminalKey)) {
      return;
    }
    playClick();
    const clean = sector.trim();
    setFormSetoresPorTerminal((prev) => {
      const currentList = prev[terminalKey] || [];
      const exists = currentList.some((s) => s.trim().toLowerCase() === clean.toLowerCase());
      const nextList = exists
        ? currentList.filter((s) => s.trim().toLowerCase() !== clean.toLowerCase())
        : [...currentList, clean];
      return {
        ...prev,
        [terminalKey]: nextList
      };
    });
  };

  const handleRemoveSpecificSector = (tKey: string, sector: string) => {
    playClick();
    const clean = sector.trim().toLowerCase();
    setFormSetoresPorTerminal((prev) => ({
      ...prev,
      [tKey]: (prev[tKey] || []).filter((s) => s.trim().toLowerCase() !== clean)
    }));
  };

  // Marcar/Desmarcar todos os setores de um terminal específico
  const handleToggleAllInTerminal = (tKey: string, check: boolean) => {
    if (!formTerminais.includes(tKey)) {
      return;
    }
    playClick();
    const sectorsOfTerm = POSTOS_POR_TERMINAL[tKey] || [];
    setFormSetoresPorTerminal((prev) => ({
      ...prev,
      [tKey]: check ? [...sectorsOfTerm] : []
    }));
  };

  // Marcar todos os setores da fábrica
  const handleSelectAllFactorySectors = () => {
    playClick();
    setFormTerminais([...ALL_TERMINAIS]);
    const fullMap: Record<string, string[]> = {};
    ALL_TERMINAIS.forEach((tKey) => {
      fullMap[tKey] = [...(POSTOS_POR_TERMINAL[tKey] || [])];
    });
    setFormSetoresPorTerminal(fullMap);
  };

  // Limpar todos os setores de todos os terminais
  const handleClearAllSectors = () => {
    playClick();
    setFormSetoresPorTerminal({ T1: [], T2: [], T3: [], T4: [], T5: [] });
  };

  // Exportar Backup Completo da Configuração da Fábrica
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

  // Salvar Colaborador direto no Firebase e no Storage Local
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setFormError('Informe o nome do colaborador.');
      return;
    }

    if (formTerminais.length === 0) {
      setFormError('Selecione pelo menos um Terminal de atuação (T1 a T5).');
      return;
    }

    if (formSectors.length === 0 && !formEspecialista && !formIsRoaming) {
      setFormError('Selecione pelo menos um setor de atuação ou marque como Especialista / Curinga.');
      return;
    }

    setIsSaving(true);
    setFormError(null);

    try {
      const initials = formName
        .trim()
        .split(' ')
        .filter(Boolean)
        .map((p) => p[0])
        .join('')
        .substring(0, 2)
        .toUpperCase() || 'OP';

      const defaultRole =
        formRole.trim() ||
        (formEspecialista
          ? `Especialista (${formTerminais.join('/')})`
          : `Operador ${formTerminais.join('/')}`);

      const badge = formBadge.trim().toUpperCase() || `OP-${Math.floor(10 + Math.random() * 90)}`;

      const targetId =
        editingId ||
        formName
          .trim()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]/g, '_')
          .substring(0, 20) ||
        `op_${Date.now()}`;

      const existing = editingId ? operators.find((o) => o.id === editingId) : null;

      // Sanitiza setoresPorTerminal para garantir que terminais não autorizados fiquem vazios
      const cleanedSetoresPorTerminal: Record<string, string[]> = {
        T1: [],
        T2: [],
        T3: [],
        T4: [],
        T5: []
      };
      ALL_TERMINAIS.forEach((tKey) => {
        if (formTerminais.includes(tKey)) {
          cleanedSetoresPorTerminal[tKey] = Array.from(
            new Set((formSetoresPorTerminal[tKey] || []).map((s) => s.trim()).filter(Boolean))
          );
        }
      });

      const payload: Operator = {
        ...(existing || {}),
        id: targetId,
        name: formName.trim(),
        nome: formName.trim(),
        initials,
        badge,
        codigo: badge,
        role: defaultRole,
        setor: formSectors[0] || '',
        setores: [...formSectors],
        sectors: [...formSectors],
        setoresPorTerminal: cleanedSetoresPorTerminal,
        postos: [...formSectors],
        familias: Array.isArray(existing?.familias) ? existing.familias : ['TODAS'],
        terminais: [...formTerminais],
        especialista: formEspecialista,
        especialistaVolante: formEspecialista,
        isRoaming: formIsRoaming || formEspecialista,
        ativo: true
      };

      // 1. Grava diretamente no Firebase Realtime Database (/config_colaboradores/<id>)
      await update(ref(db, `config_colaboradores/${targetId}`), payload);

      // 2. Atualiza estado e emite broadcast para totens
      await updateColaboradorFirebase(targetId, payload);

      playSuccessStart();
      showNotification(`Colaborador "${payload.nome}" sincronizado no Firebase com sucesso!`);
      loadData();
      resetForm();
      if (onOperatorsUpdated) onOperatorsUpdated();
    } catch (err: any) {
      console.error('[TeamManagementModal] Erro ao salvar colaborador:', err);
      setFormError('Erro ao gravar no Firebase: ' + (err?.message || 'Falha de comunicação.'));
    } finally {
      setIsSaving(false);
    }
  };

  // Exclusão de Operador com Modal In-App
  const confirmDeleteAction = async () => {
    if (!operatorToDelete) return;
    playClick();
    const id = operatorToDelete.id;
    try {
      await set(ref(db, `config_colaboradores/${id}`), null);
    } catch (err) {
      console.error('[Firebase] Erro ao remover de config_colaboradores:', err);
    }
    deleteOperator(id);
    loadData();
    if (editingId === id) {
      resetForm();
    }
    showNotification(`Colaborador "${operatorToDelete.name}" removido com sucesso.`);
    setOperatorToDelete(null);
    if (onOperatorsUpdated) onOperatorsUpdated();
  };

  // Restauração de Operadores com Modal In-App
  const confirmResetAction = async () => {
    playClick();
    const defaultList = resetOperatorsToDefault();
    try {
      const fbMap: Record<string, any> = {};
      defaultList.forEach((op) => {
        fbMap[op.id] = op;
      });
      await set(ref(db, 'config_colaboradores'), fbMap);
    } catch (err) {
      console.error('[Firebase] Erro ao restaurar config_colaboradores:', err);
    }
    loadData();
    resetForm();
    setShowResetConfirmModal(false);
    showNotification('Equipe restaurada para a lista oficial com 17 setores padronizados!');
    if (onOperatorsUpdated) onOperatorsUpdated();
  };

  // Criação de Novo Setor (Aba 2)
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

  // Renomear Setor (Aba 2)
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

  // Excluir Setor (Aba 2)
  const handleConfirmDeleteSector = () => {
    if (!sectorToDelete) return;
    playClick();
    deleteSectorGlobally(sectorToDelete);
    loadData();
    showNotification(`Setor "${sectorToDelete}" removido da fábrica e dos colaboradores.`);
    setSectorToDelete(null);
    if (onOperatorsUpdated) onOperatorsUpdated();
  };

  // Restaurar Setores Padrão (Aba 2)
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
      const name = (op.nome || op.name || '').toLowerCase();
      const badge = (op.badge || op.codigo || '').toLowerCase();
      const role = (op.role || '').toLowerCase();
      const s = searchTerm.toLowerCase();

      const matchesSearch = name.includes(s) || badge.includes(s) || role.includes(s);
      if (!matchesSearch) return false;

      // Filtro por Terminal
      if (filterTerminal !== 'all') {
        const terms = Array.isArray(op.terminais) ? op.terminais : [];
        const hasTerm = terms.some((t) => String(t).toUpperCase().trim() === filterTerminal.toUpperCase());
        if (!hasTerm) return false;
      }

      // Filtro por Setor
      if (filterSector === 'all') return true;
      if (filterSector === 'especialista') return !!op.especialista;
      if (filterSector === 'roaming') return !!op.isRoaming;
      const opSectors = Array.isArray(op.setores)
        ? op.setores
        : Array.isArray(op.sectors)
        ? op.sectors
        : op.setor ? [op.setor] : [];
      return opSectors.some((sec) => sec.trim().toLowerCase() === filterSector.toLowerCase());
    });
  }, [operators, searchTerm, filterTerminal, filterSector]);

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
                <span>GESTÃO DE COLABORADORES & SETORES (PCP)</span>
              </h2>
              <p className="text-xs text-slate-400 font-mono">
                {activeTab === 'operators'
                  ? 'Configure terminais e setores oficiais com sincronização em tempo real no Firebase'
                  : 'Gerencie a lista de setores ativos distribuídos pelos 5 terminais'}
              </p>
            </div>
          </div>

          {/* Alternador de Abas e Ações */}
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

            {/* Exportar / Importar JSON */}
            <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={handleExportBackup}
                title="Exportar backup JSON da configuração da fábrica"
                className="px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold text-slate-300 hover:text-emerald-300 hover:bg-emerald-950/40 border border-transparent hover:border-emerald-800 transition flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden sm:inline">Exportar</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Importar backup JSON da configuração da fábrica"
                className="px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold text-slate-300 hover:text-cyan-300 hover:bg-cyan-950/40 border border-transparent hover:border-cyan-800 transition flex items-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-cyan-400" />
                <span className="hidden sm:inline">Importar</span>
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
                        <span className="text-amber-300">
                          EDITANDO COLABORADOR: {formName.toUpperCase() || 'COLABORADOR'}
                        </span>
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
                  {/* Linha 1: Dados Básicos */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Nome */}
                    <div>
                      <label className="text-[11px] font-mono text-slate-400 block mb-1">
                        NOME COMPLETO *
                      </label>
                      <input
                        ref={nameInputRef}
                        type="text"
                        required
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        placeholder="Ex: Eliel, Bruno Constancio..."
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs font-sans focus:outline-none focus:border-amber-400"
                      />
                    </div>

                    {/* Matrícula / Crachá */}
                    <div>
                      <label className="text-[11px] font-mono text-slate-400 block mb-1">
                        MATRÍCULA / CRACHÁ (OPCIONAL)
                      </label>
                      <input
                        type="text"
                        value={formBadge}
                        onChange={(e) => setFormBadge(e.target.value)}
                        placeholder="Ex: GIR-01 ou OP-05"
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs font-mono uppercase focus:outline-none focus:border-amber-400"
                      />
                    </div>

                    {/* Cargo / Função */}
                    <div>
                      <label className="text-[11px] font-mono text-slate-400 block mb-1">
                        CARGO / FUNÇÃO (OPCIONAL)
                      </label>
                      <input
                        type="text"
                        value={formRole}
                        onChange={(e) => setFormRole(e.target.value)}
                        placeholder="Ex: Operador T3, Montador..."
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs font-sans focus:outline-none focus:border-amber-400"
                      />
                    </div>
                  </div>

                  {/* Linha 2: Checkboxes dos Terminais Autorizados (['T1', 'T2', 'T3', 'T4', 'T5']) */}
                  <div className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-mono font-bold text-white flex items-center gap-1.5">
                        <Layers className="w-4 h-4 text-cyan-400" />
                        TERMINAIS AUTORIZADOS (Selecione onde o operador pode trabalhar):
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            playClick();
                            setFormTerminais([...ALL_TERMINAIS]);
                          }}
                          className="text-[10px] font-mono text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
                        >
                          Marcar Todos (T1 a T5)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            playClick();
                            setFormTerminais([]);
                            setFormSetoresPorTerminal({ T1: [], T2: [], T3: [], T4: [], T5: [] });
                          }}
                          className="text-[10px] font-mono text-slate-400 hover:text-white underline cursor-pointer"
                        >
                          Limpar
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      {ALL_TERMINAIS.map((tKey) => {
                        const isChecked = formTerminais.includes(tKey);
                        const details = TERMINAL_DETAILS[tKey];

                        return (
                          <button
                            type="button"
                            key={`terminal_btn_${tKey}`}
                            onClick={() => handleToggleTerminal(tKey)}
                            className={`p-2.5 rounded-xl border text-left cursor-pointer transition select-none flex items-center gap-2.5 ${
                              isChecked
                                ? 'bg-cyan-950/70 border-cyan-400 text-white font-bold ring-1 ring-cyan-400/50 shadow-sm'
                                : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                            }`}
                          >
                            <div
                              className={`w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 transition ${
                                isChecked
                                  ? 'bg-cyan-500 border-cyan-300 text-black font-bold'
                                  : 'border-slate-700 bg-slate-950'
                              }`}
                            >
                              {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                            </div>
                            <div className="min-w-0">
                              <span className="text-xs font-mono block font-black leading-tight">
                                {tKey}
                              </span>
                              <span className="text-[10px] text-slate-400 truncate block">
                                {details.label}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Linha 3: Checkbox Especialista / Curinga */}
                  <div
                    onClick={() => {
                      playClick();
                      setFormEspecialista(!formEspecialista);
                    }}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer select-none flex items-center justify-between ${
                      formEspecialista
                        ? 'bg-purple-950/40 border-purple-400 ring-2 ring-purple-500/30 shadow-md'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-5 h-5 rounded-md border flex items-center justify-center transition ${
                          formEspecialista
                            ? 'bg-purple-500 border-purple-300 text-white font-bold'
                            : 'border-slate-700 bg-slate-900'
                        }`}
                      >
                        {formEspecialista && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </div>
                      <div>
                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                          É Especialista / Curinga
                        </span>
                        <span className="text-[11px] text-slate-400 block mt-0.5">
                          Atua com polivalência ou prioridade técnica nos postos autorizados dos totens
                        </span>
                      </div>
                    </div>
                    {formEspecialista && (
                      <span className="text-[10px] font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40 px-2 py-0.5 rounded-md">
                        ★ ATIVO
                      </span>
                    )}
                  </div>

                  {/* Linha 4: Checkboxes dos Setores Oficiais Agrupados por Terminal (POSTOS_POR_TERMINAL) */}
                  <div className="space-y-3 pt-1">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1">
                      <div>
                        <label className="text-xs font-mono font-bold text-white flex items-center gap-1.5">
                          <Layers className="w-4 h-4 text-blue-400" />
                          SETORES OFICIAIS DE ATUAÇÃO (17 Setores Padronizados por Terminal):
                        </label>
                        <span className="text-[11px] text-slate-400 block font-sans">
                          Marque ou desmarque livremente os postos em que o colaborador opera:
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleSelectAllFactorySectors}
                          className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
                        >
                          Marcar Todos da Fábrica
                        </button>
                        {totalLinkedCount > 0 && (
                          <button
                            type="button"
                            onClick={handleClearAllSectors}
                            className="text-[11px] font-mono text-rose-400 hover:text-rose-300 underline cursor-pointer"
                          >
                            Limpar Todos ({totalLinkedCount})
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Cards de Terminais com seus respectivos Setores */}
                    <div className="space-y-2.5">
                      {ALL_TERMINAIS.map((tKey) => {
                        const sectorsOfTerminal = POSTOS_POR_TERMINAL[tKey] || [];
                        const terminalInfo = TERMINAL_DETAILS[tKey];
                        const isTerminalActive = formTerminais.includes(tKey);
                        const selectedInThisTerm = isTerminalActive
                          ? formSetoresPorTerminal[tKey] || []
                          : [];

                        const allCheckedInThisTerm =
                          isTerminalActive &&
                          sectorsOfTerminal.length > 0 &&
                          sectorsOfTerminal.every((sec) =>
                            selectedInThisTerm.some((s) => s.trim().toLowerCase() === sec.trim().toLowerCase())
                          );
                        const checkedCountInTerm = selectedInThisTerm.length;

                        return (
                          <div
                            key={`group_term_${tKey}`}
                            className={`rounded-xl border p-3 transition-all ${
                              isTerminalActive
                                ? 'bg-[#0a1224] border-blue-900/80 shadow-sm'
                                : 'bg-slate-950/40 border-slate-900/80 opacity-50 select-none grayscale'
                            }`}
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800/80 pb-2 mb-2 gap-2">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`px-2 py-0.5 rounded-md text-xs font-mono font-bold border ${
                                    isTerminalActive
                                      ? 'bg-blue-600/30 text-blue-300 border-blue-500/50'
                                      : 'bg-slate-900 text-slate-500 border-slate-800'
                                  }`}
                                >
                                  {tKey}
                                </span>
                                <div>
                                  <h4 className={`text-xs font-bold ${isTerminalActive ? 'text-white' : 'text-slate-400'}`}>
                                    {terminalInfo.label} · {terminalInfo.desc}
                                  </h4>
                                </div>
                              </div>

                              <div className="flex items-center gap-2.5">
                                {isTerminalActive ? (
                                  <>
                                    <span className="text-[10px] text-slate-400 font-mono">
                                      {checkedCountInTerm} de {sectorsOfTerminal.length}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleToggleAllInTerminal(tKey, !allCheckedInThisTerm)}
                                      className="text-[10px] font-mono text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
                                    >
                                      {allCheckedInThisTerm ? 'Desmarcar todos' : 'Marcar todos'}
                                    </button>
                                  </>
                                ) : (
                                  <span className="text-[10px] font-mono text-amber-400/90 flex items-center gap-1 bg-amber-950/40 border border-amber-900/50 px-2 py-0.5 rounded">
                                    <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" />
                                    Terminal não autorizado para este colaborador
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Grid de Botões dos Setores */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5">
                              {sectorsOfTerminal.map((sectorName) => {
                                const compositeKey = `${tKey}_${sectorName}`;
                                const isChecked =
                                  isTerminalActive &&
                                  selectedInThisTerm.some(
                                    (s) => s.trim().toLowerCase() === sectorName.trim().toLowerCase()
                                  );

                                return (
                                  <button
                                    type="button"
                                    key={`btn_sec_${compositeKey}`}
                                    disabled={!isTerminalActive}
                                    onClick={() => handleToggleSector(tKey, sectorName)}
                                    className={`flex items-center gap-2 p-2 rounded-lg border text-xs transition select-none text-left ${
                                      !isTerminalActive
                                        ? 'bg-slate-950/30 border-slate-900 text-slate-600 cursor-not-allowed opacity-40'
                                        : isChecked
                                        ? 'bg-blue-600/35 border-blue-400 text-white font-bold ring-1 ring-blue-400/40 shadow-sm cursor-pointer'
                                        : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200 cursor-pointer'
                                    }`}
                                  >
                                    <div
                                      className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition ${
                                        !isTerminalActive
                                          ? 'border-slate-800 bg-slate-950 text-transparent'
                                          : isChecked
                                          ? 'bg-blue-500 border-blue-400 text-white'
                                          : 'border-slate-700 bg-slate-950'
                                      }`}
                                    >
                                      {isChecked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                                    </div>
                                    <span className="truncate">{sectorName}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Resumo dos Setores Atualmente Vinculados com Remoção Rápida */}
                  {totalLinkedCount > 0 && (
                    <div className="p-3 bg-blue-950/30 border border-blue-900/60 rounded-xl">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-mono font-bold text-blue-300 uppercase">
                          Setores Vinculados ({totalLinkedCount}) - Clique no "X" para remover qualquer posto:
                        </span>
                        <button
                          type="button"
                          onClick={handleClearAllSectors}
                          className="text-[10px] font-mono text-rose-400 hover:text-rose-300 underline cursor-pointer"
                        >
                          Limpar Todos
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                        {ALL_TERMINAIS.flatMap((tKey) => {
                          if (!formTerminais.includes(tKey)) return [];
                          const termSectors = formSetoresPorTerminal[tKey] || [];
                          return termSectors.map((secName, sIdx) => (
                            <span
                              key={`chip_selected_${tKey}_${secName}_${sIdx}`}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-600/25 text-blue-100 border border-blue-400/50 rounded-lg text-xs font-mono font-bold shadow-sm"
                            >
                              <span className="px-1.5 py-0.2 bg-cyan-950/90 text-cyan-300 border border-cyan-800 rounded text-[10px] font-bold">
                                {tKey}
                              </span>
                              <span>{secName}</span>
                              <button
                                type="button"
                                onClick={() => handleRemoveSpecificSector(tKey, secName)}
                                title={`Remover ${secName} do ${tKey}`}
                                className="w-3.5 h-3.5 rounded-full bg-blue-950 hover:bg-rose-900 text-blue-300 hover:text-white flex items-center justify-center transition cursor-pointer"
                              >
                                <X className="w-2.5 h-2.5 stroke-[2.5]" />
                              </button>
                            </span>
                          ));
                        })}
                      </div>
                    </div>
                  )}

                  {formError && (
                    <div className="text-xs text-rose-400 font-mono flex items-center gap-1.5 bg-rose-950/40 p-2.5 rounded-xl border border-rose-800/60">
                      <ShieldAlert className="w-4 h-4 flex-shrink-0 text-rose-400" />
                      <span>{formError}</span>
                    </div>
                  )}

                  {/* Botões de Ação do Formulário */}
                  <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800/80">
                    {editingId && (
                      <button
                        type="button"
                        onClick={resetForm}
                        className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 font-mono text-xs rounded-xl border border-slate-700 transition cursor-pointer"
                      >
                        Cancelar Edição
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={isSaving}
                      className={`px-6 py-2.5 font-bold font-mono text-xs rounded-xl border shadow-lg flex items-center gap-2 transition cursor-pointer active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed ${
                        editingId
                          ? 'bg-amber-600 hover:bg-amber-500 text-white border-amber-400 shadow-amber-950'
                          : 'bg-[#1C2F8A] hover:bg-blue-600 text-white border-blue-400/40 shadow-blue-950'
                      }`}
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Gravando no Firebase...</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          <span>{editingId ? 'Salvar Alterações' : 'Cadastrar Colaborador'}</span>
                        </>
                      )}
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
                    placeholder="Buscar colaborador ou crachá..."
                    className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs font-mono focus:outline-none focus:border-blue-400"
                  />
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap sm:flex-nowrap">
                  {/* Filtro por Terminal */}
                  <select
                    value={filterTerminal}
                    onChange={(e) => setFilterTerminal(e.target.value)}
                    className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs font-mono focus:outline-none focus:border-blue-400 cursor-pointer"
                  >
                    <option value="all">Todos os Terminais</option>
                    {ALL_TERMINAIS.map((t) => (
                      <option key={`filter_t_${t}`} value={t}>
                        Terminal {t}
                      </option>
                    ))}
                  </select>

                  {/* Filtro por Setor */}
                  <select
                    value={filterSector}
                    onChange={(e) => setFilterSector(e.target.value)}
                    className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs font-mono focus:outline-none focus:border-blue-400 cursor-pointer max-w-[200px]"
                  >
                    <option value="all">Todos os Setores</option>
                    <option value="especialista">Apenas Especialistas</option>
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
                    title="Restaurar lista de colaboradores oficiais de fábrica"
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
                        <th className="py-3 px-4">TERMINAIS</th>
                        <th className="py-3 px-4">CRACHÁ</th>
                        <th className="py-3 px-4">FUNÇÃO</th>
                        <th className="py-3 px-4">SETORES DE ATUAÇÃO</th>
                        <th className="py-3 px-4 text-right">AÇÕES</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {filteredOperators.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-slate-500">
                            Nenhum colaborador encontrado com os filtros aplicados.
                          </td>
                        </tr>
                      ) : (
                        filteredOperators.map((op) => {
                          const isCurrentlyEditing = editingId === op.id;
                          const opTerminais = Array.isArray(op.terminais) ? op.terminais : [];
                          const opSectors = Array.isArray(op.setores)
                            ? op.setores
                            : Array.isArray(op.sectors)
                            ? op.sectors
                            : op.setor ? [op.setor] : [];

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
                                      {isCurrentlyEditing && (
                                        <span className="text-[9px] bg-amber-400 text-black font-bold px-1.5 py-0.2 rounded animate-pulse">
                                          EM EDIÇÃO
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              <td className="py-3 px-4">
                                <div className="flex flex-wrap gap-1">
                                  {opTerminais.length > 0 ? (
                                    opTerminais.map((term) => (
                                      <span
                                        key={`term_${op.id}_${term}`}
                                        className="text-[10px] bg-cyan-950/90 text-cyan-300 border border-cyan-800 px-1.5 py-0.5 rounded font-bold font-mono"
                                      >
                                        {term}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-[10px] text-slate-600 italic">-</span>
                                  )}
                                </div>
                              </td>

                              <td className="py-3 px-4 font-bold text-slate-300">
                                {op.badge || op.codigo || '-'}
                              </td>

                              <td className="py-3 px-4 text-slate-400">
                                {op.role || '-'}
                              </td>

                              <td className="py-3 px-4">
                                <div className="flex flex-wrap gap-1 max-w-md">
                                  {op.isRoaming ? (
                                    <span className="text-[10px] bg-blue-950 text-blue-300 px-2 py-0.5 rounded border border-blue-800">
                                      Todos os setores da fábrica
                                    </span>
                                  ) : (() => {
                                    const chips: React.ReactNode[] = [];
                                    if (op.setoresPorTerminal && typeof op.setoresPorTerminal === 'object') {
                                      ALL_TERMINAIS.forEach((tKey) => {
                                        const list = op.setoresPorTerminal?.[tKey] || [];
                                        list.forEach((sec, sIdx) => {
                                          chips.push(
                                            <span
                                              key={`table_op_${op.id}_${tKey}_${sec}_${sIdx}`}
                                              className="text-[10px] bg-slate-900 text-slate-300 px-2 py-0.5 rounded border border-slate-800 flex items-center gap-1"
                                            >
                                              <span className="text-cyan-400 font-mono font-bold text-[9px]">{tKey}</span>
                                              <span>{sec}</span>
                                            </span>
                                          );
                                        });
                                      });
                                    }
                                    if (chips.length > 0) {
                                      return chips;
                                    }
                                    if (opSectors.length > 0) {
                                      return Array.from(new Set(opSectors)).map((sec, sIdx) => (
                                        <span
                                          key={`op_${op.id}_sec_${sec}_${sIdx}`}
                                          className="text-[10px] bg-slate-900 text-slate-300 px-2 py-0.5 rounded border border-slate-800"
                                        >
                                          {sec}
                                        </span>
                                      ));
                                    }
                                    return (
                                      <span className="text-[10px] text-slate-600 italic">
                                        Sem setores vinculados
                                      </span>
                                    );
                                  })()}
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
                                    title="Editar terminais e setores deste colaborador"
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
                            const assignedCount = operators.filter(
                              (op) =>
                                op.isRoaming ||
                                (op.sectors && op.sectors.includes(sec)) ||
                                (op.setores && op.setores.includes(sec))
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
          <span>Sincronização em tempo real: Firebase (/config_colaboradores) & Totens</span>
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
                  {operatorToDelete.nome || operatorToDelete.name} ({operatorToDelete.badge || operatorToDelete.codigo})
                </strong>{' '}
                da escala da fábrica e do Firebase?
                <br />
                <span className="text-slate-400 mt-1 block">
                  Ele deixará de aparecer como opção nos totens de apontamento imediatamente.
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
                Esta ação redefinirá a equipe para a lista oficial com os 17 setores padronizados nos terminais e sincronizará tudo com o Firebase.
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
