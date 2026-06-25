import {
    DASHBOARD_NAV_KEY_PREFIX,
    DEFAULT_DASHBOARD_ICON
} from '@/shared/constants/dashboard';
import {
    DEFAULT_FOLDER_ICON,
    normalizeNavIconKey
} from '@/shared/constants/navIcons';

export function getFolderItemKey(item: any) {
    return typeof item === 'string' ? item : item?.key;
}

export function getFolderItemIcon(item: any) {
    return typeof item === 'object' && item ? item.icon : undefined;
}

function getLayoutItemKey(entry: unknown): unknown {
    return typeof entry === 'object' && entry && 'key' in entry
        ? entry.key
        : undefined;
}

export function createFolderItem(key: any, icon: any = '') {
    const normalizedIcon = normalizeNavIconKey(icon, '');
    return normalizedIcon ? { key, icon: normalizedIcon } : key;
}

export function getItemSortableId(key: any) {
    return `item:${key}`;
}

export function getFolderSortableId(id: any) {
    return `folder:${id}`;
}

export function getFolderDropId(id: any) {
    return `folder-drop:${id}`;
}

export function getFolderIdFromDropId(id: any) {
    const value = String(id || '');
    return value.startsWith('folder-drop:')
        ? value.slice('folder-drop:'.length)
        : '';
}

export function cloneLayout(source: any) {
    if (!Array.isArray(source)) {
        return [];
    }
    return source
        .map((entry: any) => {
            if (entry?.type === 'folder') {
                return {
                    type: 'folder',
                    id: entry.id,
                    name: entry.name,
                    nameKey: entry.nameKey || null,
                    icon: normalizeNavIconKey(entry.icon, DEFAULT_FOLDER_ICON),
                    items: Array.isArray(entry.items)
                        ? entry.items
                              .map((item: any) => {
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
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
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

export function definitionLabel(definition: any, t: any) {
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

export function removeKeyFromLayout(layout: any, key: any) {
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

export function insertKeyIntoLayout(layout: any, key: any, placement: any) {
    const icon = normalizeNavIconKey(placement?.icon, '');
    const entry: any = { type: 'item', key, ...(icon ? { icon } : {}) };
    const next = cloneLayout(layout);

    if (placement?.parentId) {
        const folder = next.find(
            (item: any) =>
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

export function buildHiddenPlacementMap(layout: any, hiddenKeys: any) {
    const hiddenKeySet = new Set(
        Array.isArray(hiddenKeys)
            ? hiddenKeys.map((key: any) => String(key || '')).filter(Boolean)
            : []
    );
    const placements = new Map();

    for (const [index, entry] of cloneLayout(layout).entries()) {
        if (entry.type === 'item') {
            const key = String(getLayoutItemKey(entry) || '');
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

export function cleanLayout(layout: any) {
    return cloneLayout(layout).filter(
        (entry: any) => entry.type !== 'folder' || entry.items.length
    );
}

export function isDashboardKey(key: any) {
    return String(key || '').startsWith(DASHBOARD_NAV_KEY_PREFIX);
}

interface VisibleNode {
    type: 'folder' | 'item';
    id: string;
    key?: unknown;
    icon?: unknown;
    sortableId: string;
    parentId: string | null;
}

export function buildVisibleNodes(layout: any) {
    const nodes: VisibleNode[] = [];
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

export function resolveDragNode(id: any, nodes: any) {
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

    return nodes.find((node: any) => node.sortableId === value) || null;
}

export function sameDragNode(a: any, b: any) {
    return Boolean(
        a &&
        b &&
        a.type === b.type &&
        a.id === b.id &&
        (a.parentId || null) === (b.parentId || null)
    );
}

export function removeLayoutItem(entries: any, key: any) {
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
                (item: any) => String(getFolderItemKey(item)) === normalizedKey
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

export function findTopLevelIndex(entries: any, node: any) {
    if (!node) {
        return -1;
    }
    return entries.findIndex((entry: any) => {
        if (node.type === 'folder') {
            return entry.type === 'folder' && String(entry.id) === node.id;
        }
        return entry.type === 'item' && String(entry.key) === node.id;
    });
}

export function findFolder(entries: any, folderId: any) {
    return entries.find(
        (entry: any) => entry.type === 'folder' && String(entry.id) === folderId
    );
}

export function findFolderItemIndex(folder: any, node: any) {
    if (!folder || !node) {
        return -1;
    }
    return (folder.items || []).findIndex(
        (item: any) => String(getFolderItemKey(item)) === node.id
    );
}

export { DEFAULT_DASHBOARD_ICON };
