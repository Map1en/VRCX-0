import {
    closestCenter,
    DndContext,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent
} from '@dnd-kit/core';
import {
    restrictToParentElement,
    restrictToVerticalAxis
} from '@dnd-kit/modifiers';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    EllipsisIcon,
    GlobeIcon,
    GripVerticalIcon,
    LockIcon,
    MoreHorizontalIcon,
    PlusIcon,
    RefreshCcwIcon,
    Share2Icon,
    UsersIcon
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/layout/PageScaffold';
import { cn } from '@/lib/utils';
import type { FavoriteGroupVisibility } from '@/platform/tauri/bindings';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Input } from '@/ui/shadcn/input';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { Spinner } from '@/ui/shadcn/spinner';

import type { FavoriteGroupView, FavoriteSource } from '../favoritesTypes';

const VISIBILITY_OPTIONS = ['public', 'friends', 'private'] as const;

const VISIBILITY_META: Record<
    FavoriteGroupVisibility,
    { labelKey: string; icon: LucideIcon }
> = {
    public: { labelKey: 'view.favorite.visibility.public', icon: GlobeIcon },
    friends: { labelKey: 'view.favorite.visibility.friends', icon: UsersIcon },
    private: { labelKey: 'view.favorite.visibility.private', icon: LockIcon }
};

function isFavoriteGroupVisibility(
    visibility: string
): visibility is FavoriteGroupVisibility {
    return VISIBILITY_OPTIONS.some((option) => option === visibility);
}

function getVisibilityLabel(
    t: ReturnType<typeof useTranslation>['t'],
    visibility: string
) {
    return isFavoriteGroupVisibility(visibility)
        ? t(VISIBILITY_META[visibility].labelKey)
        : visibility;
}

function GroupVisibilityIcon({
    visibility,
    label
}: {
    visibility?: string;
    label: string | null;
}) {
    if (!visibility || !label) {
        return <span className="size-4 shrink-0" aria-hidden="true" />;
    }
    if (!isFavoriteGroupVisibility(visibility)) {
        return (
            <span className="text-muted-foreground shrink-0 text-xs">
                {label}
            </span>
        );
    }
    const meta = VISIBILITY_META[visibility];
    return (
        <span className="shrink-0" title={label}>
            <meta.icon
                className="text-muted-foreground size-4"
                aria-hidden="true"
            />
        </span>
    );
}

type FavoriteGroupHandler = (group: FavoriteGroupView) => void | Promise<void>;

type GroupMenuProps = {
    group: FavoriteGroupView;
    onRemoteRename?: FavoriteGroupHandler;
    onRemoteVisibility?(
        group: FavoriteGroupView,
        visibility: FavoriteGroupVisibility
    ): void | Promise<void>;
    onRemoteClear?: FavoriteGroupHandler;
    onLocalRename?: FavoriteGroupHandler;
    onLocalDelete?: FavoriteGroupHandler;
    onHistoryClear?: FavoriteGroupHandler;
    onShareCollection?: FavoriteGroupHandler;
};

