import {
    DndContext,
    closestCenter,
    useDraggable,
    useDroppable
} from '@dnd-kit/core';
import {
    SortableContext,
    rectSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    BotIcon,
    BugIcon,
    ChevronDownIcon,
    Clock3Icon,
    DatabaseBackupIcon,
    FolderOpenIcon,
    ImageIcon,
    MinusIcon,
    MoreHorizontalIcon,
    PanelLeftIcon,
    PlusIcon,
    SettingsIcon,
    StarIcon,
    UsersIcon,
    WrenchIcon,
    type LucideIcon
} from 'lucide-react';
import type { ComponentProps, CSSProperties, ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';

import { getNavIconComponent } from '@/components/layout/navIconRegistry';
import {
    PageScaffold,
    PageToolbar,
    PageToolbarRow
} from '@/components/layout/PageScaffold';
import { cn } from '@/lib/utils';
import type { ToolDefinition } from '@/shared/constants/tools';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

import {
    getCatalogDragId,
    getQuickAccessDragId,
    normalizePinnedToolKey,
    quickAccessDropId,
    toolCatalogDropId
} from '../toolsPageHelpers';
import { useToolsPageState } from '../useToolsPageState';
import type { ToolStatusSummary } from '../useToolStatusSummaries';

import './ToolsPageContent.css';

type EditQuickAccessAction = 'add' | 'remove';
type DragRenderProps = {
    itemRef: Ref<HTMLDivElement>;
    itemStyle: CSSProperties;
    isDragging: boolean;
    dragProps: ComponentProps<typeof Button>;
};
type RenderToolItemOptions = {
    compact?: boolean;
    dragProps?: Partial<DragRenderProps>;
    editQuickAccessAction?: EditQuickAccessAction;
};

const categoryIconByKey: Record<string, LucideIcon> = {
    image: ImageIcon,
    shortcuts: FolderOpenIcon,
    automation: BotIcon,
    group: UsersIcon,
    vrchat: SettingsIcon,
    data: DatabaseBackupIcon,
    debug: BugIcon,
    other: MoreHorizontalIcon
};

function useToolsLabel() {
    const { t, i18n } = useTranslation();

    return (key: string) => {
        const localized = t(key);
        if (localized !== key) {
            return localized;
        }

        const english = i18n?.getFixedT
            ? i18n.getFixedT('en')(key)
            : t(key, { lng: 'en' });
        return english !== key ? english : key;
    };
}

function ToolItem({
    icon: Icon,
    title,
    description,
    status,
    actionsLabel,
    shortcutMenuLabel,
    toolsPageShortcutLabel,
    sidebarShortcutLabel,
    addQuickAccessLabel,
    removeQuickAccessLabel,
    navEligible,
    isPinned,
    isQuickAccess,
    editMode,
    editQuickAccessAction,
    compact,
    itemRef,
    itemStyle,
    isDragging,
    dragProps,
    onClick,
    onPin,
    onUnpin,
    onAddQuickAccess,
    onRemoveQuickAccess
}: {
    icon: LucideIcon;
    title: string;
    description: string;
    status?: ToolStatusSummary;
    actionsLabel: string;
    shortcutMenuLabel: string;
    toolsPageShortcutLabel: string;
    sidebarShortcutLabel: string;
    addQuickAccessLabel: string;
    removeQuickAccessLabel: string;
    navEligible: boolean;
    isPinned: boolean;
    isQuickAccess: boolean;
    editMode: boolean;
    editQuickAccessAction: EditQuickAccessAction;
    compact: boolean;
    itemRef?: Ref<HTMLDivElement>;
    itemStyle?: CSSProperties;
    isDragging?: boolean;
    dragProps?: ComponentProps<typeof Button>;
    onClick: () => void;
    onPin: () => void;
    onUnpin: () => void;
    onAddQuickAccess: () => void;
    onRemoveQuickAccess: () => void;
}) {
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
                variant="secondary"
                className={cn(
                    'tools-page__tool h-full w-full min-w-0 justify-start gap-2.5 text-left font-normal whitespace-normal',
                    compact
                        ? 'min-h-14 items-center px-3 py-2.5'
                        : 'items-start p-3',
                    'pr-10',
                    editMode
                        ? dragProps
                            ? 'cursor-grab touch-none active:cursor-grabbing'
                            : 'cursor-default'
                        : null
                )}
                data-editing={editMode || undefined}
                aria-disabled={editMode ? true : undefined}
                onClick={editMode ? undefined : onClick}
                {...(editMode && dragProps ? dragProps : {})}
            >
                <div className="text-muted-foreground flex size-8 flex-none items-center justify-center">
                    <Icon aria-hidden="true" data-icon="inline-start" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{title}</div>
                    {!compact ? (
                        <div className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-snug">
                            {description}
                        </div>
                    ) : null}
                    {!compact && status ? (
                        <div
                            className={cn(
                                'mt-1.5 flex items-center gap-1.5 truncate text-xs',
                                status.tone === 'active'
                                    ? 'text-primary'
                                    : 'text-muted-foreground'
                            )}
                        >
                            <span
                                aria-hidden="true"
                                className={cn(
                                    'size-1.5 flex-none rounded-full',
                                    status.tone === 'active'
                                        ? 'bg-primary'
                                        : 'bg-muted-foreground/70'
                                )}
                            />
                            <span className="truncate">{status.label}</span>
                        </div>
                    ) : null}
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
                    <DropdownMenuTrigger
                        render={
                            <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                className={cn(
                                    'text-muted-foreground absolute right-2 size-7',
                                    compact
                                        ? 'top-1/2 -translate-y-1/2'
                                        : 'top-2'
                                )}
                                aria-label={actionsLabel}
                                onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                }}
                            >
                                <MoreHorizontalIcon data-icon="inline-start" />
                            </Button>
                        }
                    />
                    <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                                <PlusIcon data-icon="inline-start" />
                                {shortcutMenuLabel}
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="w-60">
                                <DropdownMenuCheckboxItem
                                    checked={isQuickAccess}
                                    onCheckedChange={(checked) => {
                                        if (checked) {
                                            onAddQuickAccess?.();
                                        } else {
                                            onRemoveQuickAccess?.();
                                        }
                                    }}
                                >
                                    <StarIcon data-icon="inline-start" />
                                    {toolsPageShortcutLabel}
                                </DropdownMenuCheckboxItem>
                                {navEligible ? (
                                    <DropdownMenuCheckboxItem
                                        checked={isPinned}
                                        onCheckedChange={(checked) => {
                                            if (checked) {
                                                onPin?.();
                                            } else {
                                                onUnpin?.();
                                            }
                                        }}
                                    >
                                        <PanelLeftIcon data-icon="inline-start" />
                                        {sidebarShortcutLabel}
                                    </DropdownMenuCheckboxItem>
                                ) : null}
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </div>
    );
}

