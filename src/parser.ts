/// Shared `Parser` object: C ABI in ClickHouse's `utils/wasm-parser/wasm_parser.cpp`, driven
/// without Emscripten glue. `instantiate` and `load` come from `wasi-node.ts` or `wasi-browser.ts`. The
/// modules are committed under `wasm/` (`parser.wasm` / `parser-no-formatting-no-dcl.wasm`).

import type {
    FormatOptions,
    FormatResult,
    InitOptions,
    Instantiate,
    Load,
    ParseResult,
    Parser,
    ParserExports,
} from './types.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const NOT_INIT =
    'Parser.init() was not called; await Parser.init() first';

const NO_FORMAT = 'format is not in this build';

export function createParser(
    { instantiate, load, wasmURL }: { instantiate: Instantiate; load: Load; wasmURL: URL },
): Parser
{
    let exports_: ParserExports | null = null;
    let initPromise: Promise<void> | null = null;

    function requireReady(): ParserExports
    {
        if (exports_ === null)
            throw new TypeError(NOT_INIT);
        return exports_;
    }

    function call(entry: (ptr: number, size: number) => number, input: string): { ok: boolean; out: string }
    {
        const { memory, ch_alloc, ch_free, ch_result_data, ch_result_size } = requireReady();
        const bytes = encoder.encode(input);
        const ptr = ch_alloc(bytes.length);
        if (!ptr)
            throw new Error('ch_alloc returned null');
        new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
        try
        {
            const ok = entry(ptr, bytes.length);
            const out = decoder.decode(
                new Uint8Array(memory.buffer, ch_result_data(), ch_result_size()).slice());
            return { ok: !!ok, out };
        }
        finally
        {
            ch_free(ptr);
        }
    }

    const parser: Parser = {
        async init(options: InitOptions = {})
        {
            if (initPromise)
                return initPromise;

            initPromise = (async () =>
            {
                const bytes = options.bytes ?? await load(options.url ?? wasmURL);
                const instance = await instantiate(bytes);
                exports_ = instance.exports as unknown as ParserExports;
            })();

            try
            {
                await initPromise;
            }
            catch (error)
            {
                initPromise = null;
                throw error;
            }
        },

        get features()
        {
            const mask = requireReady().ch_features();
            return {
                format: (mask & 1) !== 0,
                dcl: (mask & 2) !== 0,
                astJson: (mask & 4) !== 0,
            };
        },

        parse(sql: string): ParseResult
        {
            const result = call(requireReady().ch_parse, sql);
            try
            {
                return JSON.parse(result.out);
            }
            catch
            {
                return { error: { message: result.out } };
            }
        },

        format(sql: string, options: FormatOptions = {}): FormatResult
        {
            const ch_format = requireReady().ch_format;
            if (typeof ch_format !== 'function')
                return { error: { message: NO_FORMAT } };
            const result = call((ptr, len) => ch_format(ptr, len, options.oneLine ? 1 : 0), sql);
            if (result.ok)
                return { sql: result.out };
            return { error: { message: result.out } };
        },

        formatJson(ast: unknown, options: FormatOptions = {}): FormatResult
        {
            const ch_format_json = requireReady().ch_format_json;
            if (typeof ch_format_json !== 'function')
                return { error: { message: NO_FORMAT } };
            const input = typeof ast === 'string' ? ast : JSON.stringify(ast);
            const result = call(
                (ptr, len) => ch_format_json(ptr, len, options.oneLine ? 1 : 0),
                input);
            if (result.ok)
                return { sql: result.out };
            return { error: { message: result.out } };
        },
    };

    return parser;
}
