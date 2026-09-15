import { DASHBOARD_NAV_KEY_PREFIX } from '@/shared/constants/dashboard';
import {
    DEFAULT_FOLDER_ICON,
    normalizeNavIconKey
} from '@/shared/constants/navIcons';
import { isRecord } from '@/shared/utils/record';

export type CustomNavFolderItem =
    | string
    | {
          key: string;
          icon?: string;
      };

export type CustomNavItemEntry = {
    type: 'item';
    key: string;
    icon?: string;
};

export type CustomNavFolderEntry = {
    type: 'folder';
    id: string;
    name?: string;
    nameKey?: string | null;
    icon?: string;
    items: CustomNavFolderItem[];
};

type CustomNavLayoutEntry = CustomNavItemEntry | CustomNavFolderEntry;

export type CustomNavLayout = CustomNavLayoutEntry[];

export type CustomNavHiddenPlacement = {
    parentId: string | null;
    index: number;
    icon?: string;
};

export type CustomNavDefinition = {
    key?: string;
    icon?: string;
    isDashboard?: boolean;
    labelKey?: string;
    titleIsCustom?: boolean;
    tooltip?: string;
};

export type VisibleNode =
    | {
          type: 'folder';
          id: string;
          sortableId: string;
          parentId: null;
      }
    | {
          type: 'item';
          id: string;
          key: string;
          icon?: string;
          sortableId: string;
          parentId: string | null;
      };

export type CustomNavDragNode =
    | VisibleNode
    | {
          type: 'folder-drop';
          id: string;
          parentId: null;
          sortableId: string;
      };

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function rawFolderItemKey(item: unknown): string {
    return typeof item === 'string'
        ? item
        : isRecord(item)
          ? stringValue(item.key)
          : '';
}

function rawFolderItemIcon(item: unknown): string | undefined {
    const icon = isRecord(item) ? stringValue(item.icon) : '';
    return icon || undefined;
}

export function getFolderItemKey(item: CustomNavFolderItem): string {
    return typeof item === 'string' ? item : item.key;
}

export function getFolderItemIcon(
    item: CustomNavFolderItem
): string | undefined {
    return typeof item === 'string' ? undefined : item.icon;
}

export function createFolderItem(
    key: string,
    icon: string = ''
): CustomNavFolderItem {
    const normalizedIcon = normalizeNavIconKey(icon, '');
    return normalizedIcon ? { key, icon: normalizedIcon } : key;
}

export function getItemSortableId(key: string) {
    return `item:${key}`;
}

export function getFolderSortableId(id: string) {
    return `folder:${id}`;
}

export function getFolderDropId(id: string) {
    return `folder-drop:${id}`;
}

function getFolderIdFromDropId(id: string) {
    return id.startsWith('folder-drop:') ? id.slice('folder-drop:'.length) : '';
}

