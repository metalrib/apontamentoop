import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, set, get, onValue, update, push } from "firebase/database";
import { getFirestore, doc as firestoreDoc, updateDoc, deleteDoc, arrayRemove, setDoc, getDoc, onSnapshot, writeBatch } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCF7Q6J8I6fBZ3kaGbxq4rlefVzFaQrUnA",
  authDomain: "apontamentoop.firebaseapp.com",
  databaseURL: "https://apontamentoop-default-rtdb.firebaseio.com",
  projectId: "apontamentoop",
  storageBucket: "apontamentoop.firebasestorage.app",
  messagingSenderId: "919214258567",
  appId: "1:919214258567:web:fac7d14fb573bda64b3b22"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const db = getDatabase(app);
export const rtdb = db;
export const firestore = getFirestore(app);

// Wrapper resiliente para doc que aceita firestore ou db (caso db seja fornecido)
export const doc = (dbOrFirestore: any, path: string, ...pathSegments: string[]) => {
  const isFirestore = dbOrFirestore && (
    dbOrFirestore === firestore ||
    dbOrFirestore.type === 'firestore' ||
    (typeof dbOrFirestore === 'object' && dbOrFirestore._delegate?.type === 'firestore')
  );
  const target = isFirestore ? dbOrFirestore : firestore;
  return firestoreDoc(target, path, ...pathSegments);
};

export { ref, set, get, onValue, update, push };
export { updateDoc, deleteDoc, arrayRemove, setDoc, getDoc, onSnapshot, writeBatch };
export default db;
