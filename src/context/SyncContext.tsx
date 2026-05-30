import React, { createContext, useContext, useRef } from 'react';

type Listener = () => void;

interface SyncContextValue {
  notifySynced: () => void;
  subscribe: (listener: Listener) => () => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const listeners = useRef<Set<Listener>>(new Set());

  function notifySynced() {
    listeners.current.forEach((l) => l());
  }

  function subscribe(listener: Listener) {
    listeners.current.add(listener);
    return () => listeners.current.delete(listener);
  }

  return (
    <SyncContext.Provider value={{ notifySynced, subscribe }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSyncEvents(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSyncEvents must be used within SyncProvider');
  return ctx;
}
