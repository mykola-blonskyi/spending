import { z } from 'zod';
import type { Tx } from '../database/database.module';
import { budgetsExport } from '../budgets/export-section';
import type { ExportScope } from './export-section';
import { importBatchesExport, categoryRulesExport } from '../imports/export-section';
import { accountsExport, categoriesExport, transactionsExport } from '../ledger/export-section';
import { recurringRulesExport } from '../recurring/export-section';
import { conflictsExport } from '../sync/export-section';
import { profileExport } from '../users/export-section';
import { workspacesExport } from '../workspaces/export-section';

/**
 * The JSON export's sections, in document order. A module with data of its own adds its section
 * here; the export schema, the OpenAPI document and the reader follow from this list.
 */
const EXPORT_SECTIONS = {
  user: profileExport,
  workspaces: workspacesExport,
  accounts: accountsExport,
  categories: categoriesExport,
  transactions: transactionsExport,
  budgets: budgetsExport,
  recurringRules: recurringRulesExport,
  importBatches: importBatchesExport,
  categoryRules: categoryRulesExport,
  conflicts: conflictsExport,
};

type Sections = typeof EXPORT_SECTIONS;
type SectionKey = keyof Sections;

const sectionKeys = Object.keys(EXPORT_SECTIONS) as SectionKey[];

const sectionShape = Object.fromEntries(
  sectionKeys.map((key) => [key, EXPORT_SECTIONS[key].schema]),
) as { [K in SectionKey]: Sections[K]['schema'] };

export const dataExportSchema = z.object({ exportedAt: z.iso.datetime(), ...sectionShape });
export type DataExport = z.infer<typeof dataExportSchema>;

/** Reads every section in order; `tx` should be one snapshot so sections agree with each other. */
export async function readExport(
  tx: Tx,
  scope: ExportScope,
  exportedAt: Date,
): Promise<DataExport> {
  const document: Record<string, unknown> = { exportedAt: exportedAt.toISOString() };
  for (const key of sectionKeys) {
    const section = EXPORT_SECTIONS[key];
    document[key] = section.schema.parse(await section.read(tx, scope));
  }
  return document as DataExport;
}
