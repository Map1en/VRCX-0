import configRepository from '@/repositories/configRepository';
import type { Dashboard } from '@/repositories/dashboardRepository';
import {
    DASHBOARD_NAV_KEY_PREFIX,
    DEFAULT_DASHBOARD_ICON
} from '@/shared/constants/dashboard';
import {
    DEFAULT_FOLDER_ICON,
    DEFAULT_NAV_ICON_KEY,
    normalizeNavIconKey
} from '@/shared/constants/navIcons';
import { isToolNavKey } from '@/shared/constants/tools';
import { navDefinitions } from '@/shared/constants/ui';
import {
    NAV_CUSTOMIZE_REQUESTED_EVENT,
    NAV_LAYOUT_UPDATED_EVENT,
    publishNavCustomizeRequested,
    publishNavLayoutUpdated
} from '@/shared/events/navLayoutEvents';

type TranslateKey = (key: string) => string;

export type NavDefinition = {
    key: string;
    icon?: string;
    tooltip?: string;
    labelKey?: string;
    titleIsCustom?: boolean;
    isDashboard?: boolean;
    routeName?: string | null;
    routeParams?: Record<string, string>;
    path?: string;
};

export type NavLayoutItem = {
    type: 'item';
    key: string;
    icon?: string;
};

export type NavFolderItem = string | { key: string; icon?: string };

export type NavLayoutFolder = {
    type: 'folder';
    id: string;
    name: string;
    nameKey?: string | null;
    icon: string;
    items: NavFolderItem[];
};

export type NavLayoutEntry = NavLayoutItem | NavLayoutFolder;

export type NavMenuItem = Partial<NavDefinition> & {
    index: string;
    title?: string;
    titleIsCustom?: boolean;
    label?: string;
    children?: NavMenuItem[];
};

type MenuItem = NavMenuItem;

