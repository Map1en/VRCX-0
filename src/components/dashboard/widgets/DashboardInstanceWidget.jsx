import { useEffect, useMemo, useState } from 'react';
import {
    AppleIcon,
    HeartIcon,
    LoaderCircleIcon,
    MonitorIcon,
    SettingsIcon,
    ShieldIcon,
    SmartphoneIcon,
    UserIcon
} from 'lucide-react';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { timeToText } from '@/lib/dateTime.js';
import { LocationWorld } from '@/components/LocationWorld.jsx';
import { playerListRepository } from '@/repositories/index.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { languageMappings } from '@/shared/constants/language.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Badge } from '@/ui/shadcn/badge.jsx';
import { Button } from '@/ui/shadcn/button.jsx';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu.jsx';
import {
    Table,
    TableBody,
    TableCell,
    TableRow
} from '@/ui/shadcn/table.jsx';

import {
    buildFavoriteIdSet,
    joinCompactParts,
    normalizeString
} from './shared.js';
import { DashboardWidgetEmptyState } from './DashboardWidgetEmptyState.jsx';
import {
    DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS,
    DASHBOARD_INSTANCE_WIDGET_DEFAULT_COLUMNS
} from '../dashboardRegistry.js';
import { DashboardWidgetHeader } from './DashboardWidgetHeader.jsx';

const ALL_COLUMNS = DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS.map((column) => column.key);
const DEFAULT_COLUMNS = DASHBOARD_INSTANCE_WIDGET_DEFAULT_COLUMNS;

function resolvePlatformMeta(platform) {
    const normalized = normalizeString(platform).toLowerCase();

    if (normalized === 'standalonewindows' || normalized === 'pc' || normalized === 'windows') {
        return {
            label: 'PC',
            icon: MonitorIcon,
            className: 'text-sky-600'
        };
    }

    if (normalized === 'android' || normalized === 'quest') {
        return {
            label: 'Android',
            icon: SmartphoneIcon,
            className: 'text-emerald-600'
        };
    }

    if (normalized === 'ios') {
        return {
            label: 'iOS',
            icon: AppleIcon,
            className: 'text-orange-600'
        };
    }

    return {
        label: normalized || '',
        icon: null,
        className: 'text-muted-foreground'
    };
}

function languageFlagLabel(languageKey) {
    const countryCode = languageMappings[String(languageKey || '').toLowerCase()];
    if (!countryCode || !/^[a-z]{2}$/i.test(countryCode)) {
        return String(languageKey || '?').slice(0, 3).toUpperCase() || '?';
    }

    return String.fromCodePoint(
        ...countryCode
            .toUpperCase()
            .split('')
            .map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65)
    );
}

function getActiveColumns(config) {
    if (!Array.isArray(config?.columns) || config.columns.length === 0) {
        return DEFAULT_COLUMNS;
    }

    const normalized = config.columns.filter(
        (column, index, source) =>
            typeof column === 'string' &&
            ALL_COLUMNS.includes(column) &&
            source.indexOf(column) === index
    );

    if (!normalized.includes('displayName')) {
        normalized.unshift('displayName');
    }

    return normalized.length ? normalized : DEFAULT_COLUMNS;
}

function resolveLanguageEntries(friend) {
    const source = friend?.$languages || friend?.languages || friend?.language || [];
    const values = Array.isArray(source) ? source : [source];

    return values
        .map((entry) => {
            if (typeof entry === 'string') {
                return {
                    key: entry,
                    value: languageMappings[entry] || entry
                };
            }

            const key = entry?.key || entry?.name || entry?.label || '';
            return {
                key,
                value: entry?.value || entry?.name || entry?.label || languageMappings[key] || key
            };
        })
        .map((entry) => ({
            key: normalizeString(entry.key),
            value: normalizeString(entry.value),
            flag: languageFlagLabel(entry.key)
        }))
        .filter((entry) => entry.key);
}

