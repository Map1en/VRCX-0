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
        label: 'Feed Widget',
        description: 'Compact feed widget configuration.',
        path: '/feed',
        defaultConfig: { filters: [] }
    },
    {
        key: 'widget:game-log',
        category: 'widget',
        label: 'Game Log Widget',
        description: 'Compact game-log widget configuration.',
        path: '/game-log',
        defaultConfig: { filters: [] }
    },
    {
        key: 'widget:instance',
        category: 'widget',
        label: 'Instance Widget',
        description: 'Compact in-game status widget configuration.',
        path: '/player-list',
        defaultConfig: { columns: ['icon', 'displayName', 'timer'] }
    }
];

export const DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS = Object.freeze([
    { key: 'icon', label: 'Icon' },
    { key: 'displayName', label: 'Display Name', required: true },
    { key: 'rank', label: 'Rank' },
    { key: 'timer', label: 'Timer' },
    { key: 'platform', label: 'Platform' },
    { key: 'language', label: 'Language' },
    { key: 'status', label: 'Status' }
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
        label: 'Feed',
        path: '/feed',
        description: 'Feed table page.'
    },
    {
        key: 'friends-locations',
        category: 'page',
        label: 'Friends Locations',
        path: '/friends-locations',
        description: 'Live friend location cards.'
    },
    {
        key: 'game-log',
        category: 'page',
        label: 'Game Log',
        path: '/game-log',
        description: 'Game-log table page.'
    },
    {
        key: 'player-list',
        category: 'page',
        label: 'Player List',
        path: '/player-list',
        description: 'Instance player list page.'
    },
    {
        key: 'search',
        category: 'page',
        label: 'Search',
        path: '/search',
        description: 'Search worlds and groups.'
    },
    {
        key: 'favorite-friends',
        category: 'page',
        label: 'Favorite Friends',
        path: '/favorites/friends',
        description: 'Favorite friends page.'
    },
    {
        key: 'favorite-worlds',
        category: 'page',
        label: 'Favorite Worlds',
        path: '/favorites/worlds',
        description: 'Favorite worlds page.'
    },
    {
        key: 'favorite-avatars',
        category: 'page',
        label: 'Favorite Avatars',
        path: '/favorites/avatars',
        description: 'Favorite avatars page.'
    },
    {
        key: 'friend-log',
        category: 'page',
        label: 'Friend Log',
        path: '/social/friend-log',
        description: 'Friend log table page.'
    },
    {
        key: 'friend-list',
        category: 'page',
        label: 'Friend List',
        path: '/social/friend-list',
        description: 'Friend list table page.'
    },
    {
        key: 'moderation',
        category: 'page',
        label: 'Moderation',
        path: '/social/moderation',
        description: 'Moderation table page.'
    },
    {
        key: 'notification',
        category: 'page',
        label: 'Notification Center',
        path: '/notification',
        description: 'Notification center page.'
    },
    {
        key: 'my-avatars',
        category: 'page',
        label: 'My Avatars',
        path: '/my-avatars',
        description: 'Avatar collection page.'
    },
    {
        key: 'charts-instance',
        category: 'page',
        label: 'Instance Activity',
        path: '/charts/instance',
        description: 'Instance activity chart.'
    },
    {
        key: 'charts-mutual',
        category: 'page',
        label: 'Mutual Friends',
        path: '/charts/mutual',
        description: 'Mutual-friends chart.'
    },
    {
        key: 'tools',
        category: 'page',
        label: 'Tools',
        path: '/tools',
        description: 'Tools launcher page.'
    }
];

export const DASHBOARD_SELECTABLE_PAGE_DEFINITIONS = DASHBOARD_PAGE_DEFINITIONS.filter(
    (definition) => !DASHBOARD_BLOCKED_PANEL_KEYS.has(definition.key)
);

const DASHBOARD_DEFINITION_MAP = new Map(
    [...DASHBOARD_WIDGET_DEFINITIONS, ...DASHBOARD_PAGE_DEFINITIONS].map((definition) => [
        definition.key,
        definition
    ])
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
    return normalizedKey ? DASHBOARD_DEFINITION_MAP.get(normalizedKey) ?? null : null;
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
