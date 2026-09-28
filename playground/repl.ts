/// Local REPL against `@clickhouse/wasm-parser` via `file:..`. Run `npm run build` in `..` first,
/// then here: `npm install && npm start`.
import { start } from 'node:repl';
import { Parser } from '@clickhouse/wasm-parser';
import { Parser as SlimParser } from '@clickhouse/wasm-parser/slim';

await Parser.init();
await SlimParser.init();

process.stdout.write(
    'Parser is ready (also SlimParser).\n'
    + '  Parser.parse(\'SELECT 1\')\n'
    + '  Parser.format(\'select 1\', { oneLine: true })\n'
    + '  Parser.formatJson(Parser.parse(\'SELECT 1\').ast, { oneLine: true })\n'
    + '  Parser.features\n\n');

const server = start({ prompt: 'wasm-parser> ' });
server.context.Parser = Parser;
server.context.SlimParser = SlimParser;
