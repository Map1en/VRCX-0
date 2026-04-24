import { DASHBOARD_BLOCKED_PANEL_KEYS } from '@/shared/constants/dashboard.js';

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
        labelKey: 'dashboard.registry.feed_widget',
        descriptionKey: 'dashboard.registry.compact_feed_widget_configuration',
        path: '/feed',
        defaultConfig: { filters: [] }
    },
    {
        key: 'widget:game-log',
        category: 'widget',
        labelKey: 'dashboard.registry.game_log_widget',
        descriptionKey: 'dashboard.registry.compact_game_log_widget_configuration',
        path: '/game-log',
        defaultConfig: { filters: [] }
    },
    {
        key: 'widget:instance',
        category: 'widget',
        labelKey: 'dashboard.registry.instance_widget',
        descriptionKey: 'dashboard.registry.compact_in_game_status_widget_configuration',
        path: '/player-list',
        defaultConfig: { columns: ['icon', 'displayName', 'timer'] }
    }
];

export const DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS = Object.freeze([
    { key: 'icon', labelKey: 'dashboard.registry.icon' },
    { key: 'displayName', labelKey: 'dashboard.registry.display_name', required: true },
    { key: 'rank', labelKey: 'dashboard.registry.rank' },
    { key: 'timer', labelKey: 'dashboard.registry.timer' },
    { key: 'platform', labelKey: 'dashboard.registry.platform' },
    { key: 'language', labelKey: 'dashboard.registry.language' },
    { key: 'status', labelKey: 'dashboard.registry.status' }
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
        labelKey: 'dashboard.registry.feed',
        path: '/feed',
        descriptionKey: 'dashboard.registry.feed_table_page'
    },
    {
        key: 'friends-locations',
        category: 'page',
        labelKey: 'dashboard.registry.friend_locations',
        path: '/friends-locations',
        descriptionKey: 'dashboard.registry.live_friend_location_board'
    },
    {
        key: 'game-log',
        category: 'page',
        labelKey: 'dashboard.registry.game_log',
        path: '/game-log',
        descriptionKey: 'dashboard.registry.game_log_table_page'
    },
    {
        key: 'player-list',
        category: 'page',
        labelKey: 'dashboard.registry.current_players',
        path: '/player-list',
        descriptionKey: 'dashboard.registry.current_instance_player_page'
    },
    {
        key: 'search',
        category: 'page',
        labelKey: 'dashboard.registry.search',
        path: '/search',
        descriptionKey: 'dashboard.registry.search_worlds_and_groups'
    },
    {
        key: 'favorite-friends',
        category: 'page',
        labelKey: 'dashboard.registry.favorite_friends',
        path: '/favorites/friends',
        descriptionKey: 'dashboard.registry.favorite_friends_page'
    },
    {
        key: 'favorite-worlds',
        category: 'page',
        labelKey: 'dashboard.registry.favorite_worlds',
        path: '/favorites/worlds',
        descriptionKey: 'dashboard.registry.favorite_worlds_page'
    },
    {
        key: 'favorite-avatars',
        category: 'page',
        labelKey: 'dashboard.registry.favorite_avatars',
        path: '/favorites/avatars',
        descriptionKey: 'dashboard.registry.favorite_avatars_page'
    },
    {
        key: 'friend-log',
        category: 'page',
        labelKey: 'dashboard.registry.friend_history',
        path: '/social/friend-log',
        descriptionKey: 'dashboard.registry.friend_history_table_page'
    },
    {
        key: 'friend-list',
        category: 'page',
        labelKey: 'dashboard.registry.friends',
        path: '/social/friend-list',
        descriptionKey: 'dashboard.registry.friend_management_page'
    },
    {
        key: 'moderation',
        category: 'page',
        labelKey: 'dashboard.registry.moderation',
        path: '/social/moderation',
        descriptionKey: 'dashboard.registry.moderation_table_page'
    },
    {
        key: 'notification',
        category: 'page',
        labelKey: 'dashboard.registry.notification_center',
        path: '/notification',
        descriptionKey: 'dashboard.registry.notification_center_page'
    },
    {
        key: 'my-avatars',
        category: 'page',
        labelKey: 'dashboard.registry.my_avatars',
        path: '/my-avatars',
        descriptionKey: 'dashboard.registry.avatar_collection_page'
    },
    {
        key: 'charts-instance',
        category: 'page',
        labelKey: 'dashboard.registry.instance_activity',
        path: '/charts/instance',
        descriptionKey: 'dashboard.registry.instance_activity_chart'
    },
    {
        key: 'charts-mutual',
        category: 'page',
        labelKey: 'dashboard.registry.mutual_friends',
        path: '/charts/mutual',
        descriptionKey: 'dashboard.registry.mutual_friends_chart'
    },
    {
        key: 'tools',
        category: 'page',
        labelKey: 'dashboard.registry.tools',
        path: '/tools',
        descriptionKey: 'dashboard.registry.tools_launcher_page'
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

function translateDashboardKey(t, key, fallback = '') {
    if (!key) {
        return fallback;
    }

    if (typeof t !== 'function') {
        return fallback || key;
    }

    const translated = t(key);
    return typeof translated === 'string' && translated
        ? translated
        : fallback || key;
}

export function getDashboardPanelLabel(definition, t) {
    return translateDashboardKey(
        t,
        definition?.labelKey,
        definition?.key || ''
    );
}

export function getDashboardPanelDescription(definition, t) {
    return translateDashboardKey(
        t,
        definition?.descriptionKey,
        definition?.path || definition?.key || ''
    );
}

export function getDashboardInstanceWidgetColumnLabel(column, t) {
    return translateDashboardKey(t, column?.labelKey, column?.key || '');
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
