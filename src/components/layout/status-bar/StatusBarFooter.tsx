import {
    ClockIcon,
    Minimize2Icon,
    MinusIcon,
    NetworkIcon,
    PlusIcon
} from 'lucide-react';
import { forwardRef, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { ProxySettingsEditor } from '@/components/proxy/ProxySettingsEditor';
import { cn } from '@/lib/utils';
import {
    dataDirMigrationErrorKey,
    dataDirMigrationPhaseKey
} from '@/services/dataDirMigrationI18n';
import {
    profileBackupErrorKey,
    profileBackupPhaseKey
} from '@/services/profileBackupI18n';
import {
    DEFAULT_ZOOM_LEVEL,
    MAX_ZOOM_LEVEL,
    MIN_ZOOM_LEVEL,
    ZOOM_STEP
} from '@/shared/constants/themes';
import type { VrcStatusState } from '@/state/runtimeStore';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { DoNotDisturbMenu } from './DoNotDisturbMenu';
import {
    AppUptimeValue,
    ClockValue,
    DurationValue,
    NowPlayingProgress
} from './StatusBarFooterParts';
import { isFriendProfileLoadStatusVisible } from './statusBarFriendProfileLoad';
import { StatusDot, StatusSegment } from './StatusBarParts';
import { resolveProxyIndicatorState } from './statusBarProxy';
import { STATUS_BAR_TOGGLE_IDLE } from './statusBarToggle';
import type {
    StatusBarFooterProps,
    StatusBarFriendProfileLoad,
    StatusBarInstanceQueue,
    StatusBarMutualGraph
} from './statusBarTypes';

function formatFriendProfileLoadValue(
    friendProfileLoad: StatusBarFriendProfileLoad
) {
    const { processedFriends: processed, totalFriends: total } =
        friendProfileLoad;
    return total > 0 ? `${processed}/${total}` : '';
}

function formatFriendProfileLoadTooltip(
    friendProfileLoad: StatusBarFriendProfileLoad,
    t: ReturnType<typeof useTranslation>['t']
) {
    const status = friendProfileLoad.status;
    if (status === 'cancelled') {
        return t('view.friend_list.success.friend_detail_loading_cancelled');
    }
    if (status === 'cancelling') {
        return t('view.friend_list.description.cancelling');
    }
    return t('view.friend_list.loading.loading_friend_details');
}

function formatInstanceQueueValue(
    instanceQueue: StatusBarInstanceQueue,
    t: ReturnType<typeof useTranslation>['t']
) {
    const { position, queueSize } = instanceQueue;
    if (position > 0 && queueSize > 0) {
        return `${position}/${queueSize}`;
    }
    if (position > 0) {
        return t('status_bar.instance_queue_position', {
            position
        });
    }
    return t('status_bar.instance_queue_waiting');
}

function formatMutualGraphValue(mutualGraph: StatusBarMutualGraph) {
    const { processedFriends: processed, totalFriends: total } = mutualGraph;
    if (total > 0) {
        return `${processed}/${total}`;
    }
    return '';
}

function formatMutualGraphLabel(
    mutualGraph: StatusBarMutualGraph,
    t: ReturnType<typeof useTranslation>['t']
) {
    const {
        status,
        processedFriends: processed,
        totalFriends: total
    } = mutualGraph;
    if (
        status === 'running' ||
        status === 'cancelling' ||
        (status === 'completed' && total > 0 && processed >= total)
    ) {
        return t('status_bar.mutual_graph_fetching');
    }
    return t('status_bar.mutual_graph');
}

function formatMutualGraphTooltip(
    mutualGraph: StatusBarMutualGraph,
    t: ReturnType<typeof useTranslation>['t']
) {
    const status = mutualGraph.status;
    if (status === 'error') {
        const lastError = mutualGraph.lastError?.trim() ?? '';
        return (
            lastError ||
            t('view.charts.toast.failed_to_fetch_mutual_friends_graph')
        );
    }
    if (status === 'cancelled') {
        return t(
            'view.charts.label.mutual_graph_fetch_cancelled_the_cached_graph_was_not_replaced'
        );
    }
    return t('status_bar.mutual_graph_progress');
}

function formatVrcStatusTooltip(
    vrcStatus: Pick<
        VrcStatusState,
        'summary' | 'status' | 'refreshing' | 'error' | 'lastFetchedAt'
    >,
    t: ReturnType<typeof useTranslation>['t'],
    formatStatusDate: (value: string | null) => string
) {
    const status =
        vrcStatus.summary || vrcStatus.status || t('status_bar.servers_ok');
    return (
        <div className="flex flex-col gap-1 text-xs">
            <span>{status}</span>
            {vrcStatus.refreshing ? (
                <span className="text-muted-foreground">
                    {t('common.loading')}
                </span>
            ) : null}
            {vrcStatus.error ? (
                <span className="text-muted-foreground">{vrcStatus.error}</span>
            ) : null}
            {vrcStatus.lastFetchedAt ? (
                <span className="text-muted-foreground">
                    {formatStatusDate(vrcStatus.lastFetchedAt)}
                </span>
            ) : null}
        </div>
    );
}

export const StatusBarFooter = forwardRef<HTMLElement, StatusBarFooterProps>(
    function StatusBarFooter(
        { className, footer, sidebarWindowMode = false, ...props },
        ref
    ) {
        const {
            appStartedAt,
            clockPopoverOpen,
            currentLocationStartedTimestamp,
            currentWorld,
            dataDirMigration,
            gameStartedAt,
            isGameRunning,
            isSteamVRRunning,
            friendProfileLoad,
            instanceQueue,
            mutualGraph,
            nowPlaying,
            proxyEditor,
            profileBackup,
            proxyEnabled,
            proxyServer,
            runtimeGameState,
            runtimeTransport,
            timezoneOptions,
            visibility,
            visibleClocks,
            worldCollectionImport,
            vrcStatus,
            zoomLevel,
            zoomLabel,
            formatAppUptime,
            formatClock,
            formatDuration,
            formatStatusDate,
            onOpenMediaLink,
            onOpenStatusPage,
            onStartBackgroundMode,
            onProxyDraftEnabledChange,
            onProxyDraftServerChange,
            onProxyEditorOpenChange,
            onProxySave,
            onProxySaveAndRestart,
            onProxyTest,
            onSetClockPopoverValue,
            onSetZoomLevel,
            onStepZoomLevel,
            onUpdateClockTimezone
        } = footer;
        const { t } = useTranslation();
        const proxyAnchorRef = useRef<HTMLSpanElement>(null);
        const instanceQueueActive =
            instanceQueue.active && Boolean(instanceQueue.instanceLocation);
        const mutualGraphStatus = mutualGraph.status;
        const friendProfileLoadVisible = isFriendProfileLoadStatusVisible(
            friendProfileLoad.status
        );
        const mutualGraphVisible = [
            'running',
            'cancelling',
            'completed',
            'cancelled',
            'error'
        ].includes(mutualGraphStatus);
        const vrcStatusIndicator = vrcStatus.indicator;
        const vrcStatusHasIssue = Boolean(
            vrcStatusIndicator && vrcStatusIndicator !== 'none'
        );
        const vrcStatusIsMajor = ['major', 'critical'].includes(
            vrcStatusIndicator
        );
        const proxyIndicator = resolveProxyIndicatorState({
            enabled: proxyEnabled,
            server: proxyServer,
            hasNetworkIssue: Boolean(proxyEnabled && vrcStatus.error)
        });

        const connections = (
            <>
                <StatusSegment
                    visible={sidebarWindowMode || visibility.servers}
                    active={!vrcStatusHasIssue}
                    dotClassName={cn(
                        vrcStatus.refreshing && 'motion-safe:animate-pulse',
                        vrcStatusHasIssue
                            ? vrcStatusIsMajor
                                ? 'bg-[var(--status-busy)]'
                                : 'bg-[var(--status-askme)]'
                            : undefined
                    )}
                    label={t('status_bar.servers')}
                    className="cursor-pointer"
                    onClick={() => {
                        onOpenStatusPage();
                    }}
                    tooltip={formatVrcStatusTooltip(
                        vrcStatus,
                        t,
                        formatStatusDate
                    )}
                />
                {sidebarWindowMode || visibility.ws ? (
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <div className="flex h-6 shrink-0 items-center gap-1.5 px-2">
                                    <StatusDot
                                        active={Boolean(
                                            runtimeTransport.websocketConnected
                                        )}
                                    />
                                    <span className="text-content-tertiary text-xs">
                                        {t('status_bar.realtime_connection')}
                                    </span>
                                </div>
                            }
                        />
                        <TooltipContent className="flex max-w-xs flex-col gap-1 text-xs">
                            <span>
                                WebSocket{' '}
                                {runtimeTransport.websocketConnected
                                    ? t('status_bar.ws_connected')
                                    : t('status_bar.ws_disconnected')}
                            </span>
                        </TooltipContent>
                    </Tooltip>
                ) : null}
            </>
        );

        const sessionActions = (
            <>
                <DoNotDisturbMenu />
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={t(
                                    'status_bar.start_background_mode'
                                )}
                                className={cn(
                                    'size-6 shrink-0 rounded-none',
                                    STATUS_BAR_TOGGLE_IDLE
                                )}
                                onClick={onStartBackgroundMode}
                            >
                                <Minimize2Icon data-icon="icon" />
                            </Button>
                        }
                    />
                    <TooltipContent>
                        {t('status_bar.start_background_mode_tooltip')}
                    </TooltipContent>
                </Tooltip>
            </>
        );

        if (sidebarWindowMode) {
            return (
                <footer
                    ref={ref}
                    data-vrcx-0-surface="statusbar"
                    className={cn(
                        'vrcx-0-statusbar flex h-8 shrink-0 items-center border-t px-2 text-xs',
                        className
                    )}
                    {...props}
                >
                    {connections}
                    <div className="ml-auto flex shrink-0 items-center">
                        {sessionActions}
                    </div>
                </footer>
            );
        }

        return (
            <footer
                ref={ref}
                data-vrcx-0-surface="statusbar"
                className={cn(
                    'vrcx-0-statusbar @container/statusbar text-xs backdrop-blur',
                    className
                )}
                {...props}
            >
                <div className="flex min-h-6 flex-col gap-1 overflow-hidden @2xl/statusbar:flex-row @2xl/statusbar:items-center @2xl/statusbar:justify-between">
                    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                        {connections}
                        <StatusSegment
                            visible={visibility.vrchat}
                            active={Boolean(isGameRunning)}
                            dimWhenInactive
                            label="VRChat"
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
                                                        formatter={
                                                            formatDuration
                                                        }
                                                        startAtMs={
                                                            gameStartedAt
                                                        }
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
                                                        formatter={
                                                            formatDuration
                                                        }
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
                            visible={visibility.steamvr}
                            active={Boolean(isSteamVRRunning)}
                            dimWhenInactive
                            label="SteamVR"
                        />
                        <StatusSegment
                            visible={
                                visibility.instanceQueue && instanceQueueActive
                            }
                            active
                            warn
                            label={t('status_bar.instance_queue')}
                            value={formatInstanceQueueValue(instanceQueue, t)}
                            tooltip={
                                <div className="flex flex-col gap-1 text-xs">
                                    {instanceQueue.label ? (
                                        <div className="text-muted-foreground max-w-64 truncate">
                                            {instanceQueue.label}
                                        </div>
                                    ) : null}
                                    <div className="flex justify-between gap-4">
                                        <span className="text-muted-foreground">
                                            {t(
                                                'status_bar.instance_queue_position_label'
                                            )}
                                        </span>
                                        <span>
                                            {formatInstanceQueueValue(
                                                instanceQueue,
                                                t
                                            )}
                                        </span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                        <span className="text-muted-foreground">
                                            {t(
                                                'app_menu.label.last_game_event'
                                            )}
                                        </span>
                                        <span>
                                            {formatStatusDate(
                                                instanceQueue.updatedAt
                                            )}
                                        </span>
                                    </div>
                                </div>
                            }
                        />
                        <StatusSegment
                            visible={
                                visibility.nowPlaying && Boolean(nowPlaying.url)
                            }
                            active
                            label={t('status_bar.now_playing')}
                            value={nowPlaying.name || nowPlaying.url}
                            onClick={onOpenMediaLink}
                            className="max-w-96 shrink overflow-hidden"
                        >
                            <NowPlayingProgress
                                formatter={formatDuration}
                                nowPlaying={nowPlaying}
                            />
                        </StatusSegment>
                    </div>

                    <div className="text-muted-foreground flex shrink-0 items-center justify-end gap-1 overflow-hidden">
                        <StatusSegment
                            visible={
                                dataDirMigration.status.state === 'running' ||
                                dataDirMigration.status.state ===
                                    'cancelling' ||
                                dataDirMigration.status.state === 'error'
                            }
                            active={dataDirMigration.status.state === 'running'}
                            warn={dataDirMigration.status.state === 'error'}
                            showDot={false}
                            label={
                                dataDirMigration.status.state === 'error'
                                    ? t('data_dir_migration.error_short')
                                    : t(
                                          dataDirMigrationPhaseKey(
                                              dataDirMigration.status.phase
                                          )
                                      )
                            }
                            value={
                                dataDirMigration.status.percent !== null &&
                                dataDirMigration.status.percent !== undefined
                                    ? `${dataDirMigration.status.percent}%`
                                    : undefined
                            }
                            tooltip={
                                dataDirMigration.status.error
                                    ? t(
                                          dataDirMigrationErrorKey(
                                              dataDirMigration.status.error.code
                                          )
                                      )
                                    : undefined
                            }
                            className="text-muted-foreground"
                            labelClassName={
                                dataDirMigration.status.state === 'error'
                                    ? 'text-destructive'
                                    : undefined
                            }
                        />
                        <StatusSegment
                            visible={profileBackup.status.state !== 'idle'}
                            active={profileBackup.status.state === 'running'}
                            warn={
                                profileBackup.status.state === 'retryable' ||
                                profileBackup.status.state === 'error'
                            }
                            showDot={false}
                            label={t(
                                profileBackup.status.state === 'running'
                                    ? profileBackupPhaseKey(
                                          profileBackup.status
                                      )
                                    : profileBackup.status.state === 'retryable'
                                      ? 'profile_backup.retryable_short'
                                      : 'profile_backup.error_short'
                            )}
                            value={
                                profileBackup.status.state === 'running' &&
                                profileBackup.status.percent !== null
                                    ? `${profileBackup.status.percent}%`
                                    : undefined
                            }
                            tooltip={
                                profileBackup.status.error
                                    ? t(
                                          profileBackupErrorKey(
                                              profileBackup.status.error.code
                                          )
                                      )
                                    : undefined
                            }
                            onClick={
                                profileBackup.status.state === 'retryable' ||
                                profileBackup.status.state === 'error'
                                    ? profileBackup.onOpenDetails
                                    : undefined
                            }
                            className="text-muted-foreground"
                            labelClassName={
                                profileBackup.status.state === 'retryable' ||
                                profileBackup.status.state === 'error'
                                    ? 'text-destructive'
                                    : undefined
                            }
                            valueClassName="text-muted-foreground"
                        />
                        <StatusSegment
                            visible={worldCollectionImport.active}
                            showDot={false}
                            label={t('status_bar.world_collection_importing', {
                                progress: worldCollectionImport.progress,
                                total: worldCollectionImport.total
                            })}
                            className="text-muted-foreground"
                        />
                        <StatusSegment
                            visible={friendProfileLoadVisible}
                            showDot={false}
                            label={t(
                                friendProfileLoad.status === 'cancelling'
                                    ? 'view.friend_list.description.cancelling'
                                    : 'view.friend_list.loading.loading_friend_details'
                            )}
                            value={formatFriendProfileLoadValue(
                                friendProfileLoad
                            )}
                            tooltip={formatFriendProfileLoadTooltip(
                                friendProfileLoad,
                                t
                            )}
                            className="text-muted-foreground"
                            valueClassName="text-muted-foreground"
                        />
                        <StatusSegment
                            visible={
                                visibility.mutualGraph && mutualGraphVisible
                            }
                            showDot={false}
                            label={formatMutualGraphLabel(mutualGraph, t)}
                            value={formatMutualGraphValue(mutualGraph)}
                            tooltip={formatMutualGraphTooltip(mutualGraph, t)}
                            className="text-muted-foreground"
                            valueClassName="text-muted-foreground"
                        />
                        {visibility.clocks
                            ? visibleClocks.map((clock, index) => (
                                  <Popover
                                      key={`${clock.offset}-${index}`}
                                      open={Boolean(clockPopoverOpen[index])}
                                      onOpenChange={(open) =>
                                          onSetClockPopoverValue(index, open)
                                      }
                                  >
                                      <PopoverTrigger
                                          render={
                                              <Button
                                                  type="button"
                                                  variant="ghost"
                                                  size="sm"
                                                  className="text-muted-foreground hover:text-muted-foreground h-6 gap-1.5 rounded-none px-2 text-xs font-normal tabular-nums"
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
                                          }
                                      />
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
                                                  items={timezoneOptions.map(
                                                      (option) => ({
                                                          value: String(
                                                              option.value
                                                          ),
                                                          label: option.label
                                                      })
                                                  )}
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
                            <Popover>
                                <PopoverTrigger
                                    render={
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            aria-label={t(
                                                'status_bar.zoom_tooltip'
                                            )}
                                            className="text-muted-foreground hover:text-muted-foreground h-6 gap-1.5 rounded-none px-2 text-xs font-normal"
                                        >
                                            <span className="text-muted-foreground">
                                                {t('status_bar.zoom')}
                                            </span>
                                            <span className="text-muted-foreground tabular-nums">
                                                {zoomLabel}
                                            </span>
                                        </Button>
                                    }
                                />
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
                                            className="size-10 shrink-0"
                                            disabled={
                                                zoomLevel <= MIN_ZOOM_LEVEL
                                            }
                                            onClick={() =>
                                                onStepZoomLevel(-ZOOM_STEP)
                                            }
                                        >
                                            <MinusIcon data-icon="icon" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            aria-label={t(
                                                'app_menu.reset_zoom'
                                            )}
                                            className="h-10 min-w-0 flex-1 gap-2 px-3"
                                            onClick={() =>
                                                onSetZoomLevel(
                                                    DEFAULT_ZOOM_LEVEL
                                                )
                                            }
                                        >
                                            <span className="text-sm font-medium tabular-nums">
                                                {zoomLabel}
                                            </span>
                                            <span className="text-muted-foreground truncate text-xs font-normal">
                                                {t('app_menu.reset_zoom')}
                                            </span>
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            aria-label={t('app_menu.zoom_in')}
                                            className="size-10 shrink-0"
                                            disabled={
                                                zoomLevel >= MAX_ZOOM_LEVEL
                                            }
                                            onClick={() =>
                                                onStepZoomLevel(ZOOM_STEP)
                                            }
                                        >
                                            <PlusIcon data-icon="icon" />
                                        </Button>
                                    </div>
                                </PopoverContent>
                            </Popover>
                        ) : null}
                        {visibility.uptime ? (
                            <Tooltip>
                                <TooltipTrigger
                                    render={
                                        <div className="flex h-6 items-center gap-1.5 px-2">
                                            <span className="text-muted-foreground">
                                                {t(
                                                    'status_bar.app_uptime_short'
                                                )}
                                            </span>
                                            <span className="text-muted-foreground tabular-nums">
                                                <AppUptimeValue
                                                    formatter={formatAppUptime}
                                                    startedAtMs={appStartedAt}
                                                />
                                            </span>
                                        </div>
                                    }
                                />
                                <TooltipContent>
                                    {t('status_bar.app_uptime')}
                                </TooltipContent>
                            </Tooltip>
                        ) : null}
                        {proxyEnabled ? (
                            <Popover
                                open={proxyEditor.open}
                                onOpenChange={onProxyEditorOpenChange}
                            >
                                <span
                                    ref={proxyAnchorRef}
                                    className="inline-flex h-6 shrink-0"
                                >
                                    <Tooltip>
                                        <TooltipTrigger
                                            render={
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label={t(
                                                        'status_bar.proxy'
                                                    )}
                                                    className={cn(
                                                        'size-6 rounded-none',
                                                        proxyIndicator.className
                                                    )}
                                                    onClick={() =>
                                                        onProxyEditorOpenChange(
                                                            true
                                                        )
                                                    }
                                                >
                                                    <NetworkIcon data-icon="icon" />
                                                </Button>
                                            }
                                        />
                                        <TooltipContent className="max-w-xs">
                                            {t(
                                                proxyIndicator.tooltipKey,
                                                proxyIndicator.tooltipValues
                                            )}
                                        </TooltipContent>
                                    </Tooltip>
                                </span>
                                <PopoverContent
                                    side="top"
                                    align="end"
                                    anchor={proxyAnchorRef}
                                    className="w-96"
                                >
                                    <PopoverHeader>
                                        <PopoverTitle>
                                            {t('prompt.proxy_settings.header')}
                                        </PopoverTitle>
                                        <PopoverDescription>
                                            {t(
                                                'prompt.proxy_settings.description'
                                            )}
                                        </PopoverDescription>
                                    </PopoverHeader>
                                    <ProxySettingsEditor
                                        enabled={proxyEditor.enabled}
                                        idPrefix="status-bar-proxy-settings"
                                        saving={proxyEditor.saving}
                                        server={proxyEditor.server}
                                        testing={proxyEditor.testing}
                                        onEnabledChange={
                                            onProxyDraftEnabledChange
                                        }
                                        onSave={onProxySave}
                                        onSaveAndRestart={onProxySaveAndRestart}
                                        onServerChange={
                                            onProxyDraftServerChange
                                        }
                                        onTest={onProxyTest}
                                    />
                                </PopoverContent>
                            </Popover>
                        ) : null}
                        {sessionActions}
                    </div>
                </div>
            </footer>
        );
    }
);
