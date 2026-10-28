export const SETTINGS_TABS = [
    ['system', 'view.settings.category.system'],
    ['interface', 'view.settings.category.interface'],
    ['social', 'view.settings.category.social'],
    ['notifications', 'view.settings.category.notifications'],
    ['vr', 'view.settings.category.vr'],
    ['media', 'view.settings.category.media'],
    ['ai', 'view.settings.category.ai'],
    ['integrations', 'view.settings.category.integrations'],
    ['advanced', 'view.settings.category.advanced'],
    ['feedback', 'view.settings.category.feedback']
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number][0];

export type SettingsCardDefinition = {
    id: string;
    tab: SettingsTabId;
    titleKey: string;
};

export type SettingsHostPlatform = 'windows' | 'macos' | 'linux';

export type SettingsRuntimeRequirement =
    | 'game-log-ingest'
    | 'update-check-disabled-build'
    | 'update-check-enabled-build';

export type SettingsAvailabilityContext = {
    platform: string;
    gameLogIngest: boolean;
    updateCheckDisabledBuild: boolean;
};

export type SettingsManifestEntry = {
    id: string;
    tab: SettingsTabId;
    cardId: string;
    labelKey: string;
    descriptionKey?: string;
    dependsOn?: string;
    requiresRestart?: boolean;
    prefKey?: string;
    platforms?: readonly SettingsHostPlatform[];
    requires?: SettingsRuntimeRequirement;
    platformLabelKeys?: Partial<Record<SettingsHostPlatform, string>>;
};

type SettingDraft = Omit<SettingsManifestEntry, 'id' | 'tab' | 'cardId'> & {
    key: string;
};

const cards: SettingsCardDefinition[] = [];
const entries: SettingsManifestEntry[] = [];

function defineCard(
    tab: SettingsTabId,
    cardKey: string,
    titleKey: string,
    settings: SettingDraft[]
) {
    const cardId = `${tab}.${cardKey}`;
    cards.push({ id: cardId, tab, titleKey });
    for (const { key, dependsOn, ...rest } of settings) {
        entries.push({
            id: `${cardId}.${key}`,
            tab,
            cardId,
            ...rest,
            ...(dependsOn ? { dependsOn: `${cardId}.${dependsOn}` } : {})
        });
    }
}

defineCard(
    'system',
    'startup',
    'view.settings.general.application.startup_header',
    [
        {
            key: 'start-at-login',
            labelKey: 'view.settings.general.application.startup',
            platformLabelKeys: {
                macos: 'view.settings.general.application.startup_system',
                linux: 'view.settings.general.application.startup_system'
            },
            prefKey: 'isStartAtWindowsStartup'
        },
        {
            key: 'start-minimized',
            labelKey: 'view.settings.general.application.minimized',
            prefKey: 'isStartAsMinimizedState'
        }
    ]
);

defineCard(
    'system',
    'window',
    'view.settings.general.application.window_header',
    [
        {
            key: 'close-to-tray',
            labelKey: 'view.settings.general.application.tray',
            descriptionKey:
                'view.settings.general.application.tray_description',
            prefKey: 'isCloseToTray'
        },
        {
            key: 'tray-shortcut',
            labelKey: 'shortcuts.tray.title'
        },
        {
            key: 'privacy-lock',
            labelKey: 'privacy_lock.settings.label',
            descriptionKey: 'privacy_lock.settings.description'
        },
        {
            key: 'linux-rendering',
            labelKey: 'linux_rendering.title',
            platforms: ['linux'],
            descriptionKey: 'linux_rendering.description',
            requiresRestart: true
        },
        {
            key: 'background-mode',
            labelKey: 'view.settings.general.application.background_mode',
            descriptionKey:
                'view.settings.general.application.background_mode_description',
            prefKey: 'backgroundModeEnabled'
        },
        {
            key: 'background-mode-delay',
            labelKey: 'view.settings.general.application.background_mode_delay',
            descriptionKey:
                'view.settings.general.application.background_mode_delay_description',
            prefKey: 'backgroundModeDelayEnabled'
        },
        {
            key: 'background-mode-delay-minutes',
            labelKey:
                'view.settings.general.application.background_mode_delay_button',
            dependsOn: 'background-mode-delay',
            prefKey: 'backgroundModeDelayMinutes'
        },
        {
            key: 'system-window-frame',
            labelKey: 'view.settings.general.application.system_window_frame',
            platforms: ['windows'],
            descriptionKey:
                'view.settings.general.application.system_window_frame_description',
            requiresRestart: true,
            prefKey: 'systemWindowFrame'
        }
    ]
);

defineCard(
    'system',
    'vrchat',
    'view.settings.advanced.advanced_ui.behavior.header',
    [
        {
            key: 'relaunch-after-crash',
            labelKey: 'view.settings.advanced.advanced.relaunch_vrchat.header',
            descriptionKey:
                'view.settings.advanced.advanced.relaunch_vrchat.description',
            prefKey: 'relaunchVRChatAfterCrash'
        },
        {
            key: 'quit-fix',
            labelKey: 'view.settings.advanced.advanced_ui.behavior.quit_header',
            descriptionKey:
                'view.settings.advanced.advanced_ui.behavior.quit_description',
            prefKey: 'vrcQuitFix'
        },
        {
            key: 'focus-on-join',
            platforms: ['windows'],
            labelKey:
                'view.settings.advanced.advanced_ui.behavior.focus_on_join_header',
            descriptionKey:
                'view.settings.advanced.advanced_ui.behavior.focus_on_join_description',
            prefKey: 'focusVrchatOnJoin'
        }
    ]
);

