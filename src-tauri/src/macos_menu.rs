use crate::localization::shell_locale::macos_menu;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter};

const MENU_ACTION_EVENT: &str = "macNativeMenuAction";

pub(crate) fn configure_macos_app_menu(app: &AppHandle, language: &str) -> tauri::Result<()> {
    let app_i18n = macos_menu::app_menu_labels_for_language(language);
    let quit_item = MenuItemBuilder::with_id("mac-menu-quit", app_i18n.quit)
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, app_i18n.title)
        .text("mac-menu-about", app_i18n.about)
        .separator()
        .text("mac-menu-settings", app_i18n.settings)
        .text("mac-menu-check-updates", app_i18n.check_updates)
        .text("mac-menu-restart", app_i18n.restart)
        .text(
            "mac-menu-start-background-mode",
            app_i18n.start_background_mode,
        )
        .separator()
        .text("mac-menu-logout", app_i18n.logout)
        .item(&quit_item)
        .build()?;

    let edit_i18n = macos_menu::edit_menu_labels_for_language(language);
    let edit_menu = SubmenuBuilder::new(app, edit_i18n.title)
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_i18n = macos_menu::view_menu_labels_for_language(language);
    let view_menu = SubmenuBuilder::new(app, view_i18n.title)
        .text(
            "mac-menu-notification-center",
            view_i18n.notification_center,
        )
        .text("mac-menu-quick-search", view_i18n.quick_search)
        .text("mac-menu-direct-access", view_i18n.direct_access)
        .separator()
        .text("mac-menu-toggle-nav", view_i18n.toggle_nav)
        .text(
            "mac-menu-toggle-friends-sidebar",
            view_i18n.toggle_friends_sidebar,
        )
        .text("mac-menu-custom-nav", view_i18n.custom_nav)
        .text("mac-menu-themes", view_i18n.themes)
        .separator()
        .text("mac-menu-zoom-in", view_i18n.zoom_in)
        .text("mac-menu-zoom-out", view_i18n.zoom_out)
        .text("mac-menu-reset-zoom", view_i18n.reset_zoom)
        .build()?;

    let tools_i18n = macos_menu::tools_menu_labels_for_language(language);
    let tools_menu = SubmenuBuilder::new(app, tools_i18n.title)
        .text("mac-menu-tools", tools_i18n.all_tools)
        .build()?;

    let window_i18n = macos_menu::window_menu_labels_for_language(language);
    let window_menu = SubmenuBuilder::new(app, window_i18n.title)
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    let help_i18n = macos_menu::help_menu_labels_for_language(language);
    let help_menu = SubmenuBuilder::new(app, help_i18n.title)
        .text("mac-menu-changelog", help_i18n.changelog)
        .text("mac-menu-keyboard-shortcuts", help_i18n.keyboard_shortcuts)
        .separator()
        .text("mac-menu-report-issue", help_i18n.report_issue)
        .separator()
        .text("mac-menu-github", help_i18n.github)
        .text("mac-menu-discord", help_i18n.discord)
        .text("mac-menu-qq-group", help_i18n.qq_group);
    #[cfg(feature = "devtools")]
    let help_menu = help_menu
        .separator()
        .text("mac-menu-open-devtools", help_i18n.open_devtools);
    let help_menu = help_menu
        .separator()
        .text("mac-menu-support-vrcx", help_i18n.support_vrcx)
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&tools_menu)
        .item(&window_menu)
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
