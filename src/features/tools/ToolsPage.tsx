// @ts-nocheck
import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors
} from '@dnd-kit/core';
import {
    SortableContext,
    arrayMove,
    rectSortingStrategy,
    sortableKeyboardCoordinates,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    BotIcon,
    ChevronDownIcon,
    DownloadIcon,
    FolderOpenIcon,
    ImageIcon,
    MinusIcon,
    MoreHorizontalIcon,
    PinIcon,
    PinOffIcon,
    PlusIcon,
    StarIcon,
    UsersIcon,
    WrenchIcon
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
    loadNavMenuModel,
    NAV_LAYOUT_UPDATED_EVENT,
    saveNavMenuModel
} from '@/components/layout/navMenuModel.js';
import { cn } from '@/lib/utils.js';
import { configRepository } from '@/repositories/index.js';
import {
    isToolCapabilityAvailable,
    triggerToolByKey
} from '@/services/toolActionService.js';
import { getNavIconComponent } from '@/shared/constants/navIcons.js';
import {
    getToolsByCategory,
    toolCategories
} from '@/shared/constants/tools.js';
import { useDashboardStore } from '@/state/dashboardStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

const collapsibleCategories = toolCategories.map((category) => category.key);
const categoryConfigKey = 'VRCX_toolsCategoryCollapsed';
const quickAccessConfigKey = 'VRCX_toolsQuickAccessList';
const quickAccessDropId = 'tools-quick-access-drop-zone';
const toolCatalogDropId = 'tools-catalog-drop-zone';
const quickAccessDragPrefix = 'tools-quick-access-tool:';
const catalogDragPrefix = 'tools-catalog-tool:';
const defaultCollapsedState = {
    group: false,
    image: false,
    shortcuts: false,
    social: false,
    system: false,
    user: false,
    other: false
};
const toolsPageCategories = toolCategories
    .filter((category) => collapsibleCategories.includes(category.key))
    .map((category) => ({
        ...category,
        tools: getToolsByCategory(category.key)
    }));
const allTools = toolsPageCategories.flatMap((category) => category.tools);
const knownToolKeys = new Set(allTools.map((tool) => tool.key));

const categoryIconByKey = {
    image: ImageIcon,
    shortcuts: FolderOpenIcon,
    group: UsersIcon,
    social: BotIcon,
    system: WrenchIcon,
    user: DownloadIcon,
    other: MoreHorizontalIcon
};

const legacyPinnedToolAliases = {
    'auto-change-status': 'presence-room-rules'
};

function normalizePinnedToolKey(toolKey) {
    return legacyPinnedToolAliases[toolKey] ?? toolKey;
}

function getEquivalentToolNavKeys(toolKey) {
    const normalizedToolKey = normalizePinnedToolKey(toolKey);
    const equivalentToolKeys = new Set([normalizedToolKey]);

    for (const [legacyToolKey, targetToolKey] of Object.entries(
        legacyPinnedToolAliases
    )) {
        if (targetToolKey === normalizedToolKey) {
            equivalentToolKeys.add(legacyToolKey);
        }
    }

    return Array.from(equivalentToolKeys).map((key) => `tool-${key}`);
}

function normalizeQuickAccessToolKeys(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    const seen = new Set();
    const nextKeys = [];
    for (const rawKey of value) {
        const toolKey = normalizePinnedToolKey(String(rawKey || ''));
        if (!knownToolKeys.has(toolKey) || seen.has(toolKey)) {
            continue;
        }
        seen.add(toolKey);
        nextKeys.push(toolKey);
    }
    return nextKeys;
}

function parseQuickAccessToolKeys(value) {
    try {
        return normalizeQuickAccessToolKeys(JSON.parse(value || '[]'));
    } catch {
        return [];
    }
}

function getQuickAccessDragId(toolKey) {
    return `${quickAccessDragPrefix}${toolKey}`;
}