defineCard(
    'system',
    'updates',
    'view.settings.general.application.updates_header',
    [
        {
            key: 'update-check-disabled',
            requires: 'update-check-disabled-build',
            labelKey:
                'view.settings.general.application.check_for_updates_and_update',
            descriptionKey:
                'view.settings.general.application.update_check_disabled_build_description'
        },
        {
            key: 'auto-install',
            requires: 'update-check-enabled-build',
            labelKey:
                'view.settings.general.application.auto_install_updates_on_startup',
            descriptionKey:
                'view.settings.general.application.auto_install_updates_on_startup_description',
            prefKey: 'autoInstallUpdatesOnStartup'
        },
        {
            key: 'changelog-prompt',
            labelKey:
                'view.settings.notifications.notifications.post_update_changelog_prompt',
            descriptionKey:
                'view.settings.notifications.notifications.post_update_changelog_prompt_description',
            prefKey: 'showPostUpdateChangelogToast'
        }
    ]
);

defineCard(
    'system',
    'network',
    'view.settings.general.application.network_header',
    [
        {
            key: 'auto-login-delay',
            labelKey: 'view.settings.general.logging.auto_login_delay',
            prefKey: 'autoLoginDelayEnabled'
        },
        {
            key: 'auto-login-delay-seconds',
            labelKey: 'view.settings.general.logging.auto_login_delay_button',
            dependsOn: 'auto-login-delay',
            prefKey: 'autoLoginDelaySeconds'
        },
        {
            key: 'proxy',
            labelKey: 'view.settings.general.application.proxy',
            requiresRestart: true,
            prefKey: 'proxyEnabled'
        }
    ]
);

defineCard(
    'interface',
    'appearance',
    'view.settings.appearance.appearance.header',
    [
        {
            key: 'language',
            labelKey: 'view.settings.appearance.appearance.language'
        },
        {
            key: 'font-family',
            labelKey: 'view.settings.appearance.appearance.font_family',
            descriptionKey:
                'view.settings.appearance.appearance.font_family_description'
        },
        {
            key: 'zoom',
            labelKey: 'view.settings.appearance.appearance.zoom'
        },
        {
            key: 'table-density',
            labelKey: 'view.settings.appearance.appearance.table_density',
            prefKey: 'tableDensity'
        },
        {
            key: 'striped-tables',
            labelKey:
                'view.settings.appearance.appearance.striped_data_table_mode',
            prefKey: 'dataTableStriped'
        },
        {
            key: 'reduced-motion',
            labelKey:
                'view.settings.appearance.appearance.reduced_motion_and_blur',
            descriptionKey:
                'view.settings.appearance.appearance.reduced_motion_and_blur_description',
            prefKey: 'reducedMotionAndBlur'
        },
        {
            key: 'accessible-status',
            labelKey:
                'view.settings.appearance.appearance.accessible_status_indicators',
            descriptionKey:
                'view.settings.appearance.appearance.accessible_status_indicators_description',
            prefKey: 'accessibleStatusIndicators'
        }
    ]
);

defineCard(
    'interface',
    'profile-appearance',
    'view.settings.appearance.profile_appearance.header',
    [
        {
            key: 'user-dialog',
            labelKey: 'view.settings.appearance.user_dialog.header'
        },
        {
            key: 'hover-card',
            labelKey: 'view.settings.appearance.profile_appearance.hover_card'
        },
        {
            key: 'sidebar',
            labelKey: 'view.settings.appearance.profile_appearance.sidebar'
        },
        {
            key: 'friends-locations-people',
            labelKey: 'view.friends_locations.view_people'
        },
        {
            key: 'friends-locations-worlds',
            labelKey: 'view.friends_locations.view_worlds'
        },
        {
            key: 'activity-journey',
            labelKey: 'view.activity.mode.journey'
        }
    ]
);

defineCard('interface', 'display', 'view.settings.appearance.display.header', [
    {
        key: 'show-instance-id',
        labelKey: 'view.settings.appearance.appearance.show_instance_id',
        prefKey: 'showInstanceIdInLocation'
    },
    {
        key: 'age-gated-instances',
        labelKey: 'view.settings.appearance.appearance.age_gated_instances',
        descriptionKey:
            'view.settings.appearance.appearance.age_gated_instances_description',
        prefKey: 'isAgeGatedInstancesVisible'
    }
]);

defineCard(
    'interface',
    'navigation',
    'view.settings.interface.navigation.header',
    [
        {
            key: 'new-dashboard-button',
            labelKey:
                'view.settings.interface.navigation.show_new_dashboard_button',
            prefKey: 'showNewDashboardButton'
        }
    ]
);

defineCard(
    'interface',
    'tables',
    'view.settings.interface.lists_tables.header',
    [
        {
            key: 'page-sizes',
            labelKey: 'view.settings.appearance.appearance.table_page_sizes'
        },
        {
            key: 'entry-limits',
            labelKey:
                'view.settings.appearance.appearance.table_entries_settings',
            descriptionKey:
                'view.settings.appearance.appearance.table_entries_settings_description'
        }
    ]
);

