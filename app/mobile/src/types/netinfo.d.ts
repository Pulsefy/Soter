// Type shim for @react-native-community/netinfo
// Remove this file once the package is fully installed via:
//   npx expo install @react-native-community/netinfo @react-native-async-storage/async-storage

declare module '@react-native-community/netinfo' {
  export interface NetInfoState {
    type: string;
    isConnected: boolean | null;
    isInternetReachable: boolean | null;
    details: unknown;
  }

  type NetInfoChangeHandler = (state: NetInfoState) => void;

  interface NetInfoStatic {
    addEventListener(listener: NetInfoChangeHandler): () => void;
    fetch(): Promise<NetInfoState>;
  }

  const NetInfo: NetInfoStatic;
  export default NetInfo;
}

declare module '@react-native-async-storage/async-storage' {
  interface AsyncStorageStatic {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
    multiRemove(keys: string[]): Promise<void>;
  }

  const AsyncStorage: AsyncStorageStatic;
  export default AsyncStorage;
}