function SortableQuickAccessTool({
    toolKey,
    disabled,
    children
}: {
    toolKey: string;
    disabled: boolean;
    children: (props: DragRenderProps) => ReactNode;
}) {
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
    const itemStyle: CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition
    };
    const cardDragProps: ComponentProps<typeof Button> = {
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

function DraggableCatalogTool({
    toolKey,
    disabled,
    children
}: {
    toolKey: string;
    disabled: boolean;
    children: (props: DragRenderProps) => ReactNode;
}) {
    const { attributes, listeners, setNodeRef, transform, isDragging } =
        useDraggable({
            id: getCatalogDragId(toolKey),
            disabled,
            data: {
                source: 'catalog',
                toolKey
            }
        });
    const itemStyle: CSSProperties = {
        transform: CSS.Translate.toString(transform)
    };
    const cardDragProps: ComponentProps<typeof Button> = {
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
}: {
    editMode: boolean;
    isEmpty: boolean;
    isHidden: boolean;
    title: string;
    emptyDescription: string;
    children: ReactNode;
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
        <section className="flex flex-col gap-2.5">
            <div className="flex min-h-8 items-center gap-2 px-1">
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
                        ? 'bg-muted/15 border-muted-foreground/40 rounded-lg border border-dashed p-3 transition-colors duration-150 motion-reduce:transition-none'
                        : '',
                    editMode && isOver && 'border-primary/70 bg-primary/5'
                )}
            >
                {isEmpty ? (
                    <div className="text-muted-foreground flex min-h-20 items-center justify-center rounded-md px-4 text-center text-sm">
                        {emptyDescription}
                    </div>
                ) : (
                    children
                )}
            </div>
        </section>
    );
}

function ToolCatalogDropZone({
    editMode,
    children
}: {
    editMode: boolean;
    children: ReactNode;
}) {
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
                'flex flex-col gap-5 rounded-lg border border-transparent px-4 py-2 transition-colors duration-150 motion-reduce:transition-none',
                editMode && 'border-muted-foreground/30 border-dashed py-4',
                editMode && isOver && 'border-primary/60 bg-primary/5'
            )}
        >
            {children}
        </div>
    );
}

