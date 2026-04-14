import { configRepository } from '@/repositories/index.js';
import { NAV_LAYOUT_UPDATED_EVENT, publishNavLayoutUpdated } from '@/shared/events/navLayoutEvents.js';
import { DASHBOARD_NAV_KEY_PREFIX, DEFAULT_DASHBOARD_ICON } from '@/shared/constants/dashboard.js';
import { isToolNavKey } from '@/shared/constants/tools.js';
import { navDefinitions } from '@/shared/constants/ui.js';

export const NAV_CONFIG_KEY = 'VRCX_customNavMenuLayoutList';
export { NAV_LAYOUT_UPDATED_EVENT };

const DEFAULT_FOLDER_ICON = 'ri-folder-line';
const CHART_KEYS = ['charts-instance', 'charts-mutual'];

export const routePathByName = Object.freeze({
    feed: '/feed',
    'friends-locations': '/friends-locations',
    'game-log': '/game-log',
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
    'screenshot-metadata': '/tools/screenshot-metadata',
    settings: '/settings'
});

export function buildDashboardNavDefinitions(dashboards = []) {
    return dashboards
        .filter((dashboard) => dashboard?.id)
        .map((dashboard) => ({
            key: `${DASHBOARD_NAV_KEY_PREFIX}${dashboard.id}`,
            icon: dashboard.icon || DEFAULT_DASHBOARD_ICON,
            tooltip: dashboard.name || 'Dashboard',
            labelKey: dashboard.name || 'Dashboard',
            titleIsCustom: true,
            isDashboard: true,
            routeName: 'dashboard',
            routeParams: { id: dashboard.id }
        }));
}

export function createBaseDefaultNavLayout(t) {
    return [
        { type: 'item', key: 'feed' },
        { type: 'item', key: 'friends-locations' },
        { type: 'item', key: 'game-log' },
        { type: 'item', key: 'player-list' },
        { type: 'item', key: 'search' },
        {
            type: 'folder',
            id: 'default-folder-favorites',
            nameKey: 'nav_tooltip.favorites',
            name: t('nav_tooltip.favorites'),
            icon: 'ri-star-line',
            items: ['favorite-friends', 'favorite-worlds', 'favorite-avatars']
        },
        {
            type: 'folder',
            id: 'default-folder-social',
            nameKey: 'nav_tooltip.social',
            name: t('nav_tooltip.social'),
            icon: 'ri-group-line',
            items: ['friend-log', 'friend-list', 'moderation']
        },
        { type: 'item', key: 'notification' },
        { type: 'item', key: 'my-avatars' },
        {
            type: 'folder',
            id: 'default-folder-charts',
            nameKey: 'nav_tooltip.charts',
            name: t('nav_tooltip.charts'),
            icon: 'ri-pie-chart-line',
            items: CHART_KEYS
        },
        { type: 'item', key: 'tools' },
        { type: 'item', key: 'direct-access' }
    ];
}

export function insertDashboardEntries(layout, dashboardDefinitions = [], hiddenKeys = []) {
    const nextLayout = Array.isArray(layout) ? [...layout] : [];
    const existingKeys = collectLayoutKeys(nextLayout);
    const hiddenSet = new Set(Array.isArray(hiddenKeys) ? hiddenKeys : []);
    const dashboardEntries = dashboardDefinitions
        .filter((definition) => definition?.key && !existingKeys.has(definition.key) && !hiddenSet.has(definition.key))
        .map((definition) => ({
            type: 'item',
            key: definition.key
        }));

    if (!dashboardEntries.length) {
        return nextLayout;
    }

    const directAccessIndex = nextLayout.findIndex(
        (entry) => entry.type === 'item' && entry.key === 'direct-access'
    );
    if (directAccessIndex >= 0) {
        nextLayout.splice(directAccessIndex, 0, ...dashboardEntries);
        return nextLayout;
    }
    return [...nextLayout, ...dashboardEntries];
}

export function createNavDefinitionMap(definitions = []) {
    return new Map(definitions.filter((definition) => definition?.key).map((definition) => [definition.key, definition]));
}

function collectLayoutKeys(layout) {
    const keys = new Set();
    if (!Array.isArray(layout)) {
        return keys;
    }
    for (const entry of layout) {
        if (entry?.type === 'item' && entry.key) {
            keys.add(entry.key);
        } else if (entry?.type === 'folder' && Array.isArray(entry.items)) {
            for (const key of entry.items) {
                if (key) {
                    keys.add(key);
                }
            }
        }
    }
    return keys;
}

