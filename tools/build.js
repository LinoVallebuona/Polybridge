// Bundles the game into single self-contained HTML files:
//   dist/index.html     – a complete standalone page (open it from disk or host it anywhere)
//   dist/artifact.html  – the same page body, without the document wrapper, for hosts that add their own
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

let html = read('index.html');
html = html.replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${read('style.css')}</style>`);
html = html.replace(/<script src="(js\/[\w.-]+\.js)"><\/script>/g, (_, f) => `<script>\n${read(f).replace(/<\/script/gi, '<\\/script')}</script>`);
if (/src="js\//.test(html) || /href="style\.css"/.test(html)) throw new Error('a local asset was not inlined');

const artifact = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<html[^>]*>\s*/i, '')
  .replace(/<\/html>\s*/i, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body>\s*/gi, '')
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/index.html'), html);
fs.writeFileSync(path.join(root, 'dist/artifact.html'), artifact);
console.log(`dist/index.html ${(html.length / 1024).toFixed(1)} KB, dist/artifact.html ${(artifact.length / 1024).toFixed(1)} KB`);