defineCard(
    'interface',
    'time-date',
    'view.settings.appearance.timedate.header',
    [
        {
            key: 'time-format',
            labelKey: 'view.settings.appearance.timedate.time_format',
            prefKey: 'dtHour12'
        },
        {
            key: 'iso-date',
            labelKey: 'view.settings.appearance.timedate.force_iso_date_format',
            prefKey: 'dtIsoFormat'
        },
        {
            key: 'week-start',
            labelKey: 'view.settings.appearance.timedate.week_starts_on',
            descriptionKey:
                'view.settings.appearance.timedate.week_starts_on_description',
            prefKey: 'weekStartsOn'
        },
        {
            key: 'feed-time-display',
            labelKey: 'view.settings.appearance.timedate.feed_time_display',
            prefKey: 'feedTimeDisplayMode'
        }
    ]
);

defineCard(
    'interface',
    'user-colors',
    'view.settings.appearance.user_colors.header',
    [
        {
            key: 'random-colors',
            labelKey:
                'view.settings.appearance.user_colors.random_colors_from_user_id',
            descriptionKey:
                'view.settings.appearance.user_colors.random_colors_from_user_id_description',
            prefKey: 'randomUserColours'
        },
        {
            key: 'random-color-style',
            labelKey: 'view.settings.appearance.user_colors.random_color_style',
            dependsOn: 'random-colors',
            prefKey: 'randomUserColourStyle'
        }
    ]
);

defineCard(
    'interface',
    'user-dialog',
    'view.settings.appearance.user_dialog.header',
    [
        {
            key: 'nicknames',
            labelKey: 'view.settings.appearance.appearance.nicknames',
            descriptionKey:
                'view.settings.appearance.appearance.nicknames_description',
            prefKey: 'hideNicknames'
        },
        {
            key: 'vrchat-notes',
            labelKey: 'view.settings.appearance.user_dialog.vrchat_notes',
            descriptionKey:
                'view.settings.appearance.user_dialog.vrchat_notes_description',
            prefKey: 'hideUserNotes'
        },
        {
            key: 'memos',
            labelKey: 'view.settings.appearance.user_dialog.vrcx_memos',
            descriptionKey:
                'view.settings.appearance.user_dialog.vrcx_memos_description',
            prefKey: 'hideUserMemos'
        }
    ]
);

defineCard('social', 'interaction', 'view.settings.social.interaction.header', [
    {
        key: 'recent-action-cooldown',
        labelKey: 'view.settings.appearance.user_dialog.recent_action_cooldown',
        descriptionKey:
            'view.settings.appearance.user_dialog.recent_action_cooldown_description',
        prefKey: 'recentActionCooldownEnabled'
    },
    {
        key: 'auto-decline-friend-requests',
        labelKey:
            'view.settings.social.interaction.auto_decline_friend_requests',
        descriptionKey:
            'view.settings.social.interaction.auto_decline_friend_requests_description',
        prefKey: 'autoDeclineFriendRequests'
    }
]);

defineCard(
    'social',
    'friend-log',
    'view.settings.appearance.friend_log.header',
    [
        {
            key: 'hide-unfriends',
            labelKey: 'view.settings.appearance.friend_log.hide_unfriends',
            prefKey: 'hideUnfriends'
        }
    ]
);

defineCard('social', 'friend-bios', 'view.settings.social.friend_bios.header', [
    {
        key: 'keep-up-to-date',
        labelKey: 'view.settings.social.friend_bios.keep_up_to_date',
        descriptionKey: 'view.settings.social.friend_bios.description',
        prefKey: 'profileBioScanEnabled'
    }
]);

defineCard('social', 'hidden-feed', 'view.settings.social.hidden_feed.header', [
    {
        key: 'users',
        labelKey: 'view.settings.social.hidden_feed.add',
        descriptionKey: 'view.settings.social.hidden_feed.description'
    },
    {
        key: 'hide-all',
        labelKey: 'view.settings.social.hidden_feed.hide_all',
        descriptionKey: 'view.settings.social.hidden_feed.hide_all_description',
        prefKey: 'feedHiddenUsersHideAll'
    },
    {
        key: 'hide-notifications',
        labelKey: 'view.settings.social.hidden_feed.hide_notifications',
        descriptionKey:
            'view.settings.social.hidden_feed.hide_notifications_description',
        prefKey: 'feedHiddenUsersHideNotifications'
    },
    {
        key: 'hide-private-location-changes',
        labelKey:
            'view.settings.social.hidden_feed.hide_private_location_changes',
        descriptionKey:
            'view.settings.social.hidden_feed.hide_private_location_changes_description',
        prefKey: 'hidePrivateFromFeed'
    }
]);

defineCard('social', 'favorites', 'view.settings.social.favorites.header', [
    {
        key: 'local-friend-groups',
        labelKey: 'view.settings.general.favorites.header',
        descriptionKey: 'view.settings.general.favorites.header_tooltip'
    }
]);

defineCard(
    'notifications',
    'in-app',
    'view.settings.notifications.notifications.in_app.header',
    [
        {
            key: 'layout',
            labelKey: 'view.settings.notifications.notifications.layout',
            prefKey: 'notificationLayout'
        },
        {
            key: 'icon-dot',
            labelKey:
                'view.settings.appearance.appearance.show_notification_icon_dot',
            prefKey: 'notificationIconDot'
        },
        {
            key: 'taskbar-dot',
            platforms: ['windows'],
            labelKey:
                'view.settings.appearance.appearance.show_taskbar_icon_dot',
            descriptionKey:
                'view.settings.appearance.appearance.show_taskbar_icon_dot_description',
            prefKey: 'taskbarIconDot'
        },
        {
            key: 'friend-log-dot',
            labelKey:
                'view.settings.appearance.friend_log.show_notification_dot',
            prefKey: 'friendLogNotificationDot'
        }
    ]
);

