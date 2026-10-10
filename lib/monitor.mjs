import { MAINNET_GENESIS, Ledger, backfill, summarizeTransaction, safeError, lamportsText, validAddress } from './core.mjs';
import { Rpc } from './rpc.mjs';

export class Monitor {
  constructor(config) {
    this.config = config;
    this.rpc = new Rpc({ key: config.key, endpoint: config.rpc });
    this.ledger = new Ledger(); this.accounts = new Map(); this.notices = [];
    this.network = { verified:false, genesis:null, version:null, processed:null, finalized:null };
    this.stream = { state:'offline', connectedAt:null, lastMessage:null, slot:null, reconnects:0, messages:0 };
    this.running = false; this.busy = false; this.generation = 0; this.subs = new Map(); this.pending = new Map(); this.id = 0;
    this.setAccounts(config.accounts);
  }
  note(message, kind = 'info') { this.notices.unshift({ time:Date.now(),message,kind }); this.notices = this.notices.slice(0,40); }
  setAccounts(addresses) {
    const clean = [...new Set(addresses)];
    if (clean.length < 1 || clean.length > 3 || !clean.every(validAddress)) throw new Error('Use 1–3 valid 32-byte Solana addresses');
    this.ledger = new Ledger();
    this.accounts = new Map(clean.map(address => [address,this.accounts.get(address) ?? { address, checkpoint:null, balance:null, owner:null, executable:null, dataType:null, parsed:null, updatedAt:null, coverage:'Recent history only', error:null }]));
    for (const account of this.accounts.values()) { account.checkpoint = null; account.coverage = 'Recent history only'; }
    this.generation++;
    if (this.running) { this.note('Watchlist changed; timeline reset to this watchlist.'); this.reconnect(); this.poll(); }
  }
  async start() {
    this.running = true;
    if (!this.config.key || this.config.key === 'your_rpc_or_api_key') { this.note('Set SOLAMI_API_KEY in .env.local and restart. No sample data is shown.','error'); return; }
    try {
      this.network.genesis = await this.rpc.call('getGenesisHash');
      if (this.network.genesis !== MAINNET_GENESIS) throw new Error('Endpoint is not Solana mainnet; monitoring stopped');
      this.network.verified = true;
      this.network.version = (await this.rpc.call('getVersion'))['solana-core'];
      this.note('Solana mainnet fingerprint verified through Solami RPC.');
      this.connect(); await this.poll();
      this.timer = setInterval(() => this.poll(),15000);
      this.watchdog = setInterval(() => {
        if (this.stream.state === 'connected' && Date.now() - (this.stream.lastMessage ?? this.stream.connectedAt) > 45000) {
          this.note('Stream silent for 45s; reconnect and HTTP catch-up requested.','warning'); this.reconnect();
        }
      },10000);
    } catch (error) { this.note(safeError(error,this.config.key),'error'); }
  }
  connect() {
    if (!this.running || !this.network.verified) return;
    const url = new URL(this.config.ws); url.searchParams.set('api_key',this.config.key);
    this.stream.state = 'connecting'; this.pending.clear(); this.subs.clear();
    const ws = this.ws = new WebSocket(url);
    const send = (method,params,kind,address) => { const id = ++this.id; this.pending.set(id,{kind,address}); ws.send(JSON.stringify({jsonrpc:'2.0',id,method,params})); };
    ws.addEventListener('open',() => {
      if (this.ws !== ws) return;
      this.stream.state = 'connected'; this.stream.connectedAt = Date.now(); this.stream.lastMessage = null;
      this.retry = 0;
      send('slotSubscribe',[],'slot');
      for (const address of this.accounts.keys()) {
        send('logsSubscribe',[{mentions:[address]},{commitment:'confirmed'}],'logs',address);
        send('accountSubscribe',[address,{encoding:'jsonParsed',commitment:'confirmed'}],'account',address);
      }
      this.note('Stream connected. Reconciling confirmed signatures against the saved checkpoints.'); this.poll();
    });
    ws.addEventListener('message',event => {
      if (this.ws !== ws) return;
      this.stream.lastMessage = Date.now(); this.stream.messages++;
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.id) {
          const request = this.pending.get(msg.id); this.pending.delete(msg.id);
          if (msg.error) this.note(`Subscription rejected (${msg.error.code}). HTTP reconciliation remains active.`,'warning');
          else if (request) this.subs.set(msg.result,request);
          return;
        }
        const sub = this.subs.get(msg.params?.subscription); const result = msg.params?.result;
        if (!sub || !result) return;
        if (sub.kind === 'slot') this.stream.slot = result.slot;
        if (sub.kind === 'logs' && this.accounts.has(sub.address)) {
          const row = this.ledger.add(result.value.signature,result.context.slot,sub.address,'WebSocket');
          row.failed = Boolean(result.value.err);
        }
        if (sub.kind === 'account') this.updateAccount(sub.address,result.value,result.context.slot);
      } catch { this.note('Malformed stream frame skipped.','warning'); }
    });
    ws.addEventListener('error',() => { if (this.ws === ws) this.stream.state = 'error'; });
    ws.addEventListener('close',() => {
      if (this.ws !== ws || !this.running) return;
      this.stream.state = 'disconnected'; this.stream.reconnects++;
      const delay = Math.min(20000,1000 * 2 ** (this.retry = Math.min(5,(this.retry ?? 0)+1)));
      this.note(`Stream disconnected; retry in ${delay/1000}s. Confirmed HTTP catch-up remains active.`,'warning');
      clearTimeout(this.reconnectTimer); this.reconnectTimer = setTimeout(() => this.connect(),delay);
    });
  }
  reconnect() {
    clearTimeout(this.reconnectTimer); const old = this.ws; this.ws = null; old?.close();
    this.stream.reconnects++; this.stream.state = 'reconnecting'; this.connect();
  }
  updateAccount(address,value,slot) {
    const account = this.accounts.get(address); if (!account) return;
    if (account.slot && slot < account.slot) return;
    const balance = Number.isSafeInteger(value?.lamports) ? lamportsText(value.lamports) : null;
    if (account.balance !== null && balance !== account.balance) this.note(`${address.slice(0,7)}… native balance changed: ${account.balance} → ${balance ?? 'precision unavailable'} SOL`);
    Object.assign(account,{balance,owner:value?.owner ?? null,executable:value?.executable ?? null,
      dataType:value?.data?.parsed?.type ?? (value ? 'Account' : 'Not found'),parsed:value?.data?.parsed?.info ?? null,slot,updatedAt:Date.now(),error:null});
  }
  async poll() {
    if (this.busy || !this.network.verified || !this.running) return;
    this.busy = true; const generation = this.generation;
    try {
      this.network.processed = await this.rpc.call('getSlot',[{commitment:'processed'}]);
      this.network.finalized = await this.rpc.call('getSlot',[{commitment:'finalized'}]);
      for (const [address,account] of this.accounts) {
        if (generation !== this.generation) break;
        try {
          const value = await this.rpc.call('getAccountInfo',[address,{encoding:'jsonParsed',commitment:'confirmed'}]);
          if (generation !== this.generation) break;
          this.updateAccount(address,value.value,value.context.slot);
          const checkpoint = account.checkpoint;
          const result = await backfill(options => this.rpc.call('getSignaturesForAddress',[address,{...options,commitment:'confirmed'}]),checkpoint);
          if (generation !== this.generation) break;
          for (const row of result.rows) { const entry = this.ledger.add(row.signature,row.slot,address,checkpoint ? 'HTTP catch-up' : 'HTTP recent',row.blockTime); entry.failed = Boolean(row.err); }
          account.checkpoint = result.newest;
          account.coverage = !checkpoint ? 'Initial: latest 50 signatures' : result.complete ? 'Caught up to previous checkpoint' : 'Gap possible: checkpoint absent within provider history / 200-signature budget';
          if (checkpoint && !result.complete) this.note(`Catch-up for ${address.slice(0,7)}… did not find its previous checkpoint. Coverage is incomplete.`,'warning');
        } catch (error) { account.error = safeError(error,this.config.key); }
      }
      const pending = this.ledger.list().filter(row => !row.detail && row.attempts < 3).slice(0,8);
      for (const row of pending) {
        if (generation !== this.generation) break;
        row.attempts++;
        try {
          const tx = await this.rpc.call('getTransaction',[row.signature,{encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:0}]);
          if (tx && generation === this.generation) row.detail = summarizeTransaction(tx,[...this.accounts.keys()]);
        } catch (error) { row.detailError = safeError(error,this.config.key); }
      }
      this.lastReconcile = Date.now();
    } catch (error) { this.note(safeError(error,this.config.key),'error'); }
    finally { this.busy = false; if (generation !== this.generation) queueMicrotask(() => this.poll()); }
  }
  snapshot() {
    const rows = this.ledger.list();
    return { name:'Solami Account Watch',provider:'Solami',mode:'read-only',network:this.network,stream:this.stream,
      rpc:this.rpc.summary(),accounts:[...this.accounts.values()],transactions:rows.slice(0,70),notices:this.notices,
      tracked:rows.length,failed:rows.filter(row => row.detail?.failed ?? row.failed).length,
      lastReconcile:this.lastReconcile ?? null,busy:this.busy,serverTime:Date.now() };
  }
  stop() { this.running = false; clearInterval(this.timer); clearInterval(this.watchdog); clearTimeout(this.reconnectTimer); this.ws?.close(); }
}
