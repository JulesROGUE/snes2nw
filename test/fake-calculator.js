'use strict';
/*
 * A stand-in for a NumWorks N0110 on USB, for the tests: enough of the
 * calculator's side of the update protocol (DFU with ST's extensions) for
 * nwlink to read it and install apps on it, over an 8 MB flash image laid
 * out like the real one. It follows the userland source NumWorks publishes
 * (ion/src/device/shared/usb/dfu_interface.cpp and config/usb_userland.h).
 *
 * What the real kernel accepts to write is not published. Here it is a
 * setting, so that each possible answer can be tried:
 *   kernel: 'allow'   the other half can be written (what its USB description says)
 *           'refuse'  erasing or writing the other half fails
 *           'ignore'  it says yes and does nothing
 *
 * Loaded in place of the "usb" module (see lib/flash2-runner.js). The setup
 * comes from the environment, and what happened is written to a report file
 * when the process ends.
 */
const fs = require('fs');

const FLASH = 0x90000000;
const HALF = 0x400000;
const SECTOR = 0x10000;
const RAM = 0x20000000;
const RAM_SIZE = 0x40000;
const APPS_START = 0x170000; // offsets inside a half, as measured on a real N0110 (system 25.2.0)
const APPS_END = 0x3f0000;
const TRANSFER = 2048;

const IDLE = 2, DNLOAD_SYNC = 3, DNBUSY = 4, DNLOAD_IDLE = 5, MANIFEST_SYNC = 6, MANIFEST = 7, UPLOAD_IDLE = 9, ERROR = 10;
const OK = 0, ERR_TARGET = 1, ERR_NOTDONE = 9, ERR_STALLEDPKT = 15;

function description(half, { blank = false } = {}) {
  const b = Buffer.alloc(64, 0xff);
  if (blank) return b;
  b.writeUInt32LE(0xdec0edfe, 0);
  b.fill(0, 4, 12);
  b.write('25.2.0', 4, 'latin1');
  b.writeUInt32LE(RAM + 0x3000, 12);            // storage
  b.writeUInt32LE(0x10000, 16);
  b.writeUInt32LE(half + APPS_START, 20);       // external apps, flash
  b.writeUInt32LE(half + APPS_END, 24);
  b.writeUInt32LE(RAM + 0x18000, 28);           // external apps, RAM
  b.writeUInt32LE(RAM + 0x3d400, 32);
  b.writeUInt32LE(half + APPS_END, 36);         // device name
  b.writeUInt32LE(half + APPS_END + 0x100, 40);
  b.writeUInt32LE(0xdec0edfe, 44);
  return b;
}

class FakeCalculator {
  constructor({ running = 'A', layout = 'official', kernel = 'allow', otherBlank = false, preload = null } = {}) {
    this.runningHalf = running === 'A' ? FLASH : FLASH + HALF;
    this.otherHalf = running === 'A' ? FLASH + HALF : FLASH;
    this.kernel = kernel;
    this.flash = Buffer.alloc(2 * HALF, 0xff);
    // something recognisable everywhere a system would be, to see afterwards that it was left alone
    let seed = 12345;
    const junk = (from, to) => {
      for (let i = from; i < to; i++) {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        this.flash[i] = seed >>> 24;
      }
    };
    for (const half of [0, HALF]) {
      const blank = otherBlank && FLASH + half === this.otherHalf;
      if (!blank) junk(half, half + APPS_START);                 // kernel and system
      junk(half + APPS_END, half + HALF);                        // the system's settings
      description(FLASH + half, { blank }).copy(this.flash, half + 0x10000);
      // kernel header
      const k = Buffer.alloc(24);
      Buffer.from('f00dc0de', 'hex').copy(k, 0);
      k.write('25.2.0', 4, 'latin1');
      k.write('abcdef0', 12, 'latin1');
      Buffer.from('f00dc0de', 'hex').copy(k, 20);
      if (!blank) k.copy(this.flash, half + 0x1000);
    }
    // leftovers of old apps in the other half's app area, as on a real calculator
    const o = this.otherHalf - FLASH;
    junk(o + APPS_START, o + APPS_START + 21 * SECTOR);
    if (preload) Buffer.from(preload.data).copy(this.flash, preload.address - FLASH);
    this.before = Buffer.from(this.flash);

    this.ram = Buffer.alloc(RAM_SIZE);
    Buffer.from('badbeeef', 'hex').copy(this.ram, 0);
    this.ram.writeUInt32LE(this.runningHalf + 0x1000, 4);
    this.ram.writeUInt32LE(this.runningHalf + 0x10000, 8);
    Buffer.from('badbeeef', 'hex').copy(this.ram, 12);

    // what the calculator declares over USB, by half and by kind of system (usb_userland.h)
    const strings = {
      official: { A: '@Flash/0x90030000/61*064Kg,64*064Kg', B: '@Flash/0x90000000/08*004Kg,01*032Kg,63*064Kg/0x90430000/61*064Kg' },
      thirdParty: { A: '@Flash/0x90030000/61*064Kg', B: '@Flash/0x90430000/61*064Kg' },
    };
    this.strings = { 4: strings[layout][running], 5: '@SRAM/0x20000000/01*252Ke' };

    this.state = IDLE;
    this.status = OK;
    this.alt = 0;
    this.pointer = 0;
    this.newPointer = null;
    this.erasePage = null;
    this.pending = null;
    this.log = { erased: [], written: [], refused: 0, left: null, reads: 0 };

    const self = this;
    const alt = (n) => ({ alternateSetting: n, interfaceClass: 254, interfaceSubclass: 1, interfaceProtocol: 2 });
    const config = { configurationValue: 1, interfaces: [{ interfaceNumber: 0, claimed: false, alternate: null, alternates: [alt(0), alt(1)] }] };
    this.device = {
      vendorId: 0x0483,
      productId: 0xa291,
      productName: 'NumWorks Calculator',
      serialNumber: '0123456789ABCDEF',
      opened: false,
      configurations: [config],
      configuration: null,
      async open() { this.opened = true; },
      async close() { this.opened = false; },
      async selectConfiguration() { this.configuration = config; },
      async claimInterface(n) { config.interfaces[n].claimed = true; },
      async selectAlternateInterface(n, a) { config.interfaces[n].alternate = config.interfaces[n].alternates[a]; self.alt = a; },
      async controlTransferIn(setup, length) { return self.transferIn(setup, length); },
      async controlTransferOut(setup, data) { return self.transferOut(setup, data); },
    };
    this.webusb = {
      getDevices: async () => [this.device],
      requestDevice: async () => this.device,
    };
  }

