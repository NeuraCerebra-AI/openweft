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
  readonly phase: string;
  readonly usageLabel: string;
  readonly usageValue: string;
  readonly agents: readonly { name: string; status: string }[];
  readonly pendingRequests?: readonly string[];
}

export const StatusCard: React.FC<StatusCardProps> = ({
  appName,
  phase,
  usageLabel,
  usageValue,
  agents,
  pendingRequests = []
}) => {
  const colors = catppuccinMocha.colors;
  return (
    <StyledCard borderColor={colors.blue}>
      <Text bold color={colors.blue}>{appName}</Text>
      <Text color={colors.subtext}>{`Phase: ${phase}  ${usageLabel}: ${usageValue}`}</Text>
      {pendingRequests.length > 0 && (
        <Text color={colors.yellow}>{`Pending queue: ${pendingRequests.length}`}</Text>
      )}
      {pendingRequests.map((request, index) => (
        <Text key={`pending-${index}`} color={colors.subtext}>{`  ○ ${request}`}</Text>
      ))}
      {agents.map((a) => (
        <Text key={a.name} color={colors.text}>{`  ${a.status === 'running' ? '●' : '✓'} ${a.name}`}</Text>
      ))}
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
