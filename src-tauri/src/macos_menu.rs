use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager};

const MENU_ACTION_EVENT: &str = "macNativeMenuAction";

pub(crate) fn configure_macos_app_menu(app: &AppHandle) -> tauri::Result<()> {
    let app_menu = SubmenuBuilder::new(app, "VRCX-0")
        .text("mac-menu-about", "About VRCX-0")
        .text("mac-menu-open-source-licenses", "Open Source Licenses")
        .separator()
        .text("mac-menu-settings", "Settings")
        .text("mac-menu-check-updates", "Check for Updates")
        .text("mac-menu-restart", "Restart VRCX-0")
        .text("mac-menu-start-background-mode", "Start Background Mode")
        .separator()
        .text("mac-menu-logout", "Log Out")
        .text("mac-menu-quit", "Quit VRCX-0")
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .text("mac-menu-notification-center", "Notification Center")
        .text("mac-menu-quick-search", "Quick Search")
        .text("mac-menu-direct-access", "Direct Access")
        .separator()
        .text("mac-menu-toggle-left-sidebar", "Toggle Navigation")
        .text("mac-menu-toggle-right-sidebar", "Toggle Side Panel")
        .text("mac-menu-custom-nav", "Customize Navigation")
        .text("mac-menu-themes", "Themes")
        .separator()
        .text("mac-menu-density-standard", "Standard Density")
        .text("mac-menu-density-compact", "Compact Density")
        .separator()
        .text("mac-menu-zoom-in", "Zoom In")
        .text("mac-menu-zoom-out", "Zoom Out")
        .text("mac-menu-reset-zoom", "Reset Zoom")
        .build()?;

    let tools_menu = SubmenuBuilder::new(app, "Tools")
        .text("mac-menu-tools", "All Tools")
        .build()?;

    let mut help_menu = SubmenuBuilder::new(app, "Help")
        .text("mac-menu-github", "GitHub")
        .text("mac-menu-report-issue", "Report Issue")
        .text("mac-menu-discord", "Discord")
        .text("mac-menu-qq-group", "QQ Group")
        .text("mac-menu-changelog", "Changelog");
    #[cfg(feature = "devtools")]
    {
        help_menu = help_menu.separator().text("mac-menu-open-devtools", "Open DevTools");
    }
    let help_menu = help_menu.build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&view_menu)
        .item(&tools_menu)
        .item(&help_menu)
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

pub(crate) fn emit_menu_action(app: &AppHandle, id: &str) -> tauri::Result<()> {
    if let Some(action) = id.strip_prefix("mac-menu-") {
        app.emit(MENU_ACTION_EVENT, serde_json::json!({ "action": action }))?;
    }
    Ok(())
}
