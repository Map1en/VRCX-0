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

VRCX-0 is a ground-up rewrite of VRCX by one of its former maintainers, with a Rust backend (Tauri + React) and significantly improved performance: years of accumulated history stay smooth, and both memory usage and install size are far below the original.

On first launch it automatically imports your existing VRCX data and settings. The original data is never modified — you can switch back at any time.

VRCX is a mature, stable release; VRCX-0 is where new features are being built.

## Install

Grab the file for your platform from the [latest release](https://github.com/Map1en/VRCX-0/releases/latest):

| Platform              | File                                        |
| --------------------- | ------------------------------------------- |
| Windows               | `VRCX-0_<version>_windows_x86_64_setup.exe` |
| macOS (Apple Silicon) | `VRCX-0_<version>_macos_aarch64.dmg`        |
| macOS (Intel)         | `VRCX-0_<version>_macos_x86_64.dmg`         |
| Linux                 | `.AppImage`, `.deb`, or `.rpm`              |

You only need to do this once — VRCX-0 updates itself from then on.

On Linux, **Settings → System → Hardware acceleration (experimental)** is off
by default and applies after a restart. After enabling, confirm that the interface
works within 30 seconds of startup; otherwise acceleration is turned off and
VRCX-0 restarts. If the application crashes or is forcibly closed before
confirmation, the next launch also starts with acceleration off. Setting
`WEBKIT_DISABLE_DMABUF_RENDERER` yourself hides the option and leaves the
rendering mode entirely to your environment.

## Highlights

- **Years of history won't slow it down** — data that makes VRCX visibly
  sluggish stays smooth in VRCX-0; it runs fine even on a potato PC or a home
  server
- **About 50%–70% less memory than VRCX** in normal use
- **Background mode** brings memory down to just tens of MB while all core
  features keep running
- **Smaller than a single avatar bundle** — just over 10 MB to download, just
  over 30 MB on disk; over 10× smaller than VRCX
- **Zero-friction migration** — your VRCX database and settings import
  automatically; the original data is never modified

### Only in VRCX-0

- **Social AI** — make sense of your VRChat life: ask who you play with most,
  who you're drifting away from, or the best time to catch friends online.
  Connect your own AI service to get started
- **Sidebar Mode** — keep an eye on your friends from a narrow sidebar while
  you do something else, instead of switching back to a full window; on Windows
  and macOS it can dock to a screen edge and auto-hide
- **Keyboard shortcuts and global hotkey** — switch pages, open Settings, and
  move between tabs without touching the mouse; on Windows, a global hotkey
  shows or hides VRCX-0 from inside any application
- **Shareable world collections** — turn your favorite worlds into a shareable
  page others can browse, open, or import; also supports share links for
  individual worlds and avatars
- **MCP server** — let external AI tools access your local social data directly,
  far more flexible than Social AI; recommended for advanced users
- **Integration API** — real-time room data for third-party apps while
  in-game, expanding over time
- **Headless mode** — for advanced setups; see `crates/headless`

### Compared with VRCX

| Feature               | VRCX                                                                                                                              | VRCX-0 (+ = added)                                                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Social automation** | Switch status and status message when alone or with company (optionally limited to instance types); auto-reply to invite requests | + Schedule rules (time of day, weekdays), multiple context rules (friends present, player count, instance type, favorite worlds, **with priorities**), **previous status restored when a rule ends** |
| **Notifications**     | Desktop, TTS, XSOverlay, OVR Toolkit, wrist overlay (channels support different events; only the overlay filters by event)        | + **Discord-compatible webhooks**, Do Not Disturb; every channel supports the same events, each filtered independently                                                                               |
| **VR overlay**        | Wrist and HMD, browser-rendered (100 MB+ of memory); OpenVR                                                                       | + OpenXR (**tested with WiVRn**); native rendering (tens of MB)                                                                                                                                      |
| Screenshots           | View and search metadata                                                                                                          | + Grid view, multi-select, batch delete, ZIP export                                                                                                                                                  |
| Avatar details        | Performance rank and file size                                                                                                    | + Triangles, texture memory, materials, bones, PhysBones, particles, colliders (against each platform's limits)                                                                                      |
| Backup                | VRChat registry settings                                                                                                          | + Scheduled database backups, multiple versions, one-click restore                                                                                                                                   |
| Group management      | Reorder in your profile; set visibility one group at a time                                                                       | + My Groups page (batch leave, batch visibility)                                                                                                                                                     |
| Themes                | Built-in themes, custom CSS (from a file on disk)                                                                                 | + Community theme catalog, background image, in-app CSS editor, accent color                                                                                                                         |
| Game log              | All accounts mixed together                                                                                                       | Stored per account                                                                                                                                                                                   |

Everything else VRCX does, VRCX-0 does too.

## License

VRCX-0 is licensed under the GNU General Public License v3.0 (GPLv3).

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0?ref=badge_large)

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
