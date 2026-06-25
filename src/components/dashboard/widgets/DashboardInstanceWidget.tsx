import {
    AppleIcon,
    HeartIcon,
    MonitorIcon,
    RectangleGogglesIcon,
    SettingsIcon,
    ShieldIcon,
    UserIcon
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LocationWorld } from '@/components/LocationWorld';
import { timeToText } from '@/lib/dateTime';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { cn } from '@/lib/utils';
import playerListPersistenceRepository from '@/repositories/playerListPersistenceRepository';
import { parseLocation } from '@/shared/utils/location';
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
import { Table, TableBody, TableCell, TableRow } from '@/ui/shadcn/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS,
    DASHBOARD_INSTANCE_WIDGET_DEFAULT_COLUMNS,
    getDashboardInstanceWidgetColumnLabel
} from '../dashboardRegistry';
import { DashboardWidgetEmptyState } from './DashboardWidgetEmptyState';
import { DashboardWidgetHeader } from './DashboardWidgetHeader';
import { buildFavoriteIdSet, joinCompactParts } from './dashboardWidgetUtils';

const ALL_COLUMNS = DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS.map(
    (column: any) => column.key
);
const DEFAULT_COLUMNS = DASHBOARD_INSTANCE_WIDGET_DEFAULT_COLUMNS;

