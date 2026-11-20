'use strict';
// snes2nw self-test: runs the whole preparation on the bundled test ROM
// (an original program, see the nwsnes repository) and checks the results.
// It cannot check the calculator itself, nor the USB installation.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { Core, PAGE } = require('../lib/core');
const png = require('../lib/png');

const rom = fs.readFileSync(path.join(__dirname, 'nwsnes-test.sfc'));
let failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok    ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e.message || e)); }
}
const hash = (shot) => require('crypto').createHash('sha1').update(shot.rgb).digest('hex');

const core = new Core();
let pack, loaded;

test('ROM header is read', () => {
  const info = core.loadRom(rom);
  assert.strictEqual(info.title, 'NWSNES TEST ROM');
  assert.strictEqual(info.mapping, 'LoROM');
  assert.strictEqual(info.romSize, 32768);
  assert.strictEqual(info.ramSize, 2048);
  assert.strictEqual(info.coprocessor, null);
  assert.strictEqual(info.checksumOk, true);
});

test('a file that is not a ROM is refused', () => {
  assert.strictEqual(new Core().loadRom(Buffer.alloc(70000, 0x55)), null);
});

let reference;
test('profiling builds a pack with a dictionary', () => {
  core.profileReset();
  core.session(null);
  assert.strictEqual(core.run(900, 5, 0, { sample: true }), 900);
  reference = hash(core.screenshot());
  pack = core.buildPack(2300 * 1024);
  assert.ok(pack.dictPages > 20, 'dictionary too small: ' + pack.dictPages);
  assert.ok(pack.bytes.length < 80 * 1024);
  assert.strictEqual(pack.bytes.subarray(0, 8).toString('latin1'), 'NWSNESPK');
  loaded = core.loadPack(pack.bytes);
});

test('with the pack, 4 KB of RAM replays the same game', () => {
  core.session(loaded, 4 * 1024 / PAGE);
  assert.strictEqual(core.run(900, 5, 0), 900, 'ran out of RAM');
  assert.strictEqual(hash(core.screenshot()), reference, 'last frame differs');
  assert.strictEqual(core.stats().oom, false);
});

test('without the pack, 4 KB of RAM is not enough', () => {
  core.session(null, 4 * 1024 / PAGE);
  assert.ok(core.run(900, 5, 0) < 900);
});

test('the measured need is small and consistent', () => {
  const pages = core.minPool(loaded, 900, 5);
  assert.ok(pages > 0 && pages * PAGE < 4 * 1024, 'needs ' + pages + ' pages');
});

test('a recorded play session replaces the button masher', () => {
  const movie = new Uint16Array(300).fill(0x0180); // right + A held
  core.setMovie(movie);
  core.session(null);
  assert.strictEqual(core.run(300, 0, 0), 300);
  const withMovie = hash(core.screenshot());
  core.setMovie(null);
  core.session(null);
  core.run(300, 0, 0);
  assert.notStrictEqual(hash(core.screenshot()), withMovie);
});

test('screenshots encode to PNG', () => {
  const file = png.encode(core.screenshot(), 2);
  assert.strictEqual(file.subarray(1, 4).toString('latin1'), 'PNG');
  assert.ok(file.length > 500);
});

test('command line: full run without installing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snes2nw-'));
  const copy = path.join(dir, 'essai.sfc');
  fs.writeFileSync(copy, rom);
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'snes2nw.js'), copy, '--no-install', '--auto', '600', '--seeds', '2'],
    { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(/Verdict : ça tient/.test(r.stdout), r.stdout);
  assert.ok(fs.existsSync(path.join(dir, 'essai.pack')));
  assert.ok(fs.existsSync(path.join(dir, 'essai-apercu.png')));
  fs.rmSync(dir, { recursive: true });
});

test('command line: an unsupported cartridge is refused with an explanation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snes2nw-'));
  const chip = Buffer.from(rom);
  chip[0x7fd6] = 0x15; // header says: ROM + RAM + battery + Super FX
  const copy = path.join(dir, 'puce.sfc');
  fs.writeFileSync(copy, chip);
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'snes2nw.js'), copy, '--no-install'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1);
  assert.ok(/puce supplémentaire/.test(r.stdout), r.stdout);
  assert.ok(!fs.existsSync(path.join(dir, 'puce.pack')));
  fs.rmSync(dir, { recursive: true });
});

console.log(failed ? failed + ' test(s) failed' : 'all tests passed');
process.exit(failed ? 1 : 0);
