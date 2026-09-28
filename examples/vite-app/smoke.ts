/// Loads the production build in Chrome and checks that the parser really ran in the page: the
/// query was highlighted, validated and formatted. Run after `npm run build`.
///
///   node smoke.ts
///
/// Uses the Chrome installed on the machine (`playwright-core` downloads no browser); set
/// CHROME_PATH to use another Chrome or Chromium binary.
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const server = await preview({ preview: { port: 0, strictPort: false } });
const url = server.resolvedUrls?.local[0];
if (!url)
    throw new Error('vite preview did not report a URL');

const browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
let failed = false;
try
{
    const page = await browser.newPage();
    const problems: string[] = [];
    page.on('console', message =>
    {
        if (message.type() === 'error')
            problems.push(`console: ${message.text()}`);
    });
    page.on('pageerror', error => problems.push(`page error: ${error.message}`));
    page.on('requestfailed', request => problems.push(`request failed: ${request.url()}`));

    await page.goto(url);
    // `main.ts` writes the status line once both modules are instantiated and the first parse ran.
    const loaded = await page.waitForSelector('#status:has-text("Parsed in")', { timeout: 30_000 })
        .then(() => true, () => false);

    const text = (selector: string) => page.locator(selector).innerText();
    const html = (selector: string) => page.locator(selector).innerHTML();
    const checks: [string, boolean][] = [
        ['the module loaded and parsed', loaded],
        ['the default query is valid', loaded && (await text('#diagnostics')).includes('✓ Valid')],
        ['keywords are highlighted', loaded && (await html('#overlay')).includes('<span class="hl-keyword">select</span>')],
        ['functions are highlighted', loaded && (await html('#overlay')).includes('<span class="hl-function">toStartOfHour</span>')],
        ['the query is formatted', loaded && /^SELECT\n {4}toStartOfHour\(event_time\) AS hour/.test(await text('#formatted'))],
        ['the full build reports all features', loaded && (await text('#features')).includes('✓ AST JSON')],
    ];

    // Switching builds exercises the second module.
    if (loaded)
    {
        await page.selectOption('#build', 'slim');
        checks.push(['the slim build has no formatter',
            (await text('#formatted')).includes('format is not in this build')]);
    }

    for (const [name, ok] of checks)
    {
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
        failed ||= !ok;
    }
    if (failed)
        console.log(`\n${problems.join('\n') || 'no console errors'}\n\nstatus: ${await text('#status')}`);
}
finally
{
    await browser.close();
    await server.close();
}
process.exit(failed ? 1 : 0);
