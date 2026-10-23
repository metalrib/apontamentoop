import React, { useState, useEffect } from 'react';
import { TerminalConfig } from '../types/mes';
import { Volume2, VolumeX, Monitor, Shield, Clock, RefreshCw } from 'lucide-react';
import { isSoundEnabled, setSoundEnabled, playClick } from '../utils/audio';
import { MetalribLogo } from './MetalribLogo';

interface HeaderProps {
  currentTerminal: TerminalConfig | null;
  onSwitchTerminal: () => void;
  onOpenSupervisor: () => void;
  onOpenPcp: () => void;
  onOpenMobile?: () => void;
  onResetScreen: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentTerminal,
  onSwitchTerminal,
  onOpenSupervisor,
  onOpenPcp,
  onOpenMobile,
  onResetScreen
}) => {
  const [time, setTime] = useState<string>('');
  const [date, setDate] = useState<string>('');
  const [sound, setSound] = useState<boolean>(true);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setDate(now.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase());
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    setSoundEnabled(next);
    if (next) playClick();
  };

  return (
    <header className="bg-[#0f1420] border-b border-slate-800 text-white select-none px-3 lg:px-6 py-2 flex items-center justify-between gap-3 shrink-0">
      {/* Brand / Kiosk Identification */}
      <div className="flex items-center gap-3">
        <button
          onClick={onResetScreen}
          title="Voltar ao início do Totem"
          className="flex items-center gap-3 hover:opacity-90 transition-opacity text-left cursor-pointer"
        >
          <MetalribLogo size="sm" />
          <div className="hidden sm:block border-l border-blue-900/80 pl-3">
            <div className="text-xs font-bold tracking-wider text-blue-200 flex items-center gap-2 font-mono">
              <span>CHÃO DE FÁBRICA</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                MES
              </span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono">APONTAMENTO EM TEMPO REAL</div>
          </div>
        </button>
      </div>

      {/* Terminal Físico Ativo */}
      <div className="flex items-center gap-2">
        {currentTerminal ? (
          <div className="flex items-center bg-slate-900 border border-slate-700/80 rounded-xl px-4 py-1.5 gap-3 shadow-inner">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <div>
                <div className="text-xs text-slate-400 font-medium">TERMINAL ATIVO</div>
                <div className="text-sm font-bold text-amber-400 flex items-center gap-2">
                  <span>{currentTerminal.name}</span>
                  <span className="hidden md:inline text-xs text-slate-400 font-normal">
                    ({currentTerminal.label})
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                playClick();
                onSwitchTerminal();
              }}
              className="ml-2 text-xs bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 px-2.5 py-1.5 rounded-lg border border-slate-600 transition flex items-center gap-1 cursor-pointer"
              title="Trocar terminal físico deste computador"
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>Trocar</span>
            </button>
          </div>
        ) : (
          <button
            onClick={onSwitchTerminal}
            className="bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs px-3 py-2 rounded-lg flex items-center gap-1.5 transition active:scale-95"
          >
            <Monitor className="w-4 h-4" />
            <span>Selecionar Terminal Físico</span>
          </button>
        )}
      </div>

      {/* Relógio e Ações Rápidas */}
      <div className="flex items-center gap-3">
        {/* Relógio em tempo real */}
        <div className="hidden sm:flex flex-col items-end font-mono">
          <div className="text-xs text-slate-400 flex items-center gap-1">
            <Clock className="w-3 h-3 text-slate-500" />
            <span>{date}</span>
          </div>
          <div className="text-base font-bold text-slate-100 tracking-wider font-mono-num">
            {time}
          </div>
        </div>

        {/* Som do Leitor */}
        <button
          onClick={toggleSound}
          className={`p-2.5 rounded-xl border transition cursor-pointer ${
            sound
              ? 'bg-slate-800 border-slate-700 text-emerald-400 hover:bg-slate-750'
              : 'bg-slate-900 border-slate-800 text-slate-500 hover:bg-slate-800'
          }`}
          title={sound ? 'Som do Leitor/Ações Ativado' : 'Som Desativado'}
        >
          {sound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>

        {/* Limpar e Voltar para Início */}
        <button
          onClick={() => {
            playClick();
            onResetScreen();
          }}
          className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition cursor-pointer active:scale-95"
          title="Limpar tela e voltar ao leitor de OP"
        >
          <RefreshCw className="w-4 h-4" />
        </button>

        {/* Botão de Atalho Rápido para Consulta Mobile */}
        {onOpenMobile && (
          <button
            onClick={() => {
              playClick();
              onOpenMobile();
            }}
            className="px-3 py-1.5 rounded-lg bg-sky-950/60 hover:bg-sky-900 border border-sky-500/50 text-sky-300 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer active:scale-95 shadow-sm"
            title="Abrir tela de Consulta Rápida Mobile / Rastreio"
          >
            <span>📱 Consulta Mobile</span>
          </button>
        )}

        {/* Botão de Atalho Rápido para o Painel TV / Status HTML */}
        <button
          onClick={() => {
            playClick();
            onOpenPcp();
          }}
          className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/60 text-amber-300 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer active:scale-95 shadow-sm"
          title="Ver Status de Produção / Painel TV Andon (HTML)"
        >
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <span>Status TV</span>
        </button>

        {/* Botão de Acesso ao Portal PCP / Coordenação */}
        <button
          onClick={() => {
            playClick();
            onOpenPcp();
          }}
          className="px-4 py-2 rounded-xl bg-[#1C2F8A] hover:bg-blue-600 border border-blue-400 text-white text-xs font-bold flex items-center gap-2 transition cursor-pointer active:scale-95 shadow-md"
          title="Acessar Portal do PCP e Coordenação Industrial"
        >
          <Shield className="w-4 h-4 text-blue-200" />
          <span>Portal PCP</span>
        </button>
      </div>
    </header>
  );
};
