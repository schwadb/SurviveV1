import React, { createContext, useContext, useCallback, useState } from 'react';
import { useLocalStorage, useSettings } from './useLocalStorage';
import { encryptText, decryptText } from '../services/vault';

export type KeyName = 'perplexityApiKey' | 'numverifyApiKey' | 'aisStreamApiKey' | 'n2yoApiKey';
const KEY_NAMES: KeyName[] = ['perplexityApiKey', 'numverifyApiKey', 'aisStreamApiKey', 'n2yoApiKey'];

interface KeyVaultCtx {
  vaultEnabled: boolean;
  locked: boolean;
  /** The authoritative way to read an API key anywhere in the app. */
  getKey: (name: KeyName) => string;
  enableVault: (passphrase: string) => Promise<void>;
  disableVault: (passphrase: string) => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
  lock: () => void;
}

const Ctx = createContext<KeyVaultCtx | null>(null);

export function KeyVaultProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useSettings();
  const [vaultEnabled, setVaultEnabled] = useLocalStorage<boolean>('watcher-vault-enabled', false);
  const [blob, setBlob] = useLocalStorage<string>('watcher-key-vault', '');
  // In-memory decrypted keys; null = locked (or not yet unlocked). Never persisted plaintext.
  const [memKeys, setMemKeys] = useState<Record<string, string> | null>(null);

  const locked = vaultEnabled && memKeys === null;

  const getKey = useCallback((name: KeyName): string => {
    if (!vaultEnabled) return (settings[name] as string) ?? '';
    if (memKeys) return memKeys[name] ?? '';
    return ''; // enabled but locked
  }, [vaultEnabled, memKeys, settings]);

  const enableVault = useCallback(async (passphrase: string) => {
    const keys: Record<string, string> = {};
    for (const n of KEY_NAMES) keys[n] = (settings[n] as string) ?? '';
    const enc = await encryptText(JSON.stringify(keys), passphrase);
    // Verify the round-trip BEFORE blanking plaintext, so we never lose keys.
    const back = JSON.parse(await decryptText(enc, passphrase));
    if (JSON.stringify(back) !== JSON.stringify(keys)) throw new Error('Vault verification failed');
    setBlob(enc);
    setMemKeys(keys);
    setVaultEnabled(true);
    setSettings((prev) => ({ ...prev, perplexityApiKey: '', numverifyApiKey: '', aisStreamApiKey: '', n2yoApiKey: '' }));
  }, [settings, setBlob, setVaultEnabled, setSettings]);

  const unlock = useCallback(async (passphrase: string) => {
    if (!blob) throw new Error('No vault to unlock');
    const keys = JSON.parse(await decryptText(blob, passphrase));
    setMemKeys(keys);
  }, [blob]);

  const lock = useCallback(() => setMemKeys(null), []);

  const disableVault = useCallback(async (passphrase: string) => {
    const keys = memKeys ?? JSON.parse(await decryptText(blob, passphrase));
    setSettings((prev) => ({ ...prev, ...keys }));
    setBlob('');
    setVaultEnabled(false);
    setMemKeys(null);
  }, [memKeys, blob, setSettings, setBlob, setVaultEnabled]);

  return (
    <Ctx.Provider value={{ vaultEnabled, locked, getKey, enableVault, disableVault, unlock, lock }}>
      {children}
    </Ctx.Provider>
  );
}

export function useKeyVault(): KeyVaultCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useKeyVault must be used within a KeyVaultProvider');
  return c;
}
