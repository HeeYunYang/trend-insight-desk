// Vault end-to-end test with a simulated GitHub contents API.
// Usage: node tools/test_vault.js <base_url> <vault_json_path> <passphrase> <out_json>
const { chromium } = require('playwright');
const fs = require('fs');
const [BASE, VAULT, PASS, OUT] = process.argv.slice(2);
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); };
const IGNORE = /fonts\.(googleapis|gstatic)|ERR_TUNNEL|net::ERR_/;

let file = fs.readFileSync(VAULT, 'utf8'); let sha = 'sha0'; let puts = 0, conflictOnce = false, gets = 0;
const TOKEN = 'github_pat_' + 'A'.repeat(40);
async function api(route) {
  const req = route.request(); const auth = req.headers()['authorization'];
  if (auth !== 'Bearer ' + TOKEN) return route.fulfill({ status: 401, body: '{"message":"Bad credentials"}' });
  if (req.method() === 'GET') { gets++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha, content: Buffer.from(file).toString('base64').replace(/(.{60})/g, '$1\n') }) }); }
  if (req.method() === 'PUT') {
    const b = JSON.parse(req.postData());
    if (conflictOnce) { conflictOnce = false; sha = sha + 'x'; return route.fulfill({ status: 409, body: '{"message":"conflict"}' }); }
    if (b.sha !== sha) return route.fulfill({ status: 409, body: '{"message":"sha mismatch"}' });
    file = Buffer.from(b.content, 'base64').toString('utf8'); sha = 'sha' + (++puts);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha } }) });
  }
  route.fulfill({ status: 405 });
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => { window.TD_CONFIG = { owner: 'test', repo: 'trend-desk' }; });
  await ctx.route('https://api.github.com/**', api);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text()) && !/401|409/.test(m.text())) errs.push(m.text()); });
  await p.goto(BASE); await p.waitForTimeout(600);
  await p.click('#t-mine');
  // wrong passphrase
  await p.fill('#p-mine #vault-pass', 'wrong'); await p.click('#p-mine #unlockform button');
  await p.waitForFunction(() => /암호가 맞지 않습니다/.test(document.querySelector('#p-mine #unlock-msg')?.textContent || ''), null, { timeout: 15000 });
  // right passphrase
  await p.fill('#p-mine #vault-pass', PASS); await p.click('#p-mine #unlockform button');
  await p.waitForSelector('#p-mine #pf-insight', { timeout: 15000 });
  const ins = await p.$$eval('#p-mine .signal', x => x.map(e => e.textContent));
  ok(ins.length === 2 && ins.join().includes('웹에서 씀') && ins.join().includes('db 최신'), 'insights after unlock: ' + ins.length);
  await p.click('#t-field');
  ok((await p.$$('#p-field .signal')).length === 2, 'signals after unlock');
  ok(await p.isVisible('#p-field #tokenform'), 'token form shown before token');
  // writing without token fails with a clear message
  await p.click('#t-mine'); await p.fill('#pf-insight-text', '토큰 없이'); await p.click('#pf-insight button[type=submit]');
  await p.waitForSelector('.toast', { timeout: 5000 }); ok(/토큰/.test(await p.textContent('.toast')), 'no-token message');
  // bad token format, then good token
  await p.fill('#p-mine #gh-token', 'nope'); await p.click('#p-mine #tokenform button[type=submit]'); await p.waitForTimeout(200);
  ok(/형식/.test(await p.textContent('#p-mine #token-msg')), 'bad token format message');
  await p.fill('#p-mine #gh-token', TOKEN); await p.click('#p-mine #tokenform button[type=submit]');
  await p.waitForFunction(() => window.TD_VAULT.canWrite(), null, { timeout: 15000 });
  // add (with a conflict on the first PUT)
  conflictOnce = true;
  await p.fill('#pf-insight-title', '웹 제목'); await p.fill('#pf-insight-text', '웹에서 새로 쓴 인사이트'); await p.fill('#pf-insight-tags', '웹, 테스트');
  await p.click('#pf-insight button[type=submit]');
  await p.waitForFunction(() => [...document.querySelectorAll('#p-mine .signal')].some(e => e.textContent.includes('웹에서 새로 쓴 인사이트')), null, { timeout: 20000 });
  ok(puts === 1, 'one successful PUT after conflict retry: ' + puts);
  // edit
  const id = await p.$eval('#p-mine .signal', e => e.id.replace('pe-', ''));
  await p.click(`#pe-${id} [data-pedit]`); await p.fill('#pf-insight-text', '웹에서 고친 인사이트'); await p.click('#pf-insight button[type=submit]');
  await p.waitForFunction(() => [...document.querySelectorAll('#p-mine .signal')].some(e => e.textContent.includes('웹에서 고친 인사이트')), null, { timeout: 20000 });
  // signal add + delete
  await p.click('#t-field'); await p.fill('#pf-signal-text', '웹 신호'); await p.click('#pf-signal button[type=submit]');
  await p.waitForFunction(() => document.querySelectorAll('#p-field .signal').length === 3, null, { timeout: 20000 });
  const sid = await p.$eval('#p-field .signal', e => e.id.replace('pe-', ''));
  await p.click(`#pe-${sid} [data-pdel]`); await p.click(`#pe-${sid} [data-pdel]`);
  await p.waitForFunction(() => document.querySelectorAll('#p-field .signal').length === 2, null, { timeout: 20000 });
  // reload: token survives on this device, still needs passphrase
  await p.reload(); await p.waitForTimeout(500); await p.click('#t-mine');
  ok(await p.isVisible('#p-mine #unlockform'), 'locked again after reload');
  await p.fill('#p-mine #vault-pass', PASS); await p.click('#p-mine #unlockform button');
  await p.waitForSelector('#p-mine #pf-insight', { timeout: 15000 });
  ok(await p.evaluate(() => window.TD_VAULT.canWrite()), 'token restored after reload');
  ok(!(await p.evaluate(() => localStorage.getItem('td-vault-token-v1') || '')).includes('github_pat_'), 'token stored in plaintext!');
  // lock
  await p.$eval('#p-mine details:has(#tokenform)', d => d.open = true); await p.click('#p-mine #lockbtn');
  ok(await p.isVisible('#p-mine #unlockform'), 'lock button');
  ok(await p.evaluate(() => document.body.innerText.includes('웹에서 고친 인사이트')) === false, 'content visible after lock');
  ok(errs.length === 0, 'errors: ' + errs.join(' | '));
  fs.writeFileSync(OUT, file);
  await b.close();
  console.log(fails.length ? 'FAIL\n- ' + fails.join('\n- ') : 'VAULT CHECKS PASSED (puts=' + puts + ', gets=' + gets + ')');
  process.exit(fails.length ? 1 : 0);
})();
