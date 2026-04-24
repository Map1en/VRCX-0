import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import { backend } from '@/platform/index.js';
import { configRepository } from '@/repositories/index.js';
import {
    loadPreferenceSnapshot,
    setProxyServerPreference
} from '@/services/preferencesService.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import {
    ContextMenu,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';
import { StatusBarContextMenuContent } from './status-bar/StatusBarContextMenuContent.jsx';
import { StatusBarFooter } from './status-bar/StatusBarFooter.jsx';

const VISIBILITY_KEY = 'VRCX_statusBarVisibility';
const CLOCKS_KEY = 'VRCX_statusBarClocks';
const CLOCK_COUNT_KEY = 'VRCX_statusBarClockCount';
const STATUS_PAGE_URL = 'https://status.vrchat.com/';

const DEFAULT_VISIBILITY = {
    vrchat: true,
    steamvr: true,
    proxy: true,
    ws: true,
    nowPlaying: true,
    clocks: true,
    servers: true
};

function normalizeUtcHour(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    return Math.max(-12, Math.min(14, Math.round(numeric)));
}

function parseClockOffset(entry) {
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

function formatUtcHour(offset) {
    const normalized = normalizeUtcHour(offset);
    return `UTC${normalized >= 0 ? '+' : ''}${normalized}`;
}

const TIMEZONE_OPTIONS = Array.from({ length: 27 }, (_, index) => {
    const value = index - 12;
    return { value, label: formatUtcHour(value) };
});

function formatClock(nowMs, offset) {
    const shifted = new Date(nowMs + normalizeUtcHour(offset) * 60 * 60 * 1000);
    const hours = String(shifted.getUTCHours()).padStart(2, '0');
    const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${minutes} ${formatUtcHour(offset)}`;
}

function getDefaultClockOffset(localOffset) {
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

function formatDuration(ms) {
    const safeSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = safeSeconds % 60;
    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatStatusDate(value) {
    const date = new Date(value || 0);
    if (Number.isNaN(date.getTime())) {
        return '-';
    }
    return new Intl.DateTimeFormat(undefined, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

export function AppStatusBar() {
    const { t } = useTranslation();
    const transportMessageCountRef = useRef(0);
    const messageHistoryRef = useRef(new Array(60).fill(0));
    const [nowMs, setNowMs] = useState(Date.now());
    const [messagesPerMinute, setMessagesPerMinute] = useState(0);
    const [visibility, setVisibility] = useState(DEFAULT_VISIBILITY);
    const [clocks, setClocks] = useState(() => createDefaultClocks());
    const [clockCount, setClockCount] = useState(1);
    const [clockPopoverOpen, setClockPopoverOpen] = useState([
        false,
        false,
        false
    ]);
    const transportMessageCount = useRuntimeStore(
        (state) => state.transport.messageCount
    );
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
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const proxyServer = usePreferencesStore((state) => state.proxyServer);
    const prompt = useModalStore((state) => state.prompt);
    const visibleClocks = clocks.slice(
        0,
        Math.max(0, Math.min(3, Number(clockCount) || 0))
    );
    const runtimeTransport = useMemo(
        () => ({
            messageCount: transportMessageCount,
            websocketConnected
        }),
        [transportMessageCount, websocketConnected]
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
    const vrcStatus = useMemo(
        () => ({
            indicator: vrcStatusIndicator,
            summary: vrcStatusSummary,
            status: vrcStatusStatus
        }),
        [vrcStatusIndicator, vrcStatusStatus, vrcStatusSummary]
    );
    const gameStartedAt = Date.parse(lastGameStartedAt || '');
    const currentLocationStartedTimestamp = Date.parse(
        currentLocationStartedAt || ''
    );
    const gameDuration =
        isGameRunning && gameStartedAt
            ? formatDuration(nowMs - gameStartedAt)
            : '';
    const currentLocationDuration =
        isGameRunning && currentLocationStartedTimestamp
            ? formatDuration(nowMs - currentLocationStartedTimestamp)
            : '';
    const currentWorld = currentWorldName || currentWorldId || '';
    const nowPlayingElapsed = nowPlaying.startedAt
        ? Math.max(
              0,
              Math.floor((nowMs - Date.parse(nowPlaying.startedAt)) / 1000) +
                  Number(nowPlaying.position || 0)
          )
        : Number(nowPlaying.position || 0);
    const nowPlayingProgress = nowPlaying.length
        ? `${formatDuration(nowPlayingElapsed * 1000)} / ${formatDuration(Number(nowPlaying.length) * 1000)}`
        : '';
    const timezoneOptions = TIMEZONE_OPTIONS;

    useEffect(() => {
        let active = true;

        Promise.all([
            configRepository.getString(VISIBILITY_KEY, null),
            configRepository.getString(CLOCKS_KEY, null),
            configRepository.getString(CLOCK_COUNT_KEY, null)
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

    useEffect(() => {
        transportMessageCountRef.current = transportMessageCount;
    }, [transportMessageCount]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            const nextCount = transportMessageCountRef.current;
            const delta = Math.max(
                0,
                nextCount - (messageHistoryRef.current.lastCount ?? nextCount)
            );
            messageHistoryRef.current.lastCount = nextCount;
            messageHistoryRef.current.push(delta);
            while (messageHistoryRef.current.length > 60) {
                messageHistoryRef.current.shift();
            }
            setMessagesPerMinute(
                messageHistoryRef.current.reduce((sum, item) => sum + item, 0)
            );
            setNowMs(Date.now());
        }, 1000);

        return () => window.clearInterval(timer);
    }, []);

    function persistVisibility(nextVisibility) {
        setVisibility(nextVisibility);
        void configRepository
            .setString(VISIBILITY_KEY, JSON.stringify(nextVisibility))
            .catch((error) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('component.app_status_bar.generated_toast.failed_to_save_status_bar_visibility')
                );
            });
    }

    function toggleVisibility(key, checked) {
        const nextVisibility = {
            ...visibility,
            [key]: Boolean(checked)
        };
        persistVisibility(nextVisibility);
    }

    function setClockCountValue(nextValue) {
        const parsed = Math.max(0, Math.min(3, Number(nextValue) || 0));
        setClockCount(parsed);
        if (parsed > 0 && !visibility.clocks) {
            persistVisibility({
                ...visibility,
                clocks: true
            });
        }
        void configRepository
            .setString(CLOCK_COUNT_KEY, String(parsed))
            .catch((error) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('component.app_status_bar.generated_toast.failed_to_save_clock_count')
                );
            });
    }

    function setClockPopoverValue(index, open) {
        setClockPopoverOpen((current) => {
            const next = [...current];
            next[index] = open;
            return next;
        });
    }

    function updateClockTimezone(index, offsetValue) {
        setClocks((current) => {
            const defaults = createDefaultClocks();
            const nextClocks = defaults.map(
                (defaultClock, clockIndex) =>
                    current[clockIndex] ?? defaultClock
            );
            nextClocks[index] = { offset: parseClockOffset(offsetValue) };
            void configRepository
                .setString(CLOCKS_KEY, JSON.stringify(nextClocks))
                .catch((error) => {
                    toast.error(
                        error instanceof Error
                            ? error.message
                            : t('component.app_status_bar.generated_toast.failed_to_save_status_bar_clocks')
                    );
                });
            return nextClocks;
        });
        setClockPopoverValue(index, false);
    }

    async function openStatusPage() {
        try {
            await backend.app.OpenLink(STATUS_PAGE_URL);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('component.app_status_bar.generated_toast.failed_to_open_vrchat_status')
            );
        }
    }

    async function promptProxySettings() {
        if (!preferencesHydrated) {
            await loadPreferenceSnapshot();
        }
        const currentProxyServer = usePreferencesStore.getState().proxyServer;
        const result = await prompt({
            title: t('component.app_status_bar.generated_modal.proxy_settings'),
            description:
                t('component.app_status_bar.generated_modal.set_the_proxy_server_used_by_vrcx_0_restart_is_r'),
            inputValue: currentProxyServer,
            confirmText: t('component.app_status_bar.generated_modal.restart'),
            cancelText: t('common.actions.close')
        });
        if (!result.ok) {
            return;
        }

        const nextProxyServer = String(result.value ?? '').trim();
        await setProxyServerPreference(nextProxyServer);
    }

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <StatusBarFooter
                    t={t}
                    helpers={{ formatClock, formatStatusDate }}
                    handlers={{
                        onOpenMediaLink: () => {
                            void backend.app
                                .OpenLink(nowPlaying.url)
                                .catch((error) => {
                                    toast.error(
                                        error instanceof Error
                                            ? error.message
                                            : t(
                                                  'component.app_status_bar.generated_toast.failed_to_open_media_link'
                                              )
                                    );
                                });
                        },
                        onOpenStatusPage: openStatusPage,
                        onPromptProxySettings: () => {
                            void promptProxySettings().catch((error) => {
                                toast.error(
                                    error instanceof Error
                                        ? error.message
                                        : t(
                                              'component.app_status_bar.generated_toast.failed_to_update_proxy_settings'
                                          )
                                );
                            });
                        },
                        onSetClockPopoverValue: setClockPopoverValue,
                        onUpdateClockTimezone: updateClockTimezone
                    }}
                    state={{
                        clockPopoverOpen,
                        currentLocationDuration,
                        currentWorld,
                        gameDuration,
                        isGameRunning,
                        isSteamVRRunning,
                        messagesPerMinute,
                        nowMs,
                        nowPlaying,
                        nowPlayingProgress,
                        proxyServer,
                        runtimeGameState,
                        runtimeTransport,
                        timezoneOptions,
                        visibility,
                        visibleClocks,
                        vrcStatus
                    }}
                />
            </ContextMenuTrigger>
            <StatusBarContextMenuContent
                clockCount={clockCount}
                onSetClockCountValue={setClockCountValue}
                onToggleVisibility={toggleVisibility}
                t={t}
                visibility={visibility}
            />
        </ContextMenu>
    );
}
