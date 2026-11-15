export const PRESET_SECONDS = [3, 5, 7, 10, 15, 30];
export const DEFAULT_SECONDS = 7;
export const validSeconds = value => Number.isInteger(value) && value >= 1 && value <= 60;

// Camera owner resolves onRecord only when recording STARTS, not when the file
// finishes. It must honor AbortSignal and stop any late native recording.
export class PrepCountdown {
  constructor({ onChange, onRecord, canStart, clock = () => performance.now(),
    every = fn => setInterval(fn, 100), clear = id => clearInterval(id) }) {
    Object.assign(this, { onChange, onRecord, canStart, clock, every, clear });
    this.state = { phase: 'idle', remaining: null, message: '' };
    this.generation = 0;
    this.timer = null;
  }
  publish(state) { this.state = state; this.onChange(state); }
  stopTimer() { if (this.timer !== null) this.clear(this.timer); this.timer = null; }
  start(seconds) {
    if (this.disposed || !['idle', 'error'].includes(this.state.phase)) return false;
    if (!validSeconds(seconds)) {
      this.publish({ phase: 'error', remaining: null, message: 'Choose 1–60 seconds.' });
      return false;
    }
    if (!this.canStart()) {
      this.publish({ phase: 'error', remaining: null, message: 'Get the camera ready before starting.' });
      return false;
    }
    this.generation++;
    this.abort = new AbortController();
    this.lastTick = this.clock();
    this.deadline = this.lastTick + seconds * 1000;
    this.publish({ phase: 'counting', remaining: seconds, message: 'Get into position' });
    this.timer = this.every(() => this.tick());
    return true;
  }
  tick() {
    if (this.state.phase !== 'counting') return;
    const now = this.clock();
    if (!this.canStart() || now < this.lastTick || now - this.lastTick > 1500) {
      this.cancel('Countdown interrupted. Start again when you’re ready.');
      return;
    }
    this.lastTick = now;
    const remaining = Math.max(0, Math.ceil((this.deadline - now) / 1000));
    if (remaining > 0) {
      if (remaining !== this.state.remaining) this.publish({ ...this.state, remaining });
      return;
    }
    this.stopTimer();
    this.publish({ phase: 'starting', remaining: null, message: 'Starting camera…' });
    const generation = this.generation;
    const signal = this.abort.signal;
    Promise.resolve().then(() => {
      if (signal.aborted || generation !== this.generation) return;
      if (!this.canStart()) throw new Error('Camera is no longer ready.');
      const started = this.onRecord(signal);
      if (!started || typeof started.then !== 'function') throw new Error('Recording adapter must acknowledge start asynchronously.');
      return started;
    }).then(() => {
      if (signal.aborted || generation !== this.generation) return;
      if (!this.canStart()) { this.cancel('Camera interrupted. Please try again.'); return; }
      this.publish({ phase: 'recording', remaining: null, message: 'Go! Recording' });
    }).catch(() => {
      if (signal.aborted || generation !== this.generation) return;
      this.abort.abort();
      this.publish({ phase: 'error', remaining: null, message: 'Couldn’t start the camera. Please try again.' });
    });
  }
  cancel(message = '') {
    this.generation++;
    this.stopTimer();
    this.abort?.abort();
    this.publish({ phase: 'idle', remaining: null, message });
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    this.stopTimer();
    this.abort?.abort();
  }
}
