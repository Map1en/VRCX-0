import {
    EllipsisIcon,
    GlobeIcon,
    LockIcon,
    MoreHorizontalIcon,
    PlusIcon,
    RefreshCcwIcon,
    Share2Icon,
    UsersIcon
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
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

const VISIBILITY_OPTIONS = ['public', 'friends', 'private'] as const;
type FavoriteVisibility = (typeof VISIBILITY_OPTIONS)[number];

const VISIBILITY_META: Record<
    FavoriteVisibility,
    { labelKey: string; icon: LucideIcon }
> = {
    public: { labelKey: 'view.favorite.visibility.public', icon: GlobeIcon },
    friends: { labelKey: 'view.favorite.visibility.friends', icon: UsersIcon },
    private: { labelKey: 'view.favorite.visibility.private', icon: LockIcon }
};

function getVisibilityLabel(
    t: ReturnType<typeof useTranslation>['t'],
    visibility: string
) {
    const meta = VISIBILITY_META[visibility as FavoriteVisibility];
    return meta ? t(meta.labelKey) : visibility;
}

function GroupVisibilityIcon({
    visibility,
    label
}: {
    visibility: string;
    label: string;
}) {
    const meta = VISIBILITY_META[visibility as FavoriteVisibility];
    if (!meta) {
        return (
            <span className="text-muted-foreground shrink-0 text-xs">
                {label}
            </span>
        );
    }
    return (
        <span className="shrink-0" title={label}>
            <meta.icon
                className="text-muted-foreground size-3.5"
                aria-hidden="true"
            />
        </span>
    );
}

function GroupCapacityMeter({
    count,
    capacity
}: {
    count: number;
    capacity: number;
}) {
    const ratio = capacity > 0 ? count / capacity : 0;
    const percent = Math.min(100, Math.max(0, ratio * 100));
    const isFull = count >= capacity;
    const isWarning = !isFull && ratio >= 0.9;

    return (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <div className="bg-muted h-[3px] min-w-0 flex-1 overflow-hidden rounded-full">
                <div
                    className={cn(
                        'h-full rounded-full transition-[width,background-color] ease-out motion-reduce:transition-[background-color]',
                        isFull
                            ? 'bg-destructive'
                            : isWarning
                              ? 'bg-amber-600 dark:bg-amber-500'
                              : 'bg-primary'
                    )}
                    style={{ width: `${percent}%` }}
                />
            </div>
            <span
                className={cn(
                    'shrink-0 text-xs tabular-nums',
                    isFull
                        ? 'text-destructive'
                        : isWarning
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-muted-foreground'
                )}
            >
                {count}/{capacity}
            </span>
        </div>
    );
}

function GroupMenu({
    group,
    onRemoteRename,
    onRemoteVisibility,
    onRemoteClear,
    onLocalRename,
    onLocalDelete,
    onHistoryClear,
    onShareCollection
}: any) {
    const { t } = useTranslation();

    if (group.source === 'history') {
        return (
            <DropdownMenu>
                <DropdownMenuTrigger
                    render={
                        <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            className="rounded-full"
                            aria-label={t('common.actions.configure')}
                            onClick={(event) => event.stopPropagation()}
                        >
                            <EllipsisIcon data-icon="inline-start" />
                        </Button>
                    }
                />
                <DropdownMenuContent
                    side="right"
                    align="start"
                    className="w-44"
                >
                    <DropdownMenuGroup>
                        <DropdownMenuItem
                            variant="destructive"
                            onClick={() => onHistoryClear(group)}
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
                <DropdownMenuTrigger
                    render={
                        <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            className="rounded-full"
                            aria-label={t('common.actions.configure')}
                            onClick={(event) => event.stopPropagation()}
                        >
                            <MoreHorizontalIcon data-icon="inline-start" />
                        </Button>
                    }
                />
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
                        <DropdownMenuItem onClick={() => onRemoteRename(group)}>
                            {t('view.favorite.rename_tooltip')}
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
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
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        <DropdownMenuItem
                            variant="destructive"
                            onClick={() => onRemoteClear(group)}
                        >
                            {t('common.actions.clear')}
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                </DropdownMenuContent>
            </DropdownMenu>
        );
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        className="rounded-full"
                        aria-label={t('common.actions.configure')}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <EllipsisIcon data-icon="inline-start" />
                    </Button>
                }
            />
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
                    <DropdownMenuItem onClick={() => onLocalRename(group)}>
                        {t('view.favorite.rename_tooltip')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        variant="destructive"
                        onClick={() => onLocalDelete(group)}
                    >
                        {t('common.actions.delete')}
                    </DropdownMenuItem>
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

const GroupRailSection = memo(function GroupRailSection({
    title,
    icon: SectionIcon,
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
    onShareCollection
}: any) {
    const { t } = useTranslation();
    const resolvedNewGroupLabel =
        newGroupLabel || t('view.favorite.worlds.new_group');

    return (
        <div className="flex flex-col gap-1">
            <div className="mb-1 flex items-center justify-between text-sm font-semibold">
                <span className="flex items-center gap-1.5">
                    {SectionIcon ? (
                        <SectionIcon
                            className="text-muted-foreground size-4"
                            aria-hidden="true"
                        />
                    ) : null}
                    <span>{title}</span>
                </span>
                {onRefresh ? (
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        className="rounded-full"
                        aria-label={t('common.actions.refresh')}
                        disabled={loading}
                        onClick={onRefresh}
                    >
                        {loading ? (
                            <Spinner data-icon="inline-start" />
                        ) : (
                            <RefreshCcwIcon data-icon="inline-start" />
                        )}
                    </Button>
                ) : null}
            </div>
            <div className="flex flex-col gap-0.5">
                {loading && !groups.length ? (
                    Array.from({ length: 5 }, (_: any, index: any) => (
                        <div
                            key={`group-placeholder-${index}`}
                            className="pointer-events-none flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-sm opacity-70"
                        >
                            <Skeleton className="h-3.5 w-3/5" />
                            <Skeleton className="h-[3px] w-full rounded-full" />
                        </div>
                    ))
                ) : groups.length ? (
                    groups.map((group: any) => {
                        const isActive =
                            selectedSource === group.source &&
                            selectedGroupKey === group.key;
                        const visibilityLabel = group.visibility
                            ? getVisibilityLabel(t, group.visibility)
                            : null;
                        return (
                            <div
                                key={`${group.source}:${group.key}`}
                                className={cn(
                                    'group/rail-row flex w-full items-center gap-1 rounded-md transition-colors',
                                    isActive
                                        ? 'bg-primary/15'
                                        : 'hover:bg-muted'
                                )}
                            >
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-auto min-w-0 flex-1 justify-start gap-1 rounded-md px-2 py-1.5 text-left whitespace-normal hover:bg-transparent"
                                    onClick={() => onSelect(group)}
                                >
                                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                                        <span className="flex min-w-0 items-center gap-1.5">
                                            <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                                {group.label}
                                            </span>
                                            {visibilityLabel ? (
                                                <GroupVisibilityIcon
                                                    visibility={
                                                        group.visibility
                                                    }
                                                    label={visibilityLabel}
                                                />
                                            ) : null}
                                            {!group.capacity ? (
                                                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                                                    {group.count}
                                                </span>
                                            ) : null}
                                        </span>
                                        {group.capacity ? (
                                            <GroupCapacityMeter
                                                count={group.count}
                                                capacity={group.capacity}
                                            />
                                        ) : null}
                                    </span>
                                </Button>
                                <div className="shrink-0 pr-1">
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
                            </div>
                        );
                    })
                ) : (
                    <div className="text-muted-foreground py-3 text-center text-xs">
                        {t('common.no_data')}
                    </div>
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
                        onChange={(event) =>
                            onNewGroupNameChange(event.target.value)
                        }
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                onConfirmCreate();
                            } else if (event.key === 'Escape') {
                                onCancelCreate();
                            }
                        }}
                        onBlur={onCancelCreate}
                    />
                ) : null}
            </div>
        </div>
    );
});

export { GroupMenu, GroupRailSection };
