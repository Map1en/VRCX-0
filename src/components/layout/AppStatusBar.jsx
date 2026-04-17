import { useEffect, useMemo, useRef, useState } from 'react';
import { ClockIcon, NetworkIcon } from 'lucide-react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/ui/shadcn/button';
import {
    ContextMenu,
    ContextMenuCheckboxItem,
    ContextMenuContent,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from '@/ui/shadcn/popover';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from '@/ui/shadcn/tooltip';

import { backend } from '@/platform/index.js';
import { configRepository } from '@/repositories/index.js';
import { loadPreferenceSnapshot, setProxyServerPreference } from '@/services/preferencesService.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
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
    clocks: true,
    servers: true
};

const VISIBILITY_MENU_ITEMS = [
    ['vrchat', 'VRChat'],
    ['steamvr', 'SteamVR'],
    ['proxy', 'Proxy'],
    ['ws', 'Realtime'],
    ['nowPlaying', 'Now Playing'],
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

function StatusDot({ active, warn = false }) {
    const color = warn ? 'bg-amber-500' : active ? 'bg-green-500' : 'bg-muted-foreground/40';
    return <span className={cn('inline-block size-2 shrink-0 rounded-full', color)} />;
}

function StatusSegment({ visible = true, active = false, warn = false, label, value, children, onClick, tooltip }) {
    if (!visible) {
        return null;
    }

    const content = (
        <>
            <StatusDot active={active} warn={warn} />
            <span className="text-xs text-muted-foreground">{label}</span>
            {value ? <span className="truncate text-xs text-foreground">{value}</span> : null}
            {children}
        </>
    );

    if (typeof onClick === 'function') {
        const segment = (
            <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 min-w-0 justify-start gap-1.5 rounded-none border-r px-2 text-left font-normal"
                onClick={onClick}>
                {content}
            </Button>
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
    const { t } = useI18n();
    const transportMessageCountRef = useRef(0);
    const messageHistoryRef = useRef(new Array(60).fill(0));
    const [nowMs, setNowMs] = useState(Date.now());
    const [messagesPerMinute, setMessagesPerMinute] = useState(0);
    const [visibility, setVisibility] = useState(DEFAULT_VISIBILITY);
    const [clocks, setClocks] = useState(() => createDefaultClocks());
    const [clockCount, setClockCount] = useState(1);
    const [clockPopoverOpen, setClockPopoverOpen] = useState([false, false, false]);
    const runtimeTransport = useRuntimeStore((state) => state.transport);
    const runtimeGameState = useRuntimeStore((state) => state.gameState);
    const nowPlaying = useRuntimeStore((state) => state.nowPlaying);
    const isGameRunning = useRuntimeStore((state) => state.gameState.isGameRunning);
    const isSteamVRRunning = useRuntimeStore((state) => state.gameState.isSteamVRRunning);
    const vrcStatus = useRuntimeStore((state) => state.vrcStatus);
    const preferencesHydrated = usePreferencesStore((state) => state.preferencesHydrated);
    const proxyServer = usePreferencesStore((state) => state.proxyServer);
    const prompt = useModalStore((state) => state.prompt);
    const visibleClocks = useMemo(
        () => clocks.slice(0, Math.max(0, Math.min(3, Number(clockCount) || 0))),
        [clocks, clockCount]
    );
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
    const timezoneOptions = useMemo(
        () => Array.from({ length: 27 }, (_, index) => {
            const value = index - 12;
            return { value, label: formatUtcHour(value) };
        }),
        []
    );

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
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            const defaults = createDefaultClocks();
                            const nextClocks = defaults.map((defaultClock, index) => {
                                const entry = parsed[index];
                                return entry ? { offset: parseClockOffset(entry) } : defaultClock;
                            });
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
            const nextClocks = defaults.map((defaultClock, clockIndex) => current[clockIndex] ?? defaultClock);
            nextClocks[index] = { offset: parseClockOffset(offsetValue) };
            void configRepository.setString(CLOCKS_KEY, JSON.stringify(nextClocks)).catch((error) => {
                toast.error(error instanceof Error ? error.message : 'Failed to save status bar clocks.');
            });
            return nextClocks;
        });
        setClockPopoverValue(index, false);
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
            description: 'Set the proxy server used by VRCX-0. Restart is required to apply a changed proxy.',
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
                                visible={visibility.steamvr}
                                active={Boolean(isSteamVRRunning)}
                                label="SteamVR"
                            />
                            <StatusSegment
                                visible={visibility.vrchat}
                                active={Boolean(isGameRunning)}
                                label="VRChat"
                                tooltip={
                                    <div className="flex flex-col gap-1 text-xs">
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
                                }
                            />
                            <StatusSegment
                                visible={visibility.servers}
                                active={!vrcStatus.indicator || vrcStatus.indicator === 'none'}
                                warn={vrcStatus.indicator && vrcStatus.indicator !== 'none'}
                                label="Servers"
                                onClick={() => void openStatusPage()}
                                tooltip={vrcStatus.summary || vrcStatus.status || 'VRChat status'}
                            />
                            {visibility.ws ? (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="-ml-px flex h-6 items-center gap-1.5 border-x px-2">
                                            <StatusDot active={Boolean(runtimeTransport.websocketConnected)} />
                                            <span className="text-xs text-muted-foreground">
                                                {t('status_bar.realtime_connection')}
                                            </span>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent className="flex max-w-xs flex-col gap-1 text-xs">
                                        <span>
                                            WebSocket {runtimeTransport.websocketConnected
                                                ? t('status_bar.ws_connected')
                                                : t('status_bar.ws_disconnected')}
                                        </span>
                                        <span className="text-muted-foreground">
                                            {t('status_bar.ws_avg_per_minute', { count: messagesPerMinute })}
                                        </span>
                                    </TooltipContent>
                                </Tooltip>
                            ) : null}
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
                                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                        {nowPlayingProgress}
                                    </span>
                                ) : null}
                            </StatusSegment>
                        </div>

                        <div className="flex shrink-0 items-center justify-end overflow-hidden">
                            {visibility.clocks
                                ? visibleClocks.map((clock, index) => (
                                      <Popover
                                          key={`${clock.offset}-${index}`}
                                          open={Boolean(clockPopoverOpen[index])}
                                          onOpenChange={(open) => setClockPopoverValue(index, open)}>
                                          <PopoverTrigger asChild>
                                              <Button
                                                  type="button"
                                                  variant="ghost"
                                                  size="sm"
                                                  className="h-6 gap-1.5 rounded-none border-r px-2 text-xs font-normal tabular-nums">
                                                  <ClockIcon className="size-3.5 text-muted-foreground" />
                                                  {formatClock(nowMs, clock.offset)}
                                              </Button>
                                          </PopoverTrigger>
                                          <PopoverContent side="top" align="center" className="w-72">
                                              <div className="flex flex-col gap-2 p-1">
                                                  <label className="text-xs font-medium">{t('status_bar.timezone')}</label>
                                                  <Select
                                                      value={String(normalizeUtcHour(clock.offset))}
                                                      onValueChange={(offset) => updateClockTimezone(index, offset)}>
                                                      <SelectTrigger size="sm" className="w-full">
                                                          <SelectValue placeholder={t('status_bar.timezone')} />
                                                      </SelectTrigger>
                                                      <SelectContent className="max-h-60">
                                                          <SelectGroup>
                                                              {timezoneOptions.map((option) => (
                                                                  <SelectItem key={option.value} value={String(option.value)}>
                                                                      <span className="w-full text-right font-mono">{option.label}</span>
                                                                  </SelectItem>
                                                              ))}
                                                          </SelectGroup>
                                                      </SelectContent>
                                                  </Select>
                                              </div>
                                          </PopoverContent>
                                      </Popover>
                                  ))
                                : null}
                            {visibility.proxy ? (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            aria-label="Proxy settings"
                                            className={cn(
                                                '-ml-px h-6 w-7 rounded-none border-l',
                                                proxyServer
                                                    ? 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
                                                    : 'text-muted-foreground hover:text-muted-foreground'
                                            )}
                                            onClick={() => {
                                                void promptProxySettings().catch((error) => {
                                                    toast.error(error instanceof Error ? error.message : 'Failed to update proxy settings.');
                                                });
                                            }}>
                                            <NetworkIcon className="size-3.5" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs">
                                        {proxyServer ? `Proxy: ${proxyServer}` : 'Proxy disabled'}
                                    </TooltipContent>
                                </Tooltip>
                            ) : null}
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
