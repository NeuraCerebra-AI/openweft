import React, { useMemo } from 'react';
import { Text } from 'ink';
import { marked, type MarkedExtension } from 'marked';
import { markedTerminal } from 'marked-terminal';

import { useTheme } from './theme.js';
import { ToolBlock } from './ToolBlock.js';
import { CodeBlock } from './CodeBlock.js';
import { ApprovalPrompt } from './ApprovalPrompt.js';
import type { OutputLine as OutputLineType } from './store.js';

// Configure marked with terminal renderer (once).
// Type cast needed because @types/marked-terminal lags behind marked's MarkedExtension interface.
marked.use(markedTerminal() as unknown as MarkedExtension);

interface OutputLineProps {
  readonly line: OutputLineType;
}

export const OutputLine: React.FC<OutputLineProps> = React.memo(({ line }) => {
  const { colors } = useTheme();

  const renderedText = useMemo(() => {
    if (line.type !== 'text') return '';
    return (marked.parse(line.content, { async: false }) as string).trimEnd();
  }, [line.type, line.content]);

  switch (line.type) {
    case 'text':
      return <Text>{renderedText}</Text>;

    case 'tool':
      return (
        <ToolBlock
          tool={line.meta?.['tool'] ?? ''}
          args={line.meta?.['args'] ?? ''}
        />
      );

    case 'tool-result':
      return (
        <ToolBlock
          tool={line.meta?.['tool'] ?? ''}
          args=""
          result={line.content}
          success={line.meta?.['success'] === 'true'}
        />
      );

    case 'code':
      return (
        <CodeBlock
          filename={line.meta?.['filename'] ?? 'unknown'}
          content={line.content}
          language={line.meta?.['language'] ?? ''}
        />
      );

    case 'approval':
      return (
        <ApprovalPrompt
          file={line.meta?.['file'] ?? ''}
          action={line.meta?.['action'] ?? line.content}
          detail={line.content}
        />
      );

    default:
      return <Text>{line.content}</Text>;
  }
});

OutputLine.displayName = 'OutputLine';
