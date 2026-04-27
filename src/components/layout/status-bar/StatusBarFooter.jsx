import { ClockIcon, NetworkIcon } from 'lucide-react';
import { forwardRef } from 'react';

import { cn } from '@/lib/utils.js';
import { Button } from '@/ui/shadcn/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { StatusDot, StatusSegment } from './StatusBarParts.jsx';

export const StatusBarFooter = forwardRef(function StatusBarFooter(
    { className, helpers, handlers, state, t, ...props },
    ref
) {
    const {
        appUptime,
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
        vrcStatus,
        zoomLabel
    } = state;
    const { formatClock, formatStatusDate } = helpers;
    const {
        onOpenMediaLink,
        onOpenStatusPage,
        onPromptProxySettings,
        onPromptZoomSettings,
        onSetClockPopoverValue,
        onUpdateClockTimezone
    } = handlers;

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
                        label={t('view.settings.advanced.advanced.vrchat_settings.header')}
                        tooltip={
                            <div className="flex flex-col gap-1 text-xs">
                                {isGameRunning ? (
                                    <>
                                        <div className="flex justify-between gap-4">
                                            <span className="text-muted-foreground">
                                                {t('app_menu.generated.started_at')}
                                            </span>
                                            <span>
                                                {formatStatusDate(
                                                    runtimeGameState.lastGameStartedAt
                                                )}
                                            </span>
                                        </div>
                                        <div className="flex justify-between gap-4">
                                            <span className="text-muted-foreground">
                                                {t('app_menu.generated.session_duration')}
                                            </span>
                                            <span>{gameDuration || '-'}</span>
                                        </div>
                                        <div className="flex justify-between gap-4">
                                            <span className="text-muted-foreground">
                                                {t('app_menu.generated.instance_duration')}
                                            </span>
                                            <span>
                                                {currentLocationDuration || '-'}
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
                                                {t('app_menu.generated.last_game_event')}
                                            </span>
                                            <span>
                                                {formatStatusDate(
                                                    runtimeGameState.lastGameLogAt
                                                )}
                                            </span>
                                        </div>
                                        <div className="flex justify-between gap-4">
                                            <span className="text-muted-foreground">
                                                {t('app_menu.generated.last_event_type')}
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
                            !vrcStatus.indicator || vrcStatus.indicator === 'none'
                        }
                        warn={
                            vrcStatus.indicator && vrcStatus.indicator !== 'none'
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
                                <span className="text-muted-foreground">
                                    {t('status_bar.ws_avg_per_minute', {
                                        count: messagesPerMinute
                                    })}
                                </span>
                            </TooltipContent>
                        </Tooltip>
                    ) : null}
                    <StatusSegment
                        visible={visibility.nowPlaying && Boolean(nowPlaying.url)}
                        active
                        label={t('status_bar.now_playing')}
                        value={nowPlaying.name || nowPlaying.url}
                        onClick={onOpenMediaLink}
                    >
                        {nowPlayingProgress ? (
                            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
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
                                          {formatClock(nowMs, clock.offset)}
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
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 gap-1.5 rounded-none border-r px-2 text-xs font-normal"
                                    onClick={onPromptZoomSettings}
                                >
                                    <span className="text-muted-foreground">
                                        {t('status_bar.zoom')}
                                    </span>
                                    <span className="tabular-nums">
                                        {zoomLabel}
                                    </span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                {t('status_bar.zoom_tooltip')}
                            </TooltipContent>
                        </Tooltip>
                    ) : null}
                    {visibility.uptime ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="-ml-px flex h-6 items-center gap-1.5 border-r px-2">
                                    <span className="text-muted-foreground">
                                        {t('status_bar.app_uptime_short')}
                                    </span>
                                    <span className="tabular-nums">
                                        {appUptime}
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
