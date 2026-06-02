import { z } from 'zod';

export { RelativeFilePathSchema } from './paths.js';
import { RelativeFilePathSchema } from './paths.js';

export const ManifestSchema = z
  .object({
    create: z.array(RelativeFilePathSchema),
    modify: z.array(RelativeFilePathSchema),
    delete: z.array(RelativeFilePathSchema)
  })
  .strict();

export type Manifest = z.infer<typeof ManifestSchema>;

export const PriorityTierSchema = z.enum(['critical', 'high', 'medium', 'low']);
export type PriorityTier = z.infer<typeof PriorityTierSchema>;

export const UserBackendSchema = z.enum(['codex', 'claude']);
export type UserBackend = z.infer<typeof UserBackendSchema>;

export const BackendSchema = z.enum(['codex', 'claude', 'mock']);
export type Backend = z.infer<typeof BackendSchema>;

export const AuthMethodSchema = z.enum(['subscription', 'api_key']);
export type AuthMethod = z.infer<typeof AuthMethodSchema>;
