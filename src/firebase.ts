import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAJNYyuJlJy-F_CduhRwQM3V5Sm7gWT3qI",
  authDomain: "braindump-a3fd2.firebaseapp.com",
  projectId: "braindump-a3fd2",
  storageBucket: "braindump-a3fd2.firebasestorage.app",
  messagingSenderId: "677572270724",
  appId: "1:677572270724:web:9df58fb5ece7e5e66500d1"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export const loginWithGoogle = () => signInWithPopup(auth, googleProvider);
export const logout = () => signOut(auth);