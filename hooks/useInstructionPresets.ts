import { useState, useCallback } from 'react';

const STORAGE_KEY = 'ai_instruction_presets';
const MAX_PRESETS = 5;

function loadPresets(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s: any) => typeof s === 'string' && s.trim()) : [];
  } catch {
    return [];
  }
}

function savePresets(presets: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // ignore storage errors
  }
}

export function useInstructionPresets() {
  const [presets, setPresets] = useState<string[]>(() => loadPresets());

  const addPreset = useCallback((instruction: string) => {
    const trimmed = instruction.trim();
    if (!trimmed) return;
    setPresets(prev => {
      // Move to front if already exists, otherwise prepend; keep max 5
      const without = prev.filter(p => p !== trimmed);
      const next = [trimmed, ...without].slice(0, MAX_PRESETS);
      savePresets(next);
      return next;
    });
  }, []);

  const removePreset = useCallback((instruction: string) => {
    setPresets(prev => {
      const next = prev.filter(p => p !== instruction);
      savePresets(next);
      return next;
    });
  }, []);

  return { presets, addPreset, removePreset };
}
