import {
    DndContext,
    closestCenter,
    useDraggable,
    useDroppable
} from '@dnd-kit/core';
import {
    SortableContext,
    useSortable,
    verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    ChevronRightIcon,
    Clock3Icon,
    MinusIcon,
    MoreHorizontalIcon,
    PanelLeftIcon,
    PlusIcon,
    StarIcon,
    type LucideIcon
} from 'lucide-react';
import {
    useEffect,
    useRef,
    useState,
    type ComponentProps,
    type CSSProperties,
    type ReactNode,
    type Ref,
    type RefObject
} from 'react';
import { useTranslation } from 'react-i18next';

import { getNavIconComponent } from '@/components/layout/navIconRegistry';
import {
    PageScaffold,
    PageToolbar,
    PageToolbarRow
} from '@/components/layout/PageScaffold';
import { ToolbarSearch } from '@/components/layout/ToolbarControls';
import { SettingsCard } from '@/features/settings/components/SettingsCard';
import { cn } from '@/lib/utils';
import type { ToolDefinition } from '@/shared/constants/tools';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Switch } from '@/ui/shadcn/switch';

import {
    getCatalogDragId,
    getQuickAccessDragId,
    normalizePinnedToolKey,
    quickAccessDropId,
    toolCatalogDropId
} from '../toolsPageHelpers';
import { useToolsPageState } from '../useToolsPageState';
import type { ToolStatusSummary } from '../useToolStatusSummaries';

