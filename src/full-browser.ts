import { createParser } from './parser.js';
import { instantiate, load } from './wasi-browser.js';

export type * from './types.js';

export const Parser = createParser({
    instantiate,
    load,
    wasmURL: new URL('../wasm/parser.wasm', import.meta.url),
});
