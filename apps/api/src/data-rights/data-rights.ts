import { z } from 'zod';

export const DELETE_CONFIRMATION = 'DELETE MY DATA';

export const exportQuerySchema = z.strictObject({
  format: z.enum(['json', 'csv']).default('json'),
});
export type ExportFormat = z.infer<typeof exportQuerySchema>['format'];

export const deleteUserBodySchema = z.strictObject({ confirmation: z.string().max(200) });