function resolvePlatformMeta(platform: any) {
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

function languageCodeLabel(languageKey: any) {
    const key = normalizeString(languageKey)
        .toLowerCase()
        .replace(/^language_/, '');
    return key ? key.toUpperCase() : '';
}

function getActiveColumns(config: any) {
    if (!Array.isArray(config?.columns) || config.columns.length === 0) {
        return DEFAULT_COLUMNS;
    }

    const normalized = config.columns.filter(
        (column: any, index: any, source: any) =>
            typeof column === 'string' &&
            ALL_COLUMNS.includes(column) &&
            source.indexOf(column) === index
    );

    if (!normalized.includes('displayName')) {
        normalized.unshift('displayName');
    }

    return normalized.length ? normalized : DEFAULT_COLUMNS;
}

function resolveLanguageEntries(friend: any) {
    const profileRows = normalizeProfileLanguageRows(friend);
    const fallbackSource = profileRows.length ? [] : friend?.language || [];
    const values = Array.isArray(fallbackSource)
        ? fallbackSource
        : [fallbackSource];

    return [
        ...profileRows,
        ...values.map((entry: any) => {
            const key =
                typeof entry === 'string'
                    ? entry
                    : entry?.key ||
                      entry?.id ||
                      entry?.name ||
                      entry?.label ||
                      '';
            const value =
                typeof entry === 'string'
                    ? languageCodeLabel(entry)
                    : entry?.value ||
                      entry?.name ||
                      entry?.label ||
                      languageCodeLabel(key);
            return { key, value };
        })
    ]
        .map((entry: any) => ({
            key: normalizeString(entry.key),
            value: normalizeString(entry.value),
            code: languageCodeLabel(entry.key)
        }))
        .filter((entry: any) => entry.key);
}

function getNextColumnConfig(config: any, activeColumns: any, columnKey: any) {
    if (columnKey === 'displayName') {
        return config;
    }

    const columns = activeColumns.includes(columnKey)
        ? activeColumns.filter((column: any) => column !== columnKey)
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
}: any) {
    const { t } = useTranslation();

    if (!configUpdater) {
        return null;
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={'Widget settings'}
                >
                    <SettingsIcon data-icon="inline-start" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuGroup>
                    {DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS.map(
                        (column: any) => (
                            <DropdownMenuCheckboxItem
                                key={column.key}
                                checked={activeColumns.includes(column.key)}
                                disabled={column.required}
                                onSelect={(event: any) =>
                                    event.preventDefault()
                                }
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

function DashboardInstanceWidgetShell({ children, settingsMenu }: any) {
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
}: any) {
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

function DashboardInstancePlayersTable({ activeColumns, rows }: any) {
    return (
        <div className="min-h-0 flex-1 overflow-auto">
            <Table className="app-data-table table-fixed">
                <TableBody>
                    {rows.map((row: any) => (
                        <TableRow key={row.id}>
                            {activeColumns.includes('icon') ? (
                                <TableCell className="w-20 align-top">
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
                                </TableCell>
                            ) : null}
                            <TableCell className="align-top">
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
                                                    <TooltipTrigger asChild>
                                                        <span className="bg-muted-foreground/70 inline-block size-2.5 rounded-full border" />
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        {row.statusValue}
                                                    </TooltipContent>
                                                </Tooltip>
                                            ) : null
                                        ) : null}
                                    </div>
                                </div>
                            </TableCell>
                            {activeColumns.includes('timer') ? (
                                <TableCell className="text-muted-foreground w-24 text-right align-top text-xs tabular-nums">
                                    {row.joinedAtMs > 0
                                        ? timeToText(row.timerMs, true)
                                        : ''}
                                </TableCell>
                            ) : null}
                            {activeColumns.includes('platform') ? (
                                <TableCell className="w-24 align-top">
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
                                </TableCell>
                            ) : null}
                            {activeColumns.includes('language') ? (
                                <TableCell className="text-muted-foreground w-28 align-top text-xs">
                                    <span className="inline-flex items-center gap-1">
                                        {row.languageEntries
                                            .slice(0, 2)
                                            .map((entry: any) => (
                                                <Tooltip
                                                    key={`${row.id}:${entry.key}`}
                                                >
                                                    <TooltipTrigger asChild>
                                                        <span className="border-border/70 bg-muted/70 text-muted-foreground inline-flex h-5 min-w-8 items-center justify-center rounded border px-1 font-mono text-[10px] leading-none font-semibold">
                                                            {entry.code}
                                                        </span>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        {entry.value ||
                                                            entry.key}
                                                    </TooltipContent>
                                                </Tooltip>
                                            ))}
                                    </span>
                                </TableCell>
                            ) : null}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

export function DashboardInstanceWidget({
    config = {},
    configUpdater = null
}: any) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentUserLocation = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot?.location || ''
    );
    const isGameRunning = useRuntimeStore((state: any) =>
        Boolean(state.gameState.isGameRunning)
    );
    const addGameLogEventCount = useRuntimeStore(
        (state: any) => state.runtimeEvents.addGameLogEvent.count
    );
    const friendsById = useFriendRosterStore((state: any) => state.friendsById);
    const remoteFavoriteFriendIds = useFavoriteStore(
        (state: any) => state.favoriteFriendIds
    );
    const localFriendFavorites = useFavoriteStore(
        (state: any) => state.localFriendFavorites
    );

    const [instanceSnapshot, setInstanceSnapshot] = useState<any>({
        createdAt: '',
        location: '',
        worldId: '',
        worldName: '',
        time: 0,
        groupName: '',
        playerCount: 0,
        source: 'none'
    });
    const [rows, setRows] = useState<any[]>([]);
    const [loadStatus, setLoadStatus] = useState('idle');
    const [detail, setDetail] = useState('');
    const [clockNow, setClockNow] = useState(() => Date.now());

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

    useEffect(() => {
        let active = true;

        if (!isGameRunning) {
            setInstanceSnapshot({
                createdAt: '',
                location: currentUserLocation || '',
                worldId: '',
                worldName: '',
                time: 0,
                groupName: '',
                playerCount: 0,
                source: 'runtime'
            });
            setRows([]);
            setLoadStatus('idle');
            setDetail('');
            return () => {
                active = false;
            };
        }

        setLoadStatus('running');
        setDetail('');

        playerListPersistenceRepository
            .getCurrentInstanceSnapshot({
                currentUserId,
                currentLocation: currentUserLocation
            })
            .then((result: any) => {
                if (!active) {
                    return;
                }

                setInstanceSnapshot(result.context);
                setRows(Array.isArray(result.players) ? result.players : []);
                setLoadStatus('ready');
                setDetail(
                    result.context.source === 'database'
                        ? 'Rebuilt from local join/leave history.'
                        : 'Using runtime location while local game-log history catches up.'
                );
            })
            .catch((error: any) => {
                if (!active) {
                    return;
                }

                setRows([]);
                setLoadStatus('error');
                setDetail(
                    userFacingErrorMessage(
                        error,
                        'Failed to rebuild the current instance roster.'
                    )
                );
            });

        return () => {
            active = false;
        };
    }, [
        addGameLogEventCount,
        currentUserId,
        currentUserLocation,
        isGameRunning
    ]);

    const parsedLocation = useMemo(
        () =>
            parseLocation(
                instanceSnapshot.location || currentUserLocation || ''
            ),
        [currentUserLocation, instanceSnapshot.location]
    );

    const enrichedRows = useMemo(
        () =>
            rows.map((row: any) => {
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
                    description={userFacingErrorMessage(
                        detail,
                        'Current players did not finish loading.'
                    )}
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
