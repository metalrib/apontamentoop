import { firestore, db, doc, getDoc, ref, get } from '../src/services/firebase';
import { collection, getDocs, updateDoc, setDoc } from 'firebase/firestore';

async function check() {
  try {
    console.log('--- Checking Firestore collections ---');
    const colRef = collection(firestore, 'ordens_producao');
    const snap = await getDocs(colRef);
    console.log('Total OPs in Firestore ordens_producao:', snap.size);
    snap.forEach(d => {
      const data = d.data();
      const id = d.id;
      if (id.includes('023865') || id.includes('024352') || (data.codigo && (data.codigo.includes('005.0149') || data.codigo.includes('003.0140')))) {
        console.log(`\n[Firestore Doc: ${id}]`);
        console.log(`  Codigo:`, data.codigo);
        console.log(`  Descricao:`, data.descricao);
        console.log(`  Familia:`, data.familia);
        console.log(`  Etapas:`, data.etapas);
        console.log(`  Rota:`, data.rota);
        console.log(`  StatusEtapa:`, data.statusEtapa);
        console.log(`  Status:`, data.status);
        console.log(`  StatusAtual:`, data.statusAtual);
        console.log(`  Apontamentos count:`, Object.keys(data.apontamentos || {}).length);
      }
    });

    console.log('\n--- Checking RTDB ---');
    const rtdbSnap = await get(ref(db, 'ordens_producao'));
    if (rtdbSnap.exists()) {
      const allRtdb = rtdbSnap.val();
      console.log('Total OPs in RTDB ordens_producao:', Object.keys(allRtdb).length);
      Object.keys(allRtdb).forEach(k => {
        const item = allRtdb[k];
        if (k.includes('023865') || k.includes('024352') || (item.codigo && (item.codigo.includes('005.0149') || item.codigo.includes('003.0140')))) {
          console.log(`\n[RTDB Key: ${k}]`);
          console.log(`  Codigo:`, item.codigo);
          console.log(`  Descricao:`, item.descricao);
          console.log(`  Familia:`, item.familia);
          console.log(`  Etapas:`, item.etapas);
          console.log(`  Rota:`, item.rota);
          console.log(`  StatusEtapa:`, item.statusEtapa);
          console.log(`  Status:`, item.status);
          console.log(`  StatusAtual:`, item.statusAtual);
        }
      });
    } else {
      console.log('RTDB ordens_producao is empty');
    }
  } catch (e) {
    console.error('Error querying DB:', e);
  } finally {
    process.exit(0);
  }
}

check();
