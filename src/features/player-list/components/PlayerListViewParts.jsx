import {
    ArrowDownIcon,
    ArrowUpDownIcon,
    ArrowUpIcon,
    HomeIcon,
    UsersIcon
} from 'lucide-react';

import {
    DataTableEmptyRow,
    DataTableHeader,
    DataTableScrollArea,
    DataTableSurface
} from '@/components/data-table/DataTableView.jsx';
import { ResizableTableCell } from '@/components/data-table/ResizableTableParts.jsx';
import { EmptyState } from '@/components/layout/PageScaffold.jsx';
import { LocationWorld } from '@/components/LocationWorld.jsx';
import { formatDateFilter, timeToText } from '@/lib/dateTime.js';
import { convertFileUrlToImageUrl } from '@/lib/entityMedia.js';
import { defaultWorldCacheInfo } from '@/lib/worldAssetBundle.js';
import { openUserDialog, openWorldDialog } from '@/services/dialogService.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Table, TableBody, TableRow } from '@/ui/shadcn/table';

import {
    fileAnalysisSizeForPlatform,
    formatCount,
    getHomeWorldId,
    getWorldImage,
    resolvePlatformBadge
} from '../playerListDisplay.js';
import { parseTimeMs } from '../playerListRows.js';
import { PLAYER_LIST_COLUMN_IDS as COLUMN_IDS } from '../playerListState.js';

export function CurrentWorldHeader({
    cacheInfo = defaultWorldCacheInfo(),
    clockNow,
    context,
    currentUserSnapshot,
    fileAnalysis = {},
    friendCount,
    isGameRunning,
    onPreviewImage,
    playerCount,
    parsedLocation,
    startedAt,
    t,
    world
}) {
    const worldId =
        world?.id || context.worldId || parsedLocation.worldId || '';
    const worldName = world?.name || context.worldName || 'Current instance';
    const homeWorldId = getHomeWorldId(
        currentUserSnapshot?.$homeLocation || currentUserSnapshot?.homeLocation
    );
    const isHome = Boolean(homeWorldId && worldId && homeWorldId === worldId);
    const imageUrl = getWorldImage(world);
    const platforms = Array.isArray(world?.platforms)
        ? world.platforms.map(resolvePlatformBadge)
        : [];
    const startedAtMs = parseTimeMs(startedAt || context.createdAt);
    const elapsedMs = startedAtMs ? Math.max(clockNow - startedAtMs, 0) : 0;
    const hasAvatarScalingDisabled = Array.isArray(world?.tags)
        ? world.tags.includes('feature_avatar_scaling_disabled')
        : false;
    const currentInstanceLocationObject = parseLocation(context.location || '');
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
                        className="h-auto max-w-full justify-start p-0 text-left text-base font-semibold hover:text-primary"
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
                        className="text-muted-foreground h-auto justify-start p-0 font-mono text-xs hover:text-primary"
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
                    {platforms.map((platform) => {
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
                    {context.groupName ? (
                        <Badge variant="outline">{context.groupName}</Badge>
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
                        grouphint={context.groupName || ''}
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
                        {t('view.player_list.generated.last_updated')}
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
                        {t('view.player_list.generated.created')}
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

export function SortButton({ column, label }) {
    const direction = column.getIsSorted();

    return (
        <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground h-auto justify-start gap-1 p-0 text-left text-xs font-medium tracking-wide uppercase"
            onClick={() => column.toggleSorting(direction === 'asc')}
        >
            <span>{label}</span>
            {direction === 'asc' ? (
                <ArrowUpIcon data-icon="inline-end" />
            ) : direction === 'desc' ? (
                <ArrowDownIcon data-icon="inline-end" />
            ) : (
                <ArrowUpDownIcon data-icon="inline-end" />
            )}
        </Button>
    );
}

export function PlayerListTableShell({ table, onResetLayout, children }) {
    return (
        <DataTableSurface>
            <DataTableScrollArea>
                <Table className="app-data-table table-fixed">
                    <DataTableHeader
                        table={table}
                        onResetLayout={onResetLayout}
                    />
                    <TableBody>{children}</TableBody>
                </Table>
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
}) {
    if (!hasRows) {
        return (
            <PlayerListEmptyRow
                table={table}
                title={emptyTitle}
                description={emptyDescription}
            />
        );
    }

    return table.getRowModel().rows.map((row) => (
        <TableRow
            key={row.id}
            className="cursor-pointer"
            tabIndex={0}
            aria-label={`Open ${row.original?.displayName || row.original?.userId || 'player'}`}
            onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') {
                    return;
                }
                event.preventDefault();
                void onOpenPlayer(row.original);
            }}
            onClick={() => void onOpenPlayer(row.original)}
        >
            {row.getVisibleCells().map((cell) => (
                <ResizableTableCell key={cell.id} cell={cell} />
            ))}
        </TableRow>
    ));
}

export function PlayerListEmptyRow({ table, title, description }) {
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

export function PlayerListEmptyState({ title, description }) {
    return <EmptyState title={title} description={description} />;
}
