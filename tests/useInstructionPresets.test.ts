import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInstructionPresets } from '../hooks/useInstructionPresets';

const DEFAULT_KEY = 'ai_instruction_presets';

describe('useInstructionPresets – storage key resolution', () => {
  it('uses the default key when no namespace is provided', () => {
    const { result } = renderHook(() => useInstructionPresets());
    act(() => { result.current.addPreset('hello'); });
    expect(localStorage.getItem(DEFAULT_KEY)).toBeTruthy();
  });

  it('uses the default key when namespace is "shared"', () => {
    const { result } = renderHook(() => useInstructionPresets('shared'));
    act(() => { result.current.addPreset('hello'); });
    expect(localStorage.getItem(DEFAULT_KEY)).toBeTruthy();
  });

  it('default namespace and "shared" namespace resolve to the same key', () => {
    const { result: r1 } = renderHook(() => useInstructionPresets());
    const { result: r2 } = renderHook(() => useInstructionPresets('shared'));

    act(() => { r1.current.addPreset('from-default'); });

    // r2 reads from the same key, so it should see the entry after re-rendering
    // via a fresh hook mount that reads localStorage
    const { result: r2fresh } = renderHook(() => useInstructionPresets('shared'));
    expect(r2fresh.current.presets).toContain('from-default');
  });

  it('custom namespace resolves to a distinct key', () => {
    const { result: shared } = renderHook(() => useInstructionPresets());
    const { result: custom } = renderHook(() => useInstructionPresets('scene-42'));

    act(() => { shared.current.addPreset('shared-item'); });
    act(() => { custom.current.addPreset('custom-item'); });

    // Each key should contain only its own entry
    const sharedStored = JSON.parse(localStorage.getItem(DEFAULT_KEY)!);
    const customStored = JSON.parse(localStorage.getItem(`${DEFAULT_KEY}:scene-42`)!);

    expect(sharedStored).toContain('shared-item');
    expect(sharedStored).not.toContain('custom-item');

    expect(customStored).toContain('custom-item');
    expect(customStored).not.toContain('shared-item');
  });
});

describe('useInstructionPresets – addPreset MRU behaviour', () => {
  it('prepends new entries so newest appears first', () => {
    const { result } = renderHook(() => useInstructionPresets());
    act(() => { result.current.addPreset('first'); });
    act(() => { result.current.addPreset('second'); });
    expect(result.current.presets[0]).toBe('second');
    expect(result.current.presets[1]).toBe('first');
  });

  it('moves an existing entry to the front instead of duplicating it', () => {
    const { result } = renderHook(() => useInstructionPresets());
    act(() => { result.current.addPreset('a'); });
    act(() => { result.current.addPreset('b'); });
    act(() => { result.current.addPreset('a'); }); // re-add 'a'

    expect(result.current.presets[0]).toBe('a');
    expect(result.current.presets.filter(p => p === 'a')).toHaveLength(1);
  });

  it('caps the list at 5 entries', () => {
    const { result } = renderHook(() => useInstructionPresets());
    act(() => {
      ['one', 'two', 'three', 'four', 'five', 'six'].forEach(p => {
        result.current.addPreset(p);
      });
    });
    expect(result.current.presets).toHaveLength(5);
    // Oldest entry ('one') should have been dropped
    expect(result.current.presets).not.toContain('one');
    // Newest entry should be first
    expect(result.current.presets[0]).toBe('six');
  });

  it('ignores blank or whitespace-only instructions', () => {
    const { result } = renderHook(() => useInstructionPresets());
    act(() => { result.current.addPreset('  '); });
    act(() => { result.current.addPreset(''); });
    expect(result.current.presets).toHaveLength(0);
  });

  it('persists the updated list to localStorage', () => {
    const { result } = renderHook(() => useInstructionPresets());
    act(() => { result.current.addPreset('persist-me'); });
    const stored = JSON.parse(localStorage.getItem(DEFAULT_KEY)!);
    expect(stored).toContain('persist-me');
  });
});

describe('useInstructionPresets – removePreset', () => {
  it('removes only the targeted entry', () => {
    const { result } = renderHook(() => useInstructionPresets());
    act(() => {
      result.current.addPreset('keep-1');
      result.current.addPreset('remove-me');
      result.current.addPreset('keep-2');
    });
    act(() => { result.current.removePreset('remove-me'); });

    expect(result.current.presets).not.toContain('remove-me');
    expect(result.current.presets).toContain('keep-1');
    expect(result.current.presets).toContain('keep-2');
  });

  it('persists the updated list to localStorage after removal', () => {
    const { result } = renderHook(() => useInstructionPresets());
    act(() => {
      result.current.addPreset('a');
      result.current.addPreset('b');
    });
    act(() => { result.current.removePreset('a'); });

    const stored = JSON.parse(localStorage.getItem(DEFAULT_KEY)!);
    expect(stored).not.toContain('a');
    expect(stored).toContain('b');
  });

  it('is a no-op when the entry is not present', () => {
    const { result } = renderHook(() => useInstructionPresets());
    act(() => { result.current.addPreset('only'); });
    act(() => { result.current.removePreset('nonexistent'); });
    expect(result.current.presets).toEqual(['only']);
  });
});

describe('useInstructionPresets – localStorage error handling', () => {
  it('swallows getItem errors on initial load without throwing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new Error('storage quota exceeded');
    });
    expect(() => renderHook(() => useInstructionPresets())).not.toThrow();
  });

  it('returns empty presets when localStorage contains invalid JSON', () => {
    localStorage.setItem(DEFAULT_KEY, 'not-valid-json{{{');
    const { result } = renderHook(() => useInstructionPresets());
    expect(result.current.presets).toEqual([]);
  });

  it('swallows setItem errors when saving without throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('storage quota exceeded');
    });
    const { result } = renderHook(() => useInstructionPresets());
    expect(() => {
      act(() => { result.current.addPreset('safe'); });
    }).not.toThrow();
  });
});
