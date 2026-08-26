<div align="center">

# <img src="images/VRCX-0.png" alt="VRCX-0 Logo" width="25"> VRCX-0

### VRCX, plus léger et plus rapide.

[English](README.md) | Français | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-Hant.md) | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md)

[![Version](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/version.json&style=flat&color=4340a2&labelColor=1f2328&logo=github&logoColor=white)](https://github.com/Map1en/VRCX-0/releases/latest)
[![Téléchargements](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/downloads.json&style=flat&color=4340a2&labelColor=1f2328)](https://github.com/Map1en/VRCX-0)
[![Installer](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/windows-installer-size.json&style=flat&label=installer&color=4340a2&labelColor=1f2328&logo=github&logoColor=white)](https://github.com/Map1en/VRCX-0/releases/latest)
[![Discord](https://img.shields.io/discord/1494343220467994644?style=flat&logo=discord&logoColor=white&label=discord&color=5865f2&labelColor=1f2328)](https://discord.gg/fehKP3SVPN)
<br>
[![CI](https://img.shields.io/github/actions/workflow/status/Map1en/VRCX-0/ci.yml?branch=master&label=CI&style=flat&labelColor=1f2328)](https://github.com/Map1en/VRCX-0/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/coverage.json&style=flat&color=brightgreen&labelColor=1f2328)](https://github.com/Map1en/VRCX-0)
[![License](https://img.shields.io/badge/license-GPL--3.0-4c566a?style=flat&labelColor=1f2328)](LICENSE)
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0?ref=badge_shield)

[![Télécharger](https://img.shields.io/badge/Download%20VRCX--0-4340a2?style=for-the-badge)](https://github.com/Map1en/VRCX-0/releases/latest)

Windows · macOS · Linux

![VRCX-0](images/screenshot-user-dialog.webp)

</div>

VRCX-0 est une réécriture de VRCX sur une base native Rust (Tauri + React) par
l'un de ses anciens mainteneurs, permettant de meilleures performances : Des
années de données maintenues, ainsi qu'une utilisation mémoire et taille
d'installation bien plus petites que l'originel.

Au premier lancement, vos données et paramètres VRCX sont automatiquement
transférés. Les données originelles ne sont pas modifiées — vous pouvez
réutiliser VRCX à tout moment.

Le projet VRCX étant désormais en maintenance, VRCX-0 est l'endroit où les
nouvelles fonctionnalités sont créées.

## Installation

Récupérez la
[dernière version](https://github.com/Map1en/VRCX-0/releases/latest) pour
votre plateforme :

| Platforme             | Fichier                                     |
| --------------------- | ------------------------------------------- |
| Windows               | `VRCX-0_<version>_windows_x86_64_setup.exe` |
| macOS (Apple Silicon) | `VRCX-0_<version>_macos_aarch64.dmg`        |
| macOS (Intel)         | `VRCX-0_<version>_macos_x86_64.dmg`         |
| Linux                 | `.AppImage`, `.deb`, or `.rpm`              |

L'installation est unique — VRCX-0 se mettra à jour automatiquement.

## L'important

- **Des années de données ne le ralentiront pas** — Les données qui
  ralentissaient VRCX n'affectent pas VRCX-0. Celui-ci fonctionne tout aussi
  bien sur un PC bas de gamme que sur un serveur personnel.
- **Utilisation mémoire 50% à 70% inférieure à VRCX** lors d'une utilisation
  normale
- le **mode arrière-plan** descend l'utilisation mémoire à une dizaine de Mo
  tout en maintenant les fonctionnalités essentielles.
- **Plus petit qu'un bundle d'avatar** — Seulement 10 Mo à installer. Prend un
  peu plus de 30 Mo sur le disque et environ 10 fois plus petit que VRCX
- **Zero problème de migration** — Votre base de données et paramètres VRCX
  sont importés automatiquement ; les données originelles ne sont pas
  modifiées

De plus :

- **IA Sociale** — Un assistant qui vous conseil sur vos relations VRChat :
  Demandez avec qui vous jouez le plus, de qui vous éloignez-vous ou bien
  l'heure idéalle pour jouer avec vos amis. Connectez votre propre IA pour
  commencer.
- **Serveur MCP** — Laissez un outil IA accéder à vos données sociales, bien
  plus flexible que l'assistant fourni ; recommandé pour les utilisateurs
  expérimentés
- **Historique local par compte** — les journaux de jeu et l'historique propre
  à chaque compte sont stockés séparément ; ainsi, lorsque vous utilisez
  plusieurs comptes, vos activités ne sont plus regroupées dans un seul fil
  d'actualité.
- **Sauvegarde et restauration** — Sauvegarde compressée en un clic, avec des
  sauvegardes automatiques programmées et plusieurs versions ; restaurer grâce
  à n'importe quelle sauvegarde
- **Collection de monde partageable** — Transformez vos mondes préférés en une
  page partageable que d'autres peuvent parcourir, ouvrir ou importer ; permet
  également de partager des liens vers des mondes et des avatars individuels
- **Social Automation** — Modifiez automatiquement votre statut et votre
  biographie en fonction de l'heure, du type d'instance ou de la personne avec
  laquelle vous êtes ; acceptez automatiquement les demandes d'invitation ;
  rétablissez votre état précédent lorsque les règles expirent
- **Overlay VR de poignée** — Prend en charge OpenVR (SteamVR) et
  **OpenXR sur Linux (testé avec WiVRn)**
- **Thèmes communautaires** — Parcourez et installez des thèmes à partir d'un
  catalogue, définissez une image d'arrière-plan personnalisée et superposez
  votre propre feuille de style CSS
- **Notifications** — Bureau, synthèse vocale, overlay VR et webhooks : quatre
  canaux configurables indépendamment selon le type d'événement ; les webhooks
  utilisent un format compatible avec Discord
- Compatible avec la navigation par clavier
- Intégration par API pour des applications tierces — currently room data,
  expanding over time
- Mode "sans tête" pour les configurations avancées — voir `crates/headless`

## Licence

VRCX-0 est sous Licence publique générale GNU v3.0 (GPLv3).

[![Statut FOSSA](https://app.fossa.com/api/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0?ref=badge_large)

## Contribuer

Suivez ces étapes pour contribuer ou créer VRCX-0 localement. Veuillez lire
[CONTRIBUTING.md](CONTRIBUTING.md) avant de contribuer.

Configuration requise : Node.js ≥ 24.10, npm ≥ 11.5 et une chaîne d'outils
Rust stable via rustup.
Sur Windows, installez **Visual Studio** avec la charge de travail
**Développement Desktop en C++**

```bash
git clone https://github.com/Map1en/VRCX-0
cd VRCX-0

npm install
```

Démarrer un serveur test :

```bash
npm run tauri:dev
```

Build pour une release (Ignore la connexion et l'installateur) :

```bash
npm run tauri:build -- --no-sign --no-bundle
```
