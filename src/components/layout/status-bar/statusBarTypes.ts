import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import type { ProfileBackupStatus } from '@/services/profileBackupService';
import type { VrcStatusState } from '@/state/runtimeStore';

export type StatusBarVisibilityKey =
    | 'vrchat'
    | 'steamvr'
    | 'proxy'
    | 'ws'
    | 'instanceQueue'
    | 'mutualGraph'
    | 'nowPlaying'
    | 'uptime'
    | 'zoom'
    | 'clocks'
    | 'servers';

export type StatusBarVisibility = Record<StatusBarVisibilityKey, boolean>;

export type StatusBarClock = {
    offset: number;
};

export type StatusBarTimezoneOption = {
    value: number;
    label: string;
};

export type StatusBarInstanceQueue = {
    active?: unknown;
    instanceLocation?: unknown;
    label?: ReactNode;
    position?: unknown;
    queueSize?: unknown;
    updatedAt?: unknown;
};

export type StatusBarMutualGraph = {
    cancelRequested?: unknown;
    failedFriends?: unknown;
    lastError?: unknown;
    processedFriends?: unknown;
    runId?: unknown;
    status?: unknown;
    totalFriends?: unknown;
};

export type StatusBarFriendProfileLoad = {
    processedFriends?: unknown;
    status?: unknown;
    totalFriends?: unknown;
};

export type StatusBarWorldCollectionImport = {
    active: boolean;
    progress: number;
    total: number;
};

export type StatusBarProfileBackup = {
    status: ProfileBackupStatus;
    onOpenDetails: () => unknown;
};

export type StatusBarNowPlaying = {
    length?: unknown;
    name?: string | null;
    position?: unknown;
    startedAt?: string | null;
    url?: string | null;
};

export type StatusBarRuntimeGameState = {
    currentLocationStartedAt?: string | null;
    currentWorldId?: string | null;
    currentWorldName?: string | null;
    lastGameLogAt?: string | null;
    lastGameLogType?: string | null;
    lastGameStartedAt?: string | null;
};

export type StatusBarRuntimeTransport = {
    websocketConnected?: boolean | null;
};

export type StatusBarProxyEditorState = {
    enabled: boolean;
    open: boolean;
    saving: boolean;
    server: string;
    testing: boolean;
};

export type StatusBarFooterModel = {
    appStartedAt: number;
    clockPopoverOpen: boolean[];
    currentLocationStartedTimestamp: number;
    currentWorld: string;
    formatAppUptime: (ms: number) => string;
    formatClock: (nowMs: number, offset: unknown) => string;
    formatDuration: (ms: unknown) => string;
    formatStatusDate: (value: unknown) => string;
    gameStartedAt: number;
    instanceQueue: StatusBarInstanceQueue;
    isGameRunning: boolean | null;
    isSteamVRRunning: boolean | null;
    friendProfileLoad: StatusBarFriendProfileLoad;
    mutualGraph: StatusBarMutualGraph;
    nowPlaying: StatusBarNowPlaying;
    onOpenMediaLink: () => unknown;
    onOpenStatusPage: () => unknown;
    onProxyDraftEnabledChange: (enabled: boolean) => unknown;
    onProxyDraftServerChange: (server: string) => unknown;
    onProxyEditorOpenChange: (open: boolean) => unknown;
    onProxySave: () => unknown;
    onProxySaveAndRestart: () => unknown;
    onProxyTest: () => unknown;
    onSetClockPopoverValue: (index: number, open: boolean) => unknown;
    onSetZoomLevel: (nextZoom: number) => unknown;
    onStartBackgroundMode: () => unknown;
    onStepZoomLevel: (delta: number) => unknown;
    onUpdateClockTimezone: (index: number, offsetValue: unknown) => unknown;
    proxyEditor: StatusBarProxyEditorState;
    profileBackup: StatusBarProfileBackup;
    proxyEnabled: boolean;
    proxyServer: string;
    runtimeGameState: StatusBarRuntimeGameState;
    runtimeTransport: StatusBarRuntimeTransport;
    timezoneOptions: StatusBarTimezoneOption[];
    visibility: StatusBarVisibility;
    visibleClocks: StatusBarClock[];
    worldCollectionImport: StatusBarWorldCollectionImport;
    vrcStatus: Pick<
        VrcStatusState,
        'summary' | 'status' | 'refreshing' | 'error' | 'lastFetchedAt'
    > & {
        indicator?: unknown;
    };
    zoomLabel: string;
    zoomLevel: number;
};

export type StatusBarFooterProps = ComponentPropsWithoutRef<'footer'> & {
    footer: StatusBarFooterModel;
};

export type StatusFormatterProps = {
    formatter: (ms: number) => string;
};

export type DurationValueProps = StatusFormatterProps & {
    active: unknown;
    startAtMs: unknown;
};

export type StatusPopoverContent = ReactNode;
