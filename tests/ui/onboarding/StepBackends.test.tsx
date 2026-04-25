import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { ThemeContext, catppuccinMocha } from '../../../src/ui/theme.js';
import { StepBackends } from '../../../src/ui/onboarding/StepBackends.js';
import type { BackendDetection } from '../../../src/ui/onboarding/types.js';

const renderWithTheme = (el: React.ReactElement) =>
  render(<ThemeContext.Provider value={catppuccinMocha}>{el}</ThemeContext.Provider>);

const waitForMount = () => new Promise<void>((r) => setTimeout(r, 50));
const waitForUpdate = () => new Promise<void>((r) => setTimeout(r, 50));

// Helper factory for onRedetectBackends mock
const makeRedetect = (
  codex: BackendDetection,
  claude: BackendDetection,
) =>
  vi.fn().mockResolvedValue({ codex, claude });

const bothAuthedStatus: BackendDetection = { installed: true, authenticated: true };
const neitherAuthedStatus: BackendDetection = { installed: true, authenticated: false };
const notInstalledStatus: BackendDetection = { installed: false, authenticated: false };

// Prop sets for the three main scenarios
const bothAuthedProps = {
  codexStatus: bothAuthedStatus,
  claudeStatus: bothAuthedStatus,
  onAdvance: vi.fn(),
  onBack: vi.fn(),
  onExit: vi.fn(),
  onRedetectBackends: makeRedetect(bothAuthedStatus, bothAuthedStatus),
};

const codexOnlyProps = {
  codexStatus: bothAuthedStatus,
  claudeStatus: neitherAuthedStatus,
  onAdvance: vi.fn(),
  onBack: vi.fn(),
  onExit: vi.fn(),
  onRedetectBackends: makeRedetect(bothAuthedStatus, neitherAuthedStatus),
};

const claudeOnlyProps = {
  codexStatus: neitherAuthedStatus,
  claudeStatus: bothAuthedStatus,
  onAdvance: vi.fn(),
  onBack: vi.fn(),
  onExit: vi.fn(),
  onRedetectBackends: makeRedetect(neitherAuthedStatus, bothAuthedStatus),
};

const neitherAuthedProps = {
  codexStatus: neitherAuthedStatus,
  claudeStatus: neitherAuthedStatus,
  onAdvance: vi.fn(),
  onBack: vi.fn(),
  onExit: vi.fn(),
  onRedetectBackends: makeRedetect(neitherAuthedStatus, neitherAuthedStatus),
};

