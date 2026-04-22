import { DASHBOARD_BLOCKED_PANEL_KEYS } from '@/shared/constants/dashboard.js';
import { appI18n } from '@/services/i18nService.js';

function cloneDefaultConfig(value) {
    if (!value || typeof value !== 'object') {
        return {};
    }

    return JSON.parse(JSON.stringify(value));
}

export const DASHBOARD_WIDGET_DEFINITIONS = [
    {
        key: 'widget:feed',
        category: 'widget',
        label: appI18n.t('dashboard.registry.feed_widget'),
        description: appI18n.t('dashboard.registry.compact_feed_widget_configuration'),
        path: '/feed',
        defaultConfig: { filters: [] }
    },
    {
        key: 'widget:game-log',
        category: 'widget',
        label: appI18n.t('dashboard.registry.game_log_widget'),
        description: appI18n.t('dashboard.registry.compact_game_log_widget_configuration'),
        path: '/game-log',
        defaultConfig: { filters: [] }
    },
    {
        key: 'widget:instance',
        category: 'widget',
        label: appI18n.t('dashboard.registry.instance_widget'),
        description: appI18n.t('dashboard.registry.compact_in_game_status_widget_configuration'),
        path: '/player-list',
        defaultConfig: { columns: ['icon', 'displayName', 'timer'] }
    }
];

export const DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS = Object.freeze([
    { key: 'icon', label: appI18n.t('dashboard.registry.icon') },
    { key: 'displayName', label: appI18n.t('dashboard.registry.display_name'), required: true },
    { key: 'rank', label: appI18n.t('dashboard.registry.rank') },
    { key: 'timer', label: appI18n.t('dashboard.registry.timer') },
    { key: 'platform', label: appI18n.t('dashboard.registry.platform') },
    { key: 'language', label: appI18n.t('dashboard.registry.language') },
    { key: 'status', label: appI18n.t('dashboard.registry.status') }
]);

export const DASHBOARD_INSTANCE_WIDGET_DEFAULT_COLUMNS = Object.freeze([
    'icon',
    'displayName',
    'timer'
]);

export const DASHBOARD_PAGE_DEFINITIONS = [
    {
        key: 'feed',
        category: 'page',
        label: appI18n.t('dashboard.registry.feed'),
        path: '/feed',
        description: appI18n.t('dashboard.registry.feed_table_page')
    },
    {
        key: 'friends-locations',
        category: 'page',
        label: appI18n.t('dashboard.registry.friend_locations'),
        path: '/friends-locations',
        description: appI18n.t('dashboard.registry.live_friend_location_board')
    },
    {
        key: 'game-log',
        category: 'page',
        label: appI18n.t('dashboard.registry.game_log'),
        path: '/game-log',
        description: appI18n.t('dashboard.registry.game_log_table_page')
    },
    {
        key: 'player-list',
        category: 'page',
        label: appI18n.t('dashboard.registry.current_players'),
        path: '/player-list',
        description: appI18n.t('dashboard.registry.current_instance_player_page')
    },
    {
        key: 'search',
        category: 'page',
        label: appI18n.t('dashboard.registry.search'),
        path: '/search',
        description: appI18n.t('dashboard.registry.search_worlds_and_groups')
    },
    {
        key: 'favorite-friends',
        category: 'page',
        label: appI18n.t('dashboard.registry.favorite_friends'),
        path: '/favorites/friends',
        description: appI18n.t('dashboard.registry.favorite_friends_page')
    },
    {
        key: 'favorite-worlds',
        category: 'page',
        label: appI18n.t('dashboard.registry.favorite_worlds'),
        path: '/favorites/worlds',
        description: appI18n.t('dashboard.registry.favorite_worlds_page')
    },
    {
        key: 'favorite-avatars',
        category: 'page',
        label: appI18n.t('dashboard.registry.favorite_avatars'),
        path: '/favorites/avatars',
        description: appI18n.t('dashboard.registry.favorite_avatars_page')
    },
    {
        key: 'friend-log',
        category: 'page',
        label: appI18n.t('dashboard.registry.friend_history'),
        path: '/social/friend-log',
        description: appI18n.t('dashboard.registry.friend_history_table_page')
    },
    {
        key: 'friend-list',
        category: 'page',
        label: appI18n.t('dashboard.registry.friends'),
        path: '/social/friend-list',
        description: appI18n.t('dashboard.registry.friend_management_page')
    },
    {
        key: 'moderation',
        category: 'page',
        label: appI18n.t('dashboard.registry.moderation'),
        path: '/social/moderation',
        description: appI18n.t('dashboard.registry.moderation_table_page')
    },
    {
        key: 'notification',
        category: 'page',
        label: appI18n.t('dashboard.registry.notification_center'),
        path: '/notification',
        description: appI18n.t('dashboard.registry.notification_center_page')
    },
    {
        key: 'my-avatars',
        category: 'page',
        label: appI18n.t('dashboard.registry.my_avatars'),
        path: '/my-avatars',
        description: appI18n.t('dashboard.registry.avatar_collection_page')
    },
    {
        key: 'charts-instance',
        category: 'page',
        label: appI18n.t('dashboard.registry.instance_activity'),
        path: '/charts/instance',
        description: appI18n.t('dashboard.registry.instance_activity_chart')
    },
    {
        key: 'charts-mutual',
        category: 'page',
        label: appI18n.t('dashboard.registry.mutual_friends'),
        path: '/charts/mutual',
        description: appI18n.t('dashboard.registry.mutual_friends_chart')
    },
    {
        key: 'tools',
        category: 'page',
        label: appI18n.t('dashboard.registry.tools'),
        path: '/tools',
        description: appI18n.t('dashboard.registry.tools_launcher_page')
    }
];

