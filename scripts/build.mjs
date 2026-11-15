import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, 'apps/web');
const output = path.join(root, 'dist');
const html = await readFile(path.join(source, 'index.html'), 'utf8');
const configuredUrl = process.env.MOLTIVATE_DEMO_URL?.trim();
let demoUrl;
if (configuredUrl) {
  demoUrl = new URL(configuredUrl);
  if (demoUrl.protocol !== 'https:' || demoUrl.username || demoUrl.password || demoUrl.search || demoUrl.hash) {
    throw new Error('MOLTIVATE_DEMO_URL must be a public HTTPS app URL without credentials, query, or fragment');
  }
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
if (demoUrl) {
  const href = demoUrl.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  await writeFile(path.join(output, 'index.html'),
    html.replaceAll('data-web-demo href="#demo"', `data-web-demo href="${href}"`));
}
console.log('Built Moltivate frontend into dist/');
