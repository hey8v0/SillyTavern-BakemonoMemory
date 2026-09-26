// Local UI harness: serves a mock SillyTavern host with the extension mounted at its real path.
// No network calls, no model calls. Usage (from the repo root):
//   node scripts/ui-harness/server.mjs            -> http://127.0.0.1:8765
//   CSS_OVERRIDE=path/to/candidate.css node scripts/ui-harness/server.mjs   (serve a candidate stylesheet)
// POST /save/<name> writes into scripts/ui-harness/.output (snapshots, cascade results).
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(process.argv[2] || join(HERE, '..', '..'));
const OUTPUT = join(HERE, '.output');
const EXT = '/scripts/extensions/third-party/BakemonoMemory/';
const PORT = Number(process.env.PORT || 8765);
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.json': 'application/json' };

await mkdir(OUTPUT, { recursive: true });
createServer(async (req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/save/')) {
        const name = decodeURIComponent(req.url.slice(6)).replace(/[^\w.-]/g, '_');
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        await writeFile(join(OUTPUT, name), Buffer.concat(chunks));
        res.end('ok');
        return;
    }
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/') path = '/index.html';
    const file = process.env.CSS_OVERRIDE && path === EXT + 'style.css' ? process.env.CSS_OVERRIDE
        : path.startsWith(EXT) ? join(REPO, normalize(path.slice(EXT.length)))
            : path.startsWith('/.output/') ? join(OUTPUT, normalize(path.slice(9)))
                : join(HERE, normalize(path));
    try {
        res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.end(await readFile(file));
    } catch {
        res.writeHead(404).end('not found');
    }
}).listen(PORT, '127.0.0.1', () => console.log(`UI harness: http://127.0.0.1:${PORT} (extension from ${REPO})`));
