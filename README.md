<div align="center">

# <img src="images\VRCX-0.png" alt="VRCX-0 Logo" width="25"> VRCX-0

English | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-Hant.md) | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md)

[![Build](https://img.shields.io/github/actions/workflow/status/Map1en/VRCX-0/ci.yml?branch=master&label=build&style=flat)](https://github.com/Map1en/VRCX-0/actions/workflows/ci.yml)
[![Unit Test](https://img.shields.io/github/actions/workflow/status/Map1en/VRCX-0/ci.yml?branch=master&label=tests&style=flat)](https://github.com/Map1en/VRCX-0/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/coverage.json&style=flat)](https://github.com/Map1en/VRCX-0/actions/workflows/ci.yml)
[![Release](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/version.json&style=flat)](https://github.com/Map1en/VRCX-0/releases/latest)
[![Downloads](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/downloads.json&style=flat)](https://github.com/Map1en/VRCX-0/releases)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue?style=flat)](LICENSE)
[![Discord](https://img.shields.io/discord/1494343220467994644?logo=discord&logoColor=white&label=discord&style=flat)](https://discord.gg/fehKP3SVPN)

### The fast, lightweight VRCX.

</div>

VRCX-0 is a ground-up rewrite of VRCX by one of its former maintainers, rebuilt on a native Rust core (Tauri + React). The most direct payoff of the rewrite is performance: years of accumulated history stay smooth, and both memory usage and install size are far below the original.

On first launch it automatically imports your existing VRCX data and settings. The original data is never modified — you can switch back at any time.

As the upstream VRCX project has shifted toward maintenance, VRCX-0 is where new features are being built.

## Highlights

- **Years of history won't slow it down** — data that makes VRCX visibly
  sluggish stays smooth in VRCX-0; it runs fine even on a potato PC or a home
  server
- **About 50%–70% less memory than VRCX** — **Background mode** drops it to
  just tens of MB while all core features keep running normally
- **Smaller than a single avatar bundle** — just over 10 MB to download, just
  over 30 MB on disk; over 10× smaller than VRCX
- **Zero-friction migration** — your VRCX database and settings import
  automatically; the original data is never modified

Beyond that:

- **Social AI** — a built-in assistant that helps you make sense of your VRChat
  social life: ask who you play with most, who you're drifting away from, or the
  best time to catch friends online. Powered by your own OpenAI-compatible
  endpoint, with local LLMs supported
- **MCP server** — expose your local VRCX-0 social data to MCP-compatible AI
  clients (Claude and others) through a localhost, token-protected server, so you
  can work with it from the tools you already use
- **Social Automation** — auto-switch your status and bio based on time of day,
  instance type, or who you're with; auto-accept invite requests; restores your
  previous state when rules expire
- **Lightweight VR wrist overlay** with minimal performance impact; supports both
  OpenVR (SteamVR) and **OpenXR (Linux / WiVRn / Monado)**
- **Community Themes** — browse and install themes from a catalog, set a custom
  background image, and layer your own CSS on top
- **Four notification channels** — desktop notifications, text-to-speech, VR
  overlay alerts, and webhooks, each independently configured per event type
- **Webhook notifications** — forward events to any webhook URL with a
  Discord-compatible payload; choose exactly which fields to send
- Full keyboard navigation
- Headless mode for advanced setups — see `crates/headless`

## Data Migration

On first launch, VRCX-0 can automatically import your existing VRCX database and settings. Your original data is never modified — existing users can pick up right where they left off without any manual setup.

## License

The initial commit of this repository corresponds to the upstream VRCX snapshot at the time of the fork and is licensed under the MIT License.

All modifications, additions, rewrites, and new code introduced after the fork are licensed under the GNU General Public License v3.0 (GPLv3).

## Development

Requirements: Node.js ≥ 24.10, npm ≥ 11.5, and a stable Rust toolchain via rustup.
On Windows, also install **Visual Studio Build Tools** with the **Desktop development with C++** workload.

```bash
git clone https://github.com/Map1en/VRCX-0
cd VRCX-0

npm install
npm run tauri:dev
```
