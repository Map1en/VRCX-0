## 2026.04.07-beta.1

- Migrate from C# WebView2 to Tauri.
- Most core features are working. Some system-level integrations still need further testing.

## 2026.04.05-beta.1

First version after forking from VRCX.
This is not a testing build, but the initial release after refactoring.
No extensive testing yet, but core functionality appears to work.
Some texts and resources still need to be updated, will be addressed in a future version.

- Change license: pre-fork code remains MIT, new code and future changes are GPLv3
- Remove CEF, switch to WebView2
- Remove Linux and macOS support
- Remove VR Overlay, keep XSOverlay and OVR Toolkit HUD notification support
