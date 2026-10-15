import type { z } from 'zod';
import type { Tx } from '../database/database.module';
import type { Membership } from '../workspaces/access-policy';

/** Who is exporting and which workspaces they see: their personal one and their family, if any. */
export type ExportScope = Readonly<{
  actorId: string;
  memberships: readonly Membership[];
  /** Workspace ids the actor belongs to (BR-2). Rows outside them never enter an export. */
  visible: ReadonlySet<string>;
  personalWorkspaceId: string;
}>;

/**
 * One key of the JSON export (BR-31), owned by the module whose data it reads. `read` runs inside
 * the export's read-only snapshot and must return only rows of `scope.visible`.
 */
export type ExportSection<S extends z.ZodType> = Readonly<{
  schema: S;
  read: (tx: Tx, scope: ExportScope) => Promise<z.infer<S>>;
}>;
