import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css'; // Sesuaikan dengan file CSS kamu

// Import Firebase Auth yang sudah kamu buat
import { auth, loginWithGoogle } from './src/firebase'; 
import { onAuthStateChanged, User } from 'firebase/auth';

const AuthWrapper: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 1. Jika masih loading cek status
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-white">
        <p>Loading Auth...</p>
      </div>
    );
  }

  // 2. Jika belum login, tampilkan tombol login
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen text-white">
        <h1 className="text-2xl font-bold mb-4">Brain Dump App</h1>
        <button 
          onClick={loginWithGoogle} 
          className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-bold transition-all"
        >
          Login with Google
        </button>
      </div>
    );
  }

  // 3. Jika sudah login, jalankan App utama dan lempar data user-nya
  return <App user={user} />;
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AuthWrapper />
  </React.StrictMode>
);