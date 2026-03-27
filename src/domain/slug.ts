import { createPlanFilename, formatFeatureId, parseFeatureId, slugifyFeatureRequest } from './featureIds.js';

export { formatFeatureId, slugifyFeatureRequest };

export const buildPlanFileName = (
  id: number,
  request: string,
  existingFileNames: Iterable<string> = []
): string => {
  return createPlanFilename(id, request, existingFileNames);
};

export const extractNumericFeatureId = (value: string): number | null => {
  const match = value.match(/^(\d{3,})/);
  return match?.[1] ? parseFeatureId(match[1]) : null;
};
