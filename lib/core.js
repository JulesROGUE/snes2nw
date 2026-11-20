'use strict';
// Thin wrapper around core/nwsnes.wasm: the calculator's own emulator core,
// the memory profiler and the pack builder, compiled to WebAssembly.
const fs = require('fs');
const path = require('path');

const WASM = path.join(__dirname, '..', 'core', 'nwsnes.wasm');
const PAGE = 256;

class Core {
  constructor() {
    const module = new WebAssembly.Module(fs.readFileSync(WASM));
    this.x = new WebAssembly.Instance(module, {}).exports;
    if (this.x._initialize) this.x._initialize();
  }

  get mem() { return new Uint8Array(this.x.memory.buffer); }

  // copies bytes into the module's memory; returns the address (never freed
  // automatically: packs must outlive the sessions that use them)
  put(bytes) {
    const p = this.x.nsw_alloc(bytes.length);
    this.mem.set(bytes, p);
    return p;
  }

  str(p) {
    if (!p) return null;
    const m = this.mem;
    let e = p;
    while (m[e]) e++;
    return Buffer.from(m.subarray(p, e)).toString('latin1');
  }

  loadRom(bytes) {
    const p = this.put(bytes);
    const rc = this.x.nsw_load_rom(p, bytes.length);
    this.x.nsw_free(p);
    if (rc !== 0) return null;
    const cartType = this.x.nsw_info(0);
    return {
      title: this.str(this.x.nsw_title()).trim(),
      mapping: ['?', 'LoROM', 'HiROM', 'ExHiROM'][cartType] || '?',
      cartType,
      pal: !!this.x.nsw_info(1),
      romSize: this.x.nsw_info(2),
      ramSize: this.x.nsw_info(3),
      coprocessor: this.x.nsw_info(4) ? this.str(this.x.nsw_coprocessor_name()) : null,
      copierHeader: this.x.nsw_info(5),
      checksumOk: !!this.x.nsw_info(6),
    };
  }

  // pack: {ptr, size} from loadPack(), or null for the bare ROM
  session(pack, poolPages = 0, exact = false) {
    const rc = this.x.nsw_session(pack ? pack.ptr : 0, pack ? pack.size : 0, poolPages, exact ? 1 : 0);
    if (rc !== 0) throw new Error('session impossible (code ' + rc + ')');
  }

  loadPack(bytes) { return { ptr: this.put(bytes), size: bytes.length }; }

  // movie: Uint16Array of button states, one per frame (null: button masher)
  setMovie(movie) {
    if (this.moviePtr) this.x.nsw_free(this.moviePtr);
    this.moviePtr = 0;
    if (!movie) { this.x.nsw_movie(0, 0); return; }
    this.moviePtr = this.put(new Uint8Array(movie.buffer, movie.byteOffset, movie.byteLength));
    this.x.nsw_movie(this.moviePtr, movie.length);
  }

  run(frames, seed, start = 0, { sample = false, collectEach = false } = {}) {
    return this.x.nsw_run(frames, seed, start, (sample ? 1 : 0) | (collectEach ? 2 : 0));
  }

  frame(pad) { return this.x.nsw_frame(pad, 0); }

  stats() {
    this.x.nsw_collect();
    const s = (i) => this.x.nsw_stat(i);
    return { poolPages: s(0), usedPages: s(1), peakPages: s(2), cow: s(3), collections: s(4),
             backZero: s(5), backDict: s(6), oom: !!s(7), dictPages: s(8) };
  }

  // 256x224 RGB565 -> RGB bytes
  screenshot() {
    const fb = new Uint16Array(this.x.memory.buffer, this.x.nsw_fb(), 256 * 224);
    const rgb = Buffer.alloc(256 * 224 * 3);
    for (let i = 0; i < fb.length; i++) {
      const c = fb[i];
      rgb[i * 3] = ((c >> 11) & 31) * 255 / 31;
      rgb[i * 3 + 1] = ((c >> 5) & 63) * 255 / 63;
      rgb[i * 3 + 2] = (c & 31) * 255 / 31;
    }
    return { width: 256, height: 224, rgb };
  }

  profileReset() { if (this.x.nsw_profile_reset() !== 0) throw new Error('mémoire insuffisante'); }
  profileSeed(pack) { this.x.nsw_profile_seed(pack.ptr, pack.size); }

  buildPack(maxBytes, apuMode = 255, frameSkip = 255) {
    const p = this.x.nsw_build_pack(maxBytes, apuMode, frameSkip);
    if (!p) throw new Error('construction du pack impossible');
    const s = (i) => this.x.nsw_pack_stat(i);
    const bytes = Buffer.from(this.mem.subarray(p, p + s(0)));
    return { bytes, frames: s(1), candidates: s(2), dictPages: s(3), inRom: s(4), stored: s(5), leftOut: s(6), dropped: s(7) };
  }

  minPool(pack, frames, seed) { return this.x.nsw_min_pool(pack.ptr, pack.size, frames, seed); }
}

module.exports = { Core, PAGE };
