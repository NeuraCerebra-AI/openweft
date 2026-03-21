import { z } from 'zod';

export const CostStageSchema = z.enum([
  'planning-s1',
  'planning-s2',
  'execution',
  'adjustment',
  'conflict-resolution'
]);

export type CostStage = z.infer<typeof CostStageSchema>;

export const CostEntrySchema = z
  .object({
    featureId: z.string(),
    stage: CostStageSchema,
    model: z.string(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative(),
    timestamp: z.string().datetime()
  })
  .strict();

export type CostEntry = z.infer<typeof CostEntrySchema>;
export const CostRecordSchema = CostEntrySchema;
export type CostRecord = CostEntry;

export const CheckpointCostTotalsSchema = z
  .object({
    totalInputTokens: z.number().int().nonnegative(),
    totalOutputTokens: z.number().int().nonnegative(),
    totalEstimatedUsd: z.number().nonnegative(),
    perFeature: z.record(
      z.string(),
      z.object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        usd: z.number().nonnegative(),
        updatedAt: z.string()
      })
    )
  })
  .strict();

export type CheckpointCostTotals = z.infer<typeof CheckpointCostTotalsSchema>;
export const CostTotalsSchema = CheckpointCostTotalsSchema;
export type CostTotals = CheckpointCostTotals;

interface PricingTableEntry {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

export const MODEL_PRICING: Record<string, PricingTableEntry> = {
  'gpt-5.3-codex': {
    inputPerMillionUsd: 1.75,
    outputPerMillionUsd: 14
  },
  'claude-sonnet-4-6': {
    inputPerMillionUsd: 3,
    outputPerMillionUsd: 15
  }
};

const normalizeModelName = (model: string): string => model.trim().toLowerCase();

const warnedUnknownModels = new Set<string>();

export const estimateCostUsd = (model: string, inputTokens: number, outputTokens: number): number => {
  const normalizedModel = normalizeModelName(model);
  const pricing = MODEL_PRICING[normalizedModel];

  if (!pricing) {
    if (!warnedUnknownModels.has(normalizedModel)) {
      warnedUnknownModels.add(normalizedModel);
      console.warn(`OpenWeft: unknown model "${model}" — cost will be reported as $0.`);
    }
    return 0;
  }

  return Number.parseFloat(
    (
      (inputTokens / 1_000_000) * pricing.inputPerMillionUsd +
      (outputTokens / 1_000_000) * pricing.outputPerMillionUsd
    ).toFixed(6)
  );
};

export const createCostEntry = (input: Omit<CostEntry, 'estimatedCostUsd'>): CostEntry => {
  return CostEntrySchema.parse({
    ...input,
    estimatedCostUsd: estimateCostUsd(input.model, input.inputTokens, input.outputTokens)
  });
};

export const createEmptyCostTotals = (): CheckpointCostTotals => ({
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalEstimatedUsd: 0,
  perFeature: {}
});

export const accumulateCostTotals = (
  current: CheckpointCostTotals,
  entry: CostEntry
): CheckpointCostTotals => {
  const existingFeature = current.perFeature[entry.featureId] ?? {
    inputTokens: 0,
    outputTokens: 0,
    usd: 0,
    updatedAt: entry.timestamp
  };

  return CheckpointCostTotalsSchema.parse({
    totalInputTokens: current.totalInputTokens + entry.inputTokens,
    totalOutputTokens: current.totalOutputTokens + entry.outputTokens,
    totalEstimatedUsd: Number.parseFloat((current.totalEstimatedUsd + entry.estimatedCostUsd).toFixed(6)),
    perFeature: {
      ...current.perFeature,
      [entry.featureId]: {
        inputTokens: existingFeature.inputTokens + entry.inputTokens,
        outputTokens: existingFeature.outputTokens + entry.outputTokens,
        usd: Number.parseFloat((existingFeature.usd + entry.estimatedCostUsd).toFixed(6)),
        updatedAt: entry.timestamp
      }
    }
  });
};

export const estimateUsageCostUsd = (
  model: string,
  usage: { inputTokens: number; outputTokens: number }
): number => {
  return estimateCostUsd(model, usage.inputTokens, usage.outputTokens);
};

export const createCostRecord = (
  input: Omit<CostRecord, 'estimatedCostUsd'>
): CostRecord => {
  return createCostEntry(input);
};

export const addCostRecordToTotals = (
  totals: CostTotals,
  record: CostRecord
): CostTotals => {
  return accumulateCostTotals(totals, record);
};
