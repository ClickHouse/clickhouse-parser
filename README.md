# `@clickhouse/wasm-parser`

The ClickHouse SQL parser, compiled to WebAssembly, with a small TypeScript
wrapper for Node.js and browsers. It gives you what the server's parser sees:
exact syntax errors with positions and what was expected next, parser-accurate
highlighting (also for incomplete SQL), the AST as JSON, and formatting.

> **Experimental.** The API is unstable and may change in any release.

- [Install](#install)
- [Usage](#usage)
- [API](#api)
- [Examples](#examples)
- [Playground](#playground)
- [Development](#development)
- [Updating the WebAssembly modules](#updating-the-webassembly-modules)

## Install

The package is not published to the npm registry yet, and the repository is
private. Install it from GitHub with an account that can read the repository;
npm builds it during install:

```bash
npm install git+ssh://git@github.com/ClickHouse/clickhouse-parser.git
```

Pin a commit or tag for reproducible installs by adding `#<sha-or-tag>`. In CI,
the job needs credentials for the repository, such as a deploy key or a token
with read access.

Requirements:

- **Node.js 22+**, or a browser with the WebAssembly exception-handling
  proposal (Chrome 95, Firefox 100, Safari 18.2).
- ES modules. There is no CommonJS build.

## Usage

### Node.js

```ts
import { Parser } from '@clickhouse/wasm-parser';

await Parser.init();

const { ast, highlights, error } = Parser.parse('SELECT number FROM numbers(10)');
const { sql } = Parser.format('select   1 as a,   2 as b', { oneLine: true });
// sql === 'SELECT 1 AS a, 2 AS b'
```

Node prints `ExperimentalWarning: WASI is an experimental feature` when the
package is imported. It comes from `node:wasi` and is harmless.

### Browsers and bundlers

The same import works in a browser. Bundlers that handle
`new URL('…', import.meta.url)`, such as Vite and webpack 5, emit the `.wasm`
file as an asset automatically, so `await Parser.init()` is enough. (Checked
with Vite 8.)

If yours does not, or you serve the file yourself, pass its URL or bytes:

```ts
// Vite: import the module as an asset URL
import wasmUrl from '@clickhouse/wasm-parser/wasm/parser.wasm?url';
await Parser.init({ url: wasmUrl });

// A file you host
await Parser.init({ url: '/assets/parser.wasm' });

// Bytes you already have
await Parser.init({ bytes: await (await fetch('/assets/parser.wasm')).arrayBuffer() });
```

The browser entrypoint does not import any `node:` module.

### The slim build

`@clickhouse/wasm-parser/slim` is the same API over a module about 40% of the
size (832 KB against 2.1 MB, before compression). It parses and highlights, but
has no formatter, no AST JSON, and does not accept access management (`GRANT`,
`CREATE USER`, …):

```ts
import { Parser } from '@clickhouse/wasm-parser/slim';

await Parser.init();
Parser.parse('SELECT 1');  // { highlights: [...] } (no `ast`)
Parser.format('SELECT 1'); // { error: { message: 'format is not in this build' } }
```

Use `Parser.features` to check at runtime which build you have.

### TypeScript

Types ship with the package. The result shapes are exported from both
entrypoints:

```ts
import { Parser, type ParseResult, type Highlight } from '@clickhouse/wasm-parser';
```

## API

| | |
| --- | --- |
| `Parser.init(options?)` | Loads and instantiates the module. Idempotent; concurrent calls share one load. If it fails, it can be called again. `options.url` (a string or `URL`) or `options.bytes` (a `BufferSource`) override the default module. |
| `Parser.features` | `{ format, dcl, astJson }`: what this build supports. |
| `Parser.parse(sql)` | Returns `{ ast?, highlights?, error? }`. |
| `Parser.format(sql, { oneLine? })` | Parses and pretty-prints. Returns `{ sql }` or `{ error }`. |
| `Parser.formatJson(ast, { oneLine? })` | Turns an AST (an object or a JSON string) back into SQL. Returns `{ sql }` or `{ error }`. |

Behavior to know:

- **Call `await Parser.init()` first.** Every other member throws a `TypeError`
  until it resolves. After that they are synchronous.
- **SQL errors never throw.** They come back as `error`: `message`, `begin`,
  `end`, `line`, `column`, and `expected`, the list of what the parser would
  have accepted at that point.
- **Incomplete SQL still highlights.** A failed parse returns `highlights` for
  everything before the error, which is what an editor needs while the user
  types.
- **Offsets are UTF-8 bytes, not string indices.** `highlights[].begin` / `end`
  and `error.begin` / `end` count UTF-8 bytes, end exclusive. They match
  JavaScript string indices only for ASCII; convert before slicing a string
  with non-ASCII characters in it.
- **AST JSON has a depth limit.** A very deep tree, past about 35 terms of
  `+` or 9 nested subqueries, still parses, but `ast` is `null` and
  `ast_error` says "Stack size too large". Highlighting, errors and
  formatting are unaffected.
- **URLs:** a string without a scheme (such as `/assets/parser.wasm`) is
  fetched. In Node, a filesystem path must be passed as a `file:` URL.

The JSON the parser produces (AST node shapes and highlight types) is
documented with the module itself in ClickHouse's
[`utils/wasm-parser` README](https://github.com/ClickHouse/ClickHouse/tree/master/utils/wasm-parser#the-json-api).

## Examples

![The browser example: live highlighting and errors while typing, formatting, the AST, and the slim build](examples/vite-app/demo.gif)

[`examples/vite-app`](examples/vite-app) is a Vite + TypeScript app that uses
the package in the browser. It has an editor with parser-accurate highlighting,
live syntax errors with the expected tokens, formatting, the AST and its round
trip, and a switch between the full and slim builds. It is also the reference
for integrating the package into a web app, including the byte-offset
conversion an editor needs.

```bash
npm install
cd examples/vite-app
npm install
npm run dev
```

CI builds it and loads it in headless Chrome to check that the parser runs in a
real browser.

## Playground

`playground/` is a Node.js REPL with both builds loaded, for trying queries in
a terminal. From the repository root:

```bash
npm install        # also builds dist/, which the playground uses
cd playground
npm install
npm start
```

`Parser` (full build) and `SlimParser` (slim build) are already initialized:

```text
wasm-parser> Parser.format('select a, b from t where x = 1').sql
'SELECT\n    a,\n    b\nFROM t\nWHERE x = 1'
```

Things to try:

- **Inspect the AST**:
  ```js
  const res = Parser.parse('SELECT number * 2 AS val FROM numbers(10) WHERE val > 5')
  console.dir(res.ast, { depth: null })
  // { type: 'SelectWithUnionQuery', union_mode: ..., list_of_selects: { ... }, ... }
  ```
- **Highlighting offsets**:
  ```js
  Parser.parse('SELECT 1').highlights
  // [ { begin: 0, end: 6, type: 'keyword' }, { begin: 7, end: 8, type: 'number' } ]
  ```
- **Incomplete SQL: what went wrong and what was expected**:
  ```js
  Parser.parse('SELECT a FROM t WHERE ')
  // {
  //   error: {
  //     message: 'Syntax error (query): failed at position 23 (end of query): ...',
  //     begin: 22, end: 22, line: 1, column: 23,
  //     expected: [ 'expression with optional alias', ... ]
  //   },
  //   highlights: [ { begin: 0, end: 6, type: 'keyword' }, ... ]
  // }
  ```
- **Format on one line**:
  ```js
  Parser.format('select   1 as a,   2 as b', { oneLine: true })
  // { sql: 'SELECT 1 AS a, 2 AS b' }
  ```
- **Round-trip the AST**:
  ```js
  Parser.formatJson(Parser.parse('SELECT 1').ast, { oneLine: true })
  // { sql: 'SELECT 1' }
  ```
- **Compare the builds**:
  ```js
  Parser.features     // { format: true, dcl: true, astJson: true }
  SlimParser.features // { format: false, dcl: false, astJson: false }
  SlimParser.format('SELECT 1')
  // { error: { message: 'format is not in this build' } }
  ```

Exit with `.exit` or Ctrl+D.

## Development

You need **Node.js 22.18+**. The tests and scripts are `.ts` files that Node
runs directly by stripping the types, and 22.18 is the first release that does
this without a flag. People who only use the package need Node 22+.

```bash
npm install        # installs TypeScript and builds dist/
npm test           # builds dist/, then runs test.ts against it
npm run typecheck  # builds dist/, then type-checks src/, scripts/ and test.ts
```

Layout:

| Path | What it is |
| --- | --- |
| `src/` | The wrapper, in TypeScript. `parser.ts` drives the module's C ABI; `wasi-node.ts` / `wasi-browser.ts` provide the WASI imports and loading for each host; `full-*.ts` / `slim-*.ts` are the entrypoints. |
| `dist/` | Compiled output with `.d.ts` files. This is what ships. Generated by `npm run build`; not committed. |
| `wasm/` | The two WebAssembly modules and `manifest.json`. Committed. |
| `test.ts` | The test suite. It runs against `dist/`, so it tests what actually ships. |
| `scripts/update-wasm.ts` | Replaces the modules in `wasm/` and rewrites the manifest. |
| `playground/` | The REPL. |
| `examples/vite-app/` | The browser example, with a headless Chrome smoke test (`npm test` there). |

CI (`.github/workflows/test.yml`) runs `npm ci`, `npm run typecheck` and
`npm test` on Node 22.18, the latest 22 and 24, and builds and smoke-tests the
browser example, for every pull request and push to `main`.

## Updating the WebAssembly modules

The modules come from the `Build (wasm_parser)` job in ClickHouse's MasterCI,
which compiles
[`utils/wasm-parser`](https://github.com/ClickHouse/ClickHouse/tree/master/utils/wasm-parser)
in two configurations:

- `wasm/parser.wasm`: everything (formatting, access management, AST JSON)
- `wasm/parser-no-formatting-no-dcl.wasm`: the slim build

`wasm/manifest.json` records the ClickHouse commit they came from and the
sha256 of each file. `npm test` fails if a module does not match the manifest,
so a commit can never pair modules from two different builds.

The job publishes to:

```text
https://clickhouse-builds.s3.amazonaws.com/REFs/master/<sha>/masterci/build_wasm_parser/parser.wasm
https://clickhouse-builds.s3.amazonaws.com/REFs/master/<sha>/masterci/build_wasm_parser/parser-no-formatting-no-dcl.wasm
```

It only runs on master commits that change the parser, so most commits have no
modules, and the bucket answers `403` rather than `404` for a missing file.
Find a commit where the job succeeded in the MasterCI workflow (not the merge
queue, which does not upload), then:

```bash
sha=<clickhouse-master-sha>
mkdir -p /tmp/wasm
for f in parser.wasm parser-no-formatting-no-dcl.wasm; do
  curl -fsSL -o "/tmp/wasm/$f" \
    "https://clickhouse-builds.s3.amazonaws.com/REFs/master/$sha/masterci/build_wasm_parser/$f"
done
node scripts/update-wasm.ts --from /tmp/wasm --commit "$sha"
npm test
```

Commit `wasm/` together, then bump `version` in `package.json` and release.
