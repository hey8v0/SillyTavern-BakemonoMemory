// Snapshots of every workbench page in headless Chrome, driven over the DevTools protocol (needs the harness server).
// Usage: node scripts/ui-harness/tools/snap-all.mjs <prefix> [port]   (env WIDTHS=1280,800,375 THEMES=day,night,tavern, CHROME=path)
//   -> scripts/ui-harness/.output/<prefix>-<width>-<theme>.json; compare with snapdiff.mjs. The mock chat gets the summary tree and 剧情状态 first.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const [prefix = 'base', port = '8765'] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}/`;
const profile = join(import.meta.dirname, '..', '.output', 'chrome-' + prefix);
const chrome = spawn(process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9334',
    `--user-data-dir=${profile}`, '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let target;
for (let i = 0; i < 40 && !target; i++) {
    await wait(250);
    try { target = (await (await fetch('http://127.0.0.1:9334/json/list')).json()).find(item => item.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', event => { const msg = JSON.parse(event.data); if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } });
const send = (method, params = {}) => new Promise(resolve => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
const run = async code => {
    const res = await send('Runtime.evaluate', { expression: `(async () => { ${code} })()`, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails) console.log('error', JSON.stringify(res.result.exceptionDetails).slice(0, 400));
    return res.result?.result?.value;
};

const setup = theme => `
  const w = ms => new Promise(r => setTimeout(r, ms));
  const click = el => el && el.click();
  const go = async name => { click(document.querySelector('[data-bakemono-tab="' + name + '"]') || document.querySelector('[data-bakemono-nav="' + name + '"]')); await w(700); };
  const rpClick = re => click([...document.querySelectorAll('#bakemono-rp-root [data-rp-action], #bakemono-rp-root button')].find(x => re.test(x.textContent)));
  await w(1500);
  click(document.getElementById('bakemono-memory-extension-open')); await w(900);
  await (await import('/tree-fixture.js')).addTree({ staleChapter: false });
  const m = await import('/script.js'); await m.eventSource.emit(m.event_types.MESSAGE_RECEIVED); await w(1200);
  await go('rp-state'); rpClick(/从这一轮开始/); await w(500); rpClick(/确认启用/); await w(1200);
  await m.eventSource.emit(m.event_types.MESSAGE_RECEIVED); await w(2500);
  await go('settings-hub'); await go('appearance');
  click(document.querySelector('.bk-look-mode[data-bakemono-theme-mode="${theme}"]')); await w(600);
  await go('overview');
  return (await import('/snap.js')).run('${prefix}-' + innerWidth + '-${theme}');
`;

for (const width of (process.env.WIDTHS || '1280,800,375').split(',').map(Number)) {
    for (const theme of (process.env.THEMES || 'day,night,tavern').split(',')) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
        await send('Page.navigate', { url: base + '?sum&rp' });
        await wait(1000);
        await run('localStorage.clear(); sessionStorage.clear();');
        await send('Page.navigate', { url: base + '?sum&rp' });
        await wait(width < 768 ? 3500 : 1500);
        console.log(width, theme, JSON.stringify(await run(setup(theme))));
    }
}
ws.close(); chrome.kill();
await wait(500);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
