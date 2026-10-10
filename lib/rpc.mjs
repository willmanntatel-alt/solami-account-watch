import { safeError } from './core.mjs';
const allowed = new Set(['getGenesisHash','getVersion','getSlot','getAccountInfo','getSignaturesForAddress','getTransaction']);

export class Rpc {
  constructor({ key, endpoint, interval = 220, fetchImpl = fetch }) {
    this.key = key; this.url = new URL(endpoint); this.url.searchParams.set('api_key', key);
    this.interval = interval; this.fetchImpl = fetchImpl; this.tail = Promise.resolve(); this.lastStart = 0;
    this.metrics = { requests: 0, failures: 0, latency: [], lastSuccess: null, lastError: null };
  }
  call(method, params = []) {
    if (!allowed.has(method)) return Promise.reject(new Error('Only read RPC methods are allowed'));
    const job = this.tail.then(async () => {
      const delay = this.interval - (Date.now() - this.lastStart);
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      this.lastStart = Date.now(); this.metrics.requests++;
      const started = performance.now();
      try {
        const response = await this.fetchImpl(this.url, { method: 'POST', headers: { 'content-type':'application/json' },
          body: JSON.stringify({ jsonrpc:'2.0', id:this.metrics.requests, method, params }), signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
        const body = await response.json();
        if (body.error) throw new Error(`RPC ${body.error.code}: ${body.error.message}`);
        if (!Object.hasOwn(body,'result')) throw new Error('Invalid RPC response');
        this.metrics.lastSuccess = Date.now(); this.metrics.lastError = null;
        this.metrics.latency.push(Math.round(performance.now() - started));
        this.metrics.latency = this.metrics.latency.slice(-60);
        return body.result;
      } catch (error) {
        this.metrics.failures++; this.metrics.lastError = safeError(error,this.key);
        throw new Error(this.metrics.lastError);
      }
    });
    this.tail = job.catch(() => {});
    return job;
  }
  summary() {
    const samples = [...this.metrics.latency].sort((a,b) => a-b);
    const p95 = samples.length ? samples[Math.ceil(samples.length * .95)-1] : null;
    return { ...this.metrics, latency: undefined, p95, samples: samples.length };
  }
}