export function cloneLayout(source: unknown): CustomNavLayout {
    if (!Array.isArray(source)) {
        return [];
    }
    return source
        .map((entry): CustomNavLayoutEntry | null => {
            if (!isRecord(entry)) {
                return null;
            }
            if (entry.type === 'folder') {
                const id = stringValue(entry.id);
                if (!id) {
                    return null;
                }
                return {
                    type: 'folder',
                    id,
                    name: stringValue(entry.name),
                    nameKey: stringValue(entry.nameKey) || null,
                    icon: normalizeNavIconKey(entry.icon, DEFAULT_FOLDER_ICON),
                    items: Array.isArray(entry.items)
                        ? entry.items
                              .map((item) => {
                                  const key = rawFolderItemKey(item);
                                  return key
                                      ? createFolderItem(
                                            key,
                                            rawFolderItemIcon(item)
                                        )
                                      : null;
                              })
                              .filter((item): item is CustomNavFolderItem =>
                                  Boolean(item)
                              )
                        : []
                };
            }
            if (entry.type === 'item') {
                const key = stringValue(entry.key);
                if (!key) {
                    return null;
                }
                const icon = normalizeNavIconKey(entry.icon, '');
                return {
                    type: 'item',
                    key,
                    ...(icon ? { icon } : {})
                };
            }
            return null;
        })
        .filter((entry): entry is CustomNavLayoutEntry => entry !== null);
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

export function definitionLabel(
    definition: CustomNavDefinition | null | undefined,
    t: (key: string) => string
) {
    if (!definition) {
        return '';
    }
    const label =
        definition.labelKey || definition.tooltip || definition.key || '';
    return definition.titleIsCustom || definition.isDashboard
        ? label
        : t(label);
}

export function removeKeyFromLayout(layout: CustomNavLayout, key: string) {
    const normalizedKey = key;
    let removed = false;
    let placement: CustomNavHiddenPlacement | null = null;
    const next: CustomNavLayout = [];

    for (const [index, entry] of cloneLayout(layout).entries()) {
        if (entry.type === 'item') {
            if (entry.key === normalizedKey) {
                removed = true;
                placement = { parentId: null, index, icon: entry.icon };
                continue;
            }
            next.push(entry);
            continue;
        }

        const items: CustomNavFolderItem[] = [];
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

    return {
        layout: next,
        removed,
        placement
    };
}

export function insertKeyIntoLayout(
    layout: CustomNavLayout,
    key: string,
    placement: CustomNavHiddenPlacement | null | undefined
) {
    const icon = normalizeNavIconKey(placement?.icon, '');
    const entry: CustomNavItemEntry = {
        type: 'item',
        key,
        ...(icon ? { icon } : {})
    };
    const next = cloneLayout(layout);

    if (placement?.parentId) {
        const folder = next.find(
            (item): item is CustomNavFolderEntry =>
                item.type === 'folder' && item.id === placement.parentId
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

export function buildHiddenPlacementMap(
    layout: unknown,
    hiddenKeys: readonly string[] = []
) {
    const hiddenKeySet = new Set(hiddenKeys);
    const placements = new Map<string, CustomNavHiddenPlacement>();

    for (const [index, entry] of cloneLayout(layout).entries()) {
        if (entry.type === 'item') {
            const key = entry.key;
            if (hiddenKeySet.has(key)) {
                placements.set(key, {
                    parentId: null,
                    index,
                    icon: entry.icon
                });
            }
            continue;
        }

        for (const [itemIndex, item] of (entry.items || []).entries()) {
            const key = getFolderItemKey(item);
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

    return placements;
}

export function cleanLayout(layout: CustomNavLayout) {
    return cloneLayout(layout).filter(
        (entry) => entry.type !== 'folder' || entry.items.length
    );
}

export function isDashboardKey(key: string) {
    return key.startsWith(DASHBOARD_NAV_KEY_PREFIX);
}

export function buildVisibleNodes(layout: CustomNavLayout) {
    const nodes: VisibleNode[] = [];
    for (const entry of cloneLayout(layout)) {
        if (entry.type === 'folder') {
            const folderId = entry.id;
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
                    id: key,
                    key,
                    icon: getFolderItemIcon(item),
                    sortableId: getItemSortableId(key),
                    parentId: folderId
                });
            }
            continue;
        }
        nodes.push({
            type: 'item',
            id: entry.key,
            key: entry.key,
            icon: entry.icon,
            sortableId: getItemSortableId(entry.key),
            parentId: null
        });
    }
    return nodes;
}

export function resolveDragNode(
    id: string | number | null | undefined,
    nodes: readonly VisibleNode[]
): CustomNavDragNode | null {
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

export function sameDragNode(
    a: CustomNavDragNode | null | undefined,
    b: CustomNavDragNode | null | undefined
) {
    return Boolean(
        a &&
        b &&
        a.type === b.type &&
        a.id === b.id &&
        (a.parentId || null) === (b.parentId || null)
    );
}

export function removeLayoutItem(
    entries: CustomNavLayout,
    key: string
): { key: string; icon?: string } | null {
    const normalizedKey = key;
    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (entry.type === 'item' && entry.key === normalizedKey) {
            const removedKey = entry.key;
            const removedIcon = entry.icon;
            entries.splice(index, 1);
            return {
                key: removedKey,
                icon: removedIcon
            };
        }
        if (entry.type === 'folder') {
            const itemIndex = (entry.items || []).findIndex(
                (item) => getFolderItemKey(item) === normalizedKey
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

export function findTopLevelIndex(
    entries: CustomNavLayout,
    node: CustomNavDragNode | null | undefined
) {
    if (!node) {
        return -1;
    }
    return entries.findIndex((entry) => {
        if (node.type === 'folder') {
            return entry.type === 'folder' && entry.id === node.id;
        }
        return entry.type === 'item' && entry.key === node.id;
    });
}

export function findFolder(entries: CustomNavLayout, folderId: string) {
    return entries.find(
        (entry): entry is CustomNavFolderEntry =>
            entry.type === 'folder' && entry.id === folderId
    );
}

export function findFolderItemIndex(
    folder: CustomNavFolderEntry | null | undefined,
    node: CustomNavDragNode | null | undefined
) {
    if (!folder || !node) {
        return -1;
    }
    return (folder.items || []).findIndex(
        (item) => getFolderItemKey(item) === node.id
    );
}
