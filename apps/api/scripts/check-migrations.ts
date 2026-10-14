import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Journal = { entries: { idx: number; when: number; tag: string }[] };

const folder = resolve(__dirname, '../drizzle');
const journal = JSON.parse(readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8')) as Journal;
const files = readdirSync(folder)
  .filter((name) => name.endsWith('.sql'))
  .map((name) => name.replace(/\.sql$/, ''))
  .sort();
const problems: string[] = [];

journal.entries.forEach((entry, position) => {
  if (entry.idx !== position) problems.push(`${entry.tag}: idx ${entry.idx}, expected ${position}`);
  const previous = journal.entries[position - 1];
  // The migrator skips an entry whose timestamp is not newer than the last applied one.
  if (previous && entry.when <= previous.when) {
    problems.push(`${entry.tag}: timestamp not newer than ${previous.tag}; regenerate it`);
  }
});
const tags = journal.entries.map((entry) => entry.tag);
if (JSON.stringify(tags) !== JSON.stringify(files)) {
  problems.push(`journal entries ${tags.join(', ')} do not match SQL files ${files.join(', ')}`);
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`${tags.length} migrations in order\n`);
