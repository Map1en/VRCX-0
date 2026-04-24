import {
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
    DASHBOARD_NAV_KEY_PREFIX,
    DEFAULT_DASHBOARD_ICON
} from '@/shared/constants/dashboard.js';
import {
    DEFAULT_FOLDER_ICON,
    normalizeNavIconKey
} from '@/shared/constants/navIcons.js';
import { isToolNavKey } from '@/shared/constants/tools.js';
import { useDashboardStore } from '@/state/dashboardStore.js';
import { useModalStore } from '@/state/modalStore.js';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';

import { CustomNavDialogFooter } from './custom-nav-dialog/CustomNavDialogFooter.jsx';
import { CustomNavDialogLayoutEditor } from './custom-nav-dialog/CustomNavDialogLayoutEditor.jsx';
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
    sameDragNode
} from './custom-nav-dialog/customNavLayout.js';

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
    const [hiddenPlacement, setHiddenPlacement] = useState(() =>
        buildHiddenPlacementMap(defaultLayout, hiddenKeys)
    );
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
    }, [defaultLayout, hiddenKeys, layout, open]);

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
                    : t(
                          'component.custom_nav.generated_toast.failed_to_create_dashboard'
                      )
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
                    : t(
                          'component.custom_nav.generated_toast.failed_to_update_dashboard'
                      )
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
                    : t(
                          'component.custom_nav.generated_toast.failed_to_delete_dashboard'
                      )
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
                </DialogHeader>
                <div className="min-h-0 flex-1 overflow-y-auto pr-2">
                    <CustomNavDialogLayoutEditor
                        t={t}
                        sensors={sensors}
                        sortableNodeIds={sortableNodeIds}
                        localLayout={localLayout}
                        definitionMap={definitionMap}
                        hiddenItems={hiddenItems}
                        onDragEnd={handleDragEnd}
                        onFolderIconChange={(index, icon, fallbackIcon) =>
                            updateEntryIcon(
                                index,
                                icon,
                                fallbackIcon || DEFAULT_FOLDER_ICON
                            )
                        }
                        onFolderEdit={(index) => void editFolder(index)}
                        onFolderDelete={deleteFolder}
                        onFolderChildIconChange={updateFolderChildIcon}
                        onHideItem={hideItem}
                        onEditDashboard={(key) => void editDashboard(key)}
                        onDeleteDashboard={(key) => void removeDashboard(key)}
                        onShowItem={showItem}
                    />
                </div>
                <CustomNavDialogFooter
                    onAddDashboard={addDashboard}
                    onAddFolder={addFolder}
                    onCancel={() => onOpenChange(false)}
                    onReset={resetLayout}
                    onSave={save}
                    t={t}
                />
            </DialogContent>
        </Dialog>
    );
}
