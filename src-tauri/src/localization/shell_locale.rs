use vrcx_0_i18n::{text as native_text, ShellKey};

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
    use super::{text, ShellKey};

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
            title: text(language, ShellKey::NativeShellMenuAppTitle),
            about: text(language, ShellKey::NativeShellMenuAppAbout),
            settings: text(language, ShellKey::NativeShellMenuAppSettings),
            check_updates: text(language, ShellKey::NativeShellMenuAppCheckUpdates),
            restart: text(language, ShellKey::NativeShellMenuAppRestart),
            start_background_mode: text(language, ShellKey::NativeShellMenuAppStartBackgroundMode),
            logout: text(language, ShellKey::NativeShellMenuAppLogout),
            quit: text(language, ShellKey::NativeShellMenuAppQuit),
        }
    }

    pub(crate) fn view_menu_labels_for_language(language: &str) -> ViewMenuLabels {
        ViewMenuLabels {
            title: text(language, ShellKey::NativeShellMenuViewTitle),
            notification_center: text(language, ShellKey::NativeShellMenuViewNotificationCenter),
            quick_search: text(language, ShellKey::NativeShellMenuViewQuickSearch),
            direct_access: text(language, ShellKey::NativeShellMenuViewDirectAccess),
            toggle_nav: text(language, ShellKey::NativeShellMenuViewToggleNav),
            toggle_friends_sidebar: text(
                language,
                ShellKey::NativeShellMenuViewToggleFriendsSidebar,
            ),
            custom_nav: text(language, ShellKey::NativeShellMenuViewCustomNav),
            themes: text(language, ShellKey::NativeShellMenuViewThemes),
            zoom_in: text(language, ShellKey::NativeShellMenuViewZoomIn),
            zoom_out: text(language, ShellKey::NativeShellMenuViewZoomOut),
            reset_zoom: text(language, ShellKey::NativeShellMenuViewResetZoom),
        }
    }

    pub(crate) fn edit_menu_labels_for_language(language: &str) -> EditMenuLabels {
        EditMenuLabels {
            title: text(language, ShellKey::NativeShellMenuEditTitle),
            undo: text(language, ShellKey::NativeShellMenuEditUndo),
            redo: text(language, ShellKey::NativeShellMenuEditRedo),
            cut: text(language, ShellKey::NativeShellMenuEditCut),
            copy: text(language, ShellKey::NativeShellMenuEditCopy),
            paste: text(language, ShellKey::NativeShellMenuEditPaste),
            select_all: text(language, ShellKey::NativeShellMenuEditSelectAll),
        }
    }

    pub(crate) fn window_menu_labels_for_language(language: &str) -> WindowMenuLabels {
        WindowMenuLabels {
            title: text(language, ShellKey::NativeShellMenuWindowTitle),
            minimize: text(language, ShellKey::NativeShellMenuWindowMinimize),
            maximize: text(language, ShellKey::NativeShellMenuWindowMaximize),
            close_window: text(language, ShellKey::NativeShellMenuWindowClose),
        }
    }

    pub(crate) fn tools_menu_labels_for_language(language: &str) -> ToolsMenuLabels {
        ToolsMenuLabels {
            title: text(language, ShellKey::NativeShellMenuToolsTitle),
            all_tools: text(language, ShellKey::NativeShellMenuToolsAllTools),
        }
    }

    pub(crate) fn help_menu_labels_for_language(language: &str) -> HelpMenuLabels {
        HelpMenuLabels {
            title: text(language, ShellKey::NativeShellMenuHelpTitle),
            changelog: text(language, ShellKey::NativeShellMenuHelpChangelog),
            keyboard_shortcuts: text(language, ShellKey::NativeShellMenuHelpKeyboardShortcuts),
            report_issue: text(language, ShellKey::NativeShellMenuHelpReportIssue),
            github: text(language, ShellKey::NativeShellMenuHelpGithub),
            discord: text(language, ShellKey::NativeShellMenuHelpDiscord),
            qq_group: text(language, ShellKey::NativeShellMenuHelpQqGroup),
            #[cfg(feature = "devtools")]
            open_devtools: text(language, ShellKey::NativeShellMenuHelpOpenDevtools),
            support_vrcx: text(language, ShellKey::NativeShellMenuHelpSupportVrcx),
        }
    }
}

pub(crate) fn tray_labels_for_language(language: &str) -> TrayLabels {
    TrayLabels {
        open: text(language, ShellKey::NativeShellTrayOpen),
        background_mode: text(language, ShellKey::NativeShellTrayBackgroundMode),
        rebuild_ui: text(language, ShellKey::NativeShellTrayRebuildUi),
        disable_theme: text(language, ShellKey::NativeShellTrayDisableTheme),
        exit: text(language, ShellKey::NativeShellTrayExit),
    }
}

pub(crate) fn background_mode_notification_labels_for_language(
    language: &str,
) -> BackgroundModeNotificationLabels {
    BackgroundModeNotificationLabels {
        title: text(
            language,
            ShellKey::NativeShellNotificationBackgroundModeStartedTitle,
        ),
        body: text(
            language,
            ShellKey::NativeShellNotificationBackgroundModeStartedBody,
        ),
    }
}

pub(crate) fn auth_failure_notification_labels_for_language(
    language: &str,
) -> AuthFailureNotificationLabels {
    AuthFailureNotificationLabels {
        title: text(language, ShellKey::NativeShellNotificationAuthFailureTitle),
        body: text(language, ShellKey::NativeShellNotificationAuthFailureBody),
    }
}

fn text(language: &str, key: ShellKey) -> String {
    native_text(language, key)
}
