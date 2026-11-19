// UI-only mocks. Never signs a transaction or uses production workout records.
import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { BorshAccountsCoder, BN } = require('@coral-xyz/anchor');
const { PublicKey } = require('@solana/web3.js');
const idl = JSON.parse(await readFile(new URL('../lib/idl/commitment_stakes.json', import.meta.url)));
const coder = new BorshAccountsCoder(idl);
const program = new PublicKey(idl.address);
const key = (n) => new PublicKey(new Uint8Array(32).fill(n));
const owner = key(1), challenge = key(2), member = key(3), peer = key(4), peerMember = key(5);
const teams = [0,1].map(i => PublicKey.findProgramAddressSync([Buffer.from('team'), challenge.toBuffer(), Buffer.from([i])], program)[0]);
const records = new Map();
async function account(address, type, data) {
  const encoded = await coder.encode(type, data);
  const value = { data: [encoded.toString('base64'), 'base64'], executable: false, lamports: 1000000, owner: idl.address, rentEpoch: 0, space: encoded.length };
  records.set(address.toBase58(), value);
  return { pubkey: address.toBase58(), account: value };
}
const challengeRecord = await account(challenge, 'Challenge', {
  creator: owner, oracle: owner, group: key(6), id: new BN(1), alpha_bps: 2000, rake_bps: 300, target: 20,
  stake_lamports: new BN(250000000), deadline_unix: new BN(2000000000), total_staked_lamports: new BN(500000000), winning_team: 2, rules_version: 1, settled: false, bump: 1,
});
for (let i=0;i<2;i++) await account(teams[i], 'Team', { challenge, index: i, name: ['Sunrise Squad', 'Night Owls'][i], member_count: 1, bump: 1 });
const members = await Promise.all([account(member, 'TeamMember', { challenge, team: teams[0], owner, stake_lamports: new BN(250000000), counted_units: new BN(0), payout_lamports: new BN(0), claimed: false, bump: 1 }), account(peerMember, 'TeamMember', { challenge, team: teams[1], owner: peer, stake_lamports: new BN(250000000), counted_units: new BN(0), payout_lamports: new BN(0), claimed: false, bump: 1 })]);
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:13000';
const output = new URL('../../../test-results/app-design/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [320, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/coach', '/club', '/challenges/new', '/join/'+challenge, '/challenges/'+challenge+'/results']) {
      await page.goto(base + path);
      await page.locator('h1').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow ${width} ${path}`);
      if (width === 390 || (width === 1280 && path === '/')) await page.screenshot({ path: new URL(`${width}-${path.replaceAll('/','_') || 'home'}.png`, output).pathname.replace(/^\/(\w:)/,'$1'), fullPage: true });
    }
  }
  await page.goto(base);
  await page.getByLabel('Challenge address or invite link').fill('bad');
  await page.getByRole('button', { name: 'Review invitation' }).click();
  await page.getByRole('alert').filter({ hasText: 'Paste a valid' }).waitFor();
  await page.getByRole('navigation').getByRole('link', { name: 'Coach', exact: true }).click();
  await page.getByText('Runs in your browser').waitFor();
  await page.getByRole('link', { name: 'Find my workout' }).click();
  await page.waitForURL('**/coach#choose-challenge');
  await context.close();

  const connected = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await connected.addInitScript(({ bytes, address }) => {
    localStorage.setItem('walletName', JSON.stringify('Phantom'));
    const wallet = { isPhantom: true, isConnected: true, publicKey: { toBytes: () => Uint8Array.from(bytes), toBase58: () => address }, on() {}, off() {}, connect: async () => {}, disconnect: async () => {}, signTransaction: async () => { throw Error('No transactions in UI tests'); }, signAllTransactions: async () => { throw Error('No transactions in UI tests'); }, signMessage: async () => { throw Error('No signatures in UI tests'); } };
    window.isPhantomInstalled = true; window.phantom = { solana: wallet }; window.solana = wallet;
  }, { bytes: [...owner.toBytes()], address: owner.toBase58() });
  let total = 6, fail = false, requests = 0;
  await connected.route('**/api/workout-sessions/totals?**', route => {
    requests++;
    return route.fulfill({ status: fail ? 503 : 200, json: fail ? { error: 'Simulated outage' } : { totals: { [member.toBase58()]: total, [peerMember.toBase58()]: 8 } } });
  });
  await connected.route('**/api/users?**', route => route.fulfill({ json: { names: { [owner.toBase58()]: 'You', [peer.toBase58()]: 'Sam' } } }));
  await connected.route('**/api/challenges/close?**', route => route.fulfill({ json: { closed: [] } }));
  // Any JSON-RPC POST, whatever RPC URL the build has baked in (.env.local may set Helius).
  await connected.route('**/*', async route => {
    let body = null;
    try { body = route.request().method() === 'POST' ? route.request().postDataJSON() : null; } catch {}
    const first = Array.isArray(body) ? body[0] : body;
    if (!first || first.jsonrpc !== '2.0') return route.fallback();
    const respond = request => {
      let result;
      if (request.method === 'getAccountInfo') result = { context: { slot: 1 }, value: records.get(request.params[0]) || null };
      else if (request.method === 'getMultipleAccounts') result = { context: { slot: 1 }, value: request.params[0].map(p => records.get(p) || null) };
      else if (request.method === 'getProgramAccounts') {
        const filters = request.params[1].filters;
        result = filters.some(f => f.memcmp?.offset === 8 && f.memcmp.bytes === owner.toBase58()) ? [challengeRecord] : members;
      } else if (request.method === 'getBalance') result = { context: { slot: 1 }, value: 1000000000 };
      else throw Error('Unexpected mock RPC '+request.method);
      return { jsonrpc: '2.0', id: request.id, result };
    };
    await route.fulfill({ json: Array.isArray(body) ? body.map(respond) : respond(body) });
  });
  const live = await connected.newPage();
  live.on('pageerror', error => errors.push(error.message));
  await live.goto(base + '/challenges/' + challenge);
  await live.getByText('Leaderboard', { exact: true }).waitFor();
  const sunrise = live.locator('.board-row').filter({ hasText: 'Sunrise Squad' });
  await sunrise.locator('.board-score .sr-only').getByText('6', { exact: true }).waitFor();
  total = 12;
  await sunrise.locator('.board-score .sr-only').getByText('12', { exact: true }).waitFor({ timeout: 12000 });
  assert.match(await live.locator('.board-row').first().innerText(), /Sunrise Squad/);
  fail = true;
  await live.getByText('Update paused', { exact: true }).waitFor({ timeout: 12000 });
  assert.equal(await sunrise.locator('.board-score .sr-only').textContent(), '12');
  fail = false; total = 14;
  await sunrise.locator('.board-score .sr-only').getByText('14', { exact: true }).waitFor({ timeout: 12000 });
  await live.screenshot({ path: new URL('390-leaderboard.png', output).pathname.replace(/^\/(\w:)/,'$1'), fullPage: true });
  await live.getByRole('button', { name: 'Start squat session' }).click();
  await live.locator('.camera-room .session-error').waitFor(); // Camera denial must recover visibly.
  await live.getByRole('button', { name: 'Start squat session' }).waitFor();
  await live.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await sunrise.locator('.rolling-strip').first().evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  for (const path of ['/challenges/new', '/join/'+challenge, '/challenges/'+challenge+'/results']) {
    await live.goto(base + path);
    await live.locator('h1').first().waitFor();
    await live.waitForTimeout(350);
    assert.ok(await live.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `connected overflow ${path}`);
    await live.screenshot({ path: new URL('connected-'+path.replaceAll('/','_')+'.png', output).pathname.replace(/^\/(\w:)/,'$1'), fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: 24 responsive route checks, navigation, invite validation, mocked wallet/RPC standings, 5s updates, rank changes, outage retention/recovery, camera denial, reduced motion. Totals requests:', requests);
} finally { await browser.close(); }
