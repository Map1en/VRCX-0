import {
    getEquivalentToolNavKeys,
    getToolsByCategory,
    knownToolKeys,
    normalizePinnedToolKey,
    normalizeQuickAccessToolKeys,
    parseQuickAccessToolKeys,
    quickAccessConfigKey,
    toolCategories
} from '@/shared/constants/tools';

export const categoryConfigKey = 'VRCX_toolsCategoryCollapsed';
export const quickAccessDropId = 'tools-quick-access-drop-zone';
export const toolCatalogDropId = 'tools-catalog-drop-zone';

const quickAccessDragPrefix = 'tools-quick-access-tool:';
const catalogDragPrefix = 'tools-catalog-tool:';
const collapsibleCategories = toolCategories.map((category) => category.key);

export const defaultCollapsedState: Record<string, boolean> = {
    group: false,
    image: false,
    shortcuts: false,
    social: false,
    system: false,
    user: false,
    other: false
};

export const toolsPageCategories = toolCategories
    .filter((category) => collapsibleCategories.includes(category.key))
    .map((category) => ({
        ...category,
        tools: getToolsByCategory(category.key)
    }));

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

export function getQuickAccessDragId(toolKey: unknown): string {
    return `${quickAccessDragPrefix}${toolKey}`;
}

export function getCatalogDragId(toolKey: unknown): string {
    return `${catalogDragPrefix}${toolKey}`;
}

export function collectLayoutKeys(layout: unknown): Set<string> {
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
                const key =
                    typeof item === 'string'
                        ? item
                        : isRecord(item) && typeof item.key === 'string'
                          ? item.key
                          : '';
                if (key) {
                    keys.add(key);
                }
            }
        }
    }
    return keys;
}

export function insertToolNavItem(layout: unknown, navKey: string) {
    const nextLayout = Array.isArray(layout) ? [...layout] : [];
    if (collectLayoutKeys(nextLayout).has(navKey)) {
        return nextLayout;
    }
    const insertIndex = nextLayout.findIndex(
        (entry) =>
            isRecord(entry) &&
            entry.type === 'item' &&
            (entry.key === 'tools' || entry.key === 'direct-access')
    );
    if (insertIndex >= 0) {
        nextLayout.splice(insertIndex, 0, { type: 'item', key: navKey });
        return nextLayout;
    }
    return [...nextLayout, { type: 'item', key: navKey }];
}

export function removeToolNavItem(layout: unknown, navKey: string | string[]) {
    const navKeys = new Set(Array.isArray(navKey) ? navKey : [navKey]);

    return (Array.isArray(layout) ? layout : [])
        .map((entry) => {
            if (!isRecord(entry)) {
                return entry;
            }
            if (entry.type === 'item' && typeof entry.key === 'string') {
                return navKeys.has(entry.key) ? null : entry;
            }
            if (entry.type === 'folder' && Array.isArray(entry.items)) {
                const nextItems = entry.items.filter(
                    (item) =>
                        !navKeys.has(
                            typeof item === 'string'
                                ? item
                                : isRecord(item) && typeof item.key === 'string'
                                  ? item.key
                                  : ''
                        )
                );
                return nextItems.length ? { ...entry, items: nextItems } : null;
            }
            return entry;
        })
        .filter(Boolean);
}

export {
    getEquivalentToolNavKeys,
    knownToolKeys,
    normalizePinnedToolKey,
    normalizeQuickAccessToolKeys,
    parseQuickAccessToolKeys,
    quickAccessConfigKey
};
