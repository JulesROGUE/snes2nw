'use strict';
// Tests of the installation in two parts (lib/flash2.js), against a stand-in
// for the calculator (fake-calculator.js): the real nwlink, its real linker,
// the real USB conversation, and a flash image in place of the hardware.
// What only a real calculator can tell is whether its kernel accepts the
// write to the other half of the flash: the three possible answers are
// played here, and each must end cleanly.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { Core } = require('../lib/core');
const flash2 = require('../lib/flash2');
const { FakeCalculator, FLASH, HALF, SECTOR, APPS_START, APPS_END } = require('./fake-calculator');

const ROOT = path.join(__dirname, '..');
const rom = fs.readFileSync(path.join(__dirname, 'nwsnes-test.sfc'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'snes2nw-flash2-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
let failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok    ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e.message || e)); }
}

const core = new Core();
// the 32 KB test ROM with room for 24 KB in the app area: it needs a second part
core.loadRom(rom);
core.profileReset();
core.session(null);
core.run(600, 5, 0, { sample: true });
const pack = core.buildPack(24 * 1024, 255, 255, 16 * 1024);
const packFile = path.join(tmp, 'two.pack');
fs.writeFileSync(packFile, pack.bytes);
const parts = flash2.splitPack(pack.bytes, core);

const info = (start, end) => {
  const b = Buffer.alloc(48);
  b.writeUInt32LE(0xdec0edfe, 0);
  b.writeUInt32LE(start, 20);
  b.writeUInt32LE(end, 24);
  b.writeUInt32LE(0xdec0edfe, 44);
  return b;
};
const A = { start: FLASH + APPS_START, end: FLASH + APPS_END };
const B = { start: FLASH + HALF + APPS_START, end: FLASH + HALF + APPS_END };
const official = [{ address: 0x90030000, nbPage: 61, pageSize: SECTOR, type: 'g' }, { address: 0x90400000, nbPage: 64, pageSize: SECTOR, type: 'g' }];

test('the test pack is in two parts, and complete', () => {
  assert.ok(pack.extBytes > 0 && pack.mainBytes + pack.extBytes === pack.bytes.length);
  assert.strictEqual(pack.romBlocksPacked, pack.romBlocks);
  assert.strictEqual(parts.main.length, pack.mainBytes);
  assert.strictEqual(parts.ext.length, pack.extBytes);
  assert.strictEqual(parts.ext.subarray(0, 8).toString('latin1'), 'NWSNESX1');
});

test('a pack in one part has no second part', () => {
  const one = core.buildPack(2500 * 1024, 255, 255, 2560 * 1024);
  assert.strictEqual(one.extBytes, 0);
  assert.strictEqual(flash2.splitPack(one.bytes, core).ext, null);
});

test('a second part that is missing or damaged is refused', () => {
  assert.throws(() => flash2.splitPack(pack.bytes.subarray(0, pack.mainBytes), core), /seconde manque/);
  const bad = Buffer.from(pack.bytes);
  bad[pack.mainBytes + 100] ^= 0x40;
  assert.throws(() => flash2.splitPack(bad, core), /abîmée/);
});

test('the second part goes at the end of the other half\'s app area', () => {
  const full = 32 + 639 * 4096; // what a 4 MB game puts there
  // as on the N0110 that was measured: system in half A, 2560 KB of app area in each half
  assert.strictEqual(flash2.plan(core, full, A, info(A.start, A.end), info(B.start, B.end), official).address, 0x90570000);
  assert.strictEqual(flash2.plan(core, parts.ext.length, A, info(A.start, A.end), info(B.start, B.end), official).address, 0x907e0000);
  // the other half says its app area starts elsewhere: its own word counts, and the end is what matters
  assert.strictEqual(flash2.plan(core, parts.ext.length, A, info(A.start, A.end), info(B.start - 0x40000, B.end), official).address, 0x907e0000);
  // no system in the other half: same place there as here
  assert.strictEqual(flash2.plan(core, full, A, info(A.start, A.end), Buffer.alloc(48, 0xff), official).address, 0x90570000);
});

test('nothing is planned outside what is safe', () => {
  const full = 32 + 639 * 4096;
  // too big for the area
  assert.throws(() => flash2.plan(core, full + SECTOR, A, info(A.start, A.end), info(B.start, B.end), official), /pas assez de place/);
  // an app area said to reach the very end of the half: the last sector stays out of it
  const p = flash2.plan(core, parts.ext.length, A, info(A.start, A.end), info(B.start, FLASH + 2 * HALF), official);
  assert.strictEqual(p.address + p.length, FLASH + 2 * HALF - SECTOR);
  // the calculator does not declare the other half writable
  assert.throws(() => flash2.plan(core, full, A, info(A.start, A.end), info(B.start, B.end), [official[0]]), /ne propose pas/);
  assert.throws(() => flash2.plan(core, full, A, info(A.start, A.end), info(B.start, B.end),
    [official[0], { ...official[1], type: 'a' }]), /ne propose pas/);
  // the running half does not describe itself as announced
  assert.throws(() => flash2.plan(core, full, A, info(A.start + SECTOR, A.end), info(B.start, B.end), official), /ne correspond pas/);
  // not a calculator with two halves
  assert.throws(() => flash2.plan(core, full, { start: 0x08000000, end: 0x08100000 }, info(A.start, A.end), info(B.start, B.end), official), /deux moitiés/);
});

// ---- whole installations, as the command line does them

