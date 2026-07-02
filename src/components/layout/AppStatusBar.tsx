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
import { links } from '@/shared/constants/link';
import {
    HOUR_MS,
    SECOND_MS,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE
} from '@/shared/constants/time';
import { useModalStore } from '@/state/modalStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';
import { ContextMenu, ContextMenuTrigger } from '@/ui/shadcn/context-menu';

import { StatusBarContextMenuContent } from './status-bar/StatusBarContextMenuContent';
import { StatusBarFooter } from './status-bar/StatusBarFooter';
import type {
    StatusBarClock,
    StatusBarVisibility,
    StatusBarVisibilityKey
} from './status-bar/statusBarTypes';

const DEFAULT_VISIBILITY: StatusBarVisibility = {
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function normalizeUtcHour(value: unknown) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    return Math.max(-12, Math.min(14, Math.round(numeric)));
}

function parseClockOffset(entry: unknown) {
    const value = isRecord(entry)
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
            parts.find((part) => part.type === 'timeZoneName')?.value || '';
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

function formatUtcHour(offset: unknown) {
    const normalized = normalizeUtcHour(offset);
    return `UTC${normalized >= 0 ? '+' : ''}${normalized}`;
}

const TIMEZONE_OPTIONS = Array.from({ length: 27 }, (_, index) => {
    const value = index - 12;
    return { value, label: formatUtcHour(value) };
});

function formatClock(nowMs: number, offset: unknown) {
    const shifted = new Date(nowMs + normalizeUtcHour(offset) * HOUR_MS);
    const hours = String(shifted.getUTCHours()).padStart(2, '0');
    const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${minutes} ${formatUtcHour(offset)}`;
}

function getDefaultClockOffset(localOffset: number) {
    return localOffset >= 0 ? -5 : 9;
}

function createDefaultClocks(): StatusBarClock[] {
    const localOffset = normalizeUtcHour(-new Date().getTimezoneOffset() / 60);
    return [
        { offset: getDefaultClockOffset(localOffset) },
        { offset: localOffset },
        { offset: 0 }
    ];
}

function formatDuration(ms: unknown) {
    const { hours, minutes, seconds } = durationParts(ms);
    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function durationParts(ms: unknown) {
    const safeSeconds = Math.max(0, Math.floor((Number(ms) || 0) / SECOND_MS));
    const hours = Math.floor(safeSeconds / SECONDS_PER_HOUR);
    const minutes = Math.floor(
        (safeSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE
    );
    const seconds = safeSeconds % SECONDS_PER_MINUTE;
    return { hours, minutes, seconds };
}

function formatAppUptime(ms: number) {
    const { hours, minutes, seconds } = durationParts(ms);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatStatusDate(value: unknown) {
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
        (state) => state.transport.websocketConnected
    );
    const lastGameStartedAt = useRuntimeStore(
        (state) => state.gameState.lastGameStartedAt
    );
    const currentLocationStartedAt = useRuntimeStore(
        (state) => state.gameState.currentLocationStartedAt
    );
    const currentWorldName = useRuntimeStore(
        (state) => state.gameState.currentWorldName
    );
    const currentWorldId = useRuntimeStore(
        (state) => state.gameState.currentWorldId
    );
    const lastGameLogAt = useRuntimeStore(
        (state) => state.gameState.lastGameLogAt
    );
    const lastGameLogType = useRuntimeStore(
        (state) => state.gameState.lastGameLogType
    );
    const nowPlayingUrl = useRuntimeStore((state) => state.nowPlaying.url);
    const nowPlayingName = useRuntimeStore((state) => state.nowPlaying.name);
    const nowPlayingStartedAt = useRuntimeStore(
        (state) => state.nowPlaying.startedAt
    );
    const nowPlayingPosition = useRuntimeStore(
        (state) => state.nowPlaying.position
    );
    const nowPlayingLength = useRuntimeStore(
        (state) => state.nowPlaying.length
    );
    const instanceQueue = useRuntimeStore((state) => state.instanceQueue);
    const mutualGraphRunId = useRuntimeStore(
        (state) => state.mutualGraph.runId
    );
    const mutualGraphStatus = useRuntimeStore(
        (state) => state.mutualGraph.status
    );
    const mutualGraphProcessedFriends = useRuntimeStore(
        (state) => state.mutualGraph.processedFriends
    );
    const mutualGraphTotalFriends = useRuntimeStore(
        (state) => state.mutualGraph.totalFriends
    );
    const mutualGraphCancelRequested = useRuntimeStore(
        (state) => state.mutualGraph.cancelRequested
    );
    const mutualGraphFailedFriends = useRuntimeStore(
        (state) => state.mutualGraph.failedFriends
    );
    const mutualGraphLastError = useRuntimeStore(
        (state) => state.mutualGraph.lastError
    );
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning
    );
    const isSteamVRRunning = useRuntimeStore(
        (state) => state.gameState.isSteamVRRunning
    );
    const vrcStatusIndicator = useRuntimeStore(
        (state) => state.vrcStatus.indicator
    );
    const vrcStatusSummary = useRuntimeStore(
        (state) => state.vrcStatus.summary
    );
    const vrcStatusStatus = useRuntimeStore((state) => state.vrcStatus.status);
    const vrcStatusLastFetchedAt = useRuntimeStore(
        (state) => state.vrcStatus.lastFetchedAt
    );
    const vrcStatusRefreshing = useRuntimeStore(
        (state) => state.vrcStatus.refreshing
    );
    const vrcStatusError = useRuntimeStore((state) => state.vrcStatus.error);
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const proxyServer = usePreferencesStore((state) => state.proxyServer);
    const zoomLevel = useShellStore((state) => state.zoomLevel);
    const prompt = useModalStore((state) => state.prompt);
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
            .then(([savedVisibility, savedClocks, savedClockCount]) => {
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
                                (defaultClock, index) => {
                                    const entry = parsed[index];
                                    return entry
                                        ? { offset: parseClockOffset(entry) }
                                        : defaultClock;
                                }
                            );
                            setClocks(nextClocks);
                        }
                    } catch {
                        // no-op
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

    function persistVisibility(nextVisibility: StatusBarVisibility) {
        setVisibility(nextVisibility);
        configRepository
            .setString(
                STATUS_BAR_CONFIG_KEYS.visibility,
                JSON.stringify(nextVisibility)
            )
            .catch((error: unknown) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'component.app_status_bar.toast.failed_to_save_status_bar_visibility'
                          )
                );
            });
    }

    function toggleVisibility(key: StatusBarVisibilityKey, checked: boolean) {
        const nextVisibility: StatusBarVisibility = {
            ...visibility,
            [key]: Boolean(checked)
        };
        persistVisibility(nextVisibility);
    }

    function setClockCountValue(nextValue: unknown) {
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
            .catch((error: unknown) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'component.app_status_bar.toast.failed_to_save_clock_count'
                          )
                );
            });
    }

    function setClockPopoverValue(index: number, open: boolean) {
        setClockPopoverOpen((current) => {
            const next = [...current];
            next[index] = open;
            return next;
        });
    }

    function updateClockTimezone(index: number, offsetValue: unknown) {
        setClocks((current) => {
            const defaults = createDefaultClocks();
            const nextClocks = defaults.map(
                (defaultClock, clockIndex) =>
                    current[clockIndex] ?? defaultClock
            );
            nextClocks[index] = { offset: parseClockOffset(offsetValue) };
            configRepository
                .setString(
                    STATUS_BAR_CONFIG_KEYS.clocks,
                    JSON.stringify(nextClocks)
                )
                .catch((error: unknown) => {
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
            (error: unknown) => {
                console.warn('VRChat status refresh failed:', error);
            }
        );

        try {
            await openExternalLink(links.vrchatStatus);
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

    function showZoomError(error: unknown) {
        toast.error(
            error instanceof Error
                ? error.message
                : t('app_menu.messages.zoom_failed')
        );
    }

    function startBackgroundMode() {
        startBackgroundModeForCurrentSession().catch((error: unknown) => {
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

    function setQueuedZoomLevel(nextZoom: number) {
        queueZoomLevelPreference(nextZoom, { onError: showZoomError });
    }

    function stepQueuedZoomLevel(delta: number) {
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
            openExternalLink(nowPlaying.url).catch((error: unknown) => {
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
            promptProxySettings().catch((error: unknown) => {
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