function normalizeHiddenKeys(hiddenKeys, definitionMap) {
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

function buildAppendDefinitions(baseDefinitions, dashboardDefinitions, layout, hiddenKeys) {
    const keysInLayout = collectLayoutKeys(layout);
    const hiddenSet = new Set(Array.isArray(hiddenKeys) ? hiddenKeys : []);
    const visibleBaseDefinitions = baseDefinitions.filter(
        (definition) => !isToolNavKey(definition.key) || keysInLayout.has(definition.key)
    );
    const visibleDashboardDefinitions = dashboardDefinitions.filter(
        (definition) => keysInLayout.has(definition.key) || hiddenSet.has(definition.key)
    );
    return [...visibleBaseDefinitions, ...visibleDashboardDefinitions];
}

export function sanitizeNavLayout({ layout, hiddenKeys, definitions, appendDefinitions, t }) {
    const definitionMap = createNavDefinitionMap(definitions);
    const hiddenSet = new Set(normalizeHiddenKeys(hiddenKeys, definitionMap));
    const usedKeys = new Set();
    const normalized = [];

    const appendItemEntry = (key, target = normalized) => {
        if (!key || usedKeys.has(key) || hiddenSet.has(key) || !definitionMap.has(key)) {
            return;
        }
        target.push({ type: 'item', key });
        usedKeys.add(key);
    };

    const appendChartsFolder = (target = normalized) => {
        if (CHART_KEYS.some((key) => usedKeys.has(key) || hiddenSet.has(key))) {
            return;
        }
        if (!CHART_KEYS.every((key) => definitionMap.has(key))) {
            return;
        }
        CHART_KEYS.forEach((key) => usedKeys.add(key));
        target.push({
            type: 'folder',
            id: 'default-folder-charts',
            nameKey: 'nav_tooltip.charts',
            name: t('nav_tooltip.charts'),
            icon: 'ri-pie-chart-line',
            items: [...CHART_KEYS]
        });
    };

    if (Array.isArray(layout)) {
        for (const entry of layout) {
            if (entry?.type === 'item') {
                if (entry.key === 'charts') {
                    appendChartsFolder();
                } else {
                    appendItemEntry(entry.key);
                }
                continue;
            }

            if (entry?.type === 'folder') {
                const folderItems = [];
                for (const key of entry.items || []) {
                    if (!key || usedKeys.has(key) || hiddenSet.has(key) || !definitionMap.has(key)) {
                        continue;
                    }
                    folderItems.push(key);
                    usedKeys.add(key);
                }
                if (folderItems.length) {
                    const nameKey = entry.nameKey || null;
                    normalized.push({
                        type: 'folder',
                        id: entry.id || `nav-folder-${Math.random().toString(36).slice(2, 8)}`,
                        name: nameKey ? t(nameKey) : entry.name || '',
                        nameKey,
                        icon: entry.icon || DEFAULT_FOLDER_ICON,
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

    const directAccessIndex = normalized.findIndex(
        (entry) => entry.type === 'item' && entry.key === 'direct-access'
    );
    if (directAccessIndex >= 0 && directAccessIndex !== normalized.length - 1) {
        const [directAccessEntry] = normalized.splice(directAccessIndex, 1);
        normalized.push(directAccessEntry);
    }

    return normalized;
}

export function buildMenuItems(layout, definitionMap, t) {
    const items = [];
    for (const entry of layout || []) {
        if (entry.type === 'item') {
            const definition = definitionMap.get(entry.key);
            if (definition) {
                items.push({
                    ...definition,
                    index: definition.key,
                    title: definition.tooltip || definition.labelKey,
                    titleIsCustom: Boolean(definition.titleIsCustom || definition.isDashboard)
                });
            }
            continue;
        }

        if (entry.type === 'folder') {
            const children = (entry.items || [])
                .map((key) => definitionMap.get(key))
                .filter(Boolean)
                .map((definition) => ({
                    ...definition,
                    label: definition.labelKey,
                    index: definition.key,
                    titleIsCustom: Boolean(definition.titleIsCustom || definition.isDashboard)
                }));
            if (children.length) {
                items.push({
                    index: entry.id,
                    icon: entry.icon || DEFAULT_FOLDER_ICON,
                    title: entry.name?.trim() || t('nav_menu.custom_nav.folder_name_placeholder'),
                    titleIsCustom: true,
                    children
                });
            }
        }
    }
    return items;
}

export async function loadNavMenuModel({ dashboards, notificationLayout, t }) {
    const dashboardDefinitions = buildDashboardNavDefinitions(dashboards);
    const definitions = [...navDefinitions, ...dashboardDefinitions];
    const definitionMap = createNavDefinitionMap(definitions);
    const defaultLayout = insertDashboardEntries(createBaseDefaultNavLayout(t), dashboardDefinitions);

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
                    ? parsed.hiddenKeys.filter((key) => !isToolNavKey(key))
                    : [];
                layout = insertDashboardEntries(parsed.layout, dashboardDefinitions, hiddenKeys);
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
        appendDefinitions: buildAppendDefinitions(navDefinitions, dashboardDefinitions, layout, hiddenKeys),
        t
    });

    let menuItems = buildMenuItems(sanitizedLayout, definitionMap, t);
    if (notificationLayout === 'notification-center') {
        menuItems = menuItems
            .map((item) =>
                item.children
                    ? {
                          ...item,
                          children: item.children.filter((child) => child.index !== 'notification')
                      }
                    : item
            )
            .filter((item) => item.index !== 'notification' && (!item.children || item.children.length));
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

export async function saveNavMenuModel({ layout, hiddenKeys = [], dashboards, notificationLayout, t }) {
    const dashboardDefinitions = buildDashboardNavDefinitions(dashboards);
    const definitions = [...navDefinitions, ...dashboardDefinitions];
    const definitionMap = createNavDefinitionMap(definitions);
    const normalizedHiddenKeys = normalizeHiddenKeys(
        (Array.isArray(hiddenKeys) ? hiddenKeys : []).filter((key) => !isToolNavKey(key)),
        definitionMap
    );
    const sanitizedLayout = sanitizeNavLayout({
        layout,
        hiddenKeys: normalizedHiddenKeys,
        definitions,
        appendDefinitions: buildAppendDefinitions(navDefinitions, dashboardDefinitions, layout, normalizedHiddenKeys),
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
                          children: item.children.filter((child) => child.index !== 'notification')
                      }
                    : item
            )
            .filter((item) => item.index !== 'notification' && (!item.children || item.children.length));
    }

    return {
        definitions,
        definitionMap,
        hiddenKeys: normalizedHiddenKeys,
        layout: sanitizedLayout,
        defaultLayout: insertDashboardEntries(createBaseDefaultNavLayout(t), dashboardDefinitions, normalizedHiddenKeys),
        menuItems
    };
}

export function getPathForNavEntry(entry) {
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
