import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    type DragEndEvent,
    useSensor,
    useSensors
} from '@dnd-kit/core';
import {
    SortableContext,
    arrayMove,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    ArrowDownIcon,
    ArrowUpIcon,
    ChevronDownIcon,
    FolderHeartIcon,
    GripVerticalIcon,
    MoreVerticalIcon,
    PlusIcon,
    Trash2Icon
} from 'lucide-react';
import {
    useEffect,
    useMemo,
    useState,
    type CSSProperties,
    type ComponentProps,
    type ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';

import { getNavIconComponent } from '@/components/layout/navIconRegistry';
import { WorldRoomsCover } from '@/components/sidebar/world-rooms/WorldRoomsCover';
import { cn } from '@/lib/utils';
import {
    NAV_ICON_OPTIONS,
    normalizeNavIconKey
} from '@/shared/constants/navIcons';
import {
    DEFAULT_SIDEBAR_TAB_LAYOUT,
    type FavoriteGroupItem,
    type SidebarFavoriteCollectionTabLayoutItem,
    type SidebarTabLayout,
    type SidebarTabLayoutItem,
    createFavoriteCollectionTab,
    moveSidebarTab,
    normalizeSidebarTabLayout,
    sidebarTabFallbackIcon
} from '@/shared/utils/sidebarTabLayout';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from '@/ui/shadcn/collapsible';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Field, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

type SortableTabRowRenderProps = {
    dragHandleProps: ComponentProps<typeof Button> & {
        ref: (element: HTMLElement | null) => void;
    };
    isDragging: boolean;
    rowRef: (element: HTMLElement | null) => void;
    rowStyle: CSSProperties;
};

function tabActionLabel(
    t: (key: string, params?: Record<string, string>) => string,
    key: string,
    value: string
) {
    return t(`side_panel.settings.custom_tabs.dynamic.${key}`, {
        value
    });
}

function isFriendsTab(item: SidebarTabLayoutItem) {
    return item.type === 'system' && item.systemTab === 'friends';
}

function getTabLabel(item: SidebarTabLayoutItem, t: (key: string) => string) {
    if (item.type !== 'system') {
        return item.name;
    }
    return item.systemTab === 'groups'
        ? t('side_panel.groups')
        : t('side_panel.friends');
}

function NavIconSelect({
    value,
    fallbackIcon,
    ariaLabel,
    onValueChange
}: {
    value: string;
    fallbackIcon: string;
    ariaLabel: string;
    onValueChange: (value: string) => void;
}) {
    const normalizedIcon = normalizeNavIconKey(value, fallbackIcon);
    const CurrentIcon = getNavIconComponent(normalizedIcon);

    return (
        <Select
            value={normalizedIcon}
            items={NAV_ICON_OPTIONS.map((option) => {
                const OptionIcon = getNavIconComponent(option.key);
                return {
                    value: option.key,
                    label: (
                        <span className="flex min-w-0 items-center gap-2">
                            <OptionIcon data-icon="inline-start" />
                            <span className="truncate">{option.label}</span>
                        </span>
                    )
                };
            })}
            onValueChange={(value) => onValueChange(value ?? '')}
        >
            <HintTooltip label={ariaLabel}>
                <SelectTrigger size="sm" className="w-auto shrink-0 px-2">
                    <CurrentIcon data-icon="inline-start" />
                </SelectTrigger>
            </HintTooltip>
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

function SortableTabRow({
    id,
    children
}: {
    id: string;
    children: (props: SortableTabRowRenderProps) => ReactNode;
}) {
    const {
        attributes,
        listeners,
        setActivatorNodeRef,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id });
    const rowStyle: CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition
    };
    const dragHandleProps: SortableTabRowRenderProps['dragHandleProps'] = {
        ...attributes,
        ...listeners,
        ref: setActivatorNodeRef,
        onClick: (event: React.MouseEvent) => event.stopPropagation()
    };

    return children({
        dragHandleProps,
        isDragging,
        rowRef: setNodeRef,
        rowStyle
    });
}

function FavoriteSourceChecklist({
    item,
    favoriteGroupItems,
    onToggleSource
}: {
    item: SidebarFavoriteCollectionTabLayoutItem;
    favoriteGroupItems: FavoriteGroupItem[];
    onToggleSource: (key: string, checked: boolean) => void;
}) {
    const { t } = useTranslation();
    const remoteGroups = favoriteGroupItems.filter(
        (group) => group.source === 'remote'
    );
    const localGroups = favoriteGroupItems.filter(
        (group) => group.source === 'local'
    );
    const selected = new Set(item.sourceGroupKeys);

    function renderGroups(groups: FavoriteGroupItem[]) {
        return groups.map((group) => (
            <Field
                key={group.key}
                orientation="horizontal"
                className="cursor-pointer gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-(--state-hover-surface)"
            >
                <Checkbox
                    id={`${item.id}-${group.key}`}
                    checked={selected.has(group.key)}
                    onCheckedChange={(checked) =>
                        onToggleSource(group.key, Boolean(checked))
                    }
                />
                <FieldLabel
                    htmlFor={`${item.id}-${group.key}`}
                    className="min-w-0 flex-1 truncate text-xs font-normal"
                >
                    {group.label}
                </FieldLabel>
            </Field>
        ));
    }

    if (!favoriteGroupItems.length) {
        return (
            <div className="text-muted-foreground border-dashed px-2 py-2 text-center text-xs">
                {t('side_panel.settings.custom_tabs.no_favorite_groups')}
            </div>
        );
    }

    return (
        <div className="bg-muted/30 mt-1 flex max-h-52 flex-col gap-2 overflow-auto rounded-md p-1">
            {remoteGroups.length ? (
                <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground px-1.5 pt-1 text-[11px] font-medium tracking-wide uppercase">
                        {t('side_panel.settings.custom_tabs.remote_groups')}
                    </span>
                    {renderGroups(remoteGroups)}
                </div>
            ) : null}
            {localGroups.length ? (
                <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground px-1.5 pt-1 text-[11px] font-medium tracking-wide uppercase">
                        {t('side_panel.settings.custom_tabs.local_groups')}
                    </span>
                    {renderGroups(localGroups)}
                </div>
            ) : null}
        </div>
    );
}

export function SidePanelCustomTabsDialog({
    open,
    onOpenChange,
    layout,
    favoriteGroupItems,
    onSave
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    layout: SidebarTabLayout;
    favoriteGroupItems: FavoriteGroupItem[];
    onSave: (layout: SidebarTabLayout) => void;
}) {
    const { t } = useTranslation();
    const [draftLayout, setDraftLayout] = useState<SidebarTabLayout>(() =>
        normalizeSidebarTabLayout(layout)
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
    const sortableIds = useMemo(
        () => draftLayout.map((item) => item.id),
        [draftLayout]
    );
    const availableGroupKeys = useMemo(
        () => new Set(favoriteGroupItems.map((group) => group.key)),
        [favoriteGroupItems]
    );

    useEffect(() => {
        if (!open) {
            return;
        }
        setDraftLayout(normalizeSidebarTabLayout(layout));
    }, [layout, open]);

    function updateItem(
        id: string,
        updater: (item: SidebarTabLayoutItem) => SidebarTabLayoutItem
    ) {
        setDraftLayout((current) =>
            normalizeSidebarTabLayout(
                current.map((item) => (item.id === id ? updater(item) : item))
            )
        );
    }

    function handleDragEnd(event: DragEndEvent) {
        const { active, over } = event;
        if (!over || active.id === over.id) {
            return;
        }
        setDraftLayout((current) => {
            const oldIndex = current.findIndex((item) => item.id === active.id);
            const newIndex = current.findIndex((item) => item.id === over.id);
            if (oldIndex < 0 || newIndex < 0) {
                return current;
            }
            return normalizeSidebarTabLayout(
                arrayMove(current, oldIndex, newIndex)
            );
        });
    }

    function moveItem(index: number, delta: number) {
        setDraftLayout((current) =>
            normalizeSidebarTabLayout(
                moveSidebarTab(current, index, index + delta)
            )
        );
    }

    function setItemVisible(item: SidebarTabLayoutItem, visible: boolean) {
        if (isFriendsTab(item)) {
            return;
        }
        updateItem(item.id, (current) => ({
            ...current,
            visible
        }));
    }

    function toggleCollectionSource(id: string, key: string, checked: boolean) {
        updateItem(id, (current) => {
            if (current.type !== 'favoriteCollection') {
                return current;
            }
            const selected = new Set(current.sourceGroupKeys);
            if (checked) {
                selected.add(key);
            } else {
                selected.delete(key);
            }
            return {
                ...current,
                sourceGroupKeys: [...selected]
            };
        });
    }

    function addFavoriteCollection() {
        setDraftLayout((current) =>
            normalizeSidebarTabLayout([
                ...current,
                createFavoriteCollectionTab(
                    current,
                    t(
                        'side_panel.settings.custom_tabs.favorite_collection_default'
                    )
                )
            ])
        );
    }

    function removeCustomTab(id: string) {
        setDraftLayout((current) =>
            normalizeSidebarTabLayout(
                current.filter(
                    (item) => item.id !== id || item.type === 'system'
                )
            )
        );
    }

    function save() {
        onSave(normalizeSidebarTabLayout(draftLayout));
        onOpenChange(false);
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        {t('side_panel.settings.custom_tabs.title')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('side_panel.settings.custom_tabs.subtitle')}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex min-h-0 flex-col gap-5 overflow-auto pr-1">
                    <div className="flex min-h-0 flex-col gap-3">
                        <div className="flex flex-col gap-0.5">
                            <span className="text-sm font-medium">
                                {t(
                                    'side_panel.settings.custom_tabs.tab_layout'
                                )}
                            </span>
                            <span className="text-muted-foreground text-xs">
                                {t(
                                    'side_panel.settings.custom_tabs.layout_hint'
                                )}
                            </span>
                        </div>
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
                                items={sortableIds}
                                strategy={verticalListSortingStrategy}
                            >
                                <div className="flex flex-col gap-2">
                                    {draftLayout.map((item, index) => {
                                        const label = getTabLabel(item, t);
                                        const isCustom = item.type !== 'system';
                                        const isFriends = isFriendsTab(item);
                                        const selectedCount =
                                            item.type === 'favoriteCollection'
                                                ? item.sourceGroupKeys.filter(
                                                      (key) =>
                                                          availableGroupKeys.has(
                                                              key
                                                          )
                                                  ).length
                                                : 0;
                                        return (
                                            <SortableTabRow
                                                key={item.id}
                                                id={item.id}
                                            >
                                                {({
                                                    dragHandleProps,
                                                    isDragging,
                                                    rowRef,
                                                    rowStyle
                                                }) => (
                                                    <div
                                                        ref={rowRef}
                                                        style={rowStyle}
                                                        className={cn(
                                                            'flex flex-col rounded-lg border transition-colors',
                                                            isCustom
                                                                ? 'bg-card'
                                                                : 'bg-muted/30 border-transparent',
                                                            isDragging &&
                                                                'ring-ring/40 relative z-10 opacity-80 shadow-lg ring-1'
                                                        )}
                                                    >
                                                        <div className="flex min-w-0 items-center gap-2 p-2">
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon-sm"
                                                                className="text-muted-foreground shrink-0 cursor-grab touch-none active:cursor-grabbing"
                                                                aria-label={tabActionLabel(
                                                                    t,
                                                                    'drag_value',
                                                                    label
                                                                )}
                                                                {...dragHandleProps}
                                                            >
                                                                <GripVerticalIcon data-icon="inline-start" />
                                                            </Button>
                                                            {item.type ===
                                                            'worldRooms' ? (
                                                                <WorldRoomsCover
                                                                    worldId={
                                                                        item.worldId
                                                                    }
                                                                    className="size-7 rounded-md"
                                                                />
                                                            ) : (
                                                                <NavIconSelect
                                                                    value={
                                                                        item.icon
                                                                    }
                                                                    fallbackIcon={sidebarTabFallbackIcon(
                                                                        item
                                                                    )}
                                                                    ariaLabel={tabActionLabel(
                                                                        t,
                                                                        'icon_for_value',
                                                                        label
                                                                    )}
                                                                    onValueChange={(
                                                                        icon
                                                                    ) =>
                                                                        updateItem(
                                                                            item.id,
                                                                            (
                                                                                current
                                                                            ) =>
                                                                                current.type ===
                                                                                'worldRooms'
                                                                                    ? current
                                                                                    : {
                                                                                          ...current,
                                                                                          icon
                                                                                      }
                                                                        )
                                                                    }
                                                                />
                                                            )}
                                                            {isCustom ? (
                                                                <>
                                                                    <Input
                                                                        value={
                                                                            item.name
                                                                        }
                                                                        className="h-8 min-w-0 flex-1"
                                                                        aria-label={t(
                                                                            'side_panel.settings.custom_tabs.tab_name'
                                                                        )}
                                                                        onChange={(
                                                                            event
                                                                        ) =>
                                                                            updateItem(
                                                                                item.id,
                                                                                (
                                                                                    current
                                                                                ) =>
                                                                                    current.type !==
                                                                                    'system'
                                                                                        ? {
                                                                                              ...current,
                                                                                              name: event
                                                                                                  .target
                                                                                                  .value
                                                                                          }
                                                                                        : current
                                                                            )
                                                                        }
                                                                    />
                                                                    {item.type ===
                                                                    'worldRooms' ? (
                                                                        <Badge
                                                                            variant="secondary"
                                                                            className="shrink-0"
                                                                        >
                                                                            {t(
                                                                                'side_panel.settings.custom_tabs.world_badge'
                                                                            )}
                                                                        </Badge>
                                                                    ) : null}
                                                                </>
                                                            ) : (
                                                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                                                    <span className="min-w-0 truncate text-sm font-medium">
                                                                        {label}
                                                                    </span>
                                                                    <Badge
                                                                        variant="secondary"
                                                                        className="shrink-0"
                                                                    >
                                                                        {t(
                                                                            'side_panel.settings.custom_tabs.system_badge'
                                                                        )}
                                                                    </Badge>
                                                                </div>
                                                            )}
                                                            {isFriends ? (
                                                                <Tooltip>
                                                                    <TooltipTrigger
                                                                        render={
                                                                            <span className="inline-flex shrink-0 cursor-not-allowed">
                                                                                <Switch
                                                                                    checked
                                                                                    disabled
                                                                                    className="pointer-events-none"
                                                                                    aria-label={t(
                                                                                        'side_panel.settings.custom_tabs.always_visible'
                                                                                    )}
                                                                                />
                                                                            </span>
                                                                        }
                                                                    />
                                                                    <TooltipContent>
                                                                        {t(
                                                                            'side_panel.settings.custom_tabs.always_visible'
                                                                        )}
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            ) : (
                                                                <Switch
                                                                    checked={
                                                                        item.visible
                                                                    }
                                                                    className="shrink-0"
                                                                    aria-label={tabActionLabel(
                                                                        t,
                                                                        item.visible
                                                                            ? 'hide_value'
                                                                            : 'show_value',
                                                                        label
                                                                    )}
                                                                    onCheckedChange={(
                                                                        checked
                                                                    ) =>
                                                                        setItemVisible(
                                                                            item,
                                                                            Boolean(
                                                                                checked
                                                                            )
                                                                        )
                                                                    }
                                                                />
                                                            )}
                                                            <DropdownMenu>
                                                                <HintTooltip
                                                                    label={
                                                                        label
                                                                    }
                                                                >
                                                                    <DropdownMenuTrigger
                                                                        render={
                                                                            <Button
                                                                                type="button"
                                                                                variant="ghost"
                                                                                size="icon-sm"
                                                                                className="text-muted-foreground shrink-0"
                                                                            >
                                                                                <MoreVerticalIcon data-icon="inline-start" />
                                                                            </Button>
                                                                        }
                                                                    />
                                                                </HintTooltip>
                                                                <DropdownMenuContent align="end">
                                                                    <DropdownMenuItem
                                                                        disabled={
                                                                            index ===
                                                                            0
                                                                        }
                                                                        onClick={() =>
                                                                            moveItem(
                                                                                index,
                                                                                -1
                                                                            )
                                                                        }
                                                                    >
                                                                        <ArrowUpIcon data-icon="inline-start" />
                                                                        {t(
                                                                            'side_panel.settings.custom_tabs.move_up'
                                                                        )}
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuItem
                                                                        disabled={
                                                                            index ===
                                                                            draftLayout.length -
                                                                                1
                                                                        }
                                                                        onClick={() =>
                                                                            moveItem(
                                                                                index,
                                                                                1
                                                                            )
                                                                        }
                                                                    >
                                                                        <ArrowDownIcon data-icon="inline-start" />
                                                                        {t(
                                                                            'side_panel.settings.custom_tabs.move_down'
                                                                        )}
                                                                    </DropdownMenuItem>
                                                                    {isCustom ? (
                                                                        <>
                                                                            <DropdownMenuSeparator />
                                                                            <DropdownMenuItem
                                                                                variant="destructive"
                                                                                onClick={() =>
                                                                                    removeCustomTab(
                                                                                        item.id
                                                                                    )
                                                                                }
                                                                            >
                                                                                <Trash2Icon data-icon="inline-start" />
                                                                                {t(
                                                                                    'side_panel.settings.custom_tabs.delete_tab'
                                                                                )}
                                                                            </DropdownMenuItem>
                                                                        </>
                                                                    ) : null}
                                                                </DropdownMenuContent>
                                                            </DropdownMenu>
                                                        </div>
                                                        {item.type ===
                                                        'favoriteCollection' ? (
                                                            <Collapsible
                                                                defaultOpen={
                                                                    selectedCount ===
                                                                    0
                                                                }
                                                            >
                                                                <div className="border-t px-2 py-1">
                                                                    <CollapsibleTrigger
                                                                        render={
                                                                            <Button
                                                                                type="button"
                                                                                variant="ghost"
                                                                                size="sm"
                                                                                className="group h-auto w-full justify-between px-1.5 py-1"
                                                                            >
                                                                                <span className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs">
                                                                                    <FolderHeartIcon data-icon="inline-start" />
                                                                                    <span className="truncate">
                                                                                        {t(
                                                                                            'side_panel.settings.custom_tabs.favorite_groups_summary'
                                                                                        )}
                                                                                    </span>
                                                                                    <Badge
                                                                                        variant={
                                                                                            selectedCount
                                                                                                ? 'secondary'
                                                                                                : 'outline'
                                                                                        }
                                                                                        className={cn(
                                                                                            'shrink-0',
                                                                                            !selectedCount &&
                                                                                                'border-amber-500/40 text-amber-600 dark:text-amber-500'
                                                                                        )}
                                                                                    >
                                                                                        {
                                                                                            selectedCount
                                                                                        }
                                                                                    </Badge>
                                                                                </span>
                                                                                <ChevronDownIcon
                                                                                    data-icon="inline-end"
                                                                                    className="text-muted-foreground transition-transform group-aria-[expanded=true]:rotate-180"
                                                                                />
                                                                            </Button>
                                                                        }
                                                                    />
                                                                    <CollapsibleContent>
                                                                        <FavoriteSourceChecklist
                                                                            item={
                                                                                item
                                                                            }
                                                                            favoriteGroupItems={
                                                                                favoriteGroupItems
                                                                            }
                                                                            onToggleSource={(
                                                                                key,
                                                                                checked
                                                                            ) =>
                                                                                toggleCollectionSource(
                                                                                    item.id,
                                                                                    key,
                                                                                    checked
                                                                                )
                                                                            }
                                                                        />
                                                                    </CollapsibleContent>
                                                                </div>
                                                            </Collapsible>
                                                        ) : null}
                                                    </div>
                                                )}
                                            </SortableTabRow>
                                        );
                                    })}
                                </div>
                            </SortableContext>
                        </DndContext>
                        <Button
                            type="button"
                            variant="outline"
                            className="border-dashed"
                            onClick={addFavoriteCollection}
                        >
                            <PlusIcon data-icon="inline-start" />
                            {t(
                                'side_panel.settings.custom_tabs.add_favorite_tab'
                            )}
                        </Button>
                    </div>
                </div>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mr-auto"
                        onClick={() => {
                            setDraftLayout(
                                normalizeSidebarTabLayout(
                                    DEFAULT_SIDEBAR_TAB_LAYOUT
                                )
                            );
                        }}
                    >
                        {t('common.actions.reset')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button type="button" size="sm" onClick={save}>
                        {t('common.actions.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
