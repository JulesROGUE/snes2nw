'use strict';
// "Play it on the PC first": a page served on localhost runs the game in the
// browser (same emulator core, as WebAssembly), records which buttons are
// held on every frame, and sends that recording back when the player is
// done. The recording is then replayed here to build the dictionary.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const WEB = path.join(__dirname, '..', 'web');
const WASM = path.join(__dirname, '..', 'core', 'nwsnes.wasm');

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    const child = spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch (e) { /* the address is printed anyway */ }
}

// Resolves with a Uint16Array (one button state per frame), or null if the
// player cancelled. options.open: false to not launch a browser.
function play(romBytes, title, options = {}) {
  const token = crypto.randomBytes(12).toString('hex');
  return new Promise((resolve, reject) => {
    const files = {
      '/': ['index.html', 'text/html; charset=utf-8'],
      '/trainer.js': ['trainer.js', 'text/javascript; charset=utf-8'],
    };
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      // every request must carry the token printed in the address
      if (url.searchParams.get('t') !== token) { res.writeHead(403); res.end(); return; }
      if (req.method === 'GET' && files[url.pathname]) {
        res.writeHead(200, { 'Content-Type': files[url.pathname][1], 'Cache-Control': 'no-store' });
        let body = fs.readFileSync(path.join(WEB, files[url.pathname][0]), 'utf8');
        // the page loads its script with the same token
        if (url.pathname === '/') body = body.replace('src="trainer.js"', `src="trainer.js?t=${token}"`);
        res.end(body);
      } else if (req.method === 'GET' && url.pathname === '/nwsnes.wasm') {
        res.writeHead(200, { 'Content-Type': 'application/wasm', 'Cache-Control': 'no-store' });
        res.end(fs.readFileSync(WASM));
      } else if (req.method === 'GET' && url.pathname === '/rom') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'X-Title': encodeURIComponent(title) });
        res.end(Buffer.from(romBytes));
      } else if (req.method === 'POST' && (url.pathname === '/done' || url.pathname === '/cancel')) {
        const parts = [];
        let size = 0;
        req.on('data', (d) => { size += d.length; if (size < 64 * 1024 * 1024) parts.push(d); });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('ok');
          server.close();
          if (url.pathname === '/cancel') { resolve(null); return; }
          const buf = Buffer.concat(parts);
          const movie = new Uint16Array(buf.length >> 1);
          for (let i = 0; i < movie.length; i++) movie[i] = buf.readUInt16LE(i * 2);
          resolve(movie);
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.on('error', reject);
    server.listen(options.port || 0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}/?t=${token}`;
      if (options.onReady) options.onReady(url);
      if (options.open !== false) openBrowser(url);
    });
  });
}

module.exports = { play };
