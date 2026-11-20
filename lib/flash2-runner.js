'use strict';
/*
 * Installs a game that comes in two parts. Run by bin/snes2nw.js as a
 * separate process:
 *
 *   node flash2-runner.js <jeu.pack> <appli.nwa>
 *
 * It is nwlink's "install-nwa", with one step added before the app is
 * written: the second part of the pack goes to the other half of the flash
 * (see flash2.js). Exit code: 0 done, 3 the second part could not be written
 * (nothing else was), anything else: nwlink's own failure.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Core } = require('./core');
const flash2 = require('./flash2');

function stop(message) {
  process.stdout.write('\nErreur : ' + message + '\n');
  process.exit(3);
}

function main() {
  const [packFile, nwa] = process.argv.slice(2);
  if (!packFile || !nwa) stop('usage : flash2-runner.js <jeu.pack> <appli.nwa>');
  const core = new Core();
  let parts;
  try {
    parts = flash2.splitPack(fs.readFileSync(packFile), core);
  } catch (e) {
    stop(e.message);
  }
  if (!parts.ext) stop('ce pack est en une seule partie : installation ordinaire.');
  const dir = flash2.nwlinkDir();
  if (!dir) stop('nwlink est introuvable. Lancez « npm install » dans le dossier de snes2nw.');
  // tests only: a stand-in for the calculator (test/fake-calculator.js)
  const usb = process.env.SNES2NW_TEST_USB ? require(process.env.SNES2NW_TEST_USB) : undefined;
  let cli;
  try {
    cli = flash2.loadNwlink(dir, { usb });
  } catch (e) {
    stop(e.message);
  }
  // nwlink takes the pack proper as a file
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'snes2nw-'));
  const mainFile = path.join(tmp, 'main.pack');
  fs.writeFileSync(mainFile, parts.main);
  process.on('exit', () => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* a leftover temporary file is harmless */ }
  });

  const hook = flash2.makeHook({ ext: parts.ext, core });
  globalThis.__snes2nwBefore = async (calc, firmware, area) => {
    try {
      await hook(calc, firmware, area);
    } catch (e) {
      // Hand the calculator back the way nwlink does after an installation,
      // then stop: the app and the first part are not written.
      try {
        await calc.uploadFlash(area.flashStart, 4); // also clears an error state
        await calc.dfu.leave(area.flashStart);
      } catch (e2) { /* it will come back by itself when unplugged */ }
      stop((e instanceof flash2.Flash2Error ? e.message : 'échec inattendu : ' + (e && e.stack ? e.stack : e)) +
        '\n  L\'appli et la première partie du jeu n\'ont pas été écrites : rien n\'a changé dans les applis de la calculatrice.');
    }
    process.stdout.write('\nPremière partie du jeu et appli : zone des applis habituelle\n');
  };
  cli([process.execPath, 'nwlink', 'install-nwa', '--external-data', mainFile, nwa]);
}

main();
