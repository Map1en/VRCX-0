import configRepository from '@/repositories/configRepository';
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

export const NAV_CONFIG_KEY = 'VRCX_customNavMenuLayoutList';
export {
    NAV_CUSTOMIZE_REQUESTED_EVENT,
    NAV_LAYOUT_UPDATED_EVENT,
    publishNavCustomizeRequested
};

const CHART_KEYS = ['charts-instance', 'charts-mutual'];

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
    'charts-instance': '/charts/instance',
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

export function buildDashboardNavDefinitions(dashboards: any[] = []) {
    return dashboards
        .filter((dashboard: any) => dashboard?.id)
        .map((dashboard: any) => ({
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

export function createBaseDefaultNavLayout(t: any) {
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
        {
            type: 'folder',
            id: 'default-folder-charts',
            nameKey: 'nav_tooltip.charts',
            name: t('nav_tooltip.charts'),
            icon: 'lucide:ChartBar',
            items: CHART_KEYS
        },
        { type: 'item', key: 'tools' }
    ];
}

export function insertDashboardEntries(
    layout: any,
    dashboardDefinitions: any[] = [],
    hiddenKeys: any[] = []
) {
    const nextLayout = Array.isArray(layout) ? [...layout] : [];
    const existingKeys = collectLayoutKeys(nextLayout);
    const hiddenSet = new Set(Array.isArray(hiddenKeys) ? hiddenKeys : []);
    const dashboardEntries = dashboardDefinitions
        .filter(
            (definition: any) =>
                definition?.key &&
                !existingKeys.has(definition.key) &&
                !hiddenSet.has(definition.key)
        )
        .map((definition: any) => ({
            type: 'item',
            key: definition.key
        }));

    if (!dashboardEntries.length) {
        return nextLayout;
    }

    return [...nextLayout, ...dashboardEntries];
}

export function createNavDefinitionMap(definitions: any[] = []) {
    return new Map(
        definitions
            .filter((definition: any) => definition?.key)
            .map((definition: any) => [definition.key, definition])
    );
}

function collectLayoutKeys(layout: any) {
    const keys = new Set();
    if (!Array.isArray(layout)) {
        return keys;
    }
    for (const entry of layout) {
        if (entry?.type === 'item' && entry.key) {
            keys.add(entry.key);
        } else if (entry?.type === 'folder' && Array.isArray(entry.items)) {
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

function getFolderItemKey(item: any) {
    return typeof item === 'string' ? item : item?.key;
}

function getFolderItemIcon(item: any) {
    return typeof item === 'object' && item ? item.icon : undefined;
}

function normalizeHiddenKeys(hiddenKeys: any, definitionMap: any) {
    const seen = new Set();
    const normalized = [];
    if (!Array.isArray(hiddenKeys)) {
        return normalized;
    }
    for (const key of hiddenKeys) {
        if (!key || seen.has(key) || !definitionMap.has(key)) {
            continue;
        }
        seen.add(key);
        normalized.push(key);
    }
    return normalized;
}

function buildAppendDefinitions(
    baseDefinitions: any,
    dashboardDefinitions: any,
    layout: any,
    hiddenKeys: any
) {
    const keysInLayout = collectLayoutKeys(layout);
    const hiddenSet = new Set(Array.isArray(hiddenKeys) ? hiddenKeys : []);
    const visibleBaseDefinitions = baseDefinitions.filter(
        (definition: any) =>
            !isToolNavKey(definition.key) || keysInLayout.has(definition.key)
    );
    const visibleDashboardDefinitions = dashboardDefinitions.filter(
        (definition: any) =>
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
}: any) {
    const definitionMap = createNavDefinitionMap(definitions);
    const hiddenSet = new Set(normalizeHiddenKeys(hiddenKeys, definitionMap));
    const usedKeys = new Set();
    const normalized = [];

    const appendItemEntry = (key: any, target: any = normalized, sourceEntry: any = null) => {
        if (
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
        const icon = normalizeNavIconKey(sourceEntry?.icon, defaultIcon);
        const entry: any = { type: 'item', key };
        if (icon && icon !== defaultIcon) {
            entry.icon = icon;
        }
        target.push(entry);
        usedKeys.add(key);
    };

    const appendChartsFolder = (target: any = normalized) => {
        if (CHART_KEYS.some((key: any) => usedKeys.has(key) || hiddenSet.has(key))) {
            return;
        }
        if (!CHART_KEYS.every((key: any) => definitionMap.has(key))) {
            return;
        }
        CHART_KEYS.forEach((key: any) => usedKeys.add(key));
        target.push({
            type: 'folder',
            id: 'default-folder-charts',
            nameKey: 'nav_tooltip.charts',
            name: t('nav_tooltip.charts'),
            icon: 'lucide:ChartBar',
            items: [...CHART_KEYS]
        });
    };

    if (Array.isArray(layout)) {
        for (const entry of layout) {
            if (entry?.type === 'item') {
                if (entry.key === 'charts') {
                    appendChartsFolder();
                } else {
                    appendItemEntry(entry.key, normalized, entry);
                }
                continue;
            }

            if (entry?.type === 'folder') {
                const folderItems = [];
                for (const item of entry.items || []) {
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
                    const nameKey = entry.nameKey || null;
                    normalized.push({
                        type: 'folder',
                        id:
                            entry.id ||
                            `nav-folder-${Math.random().toString(36).slice(2, 8)}`,
                        name: nameKey ? t(nameKey) : entry.name || '',
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
        if (CHART_KEYS.includes(definition.key)) {
            continue;
        }
        appendItemEntry(definition.key);
    }
    appendChartsFolder();

    return normalized;
}

export function buildMenuItems(layout: any, definitionMap: any, t: any) {
    const items = [];
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
                .map((item: any) => {
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
                .filter(Boolean);
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

export async function loadNavMenuModel({ dashboards, notificationLayout, t }: any) {
    const dashboardDefinitions = buildDashboardNavDefinitions(dashboards);
    const definitions = [...navDefinitions, ...dashboardDefinitions];
    const definitionMap = createNavDefinitionMap(definitions);
    const defaultLayout = insertDashboardEntries(
        createBaseDefaultNavLayout(t),
        dashboardDefinitions
    );

    let layout = defaultLayout;
    let hiddenKeys = [];
    const storedValue = await configRepository.getString(NAV_CONFIG_KEY, '');

    if (storedValue) {
        try {
            const parsed = JSON.parse(storedValue);
            if (Array.isArray(parsed)) {
                layout = insertDashboardEntries(parsed, dashboardDefinitions);
            } else if (Array.isArray(parsed?.layout)) {
                hiddenKeys = Array.isArray(parsed.hiddenKeys)
                    ? parsed.hiddenKeys.filter((key: any) => !isToolNavKey(key))
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
            .map((item: any) =>
                item.children
                    ? {
                          ...item,
                          children: item.children.filter(
                              (child: any) => child.index !== 'notification'
                          )
                      }
                    : item
            )
            .filter(
                (item: any) =>
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
}: any) {
    const dashboardDefinitions = buildDashboardNavDefinitions(dashboards);
    const definitions = [...navDefinitions, ...dashboardDefinitions];
    const definitionMap = createNavDefinitionMap(definitions);
    const normalizedHiddenKeys = normalizeHiddenKeys(
        (Array.isArray(hiddenKeys) ? hiddenKeys : []).filter(
            (key: any) => !isToolNavKey(key)
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
            .map((item: any) =>
                item.children
                    ? {
                          ...item,
                          children: item.children.filter(
                              (child: any) => child.index !== 'notification'
                          )
                      }
                    : item
            )
            .filter(
                (item: any) =>
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

export function getPathForNavEntry(entry: any) {
    if (!entry) {
        return '';
    }
    if (entry.routeName === 'dashboard' && entry.routeParams?.id) {
        return `/dashboard/${entry.routeParams.id}`;
    }
    if (entry.routeName && routePathByName[entry.routeName]) {
        return routePathByName[entry.routeName];
    }
    return entry.path || '';
}
