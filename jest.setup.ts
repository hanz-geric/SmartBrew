// ─── Global mocks for the SmartBrew test suite ───────────────────────────────
// Loaded via setupFilesAfterEnv — applied before every test file.

// ── expo-sqlite (pulled in transitively via firestoreService → catalog → schema) ─
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn().mockResolvedValue({
    execAsync:     jest.fn().mockResolvedValue(undefined),
    runAsync:      jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 }),
    getFirstAsync: jest.fn().mockResolvedValue(null),
    getAllAsync:    jest.fn().mockResolvedValue([]),
  }),
}));

// ── AsyncStorage ─────────────────────────────────────────────────────────────
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// ── react-native-get-random-values (polyfill, side-effect import) ─────────────
jest.mock('react-native-get-random-values', () => {});

// ── uuid — deterministic ids in tests ────────────────────────────────────────
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-1234-abcd-efgh'),
}));

// ── Firebase config (exports db / auth / firebaseConfig objects) ──────────────
jest.mock('./src/firebase/config', () => ({
  db: {},
  auth: {
    currentUser: {
      uid: 'test-uid',
      getIdToken: jest.fn().mockResolvedValue('mock-token'),
    },
  },
  firebaseConfig: {
    apiKey: 'test',
    authDomain: 'test',
    projectId: 'test',
    storageBucket: 'test',
    messagingSenderId: 'test',
    appId: 'test',
  },
}));

// ── Firebase Firestore ────────────────────────────────────────────────────────
jest.mock('firebase/firestore', () => ({
  collection: jest.fn((_db, path) => ({ _path: path })),
  doc:        jest.fn((_db, ...segments) => ({ id: segments[segments.length - 1], _path: segments.join('/') })),
  addDoc:     jest.fn().mockResolvedValue({ id: 'new-doc-id' }),
  getDoc:     jest.fn().mockResolvedValue({ exists: () => false, data: () => null, id: '' }),
  getDocs:    jest.fn().mockResolvedValue({ empty: true, docs: [] }),
  setDoc:     jest.fn().mockResolvedValue(undefined),
  updateDoc:  jest.fn().mockResolvedValue(undefined),
  deleteDoc:  jest.fn().mockResolvedValue(undefined),
  query:      jest.fn((...args) => args),
  where:      jest.fn((...args) => args),
  orderBy:    jest.fn((...args) => args),
  limit:      jest.fn((...args) => args),
  increment:  jest.fn((n) => ({ _type: 'increment', n })),
  // arrayUnion stores its args so tests can inspect them
  arrayUnion: jest.fn((...args) => ({ _type: 'arrayUnion', elements: args })),
  writeBatch: jest.fn(() => ({
    set:    jest.fn(),
    update: jest.fn(),
    commit: jest.fn().mockResolvedValue(undefined),
  })),
  getAggregateFromServer: jest.fn(),
  getCountFromServer:     jest.fn(),
  sum:   jest.fn(),
  count: jest.fn(),
  DocumentData: {},
}));

// ── Firebase Auth ─────────────────────────────────────────────────────────────
jest.mock('firebase/auth', () => ({
  signInWithEmailAndPassword:  jest.fn(),
  signOut:                     jest.fn().mockResolvedValue(undefined),
  onAuthStateChanged:          jest.fn(() => () => {}),
  createUserWithEmailAndPassword: jest.fn(),
  getAuth:                     jest.fn(),
}));

jest.mock('firebase/app', () => ({
  initializeApp: jest.fn(() => ({})),
  deleteApp:     jest.fn().mockResolvedValue(undefined),
}));

// ── Firebase auth restore ─────────────────────────────────────────────────────
jest.mock('./src/firebase/authRestore', () => ({
  ensureAuthenticated: jest.fn().mockResolvedValue({
    uid: 'test-uid',
    getIdToken: jest.fn().mockResolvedValue('mock-token'),
  }),
}));

// ── Logger (silence in tests) ─────────────────────────────────────────────────
jest.mock('./src/utils/logger', () => ({
  logError: jest.fn(),
}));

// ── Session cache (default no-op; override per test as needed) ────────────────
// Tests for sessionCache.ts itself do NOT use this mock — they test the real code.
// Tests for firestoreService.ts use this so openSession/closeSession don't hit storage.
jest.mock('./src/db/queries/sessionCache', () => ({
  saveSessionCache:          jest.fn().mockResolvedValue(undefined),
  loadSessionCache:          jest.fn().mockResolvedValue(null),
  clearSessionCache:         jest.fn().mockResolvedValue(undefined),
  openSessionOffline:        jest.fn(),
  savePendingClose:          jest.fn().mockResolvedValue(undefined),
  loadPendingClose:          jest.fn().mockResolvedValue(null),
  clearPendingClose:         jest.fn().mockResolvedValue(undefined),
  savePendingCashierSync:    jest.fn().mockResolvedValue(undefined),
  loadPendingCashierSync:    jest.fn().mockResolvedValue(null),
  clearPendingCashierSync:   jest.fn().mockResolvedValue(undefined),
}));
