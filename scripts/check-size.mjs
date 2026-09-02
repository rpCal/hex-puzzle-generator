import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

/**
 * Bundle size budget.
 *
 * The point of a zero-dependency, framework-free build is that it stays small; a budget nothing
 * enforces is a budget that drifts. Measured gzipped, because that is what a visitor downloads.
 */

const BUDGET_KB = 150;
const DIST = new URL('../dist/assets', import.meta.url).pathname;

let total = 0;
const rows = [];

for (const name of readdirSync(DIST)) {
  if (!/\.(js|css)$/.test(name)) continue;
  const path = join(DIST, name);
  const raw = statSync(path).size;
  const gzip = gzipSync(readFileSync(path)).length;
  total += gzip;
  rows.push({ name, raw, gzip });
}

const kb = (bytes) => (bytes / 1024).toFixed(2).padStart(8);
for (const row of rows) {
  process.stdout.write(`${kb(row.raw)} kB  ${kb(row.gzip)} kB gzip  ${row.name}\n`);
}
process.stdout.write(`${' '.repeat(10)}  ${kb(total)} kB gzip  TOTAL (budget ${BUDGET_KB} kB)\n`);

if (total > BUDGET_KB * 1024) {
  process.stderr.write(`\nBundle is over budget: ${(total / 1024).toFixed(2)} kB > ${BUDGET_KB} kB\n`);
  process.exit(1);
}
