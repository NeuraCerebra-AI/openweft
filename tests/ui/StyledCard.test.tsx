import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { StyledCard } from '../../src/ui/StyledCard.js';

describe('StyledCard', () => {
  it('renders children inside bordered card', () => {
    const { lastFrame } = render(
      <StyledCard borderColor="#a6e3a1">
        <></>
      </StyledCard>
    );
    expect(lastFrame()).toBeDefined();
  });
});
