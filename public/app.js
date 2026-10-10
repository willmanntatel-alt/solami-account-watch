const $ = id => document.getElementById(id);
const short = address => address ? `${address.slice(0,6)}…${address.slice(-6)}` : '—';
const ago = time => time ? `${Math.max(0,Math.floor((Date.now()-time)/1000))}s ago` : 'waiting';
const el = (tag,text,cls) => { const node=document.createElement(tag); if(text!==undefined) node.textContent=text; if(cls) node.className=cls; return node; };
let snapshot; let initialized=false;
function render(data) {
  snapshot=data;
  $('network').textContent=data.network.verified?'MAINNET VERIFIED':'MAINNET NOT VERIFIED';
  $('slot').textContent=data.network.processed?.toLocaleString()??'—';
  $('finalized').textContent=`Finalized: ${data.network.finalized?.toLocaleString()??'—'}`;
  $('messages').textContent=data.stream.messages.toLocaleString();
  $('reconnects').textContent=`Reconnects: ${data.stream.reconnects}`;
  $('tracked').textContent=data.tracked.toLocaleString();
  $('failed').textContent=`${data.failed} failed · bounded recent window`;
  $('latency').textContent=data.rpc.p95===null?'—':`${data.rpc.p95} ms`;
  $('requests').textContent=`${data.rpc.requests} calls · ${data.rpc.failures} errors · ${data.rpc.samples} samples`;
  $('stream-state').textContent=data.stream.state==='connected'?'Stream connected':`Stream ${data.stream.state}`;
  $('stream-age').textContent=`Last frame: ${ago(data.stream.lastMessage)}`;
  $('dot').className=data.stream.state==='connected'?'dot live':'dot';
  $('reconcile').textContent=`Confirmed HTTP reconciliation: ${ago(data.lastReconcile)}${data.busy?' · updating':''}`;
  $('clock').textContent=`Observed ${new Date(data.serverTime).toISOString()} UTC`;
  if(!initialized){$('addresses').value=data.accounts.map(a=>a.address).join(', ');initialized=true;}
  $('accounts').replaceChildren(...data.accounts.map(account=>{
    const card=el('article',undefined,'account'); const head=el('div',undefined,'account-head');
    const link=el('a',short(account.address),'account-name');link.href=`https://explorer.solana.com/address/${encodeURIComponent(account.address)}`;link.target='_blank';link.rel='noopener';link.title=account.address;
    head.append(link,el('span',account.executable?'Program':account.dataType??'Loading','account-kind'));
    card.append(head,el('div',account.balance===null?'—':`${account.balance} SOL`,'balance'),el('p',`Owner: ${short(account.owner)}`,'account-detail'),el('p',`Confirmed account slot: ${account.slot??'—'}`,'account-detail'));
    if(account.parsed?.supply)card.append(el('p',`Mint supply (raw): ${account.parsed.supply} · decimals ${account.parsed.decimals}`,'account-detail'));
    const incomplete=account.coverage.startsWith('Gap');card.append(el('p',account.coverage,`coverage${incomplete?' warning':''}`));
    if(account.error)card.append(el('p',account.error,'coverage warning'));
    return card;
  }));
  renderTransactions();
  $('notices').replaceChildren(...data.notices.slice(0,7).map(notice=>{const n=el('div',undefined,`notice ${notice.kind}`);n.append(el('time',new Date(notice.time).toLocaleTimeString()),el('span',notice.message));return n;}));
}
function renderTransactions(){
  if(!snapshot)return;
  const filter=$('filter').value;
  const rows=snapshot.transactions.filter(row=>filter==='all'||(filter==='failed'&&(row.detail?.failed??row.failed))||(filter==='recovered'&&row.sources.includes('HTTP catch-up'))).slice(0,18);
  if(!rows.length){$('transactions').replaceChildren(el('p','No observed transactions in this window. Choose an active account, or wait for the next update.','empty'));return;}
  $('transactions').replaceChildren(...rows.map(row=>{
    const card=el('article',undefined,'transaction');const head=el('div',undefined,'tx-head');
    const link=el('a',short(row.signature),'tx-link');link.href=`https://explorer.solana.com/tx/${encodeURIComponent(row.signature)}`;link.target='_blank';link.rel='noopener';link.title=row.signature;
    head.append(link,el('span',(row.detail?.failed??row.failed)?'FAILED':'OBSERVED',`pill ${(row.detail?.failed??row.failed)?'failed':''}`));
    const meta=el('div',undefined,'tx-meta');meta.append(el('span',`Slot ${row.slot.toLocaleString()}`),el('span',row.sources.join(' + ')),el('span',row.blockTime?new Date(row.blockTime*1000).toLocaleTimeString():`Seen ${ago(row.firstSeen)}`));
    const details=el('div',undefined,'tx-details');
    if(row.detail){
      details.append(el('span',`Fee ${row.detail.fee??'unknown'} SOL`),el('span',`${row.detail.signerCount} signer(s)`));
      for(const change of row.detail.changes)details.append(el('span',`${short(change.address)} Δ ${change.nativeChange??'precision unavailable'} SOL`,`delta${change.nativeChange?.startsWith('-')?' negative':''}`));
    }else details.append(el('span',row.attempts>=3?'Details unavailable after 3 attempts':row.detailError??'Transaction details queued'));
    card.append(head,meta,details);return card;
  }));
}
$('filter').addEventListener('change',renderTransactions);
$('watch-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.submitter;button.disabled=true;
  try{const res=await fetch('/api/watch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({addresses:$('addresses').value.split(',').map(a=>a.trim()).filter(Boolean)})});const result=await res.json();if(!res.ok)throw new Error(result.error);$('form-status').textContent='Watchlist updated. Checking confirmed account state and reconnecting subscriptions.';await refresh();}catch(error){$('form-status').textContent=error.message;}finally{button.disabled=false;}
});
$('reconnect').addEventListener('click',async()=>{try{const res=await fetch('/api/reconnect',{method:'POST'});if(!res.ok)throw new Error('Reconnect request failed');await refresh();}catch(error){$('form-status').textContent=error.message;}});
async function refresh(){try{const response=await fetch('/api/snapshot',{cache:'no-store'});if(!response.ok)throw new Error('Local monitor unavailable');render(await response.json());}catch(error){$('stream-state').textContent='Local monitor unavailable';$('dot').className='dot';$('stream-age').textContent='Displayed data may be stale. Restart the local service.';}}
refresh();setInterval(refresh,2500);