function getNextColumnConfig(config, activeColumns, columnKey) {
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

export function DashboardInstanceWidget({ config = {}, configUpdater = null }) {
    const { t } = useI18n();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserLocation = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot?.location || ''
    );
    const isGameRunning = useRuntimeStore((state) => Boolean(state.gameState.isGameRunning));
    const addGameLogEventCount = useRuntimeStore(
        (state) => state.backendEvents.addGameLogEvent.count
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const remoteFavoriteFriendIds = useFavoriteStore((state) => state.favoriteFriendIds);
    const localFriendFavorites = useFavoriteStore((state) => state.localFriendFavorites);

    const [context, setContext] = useState({
        createdAt: '',
        location: '',
        worldId: '',
        worldName: '',
        time: 0,
        groupName: '',
        playerCount: 0,
        source: 'none'
    });
    const [rows, setRows] = useState([]);
    const [loadStatus, setLoadStatus] = useState('idle');
    const [detail, setDetail] = useState('');
    const [clockNow, setClockNow] = useState(() => Date.now());

    const activeColumns = useMemo(() => getActiveColumns(config), [config]);
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
            setContext({
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

        playerListRepository
            .getCurrentInstanceSnapshot({
                currentUserId,
                currentLocation: currentUserLocation
            })
            .then((result) => {
                if (!active) {
                    return;
                }

                setContext(result.context);
                setRows(Array.isArray(result.players) ? result.players : []);
                setLoadStatus('ready');
                setDetail(
                    result.context.source === 'database'
                        ? 'Rebuilt from local join/leave history.'
                        : 'Using runtime location while local game-log history catches up.'
                );
            })
            .catch((error) => {
                if (!active) {
                    return;
                }

                setRows([]);
                setLoadStatus('error');
                setDetail(
                    error instanceof Error
                        ? error.message
                        : 'Failed to rebuild the current instance roster.'
                );
            });

        return () => {
            active = false;
        };
    }, [addGameLogEventCount, currentUserId, currentUserLocation, isGameRunning]);

    const parsedLocation = useMemo(
        () => parseLocation(context.location || currentUserLocation || ''),
        [context.location, currentUserLocation]
    );

    const enrichedRows = useMemo(
        () =>
            rows.map((row) => {
                const normalizedUserId = normalizeString(row.userId);
                const friend = normalizedUserId ? friendsById[normalizedUserId] : null;
                const isFavorite = normalizedUserId ? favoriteIdSet.has(normalizedUserId) : false;
                const platform = friend?.$platform || friend?.platform || friend?.last_platform || '';
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
                    timerMs: row.joinedAtMs > 0 ? Math.max(clockNow - row.joinedAtMs, 0) : 0
                };
            }),
        [clockNow, favoriteIdSet, friendsById, rows]
    );

    const settingsMenu = configUpdater ? (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm">
                    <SettingsIcon className="size-3.5" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
                {DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS.map((column) => (
                    <DropdownMenuCheckboxItem
                        key={column.key}
                        checked={activeColumns.includes(column.key)}
                        disabled={column.required}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={() =>
                            configUpdater(getNextColumnConfig(config, activeColumns, column.key))
                        }>
                        {column.label}
                    </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    ) : null;
    const renderShell = (children) => (
        <div className="flex h-full min-h-0 flex-col">
            <DashboardWidgetHeader title={t('dashboard.widget.instance')} icon="ri-group-3-line" path="/player-list">
                {settingsMenu}
            </DashboardWidgetHeader>
            {children}
        </div>
    );

    if (!isGameRunning) {
        return renderShell(
            <DashboardWidgetEmptyState
                title="Instance widget idle"
                description="Start VRChat before the dashboard can rebuild the current instance roster."
            />
        );
    }

    if (loadStatus === 'error') {
        return renderShell(
            <DashboardWidgetEmptyState
                title="Instance widget failed"
                description={detail || 'The player-list snapshot did not complete.'}
            />
        );
    }

    if (loadStatus === 'running' && enrichedRows.length === 0) {
        return renderShell(
            <div className="flex min-h-[180px] flex-1 items-center justify-center text-sm text-muted-foreground">
                <LoaderCircleIcon className="mr-2 size-4 animate-spin" />
                Loading instance widget
            </div>
        );
    }

    if (!enrichedRows.length) {
        return renderShell(
            <DashboardWidgetEmptyState
                title="Instance widget idle"
                description="The current instance player list is not available yet."
            />
        );
    }

    return renderShell(
        <>

            <div className="mx-3 mt-3 rounded-md border bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
                <div className="truncate font-medium text-foreground">
                    {context.location ? (
                        <LocationWorld
                            locationObject={context.location}
                            currentUserId={currentUserId}
                            worldDialogShortName={parsedLocation.shortName || ''}
                            grouphint={context.groupName || ''}
                        />
                    ) : (
                        context.worldName || 'Current instance'
                    )}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                    <span>{context.playerCount || enrichedRows.length} players</span>
                    {parsedLocation.instanceName ? <span>#{parsedLocation.instanceName}</span> : null}
                    {parsedLocation.accessTypeName ? <span>{parsedLocation.accessTypeName}</span> : null}
                    {context.groupName ? <span>{context.groupName}</span> : null}
                    {joinCompactParts([
                        context.source === 'database' ? 'Local game log' : 'Runtime fallback',
                        context.createdAt || ''
                    ]) ? (
                        <span>
                            {joinCompactParts([
                                context.source === 'database' ? 'Local game log' : 'Runtime fallback',
                                context.createdAt || ''
                            ])}
                        </span>
                    ) : null}
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
                <Table className="vrcx-data-table table-fixed">
                    <TableBody>
                        {enrichedRows.map((row) => (
                            <TableRow key={row.id}>
                                {activeColumns.includes('icon') ? (
                                    <TableCell className="w-20 align-top">
                                        <div className="flex items-center gap-1">
                                            {row.isFavorite ? (
                                                <Badge variant="default" className="px-1.5">
                                                    <HeartIcon className="size-3 fill-current" />
                                                </Badge>
                                            ) : null}
                                            {row.isFriend ? (
                                                <Badge variant="secondary" className="px-1.5">
                                                    <ShieldIcon className="size-3" />
                                                </Badge>
                                            ) : null}
                                            {!row.isFavorite && !row.isFriend ? (
                                                <Badge variant="outline" className="px-1.5">
                                                    <UserIcon className="size-3" />
                                                </Badge>
                                            ) : null}
                                        </div>
                                    </TableCell>
                                ) : null}
                                <TableCell className="align-top">
                                    <div className="space-y-1">
                                        <div className="text-sm font-medium">{row.displayName}</div>
                                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                            {activeColumns.includes('rank') ? (
                                                <span>{row.trustLevel || ''}</span>
                                            ) : null}
                                            {activeColumns.includes('status') ? (
                                                row.statusValue ? (
                                                    <span
                                                        title={row.statusValue}
                                                        className="inline-block size-2.5 rounded-full border bg-muted-foreground/70"
                                                    />
                                                ) : null
                                            ) : null}
                                        </div>
                                    </div>
                                </TableCell>
                                {activeColumns.includes('timer') ? (
                                    <TableCell className="w-24 align-top text-right text-[11px] tabular-nums text-muted-foreground">
                                        {row.joinedAtMs > 0 ? timeToText(row.timerMs, true) : ''}
                                    </TableCell>
                                ) : null}
                                {activeColumns.includes('platform') ? (
                                    <TableCell className="w-24 align-top">
                                        {(() => {
                                            const PlatformIcon = row.platformIcon;
                                            return (
                                                <div
                                                    className={`flex items-center gap-1.5 text-xs ${row.platformClassName}`}>
                                                    {PlatformIcon ? <PlatformIcon className="size-3.5" /> : null}
                                                    <span>{row.platformLabel}</span>
                                                </div>
                                            );
                                        })()}
                                    </TableCell>
                                ) : null}
                                {activeColumns.includes('language') ? (
                                    <TableCell className="w-28 align-top text-xs text-muted-foreground">
                                        <span className="inline-flex items-center gap-1">
                                            {row.languageEntries.slice(0, 2).map((entry) => (
                                                <span key={`${row.id}:${entry.key}`} title={entry.value || entry.key}>
                                                    {entry.flag}
                                                </span>
                                            ))}
                                        </span>
                                    </TableCell>
                                ) : null}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </>
    );
}
