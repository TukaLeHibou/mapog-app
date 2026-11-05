# Mapog — Fog of War IRL

Découvrir la vraie carte du monde comme dans un jeu vidéo : toute la map est
recouverte d'un brouillard de guerre (façon Age of Empires II), et il se dissipe
là où tu te déplaces physiquement avec ton téléphone. Le but : retrouver dans la
vraie vie le plaisir d'explorer la map d'un jeu.

## État actuel

**Application native Android (Capacitor) + API de sync.** Le client web dans
`app/` est le cœur de l'application : il est embarqué tel quel dans l'app
native, qui y ajoute le **GPS en arrière-plan** (écran éteint, téléphone en
poche) via le plugin `@capacitor-community/background-geolocation`.

- Carte du monde dark (Leaflet vendorisé + tuiles CARTO/OpenStreetMap)
- Brouillard de guerre rendu sur canvas, percé là où tu es passé
- Suivi GPS continu, y compris en arrière-plan (notification persistante Android)
- **Offline-first** : la progression vit d'abord en local (IndexedDB) — ça
  fonctionne à l'étranger sans réseau, le GPS n'a pas besoin d'internet
- Compte optionnel : pseudo + mot de passe, la progression est poussée sur le
  serveur dès qu'il y a du réseau (sync auto toutes les 60 s + au retour du réseau)
- Stats : nombre de zones découvertes + surface en km²

## Architecture

```
Mapog/
├── app/              ← le client (vanilla JS, aucun bundler) — embarqué dans l'app native
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── config.js     réglages (taille de cellule, rayon révélé, API…)
│   │   ├── db.js         IndexedDB : cellules découvertes + métadonnées
│   │   ├── fog.js        couche canvas Leaflet du brouillard
│   │   ├── tracker.js    GPS : plugin natif background-geolocation,
│   │   │                 repli navigateur (dev/démo PC)
│   │   ├── sync.js       client de sync (register/login/push/pull)
│   │   └── main.js       point d'entrée, UI
│   ├── vendor/           Leaflet 1.9.4 vendorisé (pas de CDN : doit marcher offline)
│   ├── sw.js             service worker (mode web uniquement)
│   ├── manifest.json     PWA installable (mode web)
│   └── icons/icon.svg
├── android/          ← projet Android natif généré par Capacitor (committé)
│                       AndroidManifest.xml : permissions localisation arrière-plan
├── capacitor.config.json   appId click.goret.mapog, webDir app/
├── package.json            @capacitor/* + plugin background-geolocation
└── server/
    └── api.php           API de sync — PHP 8 + SQLite3, fichier unique
                          (la base est créée auto dans server/data/)
```

### Comment marche la découverte

Le monde est découpé en cellules de `0.0005°` (~55 m). Quand le GPS donne une
position (filtrée si précision > 150 m), la cellule correspondante est ajoutée à
l'ensemble des cellules découvertes, et le brouillard est percé d'un disque de
120 m autour. La progression = un ensemble de clés `latIdx_lngIdx`.

### Comment marche la sync (et pourquoi ça ne casse jamais)

La progression est un ensemble **qui ne fait que grandir** (on ne "re-couvre"
jamais une zone). La fusion entre le téléphone et le serveur est donc une simple
**union** : aucun conflit possible, même après des semaines hors-ligne.

- `push` : le client envoie ses cellules pas encore synchronisées
  (`INSERT OR IGNORE` côté serveur → les doublons sont gratuits)
- `pull` : le serveur renvoie les cellules reçues depuis le dernier pull
  (curseur sur l'horloge **serveur**, pas celle du téléphone)
- Le token d'auth est stocké en local : connecté une fois, la sync marche à vie,
  même après un long passage hors-ligne
- Se connecter sur un 2e appareil = récupérer toute sa progression

## Build de l'app Android

Tout l'outillage est **portable** dans `$env:USERPROFILE\tools\` (rien d'installé
au niveau système) : Node v22, JDK 21 (Temurin), SDK Android 35.

