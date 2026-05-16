// @ts-nocheck
import { ClockIcon, MinusIcon, NetworkIcon, PlusIcon } from 'lucide-react';
import { forwardRef, useEffect, useState } from 'react';

import { cn } from '@/lib/utils.js';
import {
    MAX_ZOOM_LEVEL,
    MIN_ZOOM_LEVEL,
    ZOOM_STEP
} from '@/services/themeService.js';
import { Button } from '@/ui/shadcn/button';
import {
    Popover,
    PopoverContent,
    PopoverDescription,
    PopoverHeader,
    PopoverTitle,
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
import { Slider } from '@/ui/shadcn/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { StatusDot, StatusSegment } from './StatusBarParts';

let tickerNowMs = Date.now();
let tickerTimer = null;
const tickerListeners = new Set();

function emitTicker() {
    tickerNowMs = Date.now();
    for (const listener of tickerListeners) {
        listener(tickerNowMs);
    }
}

function subscribeStatusTicker(listener) {
    tickerListeners.add(listener);
    if (tickerTimer === null) {
        tickerTimer = window.setInterval(emitTicker, 1000);
    }

    return () => {
        tickerListeners.delete(listener);
        if (tickerListeners.size === 0 && tickerTimer !== null) {
            window.clearInterval(tickerTimer);
            tickerTimer = null;
        }
    };
}

function useStatusNowMs(active = true) {
    const [nowMs, setNowMs] = useState(() => tickerNowMs);

    useEffect(() => {
        if (!active) {
            return undefined;
        }
        setNowMs(tickerNowMs);
        return subscribeStatusTicker(setNowMs);
    }, [active]);

    return nowMs;
}

function DurationValue({ active, formatter, startAtMs }) {
    const normalizedStartAt = Number(startAtMs);
    const enabled =
        active &&
        Number.isFinite(normalizedStartAt) &&
        normalizedStartAt > 0;
    const nowMs = useStatusNowMs(enabled);

    if (!enabled) {
        return '-';
    }

    return formatter(nowMs - normalizedStartAt);
}

function AppUptimeValue({ formatter, startedAtMs }) {
    const nowMs = useStatusNowMs(true);
    return formatter(nowMs - startedAtMs);
}

function ClockValue({ formatter, offset }) {
    const nowMs = useStatusNowMs(true);
    return formatter(nowMs, offset);
}

function NowPlayingProgress({ formatter, nowPlaying }) {
    const hasLength = Boolean(nowPlaying.length);
    const nowMs = useStatusNowMs(
        hasLength && Boolean(nowPlaying.startedAt)
    );
    if (!hasLength) {
        return null;
    }

    const elapsedSeconds = nowPlaying.startedAt
        ? Math.max(
              0,
              Math.floor((nowMs - Date.parse(nowPlaying.startedAt)) / 1000) +
                  Number(nowPlaying.position || 0)
          )
        : Number(nowPlaying.position || 0);

    return (
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {`${formatter(elapsedSeconds * 1000)} / ${formatter(Number(nowPlaying.length) * 1000)}`}
        </span>
    );
}

export const StatusBarFooter = forwardRef(function StatusBarFooter(
    { className, helpers, handlers, state, t, ...props },
    ref
) {
    const {
        appStartedAt,
        clockPopoverOpen,
        currentLocationStartedTimestamp,
        currentWorld,
        gameStartedAt,
        isGameRunning,
        isSteamVRRunning,
        nowPlaying,
        proxyServer,
        runtimeGameState,
        runtimeTransport,
        timezoneOptions,
        visibility,
        visibleClocks,
        vrcStatus,
        zoomLevel,
        zoomLabel
    } = state;
    const { formatClock, formatDuration, formatStatusDate, formatAppUptime } =
        helpers;
    const {
        onOpenMediaLink,
        onOpenStatusPage,
        onPromptProxySettings,
        onSetZoomLevel,
        onStepZoomLevel,
        onSetClockPopoverValue,
        onUpdateClockTimezone
    } = handlers;
    const [zoomPopoverOpen, setZoomPopoverOpen] = useState(false);

    useEffect(() => {
        if (!zoomPopoverOpen) {
            return undefined;
        }

        function handleZoomWheel(event) {
            if (event.deltaY === 0) {
                return;
            }

            event.preventDefault();
            onStepZoomLevel(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
        }

        window.addEventListener('wheel', handleZoomWheel, {
            passive: false,
            capture: true
        });

        return () => {
            window.removeEventListener('wheel', handleZoomWheel, true);
        };
    }, [onStepZoomLevel, zoomPopoverOpen]);

    return (
        <footer
            ref={ref}
            className={cn(
                'bg-background/95 border-t text-xs backdrop-blur',
                className
            )}
            {...props}
        >
            <div className="flex min-h-7 flex-col gap-1 overflow-hidden lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 flex-1 items-center overflow-hidden">
                    <StatusSegment
                        visible={visibility.steamvr}
                        active={Boolean(isSteamVRRunning)}
                        label={t('status_bar.steamvr')}
                    />
                    <StatusSegment
                        visible={visibility.vrchat}
                        active={Boolean(isGameRunning)}
                        label={t(
                            'view.settings.advanced.advanced.vrchat_settings.header'
                        )}
                        tooltip={
                            <div className="flex flex-col gap-1 text-xs">
                                {isGameRunning ? (
                                    <>
                                        <div className="flex justify-between gap-4">
                                            <span className="text-muted-foreground">
                                                {t(
                                                    'app_menu.label.started_at'
                                                )}
                                            </span>
                                            <span>
                                                {formatStatusDate(
                                                    runtimeGameState.lastGameStartedAt
                                                )}
                                            </span>
                                        </div>
                                        <div className="flex justify-between gap-4">
                                            <span className="text-muted-foreground">
                                                {t(
                                                    'app_menu.label.session_duration'
                                                )}
                                            </span>
                                            <span>
                                                <DurationValue
                                                    active={isGameRunning}
                                                    formatter={formatDuration}
                                                    startAtMs={gameStartedAt}
                                                />
                                            </span>
                                        </div>
                                        <div className="flex justify-between gap-4">
                                            <span className="text-muted-foreground">
                                                {t(
                                                    'app_menu.label.instance_duration'
                                                )}
                                            </span>
                                            <span>
                                                <DurationValue
                                                    active={isGameRunning}
                                                    formatter={formatDuration}
                                                    startAtMs={
                                                        currentLocationStartedTimestamp
                                                    }
                                                />
                                            </span>
                                        </div>
                                        {currentWorld ? (
                                            <div className="text-muted-foreground max-w-64 truncate">
                                                {currentWorld}
                                            </div>
                                        ) : null}
                                    </>
                                ) : (
                                    <>
                                        <div className="flex justify-between gap-4">
                                            <span className="text-muted-foreground">
                                                {t(
                                                    'app_menu.label.last_game_event'
                                                )}
                                            </span>
                                            <span>
                                                {formatStatusDate(
                                                    runtimeGameState.lastGameLogAt
                                                )}
                                            </span>
                                        </div>
                                        <div className="flex justify-between gap-4">
                                            <span className="text-muted-foreground">
                                                {t(
                                                    'app_menu.label.last_event_type'
                                                )}
                                            </span>
                                            <span>
                                                {runtimeGameState.lastGameLogType ||
                                                    '-'}
                                            </span>
                                        </div>
                                    </>
                                )}
                            </div>
                        }
                    />
                    <StatusSegment
                        visible={visibility.servers}
                        active={
                            !vrcStatus.indicator ||
                            vrcStatus.indicator === 'none'
                        }
                        warn={
                            vrcStatus.indicator &&
                            vrcStatus.indicator !== 'none'
                        }
                        label={t('status_bar.servers')}
                        onClick={() => void onOpenStatusPage()}
                        tooltip={
                            vrcStatus.summary ||
                            vrcStatus.status ||
                            'VRChat status'
                        }
                    />
                    {visibility.ws ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="-ml-px flex h-6 items-center gap-1.5 border-x px-2">
                                    <StatusDot
                                        active={Boolean(
                                            runtimeTransport.websocketConnected
                                        )}
                                    />
                                    <span className="text-muted-foreground text-xs">
                                        {t('status_bar.realtime_connection')}
                                    </span>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent className="flex max-w-xs flex-col gap-1 text-xs">
                                <span>
                                    {t('view.login.field.websocket')}{' '}
                                    {runtimeTransport.websocketConnected
                                        ? t('status_bar.ws_connected')
                                        : t('status_bar.ws_disconnected')}
                                </span>
                            </TooltipContent>
                        </Tooltip>
                    ) : null}
                    <StatusSegment
                        visible={
                            visibility.nowPlaying && Boolean(nowPlaying.url)
                        }
                        active
                        label={t('status_bar.now_playing')}
                        value={nowPlaying.name || nowPlaying.url}
                        onClick={onOpenMediaLink}
                    >
                        <NowPlayingProgress
                            formatter={formatDuration}
                            nowPlaying={nowPlaying}
                        />
                    </StatusSegment>
                </div>

                <div className="flex shrink-0 items-center justify-end overflow-hidden">
                    {visibility.clocks
                        ? visibleClocks.map((clock, index) => (
                              <Popover
                                  key={`${clock.offset}-${index}`}
                                  open={Boolean(clockPopoverOpen[index])}
                                  onOpenChange={(open) =>
                                      onSetClockPopoverValue(index, open)
                                  }
                              >
                                  <PopoverTrigger asChild>
                                      <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 gap-1.5 rounded-none border-r px-2 text-xs font-normal tabular-nums"
                                      >
                                          <ClockIcon
                                              data-icon="inline-start"
                                              className="text-muted-foreground"
                                          />
                                          <ClockValue
                                              formatter={formatClock}
                                              offset={clock.offset}
                                          />
                                      </Button>
                                  </PopoverTrigger>
                                  <PopoverContent
                                      side="top"
                                      align="center"
                                      className="w-72"
                                  >
                                      <div className="flex flex-col gap-2 p-1">
                                          <label className="text-xs font-medium">
                                              {t('status_bar.timezone')}
                                          </label>
                                          <Select
                                              value={String(clock.offset)}
                                              onValueChange={(offset) =>
                                                  onUpdateClockTimezone(
                                                      index,
                                                      offset
                                                  )
                                              }
                                          >
                                              <SelectTrigger
                                                  size="sm"
                                                  className="w-full"
                                              >
                                                  <SelectValue
                                                      placeholder={t(
                                                          'status_bar.timezone'
                                                      )}
                                                  />
                                              </SelectTrigger>
                                              <SelectContent className="max-h-60">
                                                  <SelectGroup>
                                                      {timezoneOptions.map(
                                                          (option) => (
                                                              <SelectItem
                                                                  key={
                                                                      option.value
                                                                  }
                                                                  value={String(
                                                                      option.value
                                                                  )}
                                                              >
                                                                  <span className="w-full text-right font-mono">
                                                                      {
                                                                          option.label
                                                                      }
                                                                  </span>
                                                              </SelectItem>
                                                          )
                                                      )}
                                                  </SelectGroup>
                                              </SelectContent>
                                          </Select>
                                      </div>
                                  </PopoverContent>
                              </Popover>
                          ))
                        : null}
                    {visibility.zoom ? (
                        <Popover
                            open={zoomPopoverOpen}
                            onOpenChange={setZoomPopoverOpen}
                        >
                            <PopoverTrigger asChild>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    aria-label={t('status_bar.zoom_tooltip')}
                                    className="h-6 gap-1.5 rounded-none border-r px-2 text-xs font-normal"
                                >
                                    <span className="text-muted-foreground">
                                        {t('status_bar.zoom')}
                                    </span>
                                    <span className="tabular-nums">
                                        {zoomLabel}
                                    </span>
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent
                                side="top"
                                align="end"
                                className="w-72"
                            >
                                <PopoverHeader>
                                    <PopoverTitle>
                                        {t('status_bar.zoom')}
                                    </PopoverTitle>
                                    <PopoverDescription>
                                        {t('status_bar.zoom_tooltip')}
                                    </PopoverDescription>
                                </PopoverHeader>
                                <div className="flex items-center gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        aria-label={t('app_menu.zoom_out')}
                                        className="size-7 shrink-0"
                                        disabled={zoomLevel <= MIN_ZOOM_LEVEL}
                                        onClick={() =>
                                            onStepZoomLevel(-ZOOM_STEP)
                                        }
                                    >
                                        <MinusIcon data-icon="icon" />
                                    </Button>
                                    <div className="bg-muted/40 flex min-w-16 justify-center rounded-md border px-2 py-1 text-sm font-medium tabular-nums">
                                        {zoomLabel}
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        aria-label={t('app_menu.zoom_in')}
                                        className="size-7 shrink-0"
                                        disabled={zoomLevel >= MAX_ZOOM_LEVEL}
                                        onClick={() =>
                                            onStepZoomLevel(ZOOM_STEP)
                                        }
                                    >
                                        <PlusIcon data-icon="icon" />
                                    </Button>
                                </div>
                                <Slider
                                    aria-label={t('status_bar.zoom')}
                                    min={MIN_ZOOM_LEVEL}
                                    max={MAX_ZOOM_LEVEL}
                                    step={ZOOM_STEP}
                                    value={[zoomLevel]}
                                    onValueChange={(value) =>
                                        onSetZoomLevel(value[0])
                                    }
                                />
                                <div className="text-muted-foreground flex justify-between text-[11px] tabular-nums">
                                    <span>{`${MIN_ZOOM_LEVEL}%`}</span>
                                    <span>{`${MAX_ZOOM_LEVEL}%`}</span>
                                </div>
                            </PopoverContent>
                        </Popover>
                    ) : null}
                    {visibility.uptime ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="-ml-px flex h-6 items-center gap-1.5 border-r px-2">
                                    <span className="text-muted-foreground">
                                        {t('status_bar.app_uptime_short')}
                                    </span>
                                    <span className="tabular-nums">
                                        <AppUptimeValue
                                            formatter={formatAppUptime}
                                            startedAtMs={appStartedAt}
                                        />
                                    </span>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                {t('status_bar.app_uptime')}
                            </TooltipContent>
                        </Tooltip>
                    ) : null}
                    {visibility.proxy && proxyServer ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Proxy settings"
                                    className={cn(
                                        '-ml-px h-6 w-7 rounded-none border-l',
                                        'border-primary/30 bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary'
                                    )}
                                    onClick={onPromptProxySettings}
                                >
                                    <NetworkIcon data-icon="icon" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                                {`Proxy: ${proxyServer}`}
                            </TooltipContent>
                        </Tooltip>
                    ) : null}
                </div>
            </div>
        </footer>
    );
});