  /* may this address be erased or written? The running half: its app area only. */
  allowed(address) {
    const half = FLASH + Math.floor((address - FLASH) / HALF) * HALF;
    if (address < FLASH || address >= FLASH + 2 * HALF) return false;
    if (half === this.runningHalf) return address >= half + APPS_START && address < half + APPS_END;
    return this.kernel !== 'refuse';
  }

  read(address, length) {
    this.log.reads++;
    if (this.alt === 1) {
      if (address < RAM || address + length > RAM + RAM_SIZE) return null;
      return this.ram.subarray(address - RAM, address - RAM + length);
    }
    if (address < FLASH || address + length > FLASH + 2 * HALF) return null;
    return this.flash.subarray(address - FLASH, address - FLASH + length);
  }

  afterStatus() {
    if (this.state === MANIFEST) {
      this.log.left = this.pointer;
      this.state = IDLE;
      return;
    }
    if (this.state !== DNBUSY) return;
    if (this.pending) {
      const { address, data } = this.pending;
      this.pending = null;
      const half = FLASH + Math.floor((address - FLASH) / HALF) * HALF;
      if (!this.allowed(address) || !this.allowed(address + data.length - 1)) {
        this.log.refused++;
        this.state = ERROR;
        this.status = ERR_TARGET;
        return;
      }
      if (!(half === this.otherHalf && this.kernel === 'ignore')) {
        // flash can only clear bits: a write over something not erased gives garbage, as on the real thing
        for (let i = 0; i < data.length; i++) this.flash[address - FLASH + i] &= data[i];
      }
      this.log.written.push([address, data.length]);
    }
    if (this.newPointer !== null) {
      this.pointer = this.newPointer;
      this.newPointer = null;
    }
    if (this.erasePage !== null) {
      const address = this.erasePage;
      this.erasePage = null;
      const half = FLASH + Math.floor((address - FLASH) / HALF) * HALF;
      if (address % SECTOR !== 0 || !this.allowed(address)) {
        this.log.refused++;
        this.state = ERROR;
        this.status = ERR_TARGET;
        return;
      }
      if (!(half === this.otherHalf && this.kernel === 'ignore')) this.flash.fill(0xff, address - FLASH, address - FLASH + SECTOR);
      this.log.erased.push(address);
    }
    this.state = DNLOAD_IDLE;
    this.status = OK;
  }

