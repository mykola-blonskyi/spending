import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { ApiError } from '../common/errors';
import type { ExportSection } from '../data-rights/export-section';
import { users } from '../database/schema';
import { profileSchema } from './profile';
import { profileColumns } from './users.service';

export const profileExport = {
  schema: profileSchema,
  async read(tx, scope) {
    const [row] = await tx.select(profileColumns).from(users).where(eq(users.id, scope.actorId));
    if (!row) throw new ApiError('AUTH_REQUIRED');
    return row;
  },
} satisfies ExportSection<z.ZodType>;
