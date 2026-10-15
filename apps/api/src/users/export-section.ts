import { eq } from 'drizzle-orm';
import { ApiError } from '../common/errors';
import { exportSection } from '../data-rights/export-section';
import { users } from '../database/schema';
import { profileSchema } from './profile';
import { profileColumns } from './users.service';

export const profileExport = exportSection({
  schema: profileSchema,
  async read(tx, scope) {
    const [row] = await tx.select(profileColumns).from(users).where(eq(users.id, scope.actorId));
    if (!row) throw new ApiError('AUTH_REQUIRED');
    return row;
  },
});
