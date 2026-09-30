#!/usr/bin/env node
// Two isolated browsers play an online game against the dev server (vite on :5173, game server on :7879).
// Usage: node e2e/online.mjs   (screenshots go to $SHOT_DIR)
import { chromium } from 'playwright-core';
import path from 'node:path';

const OUT = process.env.SHOT_DIR ?? '/tmp/uno-shots';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const errors = [];
async function player(label, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label} console: ${m.text()}`));
  return { ctx, page };
}
const shot = async (page, name) => {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('shot:', name);
};
const sq = (name) => `[data-square="${(Number(name[1]) - 1) * 8 + 'abcdefgh'.indexOf(name[0])}"]`;
const history = (page) => page.$$eval('.log__row', (rows) => rows.map((r) => r.textContent));

const host = await player('host', { width: 1300, height: 860 });
const guest = await player('guest', { width: 390, height: 844 });

await host.page.goto(BASE);
await host.page.getByLabel('Your name').fill('Ana');
await host.page.getByRole('button', { name: 'Create game' }).click();
const link = await host.page.locator('#invite-link').inputValue();
console.log('invite:', link);
await shot(host.page, 'online-lobby');

await guest.page.goto(link);
await guest.page.getByLabel('Your name').fill('Bo');
await shot(guest.page, 'online-join');
await guest.page.getByRole('button', { name: 'Join game' }).click();
await guest.page.waitForSelector('.board');
await host.page.waitForSelector('.board');
await shot(host.page, 'online-host-start');
await shot(guest.page, 'online-guest-start');

// Host is White (default "Me"). Flip until a number card, then play e4 (and more if allowed).
await host.page.keyboard.press('f');
await host.page.waitForTimeout(700);
console.log('host prompt:', await host.page.textContent('.prompt__title'));
console.log('guest prompt:', await guest.page.textContent('.prompt__title'));
await shot(host.page, 'online-host-drawn');
await shot(guest.page, 'online-guest-waiting');

const hostCanMove = await host.page.locator(`${sq('e2')}[tabindex="0"]`).count();
if (hostCanMove) {
  await host.page.click(sq('e2'));
  await host.page.click(sq('e4'));
  await guest.page.waitForTimeout(500);
}
console.log('guest history:', await history(guest.page));
console.log('guest title:', await guest.page.title(), '| host title:', await host.page.title());

// Guest disconnects: host should see them go offline, then come back after a reload.
await guest.page.goto('about:blank');
await host.page.waitForTimeout(500);
console.log('host sees offline tag:', await host.page.locator('.player__offline').count());
await guest.page.goto(BASE);
await guest.page.waitForSelector('.board');
await host.page.waitForTimeout(500);
console.log('after guest reload, offline tags on host:', await host.page.locator('.player__offline').count());
console.log('guest history after reload:', await history(guest.page));
await shot(guest.page, 'online-guest-reloaded');

if (process.env.RESTART_CMD) {
  // Server restart mid-game: clients should show "Reconnecting…", resume, and keep playing.
  const { execSync } = await import('node:child_process');
  execSync(process.env.RESTART_CMD);
  await host.page.waitForTimeout(300);
  console.log('banner during restart:', await host.page.locator('.connection').textContent().catch(() => null));
  await host.page.waitForFunction(() => !document.querySelector('.connection'), null, { timeout: 20000 });
  await guest.page.waitForFunction(() => !document.querySelector('.connection'), null, { timeout: 20000 });
  console.log('both reconnected; host history:', await history(host.page));
  const hostTurn = await host.page.locator(`${sq('d2')}[tabindex="0"]`).count();
  if (hostTurn) {
    await host.page.click(sq('d2'));
    await host.page.click(sq('d4'));
    await guest.page.waitForTimeout(500);
    console.log('guest history after post-restart move:', await history(guest.page));
  }
}

// Guest leaves for good from the (mobile) menu: host should see a resignation and no rematch.
await guest.page.getByText('Menu', { exact: true }).click();
await guest.page.locator('.menu-compact__list').getByRole('button', { name: 'Leave game' }).click();
await guest.page.getByRole('button', { name: 'Leave game' }).last().click();
await host.page.waitForSelector('.modal');
console.log('host result:', await host.page.textContent('.modal__title'), '|', await host.page.textContent('.modal__meta'));
console.log('host rematch disabled:', await host.page.locator('.modal .btn--primary').isDisabled());
console.log('host sees tag:', await host.page.locator('.player__offline').textContent());
console.log('guest back at setup:', await guest.page.locator('.hero__title').count());
await shot(host.page, 'online-host-opponent-left');

console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
