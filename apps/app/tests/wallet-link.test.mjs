import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

// Routes are transpiled and run with stubbed I/O modules; keys and signatures are real (tweetnacl, web3.js).
// requireAccount is the real lib/account-auth.ts over a fake auth client, so the Origin gate is really exercised.
const require = createRequire(import.meta.url);
const nacl = require("tweetnacl");
const web3 = require("@solana/web3.js");

const load = (file, requireFn) => {
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exportsObject = {};
  const sandbox = { exports: exportsObject, require: requireFn, process, Request, Response, URL, Buffer, TextEncoder, Uint8Array, Date };
  vm.runInNewContext(output, sandbox);
  return exportsObject;
};
const none = (n) => { throw new Error(n); };

const messages = load("lib/wallet-link-message.ts", none);
const sameOrigin = load("lib/same-origin.ts", none);

// ---- per-test state ----
let user;
let rows; // wallet_link_nonces table
let rpcCalls;
let rpcResult;
let rpcError;
let linkedWallets; // linked_wallets table
let deleteCalls;
let deleteError;
let openStake;
let signIn; // result of signInWithPassword
let signInCalls;
let signOutCalls;
let clientOptions;

const authClient = {
  auth: {
    getUser: async () => ({ data: { user }, error: null }),
    getSession: async () => ({ data: { session: { access_token: "tok" } } }),
  },
};
const account = load("lib/account-auth.ts", (n) => {
  if (n === "./same-origin") return sameOrigin;
  if (n === "./supabase-auth") return { createAuthClient: () => authClient };
  throw new Error(n);
});

// Chainable stand-in for the supabase query builder: filters are recorded, awaiting resolves to the count result.
const nonceTable = () => {
  const filters = {};
  let nullCol; // is(col, null)
  let gt; // gt(col, iso)
  let patch; // update(values)
  let wantRows = false; // select() after update()
  const matching = () =>
    rows.filter((r) =>
      Object.entries(filters).every(([c, v]) => r[c] === v) &&
      (!nullCol || r[nullCol] === null) &&
      (!gt || Date.parse(r[gt.col]) > Date.parse(gt.value)));
  const q = {
    select: () => { wantRows = true; return q; },
    update: (values) => { patch = values; return q; },
    eq: (col, val) => { filters[col] = val; return q; },
    is: (col) => { nullCol = col; return q; },
    gt: (col, value) => { gt = { col, value }; return q; },
    maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
    insert: async (row) => { rows.push({ used_at: null, ...row }); return { error: null }; },
    // Awaiting runs the whole filter+update synchronously, which models the database's atomic UPDATE ... RETURNING.
    then: (resolve) => {
      if (patch) {
        const hit = matching();
        hit.forEach((r) => Object.assign(r, patch));
        return resolve({ data: wantRows ? hit.map((r) => ({ nonce: r.nonce })) : null, error: null });
      }
      return resolve({ count: matching().length, error: null });
    },
  };
  return q;
};
const linkedTable = () => {
  const filters = {};
  const q = {
    delete: () => q,
    select: () => q,
    eq: (col, val) => { filters[col] = val; return q; },
    then: (resolve) => {
      deleteCalls.push({ ...filters });
      const hit = linkedWallets.filter((w) => w.wallet_address === filters.wallet_address && w.user_id === filters.user_id);
      linkedWallets = linkedWallets.filter((w) => !hit.includes(w));
      return resolve({ data: hit, error: deleteError });
    },
  };
  return q;
};
const serverClient = {
  from: (table) => { assert.ok(["wallet_link_nonces", "linked_wallets"].includes(table)); return table === "linked_wallets" ? linkedTable() : nonceTable(); },
  rpc: async (fn, args) => { rpcCalls.push({ fn, args }); return { data: rpcResult, error: rpcError }; },
};

