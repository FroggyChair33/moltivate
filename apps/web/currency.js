// Display estimates only. Challenge fixtures and all rankings stay denominated in SOL.
const PRICE_URL = 'https://api.coinbase.com/v2/prices/SOL-USD/spot';
const REFRESH_MS = 60_000;
const MAX_AGE_MS = 5 * 60_000;
const subscribers = new Set();
let requested = 'SOL';
let quote = null;
let pending = null;
let failed = false;
let timer = null;

export function currencyState() {
  const usable = quote && Date.now() - quote.at < MAX_AGE_MS;
  return {
    requested,
    currency: requested === 'USD' && usable ? 'USD' : 'SOL',
    price: usable ? quote.price : null,
    updatedAt: usable ? quote.at : null,
    loading: Boolean(pending),
    failed,
  };
}

function notify() { subscribers.forEach(listener => listener(currencyState())); }

export function subscribeCurrency(listener) {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export async function refreshPrice() {
  if (pending) return pending;
  failed = false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  pending = (async () => {
    try {
      const response = await fetch(PRICE_URL, {
        signal: controller.signal, credentials: 'omit', cache: 'no-store',
      });
      if (!response.ok) throw new Error('Price unavailable');
      const { data } = await response.json();
      const price = Number(data?.amount);
      if (data?.base !== 'SOL' || data?.currency !== 'USD' || !Number.isFinite(price) || price <= 0) {
        throw new Error('Invalid SOL/USD quote');
      }
      quote = { price, at: Date.now() };
    } catch {
      failed = true;
    } finally {
      clearTimeout(timeout);
      pending = null;
      notify();
    }
  })();
  notify();
  return pending;
}

export function setCurrency(next) {
  if (next !== 'SOL' && next !== 'USD') return;
  requested = next;
  clearInterval(timer);
  timer = null;
  notify();
  if (next === 'USD') {
    if (!quote || Date.now() - quote.at >= REFRESH_MS || failed) void refreshPrice();
    timer = setInterval(() => {
      if (!document.hidden && subscribers.size) void refreshPrice();
    }, REFRESH_MS);
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && requested === 'USD') {
    // Expire old estimates before a backgrounded page becomes usable again.
    notify();
    if (!quote || Date.now() - quote.at >= REFRESH_MS) void refreshPrice();
  }
});

export function formatMoney(sol, { signed = false, decimals = 3 } = {}) {
  const state = currencyState();
  const number = Number(sol);
  if (!Number.isFinite(number)) return '—';
  const usd = state.currency === 'USD';
  const value = usd ? number * state.price : number;
  const digits = usd ? 2 : decimals;
  const magnitude = Math.abs(value).toFixed(digits);
  const sign = value < 0 && Number(magnitude) !== 0 ? '−' : signed ? '+' : '';
  return `${sign}${usd ? '$' : ''}${magnitude}`;
}

export function money(sol, { signed = false, decimals = 3 } = {}) {
  return `<span data-sol-value="${sol}" data-decimals="${decimals}"${signed ? ' data-signed' : ''}>${formatMoney(sol, { signed, decimals })}</span>`;
}

export function updateMoney(root) {
  const usd = currencyState().currency === 'USD';
  root.querySelectorAll('[data-sol-value]').forEach(node => {
    node.textContent = formatMoney(node.dataset.solValue, {
      signed: node.hasAttribute('data-signed'), decimals: Number(node.dataset.decimals ?? 3),
    });
  });
  root.querySelectorAll('[data-currency-unit]').forEach(node => {
    node.textContent = usd ? 'USD est.' : 'demo SOL';
  });
}

