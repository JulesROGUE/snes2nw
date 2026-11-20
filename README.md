# snes2nw

Prépare un jeu SNES pour la calculatrice **NumWorks** et l'installe, en une commande. Il fonctionne avec l'appli **nwsnes** (dépôt séparé), dont une version compilée est fournie ici.

> **État : version 0.1, expérimentale.** La préparation est testée sur PC. L'installation par USB et l'appli elle-même **n'ont pas encore été essayées sur une vraie calculatrice**, et aucun jeu du commerce n'a été essayé.

```
snes2nw mon-jeu.sfc --play
```

1. lit la ROM et dit si la cartouche est prise en charge ;
2. vous fait **jouer dans le navigateur** (ou joue tout seul avec des touches au hasard) et observe ce que le jeu met en mémoire ;
3. écrit un **pack** : la ROM et un dictionnaire des contenus de mémoire observés ;
4. rejoue la partie avec la mémoire vive de la calculatrice et annonce si ça tient ;
5. installe l'appli et le pack sur la calculatrice branchée en USB.

## Pourquoi faut-il jouer d'abord sur PC ?

Une SNES utilise 192 Ko de mémoire vive ; la calculatrice en laisse une centaine aux applis. Mais l'essentiel de cette mémoire contient des données prévisibles : graphismes décompressés, niveaux, tables. snes2nw les repère pendant votre partie et les range dans la mémoire **flash**, qui est bien plus grande. Sur la calculatrice, seule la partie imprévisible reste en mémoire vive.

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

| Option | Rôle |
|---|---|
| `--play` | partie d'essai dans le navigateur ; recommandé pour un vrai jeu |
| `--add` | compléter le pack existant au lieu de repartir de zéro |
| `--auto <images>` | durée de chaque partie automatique (défaut 3600, soit 1 minute) |
| `--seeds <n>` | nombre de parties automatiques (défaut 4) |
| `--out <fichier>` | nom du pack (défaut : à côté de la ROM, extension `.pack`) |
| `--flash-kb <n>` | place en flash pour le pack (défaut 2300) |
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

## Ce qui ne marche pas

- Cartouches avec une puce supplémentaire (Super FX, SA-1, DSP…) : refusées dès l'analyse.
- ROM trop grosse pour la flash de la calculatrice (au-delà de 2 Mo environ sur N0110).
- Le son : il n'y en a pas.
- Les sauvegardes ne sont pas conservées quand on quitte l'appli.
- Certains jeux peuvent rester bloqués au démarrage en attendant leur processeur audio. `--apu 0` à `--apu 3` force une des quatre réponses possibles ; si l'une débloque le jeu, notez-la dans `profiles/index.json`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `bin/snes2nw.js` | la commande |
| `lib/core.js` | accès au cœur d'émulation (`core/nwsnes.wasm`) |
| `lib/train.js`, `web/` | la partie dans le navigateur |
| `core/nwsnes.wasm` | le cœur de nwsnes, le profileur et le fabricant de packs, en WebAssembly |
| `runtime/nwsnes.nwa` | l'appli calculatrice, compilée depuis le dépôt nwsnes |
| `profiles/index.json` | réglages par jeu, repérés par l'empreinte de la ROM (aucune donnée de jeu) |
| `test/` | vérifications (`npm test`) sur une ROM de test libre |

`core/nwsnes.wasm` et `runtime/nwsnes.nwa` se régénèrent depuis le dépôt nwsnes (`make wasm`, `make nwa`).

## ROM

snes2nw ne contient et ne télécharge aucun jeu. N'utilisez que des copies de cartouches que vous possédez. **Un pack contient la ROM : ne le partagez pas.**

## Licence

MIT, voir [LICENSE](LICENSE) et [THIRD-PARTY.md](THIRD-PARTY.md). NumWorks est une marque déposée de NumWorks ; SNES et Super Nintendo sont des marques de Nintendo. Ce projet n'est affilié à aucune des deux sociétés.
