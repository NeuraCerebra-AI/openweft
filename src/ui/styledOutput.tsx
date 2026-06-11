import React from 'react';
import { render, Text } from 'ink';

import { ThemeContext, catppuccinMocha } from './theme.js';
import { StyledCard } from './StyledCard.js';

export const renderStyledOutput = async (element: React.ReactElement): Promise<void> => {
  const instance = render(
    <ThemeContext.Provider value={catppuccinMocha}>
      {element}
    </ThemeContext.Provider>
  );
  const exitPromise = instance.waitUntilExit();
  queueMicrotask(() => {
    instance.unmount();
  });
  await exitPromise;
};

interface StatusCardProps {
  readonly appName: string;
  readonly health?: string;
  readonly meaning?: string;
  readonly nextAction?: string;
  readonly phase: string;
  readonly usageLabel: string;
  readonly usageValue: string;
  readonly agents: readonly { name: string; status: string }[];
  readonly pendingRequests?: readonly string[];
  readonly checkpointSource?: 'primary' | 'backup' | 'none';
  readonly diagnosticLines?: readonly string[];
}

const getStatusRowStyle = (
  status: string,
  colors: typeof catppuccinMocha.colors
): { icon: string; color: string; label: string | null } => {
  if (status === 'running' || status === 'executing') {
    return { icon: '●', color: colors.blue, label: null };
  }

  if (status === 'failed' || status === 'fatal') {
    return { icon: '✗', color: colors.red, label: 'failed' };
  }

  if (status === 'planning-needs-review' || status === 'adjustment-needs-review' || status === 'review') {
    return { icon: '!', color: colors.yellow, label: 'review' };
  }

  if (status === 'blocked-by-failed-feature' || status === 'blocked') {
    return { icon: '!', color: colors.yellow, label: 'blocked' };
  }

  if (status === 'queued' || status === 'planned' || status === 'pending') {
    return { icon: '○', color: colors.subtext, label: null };
  }

  return { icon: '✓', color: colors.green, label: null };
};

export const StatusCard: React.FC<StatusCardProps> = ({
  appName,
  health,
  meaning,
  nextAction,
  phase,
  usageLabel,
  usageValue,
  agents,
  pendingRequests = [],
  checkpointSource,
  diagnosticLines = []
}) => {
  const colors = catppuccinMocha.colors;
  return (
    <StyledCard borderColor={colors.blue}>
      <Text bold color={colors.blue}>{appName}</Text>
      {health !== undefined && <Text bold>{`Health: ${health}`}</Text>}
      {meaning !== undefined && <Text color={colors.subtext}>{`Meaning: ${meaning}`}</Text>}
      {nextAction !== undefined && <Text color={colors.green}>{`Next Action: ${nextAction}`}</Text>}
      <Text color={colors.subtext}>{`Phase: ${phase}  ${usageLabel}: ${usageValue}`}</Text>
      {checkpointSource === 'backup' && (
        <Text color={colors.yellow}>Checkpoint source: backup</Text>
      )}
      {diagnosticLines.map((line, index) => (
        <Text key={`diagnostic-${index}`} color={colors.subtext}>{line}</Text>
      ))}
      {pendingRequests.length > 0 && (
        <Text color={colors.yellow}>{`Pending queue: ${pendingRequests.length}`}</Text>
      )}
      {pendingRequests.map((request, index) => (
        <Text key={`pending-${index}`} color={colors.subtext}>{`  ○ ${request}`}</Text>
      ))}
      {agents.map((a) => {
        const row = getStatusRowStyle(a.status, colors);
        const label = row.label ? `${row.label}: ` : '';
        return (
          <Text key={a.name} color={row.color}>{`  ${row.icon} ${label}${a.name}`}</Text>
        );
      })}
    </StyledCard>
  );
};

export const SuccessCard: React.FC<{ readonly message: string; readonly hint?: string }> = ({ message, hint }) => {
  const colors = catppuccinMocha.colors;
  return (
    <StyledCard borderColor={colors.green}>
      <Text color={colors.green} bold>{`✓ ${message}`}</Text>
      {hint !== undefined && <Text color={colors.subtext}>{hint}</Text>}
    </StyledCard>
  );
};

export const InfoCard: React.FC<{ readonly message: string; readonly detail?: string }> = ({ message, detail }) => {
  const colors = catppuccinMocha.colors;
  return (
    <StyledCard borderColor={colors.blue}>
      <Text color={colors.blue} bold>{message}</Text>
      {detail !== undefined && <Text color={colors.subtext}>{detail}</Text>}
    </StyledCard>
  );
};

export const WarningCard: React.FC<{ readonly message: string; readonly detail?: string }> = ({ message, detail }) => {
  const colors = catppuccinMocha.colors;
  return (
    <StyledCard borderColor={colors.yellow}>
      <Text color={colors.yellow} bold>{`⚠ ${message}`}</Text>
      {detail !== undefined && <Text color={colors.subtext}>{detail}</Text>}
    </StyledCard>
  );
};