export function ToolsPageContent({ embedded = false }: { embedded?: boolean }) {
    const {
        addQuickAccessToolByKeyWithFeedback,
        categories,
        collapsed,
        handleQuickAccessDragEnd,
        isQuickAccessEditing,
        pinToolToNav,
        pinnedToolKeys,
        quickAccessKeySet,
        quickAccessTools,
        recentTools,
        removeQuickAccessToolByKey,
        sensors,
        setIsQuickAccessEditing,
        shouldShowQuickAccess,
        statusByToolKey,
        toggleCategoryCollapsed,
        triggerTool,
        unpinToolFromNav
    } = useToolsPageState();
    const label = useToolsLabel();

    function renderToolItem(
        tool: ToolDefinition,
        {
            compact = false,
            dragProps = {},
            editQuickAccessAction = 'add'
        }: RenderToolItemOptions = {}
    ) {
        const normalizedToolKey = normalizePinnedToolKey(tool.key);
        return (
            <ToolItem
                icon={getNavIconComponent(tool.navIcon, 'lucide:Wrench')}
                title={label(tool.titleKey)}
                description={label(tool.descriptionKey)}
                status={statusByToolKey.get(tool.key)}
                actionsLabel={label('view.tools.quick_access.actions')}
                navEligible={tool.navEligible}
                isPinned={pinnedToolKeys.has(normalizedToolKey)}
                isQuickAccess={quickAccessKeySet.has(normalizedToolKey)}
                editMode={isQuickAccessEditing}
                editQuickAccessAction={editQuickAccessAction}
                compact={compact}
                shortcutMenuLabel={label(
                    'view.tools.quick_access.shortcut_menu'
                )}
                toolsPageShortcutLabel={label(
                    'view.tools.quick_access.tools_page_shortcut'
                )}
                sidebarShortcutLabel={label(
                    'view.tools.quick_access.sidebar_shortcut'
                )}
                addQuickAccessLabel={label('view.tools.quick_access.add')}
                removeQuickAccessLabel={label('view.tools.quick_access.remove')}
                onClick={() => {
                    triggerTool(tool);
                }}
                onPin={() => {
                    pinToolToNav(tool);
                }}
                onUnpin={() => {
                    unpinToolFromNav(tool);
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
        <PageScaffold
            id="chart"
            embedded={embedded}
            className="flex-1"
            style={{ overflowY: 'auto' }}
        >
            <PageToolbar className="px-1.5">
                <PageToolbarRow className="justify-end">
                    <Button
                        type="button"
                        variant={isQuickAccessEditing ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() =>
                            setIsQuickAccessEditing((current) => !current)
                        }
                    >
                        {isQuickAccessEditing
                            ? label('view.tools.quick_access.done')
                            : label('view.tools.quick_access.edit')}
                    </Button>
                </PageToolbarRow>
            </PageToolbar>

            <div className="flex flex-col gap-4 px-1 pb-4">
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleQuickAccessDragEnd}
                >
                    {shouldShowQuickAccess ||
                    (!isQuickAccessEditing && recentTools.length > 0) ? (
                        <div
                            className={cn(
                                'flex flex-col px-4 text-sm',
                                shouldShowQuickAccess
                                    ? 'gap-5 py-4'
                                    : 'gap-2 py-3'
                            )}
                        >
                            <QuickAccessDropZone
                                editMode={isQuickAccessEditing}
                                isEmpty={quickAccessTools.length === 0}
                                isHidden={!shouldShowQuickAccess}
                                title={label('view.tools.quick_access.header')}
                                emptyDescription={label(
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
                                                    renderToolItem(tool, {
                                                        dragProps,
                                                        editQuickAccessAction:
                                                            'remove'
                                                    })
                                                }
                                            </SortableQuickAccessTool>
                                        ))}
                                    </div>
                                </SortableContext>
                            </QuickAccessDropZone>

                            {!isQuickAccessEditing && recentTools.length > 0 ? (
                                <section className="flex flex-col gap-2">
                                    <div className="flex min-h-7 items-center gap-2 px-1">
                                        <Clock3Icon
                                            aria-hidden="true"
                                            className="text-muted-foreground size-4"
                                        />
                                        <h2 className="text-sm font-semibold">
                                            {label('view.tools.recent')}
                                        </h2>
                                    </div>
                                    <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 xl:grid-cols-3">
                                        {recentTools.map((tool) => (
                                            <div
                                                key={tool.key}
                                                className="h-full"
                                            >
                                                {renderToolItem(tool, {
                                                    compact: true
                                                })}
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            ) : null}
                        </div>
                    ) : null}

                    <ToolCatalogDropZone editMode={isQuickAccessEditing}>
                        {categories.map((category) => {
                            const CategoryIcon =
                                categoryIconByKey[category.key] || WrenchIcon;

                            return (
                                <section
                                    key={category.key}
                                    className="flex flex-col gap-2.5"
                                >
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="h-8 w-fit justify-start gap-2 px-1.5 text-left"
                                        onClick={() =>
                                            toggleCategoryCollapsed(
                                                category.key
                                            )
                                        }
                                    >
                                        <ChevronDownIcon
                                            aria-hidden="true"
                                            className={cn(
                                                'transition-transform duration-150 motion-reduce:transition-none',
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
                                            {label(category.labelKey)}
                                        </span>
                                    </Button>

                                    {!collapsed[category.key] ? (
                                        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 xl:grid-cols-3">
                                            {category.tools.map((tool) => (
                                                <DraggableCatalogTool
                                                    key={tool.key}
                                                    toolKey={tool.key}
                                                    disabled={
                                                        !isQuickAccessEditing
                                                    }
                                                >
                                                    {(dragProps) =>
                                                        renderToolItem(tool, {
                                                            dragProps
                                                        })
                                                    }
                                                </DraggableCatalogTool>
                                            ))}
                                        </div>
                                    ) : null}
                                </section>
                            );
                        })}
                    </ToolCatalogDropZone>
                </DndContext>
            </div>
        </PageScaffold>
    );
}
