# Live mainnet demonstration

[Play or download demo.mp4](demo.mp4)

Recorded on 2026-10-10 from the running local dashboard. Duration: approximately 2 minutes 33 seconds. Public wallet watched: `6iBpYUVgjt4ZwJjkbHAJErTxgBMoCKmwjRBKH8XA5TJ9`. This account was found as a public transaction fee payer during live testing; no ownership or affiliation is claimed.

The video uses timestamped browser screencast frames captured over approximately 150 seconds, encoded to MP4 with English captions and a short final held frame. The original elapsed timing is preserved. The dashboard refreshes every 2.5 seconds; this is not a claim of high-frame-rate native desktop capture. No chain values or transactions were fabricated, and no credentials appear in the recording.

| Time | What to inspect |
| --- | --- |
| 00:00 | Mainnet verified, advancing processed/finalized slots, connected stream |
| 00:20 | Public account state, transaction timeline, fees and exact native changes |
| 00:54 | Failed transactions remain visible with fees |
| 01:09 | HTTP catch-up provenance, merged with WebSocket observations |
| 01:26 | Manual reconnect: subscriptions reopen; reconnect count advances |
| 01:58 | Connection journal, updated account state and coverage disclosure |

For example, the reconnect segment shows processed slot `455273875`, 1,298 stream frames, 62 retained transactions, 27 failed observations and 144 HTTP calls with 0 errors at that moment. These are observed counters for this run, not throughput benchmarks or guarantees about future provider performance.

All upstream data is read through Solami RPC and Solami's standard WebSocket endpoint. The app first checks the full Solana mainnet genesis hash. The frontend receives sanitized snapshots from a loopback-only server; it has no upstream API key.

Manual reconnection exercises subscriptions and checkpoint reconciliation. It does not simulate a long outage or prove zero missed transactions. HTTP catch-up is bounded to 200 signatures per account; missing checkpoints are disclosed as possible gaps. State is in memory and resets on process restart. The timeline retains 240 entries. Native balance deltas include fees, rent and transfers, and are not profit.

Run instructions and key configuration are in [README.md](README.md). Eleven deterministic tests cover deduplication, exact lamports, checkpoint recovery and gaps, watchlist isolation, transaction failures, unsafe JSON integers, secret redaction and RPC queue recovery.

AI-assisted implementation and browser operation for a single human participant.
