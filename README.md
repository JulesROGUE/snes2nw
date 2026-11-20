# snes2nw

Prépare un jeu SNES pour la calculatrice **NumWorks** et l'installe, en une commande. Il fonctionne avec l'appli **nwsnes** (dépôt séparé), dont une version compilée est fournie ici.

> **État : version 0.3, expérimentale.** La préparation, l'installation par USB et l'appli fonctionnent sur une vraie N0110 pour un jeu qui tient dans la zone des applis (Super Mario World). L'installation **en deux parties** des jeux plus gros, qui écrit dans l'autre moitié de la mémoire flash, **n'a pas encore été essayée sur une vraie calculatrice** : seulement sur PC, contre une calculatrice simulée.

```
snes2nw mon-jeu.sfc --play
```

1. lit la ROM et dit si la cartouche est prise en charge ;
2. vous fait **jouer dans le navigateur** (ou joue tout seul avec des touches au hasard) et observe ce que le jeu met en mémoire ;
3. écrit un **pack** : la ROM et un dictionnaire des contenus de mémoire observés (en deux parties si le jeu dépasse 2,5 Mo) ;
4. rejoue la partie avec la mémoire vive de la calculatrice et annonce si ça tient ;
5. installe l'appli et le pack sur la calculatrice branchée en USB.

## Pourquoi faut-il jouer d'abord sur PC ?

Une SNES utilise 192 Ko de mémoire vive ; la calculatrice en laisse 149 aux applis. Mais l'essentiel de cette mémoire contient des données prévisibles : graphismes décompressés, niveaux, tables. snes2nw les repère pendant votre partie et les range dans la mémoire **flash**, qui est bien plus grande. Sur la calculatrice, seule la partie imprévisible reste en mémoire vive.

Conséquence : un passage que vous n'avez jamais joué sur PC peut manquer de mémoire sur la calculatrice. L'appli s'arrête alors avec un message, et il suffit de rejouer ce passage avec `--play --add` puis de réinstaller.

## Installation

