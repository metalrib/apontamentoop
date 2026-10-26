import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Operator, TerminalConfig } from '../types/mes';
import { fetchOperators, subscribeToMesUpdates } from '../services/mesStorage';
import { Check, User } from 'lucide-react';
import { playClick } from '../utils/audio';

interface OperatorSelectorProps {
  selectedOperator: string | null;
  selectedSector: string | null;
  currentTerminal?: TerminalConfig | null;
  onSelectOperator: (operatorName: string) => void;
}

/**
 * Normaliza strings para comparação insensível a acentos e maiúsculas
 */
function normalizarTexto(txt?: string | null): string {
  if (!txt) return '';
  return txt
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Retorna o ID do terminal (1 a 5) associado a um setor
 */
function getTerminalIdForSector(sectorName: string): number | null {
  const norm = normalizarTexto(sectorName);
  if (!norm) return null;
  if (norm.includes('batente') || norm.includes('office') || norm.includes('emendad')) return 3;
  if (norm.includes('corte') || norm.includes('guilhotina') || norm.includes('dobra') || norm.includes('laser')) return 1;
  if ((norm.includes('preparacao') && !norm.includes('vai vem')) || norm.includes('injetora') || norm.includes('injecao')) return 2;
  if (norm.includes('gaxeta') || norm.includes('girat') || (norm.includes('finalizacao') && norm.includes('vai vem'))) return 4;
  if (norm.includes('solda') || (norm.includes('preparacao') && norm.includes('vai vem')) || norm.includes('router') || norm.includes('eletrica') || norm.includes('cortina')) return 5;
  return null;
}

/**
 * Identifica rigorosamente a qual terminal físico o colaborador pertence
 */
function getOperatorTerminals(op: Operator): number[] {
  // 1. Terminais explicitamente configurados no colaborador (prioridade máxima)
  if (Array.isArray(op.terminais) && op.terminais.length > 0) {
    const list = op.terminais
      .map((t) => parseInt(t.replace(/[^\d]/g, ''), 10))
      .filter((n) => !isNaN(n) && n >= 1 && n <= 5);
    if (list.length > 0) {
      return list;
    }
  }

  // 2. Especialistas volantes sem terminal fixo têm acesso a todos os terminais
  if (op.isRoaming || op.especialistaVolante) {
    return [1, 2, 3, 4, 5];
  }

  // 3. Coleta os setores explicitamente cadastrados para o operador
  const operatorSectors = Array.isArray(op.sectors) && op.sectors.length > 0
    ? op.sectors
    : Array.isArray(op.setores) && op.setores.length > 0
    ? op.setores
    : op.setor ? [op.setor] : [];

  const terminals = new Set<number>();

  // Se o colaborador possui setores configurados, seus terminais são derivados DIRETAMENTE deles
  if (operatorSectors.length > 0) {
    for (const sec of operatorSectors) {
      const termId = getTerminalIdForSector(sec);
      if (termId) {
        terminals.add(termId);
      }
    }
    if (terminals.size > 0) {
      return Array.from(terminals);
    }
  }

  return [];
}

/**
 * Validação estrita entre o colaborador e a operação específica selecionada
 */
function matchOperatorToSector(op: Operator, selectedSector: string, targetTerminalId: number): boolean {
  // 1. Especialistas (especialista: true, isRoaming, especialistaVolante) têm acesso a todos os setores de seus terminais autorizados
  if (op.especialista || op.isRoaming || op.especialistaVolante) {
    return true;
  }

  // 2. Se o colaborador possui vínculo explícito com o terminal em questão:
  if (Array.isArray(op.terminais) && op.terminais.length > 0) {
    const isAuthorized = op.terminais.some(
      (t) => t.toUpperCase() === `T${targetTerminalId}` || parseInt(t.replace(/[^\d]/g, ''), 10) === targetTerminalId
    );
    if (isAuthorized) {
      // Se não houver setores explicitamente restritos, ele está habilitado para o terminal
      const opSectors = Array.isArray(op.sectors) ? op.sectors : [];
      if (opSectors.length === 0) {
        return true;
      }
    }
  }

  const secNorm = normalizarTexto(selectedSector);
  const operatorSectors = Array.isArray(op.sectors) && op.sectors.length > 0
    ? op.sectors
    : Array.isArray(op.setores) && op.setores.length > 0
    ? op.setores
    : op.setor ? [op.setor] : [];

  // Se o colaborador possui setores configurados, valida estritamente contra a lista dele
  if (operatorSectors.length > 0) {
    return operatorSectors.some((s) => {
      const sNorm = normalizarTexto(s);
      if (!sNorm) return false;
      if (sNorm === secNorm || sNorm.includes(secNorm) || secNorm.includes(sNorm)) return true;

      // Equivalências fabris comuns
      if (secNorm.includes('dobra') && sNorm.includes('dobra')) return true;
      if (secNorm.includes('corte') && (sNorm.includes('corte') || sNorm.includes('guilhotina'))) return true;
      if (secNorm.includes('laser') && sNorm.includes('laser')) return true;
      if (
        (secNorm.includes('prep') && !secNorm.includes('vai vem') && !secNorm.includes('batente')) &&
        (sNorm.includes('prep') && !sNorm.includes('vai vem') && !sNorm.includes('batente'))
      ) return true;
      if (
        (secNorm.includes('inj') || secNorm.includes('injetora')) &&
        (sNorm.includes('inj') || sNorm.includes('injetora')) &&
        !secNorm.includes('batente') && !sNorm.includes('batente')
      ) return true;
      if (secNorm.includes('batente') && sNorm.includes('batente')) return true;
      if (secNorm.includes('emendad') && sNorm.includes('emendad')) return true;
      if (secNorm.includes('office') && sNorm.includes('office')) return true;
      if (secNorm.includes('gaxeta') && (sNorm.includes('gaxeta') || sNorm.includes('girat'))) return true;
      if (secNorm.includes('girat') && sNorm.includes('girat')) return true;
      if (secNorm.includes('solda') && sNorm.includes('solda')) return true;
      if (secNorm.includes('router') && sNorm.includes('router')) return true;
      if (secNorm.includes('eletrica') && sNorm.includes('eletrica')) return true;
      if (secNorm.includes('cortina') && sNorm.includes('cortina')) return true;
      if (
        (secNorm.includes('vai vem') && secNorm.includes('prep')) &&
        (sNorm.includes('vai vem') && sNorm.includes('prep'))
      ) return true;
      if (
        (secNorm.includes('vai vem') && !secNorm.includes('prep')) &&
        (sNorm.includes('vai vem') && !sNorm.includes('prep'))
      ) return true;

      return false;
    });
  }

  // 3. Se o colaborador pertence ao terminal e não tem restrições adicionais, está liberado
  const colabTerminals = getOperatorTerminals(op);
  return colabTerminals.includes(targetTerminalId);
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
    const unsub = subscribeToMesUpdates(() => {
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
      unsub();
      window.removeEventListener('storage', handleLocalUpdate);
      window.removeEventListener('metalrib_data_updated', handleLocalUpdate);
      window.removeEventListener('metalrib_operators_updated', handleLocalUpdate);
      window.removeEventListener('focus', handleLocalUpdate);
      document.removeEventListener('visibilitychange', handleLocalUpdate);
    };
  }, [loadOps]);

  // Filtro Rigoroso por Setor e Terminal (NUNCA faz fallback global para a fábrica)
  const filteredOperators = useMemo(() => {
    // 1. OCULTAÇÃO TOTAL DO PASSO 2 SEM SETOR SELECIONADO:
    // Se selectedSector for nulo, indefinido ou vazio:
    // A lista filtrada DEVE ser estritamente um array vazio [].
    if (!selectedSector || selectedSector.trim() === '') {
      return [];
    }

    const targetTerminalId = currentTerminal?.id || getTerminalIdForSector(selectedSector);
    if (!targetTerminalId) {
      return [];
    }

    return operators.filter((colab: Operator) => {
      // 1. Status ativo
      if (colab.ativo === false) return false;

      // 2. Trava estrita de terminais (Isolamento entre áreas):
      // Colaboradores de um terminal NUNCA podem aparecer na listagem de outro terminal
      const colabTerminals = getOperatorTerminals(colab);
      if (colabTerminals.length > 0 && !colabTerminals.includes(targetTerminalId)) {
        return false;
      }

      // 3. Filtragem estrita pelo setor selecionado
      return matchOperatorToSector(colab, selectedSector, targetTerminalId);
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

      {/* RENDERIZAÇÃO CONDICIONAL ESTRITA */}
      {!selectedSector ? (
        <div className="py-3 px-4 text-center bg-slate-950/60 rounded-lg border border-slate-800 flex items-center justify-center gap-2">
          <span className="text-base select-none">👆</span>
          <p className="text-xs font-mono text-amber-300 font-bold">
            Selecione o setor acima para identificar quem vai executar a operação.
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
