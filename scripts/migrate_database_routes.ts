import { db, ref, get, update } from '../src/services/firebase';
import { processarRotaProduto } from '../src/utils/nomusParser';

async function migrate() {
  console.log('=== SINCRONIZAÇÃO COMPLETA DAS ROTAS NO REALTIME DATABASE ===\n');

  const ordensRef = ref(db, 'ordens_producao');
  const snapshot = await get(ordensRef);

  if (!snapshot.exists()) {
    console.log('Nenhuma OP encontrada no RTDB.');
    process.exit(0);
  }

  const allOrders = snapshot.val();
  const updates: Record<string, any> = {};
  let totalMigrated = 0;

  for (const key of Object.keys(allOrders)) {
    const op = allOrders[key];
    if (!op || typeof op !== 'object') continue;

    const opNum = (op.op_numero || op.numero || key).trim();
    const rotaInfo = processarRotaProduto(op);
    const etapasAtuaisArr = Array.isArray(op.etapas) ? op.etapas : (typeof op.etapas === 'object' && op.etapas !== null ? Object.keys(op.etapas) : []);
    const semApontamentos = !op.apontamentos || Object.keys(op.apontamentos).length === 0;

    // Se não há apontamentos no chão de fábrica e a rota armazenada é diferente da rota oficial calculada
    const rotasIguais =
      etapasAtuaisArr.length === rotaInfo.rota.length &&
      etapasAtuaisArr.every((s: string, idx: number) => s === rotaInfo.rota[idx]);

    const isTargetOp = opNum.includes('023865') || opNum.includes('024352');

    if (isTargetOp || (semApontamentos && !rotasIguais)) {
      console.log(`[ATUALIZANDO OP ${opNum}] Cód: ${op.codigo || '—'} - ${op.descricao}`);
      console.log(`   Rota no banco:`, etapasAtuaisArr);
      console.log(`   Nova Rota Oficial (${rotaInfo.rota.length} etapas):`, rotaInfo.rota);
      console.log(`   Família: ${rotaInfo.familia}`);

      updates[`ordens_producao/${key}/familia`] = rotaInfo.familia;
      updates[`ordens_producao/${key}/tipoMontagem`] = rotaInfo.tipoMontagem;
      updates[`ordens_producao/${key}/rota`] = rotaInfo.rota;
      updates[`ordens_producao/${key}/etapas`] = rotaInfo.rota;
      updates[`ordens_producao/${key}/etapaAtual`] = rotaInfo.rota[0] || 'Corte';
      updates[`ordens_producao/${key}/statusEtapa`] = `Aguardando Início em: ${rotaInfo.rota[0] || 'Corte'}`;
      updates[`ordens_producao/${key}/status`] = `Aguardando Início em: ${rotaInfo.rota[0] || 'Corte'}`;
      updates[`ordens_producao/${key}/statusAtual`] = rotaInfo.statusAtual;
      totalMigrated++;
    }
  }

  if (Object.keys(updates).length > 0) {
    console.log(`\nGravando ${Object.keys(updates).length} propriedades no Realtime Database...`);
    await update(ref(db), updates);
    console.log(`✅ SUCESSO: ${totalMigrated} Ordens de Produção migradas e sincronizadas com sucesso!`);
  } else {
    console.log('Todas as OPs já estão com as rotas oficiais sincronizadas.');
  }

  process.exit(0);
}

migrate().catch(err => {
  console.error('Erro na migração:', err);
  process.exit(1);
});