defineCard(
    'notifications',
    'dnd',
    'view.settings.notifications.notifications.do_not_disturb.header',
    [
        {
            key: 'end-on-game-start',
            labelKey:
                'view.settings.notifications.notifications.do_not_disturb.end_on_game_start',
            descriptionKey:
                'view.settings.notifications.notifications.do_not_disturb.end_on_game_start_description',
            prefKey: 'notificationDoNotDisturbEndOnGameStart'
        },
        {
            key: 'busy-status',
            labelKey:
                'view.settings.notifications.notifications.do_not_disturb.busy_status',
            descriptionKey:
                'view.settings.notifications.notifications.do_not_disturb.busy_status_description',
            prefKey: 'busyStatusDoNotDisturb'
        },
        {
            key: 'hide-video-errors',
            labelKey:
                'view.settings.notifications.notifications.do_not_disturb.hide_video_errors',
            descriptionKey:
                'view.settings.notifications.notifications.do_not_disturb.hide_video_errors_description',
            prefKey: 'hideVideoErrorNotifications'
        }
    ]
);

defineCard(
    'notifications',
    'desktop',
    'view.settings.notifications.notifications.desktop_notifications.header',
    [
        {
            key: 'when-to-display',
            labelKey:
                'view.settings.notifications.notifications.desktop_notifications.when_to_display',
            prefKey: 'desktopToast'
        },
        {
            key: 'filters',
            labelKey:
                'view.settings.notifications.notifications.desktop_notifications.notification_filters'
        },
        {
            key: 'while-afk',
            labelKey:
                'view.settings.notifications.notifications.desktop_notifications.desktop_notification_while_afk',
            prefKey: 'afkDesktopToast'
        },
        {
            key: 'sound',
            labelKey:
                'view.settings.notifications.notifications.desktop_notifications.notification_sound',
            prefKey: 'desktopNotificationSound'
        },
        {
            key: 'friend-icons',
            labelKey:
                'view.settings.notifications.notifications.desktop_notifications.friend_icons',
            prefKey: 'desktopNotificationAvatars'
        }
    ]
);

defineCard(
    'notifications',
    'desktop_widget',
    'view.settings.notifications.notifications.desktop_widget.header',
    [
        {
            key: 'opacity',
            labelKey:
                'view.settings.notifications.notifications.desktop_widget.background_opacity',
            prefKey: 'desktopWidgetOpacity'
        },
        {
            key: 'order',
            labelKey:
                'view.settings.notifications.notifications.desktop_widget.order',
            prefKey: 'desktopWidgetNewestOnTop'
        },
        {
            key: 'filters',
            labelKey:
                'view.settings.notifications.notifications.desktop_widget.activity_filters'
        }
    ]
);

defineCard(
    'notifications',
    'tts',
    'view.settings.notifications.notifications.text_to_speech.header',
    [
        {
            key: 'when-to-play',
            labelKey:
                'view.settings.notifications.notifications.text_to_speech.when_to_play',
            prefKey: 'notificationTTS'
        },
        {
            key: 'voice',
            labelKey:
                'view.settings.notifications.notifications.text_to_speech.tts_voice'
        },
        {
            key: 'volume',
            labelKey:
                'view.settings.notifications.notifications.text_to_speech.tts_volume',
            prefKey: 'notificationTTSVolume'
        },
        {
            key: 'filters',
            labelKey:
                'view.settings.notifications.notifications.text_to_speech.notification_filters'
        },
        {
            key: 'name-mode',
            labelKey:
                'view.settings.notifications.notifications.text_to_speech.name_mode',
            prefKey: 'notificationTTSNameMode'
        },
        {
            key: 'test',
            labelKey:
                'view.settings.notifications.notifications.text_to_speech.tts_test_placeholder'
        }
    ]
);

defineCard(
    'notifications',
    'webhook',
    'view.settings.notifications.notifications.webhook.header',
    [
        {
            key: 'enabled',
            labelKey:
                'view.settings.notifications.notifications.webhook.enabled',
            prefKey: 'webhookEnabled'
        },
        {
            key: 'auth-events',
            labelKey:
                'view.settings.notifications.notifications.webhook.auth_events_enabled',
            descriptionKey:
                'view.settings.notifications.notifications.webhook.auth_events_description',
            prefKey: 'webhookAuthEventsEnabled'
        },
        {
            key: 'url',
            labelKey: 'view.settings.notifications.notifications.webhook.url'
        },
        {
            key: 'format',
            labelKey:
                'view.settings.notifications.notifications.webhook.format',
            prefKey: 'webhookFormat'
        },
        {
            key: 'fields',
            labelKey:
                'view.settings.notifications.notifications.webhook.fields',
            descriptionKey:
                'view.settings.notifications.notifications.webhook.fields_description'
        },
        {
            key: 'filters',
            labelKey:
                'view.settings.notifications.notifications.webhook.notification_filters',
            dependsOn: 'enabled'
        },
        {
            key: 'send-test',
            labelKey:
                'view.settings.notifications.notifications.webhook.send_test'
        },
        {
            key: 'delivery-status',
            labelKey:
                'view.settings.notifications.notifications.webhook.delivery_status'
        }
    ]
);

