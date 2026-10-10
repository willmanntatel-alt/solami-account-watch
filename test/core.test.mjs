import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validAddress, lamportsText, Ledger, backfill, summarizeTransaction, safeError } from '../lib/core.mjs';
import { Rpc } from '../lib/rpc.mjs';
import { Monitor } from '../lib/monitor.mjs';
const account='11111111111111111111111111111111';
test('address validation checks decoded byte length, not just alphabet',()=>{
  assert.ok(validAddress(account));assert.ok(validAddress('So11111111111111111111111111111111111111112'));
  assert.equal(validAddress('1'.repeat(44)),false);assert.equal(validAddress('0'.repeat(32)),false);
});
test('native balance text is exact down to a lamport',()=>{assert.equal(lamportsText(-1n),'-0.000000001');assert.equal(lamportsText(9007199254740993n),'9007199.254740993');});
test('duplicate stream and recovery observations merge; old out-of-order frames do not lower slot',()=>{
  const ledger=new Ledger(2);ledger.add('a',20,account,'WebSocket');ledger.add('a',19,'other','HTTP catch-up');
  assert.equal(ledger.list().length,1);assert.equal(ledger.list()[0].slot,20);assert.equal(ledger.list()[0].addresses.length,2);
  ledger.add('b',30,account,'HTTP');ledger.add('c',40,account,'HTTP');assert.deepEqual(ledger.list().map(r=>r.signature),['c','b']);
});
test('catch-up paginates until previous checkpoint, excluding the checkpoint',async()=>{
  const calls=[];const pages=[[{signature:'n3'},{signature:'n2'}],[{signature:'n1'},{signature:'old'}]];
  const result=await backfill(async options=>{calls.push(options);return pages.shift();},'old',4,2);
  assert.deepEqual(result.rows.map(r=>r.signature),['n3','n2','n1']);assert.equal(result.complete,true);assert.equal(calls[1].before,'n2');
});
test('a full bounded window reports possible gap instead of complete recovery',async()=>{
  let page=0;const result=await backfill(async()=>[{signature:`s${++page}`}],'old',2,1);assert.equal(result.complete,false);assert.equal(result.rows.length,2);
});
test('initial history does not claim complete historical coverage',async()=>{const result=await backfill(async()=>[{signature:'a'}],null);assert.equal(result.complete,null);});
test('a missing checkpoint in a short provider history reports a possible gap',async()=>{const result=await backfill(async()=>[{signature:'new'}],'pruned');assert.equal(result.complete,false);});
test('changing watchlist removes old transactions and resets recovery checkpoint',()=>{
  const monitor=new Monitor({key:'',rpc:'https://rpc.solami.dev/sol',ws:'wss://ws.solami.dev/ws/sol',accounts:[account]});
  monitor.ledger.add('old',20,account,'WebSocket');monitor.accounts.get(account).checkpoint='old';
  monitor.setAccounts(['So11111111111111111111111111111111111111112']);
  assert.equal(monitor.ledger.list().length,0);assert.equal(monitor.snapshot().accounts[0].checkpoint,null);
});
test('transaction summary includes failure and native delta but omits unsafe rounded RPC integers',()=>{
  const tx={meta:{err:{InstructionError:[0,'Custom']},fee:5000,preBalances:[1000000000],postBalances:[999995000]},transaction:{message:{accountKeys:[{pubkey:account,signer:true}],instructions:[{programId:account}]}}};
  const detail=summarizeTransaction(tx,[account]);assert.equal(detail.failed,true);assert.equal(detail.changes[0].nativeChange,'-0.000005000');
  tx.meta.preBalances[0]=Number.MAX_SAFE_INTEGER+1;assert.equal(summarizeTransaction(tx,[account]).changes[0].nativeChange,null);
});
test('secrets are redacted from provider failures',()=>{assert.equal(safeError(new Error('https://x?api_key=secret abc secret'),'secret').includes('secret'),false);});
test('RPC queue rejects write methods and recovers after an HTTP failure',async()=>{
  let calls=0;const rpc=new Rpc({key:'secret',endpoint:'https://rpc.solami.dev/sol',interval:0,fetchImpl:async()=>++calls===1?{ok:false,status:429}:{ok:true,json:async()=>({result:55})}});
  await assert.rejects(rpc.call('sendTransaction'),/Only read/);await assert.rejects(rpc.call('getSlot'),/429/);assert.equal(await rpc.call('getSlot'),55);assert.equal(rpc.summary().failures,1);
});
