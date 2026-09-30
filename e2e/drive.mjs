#!/usr/bin/env node
// Drives the dev server in headless Chrome. Usage: node e2e/drive.mjs '<json array of steps>'
// Steps: {rig: {cards, fen?, pockets?, settings?, turn?}} (see rig.js), {goto}, {viewport:[w,h]}, {click: selector}, {text: 'button text'}, {sq: 'e2'}, {drag: ['e2','e4']},
//        {dragPocket: ['n', 'c3']}, {key}, {eval: js}, {wait: ms}, {shot: name, full?: bool}
import { chromium } from 'playwright-core';
import path from 'node:path';

const OUT = process.env.SHOT_DIR ?? '/tmp/uno-shots';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const steps = JSON.parse(process.argv[2] ?? '[]');

const ctx = await chromium.launchPersistentContext(path.join(OUT, 'profile'), {
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 1,
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

const sqIndex = (name) => (Number(name[1]) - 1) * 8 + 'abcdefgh'.indexOf(name[0]);
const center = async (sel) => {
  const box = await page.locator(sel).first().boundingBox();
  return [box.x + box.width / 2, box.y + box.height / 2];
};
const dragBetween = async (fromSel, toSel) => {
  const [x1, y1] = await center(fromSel);
  const [x2, y2] = await center(toSel);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 5 });
  await page.mouse.up();
};

if (!steps.some((s) => s.goto)) await page.goto(BASE);
const rigSource = await import('node:fs').then((fs) => fs.readFileSync(new URL('./rig.js', import.meta.url), 'utf8'));

for (const s of steps) {
  if (s.rig) {
    await page.waitForFunction(() => window.__uno);
    await page.evaluate((rig) => (window.RIG = rig), s.rig);
    await page.evaluate(rigSource);
    await page.reload();
    await page.getByRole('button', { name: 'Continue game' }).click();
    await page.waitForTimeout(200);
  }
  if (s.goto !== undefined) await page.goto(new URL(s.goto, BASE).href);
  if (s.viewport) await page.setViewportSize({ width: s.viewport[0], height: s.viewport[1] });
  if (s.click) await page.locator(s.click).first().click();
  if (s.text) await page.getByRole('button', { name: s.text, exact: false }).first().click();
  if (s.sq) await page.locator(`[data-square="${sqIndex(s.sq)}"]`).click();
  if (s.drag) await dragBetween(`[data-square="${sqIndex(s.drag[0])}"]`, `[data-square="${sqIndex(s.drag[1])}"]`);
  if (s.dragPocket) {
    const pocket = `.player--active .pocket__piece:has(img[src$="${s.dragPocket[0].toUpperCase()}.svg"])`;
    await dragBetween(pocket, `[data-square="${sqIndex(s.dragPocket[1])}"]`);
  }
  if (s.key) await page.keyboard.press(s.key);
  if (s.eval) console.log('eval:', JSON.stringify(await page.evaluate(s.eval)));
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.shot) {
    await page.waitForTimeout(s.settle ?? 150);
    const file = path.join(OUT, `${s.shot}.png`);
    await page.screenshot({ path: file, fullPage: Boolean(s.full) });
    console.log('shot:', file);
  }
}
if (errors.length) console.log(errors.join('\n'));
await ctx.close();