const hasNwlink = !!flash2.nwlinkDir();
function install(setup) {
  const report = path.join(tmp, 'report-' + Math.random().toString(36).slice(2) + '.json');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'snes2nw.js'), 'install', packFile, '--yes'], {
    encoding: 'utf8',
    env: { ...process.env, SNES2NW_TEST_USB: path.join(__dirname, 'fake-calculator.js'), SNES2NW_TEST_CALC: JSON.stringify({ ...setup, report }) },
  });
  const rep = JSON.parse(fs.readFileSync(report, 'utf8'));
  return { status: r.status, out: r.stdout + r.stderr, log: rep.log, changes: rep.changes, state: rep.state, flash: fs.readFileSync(report + '.flash') };
}
// every change must be inside one of the two app areas
function onlyAppAreas(changes) {
  for (const [address, length] of changes) {
    const inA = address >= A.start && address + length <= A.end;
    const inB = address >= B.start && address + length <= B.end;
    assert.ok(inA || inB, 'changed outside the app areas: 0x' + address.toString(16) + ' +' + length);
  }
}
const at = (flash, address, length) => flash.subarray(address - FLASH, address - FLASH + length);

function installTest(name, fn) {
  if (hasNwlink) test(name, fn);
  else console.log('skip  ' + name + ' (nwlink is not installed: npm install)');
}

installTest('installation: system in half A, the calculator accepts', () => {
  const r = install({ running: 'A' });
  assert.strictEqual(r.status, 0, r.out);
  const address = 0x907e0000;
  assert.ok(at(r.flash, address, parts.ext.length).equals(parts.ext), 'second part not where the app will look for it');
  assert.ok(r.flash.indexOf(parts.main, A.start - FLASH) > 0 && r.flash.indexOf(parts.main, A.start - FLASH) < A.end - FLASH, 'first part not in the app area');
  assert.strictEqual(at(r.flash, A.start, 4).toString('hex'), 'babec0de', 'no app at the start of the app area');
  onlyAppAreas(r.changes);
  assert.deepStrictEqual(r.log.erased.filter((a) => a >= FLASH + HALF), [address]);
  assert.strictEqual(r.log.left, A.start);
  assert.match(r.out, /écrite et relue : identique/);
});

installTest('installation: system in half B', () => {
  const r = install({ running: 'B' });
  assert.strictEqual(r.status, 0, r.out);
  assert.ok(at(r.flash, 0x903e0000, parts.ext.length).equals(parts.ext));
  assert.strictEqual(at(r.flash, B.start, 4).toString('hex'), 'babec0de');
  onlyAppAreas(r.changes);
  assert.strictEqual(r.log.left, B.start);
});

installTest('installation: nothing in the other half', () => {
  const r = install({ running: 'A', otherBlank: true });
  assert.strictEqual(r.status, 0, r.out);
  assert.ok(at(r.flash, 0x907e0000, parts.ext.length).equals(parts.ext));
  onlyAppAreas(r.changes);
});

installTest('installation: second part already there, nothing rewritten in the other half', () => {
  const extFile = path.join(tmp, 'ext.bin');
  fs.writeFileSync(extFile, parts.ext);
  const r = install({ running: 'A', preload: { address: 0x907e0000, file: extFile } });
  assert.strictEqual(r.status, 0, r.out);
  assert.match(r.out, /intacte : rien à écrire/);
  assert.strictEqual(r.log.erased.filter((a) => a >= FLASH + HALF).length, 0);
  assert.strictEqual(r.log.written.filter(([a]) => a >= FLASH + HALF).length, 0);
  assert.ok(at(r.flash, 0x907e0000, parts.ext.length).equals(parts.ext));
});

installTest('installation: second part there but damaged, rewritten', () => {
  const extFile = path.join(tmp, 'ext-bad.bin');
  const bad = Buffer.from(parts.ext);
  bad[5000] ^= 0xff;
  fs.writeFileSync(extFile, bad);
  const r = install({ running: 'A', preload: { address: 0x907e0000, file: extFile } });
  assert.strictEqual(r.status, 0, r.out);
  assert.match(r.out, /abîmée : réécriture/);
  assert.ok(at(r.flash, 0x907e0000, parts.ext.length).equals(parts.ext));
});

installTest('the calculator refuses: stops, nothing at all is changed', () => {
  const r = install({ running: 'A', kernel: 'refuse' });
  assert.strictEqual(r.status, 2, r.out);
  assert.match(r.out, /a refusé l'écriture/);
  assert.match(r.out, /--flash2-kb 0/);
  assert.strictEqual(r.changes.length, 0);
  assert.strictEqual(r.log.left, A.start, 'the calculator was not handed back');
  assert.strictEqual(r.state, 2, 'the calculator was left in an error state');
});

installTest('the calculator says yes and writes nothing: caught by the read-back, apps untouched', () => {
  const r = install({ running: 'A', kernel: 'ignore' });
  assert.strictEqual(r.status, 2, r.out);
  assert.match(r.out, /relecture ne redonne pas/);
  assert.strictEqual(r.changes.length, 0);
});

installTest('the calculator does not offer its other half: stops before writing', () => {
  const r = install({ running: 'A', layout: 'thirdParty' });
  assert.strictEqual(r.status, 2, r.out);
  assert.match(r.out, /ne propose pas/);
  assert.strictEqual(r.changes.length, 0);
  assert.strictEqual(r.log.erased.length + r.log.written.length, 0);
});

test('the stand-in refuses what a calculator must refuse', () => {
  const c = new FakeCalculator({ running: 'A' });
  assert.strictEqual(c.allowed(FLASH + 0x20000), false);          // the running system
  assert.strictEqual(c.allowed(A.end), false);                    // its settings
  assert.strictEqual(c.allowed(A.start), true);
  assert.strictEqual(new FakeCalculator({ running: 'A', kernel: 'refuse' }).allowed(B.start), false);
});

if (failed) {
  console.log(failed + ' test(s) failed');
  process.exit(1);
}
console.log('all two-part installation tests passed');
