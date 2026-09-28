export interface Highlight
{
    /** UTF-8 byte offset, not a JavaScript string index. */
    begin: number;
    /** UTF-8 byte offset, exclusive, not a JavaScript string index. */
    end: number;
    type: string;
}

export interface ParseError
{
    message: string;
    /** UTF-8 byte offset, not a JavaScript string index. */
    begin?: number;
    /** UTF-8 byte offset, exclusive, not a JavaScript string index. */
    end?: number;
    line?: number;
    column?: number;
    expected?: string[];
}

export interface ParseResult
{
    /** The tree as JSON. Absent from a build without AST JSON; `null` when `ast_error` is set. */
    ast?: unknown;
    /** Set when the query parsed but the module could not serialize its tree. */
    ast_error?: string;
    highlights?: Highlight[];
    error?: ParseError;
}

export interface FormatResult
{
    sql?: string;
    error?: ParseError;
}

export interface InitOptions
{
    url?: string | URL;
    bytes?: BufferSource;
}

export interface FormatOptions
{
    oneLine?: boolean;
}

export interface Features
{
    readonly format: boolean;
    readonly dcl: boolean;
    readonly astJson: boolean;
}

export interface Parser
{
    init(options?: InitOptions): Promise<void>;
    readonly features: Features;
    parse(sql: string): ParseResult;
    format(sql: string, options?: FormatOptions): FormatResult;
    formatJson(ast: unknown, options?: FormatOptions): FormatResult;
}

/// The C ABI of ClickHouse's `utils/wasm-parser/wasm_parser.cpp`. `ch_format` and
/// `ch_format_json` are absent from a build configured with `-DENABLE_FORMATTING=OFF`.
export interface ParserExports
{
    memory: WebAssembly.Memory;
    ch_alloc(size: number): number;
    ch_free(ptr: number): void;
    ch_parse(ptr: number, size: number): number;
    ch_format?(ptr: number, size: number, oneLine: number): number;
    ch_format_json?(ptr: number, size: number, oneLine: number): number;
    ch_result_data(): number;
    ch_result_size(): number;
    ch_features(): number;
}

export type Instantiate = (bytes: BufferSource) => Promise<WebAssembly.Instance>;

/// Fetches the module bytes for `Parser.init({ url })` and the default URL.
export type Load = (url: string | URL) => Promise<BufferSource>;
