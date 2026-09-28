// The integration itself is the first ten lines: import a build, `await init()`, then call it
// synchronously. Vite sees `new URL('../wasm/parser.wasm', import.meta.url)` inside the package
// and emits the module as an asset, so no configuration is needed.
import { Parser as FullParser, type ParseResult } from '@clickhouse/wasm-parser';
import { Parser as SlimParser } from '@clickhouse/wasm-parser/slim';
import { renderHighlighted } from './highlight.ts';
import { byteToIndex } from './offsets.ts';

const loadStart = performance.now();
await Promise.all([FullParser.init(), SlimParser.init()]);
const loadMs = performance.now() - loadStart;

const SAMPLES: Record<string, string> = {
    'Select with aggregation':
        'select toStartOfHour(event_time) as hour, count() as hits, uniq(user_id) as users\n'
        + 'from events where event_date >= today() - 7 and path like \'/api/%\'\n'
        + 'group by hour order by hour desc limit 24',
    'Incomplete (autocomplete)': 'SELECT a, b FROM t WHERE ',
    'Syntax error': 'SELECT count() FROM t GROUP BY GROUP BY x',
    'CTE, window function, lambda':
        'with top as (select user_id, sum(amount) as total from orders group by user_id)\n'
        + 'select user_id, total, rank() over (order by total desc) as r,\n'
        + '  arrayMap(x -> x * 2, [1, 2, 3]) as doubled\n'
        + 'from top where total > 100 settings max_threads = 8',
    'DDL': 'create table t (id UInt64, name String, ts DateTime64(3)) engine = MergeTree order by (id, ts) partition by toYYYYMM(ts)',
    'Access management (not in slim)': 'GRANT SELECT ON db.* TO analyst WITH GRANT OPTION',
    'Non-ASCII text': "SELECT 'café ☕' AS drink, `名前` FROM `données` WHERE city = 'São Paulo'",
    'Query parameters': 'SELECT * FROM t WHERE id = {id:UInt64} AND name = {name:String}',
};

const $ = <T extends HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const sql = $<HTMLTextAreaElement>('#sql');
const overlay = $('#overlay');
const status = $('#status');
const diagnostics = $('#diagnostics');
const features = $('#features');
const buildSelect = $<HTMLSelectElement>('#build');
const sampleSelect = $<HTMLSelectElement>('#sample');
const oneLine = $<HTMLInputElement>('#one-line');
const formatted = $('#formatted');
const applyFormat = $<HTMLButtonElement>('#apply-format');
const astView = $('#ast');
const roundtrip = $('#roundtrip');
const tokens = $('#tokens');

const escape = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function parser()
{
    return buildSelect.value === 'slim' ? SlimParser : FullParser;
}

function renderDiagnostics(result: ParseResult, ms: number): void
{
    status.textContent = `Parsed in ${ms.toFixed(2)} ms · module loaded in ${loadMs.toFixed(0)} ms`;
    const { error } = result;
    if (!error)
    {
        diagnostics.className = 'diagnostics ok';
        diagnostics.innerHTML = '<strong>✓ Valid</strong>';
        return;
    }
    diagnostics.className = 'diagnostics error';
    const where = error.line === undefined ? '' : ` at line ${error.line}, column ${error.column}`;
    // `expected` is the structured form of the message's "Expected ..." tail; show it once.
    const list = error.expected ?? [];
    const tail = error.message.lastIndexOf('. Expected');
    const message = list.length && tail >= 0 ? error.message.slice(0, tail + 1) : error.message;
    const chips = (items: string[]) => items.map(e => `<code>${escape(e)}</code>`).join(' ');
    const SHOWN = 12;
    const expected = list.length === 0 ? '' : `<div class="expected">Expected: ${chips(list.slice(0, SHOWN))}${
        list.length > SHOWN
            ? ` <details><summary>${list.length - SHOWN} more</summary>${chips(list.slice(SHOWN))}</details>`
            : ''}</div>`;
    diagnostics.innerHTML = `<strong>✗ Syntax error${where}</strong>
        <div class="message">${escape(message)}</div>${expected}`;
}

function renderFeatures(): void
{
    const f = parser().features;
    features.innerHTML = Object.entries({ format: f.format, 'access management': f.dcl, 'AST JSON': f.astJson })
        .map(([name, on]) => `<span class="badge ${on ? 'on' : 'off'}">${on ? '✓' : '✗'} ${name}</span>`)
        .join('');
}

function renderFormat(): void
{
    const result = parser().format(sql.value, { oneLine: oneLine.checked });
    formatted.classList.toggle('muted', result.sql === undefined);
    formatted.textContent = result.sql ?? (parser().features.format
        ? 'Nothing to format: the query has a syntax error.'
        : result.error?.message ?? '');
    applyFormat.disabled = result.sql === undefined || result.sql === sql.value;
}

function renderAst(result: ParseResult): void
{
    if (result.ast === undefined || result.ast === null)
    {
        // `ast_error` is set when the query parsed but the module could not serialize its tree.
        astView.textContent = result.ast_error
            ? `The query parsed, but the module could not produce its AST JSON: ${result.ast_error}`
            : parser().features.astJson
                ? 'No AST: the query does not parse.'
                : 'This build has no AST JSON.';
        roundtrip.textContent = '';
        return;
    }
    astView.textContent = JSON.stringify(result.ast, null, 2);
    const back = parser().formatJson(result.ast, { oneLine: true });
    roundtrip.textContent = back.sql ?? back.error?.message ?? '';
}

function renderTokens(result: ParseResult): void
{
    const toIndex = byteToIndex(sql.value);
    tokens.innerHTML = (result.highlights ?? [])
        .map(({ begin, end, type }) => `<tr><td>${begin}–${end}</td>`
            + `<td><span class="hl-${type}">${type}</span></td>`
            + `<td><code>${escape(sql.value.slice(toIndex(begin), toIndex(end)))}</code></td></tr>`)
        .join('');
}

function update(): void
{
    const start = performance.now();
    const result = parser().parse(sql.value);
    const ms = performance.now() - start;

    overlay.innerHTML = renderHighlighted(sql.value, result.highlights, result.error);
    renderDiagnostics(result, ms);
    renderFeatures();
    renderFormat();
    renderAst(result);
    renderTokens(result);
}

sampleSelect.innerHTML = Object.keys(SAMPLES)
    .map(name => `<option>${escape(name)}</option>`).join('');
sampleSelect.addEventListener('change', () =>
{
    sql.value = SAMPLES[sampleSelect.value]!;
    update();
});
sql.addEventListener('input', update);
sql.addEventListener('scroll', () =>
{
    overlay.scrollTop = sql.scrollTop;
    overlay.scrollLeft = sql.scrollLeft;
});
buildSelect.addEventListener('change', update);
oneLine.addEventListener('change', renderFormat);
applyFormat.addEventListener('click', () =>
{
    const result = parser().format(sql.value, { oneLine: oneLine.checked });
    if (result.sql === undefined)
        return;
    sql.value = result.sql;
    update();
});

for (const tab of document.querySelectorAll<HTMLButtonElement>('[role=tab]'))
{
    tab.addEventListener('click', () =>
    {
        for (const other of document.querySelectorAll<HTMLButtonElement>('[role=tab]'))
            other.setAttribute('aria-selected', String(other === tab));
        for (const panel of document.querySelectorAll<HTMLElement>('[data-panel]'))
            panel.hidden = panel.dataset.panel !== tab.dataset.tab;
    });
}

sql.value = SAMPLES[sampleSelect.value]!;
update();
