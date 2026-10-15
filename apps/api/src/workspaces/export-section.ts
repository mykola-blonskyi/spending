import { z } from 'zod';
import { exportSection } from '../data-rights/export-section';
import { workspaceViewSchema } from './family';
import { workspaceViews } from './family.service';

/** The actor's workspaces with their role and the members of each (BR-31). */
export const workspacesExport = exportSection({
  schema: z.array(workspaceViewSchema),
  read: (tx, scope) => workspaceViews(tx, scope.memberships),
});
