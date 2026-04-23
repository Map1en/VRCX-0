import {
    DASHBOARD_NAV_KEY_PREFIX,
    DEFAULT_DASHBOARD_ICON
} from '@/shared/constants/dashboard.js';
import {
    DEFAULT_FOLDER_ICON,
    normalizeNavIconKey
} from '@/shared/constants/navIcons.js';

export function getFolderItemKey(item) {
    return typeof item === 'string' ? item : item?.key;
}

export function getFolderItemIcon(item) {
    return typeof item === 'object' && item ? item.icon : undefined;
}

export function createFolderItem(key, icon = '') {
    const normalizedIcon = normalizeNavIconKey(icon, '');
    return normalizedIcon ? { key, icon: normalizedIcon } : key;
}

export function getItemSortableId(key) {
    return `item:${key}`;
}

export function getFolderSortableId(id) {
    return `folder:${id}`;
}

export function getFolderDropId(id) {
    return `folder-drop:${id}`;
}

export function getFolderIdFromDropId(id) {
    const value = String(id || '');
    return value.startsWith('folder-drop:')
        ? value.slice('folder-drop:'.length)
        : '';
}

export function cloneLayout(source) {
    if (!Array.isArray(source)) {
        return [];
    }
    return source
        .map((entry) => {
            if (entry?.type === 'folder') {
                return {
                    type: 'folder',
                    id: entry.id,
                    name: entry.name,
                    nameKey: entry.nameKey || null,
                    icon: normalizeNavIconKey(entry.icon, DEFAULT_FOLDER_ICON),
                    items: Array.isArray(entry.items)
                        ? entry.items
                              .map((item) => {
                                  const key = getFolderItemKey(item);
                                  return key
                                      ? createFolderItem(
                                            key,
                                            getFolderItemIcon(item)
                                        )
                                      : null;
                              })
                              .filter(Boolean)
                        : []
                };
            }
            if (entry?.type === 'item') {
                const icon = normalizeNavIconKey(entry.icon, '');
                return {
                    type: 'item',
                    key: entry.key,
                    ...(icon ? { icon } : {})
                };
            }
            return null;
        })
        .filter(Boolean);
}

