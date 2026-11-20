#!/usr/bin/env node
'use strict';
/*
 * snes2nw - prépare un jeu SNES pour la calculatrice NumWorks et l'installe.
 *
 *   snes2nw jeu.sfc            tout faire : analyse, partie(s) d'essai, pack,
 *                              vérification, installation
 *   snes2nw info jeu.sfc       seulement décrire la ROM
 *   snes2nw install jeu.pack   seulement installer un pack déjà préparé
 *
 * Voir README.md pour le détail.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawnSync } = require('child_process');
const { Core, PAGE } = require('../lib/core');
const png = require('../lib/png');
const { play } = require('../lib/train');

const ROOT = path.join(__dirname, '..');
const APP_RAM = 32 * 1024; // what the calculator app itself keeps (its .data and .bss, about 30 KB)

const HELP = `snes2nw - prépare un jeu SNES pour la NumWorks (appli nwsnes) et l'installe

Usage :
  snes2nw <jeu.sfc> [options]     analyse, partie d'essai, pack, vérification, installation
  snes2nw info <jeu.sfc>          décrit la ROM et dit si elle est prise en charge
  snes2nw install <jeu.pack>      installe un pack déjà préparé
  snes2nw diag                    installe une petite appli qui mesure la calculatrice

Options :
  --play              jouer soi-même dans le navigateur (recommandé pour un vrai jeu)
  --auto <images>     durée de chaque partie automatique, en images (défaut 3600 = 1 minute)
  --seeds <n>         nombre de parties automatiques (défaut 4)
  --add               compléter le pack existant au lieu de repartir de zéro
  --out <fichier>     pack à écrire (défaut : à côté de la ROM, extension .pack)
  --flash-kb <n>      place en mémoire flash pour le pack (défaut 2300)
  --ram-kb <n>        mémoire vive laissée aux applis par la calculatrice (défaut 149, mesuré sur N0110)
  --apu <0-3>         force la réponse du faux processeur audio
  --frameskip <n>     images non dessinées entre deux images dessinées (défaut : automatique)
  --no-install        ne pas installer, écrire seulement le pack
  --yes               ne pas demander de confirmation avant d'installer
  --nwa <fichier>     appli à installer (défaut : runtime/nwsnes.nwa fournie)
`;

function fail(message) {
  console.error('Erreur : ' + message);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { _: [], auto: 3600, seeds: 4, flashKb: 2300, ramKb: 149, apu: null, frameskip: null };
  const numeric = { '--auto': 'auto', '--seeds': 'seeds', '--flash-kb': 'flashKb', '--ram-kb': 'ramKb', '--apu': 'apu', '--frameskip': 'frameskip' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (numeric[a]) {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 0) fail(`${a} attend un nombre entier`);
      opts[numeric[a]] = v;
    } else if (a === '--out') opts.out = argv[++i];
    else if (a === '--nwa') opts.nwa = argv[++i];
    else if (a === '--play') opts.play = true;
    else if (a === '--add') opts.add = true;
    else if (a === '--no-install') opts.noInstall = true;
    else if (a === '--yes' || a === '-y') opts.yes = true;
    else if (a === '--no-browser') opts.noBrowser = true;
    else if (a === '--help' || a === '-h') { console.log(HELP); process.exit(0); }
    else if (a.startsWith('--')) fail(`option inconnue : ${a}`);
    else opts._.push(a);
  }
  return opts;
}

const kb = (bytes) => (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + ' Ko';

function describe(info, sha1) {
  console.log(`Jeu          : ${info.title || '(sans titre)'}`);
  console.log(`Cartouche    : ${info.mapping}, ${info.pal ? 'PAL (50 Hz)' : 'NTSC (60 Hz)'}, ROM ${kb(info.romSize)}` +
    (info.ramSize ? `, sauvegarde ${kb(info.ramSize)}` : ''));
  if (info.copierHeader) console.log('               (en-tête de copieur de 512 octets ignoré)');
  if (!info.checksumOk) console.log('               (somme de contrôle de l\'en-tête incorrecte : ROM modifiée ou abîmée ?)');
  console.log(`Empreinte    : ${sha1}`);
  if (info.coprocessor) console.log(`Puce en plus : ${info.coprocessor}`);
}

function loadRom(core, file) {
  if (!fs.existsSync(file)) fail(`fichier introuvable : ${file}`);
  const bytes = fs.readFileSync(file);
  const info = core.loadRom(bytes);
  if (!info) fail(`${path.basename(file)} ne ressemble pas à une ROM SNES (.sfc ou .smc attendu).`);
  const sha1 = crypto.createHash('sha1').update(bytes.subarray(info.copierHeader)).digest('hex');
  return { bytes, info, sha1 };
}

function profileFor(sha1) {
  try {
    const all = JSON.parse(fs.readFileSync(path.join(ROOT, 'profiles', 'index.json'), 'utf8'));
    return (all.games && all.games[sha1]) || null;
  } catch (e) {
    return null;
  }
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim().toLowerCase()); });
  });
}

function nwlinkCommand() {
  try {
    const dir = path.dirname(require.resolve('nwlink/package.json'));
    return [process.execPath, [path.join(dir, 'bin', 'nwlink')]];
  } catch (e) {
    return [process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'nwlink@1.0.0']];
  }
}

// packFile null: an app that needs no data file (the diagnostic app)
async function install(packFile, opts) {
  const nwa = opts.nwa || path.join(ROOT, 'runtime', 'nwsnes.nwa');
  if (!fs.existsSync(nwa)) fail(`appli introuvable : ${nwa}`);
  const [cmd, base] = nwlinkCommand();
  const args = packFile ? [...base, 'install-nwa', '--external-data', packFile, nwa] : [...base, 'install-nwa', nwa];
  const manual = `  ${path.basename(cmd)} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`;
  console.log('\nInstallation sur la calculatrice');
  console.log('  Branchez la calculatrice en USB, allumée, et fermez l\'onglet my.numworks.com s\'il est ouvert.');
  console.log('  Attention : cette installation remplace les applis externes déjà présentes sur la calculatrice.');
  if (!opts.yes) {
    if (!process.stdin.isTTY) {
      console.log('  Pas de terminal interactif : installation non lancée. Commande à exécuter :\n' + manual);
      return false;
    }
    const answer = await ask('  Installer maintenant ? [o/N] ');
    if (answer !== 'o' && answer !== 'oui' && answer !== 'y') {
      console.log('  Installation annulée. Pour la faire plus tard :\n' + manual);
      return false;
    }
  }
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.error || r.status !== 0) {
    console.log('\n  L\'installation a échoué (calculatrice non détectée ?). Autre méthode : sur https://my.numworks.com/apps,');
    console.log(`  ajoutez le fichier ${nwa}`);
    if (packFile) console.log(`  et donnez-lui comme fichier de données ${packFile}`);
    process.exitCode = 2;
    return false;
  }
  console.log(`  Installé. Sur la calculatrice : menu principal, appli « ${packFile ? 'SNES' : 'Diag'} ».`);
  return true;
}

// Smallest RAM pool (in pages, to within 2 KB) that plays the run through.
// A pass that tidies memory after every frame gives a floor; the pool is then
// grown from there until the run completes, so few replays are needed.
function measureNeed(core, pack, run) {
  const MAX = 896;
  core.session(pack, 0);
  core.run(run.frames, run.seed, 0, { collectEach: true });
  const floor = Math.max(1, core.stats().peakPages);
  const fits = (pages) => {
    process.stdout.write('.');
    core.session(pack, pages);
    return core.run(run.frames, run.seed, 0) === run.frames;
  };
  let lo = floor - 1, hi = MAX;
  for (let step = 8; ; step *= 2) {
    const pages = Math.min(MAX, floor + step);
    if (pages >= MAX || fits(pages)) { hi = pages; break; }
    lo = pages;
  }
  while (hi - lo > 8) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts._.length === 0) { console.log(HELP); process.exit(0); }

  if (opts._[0] === 'diag') {
    console.log('Appli de mesure « Diag » : elle chronomètre la calculatrice (mémoire flash, cache, code en RAM).');
    console.log('Lancez-la sur la calculatrice et notez les nombres affichés.');
    await install(null, { ...opts, nwa: opts.nwa || path.join(ROOT, 'runtime', 'nwsnes-diag.nwa') });
    return;
  }
  if (opts._[0] === 'install') {
    if (!opts._[1]) fail('indiquez le pack à installer');
    if (!fs.existsSync(opts._[1])) fail(`fichier introuvable : ${opts._[1]}`);
    await install(opts._[1], opts);
    return;
  }

  const core = new Core();
  const infoOnly = opts._[0] === 'info';
  const romFile = infoOnly ? opts._[1] : opts._[0];
  if (!romFile) fail('indiquez la ROM');
  const { bytes, info, sha1 } = loadRom(core, romFile);
  describe(info, sha1);

  const flashBytes = opts.flashKb * 1024;
  const problems = [];
  if (info.coprocessor) problems.push(`la cartouche contient une puce supplémentaire (${info.coprocessor}) qui n'est pas émulée`);
  if (problems.length) {
    console.log('\nCe jeu ne peut pas fonctionner : ' + problems.join(' ; ') + '.');
    process.exit(infoOnly ? 0 : 1);
  }
  // A ROM bigger than the flash: only the part of it that is read while the
  // game is played here goes into the pack.
  const partial = info.romSize + 64 * 1024 > flashBytes;
  if (partial) {
    console.log(`\nCe jeu est trop gros pour la calculatrice : sa ROM fait ${kb(info.romSize)}, la place en flash ${opts.flashKb} Ko.`);
    console.log('Seule la partie du jeu jouée pendant l\'essai sera installée (ROM partielle). Sur la calculatrice,');
    console.log('le jeu s\'arrêtera avec un message dès qu\'il sortira de ce qui a été joué ici.');
    if (!opts.play) console.log('Utilisez « --play » et jouez vous-même le passage voulu : des touches au hasard ne vont pas loin.');
  }
  if (infoOnly) {
    console.log('\n' + (partial ? 'Un essai est possible' : 'Rien ne s\'oppose à un essai') + ' : lancez « snes2nw ' + path.basename(romFile) + (partial ? ' --play' : '') + ' ».');
    return;
  }

  const prof = profileFor(sha1);
  if (prof) console.log(`Réglages    : profil « ${prof.name} »`);
  const apuMode = opts.apu !== null ? opts.apu : (prof && Number.isInteger(prof.apuMode) ? prof.apuMode : 255);
  const frameSkip = opts.frameskip !== null ? opts.frameskip : (prof && Number.isInteger(prof.frameSkip) ? prof.frameSkip : 255);
  const outFile = opts.out || romFile.replace(/\.[^./\\]*$/, '') + '.pack';

  // ---- 1. parties d'essai : on regarde ce que le jeu met en mémoire
  core.profileReset();
  if (opts.add && fs.existsSync(outFile)) {
    core.profileSeed(core.loadPack(fs.readFileSync(outFile)));
    console.log(`\nLe pack existant ${path.basename(outFile)} sert de point de départ.`);
  }
  const runs = []; // {label, frames, seed, movie}
  if (opts.play) {
    console.log('\nPartie d\'essai dans le navigateur');
    const movie = await play(bytes, info.title, {
      open: !opts.noBrowser,
      onReady: (url) => console.log(`  Ouvrez ${url}\n  Jouez, puis cliquez sur « Terminer et préparer le jeu ».`),
    });
    if (!movie || movie.length === 0) fail('partie annulée, rien n\'a été préparé.');
    runs.push({ label: 'votre partie', frames: movie.length, seed: 0, movie });
  } else {
    console.log(`\nParties d'essai automatiques (${opts.seeds} × ${opts.auto} images, touches au hasard)`);
    console.log('  Pour un vrai jeu, « --play » donne un bien meilleur résultat : vous jouez vous-même.');
    for (let i = 0; i < opts.seeds; i++) {
      runs.push({ label: i === 0 ? 'sans toucher à rien' : `touches au hasard n°${i}`, frames: opts.auto, seed: i, movie: null });
    }
  }
  const fps = info.pal ? 50 : 60;
  for (const run of runs) {
    core.setMovie(run.movie);
    core.session(null);
    const t = Date.now();
    core.run(run.frames, run.seed, 0, { sample: true });
    run.rawPages = core.stats().usedPages;
    console.log(`  ${run.label} : ${Math.round(run.frames / fps)} s de jeu analysées en ${((Date.now() - t) / 1000).toFixed(1)} s`);
    if (run === runs[0]) run.shot = core.screenshot();
  }

  // ---- 2. le pack : ROM + dictionnaire de pages
  const pack = core.buildPack(flashBytes, apuMode, frameSkip);
  fs.writeFileSync(outFile, pack.bytes);
  const shotFile = outFile.replace(/\.pack$/, '') + '-apercu.png';
  fs.writeFileSync(shotFile, png.encode(runs[0].shot, 2));
  console.log(`\nPack écrit : ${outFile} (${kb(pack.bytes.length)})`);
  console.log(`  dictionnaire : ${pack.dictPages} pages de 256 octets, dont ${pack.inRom} retrouvées telles quelles dans la ROM` +
    (pack.leftOut ? ` ; ${pack.leftOut} pages n'ont pas trouvé de place` : ''));
  if (pack.romBlocksPacked < pack.romBlocks) {
    console.log(`  ROM partielle : ${kb(pack.romBlocksPacked * 4096)} sur ${kb(pack.romBlocks * 4096)} ` +
      `(${kb(pack.romBlocksRead * 4096)} lus pendant l'essai, le reste de la place va aux morceaux voisins)`);
  }
  console.log(`  aperçu de la dernière image : ${shotFile}`);

  // ---- 3. vérification : même jeu, avec la mémoire de la calculatrice
  const poolPages = Math.max(4, Math.floor((opts.ramKb * 1024 - APP_RAM) / PAGE));
  const loaded = core.loadPack(pack.bytes);
  console.log(`\nVérification avec ${opts.ramKb} Ko de mémoire vive (dont ${kb(poolPages * PAGE)} pour le jeu)`);
  let allOk = true;
  for (const run of runs) {
    core.setMovie(run.movie);
    core.session(loaded, poolPages);
    const done = core.run(run.frames, run.seed, 0);
    const ok = done === run.frames;
    allOk = allOk && ok;
    const why = ok ? '' : (core.stats().romMissing ? 'morceau de ROM absent du pack' : 'mémoire pleine');
    console.log(`  ${run.label} : ` + (ok ? 'tient en mémoire' : `${why} après ${Math.round(done / fps)} s de jeu`));
  }
  // how much is really needed, on the longest run
  const longest = runs.reduce((a, b) => (b.frames > a.frames ? b : a));
  core.setMovie(longest.movie);
  process.stdout.write('  mesure du strict nécessaire');
  const minPages = measureNeed(core, loaded, longest);
  core.setMovie(null);
  const without = Math.max(...runs.map((r) => r.rawPages));
  console.log(` environ ${kb(minPages * PAGE)} (sans dictionnaire il en faudrait au moins ${kb(without * PAGE)} ; une vraie SNES y consacre 192 Ko)`);
  const margin = poolPages - minPages;
  if (!allOk || margin < 0) {
    console.log('\nVerdict : ne tient pas dans cette mémoire. Essayez « --play » en jouant plus longtemps, ou « --add » pour compléter.');
  } else if (margin * PAGE < 12 * 1024) {
    console.log('\nVerdict : ça tient, mais de justesse. Les passages non joués pendant l\'essai risquent de saturer la mémoire.');
  } else {
    console.log(`\nVerdict : ça tient, avec ${kb(margin * PAGE)} de marge pour les passages non joués pendant l'essai.`);
  }
  console.log('  Ce verdict vaut pour ce qui a été joué ici, pas pour la vitesse : elle ne se mesure que sur la calculatrice.');
  if (pack.romBlocksPacked < pack.romBlocks) {
    console.log('  ROM partielle : la calculatrice ne pourra rejouer que ce qui a été joué ici (et ce qui en est proche).');
    console.log('  Pour aller plus loin : « --play --add » ajoute une nouvelle partie au pack existant.');
  }

  // ---- 4. installation
  if (opts.noInstall) {
    console.log(`\nPas d'installation demandée. Plus tard : snes2nw install "${outFile}"`);
    return;
  }
  await install(outFile, opts);
}

main().catch((e) => fail(e && e.message ? e.message : String(e)));
