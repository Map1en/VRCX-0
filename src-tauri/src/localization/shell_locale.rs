use std::sync::OnceLock;

use vrcx_0_i18n::{parse_catalog, Catalog};

const SHELL_STRINGS_JSON: &str = include_str!("shell_strings.json");

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TrayLabels {
    pub(crate) open: String,
    pub(crate) background_mode: String,
    pub(crate) rebuild_ui: String,
    pub(crate) disable_theme: String,
    pub(crate) exit: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BackgroundModeNotificationLabels {
    pub(crate) title: String,
    pub(crate) body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AuthFailureNotificationLabels {
    pub(crate) title: String,
    pub(crate) body: String,
}

#[cfg(target_os = "macos")]
pub(crate) mod macos_menu {
    use super::text;

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub(crate) struct AppMenuLabels {
        pub(crate) title: String,
        pub(crate) about: String,
        pub(crate) settings: String,
        pub(crate) check_updates: String,
        pub(crate) restart: String,
        pub(crate) start_background_mode: String,
        pub(crate) logout: String,
        pub(crate) quit: String,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub(crate) struct ViewMenuLabels {
        pub(crate) title: String,
        pub(crate) notification_center: String,
        pub(crate) quick_search: String,
        pub(crate) direct_access: String,
        pub(crate) toggle_nav: String,
        pub(crate) toggle_friends_sidebar: String,
        pub(crate) custom_nav: String,
        pub(crate) themes: String,
        pub(crate) zoom_in: String,
        pub(crate) zoom_out: String,
        pub(crate) reset_zoom: String,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub(crate) struct EditMenuLabels {
        pub(crate) title: String,
        pub(crate) undo: String,
        pub(crate) redo: String,
        pub(crate) cut: String,
        pub(crate) copy: String,
        pub(crate) paste: String,
        pub(crate) select_all: String,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub(crate) struct WindowMenuLabels {
        pub(crate) title: String,
        pub(crate) minimize: String,
        pub(crate) maximize: String,
        pub(crate) close_window: String,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub(crate) struct ToolsMenuLabels {
        pub(crate) title: String,
        pub(crate) all_tools: String,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub(crate) struct HelpMenuLabels {
        pub(crate) title: String,
        pub(crate) changelog: String,
        pub(crate) keyboard_shortcuts: String,
        pub(crate) report_issue: String,
        pub(crate) github: String,
        pub(crate) discord: String,
        pub(crate) qq_group: String,
        #[cfg(feature = "devtools")]
        pub(crate) open_devtools: String,
        pub(crate) support_vrcx: String,
    }

    pub(crate) fn app_menu_labels_for_language(language: &str) -> AppMenuLabels {
        AppMenuLabels {
            title: text(language, "nativeShell.menu.app.title"),
            about: text(language, "nativeShell.menu.app.about"),
            settings: text(language, "nativeShell.menu.app.settings"),
            check_updates: text(language, "nativeShell.menu.app.checkUpdates"),
            restart: text(language, "nativeShell.menu.app.restart"),
            start_background_mode: text(language, "nativeShell.menu.app.startBackgroundMode"),
            logout: text(language, "nativeShell.menu.app.logout"),
            quit: text(language, "nativeShell.menu.app.quit"),
        }
    }

    pub(crate) fn view_menu_labels_for_language(language: &str) -> ViewMenuLabels {
        ViewMenuLabels {
            title: text(language, "nativeShell.menu.view.title"),
            notification_center: text(language, "nativeShell.menu.view.notificationCenter"),
            quick_search: text(language, "nativeShell.menu.view.quickSearch"),
            direct_access: text(language, "nativeShell.menu.view.directAccess"),
            toggle_nav: text(language, "nativeShell.menu.view.toggleNav"),
            toggle_friends_sidebar: text(language, "nativeShell.menu.view.toggleFriendsSidebar"),
            custom_nav: text(language, "nativeShell.menu.view.customNav"),
            themes: text(language, "nativeShell.menu.view.themes"),
            zoom_in: text(language, "nativeShell.menu.view.zoomIn"),
            zoom_out: text(language, "nativeShell.menu.view.zoomOut"),
            reset_zoom: text(language, "nativeShell.menu.view.resetZoom"),
        }
    }

    pub(crate) fn edit_menu_labels_for_language(language: &str) -> EditMenuLabels {
        EditMenuLabels {
            title: text(language, "nativeShell.menu.edit.title"),
            undo: text(language, "nativeShell.menu.edit.undo"),
            redo: text(language, "nativeShell.menu.edit.redo"),
            cut: text(language, "nativeShell.menu.edit.cut"),
            copy: text(language, "nativeShell.menu.edit.copy"),
            paste: text(language, "nativeShell.menu.edit.paste"),
            select_all: text(language, "nativeShell.menu.edit.selectAll"),
        }
    }

    pub(crate) fn window_menu_labels_for_language(language: &str) -> WindowMenuLabels {
        WindowMenuLabels {
            title: text(language, "nativeShell.menu.window.title"),
            minimize: text(language, "nativeShell.menu.window.minimize"),
            maximize: text(language, "nativeShell.menu.window.maximize"),
            close_window: text(language, "nativeShell.menu.window.close"),
        }
    }

    pub(crate) fn tools_menu_labels_for_language(language: &str) -> ToolsMenuLabels {
        ToolsMenuLabels {
            title: text(language, "nativeShell.menu.tools.title"),
            all_tools: text(language, "nativeShell.menu.tools.allTools"),
        }
    }

    pub(crate) fn help_menu_labels_for_language(language: &str) -> HelpMenuLabels {
        HelpMenuLabels {
            title: text(language, "nativeShell.menu.help.title"),
            changelog: text(language, "nativeShell.menu.help.changelog"),
            keyboard_shortcuts: text(language, "nativeShell.menu.help.keyboardShortcuts"),
            report_issue: text(language, "nativeShell.menu.help.reportIssue"),
            github: text(language, "nativeShell.menu.help.github"),
            discord: text(language, "nativeShell.menu.help.discord"),
            qq_group: text(language, "nativeShell.menu.help.qqGroup"),
            #[cfg(feature = "devtools")]
            open_devtools: text(language, "nativeShell.menu.help.openDevtools"),
            support_vrcx: text(language, "nativeShell.menu.help.supportVrcx"),
        }
    }
}

pub(crate) fn tray_labels_for_language(language: &str) -> TrayLabels {
    TrayLabels {
        open: text(language, "nativeShell.tray.open"),
        background_mode: text(language, "nativeShell.tray.backgroundMode"),
        rebuild_ui: text(language, "nativeShell.tray.rebuildUi"),
        disable_theme: text(language, "nativeShell.tray.disableTheme"),
        exit: text(language, "nativeShell.tray.exit"),
    }
}

pub(crate) fn background_mode_notification_labels_for_language(
    language: &str,
) -> BackgroundModeNotificationLabels {
    BackgroundModeNotificationLabels {
        title: text(
            language,
            "nativeShell.notification.backgroundModeStarted.title",
        ),
        body: text(
            language,
            "nativeShell.notification.backgroundModeStarted.body",
        ),
    }
}

pub(crate) fn auth_failure_notification_labels_for_language(
    language: &str,
) -> AuthFailureNotificationLabels {
    AuthFailureNotificationLabels {
        title: text(language, "nativeShell.notification.authFailure.title"),
        body: text(language, "nativeShell.notification.authFailure.body"),
    }
}

fn text(language: &str, key: &str) -> String {
    catalog().text(language, key, "")
}

fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| parse_catalog(SHELL_STRINGS_JSON, "shell locale catalog"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MACOS_MENU_KEYS: &[&str] = &[
        "nativeShell.menu.app.title",
        "nativeShell.menu.app.about",
        "nativeShell.menu.app.settings",
        "nativeShell.menu.app.checkUpdates",
        "nativeShell.menu.app.restart",
        "nativeShell.menu.app.startBackgroundMode",
        "nativeShell.menu.app.logout",
        "nativeShell.menu.app.quit",
        "nativeShell.menu.view.title",
        "nativeShell.menu.view.notificationCenter",
        "nativeShell.menu.view.quickSearch",
        "nativeShell.menu.view.directAccess",
        "nativeShell.menu.view.toggleNav",
        "nativeShell.menu.view.toggleFriendsSidebar",
        "nativeShell.menu.view.customNav",
        "nativeShell.menu.view.themes",
        "nativeShell.menu.view.zoomIn",
        "nativeShell.menu.view.zoomOut",
        "nativeShell.menu.view.resetZoom",
        "nativeShell.menu.edit.title",
        "nativeShell.menu.edit.undo",
        "nativeShell.menu.edit.redo",
        "nativeShell.menu.edit.cut",
        "nativeShell.menu.edit.copy",
        "nativeShell.menu.edit.paste",
        "nativeShell.menu.edit.selectAll",
        "nativeShell.menu.window.title",
        "nativeShell.menu.window.minimize",
        "nativeShell.menu.window.maximize",
        "nativeShell.menu.window.close",
        "nativeShell.menu.tools.title",
        "nativeShell.menu.tools.allTools",
        "nativeShell.menu.help.title",
        "nativeShell.menu.help.changelog",
        "nativeShell.menu.help.keyboardShortcuts",
        "nativeShell.menu.help.reportIssue",
        "nativeShell.menu.help.github",
        "nativeShell.menu.help.discord",
        "nativeShell.menu.help.qqGroup",
        "nativeShell.menu.help.openDevtools",
        "nativeShell.menu.help.supportVrcx",
    ];
    #[test]
    fn routes_chinese_script_and_region_variants() {
        assert_eq!(
            auth_failure_notification_labels_for_language("zh-Hant").title,
            "VRChat 登入已過期"
        );
        assert_eq!(
            auth_failure_notification_labels_for_language("zh_HK").title,
            "VRChat 登入已過期"
        );
        assert_eq!(
            auth_failure_notification_labels_for_language("zh-Hans").title,
            "VRChat 登录已失效"
        );
    }

    #[test]
    fn unsupported_locale_falls_back_to_english() {
        assert_eq!(tray_labels_for_language("not-real").open, "Open VRCX-0");
    }

    #[test]
    fn includes_macos_menu_labels_for_all_shell_locales() {
        let catalog = catalog();
        for locale in catalog.locales().keys() {
            let values = catalog
                .locales()
                .get(locale)
                .unwrap_or_else(|| panic!("{locale} locale is missing"));
            for key in MACOS_MENU_KEYS {
                let value = values
                    .get(*key)
                    .unwrap_or_else(|| panic!("{locale} is missing {key}"));
                assert!(
                    !value.trim().is_empty(),
                    "{locale} has an empty {key} translation"
                );
                assert_ne!(
                    value.as_str(),
                    *key,
                    "{locale} uses the raw {key} key as text"
                );
            }
        }

        assert_eq!(
            catalog.localized_text("ko", "nativeShell.menu.view.toggleFriendsSidebar"),
            Some("친구 사이드바 전환")
        );
        assert_eq!(
            catalog.localized_text("ko", "nativeShell.menu.help.supportVrcx"),
            Some("VRCX-0 후원")
        );
        assert_eq!(
            catalog.localized_text("cs", "nativeShell.menu.app.about"),
            Some("About VRCX-0")
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn routes_macos_menu_translations() {
        let app_zh_tw = macos_menu::app_menu_labels_for_language("zh-TW");
        assert_eq!(app_zh_tw.about, "關於 VRCX-0");
        assert_eq!(app_zh_tw.title, "VRCX-0");

        let view_ja = macos_menu::view_menu_labels_for_language("ja");
        assert_eq!(view_ja.zoom_in, "拡大");

        let edit_ja = macos_menu::edit_menu_labels_for_language("ja");
        assert_eq!(edit_ja.copy, "コピー");

        let window_zh_cn = macos_menu::window_menu_labels_for_language("zh-CN");
        assert_eq!(window_zh_cn.close_window, "关闭窗口");

        let help_en = macos_menu::help_menu_labels_for_language("en");
        assert_eq!(help_en.discord, "Join our Discord");

        let help_ko = macos_menu::help_menu_labels_for_language("ko");
        assert_eq!(help_ko.title, "도움말");
    }
}
