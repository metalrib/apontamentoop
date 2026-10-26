import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Operator, TerminalConfig, ProductionOrder } from '../types/mes';
import { fetchOperators, subscribeToMesUpdates } from '../services/mesStorage';
import { db, ref, onValue } from '../services/firebase';
import { Check, User } from 'lucide-react';
import { playClick } from '../utils/audio';

interface OperatorSelectorProps {
  selectedOperator: string | null;
  selectedSector: string | null;
  currentTerminal?: TerminalConfig | null;
  order?: ProductionOrder | null;
  onSelectOperator: (operatorName: string) => void;
}

export const OperatorSelector: React.FC<OperatorSelectorProps> = ({
  selectedOperator,
  selectedSector,
  currentTerminal,
  onSelectOperator
}) => {
  const [operators, setOperators] = useState<Operator[]>(() => fetchOperators());

  // Carrega e sincroniza operadores
  const loadOps = useCallback(() => {
    const list = fetchOperators();
    setOperators(list);
  }, []);

  useEffect(() => {
    loadOps();

    // Listener reativo direto no Firebase (/config_colaboradores)
    const colabRef = ref(db, 'config_colaboradores');
    const unsubFirebase = onValue(colabRef, (snapshot) => {
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
        console.error('[Totem] Erro na sincronização reativa de colaboradores:', err);
      }
    });

    const unsubStorage = subscribeToMesUpdates(() => {
      loadOps();
    });

    const handleLocalUpdate = () => {
      loadOps();
    };

    window.addEventListener('storage', handleLocalUpdate);
    window.addEventListener('metalrib_data_updated', handleLocalUpdate);
    window.addEventListener('metalrib_operators_updated', handleLocalUpdate);
    window.addEventListener('focus', handleLocalUpdate);
    document.addEventListener('visibilitychange', handleLocalUpdate);

    return () => {
      unsubFirebase();
      unsubStorage();
      window.removeEventListener('storage', handleLocalUpdate);
      window.removeEventListener('metalrib_data_updated', handleLocalUpdate);
      window.removeEventListener('metalrib_operators_updated', handleLocalUpdate);
      window.removeEventListener('focus', handleLocalUpdate);
      document.removeEventListener('visibilitychange', handleLocalUpdate);
    };
  }, [loadOps]);

  // Filtro Direto e Padronizado por Terminal e Posto Selecionado
  const filteredOperators = useMemo(() => {
    // 1. Se nenhum posto estiver selecionado no Passo 1, lista vazia
    if (!selectedSector || selectedSector.trim() === '') {
      return [];
    }

    const termId = currentTerminal?.id || 1;
    const termKey = `T${termId}`;

    return operators.filter((colab: Operator) => {
      // 1. Status ativo
      if (colab.ativo === false) return false;

      // 2. Terminal ativo (ex: 'T4' ou 4)
      const colabTerminais = Array.isArray(colab.terminais) ? colab.terminais : [];
      const hasTerminal = colabTerminais.some(
        (t) => String(t).toUpperCase().trim() === termKey || String(t).replace(/[^\d]/g, '') === String(termId)
      );
      if (!hasTerminal) return false;

      // 3. Regra oficial: Especialista OU Setor exato OU 'TODOS'
      const colabSetores = Array.isArray(colab.setores)
        ? colab.setores
        : Array.isArray(colab.sectors)
        ? colab.sectors
        : colab.setor ? [colab.setor] : [];

      const isEspecialista = Boolean(colab.especialista || colab.isRoaming || colab.especialistaVolante);
      const hasSector = isEspecialista || colabSetores.includes(selectedSector) || colabSetores.includes('TODOS');

      return hasSector;
    });
  }, [operators, selectedSector, currentTerminal?.id]);

  return (
    <div className="w-full bg-[#0e131f] border border-slate-700/80 rounded-xl p-2.5 shadow-md shrink-0">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest font-mono">
            PASSO 2: IDENTIFICAÇÃO DO COLABORADOR
          </span>
          {selectedSector && (
            <span className="text-[10px] font-mono text-slate-400">
              ({filteredOperators.length} disponíveis)
            </span>
          )}
        </div>

        <div className="text-[11px] font-mono text-slate-300 flex items-center gap-1.5 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
          <User className="w-3 h-3 text-amber-400" />
          <span className="truncate max-w-[150px] font-bold">
            {selectedOperator ? selectedOperator : 'Toque no seu nome'}
          </span>
        </div>
      </div>

      {/* RENDERIZAÇÃO CONDICIONAL */}
      {!selectedSector ? (
        <div className="py-3 px-4 text-center bg-slate-950/60 rounded-lg border border-slate-800 flex items-center justify-center gap-2">
          <span className="text-base select-none">👆</span>
          <p className="text-xs font-mono text-amber-300 font-bold">
            Selecione um posto de trabalho no Passo 1 para identificar os colaboradores disponíveis.
          </p>
        </div>
      ) : filteredOperators.length === 0 ? (
        <div className="py-3 px-4 text-center bg-slate-950/60 rounded-lg border border-slate-800">
          <p className="text-xs font-mono text-slate-300">
            Nenhum colaborador alocado para <span className="text-amber-400 font-bold">{selectedSector}</span> neste terminal.
          </p>
        </div>
      ) : (
        <div className="overflow-y-auto max-h-[180px] pr-1">
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
            {filteredOperators.map((op: Operator) => {
              const isSelected = selectedOperator === op.name;

              return (
                <button
                  key={op.id}
                  onClick={() => {
                    playClick();
                    onSelectOperator(op.name);
                  }}
                  className={`p-1.5 rounded-lg border text-center transition-all flex flex-col items-center justify-center kiosk-btn cursor-pointer ${
                    isSelected
                      ? 'bg-[#1C2F8A]/60 border-blue-400 ring-2 ring-blue-500/50 shadow-md'
                      : 'bg-slate-900 border-slate-800 hover:border-blue-500/50 hover:bg-slate-850'
                  }`}
                >
                  {/* Avatar do Operador */}
                  <div className="relative mb-1">
                    <div
                      className={`w-7 h-7 rounded-md flex items-center justify-center font-black text-xs transition ${
                        isSelected
                          ? 'bg-[#1C2F8A] text-white border border-blue-300'
                          : op.isRoaming
                          ? 'bg-blue-950 text-blue-300 border border-blue-800'
                          : 'bg-slate-800 text-slate-300 border border-slate-700'
                      }`}
                    >
                      {op.initials}
                    </div>
                    {isSelected && (
                      <div className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 text-black flex items-center justify-center font-bold">
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </div>
                    )}
                    {(op.especialista || op.isRoaming) && !isSelected && (
                      <div
                        className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-400 text-black flex items-center justify-center font-bold text-[8px]"
                        title="Especialista"
                      >
                        ★
                      </div>
                    )}
                  </div>

                  <div className="w-full">
                    <div className="font-bold text-xs text-white truncate max-w-full leading-tight">
                      {op.name.split(' ').length > 1
                        ? `${op.name.split(' ')[0]} ${op.name.split(' ')[1][0]}.`
                        : op.name}
                    </div>
                    <div className="text-[9px] font-mono text-slate-400 truncate">
                      {op.badge || op.role}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
