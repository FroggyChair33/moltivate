// Display-only demo amounts. Never use this formatter for settlement arithmetic.
const amountFormatter = new Intl.NumberFormat('en-US', {
  useGrouping: false,
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

export function formatAmount(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return '—';
  const magnitude = amountFormatter.format(Math.abs(number));
  const negative = number < 0 && magnitude !== '0.000';
  return `${negative ? '−' : '+'}${magnitude}`;
}

const styles = `
:host{display:inline-flex;vertical-align:bottom;min-width:6ch;justify-content:flex-end;color:inherit;font:inherit;font-variant-numeric:tabular-nums;white-space:nowrap;line-height:1.15;letter-spacing:0}
.amount{display:inline-flex;align-items:flex-start;justify-content:flex-end;height:1.15em}
.fixed,.digit{display:inline-block;flex:0 0 .62em;width:.62em;height:1.15em;line-height:1.15em;text-align:center}
.fixed.decimal{flex-basis:.4em;width:.4em}.digit{overflow:hidden;position:relative}
.reel{display:flex;flex-direction:column;will-change:transform}
.cell{display:block;flex:0 0 1.15em;height:1.15em;line-height:1.15em;text-align:center}
@media(prefers-reduced-motion:reduce){.reel{will-change:auto}}
`;

class RollingAmount extends HTMLElement {
  static observedAttributes = ['value'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.animations = [];
    this.reels = [];
    this.revision = 0;
    this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    this.onMotionChange = () => { if (this.motionQuery.matches) this.settle(); };
  }

  connectedCallback() {
    this.setAttribute('role', 'img');
    this.motionQuery.addEventListener('change', this.onMotionChange);
    this.render(false);
  }

  disconnectedCallback() {
    this.motionQuery.removeEventListener('change', this.onMotionChange);
    this.cancel();
  }

  attributeChangedCallback(name, previous, next) {
    if (name === 'value' && previous !== next && this.isConnected) this.render(true);
  }

  get value() { return Number(this.getAttribute('value') ?? 0); }
  set value(next) { this.setAttribute('value', String(next)); }

  // A parent pause/visibility control can finish the display immediately.
  settle() { if (this.isConnected) this.render(false); }

  cancel() {
    this.revision += 1;
    this.animations.forEach(animation => animation.cancel());
    this.animations = [];
  }

  capture() {
    const previous = new Map();
    for (const { place, viewport, strip, digits } of this.reels) {
      const bounds = viewport.getBoundingClientRect();
      if (!bounds.height) continue;
      const position = Math.max(0, Math.min(digits.length - 1,
        (bounds.top - strip.getBoundingClientRect().top) / bounds.height));
      const index = Math.floor(position + 0.00001);
      previous.set(place, { digit: digits[index], fraction: position - index });
    }
    return previous;
  }

  render(animate) {
    const previous = animate ? this.capture() : new Map();
    this.cancel();
    const revision = this.revision;
    const formatted = formatAmount(this.getAttribute('value'));
    this.setAttribute('aria-label', formatted === '—' ? 'Amount unavailable' : formatted);
    this.dataset.value = formatted;
    this.reels = [];
    this.shadowRoot.innerHTML = `<style>${styles}</style><span class="amount" aria-hidden="true"></span>`;
    const amount = this.shadowRoot.querySelector('.amount');
    const decimalIndex = formatted.indexOf('.');
    const canAnimate = animate && !this.motionQuery.matches && typeof Element.prototype.animate === 'function';
    let digitIndex = 0;
    for (const [index, character] of [...formatted].entries()) {
      if (!/\d/.test(character)) {
        const fixed = document.createElement('span');
        fixed.className = `fixed${character === '.' ? ' decimal' : ''}`;
        fixed.textContent = character;
        amount.append(fixed);
        continue;
      }
      const place = index - decimalIndex;
      const target = Number(character);
      const start = previous.get(place) ?? { digit: target, fraction: 0 };
      const steps = canAnimate ? 20 + (target - start.digit + 10) % 10 : 0;
      const digits = canAnimate
        ? Array.from({ length: steps + 1 }, (_, step) => (start.digit + step) % 10)
        : [target];
      const viewport = document.createElement('span');
      viewport.className = 'digit';
      const strip = document.createElement('span');
      strip.className = 'reel';
      digits.forEach(digit => {
        const cell = document.createElement('span');
        cell.className = 'cell';
        cell.textContent = String(digit);
        strip.append(cell);
      });
      viewport.append(strip);
      amount.append(viewport);
      this.reels.push({ place, viewport, strip, digits });
      if (canAnimate) {
        const stagger = Math.min(digitIndex, 5);
        const animation = strip.animate([
          { transform: `translateY(${-start.fraction * 1.15}em)` },
          { transform: `translateY(${-steps * 1.15}em)` },
        ], {
          duration: 980 + stagger * 35,
          delay: stagger * 25,
          easing: 'cubic-bezier(.14,.64,.12,1)',
          fill: 'both',
        });
        this.animations.push(animation);
      }
      digitIndex += 1;
    }
    if (this.animations.length) {
      this.dataset.rolling = 'true';
      Promise.all(this.animations.map(animation => animation.finished))
        .then(() => { if (this.isConnected && revision === this.revision) this.render(false); })
        .catch(() => { /* Cancellation is expected on replacement or disconnect. */ });
    } else {
      this.dataset.rolling = 'false';
    }
  }
}

if (!customElements.get('rolling-amount')) customElements.define('rolling-amount', RollingAmount);
