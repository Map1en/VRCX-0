import {
    AppleIcon,
    HeartIcon,
    MonitorIcon,
    RectangleGogglesIcon,
    SettingsIcon,
    ShieldIcon,
    UserIcon
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    DataTableCell,
    DataTableRow
} from '@/components/data-table/DataTableView';
import { LocationWorld } from '@/components/LocationWorld';
import type { FriendRecordInput } from '@/domain/friends/types';
import type { CurrentInstanceRosterPlayer } from '@/domain/instances/currentInstanceRoster';
import type { DashboardConfig } from '@/features/dashboard/dashboardConfig';
import { timeToText } from '@/lib/dateTime';
import { useCurrentInstanceRoster } from '@/lib/useCurrentInstanceRoster';
import { cn } from '@/lib/utils';
import { parseLocation } from '@/shared/utils/location';
import { isRecord } from '@/shared/utils/record';
import { normalizeString } from '@/shared/utils/string';
import { normalizeProfileLanguageRows } from '@/shared/utils/userLanguage';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Spinner } from '@/ui/shadcn/spinner';
import { Table, TableBody } from '@/ui/shadcn/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS,
    DASHBOARD_INSTANCE_WIDGET_DEFAULT_COLUMNS,
    getDashboardInstanceWidgetColumnLabel
} from '../../dashboardRegistry';
import { DashboardWidgetEmptyState } from './DashboardWidgetEmptyState';
import { DashboardWidgetHeader } from './DashboardWidgetHeader';
import { buildFavoriteIdSet, joinCompactParts } from './dashboardWidgetUtils';

const ALL_COLUMNS = DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS.map(
    (column) => column.key
);
const DEFAULT_COLUMNS = DASHBOARD_INSTANCE_WIDGET_DEFAULT_COLUMNS;

function resolvePlatformMeta(platform: unknown): {
    label: string;
    icon: LucideIcon | null;
    className: string;
} {
    const normalized = normalizeString(platform).toLowerCase();

    if (
        normalized === 'standalonewindows' ||
        normalized === 'pc' ||
        normalized === 'windows'
    ) {
        return {
            label: 'PC',
            icon: MonitorIcon,
            className: 'text-muted-foreground'
        };
    }

    if (normalized === 'android' || normalized === 'quest') {
        return {
            label: 'Android',
            icon: RectangleGogglesIcon,
            className: 'text-muted-foreground'
        };
    }

    if (normalized === 'ios') {
        return {
            label: 'iOS',
            icon: AppleIcon,
            className: 'text-muted-foreground'
        };
    }

    return {
        label: normalized || '',
        icon: null,
        className: 'text-muted-foreground'
    };
}

function languageCodeLabel(languageKey: unknown) {
    const key = normalizeString(languageKey)
        .toLowerCase()
        .replace(/^language_/, '');
    return key ? key.toUpperCase() : '';
}

function getActiveColumns(config: DashboardConfig): string[] {
    if (!Array.isArray(config?.columns) || config.columns.length === 0) {
        return [...DEFAULT_COLUMNS];
    }

    const normalized = config.columns.filter(
        (column, index, source): column is string =>
            typeof column === 'string' &&
            ALL_COLUMNS.includes(column) &&
            source.indexOf(column) === index
    );

    if (!normalized.includes('displayName')) {
        normalized.unshift('displayName');
    }

    return normalized.length ? normalized : [...DEFAULT_COLUMNS];
}

type DashboardLanguageEntry = {
    key: string;
    value: string;
    code: string;
};

function resolveLanguageEntries(
    friend: FriendRecordInput | null | undefined
): DashboardLanguageEntry[] {
    const profileRows = normalizeProfileLanguageRows(friend);
    const fallbackSource = profileRows.length ? [] : friend?.language || [];
    const values = Array.isArray(fallbackSource)
        ? fallbackSource
        : [fallbackSource];

    return [
        ...profileRows,
        ...values.map((entry) => {
            const record = isRecord(entry) ? entry : {};
            const key =
                typeof entry === 'string'
                    ? entry
                    : record.key ||
                      record.id ||
                      record.name ||
                      record.label ||
                      '';
            const value =
                typeof entry === 'string'
                    ? languageCodeLabel(entry)
                    : record.value ||
                      record.name ||
                      record.label ||
                      languageCodeLabel(key);
            return { key, value };
        })
    ]
        .map((entry) => ({
            key: normalizeString(entry.key),
            value: normalizeString(entry.value),
            code: languageCodeLabel(entry.key)
        }))
        .filter((entry) => entry.key);
}

