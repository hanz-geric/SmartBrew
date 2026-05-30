import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

interface NetworkContextValue {
  isOnline: boolean;
}

const NetworkContext = createContext<NetworkContextValue>({ isOnline: true });

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const resolvedRef = useRef(false);

  useEffect(() => {
    // One-shot fetch for immediate initial state
    NetInfo.fetch().then((state) => {
      if (!resolvedRef.current) {
        setIsOnline(state.isConnected !== false);
        resolvedRef.current = true;
      }
    });

    const unsubscribe = NetInfo.addEventListener((state) => {
      resolvedRef.current = true;
      // Use isConnected only — isInternetReachable uses a remote probe that
      // can return false/null during startup or on restricted networks, causing
      // false offline detection even when the device has a valid connection.
      setIsOnline(state.isConnected !== false);
    });

    return unsubscribe;
  }, []);

  return (
    <NetworkContext.Provider value={{ isOnline }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork(): NetworkContextValue {
  return useContext(NetworkContext);
}
