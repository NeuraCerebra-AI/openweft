import { z } from 'zod';

export const EditSummaryFileSchema = z
  .object({
    path: z.string(),
    change_type: z.enum(['added', 'modified', 'deleted', 'renamed']),
    lines_added: z.number().int().nonnegative(),
    lines_removed: z.number().int().nonnegative(),
    old_path: z.string().nullable()
  })
  .strict();

export const EditSummarySchema = z
  .object({
    merge_commit: z.string(),
    branch: z.string(),
    pre_merge_commit: z.string(),
    total_files_changed: z.number().int().nonnegative(),
    total_lines_added: z.number().int().nonnegative(),
    total_lines_removed: z.number().int().nonnegative(),
    files: z.array(EditSummaryFileSchema)
  })
  .strict();

export type EditSummary = z.infer<typeof EditSummarySchema>;

type ChangeType = EditSummary['files'][number]['change_type'];

interface NameStatusRecord {
  path: string;
  changeType: ChangeType;
  oldPath: string | null;
}

interface NumstatRecord {
  path: string;
  linesAdded: number;
  linesRemoved: number;
}

const parseChangeType = (status: string): ChangeType => {
  const prefix = status[0];
  switch (prefix) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    default:
      return 'modified';
  }
};

const resolveBraceRenamePath = (value: string): { oldPath: string; newPath: string } | null => {
  const match = value.match(/^(.*)\{(.+?) => (.+?)\}(.*)$/);
  if (!match) {
    return null;
  }

  const [, prefix, oldPart, newPart, suffix] = match;
  if (prefix === undefined || oldPart === undefined || newPart === undefined || suffix === undefined) {
    return null;
  }

  return {
    oldPath: `${prefix}${oldPart}${suffix}`,
    newPath: `${prefix}${newPart}${suffix}`
  };
};

const resolveArrowRenamePath = (value: string): { oldPath: string; newPath: string } | null => {
  const directMatch = value.match(/^(.+?) => (.+)$/);
  if (!directMatch) {
    return null;
  }

  const [, oldPath, newPath] = directMatch;
  if (!oldPath || !newPath) {
    return null;
  }

  return {
    oldPath,
    newPath
  };
};

const parseRenamePath = (value: string): { oldPath: string; newPath: string } | null => {
  return resolveBraceRenamePath(value) ?? resolveArrowRenamePath(value);
};

export const parseNameStatusOutput = (output: string): NameStatusRecord[] => {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      const status = parts[0];
      const path = parts[1];

      if (!status || !path) {
        throw new Error(`Invalid name-status line: ${line}`);
      }

      if (status.startsWith('R')) {
        const renamedPath = parts[2];
        if (!renamedPath) {
          throw new Error(`Invalid rename name-status line: ${line}`);
        }

        return {
          path: renamedPath,
          changeType: 'renamed',
          oldPath: path
        };
      }

      return {
        path,
        changeType: parseChangeType(status),
        oldPath: null
      };
    });
};

export const parseNumstatOutput = (output: string): NumstatRecord[] => {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [addedRaw, removedRaw, pathRaw] = line.split('\t');
      if (!addedRaw || !removedRaw || !pathRaw) {
        throw new Error(`Invalid numstat line: ${line}`);
      }

      const renamePath = parseRenamePath(pathRaw);

      return {
        path: renamePath?.newPath ?? pathRaw,
        linesAdded: addedRaw === '-' ? 0 : Number.parseInt(addedRaw, 10),
        linesRemoved: removedRaw === '-' ? 0 : Number.parseInt(removedRaw, 10)
      };
    });
};

export const buildEditSummary = (input: {
  mergeCommit: string;
  branch: string;
  preMergeCommit: string;
  nameStatusOutput: string;
  numstatOutput: string;
}): EditSummary => {
  const nameStatus = parseNameStatusOutput(input.nameStatusOutput);
  const numstat = new Map(parseNumstatOutput(input.numstatOutput).map((entry) => [entry.path, entry]));

  const files = nameStatus.map((entry) => {
    const stats = numstat.get(entry.path);
    return {
      path: entry.path,
      change_type: entry.changeType,
      lines_added: stats?.linesAdded ?? 0,
      lines_removed: stats?.linesRemoved ?? 0,
      old_path: entry.oldPath
    };
  });

  const summary = {
    merge_commit: input.mergeCommit,
    branch: input.branch,
    pre_merge_commit: input.preMergeCommit,
    total_files_changed: files.length,
    total_lines_added: files.reduce((sum, file) => sum + file.lines_added, 0),
    total_lines_removed: files.reduce((sum, file) => sum + file.lines_removed, 0),
    files
  };

  return EditSummarySchema.parse(summary);
};

export const listEditSummaryPaths = (summary: EditSummary): string[] => {
  const paths = new Set<string>();

  for (const file of summary.files) {
    paths.add(file.path);
    if (file.old_path) {
      paths.add(file.old_path);
    }
  }

  return [...paths].sort();
};

export const buildCodeEditSummary = (input: {
  mergeCommit: string;
  branch: string;
  preMergeCommit: string;
  nameStatusOutput: string;
  numstatOutput: string;
}): {
  merge_commit: string;
  branch: string;
  pre_merge_commit: string;
  total_files_changed: number;
  total_lines_added: number;
  total_lines_removed: number;
  files: Array<{
    path: string;
    changeType: 'added' | 'modified' | 'deleted' | 'renamed';
    linesAdded: number;
    linesRemoved: number;
    oldPath: string | null;
  }>;
} => {
  const summary = buildEditSummary(input);

  return {
    merge_commit: summary.merge_commit,
    branch: summary.branch,
    pre_merge_commit: summary.pre_merge_commit,
    total_files_changed: summary.total_files_changed,
    total_lines_added: summary.total_lines_added,
    total_lines_removed: summary.total_lines_removed,
    files: summary.files.map((file) => ({
      path: file.path,
      changeType: file.change_type,
      linesAdded: file.lines_added,
      linesRemoved: file.lines_removed,
      oldPath: file.old_path
    }))
  };
};
