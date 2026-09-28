/// The parser reports UTF-8 byte offsets; JavaScript strings are indexed in UTF-16 code units.
/// They agree only for ASCII, so any UI that maps a highlight or an error back onto the text
/// needs this conversion.

const encoder = new TextEncoder();

/// Returns a function mapping a UTF-8 byte offset into `text` to the matching string index.
/// Offsets inside a multi-byte character map to the start of that character.
export function byteToIndex(text: string): (byteOffset: number) => number
{
    const bytes = encoder.encode(text).length;
    const indices = new Uint32Array(bytes + 1);
    let byte = 0;
    let index = 0;
    for (const char of text)
    {
        const width = encoder.encode(char).length;
        indices.fill(index, byte, byte + width);
        byte += width;
        index += char.length;
    }
    indices[bytes] = text.length;
    return (byteOffset) => indices[Math.min(Math.max(byteOffset, 0), bytes)]!;
}
