import { initializeApp, getApps } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

export const firebaseConfig = {
  apiKey:            'AIzaSyBg5-qNyy7n6YfdJEaWQCLaQhubDsnldEM',
  authDomain:        'smartbrew-pos.firebaseapp.com',
  projectId:         'smartbrew-pos',
  storageBucket:     'smartbrew-pos.firebasestorage.app',
  messagingSenderId: '346008013930',
  appId:             '1:346008013930:web:059f839b3698c304918e13',
}

export const app     = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]
export const auth    = getAuth(app)
export const db      = getFirestore(app)
export const storage = getStorage(app)
