import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../dist/', import.meta.url));
const html = await readFile(path.join(output, 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]));
let references = 0;
async function verifyReference(from, reference) {
  if (!reference || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) return;
  if (reference.startsWith('#')) {
    if (reference.length > 1 && from.endsWith('index.html')) {
      assert(ids.has(reference.slice(1)), `Missing anchor ${reference}`);
    }
    return;
  }
  assert(!reference.startsWith('/'), `Root-relative asset breaks project hosting: ${reference}`);
  const clean = decodeURIComponent(reference.split(/[?#]/)[0]);
  const target = path.resolve(path.dirname(from), clean);
  assert(target.startsWith(output), `Asset escapes dist/: ${reference}`);
  assert((await stat(target)).isFile(), `Missing asset ${reference} from ${from}`);
  references += 1;
}
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), `Symlinks cannot be shipped: ${entry.name}`);
    assert(!entry.name.startsWith('.'), `Unexpected hidden build file: ${entry.name}`);
    assert(!/\.(?:key|pem)$|keypair\.json$/i.test(entry.name), `Unexpected key file: ${entry.name}`);
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { await walk(file); continue; }
    if (!/\.(?:html|css|js)$/.test(entry.name)) continue;
    const text = await readFile(file, 'utf8');
    const patterns = entry.name.endsWith('.html') ? [/\b(?:src|href)=["']([^"']+)["']/g]
      : entry.name.endsWith('.css') ? [/url\(\s*["']?([^\s)"']+)["']?\s*\)/g]
      : [/\bimport\s+(?:[^;\n]*?\s+from\s+)?["']([^"']+)["']/g];
    for (const pattern of patterns) for (const match of text.matchAll(pattern)) {
      await verifyReference(file, match[1]);
    }
  }
}
assert(/<title>[^<]+<\/title>/.test(html), 'Missing page title');
await walk(output);
console.log(`Build verified: ${references} local assets/imports resolve, anchors exist, no hidden files or keys.`);
