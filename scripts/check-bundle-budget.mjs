import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const assetsDirectory = path.resolve('dist/public/assets');
const html = fs.readFileSync(path.resolve('dist/public/index.html'), 'utf8');
const initialScripts = [...html.matchAll(/<script[^>]+src="\/assets\/([^"]+\.js)"/g)].map((match) => match[1]);
if (initialScripts.length === 0) throw new Error('No initial JavaScript entry was found in the production HTML.');

let totalRaw = 0;
let totalGzip = 0;
for (const file of initialScripts) {
  const source = fs.readFileSync(path.join(assetsDirectory, file));
  const gzip = zlib.gzipSync(source);
  totalRaw += source.length;
  totalGzip += gzip.length;
  console.log(`${file}: raw=${source.length} gzip=${gzip.length}`);
}
console.log(`initial-total: raw=${totalRaw} gzip=${totalGzip}`);
if (totalGzip > 300_000) {
  throw new Error(`Initial JavaScript gzip budget exceeded: ${totalGzip} > 300000 bytes.`);
}