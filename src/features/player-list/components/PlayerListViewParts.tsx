import { HomeIcon, UsersIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DataTableSortButton } from '@/components/data-table/DataTableSortButton';
import {
    DataTableColumnDndProvider,
    DataTableColumnSizeColGroup,
    DataTableColumnSortableContext,
    DataTableEmptyRow,
    DataTableHeader,
    DataTableScrollArea,
    DataTableSurface,
    getDataTableSizingStyle
} from '@/components/data-table/DataTableView';
import { ResizableTableCell } from '@/components/data-table/ResizableTableParts';
import { EmptyState } from '@/components/layout/PageScaffold';
import { LocationWorld } from '@/components/LocationWorld';
import { formatDateFilter, timeToText } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { defaultWorldCacheInfo } from '@/lib/worldAssetBundle';
import { openUserDialog, openWorldDialog } from '@/services/dialogService';
import { parseLocation } from '@/shared/utils/locationParser';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Table, TableBody, TableRow } from '@/ui/shadcn/table';

import {
    fileAnalysisSizeForPlatform,
    formatCount,
    getHomeWorldId,
    getWorldImage,
    resolvePlatformBadge
} from '../playerListDisplay';
import { parseTimeMs } from '../playerListRows';
import { PLAYER_LIST_COLUMN_IDS as COLUMN_IDS } from '../playerListState';

export { DataTableSortButton as SortButton };

