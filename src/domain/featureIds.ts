const DEFAULT_SLUG = 'feature-request';
const SLUG_LIMIT = 60;

export const formatFeatureId = (id: number): string => {
  if (!Number.isInteger(id) || id < 0) {
    throw new Error(`Feature id must be a non-negative integer, received: ${id}`);
  }

  return id.toString().padStart(3, '0');
};

export const parseFeatureId = (value: string): number | null => {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  return Number.parseInt(value, 10);
};

export const getNextFeatureId = (existingIds: Iterable<number>): number => {
  let highest = 0;

  for (const id of existingIds) {
    if (id > highest) {
      highest = id;
    }
  }

  return highest + 1;
};

export const slugifyFeatureRequest = (request: string, maxLength = SLUG_LIMIT): string => {
  const trimmed = request.trim().toLowerCase();
  const slug = trimmed
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength)
    .replace(/-$/g, '');

  return slug || DEFAULT_SLUG;
};

const withCollisionSuffix = (slug: string, collisionIndex: number, maxLength: number): string => {
  if (collisionIndex <= 1) {
    return slug;
  }

  const suffix = `-${collisionIndex}`;
  const baseLength = Math.max(1, maxLength - suffix.length);
  return `${slug.slice(0, baseLength).replace(/-$/g, '')}${suffix}`;
};

export const createPlanFilename = (
  featureId: number,
  request: string,
  existingFilenames: Iterable<string> = [],
  maxSlugLength = SLUG_LIMIT
): string => {
  const id = formatFeatureId(featureId);
  const baseSlug = slugifyFeatureRequest(request, maxSlugLength);
  const existing = new Set(existingFilenames);

  let collisionIndex = 1;

  while (true) {
    const candidateSlug = withCollisionSuffix(baseSlug, collisionIndex, maxSlugLength);
    const candidate = `${id}_${candidateSlug}.md`;

    if (!existing.has(candidate)) {
      return candidate;
    }

    collisionIndex += 1;
  }
};

