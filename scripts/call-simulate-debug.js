const http = require('http');
const data = JSON.stringify({ phoneE164: '+254700000001', buttonId: 'SUPL_SUBMIT_DELIVERY' });
const opts = { hostname: '127.0.0.1', port: 3002, path: '/api/wa/simulate', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } };
const req = http.request(opts, (res)=>{ console.log('status', res.statusCode); let body=''; res.on('data', c=>body+=c.toString()); res.on('end', ()=>console.log('body', body)); });
req.on('error', e=>{ console.error('err', e); process.exit(1); });
req.write(data); req.end();
