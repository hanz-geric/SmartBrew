import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth, User as FirebaseUser, getAuth, initializeAuth,
  onAuthStateChanged, onIdTokenChanged,
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

// Returns the signed-in Firebase user, waiting for Firebase Auth to restore its
// session after an offline period with an expired token.
//
// The challenge: when the device was offline long enough for the ID token to
// expire, Firebase Auth fires onAuthStateChanged(null) at startup and does NOT
// automatically re-fire when the token is refreshed after network restoration.
// onIdTokenChanged is also unreliable in this scenario for Firebase 12.
//
// Strategy: listen for onIdTokenChanged (fast path if it fires) AND poll
// auth.currentUser every 500 ms (catches silent restores that don't fire events).
// Timeout is 45 s — long enough to cover Firebase's full reconnect backoff
// window (~20–25 s observed in production).
export function getFirebaseUser(timeoutMs = 5_000): Promise<FirebaseUser | null> {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);

  return new Promise((resolve) => {
    let settled = false;

    const finish = (user: FirebaseUser | null) => {
      if (settled) return;
      settled = true;
      eventUnsub();
      clearInterval(pollInterval);
      clearTimeout(timer);
      resolve(user);
    };

    const started = Date.now();

    // Fast path: event fires immediately if auth state is ready
    const eventUnsub = onIdTokenChanged(auth, (user) => {
      if (user) {
        console.log(`[getFirebaseUser] resolved via event after ${Date.now() - started}ms uid=${user.uid}`);
        finish(user);
      }
      // null ignored — Firebase may still be refreshing the token
    });

    // Fallback polling: catches silent token restores that don't fire events
    const pollInterval = setInterval(() => {
      if (auth.currentUser) {
        console.log(`[getFirebaseUser] resolved via poll after ${Date.now() - started}ms uid=${auth.currentUser.uid}`);
        finish(auth.currentUser);
      }
    }, 500);

    // Hard ceiling — if still null after timeoutMs, give up
    const timer = setTimeout(() => finish(auth.currentUser), timeoutMs);
  });
}