const walletProof = load("lib/wallet-proof.ts", (n) => {
  if (n === "@solana/web3.js") return web3;
  if (n === "tweetnacl") return nacl;
  if (n === "./wallet-link-message") return messages;
  if (n === "./supabase-server") return { getSupabaseServerClient: () => serverClient };
  throw new Error(n);
});
const stubs = (n) => {
  if (n === "crypto") return require("crypto");
  if (n === "@solana/web3.js") return web3;
  if (n === "@/lib/account-auth") return account;
  if (n === "@/lib/supabase-server") return { getSupabaseServerClient: () => serverClient };
  if (n === "@/lib/wallet-link-message") return messages;
  if (n === "@/lib/wallet-proof") return walletProof;
  if (n === "@/lib/server-program") return { getReadOnlyProgram: () => ({}) };
  if (n === "@/lib/open-stakes") return { hasOpenStake: async () => openStake };
  if (n === "@/lib/supabase-key") return { assertPublishableKey: () => {} };
  if (n === "@supabase/supabase-js") {
    return {
      createClient: (url, key, options) => {
        clientOptions = { url, key, options };
        return {
          auth: {
            signInWithPassword: async (creds) => { signInCalls.push(creds); return signIn; },
            signOut: async (arg) => { signOutCalls.push(arg); return { error: null }; },
          },
        };
      },
    };
  }
  throw new Error(n);
};
const nonceRoute = load("app/api/wallet-links/nonce/route.ts", stubs);
const linkRoute = load("app/api/wallet-links/link/route.ts", stubs);
const unlinkRoute = load("app/api/wallet-links/unlink/route.ts", stubs);

