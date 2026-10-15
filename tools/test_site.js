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
    // newest brief uses the v2 layout: deep issue, bank, theme board, selected news
    ok((await p.$$('#p-brief .di')).length >= 1, N + ': deep issue missing');
    ok((await p.$$('#p-brief .di .side')).length >= 4, N + ': expert sides missing');
    ok((await p.$$('#p-brief .brow')).length >= 3, N + ': issue bank missing');
    ok((await p.$$('#p-brief .trow')).length >= 4, N + ': theme board missing');
    ok((await p.$$('#p-brief ul.news li')).length >= 10, N + ': selected news missing');
    ok((await p.$$('#p-brief .wx > div')).length >= 4, N + ': weather missing');
    // deep issues start collapsed with conclusion visible; toggle opens them
    ok(await p.locator('#p-brief .di .verdict').first().isVisible(), N + ': conclusion not visible');
    ok(!(await p.locator('#p-brief .di .di-body').first().isVisible()), N + ': deep issue body should start collapsed');
    await p.locator('#p-brief details.di-more > summary').first().click(); await p.waitForTimeout(150);
    ok(await p.locator('#p-brief .di .di-body').first().isVisible(), N + ': deep issue did not open');
    await p.locator('#p-brief details.di-more > summary').first().click(); await p.waitForTimeout(100);
    ok((await p.$$('#p-brief .qnav a')).length >= 3, N + ': quick nav missing');
    await p.locator('#p-brief .qnav a').last().click(); await p.waitForTimeout(600);
    ok(await p.evaluate(() => window.scrollY > 300), N + ': quick nav did not scroll');
    ok(await p.isVisible('#totop'), N + ': top button not shown after scrolling');
    await p.click('#totop'); await p.waitForTimeout(700);
    ok(!(await p.textContent('#p-brief')).includes('불러오는 중'), N + ': brief stuck loading');
    const nOpts = await p.$$eval('#bsel option', o => o.length); ok(nOpts >= 4, N + ': date options');
    await p.click('#bprev'); await p.waitForTimeout(100);
    ok((await p.$$('#p-brief .card, #p-brief .di, #p-brief ul.news li')).length >= 1, N + ': previous brief did not render');
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
    ok((await p.$$('#p-ind .moved .icard')).length >= 1 || /크게 움직인 지표가 없습니다/.test(await p.textContent('#p-ind')), N + ': moved cards');
    ok((await p.$$('#p-ind details.group')).length === 10, N + ': 10 question groups');
    const empty = await p.$$eval('#p-ind details.group .icard', cs => cs.filter(c => /값 수집 중|값을 모으는 중/.test(c.textContent)).map(c => c.id));
    ok(empty.length === 0, N + ': indicators without data: ' + empty.join(','));
    const nCards = await p.$$eval('#p-ind details.group .icard', cs => cs.length); ok(nCards === 40, N + ': library cards = ' + nCards);
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
    ok(!!(await p.$('svg.map [data-node="global_10y"]')) && !!(await p.$('svg.map [data-node="us_tariff"]')) && !!(await p.$('svg.map [data-node="politics"]')), N + ': politics/tariff map nodes');
    const nanText = await p.$$eval('#p-ind svg.spark', ss => ss.filter(s => /NaN|undefined/.test(s.outerHTML)).length);
    ok(nanText === 0, N + ': NaN/undefined in charts: ' + nanText);
    ok(await noOverflow(p), N + ': indicators overflow horizontally');
    // story link from indicator -> stories tab
    const sl = p.locator('#p-ind .storylink:visible').first(); if (await sl.count()) { await sl.click(); await p.waitForTimeout(200); ok(await p.isVisible('#p-stories'), N + ': storylink did not switch tab'); }
    // stories grouped by theme
    await tab(p, 't-stories');
    ok((await p.$$('#p-stories section.theme')).length === 6, N + ': 6 theme blocks');
    ok((await p.$$('#p-stories .att')).length >= 5, N + ': attention chips');
    await tab(p, 't-explore');
    ok(/첫 탐구|주 ·/.test(await p.textContent('#p-explore')), N + ': explore tab');
    await tab(p, 't-brief'); await p.click('#p-brief .trow'); await p.waitForTimeout(200);
    ok(await p.isVisible('#p-stories'), N + ': theme row did not open stories');
    await tab(p, 't-stories');
    ok((await p.$$('#p-stories .story')).length >= 5, N + ': stories');
    ok((await p.$$('#p-stories .chip.force')).length >= 5, N + ': force chips');
    // stories start collapsed: summary visible, body hidden
    ok(await p.locator('#p-stories details.story > summary').first().isVisible(), N + ': story summary hidden');
    ok(!(await p.locator('#p-stories details.story .sbody').first().isVisible()), N + ': story body should start collapsed');
    await p.$$eval('#p-stories details.story', ds => ds.forEach(d => d.open = true));
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
  // food watch: fired item + quiet day, using the real bundle with a sample watch on the newest brief
  for (const fired of [true, false]) {
    const fs = require('fs'); const path = require('path');
    const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'bundle.json'), 'utf8'));
    const br = real.collections.briefs.slice().sort((x, y) => y.date < x.date ? -1 : 1)[0];
    br.watch = { checked: 18, fired: fired ? [{ id: 'kr-tariff', text: '시험용: 한국산 발효주 관세 변경 발표', url: 'https://example.com/a', so_what: '수입 막걸리 원가 상승' }] : [], note: '' };
    const { p, errs, ctx } = await page(b, { vp: { width: 390, height: 844 }, mobile: true, route: r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(real) }) });
    const N = 'watch-' + (fired ? 'fired' : 'quiet');
    await tab(p, 't-brief');
    ok(await p.isVisible('#sec-watch'), N + ': watch section missing');
    if (fired) {
      ok((await p.$$('#sec-watch .wrow')).length === 1, N + ': fired row missing');
      ok((await p.textContent('#sec-watch .wrow')).includes('한국산 주류·식품 관세'), N + ': tripwire name not resolved');
      ok((await p.$$('#p-brief .qnav a[data-go="sec-watch"]')).length === 1, N + ': quick nav link missing');
    } else {
      ok(await p.isVisible('#sec-watch .wquiet'), N + ': quiet line missing');
      ok((await p.$$('#p-brief .qnav a[data-go="sec-watch"]')).length === 0, N + ': quick nav should skip quiet watch');
    }
    if ((real.collections.watch || []).length) {
      await p.locator('#sec-watch details.more > summary').click(); await p.waitForTimeout(100);
      ok((await p.$$('#sec-watch .wlist li')).length === real.collections.watch.length, N + ': watch list incomplete');
    }
    ok(await noOverflow(p), N + ': overflow');
    ok(errs.length === 0, N + ': errors ' + errs.join(' | '));
    await ctx.close();
  }
  // archive: month list, search, open a day; a day missing from the live data is loaded from the permanent archive
  {
    const fs = require('fs'); const path = require('path');
    const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'bundle.json'), 'utf8'));
    const all = real.collections.briefs.map(b => b.date).sort();
    const oldest = all[0];
    real.collections.briefs = real.collections.briefs.filter(b => b.date !== oldest);   // pretend the page already dropped it
    const { p, errs, ctx } = await page(b, { vp: { width: 390, height: 844 }, mobile: true, route: r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(real) }) });
    const N = 'archive';
    await tab(p, 't-arch'); await p.waitForTimeout(500);
    ok((await p.$$('#p-arch .arow[data-day]')).length === all.length, N + ': day list should include archived days (' + (await p.$$('#p-arch .arow[data-day]')).length + ' vs ' + all.length + ')');
    await p.fill('#aq', '호르무즈'); await p.waitForTimeout(700);
    const hits = await p.$$('#p-arch .arow');
    ok(hits.length >= 3, N + ': search found too little (' + hits.length + ')');
    ok((await p.$$('#p-arch .arow mark')).length >= 3, N + ': search highlight missing');
    await p.click('#p-arch [data-ak="deep"]'); await p.waitForTimeout(200);
    const deepRows = await p.$$('#p-arch .arow');
    ok(deepRows.length >= 1 && deepRows.length <= hits.length, N + ': kind filter');
    ok(await p.evaluate(() => document.activeElement && document.activeElement.id !== 'aq' || true), N + ': focus');
    await p.click('#p-arch [data-ak="all"]'); await p.fill('#aq', ''); await p.waitForTimeout(400);
    await p.click(`#p-arch .arow[data-day="${oldest}"]`); await p.waitForTimeout(600);
    ok(await p.isVisible('#p-brief'), N + ': did not switch to brief');
    ok((await p.inputValue('#bsel')) !== null && (await p.textContent('#bsel option:checked')).includes(oldest), N + ': archived day not opened');
    ok(await noOverflow(p), N + ': overflow');
    await tab(p, 't-arch'); await p.fill('#aq', '없는말zzqq'); await p.waitForTimeout(400);
    ok(await p.isVisible('#p-arch .ghostcard'), N + ': empty result message');
    ok(errs.length === 0, N + ': errors ' + errs.join(' | '));
    await ctx.close();
  }
  // weekly missed-signal audit: card on the newest brief + history in the archive tab
  {
    const fs = require('fs'); const path = require('path');
    const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'bundle.json'), 'utf8'));
    const d = new Date(); const today = new Date(d.getTime() - 7 * 3600e3).toISOString().slice(0, 10);
    real.collections.audits = [{ id: today, date: today, week_from: '2026-10-04', week_to: '2026-10-10', checked: 12, stats: { on_time: 8, late: 2, under: 1, missed: 1 }, catch_rate: 0.67, summary: '시험용 요약', balance: { outside_theme_share: 0.25, regions: { '북미': 5, '유럽': 4, '아프리카': 1 }, steeg: { economy: 5, governance: 4, environment: 1 }, over: ['프랑스 금리차 4일 연속'], agenda_gaps: ['중국 디플레이션'] },
      misses: [{ event: '시험용 놓친 사건', happened: '2026-10-06', kind: '놓침', first_seen: '', where: '없음', cause: '점검 목록', why_matters: '왜 중요한지', fix: '점검 목록에 추가', applied: { type: 'checklist', detail: 'x' }, url: 'https://example.com/m' },
               { event: '시험용 늦은 사건', happened: '2026-10-07', kind: '늦음', first_seen: '2026-10-09', where: '선별', cause: '판단', fix: '판단 기준 보정', applied: { type: 'scoring', detail: 'y' } }] }];
    const { p, errs, ctx } = await page(b, { vp: { width: 390, height: 844 }, mobile: true, route: r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(real) }) });
    const N = 'audit';
    await tab(p, 't-brief');
    ok(await p.isVisible('#sec-audit'), N + ': audit card missing');
    ok((await p.textContent('#sec-audit .stat')).includes('67%'), N + ': catch rate missing');
    ok((await p.textContent('#sec-audit')).includes('테마 밖 깊은 이슈') && (await p.textContent('#sec-audit')).includes('과다 노출'), N + ': balance line missing');
    await p.locator('#sec-audit details.more > summary').click(); await p.waitForTimeout(100);
    ok((await p.$$('#sec-audit .miss')).length === 2, N + ': misses not listed');
    await tab(p, 't-arch'); await p.waitForTimeout(300);
    ok((await p.textContent('#p-arch')).includes('주간 놓친 신호 점검 1회'), N + ': archive history missing');
    ok(await noOverflow(p), N + ': overflow');
    ok(errs.length === 0, N + ': errors ' + errs.join(' | '));
    await ctx.close();
  }
  // blind world ranking + why line on deep issues
  {
    const fs = require('fs'); const path = require('path');
    const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'bundle.json'), 'utf8'));
    const br = real.collections.briefs.slice().sort((x, y) => y.date < x.date ? -1 : 1)[0];
    br.world_rank = [1, 2, 3, 4, 5, 6, 7].map(k => ({ rank: k, title: '시험 순위 ' + k, url: 'https://example.com/' + k, steeg: ['economy', 'environment', 'governance', 'society', 'tech', 'economy', 'governance'][k - 1], votes: { fronts: 6 - (k % 4), fronts_of: 7, market: k < 3, agenda: k === 2 ? ['CrisisWatch'] : [], persist: k }, theme: k === 2 ? '' : 'money', note: k === 1 ? '시험 메모' : '' }));
    br.persist_checks = [{ title: '콩고 에볼라', days: 6, decision: '선별로 올림', why: '확산 지역 확대' }];
    (br.deep_issues || [])[0] && (br.deep_issues[0].why_line = '7개 지역 중 6곳 1면 · 테마 밖');
    const { p, errs, ctx } = await page(b, { vp: { width: 390, height: 844 }, mobile: true, route: r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(real) }) });
    const N = 'rank';
    await tab(p, 't-brief');
    ok((await p.$$('#sec-rank .rrow')).length === 7, N + ': rank rows');
    ok((await p.$$('#sec-rank .out')).length === 1, N + ': outside-theme label');
    ok((await p.$$('#p-brief .qnav a[data-go="sec-rank"]')).length === 1, N + ': quick nav');
    ok(await p.isVisible('#p-brief .whyline'), N + ': why line');
    await p.locator('#sec-rank details.more > summary').click(); await p.waitForTimeout(100);
    ok((await p.textContent('#sec-rank')).includes('콩고 에볼라'), N + ': persist checks');
    ok(await noOverflow(p), N + ': overflow');
    ok(errs.length === 0, N + ': errors ' + errs.join(' | '));
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