function getCatalogDragId(toolKey) {
    return `${catalogDragPrefix}${toolKey}`;
}

function ToolItem({
    icon: Icon,
    title,
    description,
    actionsLabel,
    pinLabel,
    unpinLabel,
    addQuickAccessLabel,
    removeQuickAccessLabel,
    navEligible,
    isPinned,
    isQuickAccess,
    editMode,
    editQuickAccessAction,
    itemRef,
    itemStyle,
    isDragging,
    dragProps,
    onClick,
    onPin,
    onUnpin,
    onAddQuickAccess,
    onRemoveQuickAccess
}) {
    const PinStateIcon = isPinned ? PinOffIcon : PinIcon;
    const QuickAccessIcon = isQuickAccess ? MinusIcon : PlusIcon;
    const isEditRemoveAction = editQuickAccessAction === 'remove';
    const EditQuickAccessIcon = isEditRemoveAction ? MinusIcon : PlusIcon;
    const editQuickAccessLabel = isEditRemoveAction
        ? removeQuickAccessLabel
        : addQuickAccessLabel;

    return (
        <div
            ref={itemRef}
            style={itemStyle}
            className={cn('relative h-full', isDragging && 'opacity-50')}
        >
            <Button
                type="button"
                variant="outline"
                className={cn(
                    'h-full w-full min-w-0 items-start justify-start gap-2.5 p-3 pr-10 text-left font-normal whitespace-normal',
                    editMode
                        ? dragProps
                            ? 'cursor-grab touch-none active:cursor-grabbing'
                            : 'cursor-default'
                        : null
                )}
                aria-disabled={editMode ? true : undefined}
                onClick={editMode ? undefined : onClick}
                {...(editMode && dragProps ? dragProps : {})}
            >
                <div className="bg-muted/40 text-muted-foreground flex size-8 flex-none items-center justify-center rounded-md">
                    <Icon aria-hidden="true" data-icon="inline-start" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{title}</div>
                    <div className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-snug">
                        {description}
                    </div>
                </div>
            </Button>
            {editMode ? (
                <Button
                    type="button"
                    size="icon-xs"
                    variant="secondary"
                    className="absolute top-2 right-2 size-7"
                    aria-label={editQuickAccessLabel}
                    onPointerDown={(event) => {
                        event.stopPropagation();
                    }}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (isEditRemoveAction) {
                            onRemoveQuickAccess?.();
                        } else {
                            onAddQuickAccess?.();
                        }
                    }}
                >
                    <EditQuickAccessIcon data-icon="inline-start" />
                </Button>
            ) : (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            className="text-muted-foreground absolute top-2 right-2 size-7"
                            aria-label={actionsLabel}
                            onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                            }}
                        >
                            <MoreHorizontalIcon data-icon="inline-start" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuGroup>
                            <DropdownMenuItem
                                onSelect={() => {
                                    if (isQuickAccess) {
                                        onRemoveQuickAccess?.();
                                    } else {
                                        onAddQuickAccess?.();
                                    }
                                }}
                            >
                                <QuickAccessIcon data-icon="inline-start" />
                                {isQuickAccess
                                    ? removeQuickAccessLabel
                                    : addQuickAccessLabel}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                        {navEligible ? (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuGroup>
                                    <DropdownMenuItem
                                        onSelect={() => {
                                            if (isPinned) {
                                                onUnpin?.();
                                            } else {
                                                onPin?.();
                                            }
                                        }}
                                    >
                                        <PinStateIcon data-icon="inline-start" />
                                        {isPinned ? unpinLabel : pinLabel}
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                            </>
                        ) : null}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </div>
    );
}

function SortableQuickAccessTool({ toolKey, disabled, children }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({
        id: getQuickAccessDragId(toolKey),
        disabled,
        data: {
            source: 'quick-access',
            toolKey
        }
    });
    const itemStyle = {
        transform: CSS.Transform.toString(transform),
        transition
    };
    const cardDragProps = {
        ...attributes,
        ...listeners
    };

    return children({
        itemRef: setNodeRef,
        itemStyle,
        isDragging,
        dragProps: cardDragProps
    });
}