export const DASHBOARD_SELECTABLE_PAGE_DEFINITIONS =
    DASHBOARD_PAGE_DEFINITIONS.filter(
        (definition) => !DASHBOARD_BLOCKED_PANEL_KEYS.has(definition.key)
    );

const DASHBOARD_DEFINITION_MAP = new Map(
    [...DASHBOARD_WIDGET_DEFINITIONS, ...DASHBOARD_PAGE_DEFINITIONS].map(
        (definition) => [definition.key, definition]
    )
);

const DASHBOARD_PANEL_KEY_ALIASES = {
    'social/friend-log': 'friend-log',
    'social/friend-list': 'friend-list',
    'social/moderation': 'moderation'
};

function normalizeDashboardPanelKey(key) {
    const normalizedKey = String(key || '').trim();
    return DASHBOARD_PANEL_KEY_ALIASES[normalizedKey] || normalizedKey;
}

export function resolveDashboardPanelKey(panel) {
    if (!panel) {
        return null;
    }

    if (typeof panel === 'string') {
        return panel;
    }

    if (typeof panel === 'object' && typeof panel.key === 'string') {
        return panel.key;
    }

    return null;
}

export function resolveDashboardPanelConfig(panel) {
    if (!panel || typeof panel === 'string') {
        return {};
    }

    return panel.config && typeof panel.config === 'object' ? panel.config : {};
}

export function getDashboardPanelDefinition(key) {
    const normalizedKey = normalizeDashboardPanelKey(key);
    return normalizedKey
        ? (DASHBOARD_DEFINITION_MAP.get(normalizedKey) ?? null)
        : null;
}

export function createDashboardPanelValue(key) {
    const normalizedKey = normalizeDashboardPanelKey(key);
    if (!normalizedKey || normalizedKey === '__none__') {
        return null;
    }

    const definition = getDashboardPanelDefinition(normalizedKey);
    if (!definition) {
        return normalizedKey;
    }

    if (definition.category === 'widget') {
        return {
            key: definition.key,
            config: cloneDefaultConfig(definition.defaultConfig)
        };
    }

    return definition.key;
}
