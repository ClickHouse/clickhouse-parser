/// Replace the committed modules with the two that ClickHouse's `Build (wasm_parser)` publishes
/// under `https://clickhouse-builds.s3.amazonaws.com/REFs/master/<sha>/masterci/build_wasm_parser/`
/// (or a local build of `utils/wasm-parser`), and rewrite `wasm/manifest.json` to match:
///
///   node scripts/update-wasm.ts --from <dir-with-both-wasm-files> --commit <clickhouse-sha>
///
/// Both modules are replaced in one go, so a manifest never names a mixed pair of builds.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const wasmDir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'wasm');
const FILES = ['parser.wasm', 'parser-no-formatting-no-dcl.wasm'];

function argValue(name: string): string
{
    const value = process.argv[process.argv.indexOf(name) + 1];
    if (!process.argv.includes(name) || value === undefined)
        throw new Error(`missing ${name}`);
    return value;
}

const from = resolve(argValue('--from'));
const commit = argValue('--commit');
if (!/^[0-9a-f]{40}$/.test(commit))
    throw new Error(`--commit must be a full 40-character SHA, got ${commit}`);

// Read both before writing either, so a missing file leaves `wasm/` untouched.
const modules = await Promise.all(
    FILES.map(async name => ({ name, bytes: await readFile(join(from, name)) })));

await mkdir(wasmDir, { recursive: true });
const files: Record<string, { size: number; sha256: string }> = {};
for (const { name, bytes } of modules)
{
    await writeFile(join(wasmDir, name), bytes);
    files[name] = {
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
    };
}

await writeFile(join(wasmDir, 'manifest.json'), JSON.stringify({ commit, files }, null, 2) + '\n');
process.stdout.write(`wasm/ updated from ${from} (ClickHouse ${commit})\n`);
