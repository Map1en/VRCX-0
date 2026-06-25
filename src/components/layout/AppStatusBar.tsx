import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { formatDateTime } from '@/lib/dateTime';
import { STATUS_BAR_CONFIG_KEYS } from '@/repositories/configKeys';
import configRepository from '@/repositories/configRepository';
import { startBackgroundModeForCurrentSession } from '@/services/backgroundModeService';
import {
    refreshMutualGraphFetchStatus,
    startMutualGraphFetchStatusPolling,
    wasMutualGraphFetchStartedInThisSession
} from '@/services/mutualGraphFetchService';
import {
    loadPreferenceSnapshot,
    setProxyServerPreference
} from '@/services/preferencesService';
import { openExternalLink } from '@/services/shellIntegrationService';
import {
    formatZoomPercentage,
    normalizeZoomLevel
} from '@/services/themeService';
import { refreshVrcStatusNow } from '@/services/vrcStatusService';
import {
    queueZoomLevelPreference,
    stepQueuedZoomLevelPreference,
    syncQueuedZoomLevel
} from '@/services/zoomPreferenceService';
import { useModalStore } from '@/state/modalStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';
import { ContextMenu, ContextMenuTrigger } from '@/ui/shadcn/context-menu';

import { StatusBarContextMenuContent } from './status-bar/StatusBarContextMenuContent';
import { StatusBarFooter } from './status-bar/StatusBarFooter';

const STATUS_PAGE_URL = 'https://status.vrchat.com/';

const DEFAULT_VISIBILITY: Record<string, boolean> = {
    vrchat: true,
    steamvr: true,
    proxy: true,
    ws: true,
    instanceQueue: true,
    mutualGraph: true,
    nowPlaying: true,
    uptime: false,
    zoom: true,
    clocks: true,
    servers: true
};

function normalizeUtcHour(value: any) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    return Math.max(-12, Math.min(14, Math.round(numeric)));
}

function parseClockOffset(entry: any) {
    const value =
        entry && typeof entry === 'object'
            ? 'offset' in entry
                ? entry.offset
                : entry.timezone
            : entry;
    if (typeof value === 'number') {
        return normalizeUtcHour(value);
    }
    if (typeof value !== 'string') {
        return 0;
    }
    if (/^[+-]?\d+$/.test(value.trim())) {
        return normalizeUtcHour(Number(value));
    }
    const utcMatch = value.trim().match(/^UTC([+-])(\d{1,2})(?::(\d{1,2}))?$/i);
    if (utcMatch) {
        const sign = utcMatch[1] === '+' ? 1 : -1;
        const hours = Number(utcMatch[2]);
        const minutes = Number(utcMatch[3] || 0);
        return normalizeUtcHour(sign * (hours + minutes / 60));
    }

    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: value,
            timeZoneName: 'longOffset'
        }).formatToParts(new Date());
        const timeZoneName =
            parts.find((part: any) => part.type === 'timeZoneName')?.value ||
            '';
        const offsetMatch = timeZoneName.match(
            /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/
        );
        if (offsetMatch) {
            const sign = offsetMatch[1] === '+' ? 1 : -1;
            const hours = Number(offsetMatch[2]);
            const minutes = Number(offsetMatch[3] || 0);
            return normalizeUtcHour(sign * (hours + minutes / 60));
        }
    } catch {
        return 0;
    }

    return 0;
}

function formatUtcHour(offset: any) {
    const normalized = normalizeUtcHour(offset);
    return `UTC${normalized >= 0 ? '+' : ''}${normalized}`;
}

const TIMEZONE_OPTIONS = Array.from({ length: 27 }, (_, index) => {
    const value = index - 12;
    return { value, label: formatUtcHour(value) };
});

