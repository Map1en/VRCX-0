<div align="center">

# <img src="images/VRCX-0.png" alt="VRCX-0 Logo" width="25"> VRCX-0

### The fast, lightweight VRCX.

English | [Français](README.fr-FR.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-Hant.md) | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md)

[![Release](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/version.json&style=flat&color=4c566a&labelColor=1f2328&logo=github&logoColor=white)](https://github.com/Map1en/VRCX-0/releases/latest)
[![Downloads](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/downloads.json&style=flat&color=4c566a&labelColor=1f2328)](https://github.com/Map1en/VRCX-0/releases)
[![Windows installer size](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/windows-installer-size.json&style=flat&label=installer&color=4c566a&labelColor=1f2328&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2ZmZiI%2BPHBhdGggZD0iTTIuNCAyLjRoOC41djguNUgyLjR6TTEzLjEgMi40SDIxLjZ2OC41aC04LjV6TTIuNCAxMy4xaDguNVYyMS42SDIuNHpNMTMuMSAxMy4xSDIxLjZWMjEuNmgtOC41eiIvPjwvc3ZnPg%3D%3D)](https://github.com/Map1en/VRCX-0/releases/latest)
[![Discord](https://img.shields.io/discord/1494343220467994644?style=flat&logo=discord&logoColor=white&label=discord&color=5865f2&labelColor=1f2328)](https://discord.gg/fehKP3SVPN)
<br>
[![CI](https://img.shields.io/github/actions/workflow/status/Map1en/VRCX-0/ci.yml?branch=master&label=ci&style=flat&labelColor=1f2328)](https://github.com/Map1en/VRCX-0/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/coverage.json&style=flat&color=4c566a&labelColor=1f2328)](https://github.com/Map1en/VRCX-0/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-GPL--3.0-4c566a?style=flat&labelColor=1f2328)](LICENSE)

[![Download](https://img.shields.io/badge/Download%20VRCX--0-4340a2?style=for-the-badge)](https://github.com/Map1en/VRCX-0/releases/latest)

Windows · macOS · Linux

![VRCX-0](images/screenshot-user-dialog.webp)

</div>

A desktop companion for VRChat: see where your friends are, keep a history of the people you've met and the worlds you've visited, manage your favorites, and more.

VRCX-0 is a ground-up rewrite of VRCX by one of its former maintainers. Rebuilt in Rust, it's faster and lighter, and years of history stay smooth.

## Highlights

- **Years of history stay smooth** — data that makes VRCX sluggish runs
  smoothly in VRCX-0, even on low-end PCs and home servers
- **About 50%–70% less memory than VRCX**
- **Background mode needs just tens of MB of memory**, with all core features
  still running
- **Smaller than a single avatar bundle** — just over 10 MB to download, just
  over 30 MB installed; less than a tenth the size of VRCX
- **Seamless migration** — imports your VRCX database and settings
  automatically; VRCX's own database is never modified, so you can switch back
  at any time

### Only in VRCX-0

- **Social AI** — insights into your VRChat social life: who you play with
  most, who you're drifting away from, when friends are most likely online;
  just connect the AI service you already use
- **Activity** — look back on each visit on a timeline, with the world, who was
  there, and your screenshots; see the non-friends you keep running into
- **Sidebar Mode** — keep an eye on friends from a narrow sidebar; docks to the
  screen edge and auto-hides on Windows and macOS
- **Desktop Overlay** — a small desktop window of recent notifications for
  desktop-mode players, in place of system notifications; Windows only
- **Pinned worlds** — pin a world to the sidebar to see its public instances
  and which friends are there, and join from right there
- **Keyboard shortcuts** — common actions without the mouse; global hotkey on
  Windows
- **Lock** — lock the interface with a code to protect your privacy
- **Sharing** — share links for world collections, worlds, avatars, and
  instances
- **Game Log import** — fill in the Game Log from VRChat's own logs for times
  VRCX-0 wasn't running

### For advanced users

- **MCP server** — let external AI tools use your local social data directly
- **Integration API** — real-time in-game data for third-party apps
- **Self-hosted Recorder (experimental)** — runs on your own server and keeps
  your Feed recording while VRCX-0 is closed; the gap fills in the next time
  you open it
- **Headless mode** — run without a UI; see `crates/headless`

### Compared with VRCX

| Feature               | VRCX                                                                   | VRCX-0 (+ = added)                                                                        |
| --------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Social automation** | Switch status when alone or with others; auto-reply to invite requests | + Schedules, multiple context rules with priorities, previous status restored             |
| **Notifications**     | Desktop, TTS, XSOverlay, OVR Toolkit, wrist overlay                    | + Desktop Overlay, Discord webhooks, Do Not Disturb; per-event filtering on every channel |
| **VR overlay**        | Browser-rendered (100 MB+); OpenVR                                     | + Native rendering (tens of MB); OpenXR (**tested with WiVRn**)                           |
| Screenshots           | View and search metadata                                               | + Grid view, favorites, batch management, ZIP export                                      |
| Avatar details        | Performance rank and file size                                         | + Full performance stats against each platform's limits                                   |
| Backup                | VRChat registry settings                                               | + Scheduled database backups, one-click restore                                           |
| Friend locations      | Group friends by instance                                              | + Worlds view                                                                             |
| Group management      | Set visibility one group at a time                                     | + Batch leave and batch visibility; group roles in the player list                        |
| Themes                | Built-in themes, custom CSS file                                       | + Community themes, background image, in-app CSS editor, accent color                     |
| Multiple accounts     | Game logs from all accounts mixed together                             | Game log kept per account; play VRChat on another account without affecting this one      |

Everything else VRCX does, VRCX-0 does too.

## Install

Grab the file for your platform from the [latest release](https://github.com/Map1en/VRCX-0/releases/latest):

| Platform              | File                                        |
| --------------------- | ------------------------------------------- |
| Windows               | `VRCX-0_<version>_windows_x86_64_setup.exe` |
| macOS (Apple Silicon) | `VRCX-0_<version>_macos_aarch64.dmg`        |
| macOS (Intel)         | `VRCX-0_<version>_macos_x86_64.dmg`         |
| Linux                 | `.AppImage`, `.deb`, or `.rpm`              |

On macOS, if the first launch is blocked, open **System Settings → Privacy &
Security** and click **Open Anyway**.

### Linux

Hardware acceleration for the app interface is off by default. Turn it on under
**Settings → System → Hardware acceleration (experimental)**; if the interface
doesn't display properly, VRCX-0 turns it back off automatically. Setting
`WEBKIT_DISABLE_DMABUF_RENDERER` yourself hides this option.

## Feedback

- Questions and chat: [Discord](https://discord.gg/fehKP3SVPN)
- Bug reports and feature requests: [GitHub Issues](https://github.com/Map1en/VRCX-0/issues)
- Dev blog: [blog.vrcx-0.dev](https://blog.vrcx-0.dev/en/)

## Building from source

Use these steps to contribute or build VRCX-0 locally. Before contributing, see [CONTRIBUTING.md](CONTRIBUTING.md).

Requirements: Node.js ≥ 24.10, npm ≥ 11.5, and a stable Rust toolchain via rustup.
On Windows, also install **Visual Studio Build Tools** with the **Desktop development with C++** workload.

```bash
git clone https://github.com/Map1en/VRCX-0
cd VRCX-0

npm install
```

Start the dev server:

```bash
npm run tauri:dev
```

Build for release (skip code signing and installer):

```bash
npm run tauri:build -- --no-sign --no-bundle
```

## License

VRCX-0 is licensed under the GNU General Public License v3.0 (GPLv3).

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0?ref=badge_large)

VRCX-0 is not endorsed by VRChat Inc. VRChat and all associated properties are
trademarks or registered trademarks of VRChat Inc.
