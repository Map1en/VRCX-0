import {
    type DragEndEvent,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    createDashboard,
    deleteDashboard,
    updateDashboard
} from '@/services/dashboardService';
import { toast } from '@/services/toastService';
import {
    DASHBOARD_NAV_KEY_PREFIX,
    DEFAULT_DASHBOARD_ICON
} from '@/shared/constants/dashboard';
import {
    DEFAULT_FOLDER_ICON,
    normalizeNavIconKey
} from '@/shared/constants/navIcons';
import { isToolNavKey } from '@/shared/constants/tools';
import { useDashboardStore } from '@/state/dashboardStore';
import { useModalStore } from '@/state/modalStore';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';

import { CustomNavDialogFooter } from './custom-nav-dialog/CustomNavDialogFooter';
import { CustomNavDialogLayoutEditor } from './custom-nav-dialog/CustomNavDialogLayoutEditor';
import {
    buildHiddenPlacementMap,
    buildVisibleNodes,
    cleanLayout,
    cloneLayout,
    createFolderId,
    createFolderItem,
    definitionLabel,
    findFolder,
    findFolderItemIndex,
    findTopLevelIndex,
    getFolderItemIcon,
    getFolderItemKey,
    insertKeyIntoLayout,
    removeKeyFromLayout,
    removeLayoutItem,
    resolveDragNode,
    sameDragNode,
    type CustomNavDefinition,
    type CustomNavDragNode,
    type CustomNavFolderItem,
    type CustomNavHiddenPlacement,
    type CustomNavItemEntry,
    type CustomNavLayout
} from './custom-nav-dialog/customNavLayout';

const JUST_MOVED_RESET_MS = 260;

type HiddenNavItem = {
    key: string;
    label: string;
};

function hasDefinitionKey(
    definition: CustomNavDefinition
): definition is CustomNavDefinition & { key: string } {
    return typeof definition.key === 'string' && definition.key.length > 0;
}

type CustomNavDialogProps = {
    open: boolean;
    layout: unknown;
    hiddenKeys?: readonly string[];
    defaultLayout: unknown;
    defaultHiddenKeys?: readonly string[];
    definitions?: CustomNavDefinition[];
    onOpenChange: (open: boolean) => void;
    onSave: (
        layout: CustomNavLayout,
        hiddenKeys: string[]
    ) => void | Promise<void>;
    onDashboardCreated?: (
        dashboardId: string,
        layout: CustomNavLayout,
        hiddenKeys: string[]
    ) => void | Promise<void>;
};

