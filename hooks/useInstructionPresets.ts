import { useState, useCallback } from 'react';

const DEFAULT_STORAGE_KEY = 'ai_instruction_presets';
const MAX_PRESETS = 5;

/**
 * Namespace options for useInstructionPresets.
 *
 * - `undefined` / omitted → uses the shared default key (`ai_instruction_presets`),
 *   so the bulk bar and per-scene modal see the same history (current behaviour).
 * - `'shared'` → explicitly opts in to the shared list (same as default).
 * - Any other string → opts in to a separate, namespaced list stored under
 *   `ai_instruction_presets:<namespace>`.
 */
export type InstructionPresetsNamespace = 'shared' | (string & {});

function storageKey(namespace?: InstructionPresetsNamespace): string {
  if (!namespace || namespace === 'shared') return DEFAULT_STORAGE_KEY;
  return `${DEFAULT_STORAGE_KEY}:${namespace}`;
}

function loadPresets(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s: any) => typeof s === 'string' && s.trim()) : [];
  } catch {
    return [];
  }
}

function savePresets(key: string, presets: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(presets));
  } catch {
    // ignore storage errors
  }
}

/**
 * Manages a small MRU list of AI instruction presets backed by localStorage.
 *
 * @param namespace
 *   Controls which localStorage key is used.
 *   - Omit (or pass `'shared'`) to use the shared list — this is the default and
 *     keeps the bulk bar and per-scene modal in sync.
 *   - Pass any other string to use a separate, isolated list.
 */
export function useInstructionPresets(namespace?: InstructionPresetsNamespace) {
  const key = storageKey(namespace);
  const [presets, setPresets] = useState<string[]>(() => loadPresets(key));

  const addPreset = useCallback((instruction: string) => {
    const trimmed = instruction.trim();
    if (!trimmed) return;
    setPresets(prev => {
      // Move to front if already exists, otherwise prepend; keep max 5
      const without = prev.filter(p => p !== trimmed);
      const next = [trimmed, ...without].slice(0, MAX_PRESETS);
      savePresets(key, next);
      return next;
    });
  }, [key]);

  const removePreset = useCallback((instruction: string) => {
    setPresets(prev => {
      const next = prev.filter(p => p !== instruction);
      savePresets(key, next);
      return next;
    });
  }, [key]);

  return { presets, addPreset, removePreset };
}