function formatClock(nowMs: any, offset: any) {
    const shifted = new Date(nowMs + normalizeUtcHour(offset) * 60 * 60 * 1000);
    const hours = String(shifted.getUTCHours()).padStart(2, '0');
    const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${minutes} ${formatUtcHour(offset)}`;
}

function getDefaultClockOffset(localOffset: any) {
    return localOffset >= 0 ? -5 : 9;
}

function createDefaultClocks() {
    const localOffset = normalizeUtcHour(-new Date().getTimezoneOffset() / 60);
    return [
        { offset: getDefaultClockOffset(localOffset) },
        { offset: localOffset },
        { offset: 0 }
    ];
}

function formatDuration(ms: any) {
    const safeSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = safeSeconds % 60;
    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatAppUptime(ms: any) {
    const safeSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = safeSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatStatusDate(value: any) {
    return formatDateTime(value, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

export function AppStatusBar() {
    const { t } = useTranslation();
    const appStartedAtRef = useRef(Date.now());
    const observedMutualGraphRunRef = useRef(0);
    const notifiedMutualGraphRunRef = useRef(0);
    const [visibility, setVisibility] = useState(DEFAULT_VISIBILITY);
    const [clocks, setClocks] = useState(() => createDefaultClocks());
    const [clockCount, setClockCount] = useState(1);
    const [clockPopoverOpen, setClockPopoverOpen] = useState<boolean[]>([
        false,
        false,
        false
    ]);
    const websocketConnected = useRuntimeStore(
        (state: any) => state.transport.websocketConnected
    );
    const lastGameStartedAt = useRuntimeStore(
        (state: any) => state.gameState.lastGameStartedAt
    );
    const currentLocationStartedAt = useRuntimeStore(
        (state: any) => state.gameState.currentLocationStartedAt
    );
    const currentWorldName = useRuntimeStore(
        (state: any) => state.gameState.currentWorldName
    );
    const currentWorldId = useRuntimeStore(
        (state: any) => state.gameState.currentWorldId
    );
    const lastGameLogAt = useRuntimeStore(
        (state: any) => state.gameState.lastGameLogAt
    );
    const lastGameLogType = useRuntimeStore(
        (state: any) => state.gameState.lastGameLogType
    );
    const nowPlayingUrl = useRuntimeStore((state: any) => state.nowPlaying.url);
    const nowPlayingName = useRuntimeStore(
        (state: any) => state.nowPlaying.name
    );
    const nowPlayingStartedAt = useRuntimeStore(
        (state: any) => state.nowPlaying.startedAt
    );
    const nowPlayingPosition = useRuntimeStore(
        (state: any) => state.nowPlaying.position
    );
    const nowPlayingLength = useRuntimeStore(
        (state: any) => state.nowPlaying.length
    );
    const instanceQueue = useRuntimeStore((state: any) => state.instanceQueue);
    const mutualGraphRunId = useRuntimeStore(
        (state: any) => state.mutualGraph.runId
    );
    const mutualGraphStatus = useRuntimeStore(
        (state: any) => state.mutualGraph.status
    );
    const mutualGraphProcessedFriends = useRuntimeStore(
        (state: any) => state.mutualGraph.processedFriends
    );
    const mutualGraphTotalFriends = useRuntimeStore(
        (state: any) => state.mutualGraph.totalFriends
    );
    const mutualGraphCancelRequested = useRuntimeStore(
        (state: any) => state.mutualGraph.cancelRequested
    );
    const mutualGraphFailedFriends = useRuntimeStore(
        (state: any) => state.mutualGraph.failedFriends
    );
    const mutualGraphLastError = useRuntimeStore(
        (state: any) => state.mutualGraph.lastError
    );
    const isGameRunning = useRuntimeStore(
        (state: any) => state.gameState.isGameRunning
    );
    const isSteamVRRunning = useRuntimeStore(
        (state: any) => state.gameState.isSteamVRRunning
    );
    const vrcStatusIndicator = useRuntimeStore(
        (state: any) => state.vrcStatus.indicator
    );
    const vrcStatusSummary = useRuntimeStore(
        (state: any) => state.vrcStatus.summary
    );
    const vrcStatusStatus = useRuntimeStore(
        (state: any) => state.vrcStatus.status
    );
    const vrcStatusLastFetchedAt = useRuntimeStore(
        (state: any) => state.vrcStatus.lastFetchedAt
    );
    const vrcStatusRefreshing = useRuntimeStore(
        (state: any) => state.vrcStatus.refreshing
    );
    const vrcStatusError = useRuntimeStore(
        (state: any) => state.vrcStatus.error
    );
    const preferencesHydrated = usePreferencesStore(
        (state: any) => state.preferencesHydrated
    );
    const proxyServer = usePreferencesStore((state: any) => state.proxyServer);
    const zoomLevel = useShellStore((state: any) => state.zoomLevel);
    const prompt = useModalStore((state: any) => state.prompt);
    const visibleClocks = clocks.slice(
        0,
        Math.max(0, Math.min(3, Number(clockCount) || 0))
    );
    const runtimeTransport = useMemo(
        () => ({
            websocketConnected
        }),
        [websocketConnected]
    );
    const runtimeGameState = useMemo(
        () => ({
            lastGameStartedAt,
            currentLocationStartedAt,
            currentWorldName,
            currentWorldId,
            lastGameLogAt,
            lastGameLogType
        }),
        [
            currentLocationStartedAt,
            currentWorldId,
            currentWorldName,
            lastGameLogAt,
            lastGameLogType,
            lastGameStartedAt
        ]
    );
    const nowPlaying = useMemo(
        () => ({
            url: nowPlayingUrl,
            name: nowPlayingName,
            startedAt: nowPlayingStartedAt,
            position: nowPlayingPosition,
            length: nowPlayingLength
        }),
        [
            nowPlayingLength,
            nowPlayingName,
            nowPlayingPosition,
            nowPlayingStartedAt,
            nowPlayingUrl
        ]
    );
    const mutualGraph = useMemo(
        () => ({
            runId: mutualGraphRunId,
            status: mutualGraphStatus,
            processedFriends: mutualGraphProcessedFriends,
            totalFriends: mutualGraphTotalFriends,
            cancelRequested: mutualGraphCancelRequested,
            failedFriends: mutualGraphFailedFriends,
            lastError: mutualGraphLastError
        }),
        [
            mutualGraphCancelRequested,
            mutualGraphFailedFriends,
            mutualGraphLastError,
            mutualGraphProcessedFriends,
            mutualGraphRunId,
            mutualGraphStatus,
            mutualGraphTotalFriends
        ]
    );
    const vrcStatus = useMemo(
        () => ({
            indicator: vrcStatusIndicator,
            summary: vrcStatusSummary,
            status: vrcStatusStatus,
            lastFetchedAt: vrcStatusLastFetchedAt,
            refreshing: vrcStatusRefreshing,
            error: vrcStatusError
        }),
        [
            vrcStatusError,
            vrcStatusIndicator,
            vrcStatusLastFetchedAt,
            vrcStatusRefreshing,
            vrcStatusStatus,
            vrcStatusSummary
        ]
    );
    const gameStartedAt = Date.parse(lastGameStartedAt || '');
    const currentLocationStartedTimestamp = Date.parse(
        currentLocationStartedAt || ''
    );
    const currentWorld = currentWorldName || currentWorldId || '';
    const currentZoomLevel = normalizeZoomLevel(zoomLevel);
    const timezoneOptions = TIMEZONE_OPTIONS;

    useEffect(() => {
        syncQueuedZoomLevel(currentZoomLevel);
    }, [currentZoomLevel]);

    useEffect(() => {
        refreshMutualGraphFetchStatus().catch(() => {});
    }, []);

    useEffect(() => {
        if (
            mutualGraphStatus === 'running' ||
            mutualGraphStatus === 'cancelling'
        ) {
            startMutualGraphFetchStatusPolling();
        }
    }, [mutualGraphStatus]);

    useEffect(() => {
        const runId = Number(mutualGraphRunId) || 0;
        if (!runId) {
            return;
        }

        if (
            mutualGraphStatus === 'running' ||
            mutualGraphStatus === 'cancelling'
        ) {
            observedMutualGraphRunRef.current = runId;
            return;
        }

        if (
            (observedMutualGraphRunRef.current !== runId &&
                !wasMutualGraphFetchStartedInThisSession(runId)) ||
            notifiedMutualGraphRunRef.current === runId
        ) {
            return;
        }

        if (mutualGraphStatus === 'completed') {
            notifiedMutualGraphRunRef.current = runId;
            toast.success(
                t('view.charts.success.mutual_friends_graph_refreshed')
            );
            return;
        }

        if (mutualGraphStatus === 'cancelled') {
            notifiedMutualGraphRunRef.current = runId;
            toast.warning(
                t(
                    'view.charts.label.mutual_graph_fetch_cancelled_the_cached_graph_was_not_replaced'
                )
            );
            return;
        }

        if (mutualGraphStatus === 'error') {
            notifiedMutualGraphRunRef.current = runId;
            toast.error(
                mutualGraphLastError ||
                    t('view.charts.toast.failed_to_fetch_mutual_friends_graph')
            );
        }
    }, [mutualGraphLastError, mutualGraphRunId, mutualGraphStatus, t]);

    useEffect(() => {
        let active = true;

        Promise.all([
            configRepository.getString(STATUS_BAR_CONFIG_KEYS.visibility, null),
            configRepository.getString(STATUS_BAR_CONFIG_KEYS.clocks, null),
            configRepository.getString(STATUS_BAR_CONFIG_KEYS.clockCount, null)
        ])
            .then(([savedVisibility, savedClocks, savedClockCount]: any) => {
                if (!active) {
                    return;
                }

                if (savedVisibility) {
                    try {
                        setVisibility({
                            ...DEFAULT_VISIBILITY,
                            ...JSON.parse(savedVisibility)
                        });
                    } catch {
                        setVisibility(DEFAULT_VISIBILITY);
                    }
                }

                if (savedClocks) {
                    try {
                        const parsed = JSON.parse(savedClocks);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            const defaults = createDefaultClocks();
                            const nextClocks = defaults.map(
                                (defaultClock: any, index: any) => {
                                    const entry = parsed[index];
                                    return entry
                                        ? { offset: parseClockOffset(entry) }
                                        : defaultClock;
                                }
                            );
                            setClocks(nextClocks);
                        }
                    } catch {
                        // ignore invalid saved clocks
                    }
                }

                if (savedClockCount !== null) {
                    const parsedClockCount = Number(savedClockCount);
                    if (parsedClockCount >= 0 && parsedClockCount <= 3) {
                        setClockCount(parsedClockCount);
                    }
                }
            })
            .catch(() => {});

        return () => {
            active = false;
        };
    }, []);

    function persistVisibility(nextVisibility: any) {
        setVisibility(nextVisibility);
        configRepository
            .setString(
                STATUS_BAR_CONFIG_KEYS.visibility,
                JSON.stringify(nextVisibility)
            )
            .catch((error: any) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'component.app_status_bar.toast.failed_to_save_status_bar_visibility'
                          )
                );
            });
    }

    function toggleVisibility(key: any, checked: any) {
        const nextVisibility: any = {
            ...visibility,
            [key]: Boolean(checked)
        };
        persistVisibility(nextVisibility);
    }

    function setClockCountValue(nextValue: any) {
        const parsed = Math.max(0, Math.min(3, Number(nextValue) || 0));
        setClockCount(parsed);
        if (parsed > 0 && !visibility.clocks) {
            persistVisibility({
                ...visibility,
                clocks: true
            });
        }
        configRepository
            .setString(STATUS_BAR_CONFIG_KEYS.clockCount, String(parsed))
            .catch((error: any) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'component.app_status_bar.toast.failed_to_save_clock_count'
                          )
                );
            });
    }

    function setClockPopoverValue(index: any, open: any) {
        setClockPopoverOpen((current: any) => {
            const next = [...current];
            next[index] = open;
            return next;
        });
    }

    function updateClockTimezone(index: any, offsetValue: any) {
        setClocks((current: any) => {
            const defaults = createDefaultClocks();
            const nextClocks = defaults.map(
                (defaultClock: any, clockIndex: any) =>
                    current[clockIndex] ?? defaultClock
            );
            nextClocks[index] = { offset: parseClockOffset(offsetValue) };
            configRepository
                .setString(
                    STATUS_BAR_CONFIG_KEYS.clocks,
                    JSON.stringify(nextClocks)
                )
                .catch((error: any) => {
                    toast.error(
                        error instanceof Error
                            ? error.message
                            : t(
                                  'component.app_status_bar.toast.failed_to_save_status_bar_clocks'
                              )
                    );
                });
            return nextClocks;
        });
        setClockPopoverValue(index, false);
    }

    async function openStatusPage() {
        const refreshStatusPromise = refreshVrcStatusNow().catch(
            (error: any) => {
                console.warn('VRChat status refresh failed:', error);
            }
        );

        try {
            await openExternalLink(STATUS_PAGE_URL);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'component.app_status_bar.toast.failed_to_open_vrchat_status'
                      )
            );
        }

        await refreshStatusPromise;
    }

    async function promptProxySettings() {
        if (!preferencesHydrated) {
            await loadPreferenceSnapshot();
        }
        const currentProxyServer = usePreferencesStore.getState().proxyServer;
        const result = await prompt({
            title: t('component.app_status_bar.modal.proxy_settings'),
            description: t(
                'component.app_status_bar.modal.set_the_proxy_server_used_by_vrcx_0_restart_is_required'
            ),
            inputValue: currentProxyServer,
            confirmText: t('component.app_status_bar.modal.restart'),
            cancelText: t('common.actions.close')
        });
        if (!result.ok) {
            return;
        }

        const nextProxyServer = String(result.value ?? '').trim();
        await setProxyServerPreference(nextProxyServer);
    }

    function showZoomError(error: any) {
        toast.error(
            error instanceof Error
                ? error.message
                : t('app_menu.messages.zoom_failed')
        );
    }

    function startBackgroundMode() {
        startBackgroundModeForCurrentSession().catch((error: any) => {
            console.warn('Failed to start background mode:', error);
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'component.app_status_bar.toast.failed_to_start_background_mode'
                      )
            );
        });
    }

    function setQueuedZoomLevel(nextZoom: any) {
        queueZoomLevelPreference(nextZoom, { onError: showZoomError });
    }

    function stepQueuedZoomLevel(delta: any) {
        stepQueuedZoomLevelPreference(delta, { onError: showZoomError });
    }

    const footer = {
        appStartedAt: appStartedAtRef.current,
        clockPopoverOpen,
        currentLocationStartedTimestamp,
        currentWorld,
        formatAppUptime,
        formatClock,
        formatDuration,
        formatStatusDate,
        gameStartedAt,
        isGameRunning,
        isSteamVRRunning,
        instanceQueue,
        mutualGraph,
        nowPlaying,
        proxyServer,
        runtimeGameState,
        runtimeTransport,
        timezoneOptions,
        visibility,
        visibleClocks,
        vrcStatus,
        zoomLabel: formatZoomPercentage(currentZoomLevel),
        zoomLevel: currentZoomLevel,
        onOpenMediaLink: () => {
            openExternalLink(nowPlaying.url).catch((error: any) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'component.app_status_bar.toast.failed_to_open_media_link'
                          )
                );
            });
        },
        onOpenStatusPage: openStatusPage,
        onStartBackgroundMode: startBackgroundMode,
        onPromptProxySettings: () => {
            promptProxySettings().catch((error: any) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'component.app_status_bar.toast.failed_to_update_proxy_settings'
                          )
                );
            });
        },
        onSetClockPopoverValue: setClockPopoverValue,
        onSetZoomLevel: setQueuedZoomLevel,
        onStepZoomLevel: stepQueuedZoomLevel,
        onUpdateClockTimezone: updateClockTimezone
    };

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <StatusBarFooter footer={footer} />
            </ContextMenuTrigger>
            <StatusBarContextMenuContent
                clockCount={clockCount}
                onSetClockCountValue={setClockCountValue}
                onToggleVisibility={toggleVisibility}
                visibility={visibility}
            />
        </ContextMenu>
    );
}
