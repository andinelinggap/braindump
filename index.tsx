import React, { useEffect, useState } from 'react';
import { auth, loginWithGoogle } from './src/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import App from './App';

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

  if (loading) return <div>Loading Auth...</div>;

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <h1 className="text-2xl mb-4">Brain Dump App</h1>
        <button onClick={loginWithGoogle} className="px-4 py-2 bg-blue-500 text-white rounded">
          Login with Google
        </button>
      </div>
    );
  }

  // Pass user ke App jika butuh ID-nya untuk fetch data
  return <App user={user} />;
};

export default AuthWrapper;