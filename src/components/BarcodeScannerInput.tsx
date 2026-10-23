import React, { useState, useEffect, useRef } from 'react';
import { Search, CornerDownLeft, Delete, AlertCircle } from 'lucide-react';
import { playBarcodeBeep, playClick, playBlockedError } from '../utils/audio';
import { TerminalConfig } from '../types/mes';

interface BarcodeScannerInputProps {
  onSearchOp: (opNumero: string) => void;
  isLoading?: boolean;
  errorMessage?: string | null;
  currentTerminal?: TerminalConfig | null;
  onSwitchTerminal?: () => void;
  onOpenPcp?: () => void;
  onOpenMobile?: () => void;
}

export const BarcodeScannerInput: React.FC<BarcodeScannerInputProps> = ({
  onSearchOp,
  isLoading = false,
  errorMessage = null,
  currentTerminal = null,
  onSwitchTerminal,
  onOpenPcp,
  onOpenMobile
}) => {
  const [opValue, setOpValue] = useState<string>('');
  const [showKeypad, setShowKeypad] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mantém foco automático no campo de busca constante do Totem
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleConfirm = () => {
    const trimmed = opValue.trim();
    if (!trimmed) {
      playBlockedError();
      return;
    }
    playBarcodeBeep();
    onSearchOp(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    }
  };

  const handleKeypadPress = (val: string) => {
    playClick();
    if (val === 'BACKSPACE') {
      setOpValue(prev => prev.slice(0, -1));
    } else if (val === 'CLEAR') {
      setOpValue('');
    } else if (val === 'ENTER') {
      handleConfirm();
    } else {
      setOpValue(prev => (prev + val).toUpperCase());
    }
    inputRef.current?.focus();
  };

  const terminalLabel = currentTerminal
    ? `${currentTerminal.name} - ${currentTerminal.label}`
    : 'Terminal 1 - Corte / Dobra';

  return (
    <div className="min-h-screen w-full bg-[#030712] flex flex-col justify-between p-4 md:p-6 text-slate-100 antialiased selection:bg-[#1C2F8A] selection:text-white">
      {/* Topo: Identificação discreta do Terminal */}
      <div className="flex justify-between items-center w-full max-w-5xl mx-auto py-2 gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700 flex items-center gap-1.5 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{terminalLabel}</span>
          </span>
          {onSwitchTerminal && (
            <button
              onClick={() => {
                playClick();
                onSwitchTerminal();
              }}
              className="text-[11px] font-mono text-slate-400 hover:text-white underline cursor-pointer"
            >
              (Trocar)
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {onOpenMobile && (
            <button
              onClick={() => {
                playClick();
                onOpenMobile();
              }}
              className="text-xs font-semibold px-2.5 py-1 rounded bg-sky-950/60 hover:bg-sky-900 border border-sky-500/40 text-sky-300 transition cursor-pointer"
            >
              📱 Mobile
            </button>
          )}
          {onOpenPcp && (
            <button
              onClick={() => {
                playClick();
                onOpenPcp();
              }}
              className="text-xs font-semibold px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition cursor-pointer"
            >
              Portal PCP
            </button>
          )}
          <span className="text-xs text-slate-500 hidden sm:inline font-mono">MES Chão de Fábrica</span>
        </div>
      </div>

      {/* Centro: Logo + Título + Input de Busca */}
      <div className="flex-1 flex flex-col items-center justify-center max-w-2xl w-full mx-auto gap-6 my-auto py-6">
        <div className="flex flex-col items-center gap-2">
          {/* Logo Metalrib */}
          <div className="border-2 border-blue-600 rounded-xl px-6 py-2 bg-blue-950/40 text-center shadow-lg shadow-blue-950/50">
            <h1 className="text-2xl font-black tracking-widest text-white">METALRIB</h1>
            <p className="text-[10px] tracking-wider text-blue-300 font-semibold uppercase">Portas Frigoríficas</p>
          </div>
          <span className="text-[11px] font-bold text-slate-400 tracking-widest uppercase mt-2 font-mono">
            Totem Industrial de Apontamento
          </span>
        </div>

        <div className="text-center space-y-1">
          <h2 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
            BIPE OU DIGITE A OP
          </h2>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Aguardando leitura de código de barras ou digitação do número da Ordem de Produção pelo operador.
          </p>
        </div>

        {/* Campo de Entrada + Botão Localizar */}
        <div className="w-full bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-2xl flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={opValue}
              onChange={(e) => setOpValue(e.target.value.toUpperCase())}
              onKeyDown={handleKeyDown}
              placeholder="Bipe ou Digite a OP (Ex: OP 023752-01)"
              className="w-full sm:flex-1 bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-xl px-4 py-3.5 text-base md:text-lg text-white font-mono tracking-wider outline-none placeholder:text-slate-600"
              autoFocus
              disabled={isLoading}
            />
            <button
              onClick={handleConfirm}
              disabled={isLoading || !opValue.trim()}
              className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all text-white font-bold px-6 py-3.5 rounded-xl text-sm md:text-base flex items-center justify-center gap-2 shrink-0 cursor-pointer shadow-lg shadow-blue-900/30"
            >
              {isLoading ? (
                <span className="animate-spin text-lg">↻</span>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  <span>LOCALIZAR OP</span>
                </>
              )}
            </button>
          </div>

          {/* Mensagem de Erro se OP não encontrada */}
          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="flex justify-between items-center text-[11px] text-slate-500 px-1">
            <span>▼ Pressione Enter no leitor ou teclado físico</span>
            <button
              type="button"
              onClick={() => {
                playClick();
                setShowKeypad(!showKeypad);
              }}
              className="hover:text-slate-300 underline cursor-pointer"
            >
              {showKeypad ? '▲ Ocultar Teclado' : 'Teclado Virtual'}
            </button>
          </div>

          {/* Teclado Virtual Opcional para Totem Touchscreen */}
          {showKeypad && (
            <div className="pt-3 border-t border-slate-800 grid grid-cols-3 sm:grid-cols-6 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', 'OP '].map((btn) => (
                <button
                  key={btn}
                  onClick={() => handleKeypadPress(btn)}
                  className="py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-bold text-lg rounded-xl border border-slate-700 transition font-mono kiosk-btn cursor-pointer"
                >
                  {btn}
                </button>
              ))}
              <button
                onClick={() => handleKeypadPress('BACKSPACE')}
                className="py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-rose-400 font-bold text-xs rounded-xl border border-slate-700 flex items-center justify-center gap-1 kiosk-btn cursor-pointer"
              >
                <Delete className="w-4 h-4" />
                <span>Apagar</span>
              </button>
              <button
                onClick={() => handleKeypadPress('CLEAR')}
                className="py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-amber-400 font-bold text-xs rounded-xl border border-slate-700 kiosk-btn cursor-pointer"
              >
                Limpar
              </button>
              <button
                onClick={() => handleKeypadPress('ENTER')}
                className="col-span-1 sm:col-span-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-sm rounded-xl border border-emerald-500 flex items-center justify-center gap-2 kiosk-btn cursor-pointer shadow-md"
              >
                <CornerDownLeft className="w-4 h-4" />
                <span>Confirmar OP</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Rodapé: Fixado no fluxo normal inferior, NUNCA sobreposto */}
      <div className="w-full max-w-5xl mx-auto border-t border-slate-900 pt-3 flex flex-wrap justify-between items-center text-[11px] text-slate-500 gap-2 pb-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse" />
          <span>METALRIB PORTAS FRIGORÍFICAS • CHÃO DE FÁBRICA MES</span>
        </div>
        <div>
          <span>Validação Sequencial Ativa • 5 Terminais Interconectados</span>
        </div>
      </div>
    </div>
  );
};
