// End-to-end check of the static site. Usage: node tools/test_site.js http://127.0.0.1:8765/
const { chromium } = require('playwright');
const BASE = process.argv[2];
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const IGNORE = /fonts\.(googleapis|gstatic)|ERR_TUNNEL|net::ERR_/;

async function page(b, opts = {}) {
  const ctx = await b.newContext({ viewport: opts.vp || { width: 390, height: 844 }, colorScheme: opts.scheme || 'light', isMobile: !!opts.mobile, hasTouch: !!opts.mobile });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push('console: ' + m.text()); });
  p.on('requestfailed', r => { if (!IGNORE.test(r.url()) && !IGNORE.test(r.failure()?.errorText || '')) errs.push('requestfailed: ' + r.url()); });
  if (opts.route) await p.route('**/data/bundle.json*', opts.route);
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForTimeout(700);
  return { p, errs, ctx };
}
const noOverflow = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const tab = async (p, id) => { await p.click('#' + id); await p.waitForTimeout(150); };

(async () => {
  const b = await chromium.launch();
  for (const cfg of [{ vp: { width: 390, height: 844 }, scheme: 'light', mobile: true, name: 'phone-light' },
                     { vp: { width: 390, height: 844 }, scheme: 'dark', mobile: true, name: 'phone-dark' },
                     { vp: { width: 1280, height: 900 }, scheme: 'light', name: 'desktop-light' },
                     { vp: { width: 1280, height: 900 }, scheme: 'dark', name: 'desktop-dark' }]) {
    const { p, errs, ctx } = await page(b, cfg);
    const N = cfg.name;
    // header + data loaded
    ok(/업데이트/.test(await p.textContent('#syncline')), N + ': update time missing in header');
    ok(await p.isHidden('#td-banner').catch(() => true), N + ': error banner visible on good data');
    ok(await p.isVisible('#t-mine') && await p.isVisible('#t-field'), N + ': private tabs missing');
    await tab(p, 't-mine'); ok(await p.isVisible('#unlockform'), N + ': vault lock form missing');
    // brief
    await tab(p, 't-brief');
    ok((await p.$$('#p-brief .card')).length >= 3, N + ': brief deep cards missing');
    ok((await p.$$('#p-brief ul.items li')).length >= 10, N + ': brief items missing');
    ok(!(await p.textContent('#p-brief')).includes('불러오는 중'), N + ': brief stuck loading');
    const nOpts = await p.$$eval('#bsel option', o => o.length); ok(nOpts >= 4, N + ': date options');
    await p.click('#bprev'); await p.waitForTimeout(100);
    ok((await p.$eval('#bsel', s => s.value)) === '1', N + ': prev date did not move');
    await p.click('#bnext'); await p.waitForTimeout(100);
    await p.selectOption('#bsel', String(nOpts - 1)); await p.waitForTimeout(100);
    ok((await p.$$('#p-brief .card')).length >= 1, N + ': oldest brief renders');
    await p.selectOption('#bsel', '0'); await p.waitForTimeout(100);
    const chips = await p.$$('#ffilter .chip'); if (chips.length > 1) { await chips[1].click(); await p.waitForTimeout(100); }
    ok((await p.$$('#p-brief [data-act]:visible')).length === 0, N + ': write buttons visible in brief');
    ok(await noOverflow(p), N + ': brief overflows horizontally');
    // indicators
    await tab(p, 't-ind');
    ok((await p.$$('#p-ind .gauge')).length === 3, N + ': gauges');
    ok((await p.$$('#p-ind .moved .icard')).length >= 1, N + ': moved cards');
    ok((await p.$$('#p-ind details.group')).length === 10, N + ': 10 question groups');
    const empty = await p.$$eval('#p-ind details.group .icard', cs => cs.filter(c => /값 수집 중|값을 모으는 중/.test(c.textContent)).map(c => c.id));
    ok(empty.length === 0, N + ': indicators without data: ' + empty.join(','));
    const nCards = await p.$$eval('#p-ind details.group .icard', cs => cs.length); ok(nCards === 38, N + ': library cards = ' + nCards);
    const calc = await p.$$eval('#p-ind details.group .icard', cs => cs.filter(c => !c.textContent.includes('어떻게 계산되나')).map(c => c.id));
    ok(calc.length === 0, N + ': missing how_calc: ' + calc.join(','));
    // open every group, flip a period, jump via map + related chip
    await p.$$eval('#p-ind details.group', ds => ds.forEach(d => d.open = true));
    await p.$eval('#p-ind details.group .icard details.back', d => d.open = true);
    const per = await p.$('#p-ind details.group .icard details.back[open] [data-per="1m"]'); ok(!!per, N + ': period button');
    if (per) { await per.click(); await p.waitForTimeout(200); ok(await p.$eval('#p-ind details.group .icard details.back', d => d.open), N + ': card closed after period change'); }
    ok((await p.$$('#p-ind details.group[open]')).length === 10, N + ': groups closed after period change');
    const node = await p.$('svg.map [data-node="brent"]'); ok(!!node, N + ': map node');
    if (node) { await node.click(); await p.waitForTimeout(300); }
    const chip = p.locator('#p-ind [data-jump]:visible').first(); ok(await chip.count() === 1, N + ': related chip'); if (await chip.count()) { await chip.click(); await p.waitForTimeout(400); }
    // nationalism layer: closing group, map nodes, force chips, driver names
    ok((await p.$$('#p-ind details.group[data-group="closing"] .icard')).length === 4, N + ': closing group cards');
    ok(!!(await p.$('svg.map [data-node="us_tariff"]')) && !!(await p.$('svg.map [data-node="politics"]')), N + ': politics/tariff map nodes');
    const nanText = await p.$$eval('#p-ind svg.spark', ss => ss.filter(s => /NaN|undefined/.test(s.outerHTML)).length);
    ok(nanText === 0, N + ': NaN/undefined in charts: ' + nanText);
    ok(await noOverflow(p), N + ': indicators overflow horizontally');
    // story link from indicator -> stories tab
    const sl = p.locator('#p-ind .storylink:visible').first(); if (await sl.count()) { await sl.click(); await p.waitForTimeout(200); ok(await p.isVisible('#p-stories'), N + ': storylink did not switch tab'); }
    // stories
    await tab(p, 't-stories');
    ok((await p.$$('#p-stories .story')).length >= 5, N + ': stories');
    ok((await p.$$('#p-stories .chip.force')).length >= 5, N + ': force chips');
    const fc = p.locator('#p-stories .chip.force', { hasText: '자국주의' }).first();
    if (await fc.count()) { await fc.click(); await p.waitForTimeout(200); ok(await p.isVisible('#sv-politics'), N + ': force chip -> slow row'); } else ok(false, N + ': politics chip missing');
    await tab(p, 't-stories');
    ok(await noOverflow(p), N + ': stories overflow');
    // trends / slow / predictions
    await tab(p, 't-trends');
    ok((await p.$$('#p-trends .trend')).length >= 2, N + ': trends');
    ok((await p.$$('#p-trends [data-act]:visible, #p-trends select:visible, #p-trends input:visible')).length === 0, N + ': trend controls visible');
    ok(!/\bpolitics\b|\brates\b/.test(await p.textContent('#p-trends')), N + ': raw driver ids shown');
    await tab(p, 't-slow');
    ok((await p.$$('#p-slow tbody tr')).length === 13, N + ': slow vars');
    await tab(p, 't-pred');
    ok(await p.isHidden('#predform'), N + ': prediction form visible');
    ok(await noOverflow(p), N + ': predictions overflow');
    await p.screenshot({ path: `tools/shot-${N}.png`, fullPage: false });
    ok(errs.length === 0, N + ': errors: ' + errs.join(' | '));
    await ctx.close();
  }
  // missing bundle -> banner, no crash
  {
    const { p, errs, ctx } = await page(b, { route: r => r.fulfill({ status: 404, body: 'nope' }) });
    ok(await p.isVisible('#td-banner'), '404: banner not shown');
    ok(errs.filter(e => !/404|Not Found/i.test(e)).length === 0, '404: errors ' + errs.join(' | '));
    await ctx.close();
  }
  // malformed bundle -> banner, no crash
  {
    const { p, errs, ctx } = await page(b, { route: r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"oops":' }) });
    ok(await p.isVisible('#td-banner'), 'bad json: banner not shown');
    ok(errs.length === 0, 'bad json: errors ' + errs.join(' | '));
    await ctx.close();
  }
  // manifest + icons reachable
  {
    const ctx = await b.newContext(); const p = await ctx.newPage();
    for (const u of ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'data/bundle.json']) {
      const r = await p.request.get(BASE + u); ok(r.ok(), 'missing ' + u);
    }
    const m = await (await p.request.get(BASE + 'manifest.webmanifest')).json(); ok(m.name && m.icons.length === 2, 'manifest content');
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? 'FAIL\n- ' + fails.join('\n- ') : 'ALL CHECKS PASSED');
  process.exit(fails.length ? 1 : 0);
})();
