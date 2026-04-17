# Changelog

## 2026.04.09

This is a personal fork of VRCX that I maintain independently after leaving the main project. Development will continue on this branch.

- Significantly reduced size (around 1/10 of the original VRCX).
- Significantly reduced memory usage.
- Support for custom installation paths.
- Automatically migrate database from VRCX.
- Remove VROverlay support.
- Remove Linux and macOS support.
- These features may return in the future, but are currently not included due to development complexity.

### Features (compared to VRCX 2026.02.11)

#### Dashboard

- Add Dashboard with customizable multi-panel layout and three compact widget panels.

#### Status Bar

- Add status bar showing VRChat server status, tracking game sessions, and including a customizable time zone clock.

#### Avatars

- Add My Avatars page with grid and table views for managing avatars.

#### Social Status

- Add social status presets with saving and selecting in the Social Status dialog.
- Allow switching social status presets from the sidebar Me right-click menu.

#### User Dialog

- Add Activity tab to view activity statistics and overlap data.

#### Sidebar

- Add Quick Search to the top of the sidebar (Ctrl + K / Command + K) for friends, memos, notes, worlds, avatars, and groups.
- Add Notification Center at the top of the sidebar; the old Notifications page is hidden by default and can be re-enabled in Settings.
- Add reordering support for favorite friend groups.
- Add context menus to sidebar friend and profile items for quick access to related actions.

#### Favorites

- Add Local Favorite Friends groups, allowing a single friend to belong to multiple groups.

#### Data Tables

- Save sort state.
- Support column reordering via drag and drop.
- Support column visibility configuration via header right-click.
- Add independent pagination settings per table.

#### Mutual Friends Graph

- Add navigation selector to jump to a specific friend.
- Add community separation settings.
- Save history data.
- Add node context menu with actions to refresh individual friend data and hide individual friends.
- Allow hiding specific friends via top-right settings.

#### Image Uploader

- Add cropper with support for rotate, flip, and crop before upload.

#### Auto Status & Invites

- Add automatic status description updates based on the current instance.

#### Login

- Add language selection to the login screen.
- Add update indicator to the login screen.

#### Feed

- Add date filter for filtering results by date range.

#### Previous Instance

- Add Charts view to the Previous Instance dialog.

#### Tools

- Allow pinning tools to the navigation menu.

#### Onboarding

- Add onboarding dialog for first-time users.
- Add suggested language selection during onboarding.

#### Context Menu

- Add right-click context menus in various places.

#### UI

- Add new CJK font.
- Add support for custom `font-family`.

#### Database

- Add database cleanup tool for avatar change logs with scheduled and one-time cleanup.

---

### Changes (compared to VRCX 2026.02.11)

#### Sidebar

- Improve display for favorite friends.
- Move sidebar-related settings from the Settings page to the top of the sidebar.

#### Auto Change Status

- Rewrite Auto Change Status.
- Separate features and add support for local favorite friend groups.
- Store filtering groups independently.

#### Invite

- Allow adding favorite friends by group in the Invite dialog.

#### UI

- Use circle status indicators by default.
- Disable accessible status indicators by default (configurable in Settings).
