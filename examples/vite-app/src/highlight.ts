import type { Highlight, ParseError } from '@clickhouse/wasm-parser';
import { byteToIndex } from './offsets.ts';

function escape(text: string): string
{
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/// Renders `sql` as HTML with one `<span class="hl-TYPE">` per highlight and the error range
/// marked, for the overlay behind the editor.
export function renderHighlighted(sql: string, highlights: Highlight[] = [], error?: ParseError): string
{
    const toIndex = byteToIndex(sql);
    const errorBegin = error?.begin === undefined ? -1 : toIndex(error.begin);
    const errorEnd = error?.end === undefined ? -1 : toIndex(error.end);

    // Highlights are ordered and do not overlap; walk them once and fill the gaps with plain text.
    let html = '';
    let at = 0;
    const text = (from: number, to: number): string =>
    {
        if (from >= to)
            return '';
        // An error at a position with no token (end of query) still needs something to point at.
        if (errorBegin >= from && errorBegin < to)
        {
            const end = Math.min(Math.max(errorEnd, errorBegin + 1), to);
            return escape(sql.slice(from, errorBegin))
                + `<mark class="error">${escape(sql.slice(errorBegin, end))}</mark>`
                + escape(sql.slice(end, to));
        }
        return escape(sql.slice(from, to));
    };

    for (const { begin, end, type } of highlights)
    {
        const from = toIndex(begin);
        const to = toIndex(end);
        html += text(at, from);
        html += `<span class="hl-${type}">${text(from, to)}</span>`;
        at = to;
    }
    html += text(at, sql.length);
    if (errorBegin >= sql.length)
        html += '<mark class="error eof"> </mark>';
    // A trailing newline in a <pre> collapses; keep the overlay the same height as the textarea.
    return html + '\n';
}
