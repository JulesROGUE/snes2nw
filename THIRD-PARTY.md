# Third-party code

snes2nw is distributed under the MIT license (see `LICENSE`).

- `core/nwsnes.wasm` and `runtime/nwsnes.nwa` are builds of the nwsnes
  project (MIT license), which itself derives in part from LakeSnes,
  Copyright (c) 2021-2023 angelo_wf and contributors, MIT license. See the
  nwsnes repository for the full notices and the sources.
- `core/nwsnes.wasm` is linked with parts of wasi-libc (memory allocation and
  string functions), distributed under the MIT and BSD-style licenses listed
  at https://github.com/WebAssembly/wasi-libc.
- `test/nwsnes-test.sfc` is the original test ROM of the nwsnes project (MIT).
- The installation step runs NumWorks' `nwlink` tool, fetched from npm as a
  dependency; it is not part of this repository. For a game in two parts,
  `lib/flash2.js` loads the installed copy of nwlink with one extra call
  slipped in before the app is written; this is done in memory at load time,
  the copy on disk is not modified and none of its code is reproduced here.
