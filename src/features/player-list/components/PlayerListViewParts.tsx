import type { Table as ReactTable } from '@tanstack/react-table';
import { Clock3Icon, HeartIcon, HomeIcon, UsersIcon } from 'lucide-react';
import type { ReactNode } from 'react';
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
import { FadeInImage } from '@/components/media/FadeInImage';
import { timeToText } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import { defaultWorldCacheInfo } from '@/lib/worldAssetBundle';
import { openUserDialog, openWorldDialog } from '@/services/dialogService';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { parseLocation } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Table, TableBody, TableRow } from '@/ui/shadcn/table';

import {
    fileAnalysisSizeForPlatform,
    getHomeWorldId,
    getWorldImage,
    resolvePlatformBadge
} from '../playerListDisplay';
import { parseTimeMs } from '../playerListRows';
import { PLAYER_LIST_COLUMN_IDS as COLUMN_IDS } from '../playerListState';
import type {
    PlayerListProfileRecord,
    PlayerListRecord,
    PlayerListRow
} from '../playerListTypes';

export { DataTableSortButton as SortButton };

type PlayerListTable = ReactTable<PlayerListRow>;

type PlayerListWorld = PlayerListRecord & {
    id?: unknown;
    name?: unknown;
    authorName?: unknown;
    authorId?: unknown;
    imageUrl?: unknown;
    thumbnailImageUrl?: unknown;
    platforms?: unknown[];
    tags?: unknown[];
    isLabs?: unknown;
    releaseStatus?: unknown;
    description?: unknown;
    recommendedCapacity?: unknown;
    capacity?: unknown;
    updatedAt?: unknown;
    createdAt?: unknown;
};

type PlayerListFileAnalysis = Record<string, PlayerListRecord | undefined>;

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
}: {
    cacheInfo?: ReturnType<typeof defaultWorldCacheInfo>;
    clockNow: number;
    currentUserSnapshot?: PlayerListProfileRecord | null;
    fileAnalysis?: PlayerListFileAnalysis;
    friendCount: number;
    instanceCreatedAt?: unknown;
    instanceGroupName?: string;
    instanceLocation?: string;
    instanceWorldId?: string;
    instanceWorldName?: string;
    isGameRunning: boolean;
    onPreviewImage?: (image: { url: string; title: string }) => void;
    playerCount: number;
    parsedLocation: ReturnType<typeof parseLocation>;
    startedAt?: unknown;
    world?: PlayerListWorld | null;
}) {
    const { t } = useTranslation();
    const worldId =
        normalizeString(world?.id) ||
        instanceWorldId ||
        parsedLocation.worldId ||
        '';
    const worldName =
        normalizeString(world?.name) || instanceWorldName || 'Current instance';
    const authorName = normalizeString(world?.authorName);
    const authorId = normalizeString(world?.authorId);
    const description = normalizeString(world?.description);
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
    const capacity = Number(world?.capacity) || 0;
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
        <div className="flex min-h-20 shrink-0 flex-col gap-2 pb-3 md:flex-row md:items-start">
            <Button
                type="button"
                variant="ghost"
                className="bg-muted h-20 w-28 shrink-0 overflow-hidden rounded-md border p-0"
                disabled={!imageUrl}
                aria-label={worldName}
                onClick={() =>
                    imageUrl &&
                    onPreviewImage?.({
                        url: convertFileUrlToImageUrl(
                            normalizeString(world?.imageUrl) || imageUrl,
                            1024
                        ),
                        title: worldName
                    })
                }
            >
                {imageUrl ? (
                    <FadeInImage
                        src={imageUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                        fallback={
                            <UsersIcon
                                data-icon="inline-start"
                                className="text-muted-foreground"
                            />
                        }
                    />
                ) : (
                    <UsersIcon
                        data-icon="inline-start"
                        className="text-muted-foreground"
                    />
                )}
            </Button>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex min-w-0 items-center gap-2">
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
                    {authorName ? (
                        <>
                            <span className="text-muted-foreground/60">·</span>
                            <Button
                                type="button"
                                variant="ghost"
                                className="text-muted-foreground hover:text-primary h-auto min-w-0 justify-start p-0 font-mono text-xs"
                                onClick={() =>
                                    authorId &&
                                    openUserDialog({
                                        userId: authorId,
                                        title: authorName || undefined
                                    })
                                }
                            >
                                <span className="truncate">{authorName}</span>
                            </Button>
                        </>
                    ) : null}
                </div>
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
                        const platformKey = String(platform.key ?? '');
                        return (
                            <Badge
                                key={platformKey}
                                variant="outline"
                                className="gap-1"
                            >
                                {Icon ? <Icon className="size-3.5" /> : null}
                                {String(platform.label ?? '')}
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
                        <Badge
                            variant="outline"
                            className="gap-1 tabular-nums"
                            title={t('dialog.world.info.capacity')}
                        >
                            <UsersIcon className="size-3.5" />
                            {capacity > 0
                                ? `${playerCount}/${capacity}`
                                : playerCount}
                        </Badge>
                    ) : null}
                    {friendCount > 0 ? (
                        <Badge
                            variant="outline"
                            className="gap-1 tabular-nums"
                            title={t('common.affinity.friend')}
                        >
                            <HeartIcon className="size-3.5 fill-current text-rose-400" />
                            {friendCount}
                        </Badge>
                    ) : null}
                    {elapsedMs > 0 ? (
                        <Badge
                            variant="outline"
                            className="gap-1 tabular-nums"
                            title={t('table.playerList.timer')}
                        >
                            <Clock3Icon className="size-3.5" />
                            {timeToText(elapsedMs, true)}
                        </Badge>
                    ) : null}
                </div>
                <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-2 font-mono text-xs">
                    <LocationWorld
                        locationObject={currentInstanceLocationObject}
                        currentUserId={normalizeString(currentUserSnapshot?.id)}
                        grouphint={instanceGroupName || ''}
                        hint={worldName}
                        className="font-sans"
                    />
                </div>
                {description && description !== worldName ? (
                    <div className="truncate text-xs" title={description}>
                        {description}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

export function PlayerListTableShell({
    table,
    onResetLayout,
    children
}: {
    table: PlayerListTable;
    onResetLayout: () => void;
    children: ReactNode;
}) {
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
}: {
    table: PlayerListTable;
    hasRows: boolean;
    onOpenPlayer: (row: PlayerListRow) => void;
    emptyTitle?: string;
    emptyDescription?: string;
}) {
    const { t } = useTranslation();
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
            className={cn(
                'cursor-pointer border-l-2 border-l-transparent',
                row.original?.moderationSeverity === 'blocked' &&
                    'border-l-destructive bg-destructive/10 hover:bg-destructive/15',
                row.original?.moderationSeverity === 'muted' &&
                    'border-l-muted-foreground/50 bg-muted/40 hover:bg-muted/60'
            )}
            tabIndex={0}
            aria-label={t('accessibility.open_player', {
                player:
                    row.original?.displayName ||
                    row.original?.userId ||
                    t('accessibility.player')
            })}
            onKeyDown={(event) => {
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
                {row.getVisibleCells().map((cell) => (
                    <ResizableTableCell key={cell.id} cell={cell} />
                ))}
            </DataTableColumnSortableContext>
        </TableRow>
    ));
}

export function PlayerListEmptyRow({
    table,
    title,
    description
}: {
    table: PlayerListTable;
    title?: string;
    description?: string;
}) {
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
}: {
    title?: string;
    description?: string;
    className?: string;
}) {
    return (
        <EmptyState
            title={title}
            description={description}
            icon={UsersIcon}
            className={className}
        />
    );
}