  transferIn(setup, length) {
    const reply = (bytes) => {
      const u = Uint8Array.from(bytes);
      return { status: 'ok', data: new DataView(u.buffer) };
    };
    if (setup.requestType === 'standard') {
      if (setup.request === 8) return reply([1]);        // GET_CONFIGURATION
      if (setup.request === 10) return reply([this.alt]); // GET_INTERFACE
      if (setup.request === 6) {                          // GET_DESCRIPTOR
        const type = setup.value >> 8, index = setup.value & 0xff;
        if (type === 1) return reply([18, 1, 0, 2, 0, 0, 0, 64, 0x83, 0x04, 0x91, 0xa2, 0x10, 0x01, 1, 2, 3, 1]);
        if (type === 2) {
          const body = [
            9, 4, 0, 0, 0, 0xfe, 1, 2, 4,
            9, 4, 0, 1, 0, 0xfe, 1, 2, 5,
            9, 0x21, 0x0b, 0, 0, TRANSFER & 0xff, TRANSFER >> 8, 0x1a, 0x01,
          ];
          const all = [9, 2, (9 + body.length) & 0xff, (9 + body.length) >> 8, 1, 1, 0, 0x80, 0x32, ...body];
          return reply(all.slice(0, length));
        }
        if (type === 3 && this.strings[index]) {
          const s = Buffer.from(this.strings[index], 'utf16le');
          return reply([2 + s.length, 3, ...s]);
        }
      }
      return { status: 'stall' };
    }
    switch (setup.request) {
      case 2: { // UPLOAD
        if (this.state !== IDLE && this.state !== UPLOAD_IDLE) return { status: 'stall' };
        if (setup.value < 2) return { status: 'stall' };
        const data = this.read((setup.value - 2) * TRANSFER + this.pointer, length);
        this.state = UPLOAD_IDLE;
        return reply(data || []);
      }
      case 3: { // GETSTATUS
        if (this.state === MANIFEST_SYNC) this.state = MANIFEST;
        else if (this.state === DNLOAD_SYNC) this.state = DNBUSY;
        const r = reply([this.status, 0, 0, 0, this.state, 0]);
        this.afterStatus();
        return r;
      }
      case 5: return reply([this.state]); // GETSTATE
      default: return { status: 'stall' };
    }
  }

  transferOut(setup, data) {
    const bytes = data ? Buffer.from(data.buffer ? data.buffer.slice(data.byteOffset || 0, (data.byteOffset || 0) + data.byteLength) : data) : Buffer.alloc(0);
    const done = { status: 'ok', bytesWritten: bytes.length };
    switch (setup.request) {
      case 1: // DNLOAD
        if (this.state !== IDLE && this.state !== DNLOAD_IDLE) {
          this.state = ERROR;
          this.status = ERR_NOTDONE;
          return { status: 'stall' };
        }
        if (bytes.length === 0) {
          this.state = MANIFEST_SYNC; // leave
        } else if (setup.value === 0) {
          if (bytes[0] === 0x21 && bytes.length === 5) {
            this.newPointer = bytes.readUInt32LE(1);
            this.state = DNLOAD_SYNC;
          } else if (bytes[0] === 0x41 && bytes.length === 5) {
            this.erasePage = bytes.readUInt32LE(1);
            this.state = DNLOAD_SYNC;
          } else {
            this.state = ERROR;
            this.status = ERR_STALLEDPKT;
          }
        } else if (setup.value === 1) {
          return { status: 'stall' };
        } else {
          this.pending = { address: (setup.value - 2) * TRANSFER + this.pointer, data: bytes };
          this.state = DNLOAD_SYNC;
        }
        return done;
      case 4: // CLRSTATUS
      case 6: // ABORT
        this.status = OK;
        this.state = IDLE;
        return done;
      default:
        return { status: 'stall' };
    }
  }

  /* [address, length] of every run of bytes that is not what it was at the start */
  changes() {
    const runs = [];
    let from = -1;
    for (let i = 0; i <= this.flash.length; i++) {
      const diff = i < this.flash.length && this.flash[i] !== this.before[i];
      if (diff && from < 0) from = i;
      if (!diff && from >= 0) {
        runs.push([FLASH + from, i - from]);
        from = -1;
      }
    }
    return runs;
  }
}

module.exports = { FakeCalculator, FLASH, HALF, SECTOR, APPS_START, APPS_END };

/* As the "usb" module of a child process (see the top of this file). */
if (process.env.SNES2NW_TEST_CALC) {
  const setup = JSON.parse(process.env.SNES2NW_TEST_CALC);
  if (setup.preload) setup.preload = { address: setup.preload.address, data: fs.readFileSync(setup.preload.file) };
  const calc = new FakeCalculator(setup);
  module.exports.webusb = calc.webusb;
  process.on('exit', (code) => {
    if (!setup.report) return;
    fs.writeFileSync(setup.report + '.flash', calc.flash);
    fs.writeFileSync(setup.report, JSON.stringify({ code, log: calc.log, changes: calc.changes(), state: calc.state }));
  });
}
