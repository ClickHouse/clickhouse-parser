/// Node host for the WASI reactor. Same path ClickHouse's `utils/wasm-parser/test.mjs` uses.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WASI } from 'node:wasi';
import type { Instantiate, Load } from './types.js';
import { load as fetchWasm } from './wasi-browser.js';

export const instantiate: Instantiate = async (bytes) =>
{
    const wasi = new WASI({ version: 'preview1', args: [], env: {}, returnOnExit: true });
    const { instance } = await WebAssembly.instantiate(bytes, wasi.getImportObject() as WebAssembly.Imports);
    wasi.initialize(instance);
    return instance;
};

/// `file:` URLs are read from disk; anything else is fetched.
export const load: Load = async (url) =>
{
    const href = url instanceof URL ? url.href : url;
    if (!href.startsWith('file:'))
        return fetchWasm(href);
    // `readFile` never returns a view over a `SharedArrayBuffer`.
    return await readFile(fileURLToPath(href)) as Uint8Array<ArrayBuffer>;
};