defineCard(
    'notifications',
    'test',
    'view.settings.notifications.notifications.test_notification.header',
    [
        {
            key: 'send',
            labelKey:
                'view.settings.notifications.notifications.test_notification.send'
        }
    ]
);

defineCard(
    'vr',
    'notifications',
    'view.settings.notifications.notifications.vr_notifications.header',
    [
        {
            key: 'when-to-display',
            labelKey:
                'view.settings.notifications.notifications.vr_notifications.when_to_display',
            descriptionKey:
                'view.settings.notifications.notifications.vr_notifications.when_to_display_description',
            prefKey: 'overlayToast'
        },
        {
            key: 'xsoverlay',
            labelKey:
                'view.settings.notifications.notifications.vr_notifications.xsoverlay_notifications',
            platformLabelKeys: {
                linux: 'view.settings.notifications.notifications.vr_notifications.wayvr_notifications'
            },
            prefKey: 'xsNotifications'
        },
        {
            key: 'ovrtoolkit-hud',
            platforms: ['windows', 'macos'],
            labelKey:
                'view.settings.notifications.notifications.vr_notifications.ovrtoolkit_hud_notifications',
            prefKey: 'ovrtHudNotifications'
        },
        {
            key: 'ovrtoolkit-wrist',
            platforms: ['windows', 'macos'],
            labelKey:
                'view.settings.notifications.notifications.vr_notifications.ovrtoolkit_wrist_notifications',
            prefKey: 'ovrtWristNotifications'
        },
        {
            key: 'filters',
            labelKey:
                'view.settings.notifications.notifications.vr_notifications.notification_filters'
        },
        {
            key: 'user-images',
            labelKey:
                'view.settings.notifications.notifications.vr_notifications.user_images',
            prefKey: 'imageNotifications'
        },
        {
            key: 'timeout',
            labelKey:
                'view.settings.notifications.notifications.vr_notifications.notification_timeout',
            prefKey: 'notificationTimeout'
        },
        {
            key: 'opacity',
            labelKey:
                'view.settings.notifications.notifications.vr_notifications.notification_opacity',
            prefKey: 'notificationOpacity'
        }
    ]
);

defineCard('vr', 'hmd', 'view.settings.vr.hmd_notifications.header', [
    {
        key: 'enabled',
        labelKey: 'view.settings.vr.hmd_notifications.hmd_notifications',
        prefKey: 'hmdNotificationsEnabled'
    },
    {
        key: 'start-mode',
        labelKey: 'view.settings.vr.hmd_notifications.start_when',
        dependsOn: 'enabled',
        prefKey: 'hmdNotificationStartMode'
    },
    {
        key: 'position',
        labelKey: 'view.settings.vr.hmd_notifications.position',
        dependsOn: 'enabled',
        prefKey: 'hmdNotificationPosition'
    },
    {
        key: 'style',
        labelKey: 'view.settings.vr.hmd_notifications.style',
        dependsOn: 'enabled',
        prefKey: 'hmdNotificationStyle'
    },
    {
        key: 'friend-icons',
        labelKey: 'view.settings.vr.hmd_notifications.friend_icons',
        dependsOn: 'enabled',
        prefKey: 'hmdNotificationAvatars'
    },
    {
        key: 'tracker-disconnect',
        labelKey: 'view.settings.vr.hmd_notifications.tracker_disconnect',
        dependsOn: 'enabled',
        prefKey: 'hmdNotificationTrackerDisconnect'
    },
    {
        key: 'timeout',
        labelKey: 'view.settings.vr.hmd_notifications.timeout',
        dependsOn: 'enabled',
        prefKey: 'hmdNotificationTimeout'
    },
    {
        key: 'opacity',
        labelKey: 'view.settings.vr.hmd_notifications.opacity',
        dependsOn: 'enabled',
        prefKey: 'hmdNotificationOpacity'
    },
    {
        key: 'filters',
        labelKey: 'view.settings.vr.hmd_notifications.filters',
        dependsOn: 'enabled'
    }
]);

defineCard('vr', 'wrist', 'view.settings.vr.wrist_overlay.header', [
    {
        key: 'enabled',
        labelKey: 'view.settings.vr.wrist_overlay.wrist_feed_overlay',
        prefKey: 'wristOverlayEnabled'
    },
    {
        key: 'start-mode',
        labelKey: 'view.settings.vr.wrist_overlay.start_when',
        dependsOn: 'enabled',
        prefKey: 'wristOverlayStartMode'
    },
    {
        key: 'button',
        labelKey: 'view.settings.vr.wrist_overlay.overlay_button',
        dependsOn: 'enabled',
        prefKey: 'wristOverlayButton'
    },
    {
        key: 'hand',
        labelKey: 'view.settings.vr.wrist_overlay.display_on',
        dependsOn: 'enabled',
        prefKey: 'wristOverlayHand'
    },
    {
        key: 'size',
        labelKey: 'view.settings.vr.wrist_overlay.size',
        dependsOn: 'enabled',
        prefKey: 'wristOverlaySize'
    },
    {
        key: 'dark-background',
        labelKey: 'view.settings.vr.wrist_overlay.dark_background',
        dependsOn: 'enabled',
        prefKey: 'wristOverlayDarkBackground'
    },
    {
        key: 'hide-private-worlds',
        labelKey: 'view.settings.vr.wrist_overlay.hide_private_worlds',
        dependsOn: 'enabled',
        prefKey: 'wristOverlayHidePrivateWorlds'
    },
    {
        key: 'device-status',
        labelKey: 'view.settings.vr.wrist_overlay.vr_device_status',
        dependsOn: 'enabled',
        prefKey: 'wristOverlayShowDevices'
    },
    {
        key: 'battery-percent',
        labelKey: 'view.settings.vr.wrist_overlay.battery_percentage',
        dependsOn: 'device-status',
        prefKey: 'wristOverlayShowBatteryPercent'
    },
    {
        key: 'notifications',
        labelKey: 'view.settings.vr.wrist_overlay.wrist_feed_notifications',
        dependsOn: 'enabled'
    }
]);

