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
  const allSectors = Array.from(
    new Set([...(op.setores || []), ...(op.sectors || []), op.setor || ''])
  ).map(normalizarTexto).filter(Boolean);

  const terminals = new Set<number>();

  const isEme = (op.codigo && op.codigo.startsWith('EME')) ||
                (op.badge && op.badge.startsWith('EME')) ||
                ['ademir', 'francisco', 'denis', 'jhonatan', 'jose_aparecido', 'deilson'].includes(op.id);
  if (isEme) {
    return [3]; // EME é estritamente Terminal 3
  }

  const isGir = (op.codigo && op.codigo.startsWith('GIR')) ||
                (op.badge && op.badge.startsWith('GIR')) ||
                ['nalysson', 'vinicius', 'fabiano', 'gustavo_naves'].includes(op.id);
  if (isGir) {
    return [4]; // Giratória é estritamente Terminal 4
  }

  const isVvFinal = (op.codigo && op.codigo.startsWith('VV')) ||
                   (op.badge && op.badge.startsWith('VV')) ||
                   ['joao_paulo', 'alessandra'].includes(op.id);
  if (isVvFinal) {
    return [4]; // Finalização Vai Vem é estritamente Terminal 4
  }

  const isBat = (op.codigo && op.codigo.startsWith('BAT')) ||
                (op.badge && op.badge.startsWith('BAT')) ||
                ['antonio_massena', 'antonio', 'aparecido', 'yuri'].includes(op.id);
  if (isBat) {
    return [3]; // Batentes é estritamente Terminal 3
  }

  const isOff = (op.codigo && op.codigo.startsWith('OFF')) ||
                (op.badge && op.badge.startsWith('OFF')) ||
                ['lucas'].includes(op.id);
  if (isOff) {
    return [3]; // Office Door é Terminal 3
  }

  const isInj = (op.codigo && op.codigo.startsWith('INJ')) ||
                (op.badge && op.badge.startsWith('INJ')) ||
                ['magna', 'donizete'].includes(op.id);
  if (isInj) {
    return [2]; // Injetora de Folhas é estritamente Terminal 2
  }

  const isPrep = (op.codigo && op.codigo.startsWith('PREP')) ||
                 (op.badge && op.badge.startsWith('PREP')) ||
                 ['paulo_henrique'].includes(op.id);
  if (isPrep) {
    return [2]; // Preparação de Folhas é estritamente Terminal 2
  }

  const isCorte = (op.codigo && op.codigo.startsWith('CORTE')) ||
                  (op.badge && op.badge.startsWith('CORTE')) ||
                  ['eliel'].includes(op.id);
  if (isCorte) {
    return [1]; // Corte é estritamente Terminal 1
  }

  const isDob = (op.codigo && op.codigo.startsWith('DOB')) ||
                (op.badge && op.badge.startsWith('DOB')) ||
                ['leonardo', 'danielson'].includes(op.id);
  if (isDob) {
    return [1]; // Dobra é estritamente Terminal 1
  }

  const isSol = (op.codigo && op.codigo.startsWith('SOL')) ||
                (op.badge && op.badge.startsWith('SOL')) ||
                op.badge === 'ESP-PL' ||
                ['fabio', 'nathan'].includes(op.id);
  if (isSol) {
    return [5]; // Solda e Montagem é estritamente Terminal 5
  }

  const isPvv = (op.codigo && op.codigo.startsWith('PVV')) ||
                (op.badge && op.badge.startsWith('PVV')) ||
                ['yasmin'].includes(op.id);
  if (isPvv) {
    return [5]; // Preparação Vai Vem é estritamente Terminal 5
  }

  const isRou = (op.codigo && op.codigo.startsWith('ROU')) ||
                (op.badge && op.badge.startsWith('ROU')) ||
                ['victor'].includes(op.id);
  if (isRou) {
    return [5]; // Router é Terminal 5
  }

  const isEle = (op.codigo && op.codigo.startsWith('ELE')) ||
                (op.badge && op.badge.startsWith('ELE')) ||
                ['marcio', 'cristiane'].includes(op.id);
  if (isEle) {
    return [5]; // Elétrica é Terminal 5
  }

  const isCor = (op.codigo && op.codigo.startsWith('COR-')) ||
                (op.badge && op.badge.startsWith('COR-')) ||
                ['gabriele'].includes(op.id);
  if (isCor) {
    return [5]; // Cortina é Terminal 5
  }

  // Setores adicionais cadastrados no PCP
  for (const s of allSectors) {
    if (s.includes('corte') || s.includes('guilhotina') || s.includes('dobra') || s.includes('laser')) terminals.add(1);
    if ((s.includes('preparacao') && !s.includes('vai vem') && !s.includes('batente')) || s.includes('injetora') || s.includes('injecao')) terminals.add(2);
    if (s.includes('batente') || s.includes('office') || s.includes('emendad')) terminals.add(3);
    if (s.includes('gaxeta') || s.includes('girat') || (s.includes('finalizacao') && s.includes('vai vem'))) terminals.add(4);
    if (s.includes('solda') || (s.includes('preparacao') && s.includes('vai vem')) || s.includes('router') || s.includes('eletrica') || s.includes('cortina')) terminals.add(5);
  }

  return Array.from(terminals);
}

