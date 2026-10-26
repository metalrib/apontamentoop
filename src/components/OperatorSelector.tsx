import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Operator, TerminalConfig, ProductionOrder } from '../types/mes';
import { fetchOperators, subscribeToMesUpdates } from '../services/mesStorage';
import { identificarFamiliaProduto, FamiliaProduto } from '../utils/productClassifier';
import { Check, User, Tag } from 'lucide-react';
import { playClick } from '../utils/audio';

interface OperatorSelectorProps {
  selectedOperator: string | null;
  selectedSector: string | null;
  currentTerminal?: TerminalConfig | null;
  order?: ProductionOrder | null;
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
 * Retorna o ID do terminal (1 a 5) associado a um setor/posto
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
 * Identifica rigorosamente a quais terminais físicos o colaborador tem acesso
 */
function getOperatorTerminals(op: Operator): number[] {
  // 1. Terminais explicitamente configurados no colaborador (prioridade máxima)
  if (Array.isArray(op.terminais) && op.terminais.length > 0) {
    const list = op.terminais
      .map((t) => parseInt(String(t).replace(/[^\d]/g, ''), 10))
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
  const operatorSectors = Array.isArray(op.postos) && op.postos.length > 0
    ? op.postos
    : Array.isArray(op.sectors) && op.sectors.length > 0
    ? op.sectors
    : Array.isArray(op.setores) && op.setores.length > 0
    ? op.setores
    : op.setor ? [op.setor] : [];

  const terminals = new Set<number>();
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
 * Verifica se o colaborador tem acesso ao terminal especificado
 */
function hasTerminalAccess(op: Operator, targetTerminalId: number): boolean {
  if (Array.isArray(op.terminais) && op.terminais.length > 0) {
    return op.terminais.some((t: string | number) => {
      const num = typeof t === 'number' ? t : parseInt(String(t).replace(/[^\d]/g, ''), 10);
      return num === targetTerminalId;
    });
  }
  if (op.isRoaming || op.especialistaVolante) {
    return true;
  }
  const derived = getOperatorTerminals(op);
  return derived.includes(targetTerminalId);
}

/**
 * Compara os postos habilitados do colaborador com o posto/setor selecionado
 */
function matchPosto(postos: string[] | undefined, selectedSector: string): boolean {
  if (!postos || postos.length === 0) return false;
  if (postos.includes('TODOS')) return true;

  const secNorm = normalizarTexto(selectedSector);
  if (!secNorm) return false;

  return postos.some((p) => {
    const pNorm = normalizarTexto(p);
    if (!pNorm) return false;
    if (pNorm === 'todos') return true;

    // Correspondência exata direta
    if (pNorm === secNorm) return true;

    // Regras específicas de postos da fábrica Metalrib:
    // 1. Finalização Vai Vem (Terminal 4)
    if (secNorm.includes('vai vem') && (secNorm.includes('finalizacao') || !secNorm.includes('prep'))) {
      return pNorm.includes('vai vem') && (pNorm.includes('finalizacao') || !pNorm.includes('prep'));
    }

    // 2. Preparação Vai Vem (Terminal 5)
    if (secNorm.includes('vai vem') && secNorm.includes('prep')) {
      return pNorm.includes('vai vem') && pNorm.includes('prep');
    }

    // 3. Instalação de Gaxeta (Terminal 4)
    if (secNorm.includes('gaxeta')) {
      return pNorm.includes('gaxeta');
    }

    // 4. Montagem de Portas Giratórias (Terminal 4)
    if (secNorm.includes('girat')) {
      return pNorm.includes('girat');
    }

    // 5. Montagem de Portas Emendadas (Terminal 3)
    if (secNorm.includes('emendad')) {
      return pNorm.includes('emendad');
    }

    // 6. Montagem Office Door (Terminal 3)
    if (secNorm.includes('office')) {
      return pNorm.includes('office');
    }

    // 7. Preparação de Batentes (Terminal 3)
    if (secNorm.includes('batente') && secNorm.includes('prep')) {
      return pNorm.includes('batente') && pNorm.includes('prep');
    }

    // 8. Injeção e Finalização Batentes (Terminal 3)
    if (secNorm.includes('batente') && (secNorm.includes('inj') || secNorm.includes('finalizacao'))) {
      return pNorm.includes('batente') && (pNorm.includes('inj') || pNorm.includes('finalizacao'));
    }

    // 9. Injetora de folhas (Terminal 2)
    if ((secNorm.includes('injetora') || secNorm.includes('injecao')) && !secNorm.includes('batente')) {
      return (pNorm.includes('injetora') || pNorm.includes('injecao')) && !pNorm.includes('batente');
    }

    // 10. Preparação (Terminal 2)
    if (
      secNorm.includes('prep') &&
      !secNorm.includes('vai vem') &&
      !secNorm.includes('batente') &&
      !secNorm.includes('dobra')
    ) {
      return (
        pNorm.includes('prep') &&
        !pNorm.includes('vai vem') &&
        !pNorm.includes('batente') &&
        !pNorm.includes('dobra')
      );
    }

    // 11. Corte - Guilhotina (Terminal 1)
    if (secNorm.includes('corte') || secNorm.includes('guilhotina')) {
      return pNorm.includes('corte') || pNorm.includes('guilhotina');
    }

    // 12. Dobra e Preparação (Terminal 1)
    if (secNorm.includes('dobra')) {
      return pNorm.includes('dobra');
    }

    // 13. Laser (Terminal 1)
    if (secNorm.includes('laser')) {
      return pNorm.includes('laser');
    }

    // 14. Elétrica (Terminal 5)
    if (secNorm.includes('eletrica')) {
      return pNorm.includes('eletrica');
    }

    // 15. Router (Terminal 5)
    if (secNorm.includes('router')) {
      return pNorm.includes('router');
    }

    // 16. Cortina (Terminal 5)
    if (secNorm.includes('cortina')) {
      return pNorm.includes('cortina');
    }

    // 17. Solda e Montagem (Terminal 5)
    if (secNorm.includes('solda')) {
      return pNorm.includes('solda');
    }

    // Contenção direta se não caiu nas regras exclusivas
    return pNorm.includes(secNorm) || secNorm.includes(pNorm);
  });
}

/**
 * Validação estrita entre o colaborador, terminal ativo, posto de trabalho e a família de produto da OP
 */
function matchOperatorToSector(
  op: Operator,
  selectedSector: string,
  targetTerminalId: number,
  order?: ProductionOrder | null
): boolean {
  // 1. Trava estrita de terminal: colaborador deve estar autorizado no terminal ativo
  if (!hasTerminalAccess(op, targetTerminalId)) {
    return false;
  }

  // 2. Especialistas com acesso ao terminal têm acesso irrestrito a todos os postos e famílias de seu terminal
  if (op.especialista || op.isRoaming || op.especialistaVolante) {
    return true;
  }

  // 3. Validação por Família de Produto da OP aberta (se houver OP informada):
  if (order) {
    const familiaOP: FamiliaProduto = identificarFamiliaProduto(order);
    if (familiaOP && familiaOP !== 'OUTROS' && familiaOP !== 'GERAL') {
      const colabFamilias = Array.isArray(op.familias) && op.familias.length > 0
        ? op.familias
        : ['TODAS'];

      const matchesFamily =
        colabFamilias.includes('TODAS') ||
        colabFamilias.includes(familiaOP);

      if (!matchesFamily) {
        return false;
      }
    }
  }

  // 4. Cruzamento estrito com os postos cadastrados do colaborador
  const postos = Array.isArray(op.postos) && op.postos.length > 0
    ? op.postos
    : Array.isArray(op.sectors) && op.sectors.length > 0
    ? op.sectors
    : Array.isArray(op.setores) && op.setores.length > 0
    ? op.setores
    : op.setor ? [op.setor] : [];

  return matchPosto(postos, selectedSector);
}

export const OperatorSelector: React.FC<OperatorSelectorProps> = ({
  selectedOperator,
  selectedSector,
  currentTerminal,
  order,
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

  // Filtro Rigoroso por Posto, Terminal Selecionado e Família da OP
  const filteredOperators = useMemo(() => {
    // 1. OCULTAÇÃO DO PASSO 2 SEM POSTO/SETOR SELECIONADO:
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

      // 2. Trava estrita de terminais, posto selecionado e família de produto da OP
      return matchOperatorToSector(colab, selectedSector, targetTerminalId, order);
    });
  }, [operators, selectedSector, currentTerminal?.id, order]);

  // Identificação amigável da Família do Produto para exibição
  const familiaAtiva = useMemo(() => {
    if (!order) return null;
    const f = identificarFamiliaProduto(order);
    return f && f !== 'OUTROS' && f !== 'GERAL' ? f : null;
  }, [order]);

  return (
    <div className="w-full bg-[#0e131f] border border-slate-700/80 rounded-xl p-2.5 shadow-md shrink-0">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest font-mono">
            PASSO 2: IDENTIFICAÇÃO DO COLABORADOR
          </span>
          {selectedSector && (
            <span className="text-[10px] font-mono text-slate-400">
              ({filteredOperators.length} disponíveis)
            </span>
          )}
          {familiaAtiva && (
            <span
              className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-950 border border-blue-700/60 text-blue-300 flex items-center gap-1"
              title={`Família do produto da OP: ${familiaAtiva}`}
            >
              <Tag className="w-2.5 h-2.5 text-blue-400" />
              FAMÍLIA: {familiaAtiva.replace('_', ' ')}
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
            Selecione um posto de trabalho no Passo 1 para identificar os colaboradores disponíveis.
          </p>
        </div>
      ) : filteredOperators.length === 0 ? (
        <div className="py-3 px-4 text-center bg-slate-950/60 rounded-lg border border-slate-800">
          <p className="text-xs font-mono text-slate-300">
            Nenhum colaborador habilitado para <span className="text-amber-400 font-bold">{selectedSector}</span>
            {familiaAtiva && (
              <> na família <span className="text-blue-300 font-bold">{familiaAtiva.replace('_', ' ')}</span></>
            )}{' '}
            neste terminal.
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