export function createFolderId() {
    if (
        typeof crypto !== 'undefined' &&
        typeof crypto.randomUUID === 'function'
    ) {
        return `custom-folder-${crypto.randomUUID()}`;
    }
    return `custom-folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function definitionLabel(definition, t) {
    if (!definition) {
        return '';
    }
    if (definition.titleIsCustom || definition.isDashboard) {
        return (
            definition.labelKey || definition.tooltip || definition.key || ''
        );
    }
    return t(definition.labelKey || definition.tooltip || definition.key || '');
}

export function removeKeyFromLayout(layout, key) {
    const normalizedKey = String(key || '');
    let removed = false;
    let placement = null;
    const next = [];

    for (let index = 0; index < layout.length; index += 1) {
        const entry = layout[index];
        if (entry.type === 'item') {
            if (entry.key === normalizedKey) {
                removed = true;
                placement = { parentId: null, index, icon: entry.icon };
                continue;
            }
            next.push(entry);
            continue;
        }

        if (entry.type === 'folder') {
            const items = [];
            for (
                let itemIndex = 0;
                itemIndex < (entry.items || []).length;
                itemIndex += 1
            ) {
                const item = entry.items[itemIndex];
                const itemKey = getFolderItemKey(item);
                if (itemKey === normalizedKey) {
                    removed = true;
                    placement = {
                        parentId: entry.id,
                        index: itemIndex,
                        icon: getFolderItemIcon(item)
                    };
                    continue;
                }
                items.push(item);
            }
            next.push({
                ...entry,
                items
            });
        }
    }

    return {
        layout: next,
        removed,
        placement
    };
}

export function insertKeyIntoLayout(layout, key, placement) {
    const icon = normalizeNavIconKey(placement?.icon, '');
    const entry = { type: 'item', key, ...(icon ? { icon } : {}) };
    const next = cloneLayout(layout);

    if (placement?.parentId) {
        const folder = next.find(
            (item) =>
                item.type === 'folder' &&
                String(item.id) === String(placement.parentId)
        );
        if (folder) {
            const index = Math.max(
                0,
                Math.min(placement.index, folder.items.length)
            );
            folder.items.splice(index, 0, createFolderItem(key, icon));
            return next;
        }
    }

    if (placement && placement.parentId === null) {
        const index = Math.max(0, Math.min(placement.index, next.length));
        next.splice(index, 0, entry);
        return next;
    }

    return [...next, entry];
}

export function buildHiddenPlacementMap(layout, hiddenKeys) {
    const hiddenKeySet = new Set(
        Array.isArray(hiddenKeys)
            ? hiddenKeys.map((key) => String(key || '')).filter(Boolean)
            : []
    );
    const placements = new Map();

    for (const [index, entry] of cloneLayout(layout).entries()) {
        if (entry.type === 'item') {
            const key = String(entry.key || '');
            if (hiddenKeySet.has(key)) {
                placements.set(key, {
                    parentId: null,
                    index,
                    icon: entry.icon
                });
            }
            continue;
        }

        if (entry.type === 'folder') {
            for (const [itemIndex, item] of (entry.items || []).entries()) {
                const key = String(getFolderItemKey(item) || '');
                if (!hiddenKeySet.has(key)) {
                    continue;
                }
                placements.set(key, {
                    parentId: entry.id,
                    index: itemIndex,
                    icon: getFolderItemIcon(item)
                });
            }
        }
    }

    return placements;
}

export function cleanLayout(layout) {
    return cloneLayout(layout).filter(
        (entry) => entry.type !== 'folder' || entry.items.length
    );
}

export function isDashboardKey(key) {
    return String(key || '').startsWith(DASHBOARD_NAV_KEY_PREFIX);
}

export function buildVisibleNodes(layout) {
    const nodes = [];
    for (const entry of layout || []) {
        if (entry.type === 'folder') {
            const folderId = String(entry.id);
            nodes.push({
                type: 'folder',
                id: folderId,
                sortableId: getFolderSortableId(folderId),
                parentId: null
            });
            for (const item of entry.items || []) {
                const key = getFolderItemKey(item);
                if (!key) {
                    continue;
                }
                nodes.push({
                    type: 'item',
                    id: String(key),
                    key,
                    icon: getFolderItemIcon(item),
                    sortableId: getItemSortableId(key),
                    parentId: folderId
                });
            }
            continue;
        }
        if (entry.type === 'item' && entry.key) {
            nodes.push({
                type: 'item',
                id: String(entry.key),
                key: entry.key,
                icon: entry.icon,
                sortableId: getItemSortableId(entry.key),
                parentId: null
            });
        }
    }
    return nodes;
}

export function resolveDragNode(id, nodes) {
    const value = String(id || '');
    if (!value) {
        return null;
    }

    const dropFolderId = getFolderIdFromDropId(value);
    if (dropFolderId) {
        return {
            type: 'folder-drop',
            id: dropFolderId,
            parentId: null,
            sortableId: value
        };
    }

    return nodes.find((node) => node.sortableId === value) || null;
}

export function sameDragNode(a, b) {
    return Boolean(
        a &&
        b &&
        a.type === b.type &&
        a.id === b.id &&
        (a.parentId || null) === (b.parentId || null)
    );
}

export function removeLayoutItem(entries, key) {
    const normalizedKey = String(key || '');
    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (entry.type === 'item' && String(entry.key) === normalizedKey) {
            const [removed] = entries.splice(index, 1);
            return {
                key: removed.key,
                icon: removed.icon
            };
        }
        if (entry.type === 'folder') {
            const itemIndex = (entry.items || []).findIndex(
                (item) => String(getFolderItemKey(item)) === normalizedKey
            );
            if (itemIndex >= 0) {
                const [removed] = entry.items.splice(itemIndex, 1);
                return {
                    key: getFolderItemKey(removed),
                    icon: getFolderItemIcon(removed)
                };
            }
        }
    }
    return null;
}

export function findTopLevelIndex(entries, node) {
    if (!node) {
        return -1;
    }
    return entries.findIndex((entry) => {
        if (node.type === 'folder') {
            return entry.type === 'folder' && String(entry.id) === node.id;
        }
        return entry.type === 'item' && String(entry.key) === node.id;
    });
}

export function findFolder(entries, folderId) {
    return entries.find(
        (entry) => entry.type === 'folder' && String(entry.id) === folderId
    );
}

export function findFolderItemIndex(folder, node) {
    if (!folder || !node) {
        return -1;
    }
    return (folder.items || []).findIndex(
        (item) => String(getFolderItemKey(item)) === node.id
    );
}

export { DEFAULT_DASHBOARD_ICON };
