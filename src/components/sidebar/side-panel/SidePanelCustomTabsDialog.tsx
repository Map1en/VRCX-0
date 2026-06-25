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
    GripVerticalIcon,
    PlusIcon,
    Trash2Icon
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getNavIconComponent } from '@/components/layout/navIconRegistry';
import { cn } from '@/lib/utils';
import {
    NAV_ICON_OPTIONS,
    normalizeNavIconKey
} from '@/shared/constants/navIcons';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Field,
    FieldContent,
    FieldGroup,
    FieldLabel,
    FieldLegend,
    FieldSet
} from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Separator } from '@/ui/shadcn/separator';

import {
    DEFAULT_SIDEBAR_TAB_LAYOUT,
    type FavoriteGroupItem,
    type SidebarFavoriteCollectionTabLayoutItem,
    type SidebarTabDisplayMode,
    type SidebarTabLayout,
    type SidebarTabLayoutItem,
    createFavoriteCollectionTab,
    moveSidebarTab,
    normalizeSidebarTabDisplayMode,
    normalizeSidebarTabLayout,
    sidebarTabFallbackIcon
} from './sidebarTabLayout';

function tabActionLabel(
    t: (key: string, params?: Record<string, string>) => string,
    key: string,
    value: string
) {
    return t(`side_panel.settings.custom_tabs.dynamic.${key}`, {
        value
    });
}