Il faut [Node.js](https://nodejs.org) version 18 ou plus récente (Windows, macOS ou Linux).

```
git clone https://github.com/JulesROGUE/snes2nw
cd snes2nw
npm install
```

Sans git : bouton « Code », « Download ZIP » sur GitHub, décompressez, puis `npm install` dans le dossier.

Ensuite, depuis ce dossier :

```
node bin/snes2nw.js chemin\vers\mon-jeu.sfc --play
```

(`npm install -g .` rend la commande `snes2nw` disponible partout.)

## Commandes

| Commande | Effet |
|---|---|
| `snes2nw jeu.sfc --play` | tout faire, en jouant soi-même dans le navigateur |
| `snes2nw jeu.sfc` | tout faire, avec des parties automatiques (touches au hasard) |
| `snes2nw info jeu.sfc` | décrire la ROM et dire si elle est prise en charge |
| `snes2nw install jeu.pack` | installer un pack déjà préparé |
| `snes2nw diag` | installer une appli qui mesure la calculatrice (mémoire, vitesse de la flash) |
| `snes2nw sonde` | installer une appli qui montre le découpage de la flash (lecture seule) |

| Option | Rôle |
|---|---|
| `--play` | partie d'essai dans le navigateur ; recommandé pour un vrai jeu |
| `--add` | compléter le pack existant au lieu de repartir de zéro |
| `--auto <images>` | durée de chaque partie automatique (défaut 3600, soit 1 minute) |
| `--seeds <n>` | nombre de parties automatiques (défaut 4) |
| `--out <fichier>` | nom du pack (défaut : à côté de la ROM, extension `.pack`) |
| `--flash-kb <n>` | place en flash pour le pack (défaut 2500 : la zone des applis d'une N0110, 2560 Ko, moins l'appli) |
| `--flash2-kb <n>` | place dans la zone des applis de l'autre moitié de la flash, pour la seconde partie d'un jeu trop gros (défaut 2560 ; `0` : ne jamais y écrire) |
| `--ram-kb <n>` | mémoire vive que la calculatrice laisse aux applis (défaut 149, mesuré sur une N0110) |
| `--no-install` | ne pas installer |
| `--yes` | ne pas demander confirmation avant d'installer |
| `--apu <0-3>`, `--frameskip <n>` | réglages avancés, voir plus bas |

### La partie dans le navigateur

Une page locale s'ouvre (adresse en `127.0.0.1`, rien ne sort de votre ordinateur). Clavier : flèches, et les touches du coin bas-gauche pour les boutons (la page affiche les lettres de votre clavier, AZERTY compris). Une manette fonctionne aussi. Il n'y a pas de son. Cliquez sur « Terminer et préparer le jeu » quand vous avez joué ce que vous voulez retrouver sur la calculatrice.

Les parties automatiques suffisent pour un essai, mais des touches au hasard ne vont pas loin dans un vrai jeu.

### Le verdict

```
Vérification avec 149 Ko de mémoire vive (dont 117 Ko pour le jeu)
  votre partie : tient en mémoire
  mesure du strict nécessaire… 41 Ko (sans dictionnaire il en faudrait au moins 150 Ko ; …)
Verdict : ça tient, avec 76 Ko de marge pour les passages non joués pendant l'essai.
```

(Chiffres d'illustration.) Le verdict porte sur la **mémoire**, pour ce qui a été joué. Il ne dit rien de la vitesse, qui ne se mesure que sur la calculatrice : dans l'appli, la touche `0` affiche les images par seconde et la vitesse en %.

Les 149 Ko ont été mesurés sur une N0110 ; l'appli elle-même en garde une trentaine. Ce n'est pas garanti sur un autre modèle ou une autre version du système : l'appli affiche la mémoire réellement disponible à son démarrage (« RAM totale »). Si elle diffère, relancez avec `--ram-kb`.

`node bin/snes2nw.js diag` installe à la place une petite appli de mesure (mémoire, vitesse de la flash et des caches) : utile pour comprendre une lenteur, elle remplace l'appli SNES jusqu'à la prochaine installation.

### L'installation

snes2nw lance l'outil `nwlink` de NumWorks. Branchez la calculatrice en USB, allumée, et fermez l'onglet my.numworks.com s'il est ouvert.

**Attention : cette installation remplace les applis externes déjà présentes sur la calculatrice.** Une confirmation est demandée.

Si la calculatrice n'est pas détectée, l'autre voie est le site [my.numworks.com/apps](https://my.numworks.com/apps), qui sait envoyer une appli `.nwa` avec son fichier de données : l'appli est `runtime/nwsnes.nwa`, le fichier de données est votre `.pack`.

Sur la calculatrice, l'appli s'appelle « SNES ». Les touches sont décrites dans le dépôt nwsnes.

### Les jeux de plus de 2,5 Mo : l'installation en deux parties

La zone des applis d'une N0110 fait 2560 Ko. Mais sa mémoire flash contient deux systèmes : celui qui tourne, et une copie de secours dans laquelle NumWorks écrit ses mises à jour. Chacun a sa zone d'applis, et celle du système de secours ne sert à rien tant qu'il ne tourne pas.

Pour un jeu trop gros, snes2nw coupe le pack en deux. La première partie est installée normalement, avec l'appli. La seconde est écrite à la fin de la zone d'applis de **l'autre moitié** de la flash, où l'appli va la lire. Le jeu est alors complet : Donkey Kong Country (4 Mo) ou EarthBound (3 Mo) tiennent en entier.

Ce qu'il faut savoir avant d'accepter :

- **C'est en dehors de ce que NumWorks prévoit pour les applis.** snes2nw n'écrit que dans la zone d'applis de l'autre moitié : ni dans son système, ni dans son dernier secteur (les réglages). Il vérifie d'abord que la calculatrice déclare elle-même cette zone inscriptible, relit tout ce qu'il a écrit, et n'installe l'appli qu'ensuite.
- **Ce n'est pas encore confirmé sur une vraie calculatrice.** Le système déclare l'autre moitié inscriptible par USB (c'est dans son code source publié), mais le noyau, lui, n'est pas publié. S'il refuse, snes2nw s'arrête sans toucher aux applis en place, et le jeu peut encore s'installer en version partielle avec `--flash2-kb 0`.
- **Une mise à jour de la calculatrice efface le jeu**, puisqu'elle écrit dans cette moitié. Il suffit de relancer `snes2nw install jeu.pack`.
- Les restes d'anciennes applis externes qui se trouvent dans cette zone (invisibles) sont effacés.
- En dernier recours, NumWorks fournit une [procédure de récupération](https://www.numworks.com/support/connect/rescue) qui réinstalle tout le système.

La seconde partie ne dépend que du jeu, pas de vos parties d'essai : après un `--play --add`, la réinstallation la retrouve en place, la relit, et ne réécrit que la première.

Cette installation passe par le code USB de `nwlink`, chargé avec une étape en plus (`lib/flash2.js`) ; `nwlink` doit donc être installé dans le dossier (`npm install`), et la voie my.numworks.com ne convient pas à ces jeux.

Au-delà de 5 Mo environ, ou avec `--flash2-kb 0`, le jeu ne tient pas en entier : seule la partie de sa ROM lue pendant vos parties d'essai est installée, et l'appli s'arrête avec un message si le jeu en sort.

## Ce qui ne marche pas

- Cartouches avec une puce supplémentaire (Super FX, SA-1, DSP…) : refusées dès l'analyse.
- Jeu de plus de 5 Mo environ : installé en partie seulement (voir plus haut).
- Le son : il n'y en a pas.
- Les sauvegardes ne sont pas conservées quand on quitte l'appli.
- Certains jeux peuvent rester bloqués au démarrage en attendant leur processeur audio. `--apu 0` à `--apu 3` force une des quatre réponses possibles ; si l'une débloque le jeu, notez-la dans `profiles/index.json`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `bin/snes2nw.js` | la commande |
| `lib/core.js` | accès au cœur d'émulation (`core/nwsnes.wasm`) |
| `lib/flash2.js`, `lib/flash2-runner.js` | l'installation en deux parties : où va la seconde, vérifications, écriture et relecture par USB |
| `lib/train.js`, `web/` | la partie dans le navigateur |
| `core/nwsnes.wasm` | le cœur de nwsnes, le profileur et le fabricant de packs, en WebAssembly |
| `runtime/nwsnes.nwa` | l'appli calculatrice, compilée depuis le dépôt nwsnes |
| `runtime/nwsnes-diag.nwa`, `runtime/nwsnes-probe.nwa` | les applis de mesure (`diag`, `sonde`) |
| `profiles/index.json` | réglages par jeu, repérés par l'empreinte de la ROM (aucune donnée de jeu) |
| `test/` | vérifications (`npm test`) sur une ROM de test libre, dont des installations complètes contre une calculatrice simulée (`test/fake-calculator.js`) |

`core/nwsnes.wasm` et `runtime/nwsnes.nwa` se régénèrent depuis le dépôt nwsnes (`make wasm`, `make nwa`).

## ROM

snes2nw ne contient et ne télécharge aucun jeu. N'utilisez que des copies de cartouches que vous possédez. **Un pack contient la ROM : ne le partagez pas.**

## Licence

MIT, voir [LICENSE](LICENSE) et [THIRD-PARTY.md](THIRD-PARTY.md). NumWorks est une marque déposée de NumWorks ; SNES et Super Nintendo sont des marques de Nintendo. Ce projet n'est affilié à aucune des deux sociétés.
