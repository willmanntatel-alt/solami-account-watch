import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Monitor } from './lib/monitor.mjs';

const port = Number(process.env.PORT ?? 5017);
const config = { key:process.env.SOLAMI_API_KEY ?? '',rpc:process.env.SOLAMI_RPC_URL ?? 'https://rpc.solami.dev/sol',
  ws:process.env.SOLAMI_WS_URL ?? 'wss://ws.solami.dev/ws/sol',accounts:(process.env.WATCH_ACCOUNTS ?? '6iBpYUVgjt4ZwJjkbHAJErTxgBMoCKmwjRBKH8XA5TJ9').split(',').map(a=>a.trim()).filter(Boolean) };
for (const [value,protocol] of [[config.rpc,'https:'],[config.ws,'wss:']]) {
  const url = new URL(value);
  if (url.protocol !== protocol || !(url.hostname === 'solami.dev' || url.hostname.endsWith('.solami.dev'))) throw new Error('Only official Solami endpoints are accepted');
}
const monitor = new Monitor(config);
const files = {'/':['public/index.html','text/html; charset=utf-8'],'/app.js':['public/app.js','text/javascript; charset=utf-8'],'/style.css':['public/style.css','text/css; charset=utf-8']};
const json = (res,status,data) => { res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'}); res.end(JSON.stringify(data)); };
const server = http.createServer(async (req,res) => {
  try {
    const expected = `127.0.0.1:${port}`;
    if (req.headers.host !== expected && req.headers.host !== `localhost:${port}`) return json(res,403,{error:'Invalid host'});
    if (req.headers.origin && ![`http://${expected}`,`http://localhost:${port}`].includes(req.headers.origin)) return json(res,403,{error:'Invalid origin'});
    res.setHeader('x-content-type-options','nosniff');
    res.setHeader('content-security-policy',"default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    const path = new URL(req.url,`http://${expected}`).pathname;
    if (req.method === 'GET' && path === '/api/snapshot') return json(res,200,monitor.snapshot());
    if (req.method === 'POST' && path === '/api/watch') {
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res,415,{error:'JSON required'});
      let body=''; for await (const chunk of req) { body+=chunk; if (body.length>2000) return json(res,413,{error:'Request too large'}); }
      const data=JSON.parse(body); if (!Array.isArray(data.addresses)) return json(res,400,{error:'Addresses required'});
      monitor.setAccounts(data.addresses); return json(res,200,{ok:true});
    }
    if (req.method === 'POST' && path === '/api/reconnect') { monitor.reconnect(); return json(res,200,{ok:true}); }
    if (req.method === 'GET' && files[path]) {
      const [name,type]=files[path]; const data=await readFile(fileURLToPath(new URL(name,import.meta.url)));
      res.writeHead(200,{'content-type':type,'cache-control':'no-store'}); return res.end(data);
    }
    json(res,404,{error:'Not found'});
  } catch (error) { json(res,400,{error:error.message?.includes('Use 1–3') ? error.message : 'Request could not be processed'}); }
});
server.listen(port,'127.0.0.1',() => { console.log(`Solami Account Watch: http://127.0.0.1:${port}`); monitor.start(); });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => { monitor.stop(); server.close(()=>process.exit(0)); });