export function CurrentWorldHeader({
    cacheInfo = defaultWorldCacheInfo(),
    clockNow,
    currentUserSnapshot,
    fileAnalysis = {},
    friendCount,
    instanceCreatedAt = '',
    instanceGroupName = '',
    instanceLocation = '',
    instanceWorldId = '',
    instanceWorldName = '',
    isGameRunning,
    onPreviewImage,
    playerCount,
    parsedLocation,
    startedAt,
    world
}: any) {
    const { t } = useTranslation();
    const worldId =
        world?.id || instanceWorldId || parsedLocation.worldId || '';
    const worldName = world?.name || instanceWorldName || 'Current instance';
    const homeWorldId = getHomeWorldId(
        currentUserSnapshot?.$homeLocation || currentUserSnapshot?.homeLocation
    );
    const isHome = Boolean(homeWorldId && worldId && homeWorldId === worldId);
    const imageUrl = getWorldImage(world);
    const platforms = Array.isArray(world?.platforms)
        ? world.platforms.map(resolvePlatformBadge)
        : [];
    const startedAtMs = parseTimeMs(startedAt || instanceCreatedAt);
    const elapsedMs = startedAtMs ? Math.max(clockNow - startedAtMs, 0) : 0;
    const hasAvatarScalingDisabled = Array.isArray(world?.tags)
        ? world.tags.includes('feature_avatar_scaling_disabled')
        : false;
    const currentInstanceLocationObject = parseLocation(instanceLocation || '');
    const worldDialogTarget =
        currentInstanceLocationObject.isRealInstance &&
        currentInstanceLocationObject.tag
            ? currentInstanceLocationObject.tag
            : worldId;

    if (!isGameRunning || !worldId) {
        return null;
    }

    return (
        <div className="flex min-h-28 flex-col gap-3 md:flex-row">
            <Button
                type="button"
                variant="ghost"
                className="bg-muted h-28 w-40 shrink-0 overflow-hidden rounded-md border p-0"
                disabled={!imageUrl}
                aria-label={worldName}
                onClick={() =>
                    imageUrl &&
                    onPreviewImage?.({
                        url: convertFileUrlToImageUrl(
                            world?.imageUrl || imageUrl,
                            1024
                        ),
                        title: worldName
                    })
                }
            >
                {imageUrl ? (
                    <img
                        src={imageUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                    />
                ) : (
                    <UsersIcon
                        data-icon="inline-start"
                        className="text-muted-foreground"
                    />
                )}
            </Button>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div>
                    <Button
                        type="button"
                        variant="ghost"
                        className="hover:text-primary h-auto max-w-full justify-start p-0 text-left text-base font-semibold"
                        onClick={() =>
                            openWorldDialog({
                                worldId: worldDialogTarget,
                                title: worldName
                            })
                        }
                    >
                        {isHome ? <HomeIcon data-icon="inline-start" /> : null}
                        <span className="truncate">{worldName}</span>
                    </Button>
                </div>
                {world?.authorName ? (
                    <Button
                        type="button"
                        variant="ghost"
                        className="text-muted-foreground hover:text-primary h-auto justify-start p-0 font-mono text-xs"
                        onClick={() =>
                            world?.authorId &&
                            openUserDialog({
                                userId: world.authorId,
                                title: world.authorName || undefined
                            })
                        }
                    >
                        {world.authorName}
                    </Button>
                ) : null}
                <div className="flex flex-wrap gap-1.5">
                    {world?.isLabs ? (
                        <Badge variant="outline">
                            {t('dialog.world.tags.labs')}
                        </Badge>
                    ) : world?.releaseStatus === 'public' ? (
                        <Badge variant="outline">
                            {t('dialog.world.tags.public')}
                        </Badge>
                    ) : world?.releaseStatus === 'private' ? (
                        <Badge variant="outline">
                            {t('dialog.world.tags.private')}
                        </Badge>
                    ) : null}
                    {platforms.map((platform: any) => {
                        const Icon = platform.icon;
                        return (
                            <Badge
                                key={platform.key}
                                variant="outline"
                                className="gap-1"
                            >
                                {Icon ? <Icon className="size-3.5" /> : null}
                                {platform.label}
                                {fileAnalysisSizeForPlatform(
                                    fileAnalysis,
                                    platform.key
                                ) ? (
                                    <span className="border-l pl-1">
                                        {fileAnalysisSizeForPlatform(
                                            fileAnalysis,
                                            platform.key
                                        )}
                                    </span>
                                ) : null}
                            </Badge>
                        );
                    })}
                    {hasAvatarScalingDisabled ? (
                        <Badge variant="outline">
                            {t('dialog.world.tags.avatar_scaling_disabled')}
                        </Badge>
                    ) : null}
                    {cacheInfo?.inCache ? (
                        <Badge variant="outline">
                            {cacheInfo.cacheSize
                                ? `${cacheInfo.cacheSize} ${t('dialog.world.tags.cache')}`
                                : t('dialog.world.tags.cache')}
                        </Badge>
                    ) : null}
                    {instanceGroupName ? (
                        <Badge variant="outline">{instanceGroupName}</Badge>
                    ) : null}
                    {playerCount > 0 ? (
                        <Badge variant="outline">
                            {playerCount}
                            {friendCount > 0 ? ` (${friendCount})` : ''}
                            {' players'}
                        </Badge>
                    ) : null}
                    {elapsedMs > 0 ? (
                        <Badge variant="outline">
                            {timeToText(elapsedMs, true)}
                        </Badge>
                    ) : null}
                </div>
                <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-2 font-mono text-xs">
                    <LocationWorld
                        locationObject={currentInstanceLocationObject}
                        currentUserId={currentUserSnapshot?.id || ''}
                        grouphint={instanceGroupName || ''}
                        hint={worldName}
                        className="font-sans"
                    />
                </div>
                {world?.description && world.description !== worldName ? (
                    <div className="line-clamp-2 text-xs break-words">
                        {world.description}
                    </div>
                ) : null}
            </div>
            <div className="grid min-w-40 content-start gap-2 text-xs sm:grid-cols-3 md:grid-cols-1">
                <div>
                    <span className="text-muted-foreground block">
                        {t('dialog.world.info.capacity')}
                    </span>
                    <span className="font-medium">
                        {formatCount(
                            world?.recommendedCapacity || world?.capacity
                        )}
                        {world?.capacity
                            ? ` (${formatCount(world.capacity)})`
                            : ''}
                    </span>
                </div>
                <div>
                    <span className="text-muted-foreground block">
                        {t('view.player_list.success.last_updated')}
                    </span>
                    <span className="font-medium">
                        {fileAnalysis?.standalonewindows?.created_at
                            ? formatDateFilter(
                                  fileAnalysis.standalonewindows.created_at,
                                  'long'
                              )
                            : world?.updatedAt
                              ? formatDateFilter(world.updatedAt, 'long')
                              : '-'}
                    </span>
                </div>
                <div>
                    <span className="text-muted-foreground block">
                        {t('view.player_list.success.created')}
                    </span>
                    <span className="font-medium">
                        {world?.createdAt
                            ? formatDateFilter(world.createdAt, 'long')
                            : '-'}
                    </span>
                </div>
            </div>
        </div>
    );
}

export function PlayerListTableShell({ table, onResetLayout, children }: any) {
    return (
        <DataTableSurface>
            <DataTableScrollArea>
                <DataTableColumnDndProvider table={table}>
                    <Table
                        className="app-data-table min-w-full table-fixed"
                        style={getDataTableSizingStyle(table)}
                    >
                        <DataTableColumnSizeColGroup table={table} />
                        <DataTableHeader
                            table={table}
                            onResetLayout={onResetLayout}
                        />
                        <TableBody>{children}</TableBody>
                    </Table>
                </DataTableColumnDndProvider>
            </DataTableScrollArea>
        </DataTableSurface>
    );
}

export function PlayerListRows({
    table,
    hasRows,
    onOpenPlayer,
    emptyTitle,
    emptyDescription
}: any) {
    if (!hasRows) {
        return (
            <PlayerListEmptyRow
                table={table}
                title={emptyTitle}
                description={emptyDescription}
            />
        );
    }

    return table.getRowModel().rows.map((row: any) => (
        <TableRow
            key={row.id}
            className={cn(
                'cursor-pointer border-l-2 border-l-transparent',
                row.original?.moderationSeverity === 'blocked' &&
                    'border-l-destructive bg-destructive/10 hover:bg-destructive/15',
                row.original?.moderationSeverity === 'muted' &&
                    'border-l-muted-foreground/50 bg-muted/40 hover:bg-muted/60'
            )}
            tabIndex={0}
            aria-label={`Open ${row.original?.displayName || row.original?.userId || 'player'}`}
            onKeyDown={(event: any) => {
                if (event.key !== 'Enter' && event.key !== ' ') {
                    return;
                }
                event.preventDefault();
                onOpenPlayer(row.original);
            }}
            onClick={() => {
                onOpenPlayer(row.original);
            }}
        >
            <DataTableColumnSortableContext table={table}>
                {row.getVisibleCells().map((cell: any) => (
                    <ResizableTableCell key={cell.id} cell={cell} />
                ))}
            </DataTableColumnSortableContext>
        </TableRow>
    ));
}

export function PlayerListEmptyRow({ table, title, description }: any) {
    const visibleColumnCount =
        table.getVisibleLeafColumns?.().length ||
        table.getAllLeafColumns?.().length ||
        COLUMN_IDS.length;
    return (
        <DataTableEmptyRow
            colSpan={Math.max(1, visibleColumnCount)}
            className="py-10"
        >
            <div className="mx-auto flex max-w-md flex-col gap-2">
                <div className="text-sm font-medium">{title}</div>
                <div className="text-muted-foreground text-sm">
                    {description}
                </div>
            </div>
        </DataTableEmptyRow>
    );
}

export function PlayerListEmptyState({
    title,
    description,
    className = ''
}: any) {
    return (
        <EmptyState
            title={title}
            description={description}
            icon={UsersIcon}
            className={className}
        />
    );
}
