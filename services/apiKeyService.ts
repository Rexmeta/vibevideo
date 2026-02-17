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
  } catch (e) {
    console.error('[ApiKeyService] Failed to save provider API key:', e);
  }
}

export function getEffectiveApiKey(modelId: string, provider: string): string | null {
  return getModelApiKey(modelId) || getProviderApiKey(provider) || null;
}
