import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useDroppable,
    useSensor,
    useSensors
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    EyeIcon,
    EyeOffIcon,
    FolderPlusIcon,
    FolderXIcon,
    GripVerticalIcon,
    PencilIcon,
    PlusIcon,
    RotateCcwIcon,
    Trash2Icon
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils.js';
import {
    DASHBOARD_NAV_KEY_PREFIX,
    DEFAULT_DASHBOARD_ICON
} from '@/shared/constants/dashboard.js';
import {
    DEFAULT_FOLDER_ICON,
    DEFAULT_NAV_ICON_KEY,
    NAV_ICON_OPTIONS,
    getNavIconComponent,
    normalizeNavIconKey
} from '@/shared/constants/navIcons.js';
import { isToolNavKey } from '@/shared/constants/tools.js';
import { useDashboardStore } from '@/state/dashboardStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Separator } from '@/ui/shadcn/separator';

function getFolderItemKey(item) {
    return typeof item === 'string' ? item : item?.key;
}

function getFolderItemIcon(item) {
    return typeof item === 'object' && item ? item.icon : undefined;
}

function createFolderItem(key, icon = '') {
    const normalizedIcon = normalizeNavIconKey(icon, '');
    return normalizedIcon ? { key, icon: normalizedIcon } : key;
}

function getItemSortableId(key) {
    return `item:${key}`;
}

function getFolderSortableId(id) {
    return `folder:${id}`;
}

function getFolderDropId(id) {
    return `folder-drop:${id}`;
}

function getFolderIdFromDropId(id) {
    const value = String(id || '');
    return value.startsWith('folder-drop:')
        ? value.slice('folder-drop:'.length)
        : '';
}

