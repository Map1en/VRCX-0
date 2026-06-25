import {
    EllipsisIcon,
    MoreHorizontalIcon,
    PlusIcon,
    RefreshCcwIcon
} from 'lucide-react';
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
import { Spinner } from '@/ui/shadcn/spinner';

const VISIBILITY_OPTIONS = ['public', 'friends', 'private'] as const;
type FavoriteVisibility = (typeof VISIBILITY_OPTIONS)[number];

const VISIBILITY_LABEL_KEYS: Record<FavoriteVisibility, string> = {
    public: 'view.favorite.visibility.public',
    friends: 'view.favorite.visibility.friends',
    private: 'view.favorite.visibility.private'
};

function getVisibilityLabel(
    t: ReturnType<typeof useTranslation>['t'],
    visibility: string
) {
    return VISIBILITY_LABEL_KEYS[visibility as FavoriteVisibility]
        ? t(VISIBILITY_LABEL_KEYS[visibility as FavoriteVisibility])
        : visibility;
}

function GroupMenu({
    group,
    onRemoteRename,
    onRemoteVisibility,
    onRemoteClear,
    onLocalRename,
    onLocalDelete,
    onHistoryClear
}: any) {
    const { t } = useTranslation();

    if (group.source === 'history') {
        return (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        className="rounded-full"
                        aria-label={t('common.actions.configure')}
                        onClick={(event: any) => event.stopPropagation()}
                    >
                        <EllipsisIcon data-icon="inline-start" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    side="right"
                    align="start"
                    className="w-44"
                >
                    <DropdownMenuGroup>
                        <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => onHistoryClear(group)}
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
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        className="rounded-full"
                        aria-label={t('common.actions.configure')}
                        onClick={(event: any) => event.stopPropagation()}
                    >
                        <MoreHorizontalIcon data-icon="inline-start" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    side="right"
                    align="start"
                    className="w-52"
                >
                    <DropdownMenuGroup>
                        <DropdownMenuItem
                            onSelect={() => onRemoteRename(group)}
                        >
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
                                        onSelect={() =>
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
                            onSelect={() => onRemoteClear(group)}
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
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className="rounded-full"
                    aria-label={t('common.actions.configure')}
                    onClick={(event: any) => event.stopPropagation()}
                >
                    <EllipsisIcon data-icon="inline-start" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-48">
                <DropdownMenuGroup>
                    <DropdownMenuItem onSelect={() => onLocalRename(group)}>
                        {t('view.favorite.rename_tooltip')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => onLocalDelete(group)}
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
    onHistoryClear
}: any) {
    const { t } = useTranslation();
    const resolvedNewGroupLabel =
        newGroupLabel || t('view.favorite.worlds.new_group');

    return (
        <div className="flex flex-col gap-2">
            <div className="mb-[9px] flex items-center justify-between text-sm font-semibold">
                <span>{title}</span>
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
            <div className="flex flex-col gap-2">
                {loading && !groups.length ? (
                    Array.from({ length: 5 }, (_: any, index: any) => (
                        <div
                            key={`group-placeholder-${index}`}
                            className="border-border pointer-events-none flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left text-sm opacity-70"
                        >
                            <div className="min-w-0">
                                <div className="truncate font-semibold">
                                    {t('view.favorite.label.group')} {index + 1}
                                </div>
                                <div className="bg-muted mt-1 h-3 w-14 rounded" />
                            </div>
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
                                    'hover:bg-muted flex w-full items-start justify-between rounded-lg border transition-colors',
                                    isActive
                                        ? 'border-primary bg-primary/5'
                                        : 'border-border'
                                )}
                            >
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-auto min-w-0 flex-1 justify-start rounded-lg px-3 py-2 text-left whitespace-normal"
                                    onClick={() => onSelect(group)}
                                >
                                    <span className="min-w-0">
                                        <span className="block truncate font-semibold">
                                            {group.label}
                                        </span>
                                        <span className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs font-normal">
                                            {visibilityLabel ? (
                                                <span>{visibilityLabel}</span>
                                            ) : null}
                                            {group.capacity ? (
                                                <span>
                                                    {group.count}/
                                                    {group.capacity}
                                                </span>
                                            ) : (
                                                <span>{group.count}</span>
                                            )}
                                        </span>
                                    </span>
                                </Button>
                                <div className="shrink-0 py-1 pr-1">
                                    <GroupMenu
                                        group={group}
                                        onRemoteRename={onRemoteRename}
                                        onRemoteVisibility={onRemoteVisibility}
                                        onRemoteClear={onRemoteClear}
                                        onLocalRename={onLocalRename}
                                        onLocalDelete={onLocalDelete}
                                        onHistoryClear={onHistoryClear}
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
                        onChange={(event: any) =>
                            onNewGroupNameChange(event.target.value)
                        }
                        onKeyDown={(event: any) => {
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
