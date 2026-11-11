import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Operator, TerminalConfig, ProductionOrder } from '../types/mes';
import { fetchOperators, subscribeToMesUpdates, getLocalSocket } from '../services/mesStorage';
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

    let unsubSocket: (() => void) | undefined;
    try {
      const socket = getLocalSocket();
      const onColabsUpdate = (novosColabs: any) => {
        if (Array.isArray(novosColabs) && novosColabs.length > 0) {
          setOperators(novosColabs);
        } else {
          loadOps();
        }
      };
      socket.on('colaboradores_atualizados', onColabsUpdate);
      unsubSocket = () => {
        socket.off('colaboradores_atualizados', onColabsUpdate);
      };
    } catch {}

    return () => {
      unsubStorage();
      if (unsubSocket) unsubSocket();
      window.removeEventListener('storage', handleLocalUpdate);
      window.removeEventListener('metalrib_data_updated', handleLocalUpdate);
      window.removeEventListener('metalrib_operators_updated', handleLocalUpdate);
      window.removeEventListener('focus', handleLocalUpdate);
      document.removeEventListener('visibilitychange', handleLocalUpdate);
    };
  }, [loadOps]);

  // Normalização padronizada do posto (singular/plural)
  const normPosto = (str: string) =>
    (str || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[-_\s]+/g, ' ')
      .replace(/folha$/, 'folhas');

  // Função de match exato com suporte a normalização Folha/Folhas
  const matchPosto = (postoColab: string, postoAtivo: string): boolean => {
    if (!postoColab || !postoAtivo) return false;
    const a = normPosto(postoColab);
    const b = normPosto(postoAtivo);
    if (a === b) return true;
    if (a === 'todos') return true;

    // Regras de correspondência industrial específicas
    if (b.includes('corte') && !b.includes('aluminio') && !b.includes('trilho')) {
      return a.includes('corte') && !a.includes('aluminio') && !a.includes('trilho');
    }
    if (b.includes('corte') && b.includes('aluminio')) {
      return a.includes('corte') && a.includes('aluminio');
    }
    if (b.includes('corte') && b.includes('trilho')) {
      return a.includes('trilho');
    }
    if (b.includes('dobra')) {
      return a.includes('dobra');
    }
    if (b.includes('laser')) {
      return a.includes('laser');
    }
    if (b.includes('preparacao') && b.includes('folha')) {
      return a.includes('preparacao') && a.includes('folha');
    }
    if (b.includes('preparacao') && b.includes('batente')) {
      return a.includes('preparacao') && a.includes('batente');
    }
    if (b.includes('preparacao') && b.includes('vai vem')) {
      return a.includes('vai vem') && (a.includes('preparacao') || a.includes('pvv'));
    }
    if (b.includes('inje') && b.includes('batente')) {
      return a.includes('batente') && (a.includes('inje') || a.includes('finalizacao'));
    }
    if (b.includes('inje')) {
      return a.includes('inje') && !a.includes('batente');
    }
    if (b.includes('gaxeta')) return a.includes('gaxeta');
    if (b.includes('girat')) return a.includes('girat');
    if (b.includes('correr')) return a.includes('correr');
    if (b.includes('vai vem')) return a.includes('vai vem');
    if (b.includes('office')) return a.includes('office');
    if (b.includes('emenda')) return a.includes('emenda');
    if (b.includes('estante')) return a.includes('estante');
    if (b.includes('cortina')) return a.includes('cortina');
    if (b.includes('eletrica')) return a.includes('eletrica');
    if (b.includes('router')) return a.includes('router');
    if (b.includes('solda')) return a.includes('solda');

    return false;
  };

  // Filtro Direto e Padronizado por Terminal e Posto Selecionado
  const filteredOperators = useMemo(() => {
    // 1. Se nenhum posto estiver selecionado no Passo 1, lista vazia
    if (!selectedSector || selectedSector.trim() === '') {
      return [];
    }

    const termId = currentTerminal?.id || 1;
    const termKey = `T${termId}`;
    const targetSector = selectedSector.trim();
    const targetNorm = normPosto(targetSector);

    return operators.filter((colab: Operator) => {
      // 1. Status ativo
      if (colab.ativo === false) return false;

      // 2. Terminal ativo (ex: 'T1' ou 1) ou especialista roaming
      const colabTerminais = Array.isArray(colab.terminais) ? colab.terminais : [];
      const hasTerminal = colabTerminais.some(
        (t) => String(t).toUpperCase().trim() === termKey || String(t).replace(/[^\d]/g, '') === String(termId)
      );

      const isEspecialista = Boolean(
        colab.especialista ||
        (colab as any).isEspecialista ||
        (colab as any).isCuringa ||
        colab.isRoaming ||
        colab.especialistaVolante
      );

      // Se não pertence ao terminal e não é especialista volante, descarta
      if (!hasTerminal && !isEspecialista) return false;

      // a) Especialista / Curinga tem acesso livre
      if (isEspecialista) {
        return true;
      }

      // 3. Coleta todos os setores autorizados do colaborador
      const colabSetores: string[] = [
        ...(Array.isArray(colab.setores) ? colab.setores : []),
        ...(Array.isArray(colab.sectors) ? colab.sectors : []),
        ...(colab.setor ? [colab.setor] : []),
        ...(colab.postos ? colab.postos : []),
        ...(colab.setoresPorTerminal?.[termKey] || [])
      ];

      // b) Tenham o posto selecionado ativo em seus setores autorizados
      const hasDirectSector = colabSetores.some((s) => matchPosto(s, targetSector));
      if (hasDirectSector) {
        // Se o posto selecionado for Corte da guilhotina, não exibir operadores de Dobra sem código/permissão de corte
        const badge = (colab.badge || colab.codigo || '').trim().toUpperCase();
        if (targetNorm.includes('corte') && !targetNorm.includes('aluminio') && !targetNorm.includes('trilho')) {
          if (badge.startsWith('DOB')) {
            return false;
          }
        }
        return true;
      }

      // c) Tenham o código/badge correspondente ao posto
      const badge = (colab.badge || colab.codigo || '').trim().toUpperCase();
      if (targetNorm.includes('dobra') && badge.startsWith('DOB')) {
        return true;
      }
      if (targetNorm.includes('corte') && !targetNorm.includes('aluminio') && !targetNorm.includes('trilho') && badge.startsWith('CORTE')) {
        return true;
      }
      if (targetNorm.includes('laser') && badge.startsWith('LASER')) {
        return true;
      }
      if (targetNorm.includes('router') && badge.startsWith('ROU')) {
        return true;
      }
      if (targetNorm.includes('solda') && badge.startsWith('SOL')) {
        return true;
      }

      return false;
    });
  }, [operators, selectedSector, currentTerminal?.id]);

  // Se o colaborador selecionado não pertencer mais ao posto ativo, limpa a seleção
  useEffect(() => {
    if (selectedOperator && filteredOperators.length > 0) {
      const exists = filteredOperators.some((op) => op.name === selectedOperator);
      if (!exists) {
        onSelectOperator('');
      }
    }
  }, [filteredOperators, selectedOperator, onSelectOperator]);

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
        <div className="w-full">
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-1.5 sm:gap-2">
            {filteredOperators.map((op: Operator) => {
              const isSelected = selectedOperator === op.name;

              return (
                <button
                  key={op.id}
                  onClick={() => {
                    playClick();
                    onSelectOperator(op.name);
                  }}
                  className={`py-1 px-2 min-w-[70px] rounded-xl border text-center transition-all flex flex-col items-center justify-between kiosk-btn cursor-pointer ${
                    isSelected
                      ? 'bg-gradient-to-b from-cyan-950/70 to-[#1C2F8A]/90 border-cyan-400 ring-2 ring-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.4)] scale-[1.02] text-white font-bold'
                      : 'bg-slate-900 border-slate-800 hover:border-cyan-500/50 hover:bg-slate-850 text-slate-200'
                  }`}
                >
                  {/* Avatar do Operador */}
                  <div className="relative mb-0.5">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center font-black text-xs transition ${
                        isSelected
                          ? 'bg-cyan-500 text-slate-950 border-2 border-cyan-300 font-black shadow-[0_0_10px_rgba(34,211,238,0.6)]'
                          : op.isRoaming
                          ? 'bg-blue-950 text-blue-300 border border-blue-800'
                          : 'bg-slate-800 text-slate-300 border border-slate-700'
                      }`}
                    >
                      {op.initials}
                    </div>
                    {isSelected && (
                      <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-cyan-400 text-slate-950 flex items-center justify-center font-bold shadow-[0_0_8px_rgba(34,211,238,0.8)]">
                        <Check className="w-2 h-2 stroke-[3]" />
                      </div>
                    )}
                    {(op.especialista || op.isRoaming) && !isSelected && (
                      <div
                        className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 text-black flex items-center justify-center font-bold text-[6px]"
                        title="Especialista"
                      >
                        ★
                      </div>
                    )}
                  </div>

                  <div className="w-full">
                    <div className={`font-bold text-xs leading-none mt-1 truncate max-w-full ${isSelected ? 'text-cyan-200 font-extrabold' : 'text-white'}`}>
                      {op.name.split(' ').length > 1
                        ? `${op.name.split(' ')[0]} ${op.name.split(' ')[1][0]}.`
                        : op.name}
                    </div>
                    <div className={`text-[10px] opacity-75 font-mono truncate leading-none mt-0.5 ${isSelected ? 'text-cyan-300 font-bold' : 'text-slate-400'}`}>
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