/**
 * Validação estrita entre o colaborador e a operação específica selecionada
 */
function matchOperatorToSector(op: Operator, selectedSector: string, targetTerminalId: number): boolean {
  const secNorm = normalizarTexto(selectedSector);
  const allSectors = Array.from(
    new Set([...(op.setores || []), ...(op.sectors || []), op.setor || ''])
  ).map(normalizarTexto).filter(Boolean);

  // 1. TERMINAL 1 (Corte, Dobra, Laser)
  if (targetTerminalId === 1) {
    if (secNorm.includes('corte') || secNorm.includes('guilhotina')) {
      return (
        allSectors.some(s => s.includes('corte') || s.includes('guilhotina')) ||
        Boolean(op.codigo && op.codigo.startsWith('CORTE')) ||
        Boolean(op.badge && op.badge.startsWith('CORTE')) ||
        op.id === 'eliel'
      );
    }
    if (secNorm.includes('dobra')) {
      return (
        allSectors.some(s => s.includes('dobra')) ||
        Boolean(op.codigo && op.codigo.startsWith('DOB')) ||
        Boolean(op.badge && op.badge.startsWith('DOB')) ||
        ['leonardo', 'danielson'].includes(op.id)
      );
    }
    if (secNorm.includes('laser')) {
      return (
        allSectors.some(s => s.includes('laser')) ||
        Boolean(op.badge && op.badge.startsWith('ESP-JR')) ||
        ['afonso', 'bruno'].includes(op.id)
      );
    }
    return false;
  }

  // 2. TERMINAL 2 (Preparação de Folhas, Injetora de Folhas)
  if (targetTerminalId === 2) {
    if (secNorm.includes('prep') || secNorm.includes('preparacao')) {
      return (
        allSectors.some(s => s.includes('prep') && !s.includes('vai vem')) ||
        Boolean(op.badge && op.badge.startsWith('PREP')) ||
        op.id === 'paulo_henrique'
      );
    }
    if (secNorm.includes('inj') || secNorm.includes('injetora')) {
      return (
        allSectors.some(s => s.includes('inj')) ||
        Boolean(op.badge && op.badge.startsWith('INJ')) ||
        ['magna', 'donizete'].includes(op.id)
      );
    }
    return false;
  }

  // 3. TERMINAL 3 (Batentes, Portas Emendadas, Office Door)
  if (targetTerminalId === 3) {
    // Preparação de Batentes
    if (secNorm.includes('preparacao') && secNorm.includes('batente')) {
      return (
        allSectors.some(s => s.includes('preparacao') && s.includes('batente')) ||
        Boolean(op.badge && op.badge.startsWith('BAT')) ||
        Boolean(op.codigo && op.codigo.startsWith('BAT')) ||
        ['antonio_massena', 'antonio', 'aparecido', 'yuri'].includes(op.id)
      );
    }
    // Injeção e Finalização Batentes
    if ((secNorm.includes('injecao') || secNorm.includes('finalizacao')) && secNorm.includes('batente')) {
      return (
        allSectors.some(s => (s.includes('injecao') || s.includes('finalizacao')) && s.includes('batente')) ||
        Boolean(op.badge && op.badge.startsWith('BAT')) ||
        Boolean(op.codigo && op.codigo.startsWith('BAT')) ||
        ['antonio_massena', 'antonio', 'aparecido', 'yuri'].includes(op.id)
      );
    }
    if (secNorm.includes('batente')) {
      return (
        allSectors.some(s => s.includes('batente')) ||
        Boolean(op.badge && op.badge.startsWith('BAT')) ||
        Boolean(op.codigo && op.codigo.startsWith('BAT')) ||
        ['antonio_massena', 'antonio', 'aparecido', 'yuri'].includes(op.id)
      );
    }
    if (secNorm.includes('emendad') || secNorm.includes('correr')) {
      return (
        allSectors.some(s => s.includes('emendad')) ||
        Boolean(op.badge && op.badge.startsWith('EME')) ||
        Boolean(op.codigo && op.codigo.startsWith('EME')) ||
        ['ademir', 'francisco', 'denis', 'jhonatan', 'jose_aparecido', 'deilson'].includes(op.id)
      );
    }
    if (secNorm.includes('office')) {
      return (
        allSectors.some(s => s.includes('office')) ||
        Boolean(op.badge && op.badge.startsWith('OFF')) ||
        op.id === 'lucas'
      );
    }
    return false;
  }

  // 4. TERMINAL 4 (Gaxeta, Montagem Giratória, Finalização Vai-Vem)
  if (targetTerminalId === 4) {
    if (secNorm.includes('gaxeta')) {
      return (
        allSectors.some(s => s.includes('gaxeta') || s.includes('girat')) ||
        Boolean(op.badge && op.badge.startsWith('GIR')) ||
        ['nalysson', 'vinicius', 'fabiano', 'gustavo_naves'].includes(op.id)
      );
    }
    if (secNorm.includes('girat')) {
      return (
        allSectors.some(s => s.includes('girat')) ||
        Boolean(op.badge && op.badge.startsWith('GIR')) ||
        ['nalysson', 'vinicius', 'fabiano', 'gustavo_naves'].includes(op.id)
      );
    }
    if (secNorm.includes('vai vem') || secNorm.includes('finalizacao')) {
      return (
        allSectors.some(s => s.includes('vai vem') && !s.includes('prep')) ||
        Boolean(op.badge && op.badge.startsWith('VV')) ||
        ['joao_paulo', 'alessandra'].includes(op.id)
      );
    }
    return false;
  }

  // 5. TERMINAL 5 (Solda e Montagem, Preparação Vai-Vem, Router, Elétrica, Cortina)
  if (targetTerminalId === 5) {
    if (secNorm.includes('solda')) {
      return (
        allSectors.some(s => s.includes('solda')) ||
        Boolean(op.badge && (op.badge.startsWith('SOL') || op.badge === 'ESP-PL')) ||
        ['fabio', 'nathan'].includes(op.id)
      );
    }
    if (secNorm.includes('vai vem') || secNorm.includes('preparacao')) {
      return (
        allSectors.some(s => s.includes('vai vem') && s.includes('prep')) ||
        Boolean(op.badge && op.badge.startsWith('PVV')) ||
        op.id === 'yasmin'
      );
    }
    if (secNorm.includes('router')) {
      return (
        allSectors.some(s => s.includes('router')) ||
        Boolean(op.badge && op.badge.startsWith('ROU')) ||
        op.id === 'victor'
      );
    }
    if (secNorm.includes('eletrica')) {
      return (
        allSectors.some(s => s.includes('eletrica')) ||
        Boolean(op.badge && op.badge.startsWith('ELE')) ||
        ['marcio', 'cristiane'].includes(op.id)
      );
    }
    if (secNorm.includes('cortina')) {
      return (
        allSectors.some(s => s.includes('cortina')) ||
        Boolean(op.badge && op.badge.startsWith('COR')) ||
        op.id === 'gabriele'
      );
    }
    return false;
  }

  return allSectors.some(s => s === secNorm || s.includes(secNorm) || secNorm.includes(s));
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
                    {op.isRoaming && !isSelected && (
                      <div
                        className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-400 text-black flex items-center justify-center font-bold text-[8px]"
                        title="Especialista Volante"
                      >
                        ★
                      </div>
                    )}
                  </div>

                  <div className="w-full">
                    <div className="font-bold text-xs text-white truncate max-w-full leading-tight">
                      {op.name.split(' ')[0]}
                    </div>
                    <div className="text-[9px] font-mono text-slate-400 truncate">
                      {op.badge || op.name.split(' ')[1] || ''}
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