export function CustomNavDialog({
    open,
    layout,
    hiddenKeys,
    defaultLayout,
    defaultHiddenKeys = [],
    definitions,
    onOpenChange,
    onSave,
    onDashboardCreated
}: CustomNavDialogProps) {
    const { t } = useTranslation();
    const prompt = useModalStore((state) => state.prompt);
    const confirm = useModalStore((state) => state.confirm);
    const getDashboard = useDashboardStore((state) => state.getDashboard);
    const [localLayout, setLocalLayout] = useState<CustomNavLayout>(() =>
        cloneLayout(layout)
    );
    const [localHiddenKeys, setLocalHiddenKeys] = useState<Set<string>>(
        () => new Set(hiddenKeys || [])
    );
    const [hiddenPlacement, setHiddenPlacement] = useState(() =>
        buildHiddenPlacementMap(defaultLayout, hiddenKeys)
    );
    const [justMovedKey, setJustMovedKey] = useState('');
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
        setHiddenPlacement(buildHiddenPlacementMap(defaultLayout, hiddenKeys));
        setJustMovedKey('');
    }, [defaultLayout, hiddenKeys, layout, open]);

    useEffect(() => {
        if (!justMovedKey) {
            return undefined;
        }
        const timer = window.setTimeout(() => {
            setJustMovedKey('');
        }, JUST_MOVED_RESET_MS);
        return () => {
            window.clearTimeout(timer);
        };
    }, [justMovedKey]);

    const definitionMap = useMemo<Map<string, CustomNavDefinition>>(
        () =>
            new Map(
                (definitions || [])
                    .filter(hasDefinitionKey)
                    .map((definition) => [definition.key, definition])
            ),
        [definitions]
    );

    const hiddenItems = useMemo<HiddenNavItem[]>(
        () =>
            (definitions || [])
                .filter(hasDefinitionKey)
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

    function updateFolderItems(
        folderIndex: number,
        updater: (items: CustomNavFolderItem[]) => CustomNavFolderItem[]
    ) {
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

    function updateEntryIcon(
        index: number,
        icon: string,
        fallbackIcon: string
    ) {
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

    function updateFolderChildIcon(
        folderIndex: number,
        itemIndex: number,
        icon: string,
        fallbackIcon: string
    ) {
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

    function moveItemByDrag(
        activeNode: CustomNavDragNode | null,
        targetNode: CustomNavDragNode | null
    ) {
        if (!activeNode || !targetNode || activeNode.type !== 'item') {
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

    function moveFolderByDrag(
        activeNode: CustomNavDragNode | null,
        targetNode: CustomNavDragNode | null
    ) {
        if (
            !activeNode ||
            !targetNode ||
            activeNode.type !== 'folder' ||
            targetNode.type === 'folder-drop'
        ) {
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

    function handleDragEnd(event: DragEndEvent) {
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
                const targetParentId = targetNode.parentId;
                targetNode =
                    visibleNodes.find(
                        (node) =>
                            node.type === 'folder' && node.id === targetParentId
                    ) || targetNode;
            }
            moveFolderByDrag(activeNode, targetNode);
            return;
        }
        moveItemByDrag(activeNode, targetNode);
    }

    function moveItemToFolder(key: string, folderId: string) {
        const next = cloneLayout(localLayout);
        const folder = findFolder(next, folderId);
        if (
            !folder ||
            folder.items.some((item) => getFolderItemKey(item) === key)
        ) {
            return;
        }
        const removed = removeLayoutItem(next, key);
        if (!removed?.key) {
            return;
        }
        folder.items.push(createFolderItem(removed.key, removed.icon || ''));
        setLocalLayout(next);
        setJustMovedKey(key);
    }

    function hideItem(key: string) {
        const normalizedKey = key;
        const result = removeKeyFromLayout(localLayout, key);
        setJustMovedKey(normalizedKey);
        setLocalLayout(result.layout);
        if (result.placement) {
            const placement = result.placement;
            setHiddenPlacement((current) =>
                new Map<string, CustomNavHiddenPlacement>(current).set(
                    normalizedKey,
                    placement
                )
            );
        }
        if (!isToolNavKey(key)) {
            setLocalHiddenKeys((current) => {
                const next = new Set(current);
                next.add(normalizedKey);
                return next;
            });
        }
    }

    function showItem(key: string) {
        const normalizedKey = key;
        const placement = hiddenPlacement.get(normalizedKey) || null;
        setJustMovedKey(normalizedKey);
        setLocalHiddenKeys((current) => {
            const next = new Set(current);
            next.delete(normalizedKey);
            return next;
        });
        setHiddenPlacement((current) => {
            const next = new Map<string, CustomNavHiddenPlacement>(current);
            next.delete(normalizedKey);
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

    async function editFolder(folderIndex: number) {
        const folder = localLayout[folderIndex];
        if (!folder || folder.type !== 'folder') {
            return;
        }
        const result = await prompt({
            title: t('nav_menu.custom_nav.edit_folder'),
            inputValue: String(folder.name || ''),
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

    function ungroupFolder(folderIndex: number) {
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
                    .map((item): CustomNavItemEntry | null => {
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
                    .filter(
                        (entry): entry is CustomNavItemEntry => entry !== null
                    )
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
            const nextLayout: CustomNavLayout = [
                ...localLayout,
                { type: 'item', key }
            ];
            setLocalLayout(nextLayout);
            await onDashboardCreated?.(dashboard.id, cleanLayout(nextLayout), [
                ...localHiddenKeys
            ]);
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'component.custom_nav.toast.failed_to_create_dashboard'
                          )
            });
        }
    }

    async function editDashboard(key: string) {
        const dashboardId = key.replace(DASHBOARD_NAV_KEY_PREFIX, '');
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
            toast.add({ type: 'success', title: t('message.update_success') });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'component.custom_nav.toast.failed_to_update_dashboard'
                          )
            });
        }
    }

    async function removeDashboard(key: string) {
        const dashboardId = key.replace(DASHBOARD_NAV_KEY_PREFIX, '');
        const result = await confirm({
            title: t('dashboard.confirmations.delete_title'),
            description: `${t('dashboard.confirmations.delete_description')} ${t('nav_menu.custom_nav.applies_immediately')}`,
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
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'component.custom_nav.toast.failed_to_delete_dashboard'
                          )
            });
        }
    }

    async function resetLayout() {
        const result = await confirm({
            title: t('nav_menu.custom_nav.restore_default'),
            description: t('nav_menu.custom_nav.restore_default_description'),
            destructive: true,
            confirmText: t('nav_menu.custom_nav.restore_default'),
            cancelText: t('nav_menu.custom_nav.cancel')
        });
        if (!result.ok) {
            return;
        }
        setJustMovedKey('');
        setLocalLayout(cloneLayout(defaultLayout));
        setLocalHiddenKeys(
            new Set(
                (defaultHiddenKeys || []).filter((key) => !isToolNavKey(key))
            )
        );
        setHiddenPlacement(
            buildHiddenPlacementMap(defaultLayout, defaultHiddenKeys)
        );
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
                    <DialogDescription>
                        {t('nav_menu.custom_nav.dialog_description')}
                    </DialogDescription>
                </DialogHeader>
                <CustomNavDialogLayoutEditor
                    sensors={sensors}
                    sortableNodeIds={sortableNodeIds}
                    localLayout={localLayout}
                    definitionMap={definitionMap}
                    hiddenItems={hiddenItems}
                    justMovedKey={justMovedKey}
                    onDragEnd={handleDragEnd}
                    onFolderIconChange={(
                        index: number,
                        icon: string,
                        fallbackIcon?: string
                    ) =>
                        updateEntryIcon(
                            index,
                            icon,
                            fallbackIcon || DEFAULT_FOLDER_ICON
                        )
                    }
                    onFolderEdit={(index: number) => {
                        editFolder(index);
                    }}
                    onFolderUngroup={ungroupFolder}
                    onFolderChildIconChange={updateFolderChildIcon}
                    onMoveItemToFolder={moveItemToFolder}
                    onHideItem={hideItem}
                    onEditDashboard={(key: string) => {
                        editDashboard(key);
                    }}
                    onDeleteDashboard={(key: string) => {
                        removeDashboard(key);
                    }}
                    onShowItem={showItem}
                />
                <CustomNavDialogFooter
                    onAddDashboard={addDashboard}
                    onAddFolder={addFolder}
                    onCancel={() => onOpenChange(false)}
                    onReset={() => {
                        resetLayout();
                    }}
                    onSave={save}
                />
            </DialogContent>
        </Dialog>
    );
}