function DraggableCatalogTool({ toolKey, disabled, children }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        isDragging
    } = useDraggable({
        id: getCatalogDragId(toolKey),
        disabled,
        data: {
            source: 'catalog',
            toolKey
        }
    });
    const itemStyle = {
        transform: CSS.Translate.toString(transform)
    };
    const cardDragProps = {
        ...attributes,
        ...listeners
    };

    return children({
        itemRef: setNodeRef,
        itemStyle,
        isDragging,
        dragProps: cardDragProps
    });
}

function QuickAccessDropZone({
    editMode,
    isEmpty,
    isHidden,
    title,
    emptyDescription,
    children
}) {
    const { isOver, setNodeRef } = useDroppable({
        id: quickAccessDropId,
        disabled: !editMode,
        data: {
            target: 'quick-access'
        }
    });

    if (isHidden) {
        return null;
    }

    return (
        <div className="mb-4">
            <div className="mb-2 flex items-center gap-2 px-2.5 py-1.5">
                <StarIcon
                    aria-hidden="true"
                    className="text-muted-foreground size-4"
                />
                <span className="text-sm font-semibold">{title}</span>
            </div>
            <div
                ref={setNodeRef}
                className={cn(
                    editMode
                        ? 'bg-muted/20 border-muted-foreground/50 rounded-lg border border-dashed p-3 transition-colors'
                        : 'pl-4',
                    editMode && isOver && 'border-primary/80 bg-primary/10'
                )}
            >
                {isEmpty ? (
                    <div className="text-muted-foreground flex min-h-24 items-center justify-center rounded-md text-center text-sm">
                        {emptyDescription}
                    </div>
                ) : (
                    children
                )}
            </div>
        </div>
    );
}

function ToolCatalogDropZone({ editMode, children }) {
    const { isOver, setNodeRef } = useDroppable({
        id: toolCatalogDropId,
        disabled: !editMode,
        data: {
            target: 'catalog'
        }
    });

    return (
        <div
            ref={setNodeRef}
            className={cn(
                'mt-4 px-3',
                editMode &&
                    isOver &&
                    'border-primary/80 bg-primary/10 rounded-lg border border-dashed'
            )}
        >
            {children}
        </div>
    );
}

function collectLayoutKeys(layout) {
    const keys = new Set();
    for (const entry of layout || []) {
        if (entry.type === 'item' && entry.key) {
            keys.add(entry.key);
        } else if (entry.type === 'folder') {
            for (const item of entry.items || []) {
                const key = typeof item === 'string' ? item : item?.key;
                if (key) {
                    keys.add(key);
                }
            }
        }
    }
    return keys;
}

function insertToolNavItem(layout, navKey) {
    const nextLayout = Array.isArray(layout) ? [...layout] : [];
    if (collectLayoutKeys(nextLayout).has(navKey)) {
        return nextLayout;
    }
    const insertIndex = nextLayout.findIndex(
        (entry) =>
            entry.type === 'item' &&
            (entry.key === 'tools' || entry.key === 'direct-access')
    );
    if (insertIndex >= 0) {
        nextLayout.splice(insertIndex, 0, { type: 'item', key: navKey });
        return nextLayout;
    }
    return [...nextLayout, { type: 'item', key: navKey }];
}

function removeToolNavItem(layout, navKey) {
    const navKeys = new Set(Array.isArray(navKey) ? navKey : [navKey]);

    return (layout || [])
        .map((entry) => {
            if (entry.type === 'item') {
                return navKeys.has(entry.key) ? null : entry;
            }
            if (entry.type === 'folder') {
                const nextItems = (entry.items || []).filter(
                    (item) =>
                        !navKeys.has(
                            typeof item === 'string' ? item : item?.key
                        )
                );
                return nextItems.length ? { ...entry, items: nextItems } : null;
            }
            return entry;
        })
        .filter(Boolean);
}

