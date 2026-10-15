import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { SessionService } from '../auth/session.service';
import { ApiError } from '../common/errors';
import { DB, type Db, ledgerTransaction } from '../database/database.module';
import { users, workspaces } from '../database/schema';
import { AccessPolicy } from '../workspaces/access-policy';
import { FamilyService } from '../workspaces/family.service';
import { transactionsCsv } from './csv';
import { DELETE_CONFIRMATION, type ExportFormat } from './data-rights';
import { type DataExport, readExport } from './export-sections';

export type ExportFile = Readonly<{ body: string; contentType: string; fileName: string }>;

// A UTF-8 byte order mark, so spreadsheet apps read non-Latin descriptions correctly.
const BOM = '﻿';

@Injectable()
export class DataRightsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AccessPolicy) private readonly policy: AccessPolicy,
    @Inject(FamilyService) private readonly family: FamilyService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  /** BR-31. Everything the actor sees, read in one snapshot so the sections agree. */
  exportData(actorId: string): Promise<DataExport> {
    return this.db.transaction(
      async (tx) => {
        const memberships = await this.policy.memberships(actorId, tx);
        const personal = memberships.find((m) => m.kind === 'personal');
        if (!personal) throw new ApiError('AUTH_REQUIRED');
        return readExport(
          tx,
          {
            actorId,
            memberships,
            visible: new Set(memberships.map((m) => m.workspaceId)),
            personalWorkspaceId: personal.workspaceId,
          },
          new Date(),
        );
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  async exportFile(actorId: string, format: ExportFormat): Promise<ExportFile> {
    const document = await this.exportData(actorId);
    const fileName = `spending-export-${document.exportedAt.slice(0, 10)}.${format}`;
    return format === 'csv'
      ? { body: BOM + transactionsCsv(document), contentType: 'text/csv; charset=utf-8', fileName }
      : {
          body: JSON.stringify(document, null, 2),
          contentType: 'application/json; charset=utf-8',
          fileName,
        };
  }

  /**
   * BR-32. One ledger transaction leaves or deletes the family, keeps the family transactions the
   * user authored as a former member's, and deletes the personal workspace and the user. The
   * schema's cascades remove what hangs off them: accounts, categories, transactions, budgets,
   * rules, imports, memberships, sync mutations, conflicts and tombstones. Family rows stay
   * visible, so they need no tombstone. Provider refresh tokens are revoked only after commit, and
   * their failure never undoes the deletion.
   */
  async deleteUser(actorId: string, confirmation: string): Promise<void> {
    if (confirmation !== DELETE_CONFIRMATION) throw new ApiError('CONFIRMATION_MISMATCH');
    const refreshTokens = await ledgerTransaction(this.db, async (tx) => {
      await this.family.releaseForUserDeletion(tx, actorId);
      const personalWorkspaceId = await this.policy.personalWorkspaceId(actorId, tx);
      const tokens = await this.sessions.deleteAllOf(tx, actorId);
      await tx.delete(workspaces).where(eq(workspaces.id, personalWorkspaceId));
      await tx.delete(users).where(eq(users.id, actorId));
      return tokens;
    });
    await this.sessions.revokeQuietly(refreshTokens);
  }
}
