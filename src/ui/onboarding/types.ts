export interface BackendDetection {
  installed: boolean;
  authenticated: boolean;
}

export type StepKey = 1 | 2 | 3 | 4 | 5 | 6;

export interface OnboardingState {
  currentStep: StepKey;
  gitDetected: boolean;
  hasCommits: boolean;
  codexStatus: BackendDetection;
  claudeStatus: BackendDetection;
  selectedBackend: 'codex' | 'claude' | null;
  gitInitError: string | null;
  initialized: boolean;
  initError: string | null;
  queuedRequests: string[];
  launchDecision: 'start' | 'exit' | null;
}

export interface WizardCallbacks {
  onGitInit: () => Promise<void>;
  onRunInit: (backend: 'codex' | 'claude') => Promise<void>;
  onQueueRequest: (request: string) => Promise<void>;
  onRedetectBackends: () => Promise<{ codex: BackendDetection; claude: BackendDetection }>;
}
