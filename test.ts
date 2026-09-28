/// Tests for `@clickhouse/wasm-parser`. The public seam is `Parser`: init, parse, format,
/// formatJson, features. The C ABI is driven through the built wrapper in `dist/` (what the
/// package ships) against the modules committed under `wasm/`.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Parser } from './dist/full-node.js';
import { Parser as SlimParser } from './dist/slim-node.js';
import { createParser } from './dist/parser.js';
import { instantiate, load } from './dist/wasi-node.js';
import { instantiate as instantiateBrowser, load as loadBrowser } from './dist/wasi-browser.js';

const here = dirname(fileURLToPath(import.meta.url));
const wasmDir = join(here, 'wasm');

let pass = 0;
let total = 0;

function check(name: string, condition: boolean): void
{
    total++;
    pass += condition ? 1 : 0;
    console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}`);
}

function throwsInitHint(fn: () => unknown): boolean
{
    try
    {
        fn();
        return false;
    }
    catch (error)
    {
        return error instanceof TypeError && /await Parser\.init\(\) first/.test(error.message);
    }
}

check('parse before init throws', throwsInitHint(() => Parser.parse('SELECT 1')));
check('format before init throws', throwsInitHint(() => Parser.format('SELECT 1')));
check('formatJson before init throws', throwsInitHint(() => Parser.formatJson('{}')));
check('features before init throws', throwsInitHint(() => Parser.features));
check('slim parse before init throws', throwsInitHint(() => SlimParser.parse('SELECT 1')));

{
    // Every entrypoint selected by `exports` must offer the same bindings: a bundler resolves
    // the browser one, and `index.d.ts` types all of them alike.
    const pkg = JSON.parse(await readFile(join(here, 'package.json'), 'utf8'));
    const entrypoints = ['.', './slim'].flatMap(
        subpath => ['node', 'browser', 'default'].map(condition => pkg.exports[subpath][condition].default as string));
    const shapes = await Promise.all(
        entrypoints.map(async path => Object.keys(await import(pathToFileURL(join(here, path)).href)).sort().join(',')));
    check('every entrypoint exports only Parser', shapes.every(shape => shape === 'Parser'));

    // A bundler targeting the browser follows these imports; a `node:` module among them is
    // either a build warning or a broken bundle.
    const seen = new Set<string>();
    const nodeImports: string[] = [];
    const pending = ['.', './slim'].map(subpath => join(here, pkg.exports[subpath].browser.default as string));
    for (let file = pending.pop(); file !== undefined; file = pending.pop())
    {
        if (seen.has(file))
            continue;
        seen.add(file);
        const source = await readFile(file, 'utf8');
        for (const [, specifier] of source.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g))
        {
            if (specifier!.startsWith('node:'))
                nodeImports.push(`${file}: ${specifier}`);
            else if (specifier!.startsWith('.'))
                pending.push(join(dirname(file), specifier!));
        }
    }
    check('browser entrypoints import no node: modules', seen.size > 2 && nodeImports.length === 0);
    if (nodeImports.length > 0)
        console.log(nodeImports.join('\n'));
}

{
    const previousFetch = globalThis.fetch;
    const fetched: unknown[] = [];
    globalThis.fetch = async (href) =>
    {
        fetched.push(href);
        return new Response(new Uint8Array([1, 2, 3]));
    };
    try
    {
        const stub = createParser({
            instantiate: async () => ({ exports: {} }) as WebAssembly.Instance,
            load: loadBrowser,
            wasmURL: new URL('file:///unused.wasm'),
        });
        await stub.init({ url: '/assets/parser.wasm' });
        check(
            'init({ url: /assets/parser.wasm }) fetches',
            fetched.length === 1 && fetched[0] === '/assets/parser.wasm');
    }
    finally
    {
        globalThis.fetch = previousFetch;
    }
}

{
    // The modules and the manifest are updated together; a module that does not match its
    // recorded hash is from some other build than the one the manifest names.
    const manifest = JSON.parse(await readFile(join(wasmDir, 'manifest.json'), 'utf8'));
    check('manifest names a ClickHouse commit', /^[0-9a-f]{40}$/.test(manifest.commit));
    for (const name of ['parser.wasm', 'parser-no-formatting-no-dcl.wasm'])
    {
        const bytes = await readFile(join(wasmDir, name));
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        check(`${name} matches manifest.json`, manifest.files[name]?.sha256 === sha256);
    }
}

{
    const packed = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: here, encoding: 'utf8' });
    const files: string[] = packed.status === 0
        ? JSON.parse(packed.stdout)[0].files.map((f: { path: string }) => f.path)
        : [];
    check('npm pack --dry-run succeeds', packed.status === 0);
    check('package contains parser.wasm', files.includes('wasm/parser.wasm'));
    check('package contains slim wasm', files.includes('wasm/parser-no-formatting-no-dcl.wasm'));
    check('package contains the built wrapper', files.includes('dist/parser.js'));
    check('package contains the types', files.includes('dist/full-node.d.ts'));
    check('package does not contain the TypeScript sources', !files.some(f => f.startsWith('src/')));
    check('package does not contain tests', !files.includes('test.ts'));
    check('package does not contain the playground', !files.some(f => f.startsWith('playground/')));
}

const fullWasm = pathToFileURL(join(wasmDir, 'parser.wasm'));

await Parser.init();
await Parser.init({ url: fullWasm });
check('init is idempotent', typeof Parser.features === 'object' && Parser.features !== null);
check('full build has formatting', Parser.features.format === true);
check('full build has AST JSON', Parser.features.astJson === true);
check('full build has DCL', Parser.features.dcl === true);

{
    const result = Parser.parse('SELECT 1');
    check('parse SELECT 1 has no error', result.error === undefined);
    check('parse SELECT 1 has an ast type', typeof (result.ast as { type?: unknown } | undefined)?.type === 'string');
    check(
        'parse SELECT 1 highlights SELECT',
        !!result.highlights?.some(h => h.begin === 0 && h.end === 6 && h.type === 'keyword'));
}

{
    const result = Parser.parse('SELECT 1 +');
    check('parse SELECT 1 + reports an error', typeof result.error?.message === 'string');
    check('parse SELECT 1 + does not throw', result.ast === undefined);
    check('parse error lists expected tokens', Array.isArray(result.error?.expected));
}

{
    const result = Parser.format('select 1', { oneLine: true });
    check('format SELECT 1 returns sql', typeof result.sql === 'string' && /SELECT/i.test(result.sql));
    check('format SELECT 1 has no error', result.error === undefined);
}

{
    const parsed = Parser.parse('SELECT 1');
    const result = Parser.formatJson(parsed.ast, { oneLine: true });
    check('formatJson round-trips SELECT 1', typeof result.sql === 'string' && result.error === undefined);
}

{
    const result = Parser.formatJson('this is not JSON', { oneLine: true });
    check('formatJson malformed JSON is an error', typeof result.error?.message === 'string');
}

await SlimParser.init();
check('slim build has no formatting', SlimParser.features.format === false);
check('slim build has no AST JSON', SlimParser.features.astJson === false);
check('slim build has no DCL', SlimParser.features.dcl === false);

{
    const result = SlimParser.parse('SELECT 1');
    check('slim parse SELECT 1 has no error', result.error === undefined);
    check('slim parse has no ast', result.ast === undefined);
}

{
    const result = SlimParser.format('SELECT 1');
    check(
        'slim format reports missing build support',
        result.sql === undefined && result.error?.message === 'format is not in this build');
}

{
    const result = SlimParser.formatJson({});
    check(
        'slim formatJson reports missing build support',
        result.sql === undefined && result.error?.message === 'format is not in this build');
}

{
    const bytes = await readFile(join(wasmDir, 'parser.wasm'));
    const fromBytes = createParser({ instantiate, load, wasmURL: fullWasm });
    await fromBytes.init({ bytes });
    check('init({ bytes }) parses SELECT 1', fromBytes.parse('SELECT 1').error === undefined);
}

{
    const browserParser = createParser({ instantiate: instantiateBrowser, load, wasmURL: fullWasm });
    await browserParser.init();
    check(
        'wasi-browser parses SELECT 1',
        browserParser.parse('SELECT 1').error === undefined);
}

console.log(`\n${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
