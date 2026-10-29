import type { ComponentPropsWithoutRef } from 'react';

import type { InstanceQueueState, NowPlayingState } from '@/state/runtimeStore';

export type StatusBarVisibilityKey =
    | 'vrchat'
    | 'steamvr'
    | 'proxy'
    | 'ws'
    | 'instanceQueue'
    | 'nowPlaying'
    | 'uptime'
    | 'zoom'
    | 'clocks'
    | 'servers';

export type StatusBarVisibility = Record<StatusBarVisibilityKey, boolean>;

export type StatusBarClock = {
    offset: number;
};

export type StatusBarInstanceQueue = InstanceQueueState;

export type StatusBarNowPlaying = Pick<
    NowPlayingState,
    'length' | 'name' | 'position' | 'startedAt' | 'url'
>;

export type StatusBarFooterProps = ComponentPropsWithoutRef<'footer'> & {
    appStartedAt: number;
    clocks: StatusBarClock[];
    proxyEditorOpen: boolean;
    sidebarWindowMode?: boolean;
    visibility: StatusBarVisibility;
    onProxyEditorOpenChange: (open: boolean) => void;
    onUpdateClockTimezone: (index: number, offsetValue: string | null) => void;
};

type StatusFormatterProps = {
    formatter: (ms: number) => string;
};

export type DurationValueProps = StatusFormatterProps & {
    active: boolean | null;
    startAtMs: number;
};