defineCard('vr', 'test', 'view.settings.vr.test_mode.header', [
    {
        key: 'force-display',
        labelKey: 'view.settings.vr.test_mode.force_display'
    }
]);

defineCard(
    'media',
    'screenshots',
    'view.settings.advanced.advanced.screenshot_helper.header',
    [
        {
            key: 'helper',
            labelKey:
                'view.settings.advanced.advanced.screenshot_helper.enable',
            descriptionKey:
                'view.settings.advanced.advanced.screenshot_helper.description_tooltip',
            prefKey: 'screenshotHelper'
        },
        {
            key: 'modify-filename',
            labelKey:
                'view.settings.advanced.advanced.screenshot_helper.modify_filename',
            descriptionKey:
                'view.settings.advanced.advanced.screenshot_helper.modify_filename_tooltip',
            dependsOn: 'helper',
            prefKey: 'screenshotHelperModifyFilename'
        },
        {
            key: 'copy-to-clipboard',
            labelKey:
                'view.settings.advanced.advanced.screenshot_helper.copy_to_clipboard',
            prefKey: 'screenshotHelperCopyToClipboard'
        },
        {
            key: 'delete-metadata',
            labelKey:
                'view.settings.advanced.advanced.delete_all_screenshot_metadata.button'
        }
    ]
);

defineCard(
    'media',
    'prints',
    'view.settings.advanced.advanced.save_instance_prints_to_file.header',
    [
        {
            key: 'save',
            labelKey:
                'view.settings.advanced.advanced.save_instance_prints_to_file.description',
            prefKey: 'saveInstancePrints'
        },
        {
            key: 'crop',
            labelKey:
                'view.settings.advanced.advanced.save_instance_prints_to_file.crop',
            dependsOn: 'save',
            prefKey: 'cropInstancePrints'
        },
        {
            key: 'auto-delete',
            labelKey:
                'view.settings.advanced.advanced.auto_delete_prints.enable',
            descriptionKey:
                'view.settings.advanced.advanced.auto_delete_prints.description',
            prefKey: 'autoDeleteOldPrints'
        },
        {
            key: 'auto-delete-limit',
            labelKey:
                'view.settings.advanced.advanced.auto_delete_prints.limit',
            descriptionKey:
                'view.settings.advanced.advanced.auto_delete_prints.limit_description',
            dependsOn: 'auto-delete',
            prefKey: 'autoDeletePrintsLimit'
        }
    ]
);

defineCard(
    'media',
    'stickers',
    'view.settings.advanced.advanced.save_instance_stickers_to_file.header',
    [
        {
            key: 'save',
            labelKey:
                'view.settings.advanced.advanced.save_instance_stickers_to_file.description',
            prefKey: 'saveInstanceStickers'
        }
    ]
);

defineCard(
    'media',
    'emoji',
    'view.settings.advanced.advanced.save_instance_emoji_to_file.header',
    [
        {
            key: 'save',
            labelKey:
                'view.settings.advanced.advanced.save_instance_emoji_to_file.description',
            prefKey: 'saveInstanceEmoji'
        }
    ]
);

defineCard('ai', 'assistant', 'view.settings.ai.header', [
    {
        key: 'default-model',
        labelKey: 'view.settings.ai.default_model',
        descriptionKey: 'view.settings.ai.default_model_description'
    },
    {
        key: 'playbook-mode',
        labelKey: 'assistant.runtime.playbook_mode',
        descriptionKey: 'view.settings.ai.playbook_mode_description'
    }
]);

defineCard('ai', 'endpoints', 'view.tools.llm_endpoints.title', [
    {
        key: 'follow-custom-proxy',
        labelKey: 'view.tools.llm_endpoints.follow_custom_proxy',
        descriptionKey:
            'view.tools.llm_endpoints.follow_custom_proxy_description'
    }
]);

defineCard('ai', 'mcp', 'view.settings.integrations.mcp_server.header', [
    {
        key: 'enabled',
        labelKey: 'view.settings.integrations.mcp_server.enable',
        descriptionKey:
            'view.settings.integrations.mcp_server.enable_description'
    },
    {
        key: 'allow-lan',
        labelKey: 'view.settings.integrations.mcp_server.allow_lan_connections',
        descriptionKey:
            'view.settings.integrations.mcp_server.allow_lan_connections_description'
    },
    {
        key: 'allow-vrchat-writes',
        labelKey: 'view.settings.integrations.mcp_server.allow_vrchat_writes',
        descriptionKey:
            'view.settings.integrations.mcp_server.allow_vrchat_writes_description'
    },
    {
        key: 'port',
        labelKey: 'view.settings.integrations.mcp_server.port_label',
        descriptionKey: 'view.settings.integrations.mcp_server.port_description'
    },
    {
        key: 'status',
        labelKey: 'view.settings.integrations.mcp_server.status_label'
    },
    {
        key: 'client-config',
        labelKey: 'view.settings.integrations.mcp_server.client_config',
        descriptionKey: 'view.settings.integrations.mcp_server.security_note'
    },
    {
        key: 'rotate-token',
        labelKey: 'view.settings.integrations.mcp_server.rotate_token',
        descriptionKey:
            'view.settings.integrations.mcp_server.rotate_token_description'
    }
]);

