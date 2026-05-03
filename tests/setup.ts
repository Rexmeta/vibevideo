import 'fake-indexeddb/auto';
import { beforeEach, vi } from 'vitest';

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {}
  // Silence the storageService console noise unless a test opts in.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
