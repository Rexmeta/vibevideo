import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  context: {} as Record<string, any>,
  setStoredMode: vi.fn(),
  getStoredMode: vi.fn(() => null),
}));

vi.mock('../components/wizard/WizardContext', () => ({
  WizardProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useWizard: () => mocks.context,
}));
vi.mock('../components/wizard/QuickMode', () => ({
  QuickMode: ({ expressMode }: { expressMode?: boolean }) => (
    <div>{expressMode ? 'express-quick' : 'quick'}</div>
  ),
}));
vi.mock('../components/wizard/WizardShell', () => ({
  WizardShell: () => <div>pro-shell</div>,
}));
vi.mock('../components/wizard/ModeGate', () => ({
  ModeGate: () => <div>mode-gate</div>,
  getStoredMode: mocks.getStoredMode,
  setStoredMode: mocks.setStoredMode,
}));
vi.mock('../services/sampleProject', () => ({
  isSampleProjectId: (id?: string | null) => id === 'sample-project',
}));

import { ProjectWizard } from '../components/ProjectWizard';

const baseContext = (overrides: Record<string, unknown> = {}) => ({
  loading: false,
  scenes: [],
  maxStep: 1,
  step: 1,
  projectId: 'new-project',
  savedMode: null,
  setSavedMode: vi.fn(),
  restoreError: null,
  restoreSlow: false,
  retryRestore: vi.fn(),
  ...overrides,
});

describe('wizard entry mode characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context = baseContext();
  });

  it('opens a signed-out sample directly in the Pro shell', () => {
    render(<ProjectWizard userId="" initialProjectId="sample-project" onNavigate={vi.fn()} />);
    expect(screen.getByText('pro-shell')).toBeTruthy();
  });

  it('routes Express entry directly into Quick with its preset flag', () => {
    render(<ProjectWizard userId="user" expressMode onNavigate={vi.fn()} />);
    expect(screen.getByText('express-quick')).toBeTruthy();
  });

  it('uses the mode gate for a fresh ordinary project with no saved preference', () => {
    render(<ProjectWizard userId="user" onNavigate={vi.fn()} />);
    expect(screen.getByText('mode-gate')).toBeTruthy();
  });

  it('forces an existing progressed Quick project into Pro after restore', async () => {
    mocks.context = baseContext({
      projectId: 'existing-project',
      loading: true,
      savedMode: 'quick',
    });
    const view = render(
      <ProjectWizard userId="user" initialProjectId="existing-project" onNavigate={vi.fn()} />,
    );
    expect(screen.getByText('프로젝트 로딩 중...')).toBeTruthy();

    mocks.context = baseContext({
      projectId: 'existing-project',
      scenes: [{ scene_number: 1 }],
      step: 4,
      maxStep: 4,
      savedMode: 'quick',
    });
    view.rerender(
      <ProjectWizard userId="user" initialProjectId="existing-project" onNavigate={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText('pro-shell')).toBeTruthy());
    expect(mocks.setStoredMode).toHaveBeenCalledWith('pro', 'existing-project');
  });
});