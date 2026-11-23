// A tiny in-memory stand-in for Supabase, for tests/ui-smoke.mjs only. The Next server verifies sessions and reads
// tables from Node, where Playwright routes can't reach, so this is a real HTTP server the app is built against
// (NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:<port>). It answers only what the smoke run makes the server call;
// anything else is a 404 so a missing mock fails loudly. No real keys, users or data.
import { createServer } from 'node:http';

const b64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const USER_ID = '00000000-0000-4000-8000-000000000001';
const EMAIL = 'smoke@example.test';

export async function startFakeSupabase(port) {
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  // HS256 with no kid: auth-js getClaims() can't verify it locally, so it falls back to GET /auth/v1/user (below).
  const accessToken = [b64url({ alg: 'HS256', typ: 'JWT' }),
    b64url({ sub: USER_ID, exp, aud: 'authenticated', role: 'authenticated', aal: 'aal1', session_id: '00000000-0000-4000-8000-000000000002', email: EMAIL }),
    b64url('not-a-real-signature')].join('.');
  const user = { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: EMAIL, email_confirmed_at: '2026-11-01T00:00:00Z', app_metadata: {}, user_metadata: {}, factors: [], created_at: '2026-11-01T00:00:00Z' };
  // Tables the server reads. linked_wallets is rewritten by setLinkedWallets().
  const tables = {
    profiles: [{ user_id: USER_ID, display_name: 'Smoke Tester' }],
    linked_wallets: [],
    closed_challenges: [],
    workout_sessions: [],
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://fake');
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && url.pathname === '/auth/v1/user') {
      return req.headers.authorization === 'Bearer ' + accessToken ? send(200, user) : send(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid token' });
    }
    const table = req.method === 'GET' && url.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1];
    if (!table || !tables[table]) return send(404, { message: `fake-supabase: no mock for ${req.method} ${url.pathname}` });
    // PostgREST filters as postgrest-js sends them: col=eq.value and col=in.(a,b).
    let rows = tables[table];
    for (const [column, filter] of url.searchParams) {
      if (column === 'select') continue;
      const [, op, arg] = filter.match(/^(eq|in)\.(.*)$/) ?? [];
      if (!op) return send(400, { message: `fake-supabase: unsupported filter ${column}=${filter}` });
      const allowed = op === 'eq' ? [arg] : arg.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, ''));
      rows = rows.filter((row) => allowed.includes(String(row[column])));
    }
    const columns = (url.searchParams.get('select') ?? '*').split(',');
    send(200, columns[0] === '*' ? rows : rows.map((row) => Object.fromEntries(columns.map((c) => [c, row[c]]))));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });

  const session = { access_token: accessToken, token_type: 'bearer', expires_in: 24 * 3600, expires_at: exp, refresh_token: 'smoke-refresh-token', user };
  const cookieValue = 'base64-' + b64url(session);
  // @supabase/ssr splits values over 3180 chars into .0/.1 chunks; keep the session small enough for one cookie.
  if (cookieValue.length > 3180) throw new Error('fake-supabase: session cookie would be chunked');
  return {
    // @supabase/supabase-js names the cookie sb-<first label of the URL host>-auth-token: sb-127-auth-token here.
    sessionCookie: { name: 'sb-127-auth-token', value: cookieValue },
    setLinkedWallets(wallets) { tables.linked_wallets = wallets.map((wallet_address) => ({ wallet_address, user_id: USER_ID })); },
    close() { server.close(); server.closeAllConnections(); },
  };
}
