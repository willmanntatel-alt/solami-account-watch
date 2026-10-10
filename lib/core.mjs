export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function validAddress(value) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return false;
  let n = 0n;
  for (const c of value) { const digit = alphabet.indexOf(c); if (digit < 0) return false; n = n * 58n + BigInt(digit); }
  let bytes = 0;
  while (n > 0n) { bytes++; n >>= 8n; }
  return bytes + (value.match(/^1*/)?.[0].length ?? 0) === 32;
}

export function lamportsText(value) {
  const n = BigInt(value); const sign = n < 0 ? '-' : ''; const a = n < 0 ? -n : n;
  return sign + (a / 1000000000n) + '.' + (a % 1000000000n).toString().padStart(9, '0');
}

export function summarizeTransaction(tx, watched) {
  if (!tx?.meta) return null;
  const keys = tx.transaction.message.accountKeys.map(k => typeof k === 'string' ? { pubkey: k } : k);
  const changes = [];
  for (const address of watched) {
    const index = keys.findIndex(k => k.pubkey === address);
    if (index < 0) continue;
    const pre = tx.meta.preBalances[index]; const post = tx.meta.postBalances[index];
    // RPC JSON numbers lose precision above MAX_SAFE_INTEGER; do not publish a rounded delta.
    const exact = Number.isSafeInteger(pre) && Number.isSafeInteger(post);
    changes.push({ address, nativeChange: exact ? lamportsText(BigInt(post) - BigInt(pre)) : null,
      precision: exact ? 'exact' : 'unsafe RPC integer; delta omitted' });
  }
  return { fee: Number.isSafeInteger(tx.meta.fee) ? lamportsText(tx.meta.fee) : null,
    failed: Boolean(tx.meta.err), error: tx.meta.err, changes,
    signerCount: keys.filter(k => k.signer).length,
    programs: [...new Set(tx.transaction.message.instructions.map(i => i.programId).filter(Boolean))],
    computeUnits: tx.meta.computeUnitsConsumed ?? null };
}

export class Ledger {
  constructor(capacity = 240) { this.capacity = capacity; this.entries = new Map(); }
  add(signature, slot, address, source, time = null) {
    let row = this.entries.get(signature);
    if (!row) { row = { signature, slot, addresses: [], sources: [], firstSeen: Date.now(), blockTime: time, detail: null, attempts: 0 }; this.entries.set(signature, row); }
    row.slot = Math.max(row.slot ?? 0, slot ?? 0);
    if (!row.addresses.includes(address)) row.addresses.push(address);
    if (!row.sources.includes(source)) row.sources.push(source);
    if (time) row.blockTime = time;
    while (this.entries.size > this.capacity) {
      const oldest = [...this.entries.values()].sort((a,b) => a.slot - b.slot || a.firstSeen - b.firstSeen)[0];
      this.entries.delete(oldest.signature);
    }
    return row;
  }
  list() { return [...this.entries.values()].sort((a,b) => b.slot - a.slot || b.firstSeen - a.firstSeen); }
}

// Catch up to the previous confirmed checkpoint, with a bounded page budget.
// Never claim complete coverage when the provider omitted the checkpoint or the budget ran out.
export async function backfill(fetchPage, checkpoint, maxPages = 4, limit = 50) {
  const rows = []; let before; let complete = false;
  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchPage({ limit, ...(before ? { before } : {}) });
    let reached = false;
    for (const row of batch) { if (row.signature === checkpoint) { reached = true; break; } rows.push(row); }
    if (reached) { complete = true; break; }
    if (batch.length < limit) break; // A missing checkpoint may have been pruned; do not assert recovery.
    if (!checkpoint) break; // initial view is explicitly a recent-history window
    const next = batch.at(-1)?.signature;
    if (!next || next === before) break;
    before = next;
  }
  return { rows, complete: checkpoint ? complete : null, newest: rows[0]?.signature ?? checkpoint };
}

export function safeError(error, secret = '') {
  let message = String(error?.message ?? error);
  if (secret) message = message.split(secret).join('[redacted]');
  return message.replace(/api_key=[^\s&"']+/gi, 'api_key=[redacted]').slice(0,240);
}
