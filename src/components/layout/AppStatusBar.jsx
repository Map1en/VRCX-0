import { useEffect, useMemo, useRef, useState } from 'react';
import { BellIcon, ClockIcon, MonitorIcon, RadioIcon, ZoomInIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/ui/shadcn/badge.jsx';
import { Button } from '@/ui/shadcn/button.jsx';
import {
    ContextMenu,
    ContextMenuCheckboxItem,
    ContextMenuContent,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu.jsx';
import { Input } from '@/ui/shadcn/input.jsx';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from '@/ui/shadcn/tooltip.jsx';

import { backend } from '@/platform/index.js';
import { configRepository } from '@/repositories/index.js';
import { loadPreferenceSnapshot, setProxyServerPreference, setZoomLevelPreference } from '@/services/preferencesService.js';
import { formatZoomPercentage, normalizeZoomLevel } from '@/services/themeService.js';
import { useModalStore } from '@/state/modalStore.js';
import { useNotificationStore } from '@/state/notificationStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';

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
    uptime: true,
    clocks: true,
    zoom: true,
    servers: true
};

const VISIBILITY_MENU_ITEMS = [
    ['vrchat', 'Game'],
    ['steamvr', 'SteamVR'],
    ['proxy', 'Proxy'],
    ['ws', 'WebSocket'],
    ['nowPlaying', 'Now Playing'],
    ['uptime', 'App Uptime'],
    ['zoom', 'Zoom'],
    ['servers', 'Servers']
];

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
        const timeZoneName = parts.find((part) => part.type === 'timeZoneName')?.value || '';
        const offsetMatch = timeZoneName.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
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

function formatClock(nowMs, offset) {
    const shifted = new Date(nowMs + normalizeUtcHour(offset) * 60 * 60 * 1000);
    const hours = String(shifted.getUTCHours()).padStart(2, '0');
    const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${minutes} ${formatUtcHour(offset)}`;
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

function formatAppUptime(nowMs, startedAtMs) {
    return formatDuration(nowMs - startedAtMs);
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

function StatusDot({ active, warn = false }) {
    const color = active ? 'bg-green-500' : warn ? 'bg-yellow-500' : 'bg-muted-foreground/40';
    return <span className={`inline-block size-2 shrink-0 rounded-full ${color}`} />;
}

function StatusSegment({ visible = true, active = false, warn = false, label, value, children, onClick, tooltip }) {
    if (!visible) {
        return null;
    }

    const content = (
        <>
            <StatusDot active={active} warn={warn} />
            <span className="text-[10px] text-muted-foreground">{label}</span>
            {value ? <span className="truncate text-[11px] text-foreground">{value}</span> : null}
            {children}
        </>
    );

    if (typeof onClick === 'function') {
        const segment = (
            <button
                type="button"
                className="flex h-6 min-w-0 items-center gap-1.5 border-r px-2 text-left hover:bg-muted"
                onClick={onClick}>
                {content}
            </button>
        );
        if (!tooltip) {
            return segment;
        }
        return (
            <Tooltip>
                <TooltipTrigger asChild>{segment}</TooltipTrigger>
                <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
            </Tooltip>
        );
    }

    const segment = (
        <div className="flex h-6 min-w-0 items-center gap-1.5 border-r px-2">
            {content}
        </div>
    );
    if (!tooltip) {
        return segment;
    }
    return (
        <Tooltip>
            <TooltipTrigger asChild>{segment}</TooltipTrigger>
            <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
        </Tooltip>
    );
}

export function AppStatusBar() {
    const appStartedAtRef = useRef(Date.now());
    const transportMessageCountRef = useRef(0);
    const messageHistoryRef = useRef(new Array(60).fill(0));
    const [nowMs, setNowMs] = useState(Date.now());
    const [messagesPerMinute, setMessagesPerMinute] = useState(0);
    const [visibility, setVisibility] = useState(DEFAULT_VISIBILITY);
    const [clocks, setClocks] = useState(() => {
        const localOffset = normalizeUtcHour(-new Date().getTimezoneOffset() / 60);
        return [{ offset: localOffset }, { offset: 0 }, { offset: localOffset < 0 ? 9 : -5 }];
    });
    const [clockCount, setClockCount] = useState(2);
    const [zoomInput, setZoomInput] = useState('100');
    const bootStatus = useSessionStore((state) => state.bootStatus);
    const transportStatus = useSessionStore((state) => state.transportStatus);
    const isLoggedIn = useSessionStore((state) => state.isLoggedIn);
    const runtimeTransport = useRuntimeStore((state) => state.transport);
    const runtimeGameState = useRuntimeStore((state) => state.gameState);
    const nowPlaying = useRuntimeStore((state) => state.nowPlaying);
    const isGameRunning = useRuntimeStore((state) => state.gameState.isGameRunning);
    const isSteamVRRunning = useRuntimeStore((state) => state.gameState.isSteamVRRunning);
    const vrcStatus = useRuntimeStore((state) => state.vrcStatus);
    const locale = useShellStore((state) => state.locale);
    const zoomLevel = useShellStore((state) => state.zoomLevel);
    const preferencesHydrated = usePreferencesStore((state) => state.preferencesHydrated);
    const proxyServer = usePreferencesStore((state) => state.proxyServer);
    const prompt = useModalStore((state) => state.prompt);
    const unreadCount = useNotificationStore(
        (state) => state.items.filter((item) => !item.read).length
    );
    const openNotifications = useNotificationStore((state) => state.setPanelOpen);
    const visibleClocks = useMemo(
        () => clocks.slice(0, Math.max(0, Math.min(3, Number(clockCount) || 0))),
        [clocks, clockCount]
    );
    const apiLabel = proxyServer || 'Proxy';
    const gameStartedAt = Date.parse(runtimeGameState.lastGameStartedAt || '');
    const currentLocationStartedAt = Date.parse(runtimeGameState.currentLocationStartedAt || '');
    const gameDuration = isGameRunning && gameStartedAt ? formatDuration(nowMs - gameStartedAt) : '';
    const currentLocationDuration = isGameRunning && currentLocationStartedAt ? formatDuration(nowMs - currentLocationStartedAt) : '';
    const currentWorld = runtimeGameState.currentWorldName || runtimeGameState.currentWorldId || '';
    const nowPlayingElapsed = nowPlaying.startedAt
        ? Math.max(0, Math.floor((nowMs - Date.parse(nowPlaying.startedAt)) / 1000) + Number(nowPlaying.position || 0))
        : Number(nowPlaying.position || 0);
    const nowPlayingProgress = nowPlaying.length
        ? `${formatDuration(nowPlayingElapsed * 1000)} / ${formatDuration(Number(nowPlaying.length) * 1000)}`
        : '';

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
                        setVisibility({ ...DEFAULT_VISIBILITY, ...JSON.parse(savedVisibility) });
                    } catch {
                        setVisibility(DEFAULT_VISIBILITY);
                    }
                }

                if (savedClocks) {
                    try {
                        const parsed = JSON.parse(savedClocks);
                        if (Array.isArray(parsed) && parsed.length === 3) {
                            setClocks(parsed.map((entry) => ({ offset: parseClockOffset(entry) })));
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
        transportMessageCountRef.current = runtimeTransport.messageCount;
    }, [runtimeTransport.messageCount]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            const nextCount = transportMessageCountRef.current;
            const delta = Math.max(0, nextCount - (messageHistoryRef.current.lastCount ?? nextCount));
            messageHistoryRef.current.lastCount = nextCount;
            messageHistoryRef.current.push(delta);
            while (messageHistoryRef.current.length > 60) {
                messageHistoryRef.current.shift();
            }
            setMessagesPerMinute(messageHistoryRef.current.reduce((sum, item) => sum + item, 0));
            setNowMs(Date.now());
        }, 1000);

        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        setZoomInput(String(normalizeZoomLevel(zoomLevel)));
    }, [zoomLevel]);

    async function applyZoomInput() {
        try {
            const nextZoom = await setZoomLevelPreference(zoomInput);
            setZoomInput(String(nextZoom));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to apply zoom.');
        }
    }

    function persistVisibility(nextVisibility) {
        setVisibility(nextVisibility);
        void configRepository
            .setString(VISIBILITY_KEY, JSON.stringify(nextVisibility))
            .catch((error) => {
                toast.error(error instanceof Error ? error.message : 'Failed to save status bar visibility.');
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
        void configRepository.setString(CLOCK_COUNT_KEY, String(parsed)).catch((error) => {
            toast.error(error instanceof Error ? error.message : 'Failed to save clock count.');
        });
    }

    async function openStatusPage() {
        try {
            await backend.app.OpenLink(STATUS_PAGE_URL);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to open VRChat status.');
        }
    }

    async function promptProxySettings() {
        if (!preferencesHydrated) {
            await loadPreferenceSnapshot();
        }
        const currentProxyServer = usePreferencesStore.getState().proxyServer;
        const result = await prompt({
            title: 'Proxy Settings',
            description: 'Set the proxy server used by VRCX. Restart is required to apply a changed proxy.',
            inputValue: currentProxyServer,
            confirmText: 'Restart',
            cancelText: 'Close'
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
                <footer className="border-t bg-background/95 text-xs backdrop-blur">
                    <div className="flex min-h-7 flex-col gap-1 overflow-hidden lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex min-w-0 flex-1 items-center overflow-hidden">
                            <StatusSegment
                                active={isLoggedIn}
                                label="Session"
                                value={isLoggedIn ? 'Signed in' : 'Signed out'}
                            />
                            <StatusSegment
                                visible={visibility.proxy}
                                active={Boolean(proxyServer)}
                                label="Proxy"
                                value={apiLabel}
                                onClick={() => {
                                    void promptProxySettings().catch((error) => {
                                        toast.error(error instanceof Error ? error.message : 'Failed to update proxy settings.');
                                    });
                                }}
                            />
                            <StatusSegment
                                visible={visibility.steamvr}
                                active={Boolean(isSteamVRRunning)}
                                label="SteamVR"
                                value={isSteamVRRunning ? 'running' : 'stopped'}
                            />
                            <StatusSegment
                                visible={visibility.vrchat}
                                active={Boolean(isGameRunning)}
                                label="VRChat"
                                value={isGameRunning ? gameDuration || 'running' : 'stopped'}
                                tooltip={
                                    <div className="space-y-1 text-xs">
                                        {isGameRunning ? (
                                            <>
                                                <div className="flex justify-between gap-4">
                                                    <span className="text-muted-foreground">Started at</span>
                                                    <span>{formatStatusDate(runtimeGameState.lastGameStartedAt)}</span>
                                                </div>
                                                <div className="flex justify-between gap-4">
                                                    <span className="text-muted-foreground">Session duration</span>
                                                    <span>{gameDuration || '-'}</span>
                                                </div>
                                                <div className="flex justify-between gap-4">
                                                    <span className="text-muted-foreground">Instance duration</span>
                                                    <span>{currentLocationDuration || '-'}</span>
                                                </div>
                                                {currentWorld ? (
                                                    <div className="max-w-64 truncate text-muted-foreground">{currentWorld}</div>
                                                ) : null}
                                            </>
                                        ) : (
                                            <>
                                                <div className="flex justify-between gap-4">
                                                    <span className="text-muted-foreground">Last game event</span>
                                                    <span>{formatStatusDate(runtimeGameState.lastGameLogAt)}</span>
                                                </div>
                                                <div className="flex justify-between gap-4">
                                                    <span className="text-muted-foreground">Last event type</span>
                                                    <span>{runtimeGameState.lastGameLogType || '-'}</span>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                }>
                                {currentWorld ? <span className="max-w-56 truncate text-[11px] text-muted-foreground">{currentWorld}</span> : null}
                            </StatusSegment>
                            <StatusSegment
                                visible={visibility.servers}
                                active={vrcStatus.indicator !== 'major'}
                                warn={vrcStatus.indicator && vrcStatus.indicator !== 'none'}
                                label="Servers"
                                value={vrcStatus.summary || vrcStatus.status || 'OK'}
                                onClick={() => void openStatusPage()}
                            />
                            <StatusSegment
                                visible={visibility.ws}
                                active={Boolean(runtimeTransport.websocketConnected)}
                                label="WebSocket"
                                value={`${messagesPerMinute}/min`}>
                                <span className="text-[10px] text-muted-foreground">
                                    {runtimeTransport.messageCount} total
                                </span>
                            </StatusSegment>
                            <StatusSegment
                                visible={visibility.nowPlaying && Boolean(nowPlaying.url)}
                                active
                                label="Now Playing"
                                value={nowPlaying.name || nowPlaying.url}
                                onClick={() => {
                                    void backend.app.OpenLink(nowPlaying.url).catch((error) => {
                                        toast.error(error instanceof Error ? error.message : 'Failed to open media link.');
                                    });
                                }}>
                                {nowPlayingProgress ? (
                                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                                        {nowPlayingProgress}
                                    </span>
                                ) : null}
                            </StatusSegment>
                        </div>

                        <div className="flex shrink-0 items-center justify-end overflow-hidden">
                            <div className="hidden items-center border-r px-2 text-[10px] text-muted-foreground md:flex">
                                <MonitorIcon className="mr-1 size-3.5" />
                                Boot {bootStatus} · {transportStatus} · {locale}
                            </div>
                            {visibility.clocks
                                ? visibleClocks.map((clock, index) => (
                                      <div
                                          key={`${clock.offset}-${index}`}
                                          className="flex h-6 items-center gap-1.5 border-r px-2 text-[10px] tabular-nums">
                                          <ClockIcon className="size-3.5 text-muted-foreground" />
                                          {formatClock(nowMs, clock.offset)}
                                      </div>
                                  ))
                                : null}
                            {visibility.zoom ? (
                                <div className="flex h-6 items-center gap-1.5 border-r px-2">
                                    <ZoomInIcon className="size-3.5 text-muted-foreground" />
                                    <Input
                                        value={zoomInput}
                                        onChange={(event) => setZoomInput(event.target.value)}
                                        onBlur={() => {
                                            void applyZoomInput();
                                        }}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                                event.currentTarget.blur();
                                            }
                                        }}
                                        className="h-5 w-14 px-1 py-0 text-center text-[11px]"
                                    />
                                    <span className="text-[10px] text-muted-foreground">
                                        {formatZoomPercentage(zoomLevel)}
                                    </span>
                                </div>
                            ) : null}
                            {visibility.uptime ? (
                                <div className="flex h-6 items-center gap-1.5 border-r px-2 text-[10px] tabular-nums">
                                    <RadioIcon className="size-3.5 text-muted-foreground" />
                                    {formatAppUptime(nowMs, appStartedAtRef.current)}
                                </div>
                            ) : null}
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="relative h-6 gap-1.5 rounded-none px-2"
                                onClick={() => openNotifications(true)}>
                                <BellIcon className="size-3.5" />
                                Notifications
                                {unreadCount > 0 ? (
                                    <Badge className="ml-1 min-w-5 justify-center px-1.5 py-0 text-[10px] leading-5">
                                        {unreadCount}
                                    </Badge>
                                ) : null}
                            </Button>
                        </div>
                    </div>
                </footer>
            </ContextMenuTrigger>
            <ContextMenuContent>
                {VISIBILITY_MENU_ITEMS.map(([key, label]) => (
                    <ContextMenuCheckboxItem
                        key={key}
                        checked={Boolean(visibility[key])}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={(checked) => toggleVisibility(key, checked)}>
                        {label}
                    </ContextMenuCheckboxItem>
                ))}
                <ContextMenuSeparator />
                <ContextMenuSub>
                    <ContextMenuSubTrigger>Clocks</ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                        {[0, 1, 2, 3].map((count) => (
                            <ContextMenuCheckboxItem
                                key={count}
                                checked={clockCount === count}
                                onSelect={(event) => event.preventDefault()}
                                onCheckedChange={(checked) => {
                                    if (checked) {
                                        setClockCountValue(count);
                                    }
                                }}>
                                {count === 0 ? 'No clocks' : `${count} clock${count === 1 ? '' : 's'}`}
                            </ContextMenuCheckboxItem>
                        ))}
                    </ContextMenuSubContent>
                </ContextMenuSub>
            </ContextMenuContent>
        </ContextMenu>
    );
}
