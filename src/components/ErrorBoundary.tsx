import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, ArrowLeft, Home } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onReset?: () => void;
  showResetButton?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Erro capturado pela barreira de proteção:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      try {
        this.props.onReset();
      } catch (e) {
        console.error('[ErrorBoundary] Erro ao executar onReset:', e);
      }
    }
  };

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const {
        fallbackTitle = 'Ocorreu um erro inesperado',
        fallbackMessage = 'A aplicação encontrou uma falha na renderização deste módulo.',
        showResetButton = true
      } = this.props;

      const errorMessage = this.state.error?.message || 'Erro desconhecido';
      const errorStack = this.state.error?.stack || this.state.errorInfo?.componentStack || '';

      return (
        <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex items-center justify-center p-4 selection:bg-[#1C2F8A] selection:text-white">
          <div className="w-full max-w-lg bg-slate-900 border border-red-500/40 rounded-3xl p-6 md:p-8 shadow-2xl flex flex-col items-center text-center gap-4">
            {/* Ícone de Alerta */}
            <div className="w-16 h-16 rounded-2xl bg-red-950/60 border border-red-500/50 flex items-center justify-center text-red-400 shadow-lg shadow-red-950/50">
              <AlertTriangle className="w-8 h-8" />
            </div>

            {/* Título e Mensagem */}
            <div className="space-y-1.5">
              <h2 className="text-xl md:text-2xl font-black text-white tracking-tight">
                {fallbackTitle}
              </h2>
              <p className="text-xs md:text-sm text-slate-400 max-w-sm mx-auto">
                {fallbackMessage}
              </p>
            </div>

            {/* Detalhe do Erro para Diagnóstico */}
            <div className="w-full bg-slate-950/90 border border-slate-800 rounded-2xl p-3.5 text-left font-mono text-[11px] space-y-2 overflow-hidden">
              <div className="text-red-400 font-bold truncate flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-400 inline-block shrink-0" />
                <span className="truncate">{errorMessage}</span>
              </div>
              {errorStack && (
                <pre className="text-slate-500 text-[10px] max-h-32 overflow-y-auto no-scrollbar whitespace-pre-wrap break-all border-t border-slate-800/80 pt-2">
                  {errorStack.slice(0, 500)}
                </pre>
              )}
            </div>

            {/* Ações de Recuperação */}
            <div className="flex flex-col sm:flex-row gap-2.5 w-full pt-2">
              {showResetButton && (
                <button
                  type="button"
                  onClick={this.handleReset}
                  className="flex-1 py-3 px-4 bg-[#1C2F8A] hover:bg-blue-600 active:scale-95 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 border border-blue-400/40 shadow-lg cursor-pointer transition"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Tentar Novamente</span>
                </button>
              )}

              <button
                type="button"
                onClick={this.handleReload}
                className="flex-1 py-3 px-4 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-bold text-xs rounded-xl flex items-center justify-center gap-2 border border-slate-700 cursor-pointer transition"
              >
                <RefreshCw className="w-4 h-4 text-slate-400" />
                <span>Recarregar Página</span>
              </button>
            </div>

            <div className="text-[10px] text-slate-500 font-mono">
              MES Metalrib · Sistema de Apontamento Industrial
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