const styles = `
:host{display:block;--currency-line:#cbd4c5;--currency-muted:#6b7864;--currency-active:#173e2c;--currency-ink:#fff;font-family:'DM Sans',Arial,sans-serif;color:inherit}
:host([dark]){--currency-line:#373a42;--currency-muted:#989da7;--currency-active:#e9ede4;--currency-ink:#172b20}
:host(:not([compact])){container-type:inline-size}:host([compact]){width:90px}
*{box-sizing:border-box}.bar{display:flex;align-items:center;justify-content:flex-start;gap:16px}.label{font-size:10px;color:var(--currency-muted)}
.switch{display:inline-flex;padding:3px;border:1px solid var(--currency-line);border-radius:8px;flex-shrink:0;gap:2px}
button{font:600 11px 'DM Sans',Arial,sans-serif;border:0;background:none;color:inherit;cursor:pointer;touch-action:manipulation}
.switch button{min-width:47px;min-height:30px;padding:5px 10px;border-radius:5px;transition:background .18s,color .18s,transform .18s}.switch button:hover{background:#8d9c7d20}.switch button:active{transform:scale(.96)}.switch button[aria-pressed=true]{background:var(--currency-active);color:var(--currency-ink)}
button:focus-visible,a:focus-visible{outline:2px solid #e6a66e;outline-offset:3px}
.quote{font-size:9px;line-height:1.55;color:var(--currency-muted);min-width:0}.rate{font-variant-numeric:tabular-nums}.source{display:block;font-size:8px}.source a{color:inherit;text-underline-offset:2px}.retry{padding:0 0 0 5px;font-size:9px;text-decoration:underline;text-underline-offset:2px}.retry[hidden]{display:none}
:host([compact]) .bar{gap:0;display:block;text-align:right}:host([compact]) .label{display:none}:host([compact]) .switch{padding:2px;border-radius:7px}:host([compact]) .switch button{min-width:38px;min-height:25px;padding:4px 7px;font-size:9px}:host([compact]) .quote{margin-top:3px;font-size:8px;line-height:1.4}:host([compact]) .source{font-size:7px}:host([compact]) .source a{text-decoration:none}
@media(prefers-reduced-motion:reduce){button{transition:none!important}}
@container(max-width:330px){.label{display:none}.bar{gap:10px}.quote{margin-left:auto}}
`;

class CurrencySwitch extends HTMLElement {
  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `<style>${styles}</style><div class="bar">
      <span class="label">View amounts in</span>
      <div class="switch" role="group" aria-label="Display currency">
        <button data-currency="SOL" aria-label="Show amounts in SOL" aria-pressed="true">SOL</button>
        <button data-currency="USD" aria-label="Show amounts in US dollars" aria-pressed="false">USD</button>
      </div>
      <div class="quote" role="status"><span class="rate"></span><button class="retry" hidden>Retry</button><span class="source"></span></div>
    </div>`;
    this.shadowRoot.querySelectorAll('[data-currency]').forEach(button => button.addEventListener('click', () => {
      setCurrency(button.dataset.currency);
      this.dispatchEvent(new CustomEvent('moltivate:currency-interact', { bubbles: true, composed: true, detail: button.dataset.currency }));
    }));
    this.shadowRoot.querySelector('.retry').addEventListener('click', () => void refreshPrice());
    this.unsubscribe = subscribeCurrency(() => this.update());
    this.update();
  }

  disconnectedCallback() { this.unsubscribe?.(); }

  focusCurrency(currency) { this.shadowRoot.querySelector(`[data-currency="${currency}"]`)?.focus({ preventScroll: true }); }

  update() {
    const state = currencyState();
    this.shadowRoot.querySelectorAll('[data-currency]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.currency === state.requested)));
    const rate = this.shadowRoot.querySelector('.rate');
    const source = this.shadowRoot.querySelector('.source');
    this.shadowRoot.querySelector('.retry').hidden = !state.failed || state.loading || state.requested !== 'USD';
    if (state.price) {
      rate.textContent = `1 SOL ≈ $${state.price.toFixed(2)}`;
      const time = new Date(state.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      source.innerHTML = `<a href="https://www.coinbase.com/price/solana" target="_blank" rel="noopener noreferrer">Coinbase</a> · ${state.failed ? 'last rate · ' : ''}${time}`;
      source.title = `Price retrieved ${new Date(state.updatedAt).toLocaleString()}. Estimates exclude fees. Demo amounts are not real balances.`;
    } else {
      rate.textContent = state.requested === 'SOL' ? 'See the dollar value' : state.loading ? 'Getting SOL price…' : 'Price unavailable';
      source.textContent = state.requested === 'USD' ? 'Showing SOL for now' : 'Sample amounts';
      source.removeAttribute('title');
    }
  }
}

if (!customElements.get('currency-switch')) customElements.define('currency-switch', CurrencySwitch);