```powershell
$env:JAVA_HOME = "$env:USERPROFILE\tools\jdk-21.0.11+10"
$env:ANDROID_HOME = "$env:USERPROFILE\tools\android-sdk"
$env:Path = "$env:USERPROFILE\tools\node-v22.14.0-win-x64;$env:JAVA_HOME\bin;$env:Path"

cd <chemin-vers>\Mapog
npx cap sync android        # après chaque modif du code dans app/
cd android
.\gradlew.bat assembleDebug
```

APK produit : `android/app/build/outputs/apk/debug/app-debug.apk`
→ à copier sur le téléphone et installer ("sources inconnues" à autoriser),
ou `adb install` si le débogage USB est actif.

> 📱 Au premier lancement, Android demande la permission de localisation :
> choisir **"Toujours autoriser"** dans les réglages pour que la découverte
> continue écran éteint (une notification persistante s'affiche pendant le
> suivi — obligation Android).

Pour une version Play Store il faudra un build `release` signé (keystore) —
voir la doc Capacitor.

## App iOS

Le code est prêt (le plugin background-geolocation gère aussi iOS), mais le
build exige un **Mac avec Xcode** — impossible depuis Windows. Sur un Mac :

```bash
npm install && npx cap add ios && npx cap open ios
```

Puis dans Xcode : ajouter dans `Info.plist` les clés
`NSLocationAlwaysAndWhenInUseUsageDescription`,
`NSLocationWhenInUseUsageDescription`, et le mode background `location` ;
configurer la signature (compte Apple Developer, 99 €/an pour distribuer).
Alternative sans Mac : un service de build cloud (Codemagic, Ionic Appflow).

## Test en local (sur PC, sans téléphone)

PHP ≥ 8.1 requis pour l'API (sinon l'app marche quand même, en local pur) :

```bash
cp server/api.php app/
cd app
php -S 0.0.0.0:8080
```

Puis ouvrir **http://localhost:8080/?demo=1** — le mode démo remplace le GPS
par les flèches du clavier pour "marcher" et voir le brouillard se dissiper.

## Déploiement du serveur de sync (LXC + HAProxy, comme les autres projets)

⚠️ **Requis pour les comptes** : l'app native pointe en dur sur
`https://mapog.goret.click/api.php` (cf. `app/js/config.js`).

1. Créer un LXC web (cf. `proxmox-config/scripts/deploy-lxc-WEB.sh`) avec
   nginx + php-fpm + php-sqlite3
2. Webroot = contenu de `app/` + `server/api.php` à la racine :
   ```
   /var/www/mapog/
   ├── index.html, sw.js, manifest.json, css/, js/, vendor/, icons/
   ├── api.php
   └── data/          ← créé auto au premier appel (chown www-data)
   ```
   (servir `app/` en plus de l'API est gratuit et donne une version web de
   démo sur https://mapog.goret.click — GPS au premier plan uniquement)
3. **Bloquer l'accès à la base** dans le vhost nginx :
   ```nginx
   location /data/ { deny all; }
   ```
4. HAProxy : backend `mapog.goret.click` → IP du LXC :80, + cert Let's Encrypt
   (procédure certbot habituelle)

## Roadmap

1. Icône/splashscreen Android personnalisés (`@capacitor/assets` — pour
   l'instant c'est l'icône Capacitor par défaut)
2. Build `release` signé pour le Play Store
3. Build iOS (nécessite un Mac, cf. section App iOS)
4. Pagination du pull initial pour les très grosses progressions (le `more`
   est déjà géré côté client)
5. Stats fun : % du pays/de la région découvert, classement entre comptes
6. Export/import de sa progression (fichier JSON)

## Idée d'origine

> Une application mobile qui tourne en arrière-plan. Tu crées un compte pour
> enregistrer ta progression, tu commences sur une map qui fait la taille de la
> Terre entière, et quand tu te déplaces avec ton téléphone le Fog of War
> s'enlève là où tu passes — comme découvrir la map dans Age of Empires II,
> mais dans la vraie vie.
