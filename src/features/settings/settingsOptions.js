export const notificationLayoutOptions = [
    [
        'notification-center',
        'view.settings.notifications.notifications.layout_notification_center'
    ],
    ['table', 'view.settings.notifications.notifications.layout_table']
];

export const desktopToastOptions = [
    ['Never', 'view.settings.notifications.notifications.conditions.never'],
    [
        'Desktop Mode',
        'view.settings.notifications.notifications.conditions.desktop'
    ],
    [
        'Inside VR',
        'view.settings.notifications.notifications.conditions.inside_vr'
    ],
    [
        'Outside VR',
        'view.settings.notifications.notifications.conditions.outside_vr'
    ],
    [
        'Game Running',
        'view.settings.notifications.notifications.conditions.inside_vrchat'
    ],
    [
        'Game Closed',
        'view.settings.notifications.notifications.conditions.outside_vrchat'
    ],
    ['Always', 'view.settings.notifications.notifications.conditions.always']
];

export const notificationTtsOptions = [
    ['Never', 'view.settings.notifications.notifications.conditions.never'],
    [
        'Inside VR',
        'view.settings.notifications.notifications.conditions.inside_vr'
    ],
    [
        'Game Running',
        'view.settings.notifications.notifications.conditions.inside_vrchat'
    ],
    [
        'Game Closed',
        'view.settings.notifications.notifications.conditions.outside_vrchat'
    ],
    ['Always', 'view.settings.notifications.notifications.conditions.always']
];

export const avatarAutoCleanupOptions = ['Off', '30', '90', '180', '365'];

export const sqliteTableSizeRows = [
    ['gps', 'view.settings.advanced.advanced.sqlite_table_size.gps'],
    ['status', 'view.settings.advanced.advanced.sqlite_table_size.status'],
    ['bio', 'view.settings.advanced.advanced.sqlite_table_size.bio'],
    ['avatar', 'view.settings.advanced.advanced.sqlite_table_size.avatar'],
    [
        'onlineOffline',
        'view.settings.advanced.advanced.sqlite_table_size.online_offline'
    ],
    [
        'friendLogHistory',
        'view.settings.advanced.advanced.sqlite_table_size.friend_log_history'
    ],
    [
        'notification',
        'view.settings.advanced.advanced.sqlite_table_size.notification'
    ],
    ['location', 'view.settings.advanced.advanced.sqlite_table_size.location'],
    [
        'joinLeave',
        'view.settings.advanced.advanced.sqlite_table_size.join_leave'
    ],
    [
        'portalSpawn',
        'view.settings.advanced.advanced.sqlite_table_size.portal_spawn'
    ],
    [
        'videoPlay',
        'view.settings.advanced.advanced.sqlite_table_size.video_play'
    ],
    ['event', 'view.settings.advanced.advanced.sqlite_table_size.event']
];

export const translationProviderOptions = [
    ['google', 'dialog.translation_api.mode_google'],
    ['openai', 'dialog.translation_api.mode_openai']
];

export const settingsTabs = [
    ['system', 'view.settings.category.system'],
    ['interface', 'view.settings.category.interface'],
    ['social', 'view.settings.category.social'],
    ['notifications', 'view.settings.category.notifications'],
    ['media', 'view.settings.category.media'],
    ['integrations', 'view.settings.category.integrations'],
    ['advanced', 'view.settings.category.advanced']
];
