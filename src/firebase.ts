import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDfljx3ezdArlK3caby6ZbQr80xQbTlCPI",
  authDomain: "gen-lang-client-0710854390.firebaseapp.com",
  projectId: "gen-lang-client-0710854390",
  storageBucket: "gen-lang-client-0710854390.firebasestorage.app",
  messagingSenderId: "641496296712",
  appId: "1:641496296712:web:b9fa6e1199df9d0dadd0bd"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export { signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged, doc, setDoc, getDoc, collection, getDocs, addDoc, updateDoc, deleteDoc };