defineCard(
    'integrations',
    'discord',
    'view.settings.discord_presence.discord_presence.header',
    [
        {
            key: 'enabled',
            labelKey: 'view.settings.discord_presence.discord_presence.enable',
            prefKey: 'discordActive'
        },
        {
            key: 'world-integration',
            labelKey:
                'view.settings.discord_presence.discord_presence.world_integration',
            descriptionKey:
                'view.settings.discord_presence.discord_presence.world_integration_tooltip',
            dependsOn: 'enabled',
            prefKey: 'discordWorldIntegration'
        },
        {
            key: 'instance',
            labelKey:
                'view.settings.discord_presence.discord_presence.instance_type_player_count',
            dependsOn: 'enabled',
            prefKey: 'discordInstance'
        },
        {
            key: 'show-platform',
            labelKey:
                'view.settings.discord_presence.discord_presence.show_current_platform',
            dependsOn: 'instance',
            prefKey: 'discordShowPlatform'
        },
        {
            key: 'show-private-details',
            labelKey:
                'view.settings.discord_presence.discord_presence.show_details_in_private',
            dependsOn: 'enabled',
            prefKey: 'discordHideInvite'
        },
        {
            key: 'join-button',
            labelKey:
                'view.settings.discord_presence.discord_presence.join_button',
            descriptionKey:
                'view.settings.discord_presence.discord_presence.join_button_description',
            dependsOn: 'enabled',
            prefKey: 'discordJoinButton'
        },
        {
            key: 'show-images',
            labelKey:
                'view.settings.discord_presence.discord_presence.show_images',
            dependsOn: 'enabled',
            prefKey: 'discordHideImage'
        },
        {
            key: 'world-name-as-status',
            labelKey:
                'view.settings.discord_presence.discord_presence.display_world_name_as_discord_status',
            dependsOn: 'enabled',
            prefKey: 'discordWorldNameAsDiscordStatus'
        }
    ]
);

defineCard(
    'integrations',
    'translation',
    'view.settings.advanced.advanced.translation_api.header',
    [
        {
            key: 'enabled',
            labelKey: 'view.settings.advanced.advanced.translation_api.enable',
            prefKey: 'translationAPI'
        },
        {
            key: 'api-key',
            labelKey:
                'view.settings.advanced.advanced.translation_api.translation_api_key'
        }
    ]
);

defineCard(
    'integrations',
    'youtube',
    'view.settings.advanced.advanced.youtube_api.header',
    [
        {
            key: 'enabled',
            labelKey: 'view.settings.advanced.advanced.youtube_api.enable',
            prefKey: 'youtubeAPI'
        },
        {
            key: 'api-key',
            labelKey:
                'view.settings.advanced.advanced.youtube_api.youtube_api_key'
        }
    ]
);

defineCard(
    'integrations',
    'remote-database',
    'view.settings.advanced.advanced.remote_database.header',
    [
        {
            key: 'enabled',
            labelKey: 'view.settings.advanced.advanced.remote_database.enable'
        },
        {
            key: 'providers',
            labelKey:
                'view.settings.advanced.advanced.remote_database.avatar_database_provider'
        }
    ]
);

defineCard(
    'integrations',
    'api',
    'view.settings.integrations.integration_api.header',
    [
        {
            key: 'enabled',
            labelKey: 'view.settings.integrations.integration_api.enable',
            descriptionKey:
                'view.settings.integrations.integration_api.enable_description'
        },
        {
            key: 'information-types',
            labelKey:
                'view.settings.integrations.integration_api.information_types',
            descriptionKey:
                'view.settings.integrations.integration_api.information_types_description'
        },
        {
            key: 'allow-lan',
            labelKey:
                'view.settings.integrations.integration_api.allow_lan_connections',
            descriptionKey:
                'view.settings.integrations.integration_api.allow_lan_connections_description'
        },
        {
            key: 'port',
            labelKey: 'view.settings.integrations.integration_api.port_label',
            descriptionKey:
                'view.settings.integrations.integration_api.port_description'
        },
        {
            key: 'status',
            labelKey: 'view.settings.integrations.integration_api.status_label'
        },
        {
            key: 'token',
            labelKey: 'view.settings.integrations.integration_api.token',
            descriptionKey:
                'view.settings.integrations.integration_api.token_description'
        }
    ]
);

defineCard(
    'advanced',
    'storage',
    'view.settings.advanced.advanced_ui.storage.header',
    [
        {
            key: 'data-location',
            labelKey:
                'view.settings.advanced.advanced_ui.storage.data_location',
            descriptionKey:
                'view.settings.advanced.advanced.data_directory.restart_hint',
            requiresRestart: true
        },
        {
            key: 'auto-sweep-cache',
            labelKey: 'view.settings.advanced.advanced_ui.storage.cache_header',
            descriptionKey:
                'view.settings.advanced.advanced_ui.storage.cache_description',
            prefKey: 'autoSweepVRChatCache'
        },
        {
            key: 'avatar-cleanup',
            labelKey:
                'view.settings.advanced.advanced_ui.storage.keep_avatar_data',
            descriptionKey:
                'view.settings.advanced.advanced_ui.storage.avatar_cleanup_description',
            prefKey: 'avatarAutoCleanup'
        },
        {
            key: 'browse-history-retention',
            labelKey: 'browse_history.retention.label',
            descriptionKey: 'browse_history.retention.description'
        },
        {
            key: 'gamelog',
            requires: 'game-log-ingest',
            labelKey:
                'view.settings.advanced.advanced_ui.troubleshooting.gamelog',
            descriptionKey:
                'view.settings.advanced.advanced_ui.troubleshooting.gamelog_description',
            prefKey: 'gameLogDisabled'
        },
        {
            key: 'feed-history',
            labelKey:
                'view.settings.advanced.advanced_ui.troubleshooting.feed_history',
            descriptionKey:
                'view.settings.advanced.advanced_ui.troubleshooting.feed_history_description',
            prefKey: 'feedPersistenceDisabled'
        }
    ]
);

