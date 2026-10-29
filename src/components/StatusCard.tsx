import React from 'react';
import { OpProductionCard } from './OpProductionCard';
import { ProductionOrder, Apontamento } from '../types/mes';
import { obterEtapasDaRota } from '../utils/routeValidation';

export interface StatusCardProps {
  order?: ProductionOrder;
  op?: ProductionOrder;
  apontamentos?: Apontamento[];
  onOpenChat?: (order: ProductionOrder) => void;
  onSelectForTotem?: (opNumero: string) => void;
  onDelete?: (opNumero: string) => void;
}

export const StatusCard: React.FC<StatusCardProps> = ({ op, order, ...rest }) => {
  const targetOp = order || op;
  if (!targetOp) return null;

  // 1. FORÇAR CÁLCULO ATUALIZADO DAS ETAPAS (IGNORANDO DADOS ESTÁTICOS DO BANCO op.etapas)
  const etapasCalculadas = obterEtapasDaRota(targetOp);
  const totalEtapas = etapasCalculadas.length;

  return <OpProductionCard order={targetOp} {...rest} />;
};

export default StatusCard;
