import React from 'react';
import { render, Text } from 'ink';

import { ThemeContext, catppuccinMocha } from './theme.js';
import { StyledCard } from './StyledCard.js';

export const renderStyledOutput = (element: React.ReactElement): void => {
  render(
    <ThemeContext.Provider value={catppuccinMocha}>
      {element}
    </ThemeContext.Provider>
  );
};

interface StatusCardProps {
  readonly appName: string;
  readonly phase: string;
  readonly cost: string;
  readonly agents: readonly { name: string; status: string }[];
}

export const StatusCard: React.FC<StatusCardProps> = ({ appName, phase, cost, agents }) => {
  const colors = catppuccinMocha.colors;
  return (
    <StyledCard borderColor={colors.blue}>
      <Text bold color={colors.blue}>{appName}</Text>
      <Text color={colors.subtext}>{`Phase: ${phase}  Cost: ${cost}`}</Text>
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