const neitherInstalledProps = {
  codexStatus: notInstalledStatus,
  claudeStatus: notInstalledStatus,
  onAdvance: vi.fn(),
  onBack: vi.fn(),
  onExit: vi.fn(),
  onRedetectBackends: makeRedetect(notInstalledStatus, notInstalledStatus),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StepBackends', () => {
  describe('both authenticated', () => {
    it('renders backend detection results for codex and claude', async () => {
      const props = {
        ...bothAuthedProps,
        onAdvance: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends: makeRedetect(bothAuthedStatus, bothAuthedStatus),
      };
      const { lastFrame } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      const frame = lastFrame() ?? '';
      expect(frame).toContain('codex');
      expect(frame).toContain('claude');
    });

    it('renders SelectInput with Codex and Claude options when both are authenticated', async () => {
      const props = {
        ...bothAuthedProps,
        onAdvance: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends: makeRedetect(bothAuthedStatus, bothAuthedStatus),
      };
      const { lastFrame } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Codex');
      expect(frame).toContain('Claude');
      // SelectInput shows › indicator
      expect(frame).toContain('›');
    });

    it('renders footer with select, confirm, back, and quit keys when both authed', async () => {
      const props = {
        ...bothAuthedProps,
        onAdvance: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends: makeRedetect(bothAuthedStatus, bothAuthedStatus),
      };
      const { lastFrame } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      const frame = lastFrame() ?? '';
      expect(frame).toContain('↑↓ select');
      expect(frame).toContain('Enter confirm');
      expect(frame).toContain('R retry');
      expect(frame).toContain('← back');
      expect(frame).toContain('Esc quit');
    });

    it('calls onAdvance with "codex" when Codex is selected via Enter', async () => {
      const onAdvance = vi.fn();
      const props = {
        codexStatus: bothAuthedStatus,
        claudeStatus: bothAuthedStatus,
        onAdvance,
        onBack: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends: makeRedetect(bothAuthedStatus, bothAuthedStatus),
      };
      const { stdin } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      stdin.write('\r'); // confirm first option (Codex)
      await waitForUpdate();
      stdin.write('\r'); // confirm default codex model
      await waitForUpdate();
      stdin.write('\r'); // confirm default codex effort
      await waitForUpdate();
      expect(onAdvance).toHaveBeenCalledWith({
        backend: 'codex',
        model: 'gpt-5.5',
        effort: 'medium'
      });
    });

    it('calls onAdvance with "claude" when Claude is selected via Enter', async () => {
      const onAdvance = vi.fn();
      const props = {
        codexStatus: bothAuthedStatus,
        claudeStatus: bothAuthedStatus,
        onAdvance,
        onBack: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends: makeRedetect(bothAuthedStatus, bothAuthedStatus),
      };
      const { stdin } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      stdin.write('\u001B[B'); // down arrow to Claude
      await waitForUpdate();
      stdin.write('\r'); // confirm
      await waitForUpdate();
      stdin.write('\r'); // confirm default claude model
      await waitForUpdate();
      stdin.write('\r'); // confirm default claude effort
      await waitForUpdate();
      expect(onAdvance).toHaveBeenCalledWith({
        backend: 'claude',
        model: 'claude-sonnet-4-6',
        effort: 'medium'
      });
    });

    it('calls onExit when Esc is pressed in select mode', async () => {
      const onExit = vi.fn();
      const props = {
        codexStatus: bothAuthedStatus,
        claudeStatus: bothAuthedStatus,
        onAdvance: vi.fn(),
        onBack: vi.fn(),
        onExit,
        onRedetectBackends: makeRedetect(bothAuthedStatus, bothAuthedStatus),
      };
      const { stdin } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      stdin.write('\u001B'); // Esc
      await waitForUpdate();
      expect(onExit).toHaveBeenCalledOnce();
    });

    it('shows ✓ green indicator for each authenticated backend', async () => {
      const props = {
        ...bothAuthedProps,
        onAdvance: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends: makeRedetect(bothAuthedStatus, bothAuthedStatus),
      };
      const { lastFrame } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      const frame = lastFrame() ?? '';
      expect(frame).toContain('✓');
    });
  });

  describe('one authenticated (auto-select)', () => {
    it('shows auto-select message when only codex is authenticated', async () => {
      const props = {
        ...codexOnlyProps,
        onAdvance: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends: makeRedetect(bothAuthedStatus, neitherAuthedStatus),
      };
      const { lastFrame } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      const frame = lastFrame() ?? '';
      expect(frame).toContain('codex');
      // Should not show SelectInput (no › for backend selection)
      expect(frame).not.toContain('Choose your default backend');
    });

    it('shows auto-select message when only claude is authenticated', async () => {
      const props = {
        ...claudeOnlyProps,
        onAdvance: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends: makeRedetect(neitherAuthedStatus, bothAuthedStatus),
      };
      const { lastFrame } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      const frame = lastFrame() ?? '';
      expect(frame).toContain('claude');
      expect(frame).not.toContain('Choose your default backend');
    });

    it('renders footer with continue, back, and quit in auto-select mode', async () => {
      const props = {
        ...codexOnlyProps,
        onAdvance: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends: makeRedetect(bothAuthedStatus, neitherAuthedStatus),
      };
      const { lastFrame } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Enter continue');
      expect(frame).toContain('R retry');
      expect(frame).toContain('← back');
      expect(frame).toContain('Esc quit');
      expect(frame).not.toContain('↑↓ select');
    });

    it('calls onAdvance with "codex" when Enter is pressed and codex is auto-selected', async () => {
      const onAdvance = vi.fn();
      const props = {
        codexStatus: bothAuthedStatus,
        claudeStatus: neitherAuthedStatus,
        onAdvance,
        onBack: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends: makeRedetect(bothAuthedStatus, neitherAuthedStatus),
      };
      const { stdin } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      stdin.write('\r');
      await waitForUpdate();
      stdin.write('\r');
      await waitForUpdate();
      stdin.write('\r');
      await waitForUpdate();
      expect(onAdvance).toHaveBeenCalledWith({
        backend: 'codex',
        model: 'gpt-5.5',
        effort: 'medium'
      });
    });

    it('calls onAdvance with "claude" when Enter is pressed and claude is auto-selected', async () => {
      const onAdvance = vi.fn();
      const props = {
        codexStatus: neitherAuthedStatus,
        claudeStatus: bothAuthedStatus,
        onAdvance,
        onBack: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends: makeRedetect(neitherAuthedStatus, bothAuthedStatus),
      };
      const { stdin } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      stdin.write('\r');
      await waitForUpdate();
      stdin.write('\r');
      await waitForUpdate();
      stdin.write('\r');
      await waitForUpdate();
      expect(onAdvance).toHaveBeenCalledWith({
        backend: 'claude',
        model: 'claude-sonnet-4-6',
        effort: 'medium'
      });
    });

    it('shows ! yellow indicator for installed-but-not-authed backend', async () => {
      const props = {
        ...codexOnlyProps,
        onAdvance: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends: makeRedetect(bothAuthedStatus, neitherAuthedStatus),
      };
      const { lastFrame } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      const frame = lastFrame() ?? '';
      // claude is installed but not authed — shows !
      expect(frame).toContain('!');
    });

    it('calls onExit when Esc is pressed in auto-select mode', async () => {
      const onExit = vi.fn();
      const props = {
        codexStatus: bothAuthedStatus,
        claudeStatus: neitherAuthedStatus,
        onAdvance: vi.fn(),
        onBack: vi.fn(),
        onExit,
        onRedetectBackends: makeRedetect(bothAuthedStatus, neitherAuthedStatus),
      };
      const { stdin } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      stdin.write('\u001B'); // Esc
      await waitForUpdate();
      expect(onExit).toHaveBeenCalledOnce();
    });
  });

  describe('neither authenticated error state', () => {
    it('shows "No backends authenticated" when both installed but not authed', async () => {
      const props = {
        ...neitherAuthedProps,
        onAdvance: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends: makeRedetect(neitherAuthedStatus, neitherAuthedStatus),
      };
      const { lastFrame } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      const frame = lastFrame() ?? '';
      expect(frame).toContain('No backends authenticated');
    });

    it('shows auth commands when both installed but not authed', async () => {
      const props = {
        ...neitherAuthedProps,
        onAdvance: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends: makeRedetect(neitherAuthedStatus, neitherAuthedStatus),
      };
      const { lastFrame } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      const frame = lastFrame() ?? '';
      expect(frame).toContain('codex login');
      expect(frame).toContain('claude auth login');
    });

    it('shows retry guidance after authenticating in error state', async () => {
      const props = {
        ...neitherAuthedProps,
        onAdvance: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends: makeRedetect(neitherAuthedStatus, neitherAuthedStatus),
      };
      const { lastFrame } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Press R to retry');
      expect(frame).toContain('authenticating');
    });

    it('renders footer with retry and Esc quit in error state', async () => {
      const props = {
        ...neitherAuthedProps,
        onAdvance: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends: makeRedetect(neitherAuthedStatus, neitherAuthedStatus),
      };
      const { lastFrame } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      const frame = lastFrame() ?? '';
      expect(frame).toContain('R retry');
      expect(frame).toContain('Esc quit');
      expect(frame).not.toContain('Enter');
      expect(frame).not.toContain('← back');
    });

    it('calls onExit when Esc is pressed in error state', async () => {
      const onExit = vi.fn();
      const props = {
        codexStatus: neitherAuthedStatus,
        claudeStatus: neitherAuthedStatus,
        onAdvance: vi.fn(),
        onBack: vi.fn(),
        onExit,
        onRedetectBackends: makeRedetect(neitherAuthedStatus, neitherAuthedStatus),
      };
      const { stdin } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      stdin.write('\u001B'); // Esc
      await waitForUpdate();
      expect(onExit).toHaveBeenCalledOnce();
    });
  });

  describe('neither installed error state', () => {
    it('shows "No backends available" when neither is installed', async () => {
      const props = {
        ...neitherInstalledProps,
        onAdvance: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends: makeRedetect(notInstalledStatus, notInstalledStatus),
      };
      const { lastFrame } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      const frame = lastFrame() ?? '';
      expect(frame).toContain('No backends available');
    });

    it('shows install commands when neither is installed', async () => {
      const props = {
        ...neitherInstalledProps,
        onAdvance: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends: makeRedetect(notInstalledStatus, notInstalledStatus),
      };
      const { lastFrame } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      const frame = lastFrame() ?? '';
      expect(frame).toContain('npm install -g @openai/codex');
      expect(frame).toContain('npm install -g @anthropic-ai/claude-code');
    });

    it('shows ✗ red indicator for not-installed backend', async () => {
      const props = {
        ...neitherInstalledProps,
        onAdvance: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends: makeRedetect(notInstalledStatus, notInstalledStatus),
      };
      const { lastFrame } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      const frame = lastFrame() ?? '';
      expect(frame).toContain('✗');
    });

    it('renders footer with retry and Esc quit when neither installed', async () => {
      const props = {
        ...neitherInstalledProps,
        onAdvance: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends: makeRedetect(notInstalledStatus, notInstalledStatus),
      };
      const { lastFrame } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      const frame = lastFrame() ?? '';
      expect(frame).toContain('R retry');
      expect(frame).toContain('Esc quit');
      expect(frame).not.toContain('Enter');
      expect(frame).not.toContain('← back');
    });

    it('shows retry guidance after installing backends', async () => {
      const props = {
        ...neitherInstalledProps,
        onAdvance: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends: makeRedetect(notInstalledStatus, notInstalledStatus),
      };
      const { lastFrame } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Press R to retry');
      expect(frame).toContain('installing');
    });
  });

  describe('onRedetectBackends on mount', () => {
    it('calls onRedetectBackends on mount', async () => {
      const onRedetectBackends = makeRedetect(bothAuthedStatus, bothAuthedStatus);
      const props = {
        codexStatus: bothAuthedStatus,
        claudeStatus: bothAuthedStatus,
        onAdvance: vi.fn(),
        onBack: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends,
      };
      renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      expect(onRedetectBackends).toHaveBeenCalledOnce();
    });

    it('updates display when redetect returns different results', async () => {
      // Start with neither authed, but redetect returns both authed
      const onRedetectBackends = makeRedetect(bothAuthedStatus, bothAuthedStatus);
      const props = {
        codexStatus: neitherAuthedStatus,
        claudeStatus: neitherAuthedStatus,
        onAdvance: vi.fn(),
        onBack: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends,
      };
      const { lastFrame } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();
      // After redetect resolves, should show select mode (both authed)
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Codex');
      expect(frame).toContain('Claude');
      expect(frame).toContain('›');
    });

    it('retries backend detection when r is pressed', async () => {
      const onRedetectBackends = vi
        .fn()
        .mockResolvedValueOnce({
          codex: neitherAuthedStatus,
          claude: neitherAuthedStatus
        })
        .mockResolvedValueOnce({
          codex: bothAuthedStatus,
          claude: bothAuthedStatus
        });
      const props = {
        codexStatus: neitherAuthedStatus,
        claudeStatus: neitherAuthedStatus,
        onAdvance: vi.fn(),
        onBack: vi.fn(),
        onExit: vi.fn(),
        onRedetectBackends,
      };
      const { stdin, lastFrame } = renderWithTheme(<StepBackends {...props} />);
      await waitForMount();

      stdin.write('r');
      await waitForUpdate();
      await waitForUpdate();

      const frame = lastFrame() ?? '';
      expect(onRedetectBackends).toHaveBeenCalledTimes(2);
      expect(frame).toContain('Codex');
      expect(frame).toContain('Claude');
      expect(frame).toContain('›');
    });
  });
});
