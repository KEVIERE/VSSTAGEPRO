// Serve um arquivo só, para a página de fotos ler o show (somente leitura, só nesta máquina).
import http from 'node:http';
import fs from 'node:fs';

const [file, port = '5199'] = process.argv.slice(2);
http
  .createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.end();
    const st = fs.statSync(file);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  })
  .listen(Number(port), '127.0.0.1', () => console.log(`servindo em http://127.0.0.1:${port}/show.vss`));