function useToolsCollapsedState() {
    const [collapsed, setCollapsed] = useState({
        ...defaultCollapsedState
    });

    useEffect(() => {
        let active = true;
        configRepository
            .getString(categoryConfigKey, '{}')
            .then((value) => {
                if (!active) {
                    return;
                }
                const parsed = JSON.parse(value || '{}');
                setCollapsed((current) => ({
                    ...current,
                    ...Object.fromEntries(
                        Object.keys(defaultCollapsedState).map((key) => [
                            key,
                            Boolean(parsed[key])
                        ])
                    )
                }));
            })
            .catch(() => {});

        return () => {
            active = false;
        };
    }, []);

    function toggleCategoryCollapsed(categoryKey) {
        setCollapsed((current) => {
            const nextState = {
                ...current,
                [categoryKey]: !current[categoryKey]
            };
            void configRepository.setString(
                categoryConfigKey,
                JSON.stringify(nextState)
            );
            return nextState;
        });
    }

    return { collapsed, toggleCategoryCollapsed };
}

function useToolsQuickAccessState() {
    const [quickAccessKeys, setQuickAccessKeysState] = useState([]);

    useEffect(() => {
        let active = true;
        configRepository
            .getString(quickAccessConfigKey, '[]')
            .then((value) => {
                if (active) {
                    setQuickAccessKeysState(parseQuickAccessToolKeys(value));
                }
            })
            .catch(() => {
                if (active) {
                    setQuickAccessKeysState([]);
                }
            });

        return () => {
            active = false;
        };
    }, []);

    function setQuickAccessKeys(updater) {
        setQuickAccessKeysState((current) => {
            const value =
                typeof updater === 'function' ? updater(current) : updater;
            const nextKeys = normalizeQuickAccessToolKeys(value);
            void configRepository.setString(
                quickAccessConfigKey,
                JSON.stringify(nextKeys)
            );
            return nextKeys;
        });
    }

    return { quickAccessKeys, setQuickAccessKeys };
}

