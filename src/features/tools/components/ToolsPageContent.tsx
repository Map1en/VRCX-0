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
    WrenchIcon,
    type LucideIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { getNavIconComponent } from '@/components/layout/navIconRegistry';
import { PageScaffold } from '@/components/layout/PageScaffold';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

import {
    getCatalogDragId,
    getQuickAccessDragId,
    normalizePinnedToolKey,
    quickAccessDropId,
    toolCatalogDropId
} from '../toolsPageHelpers';

const categoryIconByKey: Record<string, LucideIcon> = {
    image: ImageIcon,
    shortcuts: FolderOpenIcon,
    group: UsersIcon,
    social: BotIcon,
    system: WrenchIcon,
    user: DownloadIcon,
    other: MoreHorizontalIcon
};

function useToolsLabel() {
    const { t, i18n } = useTranslation();

    return (key: any) => {
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
}: any) {
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
                    onPointerDown={(event: any) => {
                        event.stopPropagation();
                    }}
                    onClick={(event: any) => {
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
                            onClick={(event: any) => {
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

function SortableQuickAccessTool({ toolKey, disabled, children }: any) {
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
    const itemStyle: any = {
        transform: CSS.Transform.toString(transform),
        transition
    };
    const cardDragProps: any = {
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

function DraggableCatalogTool({ toolKey, disabled, children }: any) {
    const { attributes, listeners, setNodeRef, transform, isDragging } =
        useDraggable({
            id: getCatalogDragId(toolKey),
            disabled,
            data: {
                source: 'catalog',
                toolKey
            }
        });
    const itemStyle: any = {
        transform: CSS.Translate.toString(transform)
    };
    const cardDragProps: any = {
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
}: any) {
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

function ToolCatalogDropZone({ editMode, children }: any) {
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

export function ToolsPageContent({
    addQuickAccessToolByKeyWithFeedback,
    categories,
    collapsed,
    handleQuickAccessDragEnd,
    isQuickAccessEditing,
    pinToolToNav,
    pinnedToolKeys,
    quickAccessKeySet,
    quickAccessTools,
    removeQuickAccessToolByKey,
    sensors,
    setIsQuickAccessEditing,
    shouldShowQuickAccess,
    toggleCategoryCollapsed,
    triggerTool,
    unpinToolFromNav
}: any) {
    const label = useToolsLabel();

    function renderToolItem(
        tool: any,
        dragProps: any = {},
        editQuickAccessAction: any = 'add'
    ) {
        const normalizedToolKey = normalizePinnedToolKey(tool.key);
        return (
            <ToolItem
                icon={getNavIconComponent(tool.navIcon, 'lucide:Wrench')}
                title={label(tool.titleKey)}
                description={label(tool.descriptionKey)}
                actionsLabel={label('view.tools.quick_access.actions')}
                navEligible={tool.navEligible}
                isPinned={pinnedToolKeys.has(normalizedToolKey)}
                isQuickAccess={quickAccessKeySet.has(normalizedToolKey)}
                editMode={isQuickAccessEditing}
                editQuickAccessAction={editQuickAccessAction}
                pinLabel={label('nav_menu.custom_nav.pin_to_nav')}
                unpinLabel={label('nav_menu.custom_nav.unpin_from_nav')}
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
            className="flex-1"
            style={{ overflowY: 'auto' }}
        >
            <div className="options-container">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="header">{label('view.tools.header')}</span>
                    <Button
                        type="button"
                        variant={isQuickAccessEditing ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() =>
                            setIsQuickAccessEditing((current: any) => !current)
                        }
                    >
                        {isQuickAccessEditing
                            ? label('view.tools.quick_access.done')
                            : label('view.tools.quick_access.edit')}
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
                            title={label('view.tools.quick_access.header')}
                            emptyDescription={label(
                                'view.tools.quick_access.empty'
                            )}
                        >
                            <SortableContext
                                items={quickAccessTools.map((tool: any) =>
                                    getQuickAccessDragId(tool.key)
                                )}
                                strategy={rectSortingStrategy}
                            >
                                <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 xl:grid-cols-3">
                                    {quickAccessTools.map((tool: any) => (
                                        <SortableQuickAccessTool
                                            key={tool.key}
                                            toolKey={tool.key}
                                            disabled={!isQuickAccessEditing}
                                        >
                                            {(dragProps: any) =>
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
                        {categories.map((category: any) => (
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
                                                {label(category.labelKey)}
                                            </span>
                                        </Button>
                                    );
                                })()}

                                {!collapsed[category.key] ? (
                                    <div className="grid grid-cols-1 gap-2.5 pl-4 lg:grid-cols-2 xl:grid-cols-3">
                                        {category.tools.map((tool: any) => (
                                            <DraggableCatalogTool
                                                key={tool.key}
                                                toolKey={tool.key}
                                                disabled={!isQuickAccessEditing}
                                            >
                                                {(dragProps: any) =>
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
        </PageScaffold>
    );
}
