import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Operator, TerminalConfig, ProductionOrder } from '../types/mes';
import { fetchOperators, saveOperators, fetchLocalColaboradores, subscribeToMesUpdates, getLocalSocket } from '../services/mesStorage';
import { Check, User, Sparkles } from 'lucide-react';
import { playClick } from '../utils/audio';

interface OperatorSelectorProps {
  selectedOperator: string | null;
  selectedSector: string | null;
  currentTerminal?: TerminalConfig | null;
  order?: ProductionOrder | null;
  onSelectOperator: (operatorName: string) => void;
}

// Identifica se o colaborador possui perfil de Especialista / Suporte Técnico
const checkIsEspecialista = (colab: Operator): boolean => {
  const badge = (colab.badge || colab.codigo || '').trim().toUpperCase();
  const role = (colab.role || '').toLowerCase();
  return Boolean(
    colab.especialista ||
    (colab as any).isEspecialista ||
    (colab as any).isCuringa ||
    colab.isRoaming ||
    colab.especialistaVolante ||
    badge.startsWith('ESP') ||
    role.includes('especialista')
  );
};

// Gerador padrão seguro de iniciais para os avatares dos colaboradores
export const extrairIniciais = (nome: string, cracha?: string): string => {
  const nomeLimpo = (nome || '').trim();
  if (!nomeLimpo && !cracha) return 'OP';
  const partes = nomeLimpo.split(/\s+/).filter(Boolean);
  if (partes.length === 1) {
    return partes[0].slice(0, 2).toUpperCase();
  }
  if (partes.length >= 2) {
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }
  if (cracha) {
    const limpo = cracha.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase();
    if (limpo) return limpo;
  }
  return 'OP';
};

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
          saveOperators(novosColabs);
          setOperators(novosColabs);
        } else {
          loadOps();
        }
      };
      const onSocketConnect = () => {
        fetchLocalColaboradores().then((res) => {
          if (Array.isArray(res) && res.length > 0) {
            setOperators(res);
          }
        });
      };

      socket.on('colaboradores_atualizados', onColabsUpdate);
      socket.on('connect', onSocketConnect);

      unsubSocket = () => {
        socket.off('colaboradores_atualizados', onColabsUpdate);
        socket.off('connect', onSocketConnect);
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

  // Normalização padronizada do posto (unificado no singular 'folha')
  const normPosto = (str: string) =>
    (str || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[-_\s]+/g, ' ')
      .replace(/folhas$/, 'folha');

  // Função de match exato com suporte a normalização Folha/Folhas (padronizado no singular)
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

  // 1 & 2: Filtro Rigoroso de Terminal Ativo e Posto Selecionado
  const filteredOperators = useMemo(() => {
    // Se nenhum posto estiver selecionado no Passo 1, lista vazia
    if (!selectedSector || selectedSector.trim() === '') {
      return [];
    }

    try {
      const termId = currentTerminal?.id || 1;
      const termKey = `T${termId}`;
      const targetSector = selectedSector.trim();
      const targetNorm = normPosto(targetSector);
      const postoAtivoNormalizado = targetSector.trim().toLowerCase();

      const sanitizar = (txt: string) =>
        (txt || '')
          .toLowerCase()
          .trim()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
      const targetSanitizado = sanitizar(targetSector);

      // Normalizar a etapa/posto selecionado antes do loop para comparação segura
      const postoAlvoSimplificado = (targetSector || '')
        .toLowerCase()
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[-_\s]+/g, ' ')
        .replace(/folhas$/, 'folha');
      const postoAtivoSimplificado = postoAlvoSimplificado;

      return operators.filter((colab: Operator) => {
        // 1. Status ativo
        if (colab.ativo === false) return false;

        // 2. FILTRO RIGOROSO DE TERMINAL ATIVO:
        // O colaborador SÓ PODE APARECER se o terminal atual (ex: Terminal 1) estiver dentro do seu array de terminais autorizados,
        // OU se ele for ESP-MULTI / tiver autorização explícita em todos os terminais.
        // Sergio (T3) e Fabio (T5) NÃO devem aparecer no Terminal 1.
        const colabTerminais = Array.isArray(colab.terminais) ? colab.terminais : [];
        const badge = (colab.badge || colab.codigo || '').trim().toUpperCase();
        const isEsp = checkIsEspecialista(colab);

        const isMultiTerminal =
          badge === 'ESP-MULTI' ||
          badge.includes('MULTI') ||
          colabTerminais.some((t) => {
            const s = String(t).toUpperCase().trim();
            return s === 'TODOS' || s === 'ALL' || s === 'MULTI';
          }) ||
          colabTerminais.length >= 5;

        const hasTerminal = isMultiTerminal || colabTerminais.some((t) => {
          const normT = String(t).toUpperCase().trim();
          return normT === termKey || normT.replace(/[^\d]/g, '') === String(termId);
        });

        // Se NÃO pertence ao terminal atual, DESCARTA IMEDIATAMENTE (inclusive especialistas de outros terminais)
        if (!hasTerminal) {
          return false;
        }

        // 3. SETORES AUTORIZADOS DO COLABORADOR:
        const colabSetoresRaw: string[] = [
          ...(Array.isArray(colab.setores) ? colab.setores : []),
          ...(Array.isArray(colab.sectors) ? colab.sectors : []),
          ...(colab.setor ? [colab.setor] : []),
          ...(Array.isArray(colab.setoresPorTerminal?.[termKey]) ? colab.setoresPorTerminal[termKey] : [])
        ];
        const colabSetores = Array.from(new Set(colabSetoresRaw.map((s) => String(s || '').trim()).filter(Boolean)));

        // a) Se for Especialista / Suporte Técnico:
        if (isEsp) {
          const isDesignatedForThisTerm = isMultiTerminal || badge === `ESP-${termKey}` || hasTerminal;
          const hasPostoPermission = colabSetores.includes('TODOS') || colabSetores.some((s) => matchPosto(s, targetSector));
          if (isDesignatedForThisTerm || hasPostoPermission) {
            return true;
          }
          return false;
        }

        // b) Se for Operador da Etapa (não especialista):
        // APLICAÇÃO DO FILTRO DINÂMICO DE SETOR NO PASSO 2 (SEM HARDCODE):
        // O operador DEVE conter exatamente o setor selecionado no Passo 1 (ex: "Dobra")
        return colabSetores.some((s: string) => {
          if (!s) return false;
          const sNorm = s.trim().toLowerCase();
          const sSanitizado = sanitizar(s);
          const sSimplificado = normPosto(s);
          return (
            sNorm === postoAtivoNormalizado ||
            sSanitizado === targetSanitizado ||
            sSimplificado === postoAlvoSimplificado ||
            sSimplificado === postoAtivoSimplificado ||
            sSimplificado === targetNorm ||
            matchPosto(s, targetSector)
          );
        });
      });
    } catch (err) {
      console.error('[OperatorSelector] Erro ao filtrar operadores:', err);
      return [];
    }
  }, [operators, selectedSector, currentTerminal?.id]);

  // 3. Divisão dos colaboradores em dois grupos claros:
  // A) Operadores da Etapa
  // B) Especialistas / Suporte Técnico
  const { operadoresEtapa, especialistasApoio } = useMemo(() => {
    const operadores: Operator[] = [];
    const especialistas: Operator[] = [];

    filteredOperators.forEach((op) => {
      if (checkIsEspecialista(op)) {
        especialistas.push(op);
      } else {
        operadores.push(op);
      }
    });

    return { operadoresEtapa: operadores, especialistasApoio: especialistas };
  }, [filteredOperators]);

  // Se o colaborador selecionado não pertencer mais ao posto ativo, limpa a seleção
  useEffect(() => {
    if (selectedOperator && filteredOperators.length > 0) {
      const exists = filteredOperators.some((op) => op.name === selectedOperator);
      if (!exists) {
        onSelectOperator('');
      }
    }
  }, [filteredOperators, selectedOperator, onSelectOperator]);

  // Renderização do Card de Colaborador
  const renderCard = (op: Operator, isSpecialist: boolean) => {
    const nomeColab = op.name || op.nome || '';
    const badgeColab = op.badge || op.codigo || '';
    const isSelected = selectedOperator === nomeColab;

    // Garante extração segura e confiável das iniciais para o avatar
    const iniciais = (op.initials && op.initials.trim())
      ? op.initials.trim().toUpperCase()
      : extrairIniciais(nomeColab, badgeColab);

    const partesNome = nomeColab.split(/\s+/).filter(Boolean);
    const nomeExibicao = partesNome.length > 1
      ? `${partesNome[0]} ${partesNome[1][0]}.`
      : nomeColab || 'Operador';

    return (
      <button
        key={op.id}
        type="button"
        onClick={() => {
          playClick();
          onSelectOperator(nomeColab);
        }}
        className={`py-1.5 px-2 min-w-[70px] rounded-xl border text-center transition-all flex flex-col items-center justify-between kiosk-btn cursor-pointer select-none active:scale-95 ${
          isSelected
            ? isSpecialist
              ? 'bg-gradient-to-b from-amber-950/80 via-[#251846]/90 to-[#1C2F8A]/90 border-amber-400 ring-2 ring-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.45)] scale-[1.02] text-white font-bold'
              : 'bg-gradient-to-b from-cyan-950/70 to-[#1C2F8A]/90 border-cyan-400 ring-2 ring-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.4)] scale-[1.02] text-white font-bold'
            : isSpecialist
            ? 'bg-[#101026] border-purple-900/60 hover:border-amber-400/60 hover:bg-purple-950/30 text-slate-200'
            : 'bg-slate-900 border-slate-800 hover:border-cyan-500/50 hover:bg-slate-850 text-slate-200'
        }`}
      >
        {/* Avatar */}
        <div className="relative mb-1">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs transition shadow-sm select-none ${
              isSelected
                ? isSpecialist
                  ? 'bg-amber-400 text-slate-950 border-2 border-amber-200 font-black shadow-[0_0_12px_rgba(251,191,36,0.6)]'
                  : 'bg-cyan-500 text-slate-950 border-2 border-cyan-300 font-black shadow-[0_0_12px_rgba(34,211,238,0.6)]'
                : isSpecialist
                ? 'bg-gradient-to-br from-purple-900/90 to-amber-950/90 text-amber-300 border border-amber-500/50 shadow-[0_0_8px_rgba(251,191,36,0.25)]'
                : 'bg-slate-800 text-slate-200 border border-slate-700'
            }`}
          >
            {iniciais}
          </div>

          {isSelected && (
            <div className={`absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center font-bold shadow-md ${
              isSpecialist ? 'bg-amber-400 text-slate-950' : 'bg-cyan-400 text-slate-950'
            }`}>
              <Check className="w-2.5 h-2.5 stroke-[3]" />
            </div>
          )}

          {isSpecialist && !isSelected && (
            <div
              className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center font-bold text-[8px] shadow-sm"
              title="Especialista / Suporte Técnico"
            >
              ★
            </div>
          )}
        </div>

        {/* Nome e Badge */}
        <div className="w-full">
          <div className={`font-bold text-xs leading-none mt-1 truncate max-w-full ${
            isSelected
              ? isSpecialist ? 'text-amber-200 font-extrabold' : 'text-cyan-200 font-extrabold'
              : isSpecialist ? 'text-amber-100 font-semibold' : 'text-white'
          }`}>
            {nomeExibicao}
          </div>
          <div className="mt-1 flex items-center justify-center">
            {isSpecialist ? (
              <span className={`text-[9px] px-1 py-0.2 rounded font-mono font-bold leading-tight border truncate max-w-full ${
                isSelected
                  ? 'bg-amber-400/20 text-amber-200 border-amber-400/40'
                  : 'bg-purple-950/70 text-amber-300/90 border-amber-500/30'
              }`}>
                {badgeColab || 'ESP'}
              </span>
            ) : (
              <span className={`text-[10px] opacity-75 font-mono truncate leading-none ${
                isSelected ? 'text-cyan-300 font-bold' : 'text-slate-400'
              }`}>
                {badgeColab || op.role}
              </span>
            )}
          </div>
        </div>
      </button>
    );
  };

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
        <div className="w-full space-y-3">
          {/* A) OPERADORES DA ETAPA */}
          {operadoresEtapa.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider font-mono">
                  OPERADORES DA ETAPA
                </span>
                <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-1.5 py-0.2 rounded border border-slate-800">
                  {operadoresEtapa.length}
                </span>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-1.5 sm:gap-2">
                {operadoresEtapa.map((op) => renderCard(op, false))}
              </div>
            </div>
          )}

          {/* B) ESPECIALISTAS / SUPORTE TÉCNICO */}
          {especialistasApoio.length > 0 && (
            <div className={operadoresEtapa.length > 0 ? "pt-2.5 border-t border-slate-800/80" : ""}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
                <span className="text-[10px] font-bold text-amber-300 uppercase tracking-wider font-mono">
                  ESPECIALISTAS / SUPORTE TÉCNICO
                </span>
                <span className="text-[10px] font-mono text-amber-400/90 bg-amber-500/10 px-1.5 py-0.2 rounded border border-amber-500/20">
                  {especialistasApoio.length}
                </span>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-1.5 sm:gap-2">
                {especialistasApoio.map((op) => renderCard(op, true))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