function GroupMenu({
    group,
    onRemoteRename,
    onRemoteVisibility,
    onRemoteClear,
    onLocalRename,
    onLocalDelete,
    onHistoryClear,
    onShareCollection
}: GroupMenuProps) {
    const { t } = useTranslation();

    if (group.source === 'history') {
        return (
            <DropdownMenu>
                <HintTooltip label={t('common.actions.configure')}>
                    <DropdownMenuTrigger
                        render={
                            <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                className="rounded-full"
                                onClick={(event) => event.stopPropagation()}
                            >
                                <EllipsisIcon data-icon="inline-start" />
                            </Button>
                        }
                    />
                </HintTooltip>
                <DropdownMenuContent
                    side="right"
                    align="start"
                    className="w-44"
                >
                    <DropdownMenuGroup>
                        <DropdownMenuItem
                            variant="destructive"
                            onClick={() => onHistoryClear?.(group)}
                        >
                            {t('common.actions.clear')}
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                </DropdownMenuContent>
            </DropdownMenu>
        );
    }

    if (group.source === 'remote') {
        return (
            <DropdownMenu>
                <HintTooltip label={t('common.actions.configure')}>
                    <DropdownMenuTrigger
                        render={
                            <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                className="rounded-full"
                                onClick={(event) => event.stopPropagation()}
                            >
                                <MoreHorizontalIcon data-icon="inline-start" />
                            </Button>
                        }
                    />
                </HintTooltip>
                <DropdownMenuContent
                    side="right"
                    align="start"
                    className="w-52"
                >
                    <DropdownMenuGroup>
                        {onShareCollection ? (
                            <DropdownMenuItem
                                onClick={() => onShareCollection(group)}
                            >
                                <Share2Icon data-icon="inline-start" />
                                {t(
                                    'view.favorite.share_collection.action.menu'
                                )}
                            </DropdownMenuItem>
                        ) : null}
                        {onRemoteRename ? (
                            <DropdownMenuItem
                                onClick={() => onRemoteRename(group)}
                            >
                                {t('view.favorite.rename_tooltip')}
                            </DropdownMenuItem>
                        ) : null}
                    </DropdownMenuGroup>
                    {onRemoteVisibility ? (
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                                {t('view.favorite.label.visibility')}
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="w-40">
                                <DropdownMenuGroup>
                                    {VISIBILITY_OPTIONS.map((visibility) => (
                                        <DropdownMenuCheckboxItem
                                            key={visibility}
                                            checked={
                                                group.visibility === visibility
                                            }
                                            onClick={() =>
                                                onRemoteVisibility(
                                                    group,
                                                    visibility
                                                )
                                            }
                                        >
                                            {getVisibilityLabel(t, visibility)}
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                </DropdownMenuGroup>
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                    ) : null}
                    {onRemoteClear ? (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                                <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() => onRemoteClear(group)}
                                >
                                    {t('common.actions.clear')}
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                        </>
                    ) : null}
                </DropdownMenuContent>
            </DropdownMenu>
        );
    }

    return (
        <DropdownMenu>
            <HintTooltip label={t('common.actions.configure')}>
                <DropdownMenuTrigger
                    render={
                        <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            className="rounded-full"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <EllipsisIcon data-icon="inline-start" />
                        </Button>
                    }
                />
            </HintTooltip>
            <DropdownMenuContent side="right" align="start" className="w-48">
                <DropdownMenuGroup>
                    {onShareCollection ? (
                        <DropdownMenuItem
                            onClick={() => onShareCollection(group)}
                        >
                            <Share2Icon data-icon="inline-start" />
                            {t('view.favorite.share_collection.action.menu')}
                        </DropdownMenuItem>
                    ) : null}
                    {onLocalRename ? (
                        <DropdownMenuItem onClick={() => onLocalRename(group)}>
                            {t('view.favorite.rename_tooltip')}
                        </DropdownMenuItem>
                    ) : null}
                    {onLocalDelete ? (
                        <DropdownMenuItem
                            variant="destructive"
                            onClick={() => onLocalDelete(group)}
                        >
                            {t('common.actions.delete')}
                        </DropdownMenuItem>
                    ) : null}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function SortableRailRow({
    id,
    children
}: {
    id: string;
    children: ReactNode;
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id });
    return (
        <div
            ref={setNodeRef}
            style={{
                transform: CSS.Translate.toString(transform),
                transition
            }}
            className={cn(
                'relative',
                isDragging &&
                    'z-10 cursor-grabbing opacity-60 [&_*]:cursor-grabbing'
            )}
            {...attributes}
            {...listeners}
        >
            {children}
        </div>
    );
}

function applyGroupOrder(
    groups: FavoriteGroupView[],
    order: readonly string[] | null
): FavoriteGroupView[] {
    if (!order) {
        return groups;
    }
    const groupsByKey = new Map(groups.map((group) => [group.key, group]));
    return order
        .map((key) => groupsByKey.get(key))
        .filter((group): group is FavoriteGroupView => Boolean(group));
}

function isSettledGroupOrder(
    groups: readonly FavoriteGroupView[],
    order: readonly string[]
): boolean {
    return (
        groups.length !== order.length ||
        groups.some((group) => !order.includes(group.key)) ||
        groups.every((group, index) => group.key === order[index])
    );
}

type GroupRailSectionProps = {
    title: string;
    icon: LucideIcon;
    emptyTitle: string;
    emptyDescription: string;
    groups: FavoriteGroupView[];
    selectedSource: FavoriteSource | '';
    selectedGroupKey: string;
    loading?: boolean;
    creating?: boolean;
    newGroupName?: string;
    newGroupLabel?: string;
    showNewGroup?: boolean;
    onRefresh?(): void;
    onSelect: FavoriteGroupHandler;
    onStartCreate?(): void;
    onNewGroupNameChange?(value: string): void;
    onConfirmCreate?(): void | Promise<void>;
    onCancelCreate?(): void;
    onRemoteRename?: FavoriteGroupHandler;
    onRemoteVisibility?(
        group: FavoriteGroupView,
        visibility: FavoriteGroupVisibility
    ): void | Promise<void>;
    onRemoteClear?: FavoriteGroupHandler;
    onLocalRename?: FavoriteGroupHandler;
    onLocalDelete?: FavoriteGroupHandler;
    onHistoryClear?: FavoriteGroupHandler;
    onShareCollection?: FavoriteGroupHandler;
    onReorder?(groupKeys: string[]): Promise<boolean>;
};

const GroupRailSection = memo(function GroupRailSection({
    title,
    icon: SectionIcon,
    emptyTitle,
    emptyDescription,
    groups,
    selectedSource,
    selectedGroupKey,
    loading,
    creating,
    newGroupName,
    newGroupLabel,
    showNewGroup,
    onRefresh,
    onSelect,
    onStartCreate,
    onNewGroupNameChange,
    onConfirmCreate,
    onCancelCreate,
    onRemoteRename,
    onRemoteVisibility,
    onRemoteClear,
    onLocalRename,
    onLocalDelete,
    onHistoryClear,
    onShareCollection,
    onReorder
}: GroupRailSectionProps) {
    const { t } = useTranslation();
    const resolvedNewGroupLabel =
        newGroupLabel || t('view.favorite.worlds.new_group');
    const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
    const orderedGroups = useMemo(
        () => applyGroupOrder(groups, pendingOrder),
        [groups, pendingOrder]
    );
    const dragClickSuppressedRef = useRef(false);
    const skipBlurCommitRef = useRef(false);
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
        if (pendingOrder && isSettledGroupOrder(groups, pendingOrder)) {
            setPendingOrder(null);
        }
    }, [groups, pendingOrder]);

    function releaseDragClickSuppression() {
        window.setTimeout(() => {
            dragClickSuppressedRef.current = false;
        }, 0);
    }

    function handleDragEnd({ active, over }: DragEndEvent) {
        releaseDragClickSuppression();
        if (!onReorder || !over || active.id === over.id) {
            return;
        }
        const keys = orderedGroups.map((group) => group.key);
        const fromIndex = keys.indexOf(String(active.id));
        const toIndex = keys.indexOf(String(over.id));
        if (fromIndex < 0 || toIndex < 0) {
            return;
        }
        const nextOrder = arrayMove(keys, fromIndex, toIndex);
        setPendingOrder(nextOrder);
        void onReorder(nextOrder).then((saved) => {
            if (!saved) {
                setPendingOrder(null);
            }
        });
    }

    function renderGroupRow(group: FavoriteGroupView) {
        const isActive =
            selectedSource === group.source && selectedGroupKey === group.key;
        let hasMenu = Boolean(
            onShareCollection || onLocalRename || onLocalDelete
        );
        if (group.source === 'history') {
            hasMenu = Boolean(onHistoryClear);
        } else if (group.source === 'remote') {
            hasMenu = Boolean(
                onShareCollection ||
                onRemoteRename ||
                onRemoteVisibility ||
                onRemoteClear
            );
        }
        const visibilityLabel = group.visibility
            ? getVisibilityLabel(t, group.visibility)
            : null;
        return (
            <div
                key={`${group.source}:${group.key}`}
                className={cn(
                    'group/rail-row flex w-full items-center gap-1 rounded-md transition-colors duration-(--motion-fast) ease-(--ease-out-ui) motion-reduce:transition-none',
                    isActive
                        ? 'bg-(--state-selected-surface) hover:bg-(--state-selected-hover-surface)'
                        : 'hover:bg-(--state-hover-surface)'
                )}
            >
                <Button
                    type="button"
                    variant="ghost"
                    className="h-auto min-w-0 flex-1 justify-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-transparent"
                    onClick={() => {
                        if (!dragClickSuppressedRef.current) {
                            void onSelect(group);
                        }
                    }}
                >
                    {onReorder && !group.visibility ? (
                        <span
                            className="flex size-4 shrink-0 cursor-grab items-center justify-center opacity-0 transition-opacity duration-(--motion-fast) ease-(--ease-out-ui) group-focus-within/rail-row:opacity-100 group-hover/rail-row:opacity-100 active:cursor-grabbing motion-reduce:transition-none"
                            aria-hidden="true"
                        >
                            <GripVerticalIcon className="text-muted-foreground size-4" />
                        </span>
                    ) : (
                        <GroupVisibilityIcon
                            visibility={group.visibility}
                            label={visibilityLabel}
                        />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {group.label}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                        {group.capacity
                            ? `${group.count ?? 0}/${group.capacity}`
                            : (group.count ?? 0)}
                    </span>
                </Button>
                {hasMenu ? (
                    <div
                        className={cn(
                            'shrink-0 pr-1 transition-opacity duration-(--motion-fast) ease-(--ease-out-ui) motion-reduce:transition-none',
                            isActive
                                ? 'opacity-100'
                                : 'opacity-0 group-focus-within/rail-row:opacity-100 group-hover/rail-row:opacity-100'
                        )}
                    >
                        <GroupMenu
                            group={group}
                            onRemoteRename={onRemoteRename}
                            onRemoteVisibility={onRemoteVisibility}
                            onRemoteClear={onRemoteClear}
                            onLocalRename={onLocalRename}
                            onLocalDelete={onLocalDelete}
                            onHistoryClear={onHistoryClear}
                            onShareCollection={onShareCollection}
                        />
                    </div>
                ) : null}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-1">
            <div className="mb-1 flex items-center justify-between text-sm font-semibold">
                <span className="flex min-w-0 items-center gap-1.5">
                    {SectionIcon ? (
                        <SectionIcon
                            className="text-muted-foreground size-4"
                            aria-hidden="true"
                        />
                    ) : null}
                    <span className="min-w-0 truncate">{title}</span>
                    {groups.length ? (
                        <Badge
                            variant="outline"
                            className="text-muted-foreground shrink-0 font-normal tabular-nums"
                        >
                            {groups.length}
                        </Badge>
                    ) : null}
                </span>
                {onRefresh ? (
                    <HintTooltip label={t('common.actions.refresh')}>
                        <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            className="rounded-full"
                            disabled={loading}
                            onClick={onRefresh}
                        >
                            {loading ? (
                                <Spinner data-icon="inline-start" />
                            ) : (
                                <RefreshCcwIcon data-icon="inline-start" />
                            )}
                        </Button>
                    </HintTooltip>
                ) : null}
            </div>
            <div className="flex flex-col gap-0.5">
                {loading && !groups.length ? (
                    Array.from({ length: 5 }, (_, index) => (
                        <div
                            key={`group-placeholder-${index}`}
                            className="pointer-events-none flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm opacity-70"
                        >
                            <Skeleton className="size-4 shrink-0 rounded-full" />
                            <Skeleton className="h-3.5 flex-1" />
                        </div>
                    ))
                ) : orderedGroups.length && onReorder ? (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        modifiers={[
                            restrictToVerticalAxis,
                            restrictToParentElement
                        ]}
                        onDragStart={() => {
                            dragClickSuppressedRef.current = true;
                        }}
                        onDragEnd={handleDragEnd}
                        onDragCancel={releaseDragClickSuppression}
                    >
                        <SortableContext
                            items={orderedGroups.map((group) => group.key)}
                            strategy={verticalListSortingStrategy}
                        >
                            {orderedGroups.map((group) => (
                                <SortableRailRow key={group.key} id={group.key}>
                                    {renderGroupRow(group)}
                                </SortableRailRow>
                            ))}
                        </SortableContext>
                    </DndContext>
                ) : orderedGroups.length ? (
                    orderedGroups.map(renderGroupRow)
                ) : (
                    <EmptyState
                        variant="inline"
                        title={emptyTitle}
                        description={emptyDescription}
                        className="min-h-24 border-0 px-2 py-4"
                        contentClassName="gap-1"
                        descriptionClassName="text-xs"
                    />
                )}
                {showNewGroup && !creating ? (
                    <Button
                        type="button"
                        variant="outline"
                        className="w-full border-dashed"
                        disabled={loading}
                        onClick={onStartCreate}
                    >
                        <PlusIcon data-icon="inline-start" />
                        <span>{resolvedNewGroupLabel}</span>
                    </Button>
                ) : null}
                {showNewGroup && creating ? (
                    <Input
                        value={newGroupName}
                        autoFocus
                        className="h-8 text-sm"
                        disabled={loading}
                        placeholder={resolvedNewGroupLabel}
                        onFocus={() => {
                            skipBlurCommitRef.current = false;
                        }}
                        onChange={(event) => {
                            skipBlurCommitRef.current = false;
                            onNewGroupNameChange?.(event.target.value);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                skipBlurCommitRef.current = true;
                                onConfirmCreate?.();
                            } else if (event.key === 'Escape') {
                                skipBlurCommitRef.current = true;
                                onCancelCreate?.();
                            }
                        }}
                        onBlur={() => {
                            if (skipBlurCommitRef.current) {
                                skipBlurCommitRef.current = false;
                                return;
                            }
                            if (newGroupName?.trim()) {
                                onConfirmCreate?.();
                            } else {
                                onCancelCreate?.();
                            }
                        }}
                    />
                ) : null}
            </div>
        </div>
    );
});

export { GroupRailSection };
