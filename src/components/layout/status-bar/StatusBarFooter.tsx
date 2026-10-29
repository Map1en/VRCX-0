import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

import { BackgroundModeButton } from './BackgroundModeButton';
import {
    DataDirMigrationSegment,
    FriendProfileLoadSegment,
    MutualGraphSegment,
    ProfileBackupSegment,
    WorldCollectionImportSegment
} from './BackgroundTaskSegments';
import {
    RealtimeConnectionSegment,
    ServersSegment
} from './ConnectionSegments';
import { DesktopWidgetToggle } from './DesktopWidgetToggle';
import { DoNotDisturbMenu } from './DoNotDisturbMenu';
import { GameIsolationToggle } from './GameIsolationToggle';
import {
    InstanceQueueSegment,
    SteamVrSegment,
    VrchatSegment
} from './GameSegments';
import { NowPlayingSegment } from './NowPlayingSegment';
import { OfflineRecordIndicator } from './OfflineRecordIndicator';
import { ProxySegment } from './ProxySegment';
import type { StatusBarFooterProps } from './statusBarTypes';
import { AppUptimeSegment, ClocksSegment } from './TimeSegments';
import { ZoomSegment } from './ZoomSegment';

export const StatusBarFooter = forwardRef<HTMLElement, StatusBarFooterProps>(
    function StatusBarFooter(
        {
            appStartedAt,
            className,
            clocks,
            proxyEditorOpen,
            sidebarWindowMode = false,
            visibility,
            onProxyEditorOpenChange,
            onUpdateClockTimezone,
            ...props
        },
        ref
    ) {
        const connections = (
            <>
                {sidebarWindowMode || visibility.servers ? (
                    <ServersSegment />
                ) : null}
                {sidebarWindowMode || visibility.ws ? (
                    <RealtimeConnectionSegment />
                ) : null}
            </>
        );

        const sessionActions = (
            <>
                <DoNotDisturbMenu />
                <GameIsolationToggle />
                <BackgroundModeButton />
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
                        <DesktopWidgetToggle />
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
                        {visibility.vrchat ? <VrchatSegment /> : null}
                        {visibility.steamvr ? <SteamVrSegment /> : null}
                        {visibility.instanceQueue ? (
                            <InstanceQueueSegment />
                        ) : null}
                        {visibility.nowPlaying ? <NowPlayingSegment /> : null}
                    </div>

                    <div className="text-muted-foreground flex shrink-0 items-center justify-end gap-1 overflow-hidden">
                        <DataDirMigrationSegment />
                        <ProfileBackupSegment />
                        <WorldCollectionImportSegment />
                        <FriendProfileLoadSegment />
                        <MutualGraphSegment />
                        {visibility.clocks ? (
                            <ClocksSegment
                                clocks={clocks}
                                onUpdateClockTimezone={onUpdateClockTimezone}
                            />
                        ) : null}
                        {visibility.zoom ? <ZoomSegment /> : null}
                        {visibility.uptime ? (
                            <AppUptimeSegment startedAtMs={appStartedAt} />
                        ) : null}
                        <DesktopWidgetToggle />
                        <OfflineRecordIndicator />
                        <ProxySegment
                            open={proxyEditorOpen}
                            onOpenChange={onProxyEditorOpenChange}
                        />
                        {sessionActions}
                    </div>
                </div>
            </footer>
        );
    }
);
