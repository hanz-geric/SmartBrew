import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth, User as FirebaseUser, getAuth, initializeAuth,
  onAuthStateChanged,
  browserLocalPersistence, getReactNativePersistence,
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Firestore, getFirestore, initializeFirestore } from 'firebase/firestore';
import { FirebaseStorage, getStorage } from 'firebase/storage';
import { Platform } from 'react-native';

export const firebaseConfig = {
  apiKey:            'AIzaSyBg5-qNyy7n6YfdJEaWQCLaQhubDsnldEM',
  authDomain:        'smartbrew-pos.firebaseapp.com',
  projectId:         'smartbrew-pos',
  storageBucket:     'smartbrew-pos.firebasestorage.app',
  messagingSenderId: '346008013930',
  appId:             '1:346008013930:web:059f839b3698c304918e13',
};

// Web: localStorage so the session survives browser refresh.
// Native: AsyncStorage so the session survives app restarts and works offline.
const persistence = Platform.OS === 'web'
  ? browserLocalPersistence
  : getReactNativePersistence(AsyncStorage);

// Singleton — safe across React Native hot reloads
const existingApps = getApps();
const isFirstInit   = existingApps.length === 0;

export const app: FirebaseApp = isFirstInit
  ? initializeApp(firebaseConfig)
  : existingApps[0];

export const auth: Auth = isFirstInit
  ? initializeAuth(app, { persistence })
  : getAuth(app);

export const db: Firestore = isFirstInit
  ? initializeFirestore(app, Platform.OS !== 'web'
      ? { experimentalForceLongPolling: true }
      : {})
  : getFirestore(app);

export const storage: FirebaseStorage = getStorage(app);

// Returns the currently signed-in Firebase user, waiting for auth state to
// restore from AsyncStorage if it hasn't done so yet. Safe to call at any time
// including immediately after app launch before onAuthStateChanged has fired.
export function getFirebaseUser(): Promise<FirebaseUser | null> {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}