// ---- helpers ----
const wallet = nacl.sign.keyPair();
const walletKey = new web3.PublicKey(wallet.publicKey).toBase58();
const OTHER_ACCOUNT = "22222222-2222-2222-2222-222222222222";
const ORIGIN = "https://app.test";
const post = (route, path, body, headers = {}) =>
  route.POST(new Request(`${ORIGIN}/api/wallet-links/${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
const read = async (res) => ({ status: res.status, body: await res.json() });
const sign = (message, secretKey = wallet.secretKey) =>
  Buffer.from(nacl.sign.detached(new TextEncoder().encode(message), secretKey)).toString("base64");

const proof = (over = {}) => ({ accountId: "u1", wallet: walletKey, nonce: "n1", expiresAt: Math.floor(Date.now() / 1000) + 300, ...over });
// A stored nonce row that matches `proof()`.
const addRow = (purpose, over = {}) => {
  const p = proof();
  rows.push({ nonce: p.nonce, user_id: "u1", wallet_address: walletKey, purpose, expires_at: new Date(p.expiresAt * 1000).toISOString(), used_at: null, ...over });
  return p;
};

beforeEach(() => {
  user = { id: "u1", email: "a@b.co", email_confirmed_at: "2026-11-01T00:00:00Z", factors: [] };
  rows = [];
  rpcCalls = [];
  rpcResult = "linked";
  rpcError = null;
  linkedWallets = [{ wallet_address: walletKey, user_id: "u1" }];
  deleteCalls = [];
  deleteError = null;
  openStake = false;
  signIn = { data: { session: {} }, error: null };
  signInCalls = [];
  signOutCalls = [];
  clientOptions = undefined;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";
});

// ---- nonce ----
test("nonce: returns a server-built link message and stores the nonce", async () => {
  const res = await read(await post(nonceRoute, "nonce", { wallet: walletKey, purpose: "link" }));
  assert.equal(res.status, 200);
  assert.match(res.body.nonce, /^[A-Za-z0-9_-]{43}$/); // 32 bytes, base64url
  assert.equal(res.body.message, messages.linkWalletMessage({ accountId: "u1", wallet: walletKey, nonce: res.body.nonce, expiresAt: res.body.expiresAt }));
  const ttl = res.body.expiresAt - Math.floor(Date.now() / 1000);
  assert.ok(ttl >= 299 && ttl <= 300, `ttl ${ttl}`);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].user_id, rows[0].wallet_address, rows[0].purpose, rows[0].nonce], ["u1", walletKey, "link", res.body.nonce]);
  assert.equal(rows[0].expires_at, new Date(res.body.expiresAt * 1000).toISOString());
});

test("nonce: unlink purpose builds the unlink message", async () => {
  const res = await read(await post(nonceRoute, "nonce", { wallet: walletKey, purpose: "unlink" }));
  assert.equal(res.body.message, messages.unlinkWalletMessage({ accountId: "u1", wallet: walletKey, nonce: res.body.nonce, expiresAt: res.body.expiresAt }));
  assert.equal(rows[0].purpose, "unlink");
});

test("nonce: the account id comes from the session, not the body", async () => {
  const res = await read(await post(nonceRoute, "nonce", { wallet: walletKey, purpose: "link", accountId: OTHER_ACCOUNT }));
  assert.equal(rows[0].user_id, "u1");
  assert.ok(!res.body.message.includes(OTHER_ACCOUNT));
});

test("nonce: bad purpose, bad wallet and bad json are 400 and store nothing", async () => {
  for (const body of [
    { wallet: walletKey, purpose: "LINK" },
    { wallet: walletKey, purpose: "link\nAccount: x" },
    { wallet: walletKey },
    { wallet: "not-a-key", purpose: "link" },
    { wallet: `${walletKey}\nNonce: x`, purpose: "link" },
    { wallet: 5, purpose: "link" },
    "{not json",
  ]) {
    const res = await read(await post(nonceRoute, "nonce", body));
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal(rows.length, 0);
});

test("nonce: a foreign Origin is 403", async () => {
  const res = await post(nonceRoute, "nonce", { wallet: walletKey, purpose: "link" }, { origin: "https://evil.app" });
  assert.equal(res.status, 403);
  assert.equal(rows.length, 0);
});

test("nonce: signed out is 401", async () => {
  user = null;
  const res = await post(nonceRoute, "nonce", { wallet: walletKey, purpose: "link" });
  assert.equal(res.status, 401);
});

// Rows that look like nonces issued just now (expires_at = created + 5 minutes).
const fill = (count, purpose, over = {}) => {
  for (let i = 0; i < count; i++) {
    rows.push({ nonce: `f${rows.length}`, user_id: "u1", wallet_address: walletKey, purpose, expires_at: new Date(Date.now() + 240000).toISOString(), used_at: null, ...over });
  }
};

test("nonce: ten outstanding nonces allowed, the eleventh is 429", async () => {
  fill(9, "link");
  assert.equal((await post(nonceRoute, "nonce", { wallet: walletKey, purpose: "link" })).status, 200);
  const over = await post(nonceRoute, "nonce", { wallet: walletKey, purpose: "link" });
  assert.equal(over.status, 429);
  assert.equal(rows.length, 10);
});

test("nonce: another account's nonces do not count toward the cap", async () => {
  fill(10, "link", { user_id: OTHER_ACCOUNT });
  assert.equal((await post(nonceRoute, "nonce", { wallet: walletKey, purpose: "link" })).status, 200);
});

test("nonce: the sixth unlink nonce in the window is 429 even when the earlier ones were used", async () => {
  fill(5, "unlink", { used_at: new Date().toISOString() });
  const res = await post(nonceRoute, "nonce", { wallet: walletKey, purpose: "unlink" });
  assert.equal(res.status, 429);
  assert.equal(rows.length, 5);
});

test("nonce: five used unlink nonces are fine, and only unlink requests are throttled this way", async () => {
  fill(4, "unlink", { used_at: new Date().toISOString() });
  assert.equal((await post(nonceRoute, "nonce", { wallet: walletKey, purpose: "unlink" })).status, 200);
  // Five unlink rows now exist; link requests are unaffected.
  assert.equal((await post(nonceRoute, "nonce", { wallet: walletKey, purpose: "link" })).status, 200);
});

test("nonce: unlink nonces older than the window are not counted", async () => {
  fill(5, "unlink", { used_at: new Date().toISOString(), expires_at: new Date(Date.now() - 11 * 60000).toISOString() });
  assert.equal((await post(nonceRoute, "nonce", { wallet: walletKey, purpose: "unlink" })).status, 200);
});

// ---- link ----
const linkBody = (p, signature, over = {}) => ({ wallet: p.wallet, nonce: p.nonce, signature, ...over });

test("link: a valid signature links the wallet", async () => {
  const p = addRow("link");
  const res = await read(await post(linkRoute, "link", linkBody(p, sign(messages.linkWalletMessage(p)))));
  assert.deepEqual([res.status, res.body], [200, { wallet: walletKey }]);
  assert.deepEqual(JSON.parse(JSON.stringify(rpcCalls)), [{ fn: "link_wallet", args: { p_nonce: "n1", p_user: "u1", p_wallet: walletKey } }]);
});

test("link: a signature by a different key is 401 and consumes nothing", async () => {
  const p = addRow("link");
  const res = await post(linkRoute, "link", linkBody(p, sign(messages.linkWalletMessage(p), nacl.sign.keyPair().secretKey)));
  assert.equal(res.status, 401);
  assert.equal(rpcCalls.length, 0);
});

test("link: a signature over the unlink message is 401", async () => {
  const p = addRow("link");
  const res = await post(linkRoute, "link", linkBody(p, sign(messages.unlinkWalletMessage(p))));
  assert.equal(res.status, 401);
  assert.equal(rpcCalls.length, 0);
});

test("link: a message naming a different account is 401", async () => {
  const p = addRow("link");
  const res = await post(linkRoute, "link", linkBody(p, sign(messages.linkWalletMessage({ ...p, accountId: OTHER_ACCOUNT }))));
  assert.equal(res.status, 401);
  assert.equal(rpcCalls.length, 0);
});

test("link: a message with a different expiry is 401 (expiry comes from the stored row)", async () => {
  const p = addRow("link");
  const res = await post(linkRoute, "link", linkBody(p, sign(messages.linkWalletMessage({ ...p, expiresAt: p.expiresAt + 86400 }))));
  assert.equal(res.status, 401);
});

test("link: unknown, wrong-purpose, other-user, used and expired nonces are 400 and never reach the RPC", async () => {
  const p = proof();
  const sig = sign(messages.linkWalletMessage(p));
  const cases = [
    () => {}, // no row
    () => addRow("unlink"),
    () => addRow("link", { user_id: OTHER_ACCOUNT }),
    () => addRow("link", { used_at: "2026-11-23T00:00:00Z" }),
    () => addRow("link", { expires_at: new Date(Date.now() - 1000).toISOString() }),
    () => addRow("link", { wallet_address: new web3.PublicKey(nacl.sign.keyPair().publicKey).toBase58() }),
  ];
  for (const setup of cases) {
    rows = [];
    setup();
    const res = await post(linkRoute, "link", linkBody(p, sig));
    assert.equal(res.status, 400);
  }
  assert.equal(rpcCalls.length, 0);
});

test("link: the RPC saying bad_nonce is 400", async () => {
  const p = addRow("link");
  rpcResult = "bad_nonce";
  assert.equal((await post(linkRoute, "link", linkBody(p, sign(messages.linkWalletMessage(p))))).status, 400);
});

test("link: a taken wallet is a generic 409 that names no account", async () => {
  const p = addRow("link");
  rpcResult = "taken";
  const res = await read(await post(linkRoute, "link", linkBody(p, sign(messages.linkWalletMessage(p)))));
  assert.deepEqual([res.status, res.body], [409, { error: "this wallet can't be linked to your account" }]);
  assert.ok(!JSON.stringify(res.body).includes(OTHER_ACCOUNT));
});

test("link: an RPC failure is 500 without database text", async () => {
  const p = addRow("link");
  rpcError = { message: "secret db detail" };
  const res = await read(await post(linkRoute, "link", linkBody(p, sign(messages.linkWalletMessage(p)))));
  assert.equal(res.status, 500);
  assert.ok(!JSON.stringify(res.body).includes("secret"));
});

test("link: malformed input is 400", async () => {
  const p = addRow("link");
  const good = sign(messages.linkWalletMessage(p));
  for (const body of [
    linkBody(p, "!!!not base64!!!"),
    linkBody(p, ""),
    linkBody(p, Buffer.from("short").toString("base64")), // valid base64, wrong length
    linkBody(p, good, { wallet: "nope" }),
    linkBody(p, good, { nonce: "" }),
    linkBody(p, good, { nonce: "a".repeat(500) }),
    linkBody(p, good, { nonce: "n1\nExpires: x" }),
    linkBody(p, good, { nonce: 5 }),
    { wallet: p.wallet, nonce: p.nonce },
  ]) {
    assert.equal((await post(linkRoute, "link", body)).status, 400, JSON.stringify(body).slice(0, 80));
  }
  assert.equal(rpcCalls.length, 0);
});

test("link: a foreign Origin is 403", async () => {
  const p = addRow("link");
  const res = await post(linkRoute, "link", linkBody(p, sign(messages.linkWalletMessage(p))), { origin: "https://evil.app" });
  assert.equal(res.status, 403);
  assert.equal(rpcCalls.length, 0);
});

// ---- unlink ----
const unlinkBody = (p, signature, over = {}) => ({ wallet: p.wallet, nonce: p.nonce, signature, password: "hunter2hunter2", ...over });

const json = (x) => JSON.parse(JSON.stringify(x));
const unlinkReq = (p, over = {}) => post(unlinkRoute, "unlink", unlinkBody(p, sign(messages.unlinkWalletMessage(p)), over));

test("unlink: success claims the nonce, re-checks the password, deletes the link and drops the throwaway session", async () => {
  const p = addRow("unlink");
  const res = await read(await unlinkReq(p));
  assert.deepEqual([res.status, res.body], [200, { wallet: walletKey }]);
  assert.equal(rpcCalls.length, 0, "no unlink_wallet RPC any more");
  assert.deepEqual(json(deleteCalls), [{ wallet_address: walletKey, user_id: "u1" }]);
  assert.equal(linkedWallets.length, 0);
  assert.ok(rows[0].used_at, "nonce spent");
  assert.deepEqual(json(signInCalls), [{ email: "a@b.co", password: "hunter2hunter2" }]);
  assert.deepEqual(json(signOutCalls), [{ scope: "local" }]);
  assert.deepEqual(json(clientOptions.options.auth), { persistSession: false, autoRefreshToken: false });
  assert.equal(clientOptions.key, "sb_publishable_x");
});

test("unlink: a wrong password is 401, spends the nonce and deletes nothing", async () => {
  const p = addRow("unlink");
  signIn = { data: { session: null }, error: { status: 400, code: "invalid_credentials", message: "Invalid login credentials" } };
  const res = await read(await unlinkReq(p));
  assert.equal(res.status, 401);
  assert.ok(rows[0].used_at, "nonce spent by the claim");
  assert.equal(deleteCalls.length, 0);
  assert.ok(!JSON.stringify(res.body).includes("a@b.co"));
  // Replaying with the right password is refused without another guess.
  signIn = { data: { session: {} }, error: null };
  assert.equal((await unlinkReq(p)).status, 400);
  assert.equal(signInCalls.length, 1);
  assert.equal(deleteCalls.length, 0);
});

test("unlink: two concurrent requests with one nonce get exactly one password guess", async () => {
  const p = addRow("unlink");
  signIn = { data: { session: null }, error: { status: 400, code: "invalid_credentials", message: "Invalid login credentials" } };
  const results = await Promise.all([unlinkReq(p), unlinkReq(p)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [400, 401]);
  assert.equal(signInCalls.length, 1);
  assert.equal(deleteCalls.length, 0);
});

test("unlink: an auth outage is 503, says to request a new one, and the nonce is spent", async () => {
  const p = addRow("unlink");
  signIn = { data: { session: null }, error: { status: 503, message: "upstream" } };
  const res = await read(await unlinkReq(p));
  assert.equal(res.status, 503);
  assert.match(res.body.error, /new one/);
  assert.ok(rows[0].used_at);
  assert.equal(deleteCalls.length, 0);
});

test("unlink: an auth rate limit is also 503 and deletes nothing", async () => {
  const p = addRow("unlink");
  signIn = { data: { session: null }, error: { status: 429, message: "rate" } };
  assert.equal((await unlinkReq(p)).status, 503);
  assert.equal(deleteCalls.length, 0);
});

test("unlink: an open stake is 409 and leaves the nonce unspent, with no password attempt", async () => {
  const p = addRow("unlink");
  openStake = true;
  const res = await read(await post(unlinkRoute, "unlink", unlinkBody(p, sign(messages.unlinkWalletMessage(p)))));
  assert.deepEqual([res.status, res.body], [409, { error: "this wallet still has an open stake or an unclaimed payout" }]);
  assert.equal(rows[0].used_at, null);
  assert.equal(signInCalls.length, 0);
  assert.equal(deleteCalls.length, 0);
});

test("unlink: a signature over the link message is 401 and the password is never tried", async () => {
  const p = addRow("unlink");
  const res = await post(unlinkRoute, "unlink", unlinkBody(p, sign(messages.linkWalletMessage(p))));
  assert.equal(res.status, 401);
  assert.equal(signInCalls.length, 0);
  assert.equal(deleteCalls.length, 0);
});

test("unlink: a link-purpose nonce does not work", async () => {
  const p = addRow("link");
  const res = await post(unlinkRoute, "unlink", unlinkBody(p, sign(messages.unlinkWalletMessage(p))));
  assert.equal(res.status, 400);
  assert.equal(rpcCalls.length, 0);
});

test("unlink: a wallet that is not linked is 409 (nothing deleted)", async () => {
  const p = addRow("unlink");
  linkedWallets = [];
  assert.equal((await unlinkReq(p)).status, 409);
});

test("unlink: only this account's link row is deleted", async () => {
  const p = addRow("unlink");
  linkedWallets = [{ wallet_address: walletKey, user_id: OTHER_ACCOUNT }];
  assert.equal((await unlinkReq(p)).status, 409);
  assert.equal(linkedWallets.length, 1);
});

test("unlink: a database failure on delete is 500", async () => {
  const p = addRow("unlink");
  deleteError = { message: "secret db detail" };
  const res = await read(await unlinkReq(p));
  assert.equal(res.status, 500);
  assert.ok(!JSON.stringify(res.body).includes("secret"));
});

test("unlink: a missing or non-string password is 400", async () => {
  const p = addRow("unlink");
  const sig = sign(messages.unlinkWalletMessage(p));
  for (const password of [undefined, "", 5, "x".repeat(2000)]) {
    assert.equal((await post(unlinkRoute, "unlink", unlinkBody(p, sig, { password }))).status, 400);
  }
  assert.equal(signInCalls.length, 0);
});