defineCard(
    'advanced',
    'troubleshooting',
    'view.settings.advanced.advanced_ui.troubleshooting.header',
    [
        {
            key: 'udon-exception-logging',
            labelKey:
                'view.settings.advanced.advanced.cache_debug.udon_exception_logging',
            prefKey: 'udonExceptionLogging'
        },
        {
            key: 'resource-load-logging',
            labelKey: 'view.settings.general.logging.resource_load',
            prefKey: 'logResourceLoad'
        },
        {
            key: 'deep-link-registration',
            labelKey:
                'view.settings.advanced.advanced_ui.behavior.deep_link_registration'
        },
        {
            key: 'database-usage',
            labelKey:
                'view.settings.advanced.advanced_ui.troubleshooting.database_usage'
        },
        {
            key: 'online-users',
            labelKey:
                'view.settings.advanced.advanced_ui.troubleshooting.online_users'
        },
        {
            key: 'vrchat-config',
            labelKey:
                'view.settings.advanced.advanced_ui.troubleshooting.vrchat_config'
        }
    ]
);

defineCard(
    'advanced',
    'import-recovery',
    'view.settings.advanced.advanced_ui.import_recovery.header',
    [
        {
            key: 'import-from-vrcx',
            labelKey:
                'view.settings.advanced.advanced_ui.import_recovery.import_from_vrcx',
            descriptionKey:
                'view.settings.advanced.advanced_ui.import_recovery.description'
        },
        {
            key: 'gamelog-import',
            labelKey:
                'view.settings.advanced.advanced_ui.import_recovery.game_log.label',
            descriptionKey:
                'view.settings.advanced.advanced_ui.import_recovery.game_log.description'
        }
    ]
);

defineCard(
    'advanced',
    'usage-data',
    'view.settings.advanced.advanced_ui.usage_data.header',
    [
        {
            key: 'share',
            labelKey: 'view.settings.advanced.advanced_ui.usage_data.share',
            descriptionKey:
                'view.settings.advanced.advanced_ui.usage_data.description',
            prefKey: 'anonymousUsageTelemetry'
        },
        {
            key: 'purge-avatar-history',
            labelKey:
                'view.settings.advanced.advanced_ui.danger.avatar_history',
            descriptionKey:
                'view.settings.advanced_groups.danger.cannot_be_undone'
        }
    ]
);

export const SETTINGS_CARDS: readonly SettingsCardDefinition[] = cards;
export const SETTINGS_MANIFEST: readonly SettingsManifestEntry[] = entries;

const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
const cardsById = new Map(cards.map((card) => [card.id, card]));

export function getSettingsManifestEntry(
    id: string | null | undefined
): SettingsManifestEntry | undefined {
    return id ? entriesById.get(id) : undefined;
}

export function getSettingsCard(
    id: string
): SettingsCardDefinition | undefined {
    return cardsById.get(id);
}

function isSettingsHostPlatform(value: string): value is SettingsHostPlatform {
    return value === 'windows' || value === 'macos' || value === 'linux';
}

function meetsRequirement(
    requirement: SettingsRuntimeRequirement | undefined,
    context: SettingsAvailabilityContext
) {
    switch (requirement) {
        case 'game-log-ingest':
            return context.gameLogIngest;
        case 'update-check-disabled-build':
            return context.updateCheckDisabledBuild;
        case 'update-check-enabled-build':
            return !context.updateCheckDisabledBuild;
        default:
            return true;
    }
}

export function resolveSettingForContext(
    entry: SettingsManifestEntry,
    context: SettingsAvailabilityContext
): SettingsManifestEntry | null {
    const platform = isSettingsHostPlatform(context.platform)
        ? context.platform
        : null;
    if (entry.platforms && (!platform || !entry.platforms.includes(platform))) {
        return null;
    }
    if (!meetsRequirement(entry.requires, context)) {
        return null;
    }
    const platformLabelKey = platform
        ? entry.platformLabelKeys?.[platform]
        : undefined;
    return platformLabelKey ? { ...entry, labelKey: platformLabelKey } : entry;
}

export function getSettingsTabLabelKey(tab: string): string | undefined {
    return SETTINGS_TABS.find(([value]) => value === tab)?.[1];
}

export function getSettingAncestors(
    entry: SettingsManifestEntry
): SettingsManifestEntry[] {
    const ancestors: SettingsManifestEntry[] = [];
    let parent = getSettingsManifestEntry(entry.dependsOn);
    while (parent && !ancestors.includes(parent)) {
        ancestors.push(parent);
        parent = getSettingsManifestEntry(parent.dependsOn);
    }
    return ancestors;
}