function getNextColumnConfig(
    config: DashboardConfig,
    activeColumns: string[],
    columnKey: string
): DashboardConfig {
    if (columnKey === 'displayName') {
        return config;
    }

    const columns = activeColumns.includes(columnKey)
        ? activeColumns.filter((column) => column !== columnKey)
        : [...activeColumns, columnKey];

    if (!columns.includes('displayName')) {
        columns.unshift('displayName');
    }

    return { ...config, columns };
}

function DashboardInstanceSettingsMenu({
    config,
    configUpdater,
    activeColumns
}: {
    config: DashboardConfig;
    configUpdater: ((config: DashboardConfig) => void) | null;
    activeColumns: string[];
}) {
    const { t } = useTranslation();

    if (!configUpdater) {
        return null;
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={'Widget settings'}
                    >
                        <SettingsIcon data-icon="inline-start" />
                    </Button>
                }
            />
            <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuGroup>
                    {DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS.map(
                        (column) => (
                            <DropdownMenuCheckboxItem
                                key={column.key}
                                checked={activeColumns.includes(column.key)}
                                disabled={column.required}
                                onClick={(event) => event.preventDefault()}
                                onCheckedChange={() =>
                                    configUpdater(
                                        getNextColumnConfig(
                                            config,
                                            activeColumns,
                                            column.key
                                        )
                                    )
                                }
                            >
                                {getDashboardInstanceWidgetColumnLabel(
                                    column,
                                    t
                                )}
                            </DropdownMenuCheckboxItem>
                        )
                    )}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function DashboardInstanceWidgetShell({
    children,
    settingsMenu
}: {
    children: ReactNode;
    settingsMenu: ReactNode;
}) {
    const { t } = useTranslation();

    return (
        <div className="flex h-full min-h-0 flex-col">
            <DashboardWidgetHeader
                title={t('dashboard.widget.instance')}
                icon="ri-group-3-line"
                path="/player-list"
            >
                {settingsMenu}
            </DashboardWidgetHeader>
            {children}
        </div>
    );
}

function DashboardInstanceSummary({
    currentUserId,
    enrichedRows,
    instanceCreatedAt,
    instanceGroupName,
    instanceLocation,
    instancePlayerCount,
    instanceSource,
    instanceWorldName,
    parsedLocation
}: {
    currentUserId: string | null;
    enrichedRows: DashboardInstancePlayerRow[];
    instanceCreatedAt: string;
    instanceGroupName: string;
    instanceLocation: string;
    instancePlayerCount: number;
    instanceSource: string;
    instanceWorldName: string;
    parsedLocation: ReturnType<typeof parseLocation>;
}) {
    const { t } = useTranslation();
    const sourceText = joinCompactParts([
        instanceSource === 'database' ? 'Local game log' : 'Runtime fallback',
        instanceCreatedAt || ''
    ]);

    return (
        <div className="bg-muted/10 text-muted-foreground mx-3 mt-3 rounded-md border px-3 py-2 text-xs">
            <div className="text-foreground truncate font-medium">
                {instanceLocation ? (
                    <LocationWorld
                        locationObject={instanceLocation}
                        currentUserId={currentUserId}
                        worldDialogShortName={parsedLocation.shortName || ''}
                        grouphint={instanceGroupName || ''}
                        hint={instanceWorldName || ''}
                    />
                ) : (
                    instanceWorldName || 'Current instance'
                )}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                <span>
                    {instancePlayerCount || enrichedRows.length}{' '}
                    {t('dashboard.widget.instance_players')}
                </span>
                {parsedLocation.instanceName ? (
                    <span>#{parsedLocation.instanceName}</span>
                ) : null}
                {parsedLocation.accessTypeName ? (
                    <span>{parsedLocation.accessTypeName}</span>
                ) : null}
                {instanceGroupName ? <span>{instanceGroupName}</span> : null}
                {sourceText ? <span>{sourceText}</span> : null}
            </div>
        </div>
    );
}

type DashboardInstancePlayerRow = CurrentInstanceRosterPlayer & {
    isFriend: boolean;
    isFavorite: boolean;
    trustLevel: string;
    platformLabel: string;
    platformIcon: LucideIcon | null;
    platformClassName: string;
    languageEntries: DashboardLanguageEntry[];
    statusValue: string;
    timerMs: number;
};

function DashboardInstancePlayersTable({
    activeColumns,
    rows
}: {
    activeColumns: string[];
    rows: DashboardInstancePlayerRow[];
}) {
    return (
        <div className="app-data-table min-h-0 flex-1 overflow-auto">
            <Table className="table-fixed">
                <TableBody>
                    {rows.map((row) => (
                        <DataTableRow key={row.id}>
                            {activeColumns.includes('icon') ? (
                                <DataTableCell className="w-20 align-top">
                                    <div className="flex items-center gap-1">
                                        {row.isFavorite ? (
                                            <Badge
                                                variant="default"
                                                className="px-1.5"
                                            >
                                                <HeartIcon className="size-3 fill-current" />
                                            </Badge>
                                        ) : null}
                                        {row.isFriend ? (
                                            <Badge
                                                variant="secondary"
                                                className="px-1.5"
                                            >
                                                <ShieldIcon className="size-3" />
                                            </Badge>
                                        ) : null}
                                        {!row.isFavorite && !row.isFriend ? (
                                            <Badge
                                                variant="outline"
                                                className="px-1.5"
                                            >
                                                <UserIcon className="size-3" />
                                            </Badge>
                                        ) : null}
                                    </div>
                                </DataTableCell>
                            ) : null}
                            <DataTableCell className="align-top">
                                <div className="flex flex-col gap-1">
                                    <div className="text-sm font-medium">
                                        {row.displayName}
                                    </div>
                                    <div className="text-muted-foreground flex flex-wrap gap-2 text-xs">
                                        {activeColumns.includes('rank') ? (
                                            <span>{row.trustLevel || ''}</span>
                                        ) : null}
                                        {activeColumns.includes('status') ? (
                                            row.statusValue ? (
                                                <Tooltip>
                                                    <TooltipTrigger
                                                        render={
                                                            <span className="bg-muted-foreground/70 inline-block size-2.5 rounded-full border" />
                                                        }
                                                    />
                                                    <TooltipContent>
                                                        {row.statusValue}
                                                    </TooltipContent>
                                                </Tooltip>
                                            ) : null
                                        ) : null}
                                    </div>
                                </div>
                            </DataTableCell>
                            {activeColumns.includes('timer') ? (
                                <DataTableCell className="text-muted-foreground w-24 text-right align-top text-xs tabular-nums">
                                    {row.joinedAtMs > 0
                                        ? timeToText(row.timerMs, true)
                                        : ''}
                                </DataTableCell>
                            ) : null}
                            {activeColumns.includes('platform') ? (
                                <DataTableCell className="w-24 align-top">
                                    {(() => {
                                        const PlatformIcon = row.platformIcon;
                                        return (
                                            <div
                                                className={cn(
                                                    'flex items-center gap-1.5 text-xs',
                                                    row.platformClassName
                                                )}
                                            >
                                                {PlatformIcon ? (
                                                    <PlatformIcon className="size-3.5" />
                                                ) : null}
                                                <span>{row.platformLabel}</span>
                                            </div>
                                        );
                                    })()}
                                </DataTableCell>
                            ) : null}
                            {activeColumns.includes('language') ? (
                                <DataTableCell className="text-muted-foreground w-28 align-top text-xs">
                                    <span className="inline-flex items-center gap-1">
                                        {row.languageEntries
                                            .slice(0, 2)
                                            .map((entry) => (
                                                <Tooltip
                                                    key={`${row.id}:${entry.key}`}
                                                >
                                                    <TooltipTrigger
                                                        render={
                                                            <span className="border-border/70 bg-muted/70 text-muted-foreground inline-flex h-5 min-w-8 items-center justify-center rounded border px-1 font-mono text-[10px] leading-none font-semibold">
                                                                {entry.code}
                                                            </span>
                                                        }
                                                    />
                                                    <TooltipContent>
                                                        {entry.value ||
                                                            entry.key}
                                                    </TooltipContent>
                                                </Tooltip>
                                            ))}
                                    </span>
                                </DataTableCell>
                            ) : null}
                        </DataTableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

export function DashboardInstanceWidget({
    config = {},
    configUpdater = null
}: {
    config?: DashboardConfig;
    configUpdater?: ((config: DashboardConfig) => void) | null;
}) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const currentUserLocation = useRuntimeStore(
        (state) =>
            state.gameState.currentLocation ||
            state.auth.currentUserSnapshot?.location ||
            ''
    );
    const currentLocationStartedAt = useRuntimeStore(
        (state) => state.gameState.currentLocationStartedAt
    );
    const currentWorldId = useRuntimeStore(
        (state) => state.gameState.currentWorldId
    );
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning === true
    );
    const addGameLogEventCount = useRuntimeStore(
        (state) => state.runtimeEvents.addGameLogEvent.count
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const remoteFavoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );

    const [clockNow, setClockNow] = useState(() => Date.now());
    const {
        context: instanceSnapshot,
        detail,
        loadStatus,
        playerRows: rows
    } = useCurrentInstanceRoster({
        currentUserEndpoint,
        currentUserId,
        currentUserSnapshot,
        isGameRunning,
        playerListLocation: currentUserLocation,
        playerListStartedAt: currentLocationStartedAt,
        playerListWorldId:
            currentWorldId || parseLocation(currentUserLocation).worldId || '',
        refreshRevision: addGameLogEventCount
    });

    const activeColumns = getActiveColumns(config);
    const favoriteIdSet = useMemo(
        () => buildFavoriteIdSet(remoteFavoriteFriendIds, localFriendFavorites),
        [localFriendFavorites, remoteFavoriteFriendIds]
    );

    useEffect(() => {
        const timer = window.setInterval(() => {
            setClockNow(Date.now());
        }, 30000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    const parsedLocation = useMemo(
        () =>
            parseLocation(
                instanceSnapshot.location || currentUserLocation || ''
            ),
        [currentUserLocation, instanceSnapshot.location]
    );

    const enrichedRows = useMemo(
        () =>
            rows.map((row) => {
                const normalizedUserId = normalizeString(row.userId);
                const friend = normalizedUserId
                    ? friendsById[normalizedUserId]
                    : null;
                const isFavorite = normalizedUserId
                    ? favoriteIdSet.has(normalizedUserId)
                    : false;
                const platform =
                    friend?.$platform ||
                    friend?.platform ||
                    friend?.last_platform ||
                    '';
                const platformMeta = resolvePlatformMeta(platform);
                const languageEntries = resolveLanguageEntries(friend);

                return {
                    ...row,
                    displayName: row.displayName || friend?.displayName || '',
                    isFriend: Boolean(friend),
                    isFavorite,
                    trustLevel: friend?.$trustLevel || '',
                    platformLabel: platformMeta.label,
                    platformIcon: platformMeta.icon,
                    platformClassName: platformMeta.className,
                    languageEntries,
                    statusValue: friend?.status || '',
                    timerMs:
                        row.joinedAtMs > 0
                            ? Math.max(clockNow - row.joinedAtMs, 0)
                            : 0
                };
            }),
        [clockNow, favoriteIdSet, friendsById, rows]
    );

    const settingsMenu = (
        <DashboardInstanceSettingsMenu
            activeColumns={activeColumns}
            config={config}
            configUpdater={configUpdater}
        />
    );

    if (!isGameRunning) {
        return (
            <DashboardInstanceWidgetShell settingsMenu={settingsMenu}>
                <DashboardWidgetEmptyState
                    title={t('view.dashboard.label.instance_widget_idle')}
                    description={t(
                        'view.dashboard.action.start_vrchat_before_the_dashboard_can_rebuild_the_current_instance_roster'
                    )}
                />
            </DashboardInstanceWidgetShell>
        );
    }

    if (loadStatus === 'error') {
        return (
            <DashboardInstanceWidgetShell settingsMenu={settingsMenu}>
                <DashboardWidgetEmptyState
                    title={t('view.dashboard.error.instance_widget_failed')}
                    description={detail}
                />
            </DashboardInstanceWidgetShell>
        );
    }

    if (loadStatus === 'running' && enrichedRows.length === 0) {
        return (
            <DashboardInstanceWidgetShell settingsMenu={settingsMenu}>
                <div className="text-muted-foreground flex min-h-[180px] flex-1 items-center justify-center gap-2 text-sm">
                    <Spinner />
                    {t('view.dashboard.loading.loading_instance_widget')}
                </div>
            </DashboardInstanceWidgetShell>
        );
    }

    if (!enrichedRows.length) {
        return (
            <DashboardInstanceWidgetShell settingsMenu={settingsMenu}>
                <DashboardWidgetEmptyState
                    title={t('view.dashboard.label.instance_widget_idle')}
                    description={t(
                        'view.dashboard.error.current_players_are_not_available_yet'
                    )}
                />
            </DashboardInstanceWidgetShell>
        );
    }

    return (
        <DashboardInstanceWidgetShell settingsMenu={settingsMenu}>
            <DashboardInstanceSummary
                currentUserId={currentUserId}
                enrichedRows={enrichedRows}
                instanceCreatedAt={instanceSnapshot.createdAt}
                instanceGroupName={instanceSnapshot.groupName}
                instanceLocation={instanceSnapshot.location}
                instancePlayerCount={instanceSnapshot.playerCount}
                instanceSource={instanceSnapshot.source}
                instanceWorldName={instanceSnapshot.worldName}
                parsedLocation={parsedLocation}
            />
            <DashboardInstancePlayersTable
                activeColumns={activeColumns}
                rows={enrichedRows}
            />
        </DashboardInstanceWidgetShell>
    );
}
