# Solami Account Watch

A read-only Solana mainnet monitor built on **Solami RPC and standard WebSocket subscriptions**. It follows up to three public accounts, reconciles their recent confirmed signatures after disconnects, deduplicates the stream and HTTP observations, and displays transaction fees, failure status and precise native-balance changes.

[Watch the live mainnet demo (2m 33s)](https://github.com/willmanntatel-alt/solami-account-watch/blob/main/demo.mp4) · [Demo notes](DEMO.md)

## Run

Node.js **24 or later**. No runtime dependencies or wallet connection.

```sh
cp .env.example .env.local
# Set SOLAMI_API_KEY in .env.local to your own Solami RPC or API key.
npm start
```

Windows PowerShell: `Copy-Item .env.example .env.local`.

If npm is not installed, start directly with `node --env-file-if-exists=.env.local server.mjs`; tests also run directly with `node --test test/*.test.mjs`.

Open **http://127.0.0.1:5017**. Watch a public wallet or account. The default is a public fee-payer address observed during the live mainnet test on 2026-10-10, with no ownership or affiliation claimed. Its future activity is not guaranteed. Replace it with an active public account of interest in the dashboard, or set `WATCH_ACCOUNTS` to a comma-separated list in `.env.local`. Changing the watchlist resets the timeline and recent-history checkpoints.

| Variable | Purpose |
| --- | --- |
| `SOLAMI_API_KEY` | Your RPC/API key, kept on the server |
| `SOLAMI_RPC_URL` | `https://rpc.solami.dev/sol` by default |
| `SOLAMI_WS_URL` | `wss://ws.solami.dev/ws/sol` by default |
| `WATCH_ACCOUNTS` | One to three public Solana addresses |
| `PORT` | Local port; default 5017 |

Only official `solami.dev` HTTPS/WSS endpoints are accepted. There is no fallback to another provider. The app checks the **full mainnet genesis hash** before monitoring and stops if it does not match. Missing credentials show a configuration message, not synthetic data.

## What Solami does

- `slotSubscribe` streams slot progression.
- `logsSubscribe` streams transaction signatures mentioning each watched account at `confirmed` commitment.
- `accountSubscribe` streams account-state updates.
- `getAccountInfo` reconciles account balances and parsed account types.
- `getSignaturesForAddress` paginates recent confirmed history back to the previous checkpoint, every 15 seconds and after reconnect.
- `getTransaction` loads recent transaction metadata at `confirmed`, with version-0 support.
- `getGenesisHash`, `getVersion`, and `getSlot` provide network identity and observed node state.

All upstream calls use Solami. HTTP reads are serialized with at least 220ms between starts (under 5 requests/second). The app opens one WebSocket connection, uses reconnect backoff, and requests recovery if the stream goes silent for 45 seconds. The **Reconnect stream** button exercises that path without submitting an on-chain transaction.

## Honest coverage and limits

This is an observation tool, not an archival indexer. Initial history is the latest 50 signatures. Catch-up is bounded to four pages of 50 signatures per account; if the prior checkpoint is not reached within that budget or is absent from the provider's history, the UI marks possible gaps. The retained timeline is bounded to 240 entries. Busy program accounts can exceed this window quickly. Solami rejects signature-by-address lookups for some high-cardinality program/system accounts (observed RPC -32011 for the System Program); choose a focused public wallet for recovery and transaction details. Such errors are displayed, not hidden.

Streaming observations may precede confirmed HTTP transaction details. A signature without metadata is explicitly marked as queued or unavailable after three attempts. Transaction versions newer than 0 are not decoded. Failed transactions remain visible. RPC JSON integers above JavaScript's safe range do **not** produce a rounded native-balance delta; the delta is omitted with a precision label. Native balance changes include fees, rent, and transfers and are not classified as trading volume or profit.

Processed and finalized slots show the same provider's observed state, not a benchmark against the entire network. Latency p95 uses the last 60 successful HTTP requests; errors have a separate counter.

The process retains state in memory. Restarting loses its checkpoints and starts a new recent-history window. No claim of complete recovery across process restarts is made.

## Validation

```sh
npm test
```

Tests cover decoded address length, exact lamport display, duplicate/out-of-order observations, paginated checkpoint recovery, gap disclosure, transaction failures and unsafe-number handling, credential redaction, and HTTP failures without breaking the request queue. Tests use fixtures only; a live mainnet run requires your own key.

## Credentials and publishing

`.env.local` is git-ignored. Keys stay in the Node.js process and are never sent to the local UI. The server binds only to loopback, validates Host/Origin, rejects arbitrary proxy methods, and allows only read RPC calls. Do not publish `.env.local`, evidence containing keys, or an authenticated upstream URL. This project has no transaction signing or sending code.

## Recorded demo

1. Mainnet verification, advancing slots and stream messages.
2. Public wallet timeline, actual confirmed fees and native balance changes.
3. Failed-transaction and HTTP catch-up filters.
4. Manual reconnect; reconnect count, HTTP reconciliation and connection journal.
5. Coverage limits and setup requirements in English captions.

`demo.mp4` was captured from the actual local dashboard using timestamped browser screencast frames on 2026-10-10, with original elapsed timing and explanatory captions. No sample transactions were injected. The stream was manually reconnected; this is a reconnection demonstration, not a simulated extended network outage. Offline tests and UI placeholders are not a live demonstration.

## Sources

- [Solami task](https://superteam.fun/earn/listing/build-something-live-on-solana-data)
- [Solami RPC](https://solami.dev/docs/rpc) · [WebSocket](https://solami.dev/docs/websocket) · [API keys](https://solami.dev/docs/api-keys)
- [Solana signatures](https://solana.com/docs/rpc/http/getsignaturesforaddress) · [transaction metadata](https://solana.com/docs/rpc/http/gettransaction)
- [Solana mainnet genesis fingerprint](https://solana.com/docs/payments/agentic-payments/x402)

AI-assisted implementation for one human operator. MIT license.
