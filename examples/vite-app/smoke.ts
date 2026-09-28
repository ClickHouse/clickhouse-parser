/// Loads the production build in headless Chrome and checks that the parser really ran in the
/// page: the query was highlighted, validated and formatted. Run after `npm run build`.
///
///   node smoke.ts
///
/// Chrome is found on PATH (`google-chrome`, `chromium`, …) or at the macOS default location;
/// set CHROME_PATH to use another one.
import { execFile, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { preview } from 'vite';

function findChrome(): string
{
    const candidates = [
        process.env.CHROME_PATH,
        'google-chrome',
        'google-chrome-stable',
        'chromium',
        'chromium-browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ];
    for (const candidate of candidates)
    {
        if (!candidate)
            continue;
        if (candidate.startsWith('/') ? existsSync(candidate) : spawnSync('which', [candidate]).status === 0)
            return candidate;
    }
    throw new Error('Chrome not found; set CHROME_PATH');
}

const server = await preview({ preview: { port: 0, strictPort: false } });
const url = server.resolvedUrls?.local[0];
if (!url)
    throw new Error('vite preview did not report a URL');

let failed = false;
try
{
    // Asynchronous on purpose: the preview server runs in this process and must keep serving
    // while Chrome loads the page.
    const { stdout: dom } = await promisify(execFile)(findChrome(), [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--no-first-run',
        // Lets the page's async work (fetching and instantiating the modules) finish before
        // the DOM is dumped.
        '--virtual-time-budget=15000',
        '--dump-dom',
        url,
    ], { encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });

    const checks: [string, boolean][] = [
        ['the module loaded and parsed', /Parsed in [\d.]+ ms/.test(dom)],
        ['the default query is valid', dom.includes('✓ Valid')],
        ['keywords are highlighted', /<span class="hl-keyword">select<\/span>/.test(dom)],
        ['functions are highlighted', /<span class="hl-function">toStartOfHour<\/span>/.test(dom)],
        ['the query is formatted', /SELECT\n {4}toStartOfHour\(event_time\) AS hour/.test(dom)],
        ['the full build reports all features', dom.includes('✓ AST JSON')],
    ];
    for (const [name, ok] of checks)
    {
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
        failed ||= !ok;
    }
    if (failed)
        console.log(`\n--- DOM ---\n${dom}`);
}
finally
{
    await server.close();
}
process.exit(failed ? 1 : 0);
