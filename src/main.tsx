import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary fallbackTitle="Falha no Sistema MES" fallbackMessage="Ocorreu um erro crítico na interface do sistema. Clique abaixo para recarregar ou tentar novamente.">
    <App />
  </ErrorBoundary>
);
