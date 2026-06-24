import type { DashboardPanel } from '@/repositories/dashboardRepository';
import { DASHBOARD_BLOCKED_PANEL_KEYS } from '@/shared/constants/dashboard';

export type DashboardPanelDefinition = {
    key: string;
    category: 'widget' | 'page';
    labelKey: string;
    descriptionKey?: string;
    path?: string;
    defaultConfig?: Record<string, unknown>;
};

type DashboardColumnDefinition = {
    key: string;
    labelKey: string;
    required?: boolean;
};

type TranslateKey = (key: string) => string;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function cloneDefaultConfig(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object') {
        return {};
    }

    return JSON.parse(JSON.stringify(value));
}

export const DASHBOARD_WIDGET_DEFINITIONS: DashboardPanelDefinition[] = [
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
        descriptionKey:
            'dashboard.registry.compact_game_log_widget_configuration',
        path: '/game-log',
        defaultConfig: { filters: [] }
    },
    {
        key: 'widget:instance',
        category: 'widget',
        labelKey: 'dashboard.registry.instance_widget',
        descriptionKey:
            'dashboard.registry.compact_in_game_status_widget_configuration',
        path: '/player-list',
        defaultConfig: { columns: ['icon', 'displayName', 'timer'] }
    }
];

export const DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS: readonly DashboardColumnDefinition[] =
    Object.freeze([
        { key: 'icon', labelKey: 'dashboard.registry.icon' },
        {
            key: 'displayName',
            labelKey: 'dashboard.registry.display_name',
            required: true
        },
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

export const DASHBOARD_PAGE_DEFINITIONS: DashboardPanelDefinition[] = [
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

const DASHBOARD_DEFINITION_MAP = new Map<string, DashboardPanelDefinition>(
    [...DASHBOARD_WIDGET_DEFINITIONS, ...DASHBOARD_PAGE_DEFINITIONS].map(
        (definition) => [definition.key, definition]
    )
);

const DASHBOARD_PANEL_KEY_ALIASES: Record<string, string> = {
    'social/friend-log': 'friend-log',
    'social/friend-list': 'friend-list',
    'social/moderation': 'moderation'
};

function normalizeDashboardPanelKey(key: unknown): string {
    const normalizedKey = String(key || '').trim();
    return DASHBOARD_PANEL_KEY_ALIASES[normalizedKey] || normalizedKey;
}

export function resolveDashboardPanelKey(panel: unknown): string | null {
    if (!panel) {
        return null;
    }

    if (typeof panel === 'string') {
        return panel;
    }

    if (isRecord(panel) && typeof panel.key === 'string') {
        return panel.key;
    }

    return null;
}

export function resolveDashboardPanelConfig(
    panel: unknown
): Record<string, unknown> {
    if (!panel || typeof panel === 'string') {
        return {};
    }

    if (!isRecord(panel)) {
        return {};
    }

    return panel.config && typeof panel.config === 'object'
        ? (panel.config as Record<string, unknown>)
        : {};
}

export function getDashboardPanelDefinition(
    key: unknown
): DashboardPanelDefinition | null {
    const normalizedKey = normalizeDashboardPanelKey(key);
    return normalizedKey
        ? (DASHBOARD_DEFINITION_MAP.get(normalizedKey) ?? null)
        : null;
}

function translateDashboardKey(
    t: TranslateKey,
    key: string | undefined,
    fallback = ''
) {
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

export function getDashboardPanelLabel(
    definition: DashboardPanelDefinition | null,
    t: TranslateKey
) {
    return translateDashboardKey(
        t,
        definition?.labelKey,
        definition?.key || ''
    );
}

export function getDashboardPanelDescription(
    definition: DashboardPanelDefinition | null,
    t: TranslateKey
) {
    return translateDashboardKey(
        t,
        definition?.descriptionKey,
        definition?.path || definition?.key || ''
    );
}

export function getDashboardInstanceWidgetColumnLabel(
    column: DashboardColumnDefinition,
    t: TranslateKey
) {
    return translateDashboardKey(t, column?.labelKey, column?.key || '');
}

export function createDashboardPanelValue(key: unknown): DashboardPanel | null {
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