function cloneLayout(source) {
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

function createFolderId() {
    if (
        typeof crypto !== 'undefined' &&
        typeof crypto.randomUUID === 'function'
    ) {
        return `custom-folder-${crypto.randomUUID()}`;
    }
    return `custom-folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function definitionLabel(definition, t) {
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

function removeKeyFromLayout(layout, key) {
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

function insertKeyIntoLayout(layout, key, placement) {
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

function cleanLayout(layout) {
    return cloneLayout(layout).filter(
        (entry) => entry.type !== 'folder' || entry.items.length
    );
}

function isDashboardKey(key) {
    return String(key || '').startsWith(DASHBOARD_NAV_KEY_PREFIX);
}

function buildVisibleNodes(layout) {
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

function resolveDragNode(id, nodes) {
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

function sameDragNode(a, b) {
    return Boolean(
        a &&
        b &&
        a.type === b.type &&
        a.id === b.id &&
        (a.parentId || null) === (b.parentId || null)
    );
}

function removeLayoutItem(entries, key) {
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

function findTopLevelIndex(entries, node) {
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

function findFolder(entries, folderId) {
    return entries.find(
        (entry) => entry.type === 'folder' && String(entry.id) === folderId
    );
}

function findFolderItemIndex(folder, node) {
    if (!folder || !node) {
        return -1;
    }
    return (folder.items || []).findIndex(
        (item) => String(getFolderItemKey(item)) === node.id
    );
}

function NavIconSelect({ value, fallbackIcon, ariaLabel, onValueChange }) {
    const normalizedIcon = normalizeNavIconKey(value, fallbackIcon);

    return (
        <Select value={normalizedIcon} onValueChange={onValueChange}>
            <SelectTrigger size="sm" className="w-32" aria-label={ariaLabel}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
                <SelectGroup>
                    {NAV_ICON_OPTIONS.map((option) => {
                        const OptionIcon = getNavIconComponent(option.key);
                        return (
                            <SelectItem key={option.key} value={option.key}>
                                <span className="flex min-w-0 items-center gap-2">
                                    <OptionIcon data-icon="inline-start" />
                                    <span className="truncate">
                                        {option.label}
                                    </span>
                                </span>
                            </SelectItem>
                        );
                    })}
                </SelectGroup>
            </SelectContent>
        </Select>
    );
}

function NavItemRow({
    label,
    icon,
    fallbackIcon = DEFAULT_NAV_ICON_KEY,
    indent = false,
    rowRef,
    rowStyle,
    dragHandleProps,
    isDragging = false,
    isTool,
    isDashboard,
    onHide,
    onIconChange,
    onEditDashboard,
    onDeleteDashboard
}) {
    return (
        <div
            ref={rowRef}
            style={rowStyle}
            className={cn(
                'flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition-colors',
                isDragging && 'opacity-50',
                indent && 'ml-6'
            )}
        >
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 cursor-grab touch-none active:cursor-grabbing"
                aria-label={`Drag ${label}`}
                {...dragHandleProps}
            >
                <GripVerticalIcon data-icon="inline-start" />
            </Button>
            {onIconChange ? (
                <NavIconSelect
                    value={icon}
                    fallbackIcon={fallbackIcon}
                    ariaLabel={`Icon for ${label}`}
                    onValueChange={onIconChange}
                />
            ) : null}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {isDashboard ? (
                <>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${label}`}
                        onClick={onEditDashboard}
                    >
                        <PencilIcon data-icon="inline-start" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${label}`}
                        onClick={onDeleteDashboard}
                    >
                        <Trash2Icon data-icon="inline-start" />
                    </Button>
                </>
            ) : null}
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`${isTool ? 'Remove' : 'Hide'} ${label}`}
                onClick={onHide}
            >
                {isTool ? (
                    <Trash2Icon data-icon="inline-start" />
                ) : (
                    <EyeOffIcon data-icon="inline-start" />
                )}
            </Button>
        </div>
    );
}

function SortableNavItemRow({ id, children }) {
    const {
        attributes,
        listeners,
        setActivatorNodeRef,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id });
    const rowStyle = {
        transform: CSS.Transform.toString(transform),
        transition
    };
    const dragHandleProps = {
        ...attributes,
        ...listeners,
        ref: setActivatorNodeRef,
        onClick: (event) => event.stopPropagation()
    };

    return children({
        rowRef: setNodeRef,
        rowStyle,
        dragHandleProps,
        isDragging
    });
}

function FolderDropZone({ folderId, label }) {
    const { setNodeRef } = useDroppable({
        id: getFolderDropId(folderId)
    });

    return (
        <div
            ref={setNodeRef}
            className="text-muted-foreground ml-6 rounded-md border border-dashed px-2 py-1.5 text-sm"
        >
            {label}
        </div>
    );
}

export function CustomNavDialog({
    open,
    layout,
    hiddenKeys,
    defaultLayout,
    defaultHiddenKeys = [],
    definitions,
    onOpenChange,
    onSave,
    onDashboardCreated,
    t
}) {
    const prompt = useModalStore((state) => state.prompt);
    const confirm = useModalStore((state) => state.confirm);
    const createDashboard = useDashboardStore((state) => state.createDashboard);
    const updateDashboard = useDashboardStore((state) => state.updateDashboard);
    const deleteDashboard = useDashboardStore((state) => state.deleteDashboard);
    const getDashboard = useDashboardStore((state) => state.getDashboard);
    const [localLayout, setLocalLayout] = useState(() => cloneLayout(layout));
    const [localHiddenKeys, setLocalHiddenKeys] = useState(
        () => new Set(hiddenKeys || [])
    );
    const [hiddenPlacement, setHiddenPlacement] = useState(() => new Map());
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 6
            }
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates
        })
    );

    useEffect(() => {
        if (!open) {
            return;
        }
        setLocalLayout(cloneLayout(layout));
        setLocalHiddenKeys(
            new Set((hiddenKeys || []).filter((key) => !isToolNavKey(key)))
        );
        setHiddenPlacement(new Map());
    }, [hiddenKeys, layout, open]);

    const definitionMap = useMemo(
        () =>
            new Map(
                (definitions || [])
                    .filter((definition) => definition?.key)
                    .map((definition) => [definition.key, definition])
            ),
        [definitions]
    );

    const hiddenItems = useMemo(
        () =>
            (definitions || [])
                .filter(
                    (definition) =>
                        localHiddenKeys.has(definition.key) &&
                        !isToolNavKey(definition.key)
                )
                .map((definition) => ({
                    key: definition.key,
                    label: definitionLabel(definition, t)
                })),
        [definitions, localHiddenKeys, t]
    );
    const visibleNodes = useMemo(
        () => buildVisibleNodes(localLayout),
        [localLayout]
    );
    const sortableNodeIds = useMemo(
        () => visibleNodes.map((node) => node.sortableId),
        [visibleNodes]
    );

    function updateFolderItems(folderIndex, updater) {
        setLocalLayout((current) =>
            current.map((entry, index) =>
                index === folderIndex && entry.type === 'folder'
                    ? {
                          ...entry,
                          items: updater(entry.items || [])
                      }
                    : entry
            )
        );
    }

    function updateEntryIcon(index, icon, fallbackIcon) {
        const normalizedIcon = normalizeNavIconKey(icon, fallbackIcon);
        setLocalLayout((current) =>
            current.map((entry, entryIndex) =>
                entryIndex === index
                    ? {
                          ...entry,
                          icon: normalizedIcon
                      }
                    : entry
            )
        );
    }

    function updateFolderChildIcon(folderIndex, itemIndex, icon, fallbackIcon) {
        const normalizedIcon = normalizeNavIconKey(icon, fallbackIcon);
        updateFolderItems(folderIndex, (items) =>
            items.map((item, index) => {
                if (index !== itemIndex) {
                    return item;
                }
                const key = getFolderItemKey(item);
                if (!key) {
                    return item;
                }
                return createFolderItem(key, normalizedIcon);
            })
        );
    }

    function moveItemByDrag(activeNode, targetNode) {
        if (!activeNode || !targetNode) {
            return;
        }
        setLocalLayout((current) => {
            const nodes = buildVisibleNodes(current);
            const sourceIndex = nodes.findIndex((node) =>
                sameDragNode(node, activeNode)
            );
            const targetIndex = nodes.findIndex((node) =>
                sameDragNode(node, targetNode)
            );
            const movingDown =
                sourceIndex >= 0 && targetIndex >= 0
                    ? sourceIndex < targetIndex
                    : false;
            const next = cloneLayout(current);
            const removed = removeLayoutItem(next, activeNode.key);
            if (!removed?.key) {
                return current;
            }
            const itemIcon = removed.icon || activeNode.icon || '';

            if (
                targetNode.type === 'folder' ||
                targetNode.type === 'folder-drop'
            ) {
                const folder = findFolder(next, targetNode.id);
                if (!folder) {
                    return current;
                }
                folder.items.push(createFolderItem(removed.key, itemIcon));
                return next;
            }

            if (targetNode.parentId) {
                const folder = findFolder(next, targetNode.parentId);
                if (!folder) {
                    return current;
                }
                const targetItemIndex = findFolderItemIndex(folder, targetNode);
                if (targetItemIndex < 0) {
                    return current;
                }
                folder.items.splice(
                    targetItemIndex + (movingDown ? 1 : 0),
                    0,
                    createFolderItem(removed.key, itemIcon)
                );
                return next;
            }

            const targetTopIndex = findTopLevelIndex(next, targetNode);
            if (targetTopIndex < 0) {
                return current;
            }
            next.splice(targetTopIndex + (movingDown ? 1 : 0), 0, {
                type: 'item',
                key: removed.key,
                ...(itemIcon ? { icon: normalizeNavIconKey(itemIcon, '') } : {})
            });
            return next;
        });
    }

    function moveFolderByDrag(activeNode, targetNode) {
        if (!activeNode || !targetNode || targetNode.type === 'folder-drop') {
            return;
        }
        setLocalLayout((current) => {
            const nodes = buildVisibleNodes(current);
            const sourceIndex = nodes.findIndex((node) =>
                sameDragNode(node, activeNode)
            );
            let normalizedTargetNode = targetNode;
            if (targetNode.parentId) {
                normalizedTargetNode =
                    nodes.find(
                        (node) =>
                            node.type === 'folder' &&
                            node.id === targetNode.parentId
                    ) || targetNode;
            }
            if (normalizedTargetNode.parentId) {
                return current;
            }
            const targetIndex = nodes.findIndex((node) =>
                sameDragNode(node, normalizedTargetNode)
            );
            const movingDown =
                sourceIndex >= 0 && targetIndex >= 0
                    ? sourceIndex < targetIndex
                    : false;
            const next = cloneLayout(current);
            const sourceTopIndex = findTopLevelIndex(next, activeNode);
            if (sourceTopIndex < 0) {
                return current;
            }
            const [folder] = next.splice(sourceTopIndex, 1);
            const targetTopIndex = findTopLevelIndex(
                next,
                normalizedTargetNode
            );
            if (targetTopIndex < 0) {
                return current;
            }
            next.splice(targetTopIndex + (movingDown ? 1 : 0), 0, folder);
            return next;
        });
    }

    function handleDragEnd(event) {
        const activeNode = resolveDragNode(event.active?.id, visibleNodes);
        let targetNode = resolveDragNode(event.over?.id, visibleNodes);

        if (
            !activeNode ||
            !targetNode ||
            sameDragNode(activeNode, targetNode)
        ) {
            return;
        }
        if (activeNode.type === 'folder') {
            if (targetNode.parentId) {
                targetNode =
                    visibleNodes.find(
                        (node) =>
                            node.type === 'folder' &&
                            node.id === targetNode.parentId
                    ) || targetNode;
            }
            moveFolderByDrag(activeNode, targetNode);
            return;
        }
        moveItemByDrag(activeNode, targetNode);
    }

    function hideItem(key) {
        const result = removeKeyFromLayout(localLayout, key);
        setLocalLayout(result.layout);
        if (result.placement) {
            setHiddenPlacement((current) =>
                new Map(current).set(key, result.placement)
            );
        }
        if (!isToolNavKey(key)) {
            setLocalHiddenKeys((current) => {
                const next = new Set(current);
                next.add(key);
                return next;
            });
        }
    }

    function showItem(key) {
        const placement = hiddenPlacement.get(key) || null;
        setLocalHiddenKeys((current) => {
            const next = new Set(current);
            next.delete(key);
            return next;
        });
        setHiddenPlacement((current) => {
            const next = new Map(current);
            next.delete(key);
            return next;
        });
        setLocalLayout((current) =>
            insertKeyIntoLayout(current, key, placement)
        );
    }

    async function addFolder() {
        const result = await prompt({
            title: t('nav_menu.custom_nav.new_folder'),
            inputValue: '',
            confirmText: t('common.actions.confirm'),
            cancelText: t('nav_menu.custom_nav.cancel'),
            pattern: /\S+/
        });
        if (!result.ok) {
            return;
        }
        setLocalLayout((current) => [
            ...current,
            {
                type: 'folder',
                id: createFolderId(),
                name: String(result.value || '').trim(),
                nameKey: null,
                icon: normalizeNavIconKey(DEFAULT_FOLDER_ICON),
                items: []
            }
        ]);
    }

    async function editFolder(folderIndex) {
        const folder = localLayout[folderIndex];
        if (!folder || folder.type !== 'folder') {
            return;
        }
        const result = await prompt({
            title: t('nav_menu.custom_nav.edit_folder'),
            inputValue: folder.name || '',
            confirmText: t('common.actions.confirm'),
            cancelText: t('nav_menu.custom_nav.cancel'),
            pattern: /\S+/
        });
        if (!result.ok) {
            return;
        }
        setLocalLayout((current) =>
            current.map((entry, index) =>
                index === folderIndex
                    ? {
                          ...entry,
                          name: String(result.value || '').trim(),
                          nameKey: null
                      }
                    : entry
            )
        );
    }

    function deleteFolder(folderIndex) {
        setLocalLayout((current) => {
            const folder = current[folderIndex];
            if (!folder || folder.type !== 'folder') {
                return current;
            }
            const next = [...current];
            next.splice(
                folderIndex,
                1,
                ...(folder.items || [])
                    .map((item) => {
                        const key = getFolderItemKey(item);
                        if (!key) {
                            return null;
                        }
                        const icon = normalizeNavIconKey(
                            getFolderItemIcon(item),
                            ''
                        );
                        return {
                            type: 'item',
                            key,
                            ...(icon ? { icon } : {})
                        };
                    })
                    .filter(Boolean)
            );
            return next;
        });
    }

    async function addDashboard() {
        try {
            const dashboard = await createDashboard(
                t('dashboard.default_name')
            );
            const key = `${DASHBOARD_NAV_KEY_PREFIX}${dashboard.id}`;
            const nextLayout = [...localLayout, { type: 'item', key }];
            setLocalLayout(nextLayout);
            await onDashboardCreated?.(dashboard.id, cleanLayout(nextLayout), [
                ...localHiddenKeys
            ]);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Failed to create dashboard.'
            );
        }
    }

    async function editDashboard(key) {
        const dashboardId = String(key || '').replace(
            DASHBOARD_NAV_KEY_PREFIX,
            ''
        );
        const dashboard = getDashboard(dashboardId);
        if (!dashboard) {
            return;
        }
        const nameResult = await prompt({
            title: t('nav_menu.custom_nav.edit_dashboard'),
            description: dashboard.id,
            inputValue: dashboard.name || '',
            confirmText: t('common.actions.confirm'),
            cancelText: t('nav_menu.custom_nav.cancel'),
            pattern: /\S+/
        });
        if (!nameResult.ok) {
            return;
        }
        try {
            await updateDashboard(dashboardId, {
                name: String(nameResult.value || '').trim(),
                icon: normalizeNavIconKey(
                    dashboard.icon,
                    DEFAULT_DASHBOARD_ICON
                )
            });
            toast.success(t('message.update_success'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Failed to update dashboard.'
            );
        }
    }

    async function removeDashboard(key) {
        const dashboardId = String(key || '').replace(
            DASHBOARD_NAV_KEY_PREFIX,
            ''
        );
        const result = await confirm({
            title: t('dashboard.confirmations.delete_title'),
            description: t('dashboard.confirmations.delete_description'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        try {
            await deleteDashboard(dashboardId);
            setLocalLayout(
                (current) => removeKeyFromLayout(current, key).layout
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Failed to delete dashboard.'
            );
        }
    }

    function resetLayout() {
        setLocalLayout(cloneLayout(defaultLayout));
        setLocalHiddenKeys(
            new Set(
                (defaultHiddenKeys || []).filter((key) => !isToolNavKey(key))
            )
        );
        setHiddenPlacement(new Map());
    }

    async function save() {
        await onSave(cleanLayout(localLayout), [...localHiddenKeys]);
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-hidden sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>
                        {t('nav_menu.custom_nav.dialog_title')}
                    </DialogTitle>
                </DialogHeader>
                <div className="min-h-0 flex-1 overflow-y-auto pr-2">
                    <DndContext
                        accessibility={
                            typeof document === 'undefined'
                                ? undefined
                                : { container: document.body }
                        }
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext
                            items={sortableNodeIds}
                            strategy={verticalListSortingStrategy}
                        >
                            <div className="flex flex-col gap-1">
                                {localLayout.map((entry, index) => {
                                    if (entry.type === 'folder') {
                                        return (
                                            <div
                                                key={entry.id}
                                                className="flex flex-col gap-1 rounded-lg border p-2"
                                            >
                                                <SortableNavItemRow
                                                    id={getFolderSortableId(
                                                        entry.id
                                                    )}
                                                >
                                                    {({
                                                        rowRef,
                                                        rowStyle,
                                                        dragHandleProps,
                                                        isDragging
                                                    }) => (
                                                        <div
                                                            ref={rowRef}
                                                            style={rowStyle}
                                                            className={cn(
                                                                'flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium transition-colors',
                                                                isDragging &&
                                                                    'opacity-50'
                                                            )}
                                                        >
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon-sm"
                                                                className="shrink-0 cursor-grab touch-none active:cursor-grabbing"
                                                                aria-label={`Drag ${entry.name}`}
                                                                {...dragHandleProps}
                                                            >
                                                                <GripVerticalIcon data-icon="inline-start" />
                                                            </Button>
                                                            <NavIconSelect
                                                                value={
                                                                    entry.icon
                                                                }
                                                                fallbackIcon={
                                                                    DEFAULT_FOLDER_ICON
                                                                }
                                                                ariaLabel={`Icon for ${entry.name}`}
                                                                onValueChange={(
                                                                    icon
                                                                ) =>
                                                                    updateEntryIcon(
                                                                        index,
                                                                        icon,
                                                                        DEFAULT_FOLDER_ICON
                                                                    )
                                                                }
                                                            />
                                                            <span className="min-w-0 flex-1 truncate">
                                                                {entry.name}
                                                            </span>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon-sm"
                                                                aria-label={`Edit ${entry.name}`}
                                                                onClick={() =>
                                                                    void editFolder(
                                                                        index
                                                                    )
                                                                }
                                                            >
                                                                <PencilIcon data-icon="inline-start" />
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon-sm"
                                                                aria-label={`Delete ${entry.name}`}
                                                                onClick={() =>
                                                                    deleteFolder(
                                                                        index
                                                                    )
                                                                }
                                                            >
                                                                <FolderXIcon data-icon="inline-start" />
                                                            </Button>
                                                        </div>
                                                    )}
                                                </SortableNavItemRow>
                                                {entry.items?.length ? (
                                                    <div className="flex flex-col gap-1">
                                                        {entry.items.map(
                                                            (
                                                                item,
                                                                childIndex
                                                            ) => {
                                                                const key =
                                                                    getFolderItemKey(
                                                                        item
                                                                    );
                                                                const definition =
                                                                    definitionMap.get(
                                                                        key
                                                                    );
                                                                if (
                                                                    !definition
                                                                ) {
                                                                    return null;
                                                                }
                                                                return (
                                                                    <SortableNavItemRow
                                                                        key={
                                                                            key
                                                                        }
                                                                        id={getItemSortableId(
                                                                            key
                                                                        )}
                                                                    >
                                                                        {(
                                                                            rowProps
                                                                        ) => (
                                                                            <NavItemRow
                                                                                {...rowProps}
                                                                                indent
                                                                                label={definitionLabel(
                                                                                    definition,
                                                                                    t
                                                                                )}
                                                                                icon={
                                                                                    getFolderItemIcon(
                                                                                        item
                                                                                    ) ||
                                                                                    definition.icon
                                                                                }
                                                                                fallbackIcon={
                                                                                    definition.icon ||
                                                                                    DEFAULT_NAV_ICON_KEY
                                                                                }
                                                                                isTool={isToolNavKey(
                                                                                    key
                                                                                )}
                                                                                isDashboard={isDashboardKey(
                                                                                    key
                                                                                )}
                                                                                onIconChange={(
                                                                                    icon
                                                                                ) =>
                                                                                    updateFolderChildIcon(
                                                                                        index,
                                                                                        childIndex,
                                                                                        icon,
                                                                                        definition.icon ||
                                                                                            DEFAULT_NAV_ICON_KEY
                                                                                    )
                                                                                }
                                                                                onHide={() =>
                                                                                    hideItem(
                                                                                        key
                                                                                    )
                                                                                }
                                                                                onEditDashboard={() =>
                                                                                    void editDashboard(
                                                                                        key
                                                                                    )
                                                                                }
                                                                                onDeleteDashboard={() =>
                                                                                    void removeDashboard(
                                                                                        key
                                                                                    )
                                                                                }
                                                                            />
                                                                        )}
                                                                    </SortableNavItemRow>
                                                                );
                                                            }
                                                        )}
                                                    </div>
                                                ) : (
                                                    <FolderDropZone
                                                        folderId={entry.id}
                                                        label={t(
                                                            'nav_menu.custom_nav.folder_drop_here'
                                                        )}
                                                    />
                                                )}
                                            </div>
                                        );
                                    }

                                    const definition = definitionMap.get(
                                        entry.key
                                    );
                                    if (!definition) {
                                        return null;
                                    }
                                    return (
                                        <SortableNavItemRow
                                            key={entry.key}
                                            id={getItemSortableId(entry.key)}
                                        >
                                            {(rowProps) => (
                                                <NavItemRow
                                                    {...rowProps}
                                                    label={definitionLabel(
                                                        definition,
                                                        t
                                                    )}
                                                    icon={
                                                        entry.icon ||
                                                        definition.icon
                                                    }
                                                    fallbackIcon={
                                                        definition.icon ||
                                                        DEFAULT_NAV_ICON_KEY
                                                    }
                                                    isTool={isToolNavKey(
                                                        entry.key
                                                    )}
                                                    isDashboard={isDashboardKey(
                                                        entry.key
                                                    )}
                                                    onIconChange={(icon) =>
                                                        updateEntryIcon(
                                                            index,
                                                            icon,
                                                            definition.icon ||
                                                                DEFAULT_NAV_ICON_KEY
                                                        )
                                                    }
                                                    onHide={() =>
                                                        hideItem(entry.key)
                                                    }
                                                    onEditDashboard={() =>
                                                        void editDashboard(
                                                            entry.key
                                                        )
                                                    }
                                                    onDeleteDashboard={() =>
                                                        void removeDashboard(
                                                            entry.key
                                                        )
                                                    }
                                                />
                                            )}
                                        </SortableNavItemRow>
                                    );
                                })}
                            </div>
                        </SortableContext>
                    </DndContext>
                    {hiddenItems.length ? (
                        <>
                            <div className="my-4 flex items-center gap-2">
                                <Separator className="flex-1" />
                                <span className="text-muted-foreground text-xs">
                                    {t('nav_menu.custom_nav.hidden_items')}
                                </span>
                                <Separator className="flex-1" />
                            </div>
                            <div className="flex flex-col gap-1">
                                {hiddenItems.map((item) => (
                                    <Button
                                        key={item.key}
                                        type="button"
                                        variant="ghost"
                                        className="text-muted-foreground h-auto w-full justify-start px-2 py-1.5 text-left font-normal"
                                        onClick={() => showItem(item.key)}
                                    >
                                        <EyeIcon data-icon="inline-start" />
                                        <span className="min-w-0 flex-1 truncate">
                                            {item.label}
                                        </span>
                                    </Button>
                                ))}
                            </div>
                        </>
                    ) : null}
                </div>
                <DialogFooter className="items-center justify-between sm:justify-between">
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => void addFolder()}
                        >
                            <FolderPlusIcon data-icon="inline-start" />
                            {t('nav_menu.custom_nav.new_folder')}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => void addDashboard()}
                        >
                            <PlusIcon data-icon="inline-start" />
                            {t('dashboard.new_dashboard')}
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            className="text-destructive"
                            onClick={resetLayout}
                        >
                            <RotateCcwIcon data-icon="inline-start" />
                            {t('nav_menu.custom_nav.restore_default')}
                        </Button>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => onOpenChange(false)}
                        >
                            {t('nav_menu.custom_nav.cancel')}
                        </Button>
                        <Button type="button" onClick={() => void save()}>
                            {t('common.actions.confirm')}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
