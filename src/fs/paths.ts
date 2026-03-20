import path from 'node:path';

export interface RuntimePaths {
  repoRoot: string;
  openweftDir: string;
  featureRequestsDir: string;
  queueFile: string;
  promptA: string;
  planAdjustment: string;
  checkpointFile: string;
  checkpointBackupFile: string;
  costsFile: string;
  pidFile: string;
  outputLogFile: string;
  auditLogFile: string;
  worktreesDir: string;
  shadowPlansDir: string;
  promptBArtifactsDir: string;
}

export const resolveRelativePath = (baseDirectory: string, targetPath: string): string => {
  if (path.isAbsolute(targetPath)) {
    return path.normalize(targetPath);
  }

  return path.resolve(baseDirectory, targetPath);
};

export const buildRuntimePaths = (input: {
  repoRoot: string;
  configDirectory: string;
  featureRequestsDir: string;
  queueFile: string;
  promptA: string;
  planAdjustment: string;
}): RuntimePaths => {
  const repoRoot = path.resolve(input.repoRoot);
  const openweftDir = path.join(repoRoot, '.openweft');
  const featureRequestsDir = resolveRelativePath(input.configDirectory, input.featureRequestsDir);

  return {
    repoRoot,
    openweftDir,
    featureRequestsDir,
    queueFile: resolveRelativePath(input.configDirectory, input.queueFile),
    promptA: resolveRelativePath(input.configDirectory, input.promptA),
    planAdjustment: resolveRelativePath(input.configDirectory, input.planAdjustment),
    checkpointFile: path.join(openweftDir, 'checkpoint.json'),
    checkpointBackupFile: path.join(openweftDir, 'checkpoint.json.backup'),
    costsFile: path.join(openweftDir, 'costs.jsonl'),
    pidFile: path.join(openweftDir, 'pid'),
    outputLogFile: path.join(openweftDir, 'output.log'),
    auditLogFile: path.join(openweftDir, 'audit-trail.jsonl'),
    worktreesDir: path.join(openweftDir, 'worktrees'),
    shadowPlansDir: path.join(openweftDir, 'shadow-plans'),
    promptBArtifactsDir: path.join(featureRequestsDir, 'briefs')
  };
};
