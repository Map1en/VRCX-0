import {
    AppleIcon,
    HeartIcon,
    MonitorIcon,
    SettingsIcon,
    ShieldIcon,
    SmartphoneIcon,
    UserIcon
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useTranslation } from 'react-i18next';
import { LocationWorld } from '@/components/LocationWorld.jsx';
import { timeToText } from '@/lib/dateTime.js';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { cn } from '@/lib/utils.js';
import { playerListRepository } from '@/repositories/index.js';
import { languageMappings } from '@/shared/constants/language.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
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

import {
    DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS,
    DASHBOARD_INSTANCE_WIDGET_DEFAULT_COLUMNS,
    getDashboardInstanceWidgetColumnLabel
} from '../dashboardRegistry.js';
import { DashboardWidgetEmptyState } from './DashboardWidgetEmptyState.jsx';
import { DashboardWidgetHeader } from './DashboardWidgetHeader.jsx';
import {
    buildFavoriteIdSet,
    joinCompactParts,
    normalizeString
} from './dashboardWidgetUtils.js';

const ALL_COLUMNS = DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS.map(
    (column) => column.key
);
const DEFAULT_COLUMNS = DASHBOARD_INSTANCE_WIDGET_DEFAULT_COLUMNS;

function resolvePlatformMeta(platform) {
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
            icon: SmartphoneIcon,
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

function languageFlagLabel(languageKey) {
    const countryCode =
        languageMappings[String(languageKey || '').toLowerCase()];
    if (!countryCode || !/^[a-z]{2}$/i.test(countryCode)) {
        return (
            String(languageKey || '?')
                .slice(0, 3)
                .toUpperCase() || '?'
        );
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
    const source =
        friend?.$languages || friend?.languages || friend?.language || [];
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
                value:
                    entry?.value ||
                    entry?.name ||
                    entry?.label ||
                    languageMappings[key] ||
                    key
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

function DashboardInstanceSettingsMenu({ config, configUpdater, activeColumns, t }) {
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
                    aria-label={"Widget settings"}
                >
                    <SettingsIcon data-icon="inline-start" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuGroup>
                    {DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS.map(
                        (column) => (
                            <DropdownMenuCheckboxItem
                                key={column.key}
                                checked={activeColumns.includes(column.key)}
                                disabled={column.required}
                                onSelect={(event) => event.preventDefault()}
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

function DashboardInstanceWidgetShell({ children, settingsMenu, t }) {
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
    context,
    currentUserId,
    enrichedRows,
    parsedLocation,
    t
}) {
    const sourceText = joinCompactParts([
        context.source === 'database' ? 'Local game log' : 'Runtime fallback',
        context.createdAt || ''
    ]);

    return (
        <div className="bg-muted/10 text-muted-foreground mx-3 mt-3 rounded-md border px-3 py-2 text-xs">
            <div className="text-foreground truncate font-medium">
                {context.location ? (
                    <LocationWorld
                        locationObject={context.location}
                        currentUserId={currentUserId}
                        worldDialogShortName={parsedLocation.shortName || ''}
                        grouphint={context.groupName || ''}
                        hint={context.worldName || ''}
                    />
                ) : (
                    context.worldName || 'Current instance'
                )}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                <span>
                    {context.playerCount || enrichedRows.length}{' '}
                    {t('dashboard.widget.instance_players')}
                </span>
                {parsedLocation.instanceName ? (
                    <span>#{parsedLocation.instanceName}</span>
                ) : null}
                {parsedLocation.accessTypeName ? (
                    <span>{parsedLocation.accessTypeName}</span>
                ) : null}
                {context.groupName ? <span>{context.groupName}</span> : null}
                {sourceText ? <span>{sourceText}</span> : null}
            </div>
        </div>
    );
}

function DashboardInstancePlayersTable({ activeColumns, rows }) {
    return (
        <div className="min-h-0 flex-1 overflow-auto">
            <Table className="app-data-table table-fixed">
                <TableBody>
                    {rows.map((row) => (
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
                                                <span
                                                    title={row.statusValue}
                                                    className="bg-muted-foreground/70 inline-block size-2.5 rounded-full border"
                                                />
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
                                            .map((entry) => (
                                                <span
                                                    key={`${row.id}:${entry.key}`}
                                                    title={
                                                        entry.value || entry.key
                                                    }
                                                >
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
    );
}

export function DashboardInstanceWidget({ config = {}, configUpdater = null }) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserLocation = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot?.location || ''
    );
    const isGameRunning = useRuntimeStore((state) =>
        Boolean(state.gameState.isGameRunning)
    );
    const addGameLogEventCount = useRuntimeStore(
        (state) => state.backendEvents.addGameLogEvent.count
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const remoteFavoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );

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
        () => parseLocation(context.location || currentUserLocation || ''),
        [context.location, currentUserLocation]
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
            t={t}
        />
    );

    if (!isGameRunning) {
        return (
            <DashboardInstanceWidgetShell settingsMenu={settingsMenu} t={t}>
                <DashboardWidgetEmptyState
                    title={t('view.dashboard.generated.instance_widget_idle')}
                    description={t('view.dashboard.generated.start_vrchat_before_the_dashboard_can_rebuild_the_current_in')}
                />
            </DashboardInstanceWidgetShell>
        );
    }

    if (loadStatus === 'error') {
        return (
            <DashboardInstanceWidgetShell settingsMenu={settingsMenu} t={t}>
                <DashboardWidgetEmptyState
                    title={t('view.dashboard.generated.instance_widget_failed')}
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
            <DashboardInstanceWidgetShell settingsMenu={settingsMenu} t={t}>
                <div className="text-muted-foreground flex min-h-[180px] flex-1 items-center justify-center gap-2 text-sm">
                    <Spinner />
                    {t('view.dashboard.generated.loading_instance_widget')}
                </div>
            </DashboardInstanceWidgetShell>
        );
    }

    if (!enrichedRows.length) {
        return (
            <DashboardInstanceWidgetShell settingsMenu={settingsMenu} t={t}>
                <DashboardWidgetEmptyState
                    title={t('view.dashboard.generated.instance_widget_idle')}
                    description={t('view.dashboard.generated.current_players_are_not_available_yet')}
                />
            </DashboardInstanceWidgetShell>
        );
    }

    return (
        <DashboardInstanceWidgetShell settingsMenu={settingsMenu} t={t}>
            <DashboardInstanceSummary
                context={context}
                currentUserId={currentUserId}
                enrichedRows={enrichedRows}
                parsedLocation={parsedLocation}
                t={t}
            />
            <DashboardInstancePlayersTable
                activeColumns={activeColumns}
                rows={enrichedRows}
            />
        </DashboardInstanceWidgetShell>
    );
}
