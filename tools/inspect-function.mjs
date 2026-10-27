import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [indexPath, name] = process.argv.slice(2);
if (!indexPath || !name) throw new Error('Usage: node tools/inspect-function.mjs INDEX.json EXACT_NAME');
const index = JSON.parse(await readFile(indexPath, 'utf8'));
let matches = 0;
for (const file of index.files) {
  const functions = file.functions.filter(fn => fn.name === name);
  if (!functions.length) continue;
  const source = await readFile(resolve(import.meta.dirname, '..', file.file), 'utf8');
  for (const fn of functions) {
    console.log(JSON.stringify({ file: file.file, ...fn }));
    console.log(source.slice(fn.start, fn.end));
    matches++;
  }
}
if (!matches) { console.error(`No syntactic definition found: ${name}`); process.exitCode = 1; }