export function ToolsPage() {
    const navigate = useNavigate();
    const { t, i18n } = useTranslation();
    const hostCapabilities = useRuntimeStore((state) => state.hostCapabilities);
    const dashboards = useDashboardStore((state) => state.dashboards);
    const ensureDashboardsLoaded = useDashboardStore(
        (state) => state.ensureLoaded
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
    const categories = useMemo(
        () =>
            toolsPageCategories
                .map((category) => ({
                    ...category,
                    tools: category.tools.filter(isToolCapabilityAvailable)
                }))
                .filter((category) => category.tools.length > 0),
        [hostCapabilities]
    );
    const availableToolMap = useMemo(
        () =>
            new Map(
                categories
                    .flatMap((category) => category.tools)
                    .map((tool) => [tool.key, tool])
            ),
        [categories]
    );
    const { collapsed, toggleCategoryCollapsed } = useToolsCollapsedState();
    const { quickAccessKeys, setQuickAccessKeys } =
        useToolsQuickAccessState();
    const [isQuickAccessEditing, setIsQuickAccessEditing] = useState(false);
    const [navLayout, setNavLayout] = useState([]);
    const [navHiddenKeys, setNavHiddenKeys] = useState([]);
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const notificationLayout = usePreferencesStore(
        (state) => state.notificationLayout
    );
    const translateWithFallback = (key) => {
        const localized = t(key);
        if (localized !== key) {
            return localized;
        }

        const english = i18n?.getFixedT
            ? i18n.getFixedT('en')(key)
            : t(key, { lng: 'en' });
        return english !== key ? english : key;
    };
    const pinnedToolKeys = useMemo(() => {
        const keys = collectLayoutKeys(navLayout);
        return new Set(
            Array.from(keys)
                .filter((key) => String(key).startsWith('tool-'))
                .map((key) =>
                    normalizePinnedToolKey(String(key).replace(/^tool-/, ''))
                )
        );
    }, [navLayout]);
    const quickAccessKeySet = useMemo(
        () => new Set(quickAccessKeys),
        [quickAccessKeys]
    );
    const quickAccessTools = useMemo(
        () =>
            quickAccessKeys
                .map((key) => availableToolMap.get(key))
                .filter(Boolean),
        [availableToolMap, quickAccessKeys]
    );
    const shouldShowQuickAccess =
        isQuickAccessEditing || quickAccessTools.length > 0;

    useEffect(() => {
        void ensureDashboardsLoaded().catch(() => {});
    }, [ensureDashboardsLoaded]);

    useEffect(() => {
        if (!preferencesHydrated) {
            return undefined;
        }
        let active = true;
        async function loadModel() {
            const model = await loadNavMenuModel({
                dashboards: useDashboardStore.getState().dashboards,
                notificationLayout,
                t: translateWithFallback
            });
            if (!active) {
                return;
            }
            setNavLayout(model.layout);
            setNavHiddenKeys(model.hiddenKeys);
        }

        void loadModel().catch(() => {});
        const handleNavLayoutUpdated = () => {
            void loadModel().catch(() => {});
        };
        window.addEventListener(
            NAV_LAYOUT_UPDATED_EVENT,
            handleNavLayoutUpdated
        );
        return () => {
            active = false;
            window.removeEventListener(
                NAV_LAYOUT_UPDATED_EVENT,
                handleNavLayoutUpdated
            );
        };
    }, [dashboards, notificationLayout, preferencesHydrated, t]);

    function addQuickAccessToolByKey(toolKey, beforeToolKey = '') {
        const normalizedToolKey = normalizePinnedToolKey(toolKey);
        const normalizedBeforeToolKey = normalizePinnedToolKey(beforeToolKey);
        setQuickAccessKeys((current) => {
            if (current.includes(normalizedToolKey)) {
                return current;
            }
            const nextKeys = [...current];
            const insertIndex = nextKeys.indexOf(normalizedBeforeToolKey);
            if (insertIndex >= 0) {
                nextKeys.splice(insertIndex, 0, normalizedToolKey);
            } else {
                nextKeys.push(normalizedToolKey);
            }
            return nextKeys;
        });
    }

    function addQuickAccessToolByKeyWithFeedback(toolKey) {
        const normalizedToolKey = normalizePinnedToolKey(toolKey);
        if (quickAccessKeySet.has(normalizedToolKey)) {
            toast.info(
                translateWithFallback('view.tools.quick_access.already_added')
            );
            return;
        }
        addQuickAccessToolByKey(normalizedToolKey);
    }

    function removeQuickAccessToolByKey(toolKey) {
        const normalizedToolKey = normalizePinnedToolKey(toolKey);
        setQuickAccessKeys((current) =>
            current.filter((key) => key !== normalizedToolKey)
        );
    }

    function reorderQuickAccessTool(activeToolKey, overToolKey) {
        const normalizedActiveToolKey = normalizePinnedToolKey(activeToolKey);
        const normalizedOverToolKey = normalizePinnedToolKey(overToolKey);
        if (
            !normalizedOverToolKey ||
            normalizedActiveToolKey === normalizedOverToolKey
        ) {
            return;
        }
        setQuickAccessKeys((current) => {
            const oldIndex = current.indexOf(normalizedActiveToolKey);
            const newIndex = current.indexOf(normalizedOverToolKey);
            if (oldIndex < 0 || newIndex < 0) {
                return current;
            }
            return arrayMove(current, oldIndex, newIndex);
        });
    }

    function handleQuickAccessDragEnd({ active, over }) {
        const activeData = active?.data?.current;
        const overData = over?.data?.current;
        const activeToolKey = normalizePinnedToolKey(activeData?.toolKey);
        if (!activeToolKey || !knownToolKeys.has(activeToolKey)) {
            return;
        }

        if (
            activeData?.source === 'quick-access' &&
            over?.id === toolCatalogDropId
        ) {
            removeQuickAccessToolByKey(activeToolKey);
            return;
        }

        if (
            over?.id === quickAccessDropId ||
            overData?.source === 'quick-access' ||
            overData?.target === 'quick-access'
        ) {
            if (activeData?.source === 'catalog') {
                addQuickAccessToolByKey(activeToolKey, overData?.toolKey);
                return;
            }
            if (activeData?.source === 'quick-access') {
                reorderQuickAccessTool(activeToolKey, overData?.toolKey);
            }
        }
    }

    async function triggerTool(tool) {
        await triggerToolByKey(tool?.key, {
            navigate,
            t: translateWithFallback
        });
    }

    async function pinToolToNav(tool) {
        if (!tool?.navEligible) {
            return;
        }
        const navKey = `tool-${tool.key}`;
        try {
            const model = await saveNavMenuModel({
                layout: insertToolNavItem(navLayout, navKey),
                hiddenKeys: navHiddenKeys.filter((key) => key !== navKey),
                dashboards: useDashboardStore.getState().dashboards,
                notificationLayout,
                t: translateWithFallback
            });
            setNavLayout(model.layout);
            setNavHiddenKeys(model.hiddenKeys);
            toast.success(translateWithFallback('nav_menu.custom_nav.pinned'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.tools.toast.failed_to_pin_tool_to_navigation'
                      )
            );
        }
    }

    async function unpinToolFromNav(tool) {
        if (!tool?.navEligible) {
            return;
        }
        const navKey = getEquivalentToolNavKeys(tool.key);
        try {
            const model = await saveNavMenuModel({
                layout: removeToolNavItem(navLayout, navKey),
                hiddenKeys: navHiddenKeys,
                dashboards: useDashboardStore.getState().dashboards,
                notificationLayout,
                t: translateWithFallback
            });
            setNavLayout(model.layout);
            setNavHiddenKeys(model.hiddenKeys);
            toast.success(
                translateWithFallback('nav_menu.custom_nav.unpinned')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.tools.toast.failed_to_unpin_tool_from_navigation'
                      )
            );
        }
    }

    function renderToolItem(
        tool,
        dragProps = {},
        editQuickAccessAction = 'add'
    ) {
        const normalizedToolKey = normalizePinnedToolKey(tool.key);
        return (
            <ToolItem
                icon={getNavIconComponent(tool.navIcon, 'lucide:Wrench')}
                title={translateWithFallback(tool.titleKey)}
                description={translateWithFallback(tool.descriptionKey)}
                actionsLabel={translateWithFallback(
                    'view.tools.quick_access.actions'
                )}
                navEligible={tool.navEligible}
                isPinned={pinnedToolKeys.has(normalizedToolKey)}
                isQuickAccess={quickAccessKeySet.has(normalizedToolKey)}
                editMode={isQuickAccessEditing}
                editQuickAccessAction={editQuickAccessAction}
                pinLabel={translateWithFallback(
                    'nav_menu.custom_nav.pin_to_nav'
                )}
                unpinLabel={translateWithFallback(
                    'nav_menu.custom_nav.unpin_from_nav'
                )}
                addQuickAccessLabel={translateWithFallback(
                    'view.tools.quick_access.add'
                )}
                removeQuickAccessLabel={translateWithFallback(
                    'view.tools.quick_access.remove'
                )}
                onClick={() => {
                    void triggerTool(tool);
                }}
                onPin={() => {
                    void pinToolToNav(tool);
                }}
                onUnpin={() => {
                    void unpinToolFromNav(tool);
                }}
                onAddQuickAccess={() =>
                    addQuickAccessToolByKeyWithFeedback(tool.key)
                }
                onRemoveQuickAccess={() => removeQuickAccessToolByKey(tool.key)}
                {...dragProps}
            />
        );
    }

    return (
        <div
            id="chart"
            className="x-container flex h-full min-h-0 flex-1 flex-col overflow-y-auto p-4"
        >
            <div className="options-container">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="header">
                        {translateWithFallback('view.tools.header')}
                    </span>
                    <Button
                        type="button"
                        variant={isQuickAccessEditing ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() =>
                            setIsQuickAccessEditing((current) => !current)
                        }
                    >
                        {isQuickAccessEditing
                            ? translateWithFallback(
                                  'view.tools.quick_access.done'
                              )
                            : translateWithFallback(
                                  'view.tools.quick_access.edit'
                              )}
                    </Button>
                </div>

                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleQuickAccessDragEnd}
                >
                    <div className="mt-4 px-3">
                        <QuickAccessDropZone
                            editMode={isQuickAccessEditing}
                            isEmpty={quickAccessTools.length === 0}
                            isHidden={!shouldShowQuickAccess}
                            title={translateWithFallback(
                                'view.tools.quick_access.header'
                            )}
                            emptyDescription={translateWithFallback(
                                'view.tools.quick_access.empty'
                            )}
                        >
                            <SortableContext
                                items={quickAccessTools.map((tool) =>
                                    getQuickAccessDragId(tool.key)
                                )}
                                strategy={rectSortingStrategy}
                            >
                                <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 xl:grid-cols-3">
                                    {quickAccessTools.map((tool) => (
                                        <SortableQuickAccessTool
                                            key={tool.key}
                                            toolKey={tool.key}
                                            disabled={!isQuickAccessEditing}
                                        >
                                            {(dragProps) =>
                                                renderToolItem(
                                                    tool,
                                                    dragProps,
                                                    'remove'
                                                )
                                            }
                                        </SortableQuickAccessTool>
                                    ))}
                                </div>
                            </SortableContext>
                        </QuickAccessDropZone>
                    </div>

                    <ToolCatalogDropZone editMode={isQuickAccessEditing}>
                        {categories.map((category) => (
                            <div key={category.key} className="mb-4">
                                {(() => {
                                    const CategoryIcon =
                                        categoryIconByKey[category.key] ||
                                        WrenchIcon;

                                    return (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            className="mb-2 h-auto justify-start gap-2 px-2.5 py-1.5 text-left"
                                            onClick={() =>
                                                toggleCategoryCollapsed(
                                                    category.key
                                                )
                                            }
                                        >
                                            <ChevronDownIcon
                                                aria-hidden="true"
                                                className={cn(
                                                    'transition-transform duration-300',
                                                    collapsed[category.key]
                                                        ? '-rotate-90'
                                                        : ''
                                                )}
                                            />
                                            <CategoryIcon
                                                aria-hidden="true"
                                                className="text-muted-foreground"
                                            />
                                            <span className="text-sm font-semibold">
                                                {translateWithFallback(
                                                    category.labelKey
                                                )}
                                            </span>
                                        </Button>
                                    );
                                })()}

                                {!collapsed[category.key] ? (
                                    <div className="grid grid-cols-1 gap-2.5 pl-4 lg:grid-cols-2 xl:grid-cols-3">
                                        {category.tools.map((tool) => (
                                            <DraggableCatalogTool
                                                key={tool.key}
                                                toolKey={tool.key}
                                                disabled={
                                                    !isQuickAccessEditing
                                                }
                                            >
                                                {(dragProps) =>
                                                    renderToolItem(
                                                        tool,
                                                        dragProps,
                                                        'add'
                                                    )
                                                }
                                            </DraggableCatalogTool>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        ))}
                    </ToolCatalogDropZone>
                </DndContext>
            </div>
        </div>
    );
}