function getTabLabel(item: SidebarTabLayoutItem, t: (key: string) => string) {
    if (item.type === 'favoriteCollection') {
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

    return (
        <Select value={normalizedIcon} onValueChange={onValueChange}>
            <SelectTrigger size="sm" className="w-32" aria-label={ariaLabel}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
                <SelectGroup>
                    {NAV_ICON_OPTIONS.map((option: any) => {
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
    children: (props: {
        dragHandleProps: Record<string, unknown>;
        isDragging: boolean;
        rowRef: (element: HTMLElement | null) => void;
        rowStyle: React.CSSProperties;
    }) => React.ReactNode;
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
    const rowStyle: any = {
        transform: CSS.Transform.toString(transform),
        transition
    };
    const dragHandleProps: any = {
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
        (group: any) => group.source === 'remote'
    );
    const localGroups = favoriteGroupItems.filter(
        (group: any) => group.source === 'local'
    );
    const selected = new Set(item.sourceGroupKeys);

    function renderGroups(groups: FavoriteGroupItem[]) {
        return groups.map((group: any) => (
            <Field
                key={group.key}
                orientation="horizontal"
                className="hover:bg-muted/50 cursor-pointer gap-2 rounded px-1.5 py-1 text-xs"
            >
                <Checkbox
                    id={`${item.id}-${group.key}`}
                    checked={selected.has(group.key)}
                    onCheckedChange={(checked: any) =>
                        onToggleSource(group.key, Boolean(checked))
                    }
                />
                <FieldLabel
                    htmlFor={`${item.id}-${group.key}`}
                    className="min-w-0 flex-1 truncate text-xs"
                >
                    {group.label}
                </FieldLabel>
            </Field>
        ));
    }

    if (!favoriteGroupItems.length) {
        return (
            <div className="text-muted-foreground rounded-md border border-dashed px-2 py-1.5 text-xs">
                {t('side_panel.settings.custom_tabs.no_favorite_groups')}
            </div>
        );
    }

    return (
        <div className="flex max-h-44 flex-col gap-2 overflow-auto rounded-md border p-1">
            {remoteGroups.length ? (
                <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground px-1 text-xs font-medium">
                        {t('side_panel.settings.custom_tabs.remote_groups')}
                    </span>
                    {renderGroups(remoteGroups)}
                </div>
            ) : null}
            {remoteGroups.length && localGroups.length ? <Separator /> : null}
            {localGroups.length ? (
                <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground px-1 text-xs font-medium">
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
    displayMode,
    favoriteGroupItems,
    onSave
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    layout: SidebarTabLayout;
    displayMode: SidebarTabDisplayMode;
    favoriteGroupItems: FavoriteGroupItem[];
    onSave: (
        layout: SidebarTabLayout,
        displayMode: SidebarTabDisplayMode
    ) => void;
}) {
    const { t } = useTranslation();
    const [draftLayout, setDraftLayout] = useState<SidebarTabLayout>(() =>
        normalizeSidebarTabLayout(layout)
    );
    const [draftDisplayMode, setDraftDisplayMode] =
        useState<SidebarTabDisplayMode>(() =>
            normalizeSidebarTabDisplayMode(displayMode)
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
        () => draftLayout.map((item: any) => item.id),
        [draftLayout]
    );

    useEffect(() => {
        if (!open) {
            return;
        }
        setDraftLayout(normalizeSidebarTabLayout(layout));
        setDraftDisplayMode(normalizeSidebarTabDisplayMode(displayMode));
    }, [displayMode, layout, open]);

    function updateItem(
        id: string,
        updater: (item: SidebarTabLayoutItem) => SidebarTabLayoutItem
    ) {
        setDraftLayout((current: any) =>
            normalizeSidebarTabLayout(
                current.map((item: any) =>
                    item.id === id ? updater(item) : item
                )
            )
        );
    }

    function handleDragEnd(event: DragEndEvent) {
        const { active, over } = event;
        if (!over || active.id === over.id) {
            return;
        }
        setDraftLayout((current: any) => {
            const oldIndex = current.findIndex(
                (item: any) => item.id === active.id
            );
            const newIndex = current.findIndex(
                (item: any) => item.id === over.id
            );
            if (oldIndex < 0 || newIndex < 0) {
                return current;
            }
            return normalizeSidebarTabLayout(
                arrayMove(current, oldIndex, newIndex)
            );
        });
    }

    function moveItem(index: number, delta: number) {
        setDraftLayout((current: any) =>
            normalizeSidebarTabLayout(
                moveSidebarTab(current, index, index + delta)
            )
        );
    }

    function addFavoriteCollection() {
        setDraftLayout((current: any) =>
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

    function removeFavoriteCollection(id: string) {
        setDraftLayout((current: any) =>
            normalizeSidebarTabLayout(
                current.filter(
                    (item: any) =>
                        item.id !== id || item.type !== 'favoriteCollection'
                )
            )
        );
    }

    function save() {
        onSave(normalizeSidebarTabLayout(draftLayout), draftDisplayMode);
        onOpenChange(false);
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        {t('side_panel.settings.custom_tabs.title')}
                    </DialogTitle>
                </DialogHeader>
                <div className="flex min-h-0 flex-col gap-4 overflow-auto pr-1">
                    <FieldGroup className="gap-3">
                        <Field orientation="horizontal" className="gap-3">
                            <FieldContent>
                                <FieldLabel>
                                    {t(
                                        'side_panel.settings.custom_tabs.display_mode'
                                    )}
                                </FieldLabel>
                            </FieldContent>
                            <Select
                                value={draftDisplayMode}
                                onValueChange={(value: any) =>
                                    setDraftDisplayMode(
                                        normalizeSidebarTabDisplayMode(value)
                                    )
                                }
                            >
                                <SelectTrigger size="sm" className="w-40">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        <SelectItem value="auto">
                                            {t(
                                                'side_panel.settings.custom_tabs.display_auto'
                                            )}
                                        </SelectItem>
                                        <SelectItem value="iconText">
                                            {t(
                                                'side_panel.settings.custom_tabs.display_icon_text'
                                            )}
                                        </SelectItem>
                                        <SelectItem value="iconOnly">
                                            {t(
                                                'side_panel.settings.custom_tabs.display_icon_only'
                                            )}
                                        </SelectItem>
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </Field>
                    </FieldGroup>
                    <FieldSet>
                        <FieldLegend>
                            {t('side_panel.settings.custom_tabs.tab_layout')}
                        </FieldLegend>
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
                                    {draftLayout.map(
                                        (item: any, index: any) => {
                                            const label = getTabLabel(item, t);
                                            const Icon = getNavIconComponent(
                                                item.icon,
                                                sidebarTabFallbackIcon(item)
                                            );
                                            const canHide =
                                                item.type ===
                                                    'favoriteCollection' ||
                                                item.systemTab === 'groups';
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
                                                    }: any) => (
                                                        <div
                                                            ref={rowRef}
                                                            style={rowStyle}
                                                            className={cn(
                                                                'flex flex-col gap-2 rounded-md border p-2 text-sm transition-colors',
                                                                isDragging &&
                                                                    'opacity-50'
                                                            )}
                                                        >
                                                            <div className="flex min-w-0 items-center gap-2">
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="icon-sm"
                                                                    className="shrink-0 cursor-grab touch-none active:cursor-grabbing"
                                                                    aria-label={tabActionLabel(
                                                                        t,
                                                                        'drag_value',
                                                                        label
                                                                    )}
                                                                    {...dragHandleProps}
                                                                >
                                                                    <GripVerticalIcon data-icon="inline-start" />
                                                                </Button>
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
                                                                        icon: any
                                                                    ) =>
                                                                        updateItem(
                                                                            item.id,
                                                                            (
                                                                                current: any
                                                                            ) => ({
                                                                                ...current,
                                                                                icon
                                                                            })
                                                                        )
                                                                    }
                                                                />
                                                                <Icon data-icon="inline-start" />
                                                                {item.type ===
                                                                'favoriteCollection' ? (
                                                                    <Input
                                                                        value={
                                                                            item.name
                                                                        }
                                                                        className="min-w-0 flex-1"
                                                                        aria-label={t(
                                                                            'side_panel.settings.custom_tabs.tab_name'
                                                                        )}
                                                                        onChange={(
                                                                            event: any
                                                                        ) =>
                                                                            updateItem(
                                                                                item.id,
                                                                                (
                                                                                    current: any
                                                                                ) =>
                                                                                    current.type ===
                                                                                    'favoriteCollection'
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
                                                                ) : (
                                                                    <span className="min-w-0 flex-1 truncate font-medium">
                                                                        {label}
                                                                    </span>
                                                                )}
                                                                <span className="text-muted-foreground text-xs">
                                                                    {t(
                                                                        'side_panel.settings.custom_tabs.visible'
                                                                    )}
                                                                </span>
                                                                <Checkbox
                                                                    checked={
                                                                        item.visible
                                                                    }
                                                                    disabled={
                                                                        !canHide
                                                                    }
                                                                    aria-label={tabActionLabel(
                                                                        t,
                                                                        item.visible
                                                                            ? 'hide_value'
                                                                            : 'show_value',
                                                                        label
                                                                    )}
                                                                    onCheckedChange={(
                                                                        checked: any
                                                                    ) =>
                                                                        updateItem(
                                                                            item.id,
                                                                            (
                                                                                current: any
                                                                            ) => ({
                                                                                ...current,
                                                                                visible:
                                                                                    current.type ===
                                                                                        'system' &&
                                                                                    current.systemTab ===
                                                                                        'friends'
                                                                                        ? true
                                                                                        : Boolean(
                                                                                              checked
                                                                                          )
                                                                            })
                                                                        )
                                                                    }
                                                                />
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="icon-sm"
                                                                    aria-label={tabActionLabel(
                                                                        t,
                                                                        'move_value_up',
                                                                        label
                                                                    )}
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
                                                                </Button>
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="icon-sm"
                                                                    aria-label={tabActionLabel(
                                                                        t,
                                                                        'move_value_down',
                                                                        label
                                                                    )}
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
                                                                </Button>
                                                                {item.type ===
                                                                'favoriteCollection' ? (
                                                                    <Button
                                                                        type="button"
                                                                        variant="ghost"
                                                                        size="icon-sm"
                                                                        aria-label={tabActionLabel(
                                                                            t,
                                                                            'delete_value',
                                                                            label
                                                                        )}
                                                                        onClick={() =>
                                                                            removeFavoriteCollection(
                                                                                item.id
                                                                            )
                                                                        }
                                                                    >
                                                                        <Trash2Icon data-icon="inline-start" />
                                                                    </Button>
                                                                ) : null}
                                                            </div>
                                                            {item.type ===
                                                            'favoriteCollection' ? (
                                                                <FavoriteSourceChecklist
                                                                    item={item}
                                                                    favoriteGroupItems={
                                                                        favoriteGroupItems
                                                                    }
                                                                    onToggleSource={(
                                                                        key: any,
                                                                        checked: any
                                                                    ) =>
                                                                        updateItem(
                                                                            item.id,
                                                                            (
                                                                                current: any
                                                                            ) => {
                                                                                if (
                                                                                    current.type !==
                                                                                    'favoriteCollection'
                                                                                ) {
                                                                                    return current;
                                                                                }
                                                                                const selected =
                                                                                    new Set(
                                                                                        current.sourceGroupKeys
                                                                                    );
                                                                                if (
                                                                                    checked
                                                                                ) {
                                                                                    selected.add(
                                                                                        key
                                                                                    );
                                                                                } else {
                                                                                    selected.delete(
                                                                                        key
                                                                                    );
                                                                                }
                                                                                return {
                                                                                    ...current,
                                                                                    sourceGroupKeys:
                                                                                        [
                                                                                            ...selected
                                                                                        ]
                                                                                };
                                                                            }
                                                                        )
                                                                    }
                                                                />
                                                            ) : null}
                                                        </div>
                                                    )}
                                                </SortableTabRow>
                                            );
                                        }
                                    )}
                                </div>
                            </SortableContext>
                        </DndContext>
                    </FieldSet>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-fit"
                        onClick={addFavoriteCollection}
                    >
                        <PlusIcon data-icon="inline-start" />
                        {t('side_panel.settings.custom_tabs.add_favorite_tab')}
                    </Button>
                </div>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                            setDraftLayout(
                                normalizeSidebarTabLayout(
                                    DEFAULT_SIDEBAR_TAB_LAYOUT
                                )
                            );
                            setDraftDisplayMode('auto');
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