export type NavMenuModel = {
    definitions: NavDefinition[];
    definitionMap: Map<string, NavDefinition>;
    hiddenKeys: string[];
    layout: NavLayoutEntry[];
    defaultLayout: NavLayoutEntry[];
    menuItems: NavMenuItem[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

export const NAV_CONFIG_KEY = 'VRCX_customNavMenuLayoutList';
export {
    NAV_CUSTOMIZE_REQUESTED_EVENT,
    NAV_LAYOUT_UPDATED_EVENT,
    publishNavCustomizeRequested
};

export const routePathByName = Object.freeze({
    feed: '/feed',
    'friends-locations': '/friends-locations',
    'game-log': '/game-log',
    'instance-history': '/instance-history',
    'player-list': '/player-list',
    search: '/search',
    'favorite-friends': '/favorites/friends',
    'favorite-worlds': '/favorites/worlds',
    'favorite-avatars': '/favorites/avatars',
    'friend-log': '/social/friend-log',
    'friend-list': '/social/friend-list',
    moderation: '/social/moderation',
    notification: '/notification',
    'my-avatars': '/my-avatars',
    'charts-mutual': '/charts/mutual',
    tools: '/tools',
    gallery: '/tools/gallery',
    inventory: '/tools/inventory',
    'screenshot-metadata': '/tools/screenshot-metadata',
    'vrchat-log': '/tools/vrchat-log',
    'community-themes': '/themes',
    themes: '/themes',
    settings: '/settings'
});

export function buildDashboardNavDefinitions(
    dashboards: Dashboard[] = []
): NavDefinition[] {
    return dashboards
        .filter((dashboard) => dashboard?.id)
        .map((dashboard) => ({
            key: `${DASHBOARD_NAV_KEY_PREFIX}${dashboard.id}`,
            icon: normalizeNavIconKey(dashboard.icon, DEFAULT_DASHBOARD_ICON),
            tooltip: dashboard.name || 'Dashboard',
            labelKey: dashboard.name || 'Dashboard',
            titleIsCustom: true,
            isDashboard: true,
            routeName: 'dashboard',
            routeParams: { id: dashboard.id }
        }));
}

export function createBaseDefaultNavLayout(t: TranslateKey): NavLayoutEntry[] {
    return [
        { type: 'item', key: 'feed' },
        { type: 'item', key: 'friends-locations' },
        { type: 'item', key: 'game-log' },
        { type: 'item', key: 'instance-history' },
        { type: 'item', key: 'player-list' },
        { type: 'item', key: 'search' },
        {
            type: 'folder',
            id: 'default-folder-favorites',
            nameKey: 'nav_tooltip.favorites',
            name: t('nav_tooltip.favorites'),
            icon: 'lucide:Star',
            items: ['favorite-friends', 'favorite-worlds', 'favorite-avatars']
        },
        {
            type: 'folder',
            id: 'default-folder-social',
            nameKey: 'nav_tooltip.social',
            name: t('nav_tooltip.social'),
            icon: 'lucide:Users',
            items: ['friend-log', 'friend-list', 'moderation']
        },
        { type: 'item', key: 'notification' },
        { type: 'item', key: 'my-avatars' },
        { type: 'item', key: 'charts-mutual' },
        { type: 'item', key: 'tools' }
    ];
}

export function insertDashboardEntries(
    layout: unknown,
    dashboardDefinitions: NavDefinition[] = [],
    hiddenKeys: string[] = []
) {
    const nextLayout = Array.isArray(layout) ? [...layout] : [];
    const existingKeys = collectLayoutKeys(nextLayout);
    const hiddenSet = new Set(Array.isArray(hiddenKeys) ? hiddenKeys : []);
    const dashboardEntries = dashboardDefinitions
        .filter(
            (definition) =>
                definition?.key &&
                !existingKeys.has(definition.key) &&
                !hiddenSet.has(definition.key)
        )
        .map(
            (definition): NavLayoutItem => ({
                type: 'item',
                key: definition.key
            })
        );

    if (!dashboardEntries.length) {
        return nextLayout;
    }

    return [...nextLayout, ...dashboardEntries];
}

export function createNavDefinitionMap(
    definitions: NavDefinition[] = []
): Map<string, NavDefinition> {
    return new Map(
        definitions
            .filter((definition) => definition?.key)
            .map((definition) => [definition.key, definition])
    );
}

function collectLayoutKeys(layout: unknown) {
    const keys = new Set<string>();
    if (!Array.isArray(layout)) {
        return keys;
    }
    for (const entry of layout) {
        if (!isRecord(entry)) {
            continue;
        }
        if (entry.type === 'item' && typeof entry.key === 'string') {
            keys.add(entry.key);
        } else if (entry.type === 'folder' && Array.isArray(entry.items)) {
            for (const item of entry.items) {
                const key = getFolderItemKey(item);
                if (key) {
                    keys.add(key);
                }
            }
        }
    }
    return keys;
}

function getFolderItemKey(item: unknown): string {
    return typeof item === 'string'
        ? item
        : isRecord(item) && typeof item.key === 'string'
          ? item.key
          : '';
}

function getFolderItemIcon(item: unknown) {
    return isRecord(item) ? item.icon : undefined;
}

function isDefaultChartsFolder(entry: unknown) {
    if (!isRecord(entry)) {
        return false;
    }
    return (
        entry.id === 'default-folder-charts' ||
        entry.nameKey === 'nav_tooltip.charts'
    );
}

function normalizeHiddenKeys(
    hiddenKeys: unknown,
    definitionMap: Map<string, NavDefinition>
) {
    const seen = new Set<string>();
    const normalized: string[] = [];
    if (!Array.isArray(hiddenKeys)) {
        return normalized;
    }
    for (const key of hiddenKeys) {
        if (
            typeof key !== 'string' ||
            !key ||
            seen.has(key) ||
            !definitionMap.has(key)
        ) {
            continue;
        }
        seen.add(key);
        normalized.push(key);
    }
    return normalized;
}

function buildAppendDefinitions(
    baseDefinitions: NavDefinition[],
    dashboardDefinitions: NavDefinition[],
    layout: unknown,
    hiddenKeys: unknown
) {
    const keysInLayout = collectLayoutKeys(layout);
    const hiddenSet = new Set(Array.isArray(hiddenKeys) ? hiddenKeys : []);
    const visibleBaseDefinitions = baseDefinitions.filter(
        (definition) =>
            !isToolNavKey(definition.key) || keysInLayout.has(definition.key)
    );
    const visibleDashboardDefinitions = dashboardDefinitions.filter(
        (definition) =>
            keysInLayout.has(definition.key) || hiddenSet.has(definition.key)
    );
    return [...visibleBaseDefinitions, ...visibleDashboardDefinitions];
}

export function sanitizeNavLayout({
    layout,
    hiddenKeys,
    definitions,
    appendDefinitions,
    t
}: {
    layout: unknown;
    hiddenKeys?: unknown;
    definitions: NavDefinition[];
    appendDefinitions: NavDefinition[];
    t: TranslateKey;
}): NavLayoutEntry[] {
    const definitionMap = createNavDefinitionMap(definitions);
    const hiddenSet = new Set(normalizeHiddenKeys(hiddenKeys, definitionMap));
    const usedKeys = new Set<string>();
    const normalized: NavLayoutEntry[] = [];

    const appendItemEntry = (
        key: unknown,
        target: NavLayoutEntry[] = normalized,
        sourceEntry: unknown = null
    ) => {
        if (
            typeof key !== 'string' ||
            !key ||
            usedKeys.has(key) ||
            hiddenSet.has(key) ||
            !definitionMap.has(key)
        ) {
            return;
        }
        const definition = definitionMap.get(key);
        const defaultIcon = normalizeNavIconKey(
            definition?.icon,
            DEFAULT_NAV_ICON_KEY
        );
        const icon = normalizeNavIconKey(
            isRecord(sourceEntry) ? sourceEntry.icon : undefined,
            defaultIcon
        );
        const entry: NavLayoutItem = { type: 'item', key };
        if (icon && icon !== defaultIcon) {
            entry.icon = icon;
        }
        target.push(entry);
        usedKeys.add(key);
    };

    if (Array.isArray(layout)) {
        for (const entry of layout) {
            if (!isRecord(entry)) {
                continue;
            }
            if (entry.type === 'item') {
                appendItemEntry(entry.key, normalized, entry);
                continue;
            }

            if (entry.type === 'folder') {
                if (isDefaultChartsFolder(entry)) {
                    const items = Array.isArray(entry.items) ? entry.items : [];
                    for (const item of items) {
                        appendItemEntry(getFolderItemKey(item));
                    }
                    continue;
                }

                const folderItems: NavFolderItem[] = [];
                const items = Array.isArray(entry.items) ? entry.items : [];
                for (const item of items) {
                    const key = getFolderItemKey(item);
                    if (
                        !key ||
                        usedKeys.has(key) ||
                        hiddenSet.has(key) ||
                        !definitionMap.has(key)
                    ) {
                        continue;
                    }
                    const definition = definitionMap.get(key);
                    const defaultIcon = normalizeNavIconKey(
                        definition?.icon,
                        DEFAULT_NAV_ICON_KEY
                    );
                    const icon = normalizeNavIconKey(
                        getFolderItemIcon(item),
                        defaultIcon
                    );
                    folderItems.push(
                        icon && icon !== defaultIcon ? { key, icon } : key
                    );
                    usedKeys.add(key);
                }
                if (folderItems.length) {
                    const nameKey =
                        typeof entry.nameKey === 'string'
                            ? entry.nameKey
                            : null;
                    const fallbackName =
                        typeof entry.name === 'string' ? entry.name : '';
                    normalized.push({
                        type: 'folder',
                        id:
                            (typeof entry.id === 'string' && entry.id) ||
                            `nav-folder-${Math.random().toString(36).slice(2, 8)}`,
                        name: nameKey ? t(nameKey) : fallbackName,
                        nameKey,
                        icon: normalizeNavIconKey(
                            entry.icon,
                            DEFAULT_FOLDER_ICON
                        ),
                        items: folderItems
                    });
                }
            }
        }
    }

    for (const definition of appendDefinitions) {
        appendItemEntry(definition.key);
    }

    return normalized;
}

export function buildMenuItems(
    layout: NavLayoutEntry[],
    definitionMap: Map<string, NavDefinition>,
    t: TranslateKey
): MenuItem[] {
    const items: MenuItem[] = [];
    for (const entry of layout || []) {
        if (entry.type === 'item') {
            const definition = definitionMap.get(entry.key);
            if (definition) {
                items.push({
                    ...definition,
                    icon: normalizeNavIconKey(
                        entry.icon,
                        definition.icon || DEFAULT_NAV_ICON_KEY
                    ),
                    index: definition.key,
                    title: definition.tooltip || definition.labelKey,
                    titleIsCustom: Boolean(
                        definition.titleIsCustom || definition.isDashboard
                    )
                });
            }
            continue;
        }

        if (entry.type === 'folder') {
            const children = (entry.items || [])
                .map((item): NavMenuItem | null => {
                    const key = getFolderItemKey(item);
                    const definition = definitionMap.get(key);
                    if (!definition) {
                        return null;
                    }
                    return {
                        ...definition,
                        icon: normalizeNavIconKey(
                            getFolderItemIcon(item),
                            definition.icon || DEFAULT_NAV_ICON_KEY
                        ),
                        label: definition.labelKey,
                        index: definition.key,
                        titleIsCustom: Boolean(
                            definition.titleIsCustom || definition.isDashboard
                        )
                    };
                })
                .filter((child): child is NavMenuItem => child !== null);
            if (children.length) {
                items.push({
                    index: entry.id,
                    icon: normalizeNavIconKey(entry.icon, DEFAULT_FOLDER_ICON),
                    title:
                        entry.name?.trim() ||
                        t('nav_menu.custom_nav.folder_name_placeholder'),
                    titleIsCustom: true,
                    children
                });
            }
        }
    }
    return items;
}

export async function loadNavMenuModel({
    dashboards,
    notificationLayout,
    t
}: {
    dashboards?: Dashboard[];
    notificationLayout?: string;
    t: TranslateKey;
}) {
    const dashboardDefinitions = buildDashboardNavDefinitions(dashboards);
    const definitions = [...navDefinitions, ...dashboardDefinitions];
    const definitionMap = createNavDefinitionMap(definitions);
    const defaultLayout = insertDashboardEntries(
        createBaseDefaultNavLayout(t),
        dashboardDefinitions
    );

    let layout: unknown = defaultLayout;
    let hiddenKeys: string[] = [];
    const storedValue = await configRepository.getString(NAV_CONFIG_KEY, '');

    if (storedValue) {
        try {
            const parsed = JSON.parse(storedValue) as unknown;
            if (Array.isArray(parsed)) {
                layout = insertDashboardEntries(parsed, dashboardDefinitions);
            } else if (isRecord(parsed) && Array.isArray(parsed.layout)) {
                hiddenKeys = Array.isArray(parsed.hiddenKeys)
                    ? parsed.hiddenKeys.filter(
                          (key): key is string =>
                              typeof key === 'string' && !isToolNavKey(key)
                      )
                    : [];
                layout = insertDashboardEntries(
                    parsed.layout,
                    dashboardDefinitions,
                    hiddenKeys
                );
            }
        } catch {
            layout = defaultLayout;
            hiddenKeys = [];
        }
    }

    const sanitizedLayout = sanitizeNavLayout({
        layout,
        hiddenKeys,
        definitions,
        appendDefinitions: buildAppendDefinitions(
            navDefinitions,
            dashboardDefinitions,
            layout,
            hiddenKeys
        ),
        t
    });

    let menuItems = buildMenuItems(sanitizedLayout, definitionMap, t);
    if (notificationLayout === 'notification-center') {
        menuItems = menuItems
            .map((item) =>
                item.children
                    ? {
                          ...item,
                          children: item.children.filter(
                              (child) => child.index !== 'notification'
                          )
                      }
                    : item
            )
            .filter(
                (item) =>
                    item.index !== 'notification' &&
                    (!item.children || item.children.length)
            );
    }

    return {
        definitions,
        definitionMap,
        hiddenKeys,
        layout: sanitizedLayout,
        defaultLayout,
        menuItems
    };
}

export async function saveNavMenuModel({
    layout,
    hiddenKeys = [],
    dashboards,
    notificationLayout,
    t
}: {
    layout: unknown;
    hiddenKeys?: unknown;
    dashboards?: Dashboard[];
    notificationLayout?: string;
    t: TranslateKey;
}) {
    const dashboardDefinitions = buildDashboardNavDefinitions(dashboards);
    const definitions = [...navDefinitions, ...dashboardDefinitions];
    const definitionMap = createNavDefinitionMap(definitions);
    const normalizedHiddenKeys = normalizeHiddenKeys(
        (Array.isArray(hiddenKeys) ? hiddenKeys : []).filter(
            (key): key is string =>
                typeof key === 'string' && !isToolNavKey(key)
        ),
        definitionMap
    );
    const sanitizedLayout = sanitizeNavLayout({
        layout,
        hiddenKeys: normalizedHiddenKeys,
        definitions,
        appendDefinitions: buildAppendDefinitions(
            navDefinitions,
            dashboardDefinitions,
            layout,
            normalizedHiddenKeys
        ),
        t
    });

    await configRepository.setString(
        NAV_CONFIG_KEY,
        JSON.stringify({
            layout: sanitizedLayout,
            hiddenKeys: normalizedHiddenKeys
        })
    );
    publishNavLayoutUpdated();

    let menuItems = buildMenuItems(sanitizedLayout, definitionMap, t);
    if (notificationLayout === 'notification-center') {
        menuItems = menuItems
            .map((item) =>
                item.children
                    ? {
                          ...item,
                          children: item.children.filter(
                              (child) => child.index !== 'notification'
                          )
                      }
                    : item
            )
            .filter(
                (item) =>
                    item.index !== 'notification' &&
                    (!item.children || item.children.length)
            );
    }

    return {
        definitions,
        definitionMap,
        hiddenKeys: normalizedHiddenKeys,
        layout: sanitizedLayout,
        defaultLayout: insertDashboardEntries(
            createBaseDefaultNavLayout(t),
            dashboardDefinitions,
            normalizedHiddenKeys
        ),
        menuItems
    };
}

export function getPathForNavEntry(entry: NavDefinition | MenuItem | null) {
    if (!entry) {
        return '';
    }
    if (entry.routeName === 'dashboard' && entry.routeParams?.id) {
        return `/dashboard/${entry.routeParams.id}`;
    }
    if (entry.routeName && entry.routeName in routePathByName) {
        return routePathByName[entry.routeName as keyof typeof routePathByName];
    }
    return entry.path || '';
}
