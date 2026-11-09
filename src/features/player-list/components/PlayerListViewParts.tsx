import {
    Clock3Icon,
    FlaskConicalIcon,
    Gamepad2Icon,
    GlobeIcon,
    HomeIcon,
    LockIcon,
    UsersIcon
} from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppTable } from '@/components/data-table/appTable';
import { DataTableSortButton } from '@/components/data-table/DataTableSortButton';
import {
    DataTableColumnDndProvider,
    DataTableColumnSizeColGroup,
    DataTableColumnSortableContext,
    DataTableEmptyRow,
    DataTableHeader,
    DataTableRow,
    DataTableScrollArea,
    DataTableSurface,
    getDataTableSizingStyle
} from '@/components/data-table/DataTableView';
import { ResizableTableCell } from '@/components/data-table/ResizableTableParts';
import { EmptyState } from '@/components/layout/PageScaffold';
import { LocationWorld } from '@/components/LocationWorld';
import { FadeInImage } from '@/components/media/FadeInImage';
import type { WorldProfileRecord } from '@/domain/entities/world';
import { timeToText } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import { openUserDialog, openWorldDialog } from '@/services/dialogService';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { parseLocation } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';
import { Button } from '@/ui/shadcn/button';
import { Table, TableBody } from '@/ui/shadcn/table';

import { getHomeWorldId, getWorldImage } from '../playerListDisplay';
import { parseTimeMs } from '../playerListRows';
import { PLAYER_LIST_COLUMN_IDS as COLUMN_IDS } from '../playerListState';
import type {
    PlayerListProfileRecord,
    PlayerListRow
} from '../playerListTypes';

export { DataTableSortButton as SortButton };

type PlayerListTable = AppTable<PlayerListRow>;

export function CurrentWorldHeader({
    clockNow,
    currentUserSnapshot,
    instanceCapacity,
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
    clockNow: number;
    currentUserSnapshot?: PlayerListProfileRecord | null;
    instanceCapacity?: number | null;
    instanceCreatedAt?: string;
    instanceGroupName?: string;
    instanceLocation?: string;
    instanceWorldId?: string;
    instanceWorldName?: string;
    isGameRunning: boolean;
    onPreviewImage?: (image: { url: string; title: string }) => void;
    playerCount: number;
    parsedLocation: ReturnType<typeof parseLocation>;
    startedAt?: string | null;
    world?: WorldProfileRecord | null;
}) {
    const { t } = useTranslation();
    const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
    const worldId =
        world?.id || instanceWorldId || parsedLocation.worldId || '';
    const worldName = world?.name || instanceWorldName || 'Current instance';
    const authorName = world?.authorName || '';
    const authorId = world?.authorId || '';
    const description = world?.description || '';
    const homeWorldId = getHomeWorldId(
        currentUserSnapshot?.$homeLocation || currentUserSnapshot?.homeLocation
    );
    const isHome = Boolean(homeWorldId && worldId && homeWorldId === worldId);
    const imageUrl = getWorldImage(world);
    const startedAtMs = parseTimeMs(startedAt || instanceCreatedAt);
    const elapsedMs = startedAtMs ? Math.max(clockNow - startedAtMs, 0) : 0;
    const capacity = instanceCapacity || world?.capacity || 0;
    const isInstanceFull = capacity > 0 && playerCount >= capacity;
    const hasAvatarScalingDisabled =
        world?.tags.includes('feature_avatar_scaling_disabled') ?? false;
    const currentInstanceLocationObject = parseLocation(instanceLocation || '');
    const worldDialogTarget =
        currentInstanceLocationObject.isRealInstance &&
        currentInstanceLocationObject.tag
            ? currentInstanceLocationObject.tag
            : worldId;

    if (!isGameRunning || !worldId) {
        return null;
    }

    const releaseStatus = world?.isLabs
        ? { icon: FlaskConicalIcon, label: t('dialog.world.tags.labs') }
        : world?.releaseStatus === 'public'
          ? { icon: GlobeIcon, label: t('dialog.world.tags.public') }
          : world?.releaseStatus === 'private'
            ? { icon: LockIcon, label: t('dialog.world.tags.private') }
            : null;
    const ReleaseStatusIcon = releaseStatus?.icon;

    return (
        <div className="flex shrink-0 items-start gap-3 pb-3">
            <Button
                type="button"
                variant="ghost"
                className="bg-muted h-15 w-20 shrink-0 overflow-hidden rounded-md border p-0"
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
                        className="h-auto min-w-0 shrink justify-start p-0 text-left text-sm font-medium hover:bg-transparent"
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
                                className="text-muted-foreground hover:text-foreground h-auto min-w-0 shrink justify-start p-0 text-xs font-normal hover:bg-transparent"
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
                    {releaseStatus ? (
                        <>
                            <span className="text-muted-foreground/60">·</span>
                            <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs">
                                {ReleaseStatusIcon ? (
                                    <ReleaseStatusIcon className="size-3.5" />
                                ) : null}
                                {releaseStatus.label}
                            </span>
                        </>
                    ) : null}
                    {hasAvatarScalingDisabled ? (
                        <>
                            <span className="text-muted-foreground/60">·</span>
                            <span className="text-muted-foreground shrink-0 text-xs">
                                {t('dialog.world.tags.avatar_scaling_disabled')}
                            </span>
                        </>
                    ) : null}
                </div>
                <div className="text-muted-foreground flex min-w-0 items-center text-xs">
                    <LocationWorld
                        locationObject={currentInstanceLocationObject}
                        currentUserId={normalizeString(currentUserSnapshot?.id)}
                        grouphint={instanceGroupName || ''}
                        hint={worldName}
                        showWorldName={false}
                    />
                </div>
                {description && description !== worldName ? (
                    <button
                        type="button"
                        className={cn(
                            'text-muted-foreground/80 hover:text-muted-foreground cursor-pointer text-left text-xs whitespace-pre-line',
                            !isDescriptionExpanded && 'line-clamp-1'
                        )}
                        aria-expanded={isDescriptionExpanded}
                        onClick={() =>
                            setIsDescriptionExpanded((expanded) => !expanded)
                        }
                    >
                        {description}
                    </button>
                ) : null}
            </div>
            <div className="text-muted-foreground flex shrink-0 items-center gap-3 pt-0.5 text-sm tabular-nums">
                {playerCount > 0 ? (
                    <span
                        className="inline-flex items-center gap-1"
                        title={t('dialog.world.info.capacity')}
                    >
                        <UsersIcon className="size-3.5" />
                        <span
                            className={
                                isInstanceFull
                                    ? 'text-amber-400'
                                    : 'text-foreground'
                            }
                        >
                            {capacity > 0
                                ? `${playerCount}/${capacity}`
                                : playerCount}
                        </span>
                    </span>
                ) : null}
                {elapsedMs > 0 ? (
                    <span
                        className="inline-flex items-center gap-1"
                        title={t('table.playerList.timer')}
                    >
                        <Clock3Icon className="size-3.5" />
                        {timeToText(elapsedMs)}
                    </span>
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
                        className="table-fixed"
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
        <DataTableRow
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
        </DataTableRow>
    ));
}

function PlayerListEmptyRow({
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
            icon={Gamepad2Icon}
            className={className}
        />
    );
}