type EditQuickAccessAction = 'add' | 'remove';
type DragRenderProps = {
    itemRef: Ref<HTMLDivElement>;
    itemStyle: CSSProperties;
    isDragging: boolean;
    dragProps: ComponentProps<'div'>;
};
type RenderToolItemOptions = {
    dragProps?: Partial<DragRenderProps>;
    editQuickAccessAction?: EditQuickAccessAction;
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

function ToolRow({
    icon: Icon,
    title,
    description,
    status,
    actionsLabel,
    toolsPageShortcutLabel,
    sidebarShortcutLabel,
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
}: {
    icon: LucideIcon;
    title: string;
    description: string;
    status?: ToolStatusSummary;
    actionsLabel: string;
    toolsPageShortcutLabel: string;
    sidebarShortcutLabel: string;
    addQuickAccessLabel: string;
    removeQuickAccessLabel: string;
    navEligible: boolean;
    isPinned: boolean;
    isQuickAccess: boolean;
    editMode: boolean;
    editQuickAccessAction: EditQuickAccessAction;
    itemRef?: Ref<HTMLDivElement>;
    itemStyle?: CSSProperties;
    isDragging?: boolean;
    dragProps?: ComponentProps<'div'>;
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
            className={cn(
                'group/tool bg-background grid h-9 grid-cols-[1.25rem_16rem_minmax(0,1fr)_auto_1.5rem] items-center gap-3 px-4 text-sm',
                '[&:has([aria-expanded=true])]:bg-[var(--vrcx-0-table-row-hover-surface)]',
                'has-[>button:focus-visible]:bg-[var(--vrcx-0-table-row-hover-surface)]',
                editMode
                    ? 'cursor-grab touch-none active:cursor-grabbing'
                    : 'hover:bg-[var(--vrcx-0-table-row-hover-surface)]',
                isDragging && 'opacity-50'
            )}
            {...(editMode && dragProps ? dragProps : {})}
        >
            <button
                type="button"
                className="col-span-3 grid h-full grid-cols-subgrid items-center gap-3 text-left outline-none"
                aria-disabled={editMode ? true : undefined}
                onClick={editMode ? undefined : onClick}
            >
                <Icon
                    aria-hidden="true"
                    className="text-muted-foreground size-4"
                />
                <span className="truncate font-medium">{title}</span>
                <span className="text-muted-foreground truncate text-xs">
                    {description}
                </span>
            </button>
            <div className="flex items-center justify-end gap-3">
                {status?.label ? (
                    <span
                        className={cn(
                            'flex items-center gap-1.5 text-xs whitespace-nowrap tabular-nums',
                            status.tone === 'active'
                                ? 'text-primary'
                                : 'text-muted-foreground'
                        )}
                    >
                        {status.toggle ? null : (
                            <span
                                aria-hidden="true"
                                className={cn(
                                    'size-1.5 rounded-full',
                                    status.tone === 'active'
                                        ? 'bg-primary'
                                        : 'bg-muted-foreground/70'
                                )}
                            />
                        )}
                        {status.label}
                    </span>
                ) : null}
                {status?.toggle ? (
                    <Switch
                        size="sm"
                        checked={status.toggle.enabled}
                        disabled={editMode}
                        aria-label={title}
                        onCheckedChange={(checked) => {
                            void status.toggle?.setEnabled(checked);
                        }}
                    />
                ) : null}
                {isPinned ? (
                    <PanelLeftIcon
                        aria-label={sidebarShortcutLabel}
                        className="text-muted-foreground size-4"
                    />
                ) : null}
            </div>
            <div className="flex size-6 items-center justify-center">
                {editMode ? (
                    <Button
                        type="button"
                        size="icon-xs"
                        variant="secondary"
                        className="size-6"
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
                                    className="text-muted-foreground hidden size-6 group-focus-within/tool:flex group-hover/tool:flex aria-expanded:flex"
                                    variant="ghost"
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
                        <DropdownMenuContent align="end" className="w-56">
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
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
                {editMode ? null : (
                    <ChevronRightIcon
                        aria-hidden="true"
                        className="text-muted-foreground/50 size-4 group-focus-within/tool:hidden group-hover/tool:hidden [.group\/tool:has([aria-expanded=true])_&]:hidden"
                    />
                )}
            </div>
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

    return children({
        itemRef: setNodeRef,
        itemStyle: {
            transform: CSS.Transform.toString(transform),
            transition
        },
        isDragging,
        dragProps: { ...attributes, ...listeners }
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

    return children({
        itemRef: setNodeRef,
        itemStyle: { transform: CSS.Translate.toString(transform) },
        isDragging,
        dragProps: { ...attributes, ...listeners }
    });
}

function ToolSection({
    id,
    title,
    children
}: {
    id: string;
    title: string;
    children: ReactNode;
}) {
    return (
        <div data-tools-section={id}>
            <SettingsCard
                cardId={id}
                title={title}
                bodyClassName="flex flex-col p-0"
            >
                {children}
            </SettingsCard>
        </div>
    );
}

function ToolList({ children }: { children: ReactNode }) {
    return (
        <div className="divide-stroke-subtle divide-y overflow-hidden rounded-b-xl">
            {children}
        </div>
    );
}

function QuickAccessDropZone({
    editMode,
    isEmpty,
    emptyDescription,
    children
}: {
    editMode: boolean;
    isEmpty: boolean;
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

    return (
        <div
            ref={setNodeRef}
            className={cn(
                'transition-colors duration-150 motion-reduce:transition-none',
                editMode &&
                    'outline-muted-foreground/50 m-2 overflow-hidden rounded-lg outline-2 -outline-offset-1 outline-dashed',
                editMode && isOver && 'outline-primary/70 bg-primary/5'
            )}
        >
            {isEmpty ? (
                <div className="text-muted-foreground flex min-h-16 items-center justify-center px-4 text-center text-sm">
                    {emptyDescription}
                </div>
            ) : (
                children
            )}
        </div>
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
                'flex flex-col gap-4 rounded-xl transition-colors duration-150 motion-reduce:transition-none',
                editMode && isOver && 'bg-primary/5'
            )}
        >
            {children}
        </div>
    );
}

const QUICK_ACCESS_SECTION_ID = 'tools-section-quick-access';
const RECENT_SECTION_ID = 'tools-section-recent';
const SECTION_SCROLL_OFFSET = 8;

function categorySectionId(categoryKey: string) {
    return `tools-section-${categoryKey}`;
}

type PinnedSection = {
    id: string;
    targetTop: number;
    settled: boolean;
};

function sectionElement(container: HTMLElement, id: string) {
    return container.querySelector<HTMLElement>(`[data-tools-section="${id}"]`);
}

function useActiveSection(
    scrollRef: RefObject<HTMLDivElement | null>,
    sectionKey: string
) {
    const [activeId, setActiveId] = useState<string | null>(null);
    const pinnedRef = useRef<PinnedSection | null>(null);

    useEffect(() => {
        const sectionIds = sectionKey ? sectionKey.split('\n') : [];
        const container = scrollRef.current;
        if (!container) {
            return undefined;
        }
        const compute = () => {
            const atBottom =
                container.scrollTop + container.clientHeight >=
                container.scrollHeight - 1;
            if (atBottom) {
                return sectionIds[sectionIds.length - 1] ?? null;
            }
            const threshold = container.scrollTop + SECTION_SCROLL_OFFSET + 1;
            let current: string | null = sectionIds[0] ?? null;
            for (const id of sectionIds) {
                const element = sectionElement(container, id);
                if (element && element.offsetTop <= threshold) {
                    current = id;
                }
            }
            return current;
        };
        const update = () => {
            const pinned = pinnedRef.current;
            if (pinned) {
                const reached =
                    Math.abs(container.scrollTop - pinned.targetTop) <= 1;
                if (!pinned.settled) {
                    if (reached) {
                        pinned.settled = true;
                    }
                    return;
                }
                if (reached) {
                    return;
                }
                pinnedRef.current = null;
            }
            setActiveId(compute());
        };
        update();
        container.addEventListener('scroll', update, { passive: true });
        return () => {
            container.removeEventListener('scroll', update);
        };
    }, [scrollRef, sectionKey]);

    function scrollTo(id: string) {
        const container = scrollRef.current;
        const element = container ? sectionElement(container, id) : null;
        if (!container || !element) {
            return;
        }
        const targetTop = Math.max(
            0,
            Math.min(
                element.offsetTop - SECTION_SCROLL_OFFSET,
                container.scrollHeight - container.clientHeight
            )
        );
        pinnedRef.current = {
            id,
            targetTop,
            settled: Math.abs(container.scrollTop - targetTop) <= 1
        };
        setActiveId(id);
        container.scrollTo({ top: targetTop, behavior: 'smooth' });
    }

    return { activeId, scrollTo };
}

export function ToolsPageContent({ embedded = false }: { embedded?: boolean }) {
    const {
        addQuickAccessToolByKeyWithFeedback,
        categories,
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
        triggerTool,
        unpinToolFromNav
    } = useToolsPageState();
    const label = useToolsLabel();
    const [filterText, setFilterText] = useState('');
    const normalizedFilter = filterText.trim().toLocaleLowerCase();
    const isFiltering = normalizedFilter.length > 0;

    const showQuickAccess = !isFiltering && shouldShowQuickAccess;
    const hidePinnedTools = !isFiltering && !isQuickAccessEditing;
    const isListedInQuickAccess = (tool: ToolDefinition) => {
        if (!hidePinnedTools) {
            return false;
        }
        const key = normalizePinnedToolKey(tool.key);
        return (
            (showQuickAccess && quickAccessKeySet.has(key)) ||
            pinnedToolKeys.has(key)
        );
    };
    const visibleCategories = categories
        .map((category) => ({
            ...category,
            tools: category.tools.filter(
                (tool) =>
                    !isListedInQuickAccess(tool) &&
                    (!isFiltering ||
                        `${label(tool.titleKey)}\n${label(tool.descriptionKey)}`
                            .toLocaleLowerCase()
                            .includes(normalizedFilter))
            )
        }))
        .filter((category) => category.tools.length > 0);
    const visibleRecentTools = recentTools.filter(
        (tool) => !isListedInQuickAccess(tool)
    );

    function renderToolRow(
        tool: ToolDefinition,
        {
            dragProps = {},
            editQuickAccessAction = 'add'
        }: RenderToolItemOptions = {}
    ) {
        const normalizedToolKey = normalizePinnedToolKey(tool.key);
        return (
            <ToolRow
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

    const showRecent =
        !isFiltering && !isQuickAccessEditing && visibleRecentTools.length > 0;
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const railItems = [
        ...(showQuickAccess
            ? [
                  {
                      id: QUICK_ACCESS_SECTION_ID,
                      icon: StarIcon,
                      title: label('view.tools.quick_access.header')
                  }
              ]
            : []),
        ...(showRecent
            ? [
                  {
                      id: RECENT_SECTION_ID,
                      icon: Clock3Icon,
                      title: label('view.tools.recent')
                  }
              ]
            : []),
        ...visibleCategories.map((category) => ({
            id: categorySectionId(category.key),
            icon: undefined,
            title: label(category.labelKey)
        }))
    ];
    const { activeId: activeSectionId, scrollTo: scrollToSection } =
        useActiveSection(
            scrollRef,
            railItems.map((item) => item.id).join('\n')
        );

    return (
        <PageScaffold id="chart" embedded={embedded} className="flex-1">
            <PageToolbar>
                <PageToolbarRow>
                    <ToolbarSearch
                        value={filterText}
                        onValueChange={setFilterText}
                        placeholder={label('view.tools.filter_placeholder')}
                    />
                    <Button
                        type="button"
                        className="ml-auto"
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

            <div
                ref={scrollRef}
                className="relative mt-4 min-h-0 flex-1 overflow-y-auto"
            >
                <div className="mx-auto grid w-full max-w-5xl grid-cols-[11rem_minmax(0,1fr)] gap-6 pb-6">
                    <nav
                        aria-label={label('view.tools.sections')}
                        className="sticky top-0 flex flex-col gap-0.5 self-start"
                    >
                        {railItems.map((item) => {
                            const RailIcon = item.icon;
                            const active = item.id === activeSectionId;
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    className={cn(
                                        'focus-visible:ring-ring flex h-7 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm outline-none focus-visible:ring-2',
                                        active
                                            ? 'text-foreground bg-(--state-selected-surface)'
                                            : 'text-muted-foreground hover:text-foreground'
                                    )}
                                    aria-current={active ? 'true' : undefined}
                                    onClick={() => scrollToSection(item.id)}
                                >
                                    {RailIcon ? (
                                        <RailIcon
                                            aria-hidden="true"
                                            className="size-4 shrink-0"
                                        />
                                    ) : null}
                                    <span className="truncate">
                                        {item.title}
                                    </span>
                                </button>
                            );
                        })}
                    </nav>

                    <div className="flex min-w-0 flex-col gap-4">
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={handleQuickAccessDragEnd}
                        >
                            {showQuickAccess ? (
                                <ToolSection
                                    id={QUICK_ACCESS_SECTION_ID}
                                    title={label(
                                        'view.tools.quick_access.header'
                                    )}
                                >
                                    <QuickAccessDropZone
                                        editMode={isQuickAccessEditing}
                                        isEmpty={quickAccessTools.length === 0}
                                        emptyDescription={label(
                                            'view.tools.quick_access.empty'
                                        )}
                                    >
                                        <SortableContext
                                            items={quickAccessTools.map(
                                                (tool) =>
                                                    getQuickAccessDragId(
                                                        tool.key
                                                    )
                                            )}
                                            strategy={
                                                verticalListSortingStrategy
                                            }
                                        >
                                            <ToolList>
                                                {quickAccessTools.map(
                                                    (tool) => (
                                                        <SortableQuickAccessTool
                                                            key={tool.key}
                                                            toolKey={tool.key}
                                                            disabled={
                                                                !isQuickAccessEditing
                                                            }
                                                        >
                                                            {(dragProps) =>
                                                                renderToolRow(
                                                                    tool,
                                                                    {
                                                                        dragProps,
                                                                        editQuickAccessAction:
                                                                            'remove'
                                                                    }
                                                                )
                                                            }
                                                        </SortableQuickAccessTool>
                                                    )
                                                )}
                                            </ToolList>
                                        </SortableContext>
                                    </QuickAccessDropZone>
                                </ToolSection>
                            ) : null}

                            {showRecent ? (
                                <ToolSection
                                    id={RECENT_SECTION_ID}
                                    title={label('view.tools.recent')}
                                >
                                    <ToolList>
                                        {visibleRecentTools.map((tool) => (
                                            <div key={tool.key}>
                                                {renderToolRow(tool)}
                                            </div>
                                        ))}
                                    </ToolList>
                                </ToolSection>
                            ) : null}

                            <ToolCatalogDropZone
                                editMode={isQuickAccessEditing}
                            >
                                {visibleCategories.length === 0 ? (
                                    <div className="text-muted-foreground flex min-h-32 items-center justify-center text-sm">
                                        {label('view.tools.filter_empty')}
                                    </div>
                                ) : null}
                                {visibleCategories.map((category) => (
                                    <ToolSection
                                        key={category.key}
                                        id={categorySectionId(category.key)}
                                        title={label(category.labelKey)}
                                    >
                                        <ToolList>
                                            {category.tools.map((tool) => (
                                                <DraggableCatalogTool
                                                    key={tool.key}
                                                    toolKey={tool.key}
                                                    disabled={
                                                        !isQuickAccessEditing
                                                    }
                                                >
                                                    {(dragProps) =>
                                                        renderToolRow(tool, {
                                                            dragProps
                                                        })
                                                    }
                                                </DraggableCatalogTool>
                                            ))}
                                        </ToolList>
                                    </ToolSection>
                                ))}
                            </ToolCatalogDropZone>
                        </DndContext>
                    </div>
                </div>
            </div>
        </PageScaffold>
    );
}
