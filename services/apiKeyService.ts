const STORAGE_KEY = 'vibe_model_api_keys';
const ENDPOINT_KEY = 'vibe_model_endpoints';

interface ApiKeyStore {
  [modelId: string]: string;
}

export function getModelApiKey(modelId: string): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const store: ApiKeyStore = raw ? JSON.parse(raw) : {};
    return store[modelId] || null;
  } catch {
    return null;
  }
}

export function setModelApiKey(modelId: string, apiKey: string): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const store: ApiKeyStore = raw ? JSON.parse(raw) : {};
    if (apiKey.trim()) {
      store[modelId] = apiKey.trim();
    } else {
      delete store[modelId];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    notifyApiKeyChange();
  } catch (e) {
    console.error('[ApiKeyService] Failed to save API key:', e);
  }
}

export function removeModelApiKey(modelId: string): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const store: ApiKeyStore = raw ? JSON.parse(raw) : {};
    delete store[modelId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    notifyApiKeyChange();
  } catch {}
}

export function getModelEndpoint(modelId: string): string | null {
  try {
    const raw = localStorage.getItem(ENDPOINT_KEY);
    const store: ApiKeyStore = raw ? JSON.parse(raw) : {};
    return store[modelId] || null;
  } catch {
    return null;
  }
}

export function setModelEndpoint(modelId: string, endpoint: string): void {
  try {
    const raw = localStorage.getItem(ENDPOINT_KEY);
    const store: ApiKeyStore = raw ? JSON.parse(raw) : {};
    if (endpoint.trim()) {
      store[modelId] = endpoint.trim();
    } else {
      delete store[modelId];
    }
    localStorage.setItem(ENDPOINT_KEY, JSON.stringify(store));
    notifyApiKeyChange();
  } catch (e) {
    console.error('[ApiKeyService] Failed to save endpoint:', e);
  }
}

export function hasModelApiKey(modelId: string): boolean {
  return !!getModelApiKey(modelId);
}

export function getProviderApiKey(provider: string): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const store: ApiKeyStore = raw ? JSON.parse(raw) : {};
    return store[`provider_${provider}`] || null;
  } catch {
    return null;
  }
}

export function setProviderApiKey(provider: string, apiKey: string): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const store: ApiKeyStore = raw ? JSON.parse(raw) : {};
    if (apiKey.trim()) {
      store[`provider_${provider}`] = apiKey.trim();
    } else {
      delete store[`provider_${provider}`];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    notifyApiKeyChange();
  } catch (e) {
    console.error('[ApiKeyService] Failed to save provider API key:', e);
  }
}

export function getEffectiveApiKey(modelId: string, provider: string): string | null {
  return getModelApiKey(modelId) || getProviderApiKey(provider) || null;
}

const GOOGLE_PROVIDERS = ['Google', 'NanoBanana'];
const MODELS_STORAGE_KEY = 'vibe_ai_models';
export const API_KEY_CHANGE_EVENT = 'vibe:apikey-change';

function notifyApiKeyChange(): void {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(API_KEY_CHANGE_EVENT));
    }
  } catch {}
}

function readEnvApiKey(): string {
  try {
    const key = process.env.API_KEY;
    return typeof key === 'string' ? key : '';
  } catch {
    return '';
  }
}

function readStore(): ApiKeyStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function readGoogleModelIdentifiers(): string[] {
  try {
    const raw = localStorage.getItem(MODELS_STORAGE_KEY);
    if (!raw) return [];
    const models = JSON.parse(raw);
    if (!Array.isArray(models)) return [];
    const ids: string[] = [];
    for (const m of models) {
      if (m && typeof m === 'object' && GOOGLE_PROVIDERS.includes(m.provider)) {
        if (typeof m.id === 'string' && m.id) ids.push(m.id);
        if (typeof m.modelId === 'string' && m.modelId) ids.push(m.modelId);
      }
    }
    return ids;
  } catch {
    return [];
  }
}

function findStoredGoogleModelKey(): string {
  const store = readStore();
  const ids = readGoogleModelIdentifiers();
  for (const id of ids) {
    const v = store[id];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

export function getGoogleApiKey(): string {
  for (const provider of GOOGLE_PROVIDERS) {
    const k = getProviderApiKey(provider);
    if (k && k.trim()) return k.trim();
  }
  const env = readEnvApiKey();
  if (env && env.trim()) return env.trim();
  const modelKey = findStoredGoogleModelKey();
  if (modelKey) return modelKey;
  return '';
}

export function hasAnyGoogleApiKey(): boolean {
  return !!getGoogleApiKey();
}

export type GoogleApiKeySource = 'provider' | 'env' | 'model' | 'none';

export function getGoogleApiKeySource(): GoogleApiKeySource {
  for (const provider of GOOGLE_PROVIDERS) {
    const k = getProviderApiKey(provider);
    if (k && k.trim()) return 'provider';
  }
  const env = readEnvApiKey();
  if (env && env.trim()) return 'env';
  const modelKey = findStoredGoogleModelKey();
  if (modelKey) return 'model';
  return 'none';
}
