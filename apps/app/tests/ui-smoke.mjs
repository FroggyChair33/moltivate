// UI-only mocks. Never signs a transaction or uses production workout records.
// Sessions and table reads come from tests/fake-supabase.mjs, which this script starts on port 13001. The app must be
// built and started against it with obviously fake keys (NEXT_PUBLIC_* values are inlined at build time). From apps/app:
//   export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:13001 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_smoke_test SUPABASE_SERVICE_ROLE_KEY=sb_secret_smoke_test
//   npm run build && npx next start -p 13000   # then, in another shell:
//   node tests/ui-smoke.mjs
// Rebuild without these variables afterwards before using the app against real Supabase.
import { chromium } from '@playwright/test';
import { startFakeSupabase } from './fake-supabase.mjs';
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
// A second challenge whose deadline has passed, for the closed-invite check.
const expired = key(7);
await account(expired, 'Challenge', {
  creator: owner, oracle: owner, group: key(6), id: new BN(2), alpha_bps: 2000, rake_bps: 300, target: 20,
  stake_lamports: new BN(250000000), deadline_unix: new BN(1000), total_staked_lamports: new BN(0), winning_team: 2, rules_version: 1, settled: false, bump: 1,
});
for (let i=0;i<2;i++) await account(PublicKey.findProgramAddressSync([Buffer.from('team'), expired.toBuffer(), Buffer.from([i])], program)[0], 'Team', { challenge: expired, index: i, name: ['Early Birds', 'Late Owls'][i], member_count: 0, bump: 1 });
const members = await Promise.all([account(member, 'TeamMember', { challenge, team: teams[0], owner, stake_lamports: new BN(250000000), counted_units: new BN(0), payout_lamports: new BN(0), claimed: false, bump: 1 }), account(peerMember, 'TeamMember', { challenge, team: teams[1], owner: peer, stake_lamports: new BN(250000000), counted_units: new BN(0), payout_lamports: new BN(0), claimed: false, bump: 1 })]);
// lateCreate: any unknown account "exists", as if a cancelled create landed.
let lateCreate = false;
// Any JSON-RPC POST, whatever RPC URL the build has baked in (.env.local may set Helius).
async function mockRpc(route) {
  let body = null;
  try { body = route.request().method() === 'POST' ? route.request().postDataJSON() : null; } catch {}
  const first = Array.isArray(body) ? body[0] : body;
  if (!first || first.jsonrpc !== '2.0') return route.fallback();
  const respond = request => {
    let result;
    if (request.method === 'getAccountInfo') result = { context: { slot: 1 }, value: records.get(request.params[0]) || (lateCreate ? challengeRecord.account : null) };
    else if (request.method === 'getMultipleAccounts') result = { context: { slot: 1 }, value: request.params[0].map(p => records.get(p) || null) };
    else if (request.method === 'getProgramAccounts') {
      const filters = request.params[1].filters;
      result = filters.some(f => f.memcmp?.offset === 8 && f.memcmp.bytes === owner.toBase58()) ? [challengeRecord] : members;
    } else if (request.method === 'getLatestBlockhash') result = { context: { slot: 1 }, value: { blockhash: key(9).toBase58(), lastValidBlockHeight: 100 } };
    else if (request.method === 'getBalance') result = { context: { slot: 1 }, value: 1000000000 };
    else throw Error('Unexpected mock RPC '+request.method);
    return { jsonrpc: '2.0', id: request.id, result };
  };
  await route.fulfill({ json: Array.isArray(body) ? body.map(respond) : respond(body) });
}
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:13000';
const output = new URL('../../../test-results/app-design/', import.meta.url);
await mkdir(output, { recursive: true });
const fake = await startFakeSupabase(13001);
fake.setLinkedWallets([owner.toBase58()]);
const signIn = (context) => context.addCookies([{ ...fake.sessionCookie, url: base }]);
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  // Signed out: pages redirect to /login, but an invite stays viewable.
  const guest = await browser.newContext();
  await guest.route('**/*', mockRpc);
  const guestPage = await guest.newPage();
  guestPage.on('pageerror', error => errors.push(error.message));
  await guestPage.goto(base + '/');
  assert.equal(new URL(guestPage.url()).pathname, '/login');
  await guestPage.goto(base + '/join/' + challenge);
  await guestPage.getByText('Sunrise Squad vs Night Owls').waitFor();
  await guestPage.getByText('Log in or sign up to join.').waitFor();
  await guestPage.goto(base + '/join/' + expired);
  await guestPage.getByText("This challenge's deadline has already passed").waitFor();
  await guest.close();

  const context = await browser.newContext();
  await signIn(context);
  await context.route('**/*', mockRpc);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [320, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/challenges/new', '/join/'+challenge, '/challenges/'+challenge+'/results']) {
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
  // The two-item nav, and the retired /club and /coach routes landing on the dashboard.
  await page.getByRole('navigation').getByRole('link', { name: 'New challenge', exact: true }).click();
  await page.waitForURL('**/challenges/new');
  await page.getByRole('navigation').getByRole('link', { name: 'Challenges', exact: true }).click();
  await page.getByRole('heading', { name: 'Your challenges' }).waitFor();
  for (const retired of ['/club', '/coach']) {
    await page.goto(base + retired);
    await page.waitForURL(base + '/');
  }
  // Signed in with no wallet connected (phone-style): challenges follow the linked wallet, read-only.
  await page.goto(base);
  await page.getByRole('link', { name: new RegExp('Open challenge.*' + challenge.toBase58()) }).waitFor();
  // The account page lists the linked wallet.
  await page.goto(base + '/account');
  await page.getByText(owner.toBase58().slice(0, 4) + '...' + owner.toBase58().slice(-4), { exact: true }).waitFor();
  // Without a wallet, an invite still shows the challenge, and says when it's closed.
  await page.goto(base + '/join/' + challenge);
  await page.getByText('Sunrise Squad vs Night Owls').waitFor();
  await page.getByText('Connect the Phantom wallet linked to your account to sign this on devnet.').waitFor();
  await page.goto(base + '/join/' + expired);
  await page.getByText("This challenge's deadline has already passed").waitFor();
  await context.close();

  const connected = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await signIn(connected);
  await connected.addInitScript(({ bytes, address }) => {
    localStorage.setItem('walletName', JSON.stringify('Phantom'));
    window.signMessageCalls = 0;
    const wallet = { isPhantom: true, isConnected: true, publicKey: { toBytes: () => Uint8Array.from(bytes), toBase58: () => address }, on() {}, off() {}, connect: async () => {}, disconnect: async () => {}, signTransaction: async () => { throw Error('No transactions in UI tests'); }, signAllTransactions: async () => { throw Error('No transactions in UI tests'); }, signMessage: async () => { window.signMessageCalls++; return { signature: new Uint8Array(64) }; } };
    window.isPhantomInstalled = true; window.phantom = { solana: wallet }; window.solana = wallet;
  }, { bytes: [...owner.toBytes()], address: owner.toBase58() });
  let total = 6, fail = false, requests = 0;
  await connected.route('**/api/workout-sessions/totals?**', route => {
    requests++;
    return route.fulfill({ status: fail ? 503 : 200, json: fail ? { error: 'Simulated outage' } : { totals: { [member.toBase58()]: total, [peerMember.toBase58()]: 8 } } });
  });
  await connected.route('**/api/users?**', route => route.fulfill({ json: { names: { [owner.toBase58()]: 'You', [peer.toBase58()]: 'Sam' } } }));
  await connected.route('**/api/challenges/close?**', route => route.fulfill({ json: { closed: [] } }));
  await connected.route('**/*', mockRpc);
  const live = await connected.newPage();
  live.on('pageerror', error => errors.push(error.message));
  // A connected wallet that isn't linked to the account can't join.
  fake.setLinkedWallets([key(8).toBase58()]);
  await live.goto(base + '/join/' + challenge);
  await live.getByText("This wallet isn't linked to your account").waitFor();
  fake.setLinkedWallets([owner.toBase58()]);
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
  assert.equal(await live.evaluate(() => window.signMessageCalls), 0, 'starting a squat session asked the wallet to sign');
  await live.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await sunrise.locator('.rolling-strip').first().evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  for (const path of ['/challenges/new', '/join/'+challenge, '/challenges/'+challenge+'/results']) {
    await live.goto(base + path);
    await live.locator('h1').first().waitFor();
    await live.waitForTimeout(350);
    assert.ok(await live.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `connected overflow ${path}`);
    await live.screenshot({ path: new URL('connected-'+path.replaceAll('/','_')+'.png', output).pathname.replace(/^\/(\w:)/,'$1'), fullPage: true });
  }
  // A cancelled deposit that landed anyway: the retry fails in the wallet, but
  // the member account exists, so the page reports the join instead of an error.
  const myMember = PublicKey.findProgramAddressSync([Buffer.from('member'), challenge.toBuffer(), owner.toBuffer()], program)[0];
  await account(myMember, 'TeamMember', { challenge, team: teams[0], owner, stake_lamports: new BN(250000000), counted_units: new BN(0), payout_lamports: new BN(0), claimed: false, bump: 1 });
  await live.goto(base + '/join/' + challenge);
  await live.getByRole('button', { name: 'Sunrise Squad' }).click();
  await live.getByRole('button', { name: /^Deposit/ }).click();
  await live.getByText('Your earlier request went through.').waitFor();
  await live.getByRole('button', { name: 'Deposited' }).waitFor();
  records.delete(myMember.toBase58());
  // A cancelled create that landed anyway: the reused id points at an existing
  // challenge, so Create opens it instead of making a second one.
  lateCreate = true;
  await live.goto(base + '/challenges/new');
  await live.getByRole('button', { name: 'Create' }).click();
  await live.waitForURL('**/join/**');
  lateCreate = false;
  assert.deepEqual(errors, []);
  console.log('PASS: signed-out login redirect + invite preview, 24 signed-in responsive route checks, navigation, invite validation, linked-wallet challenges with no wallet connected, account wallet list, disconnected invite + closed notice, unlinked wallet refused, mocked wallet/RPC standings, 5s updates, rank changes, outage retention/recovery, camera denial without signMessage, reduced motion, late deposit/create recovery. Totals requests:', requests);
} finally { await browser.close(); fake.close(); }
