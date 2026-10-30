// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen
} from '@testing-library/react';
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/platform/tauri/bindings';
import { useRuntimeStore } from '@/state/runtimeStore';

const segmentRenders = vi.hoisted(() => [] as string[]);

vi.mock('@/platform/tauri/bindings', async () =>
    (await import('@/test/mockCommands')).mockBindingsModule()
);

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getString: vi.fn(() => Promise.resolve(null)),
        setString: vi.fn(() => Promise.resolve())
    }
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn(), close: vi.fn() }
}));

vi.mock('@/ui/shadcn/tooltip', () => ({
    Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
    TooltipContent: ({ children }: PropsWithChildren) => (
        <div role="tooltip">{children}</div>
    ),
    TooltipTrigger: ({ render }: { render?: ReactNode }) => <>{render}</>
}));

vi.mock('./status-bar/DoNotDisturbMenu', () => ({
    DoNotDisturbMenu: () => null
}));
vi.mock('./status-bar/GameIsolationToggle', () => ({
    GameIsolationToggle: () => null
}));
vi.mock('./status-bar/DesktopWidgetToggle', () => ({
    DesktopWidgetToggle: () => null
}));
vi.mock('./status-bar/OfflineRecordIndicator', () => ({
    OfflineRecordIndicator: () => null
}));

vi.mock('./status-bar/StatusBarParts', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('./status-bar/StatusBarParts')>();
    return {
        ...actual,
        StatusSegment: (props: ComponentProps<typeof actual.StatusSegment>) => {
            segmentRenders.push(String(props.label));
            return <actual.StatusSegment {...props} />;
        }
    };
});

import { AppStatusBar } from './AppStatusBar';

beforeEach(() => {
    useRuntimeStore.getState().resetRuntimeState();
    useRuntimeStore.getState().setNowPlayingState({
        url: 'https://example.com/track',
        name: 'Track',
        position: 0,
        length: 0
    });
});

afterEach(() => {
    cleanup();
    segmentRenders.length = 0;
});

describe('AppStatusBar', () => {
    it('re-renders only the segment whose data changed', async () => {
        render(<AppStatusBar />);
        await act(async () => {});
        expect(segmentRenders).toContain('status_bar.now_playing');
        expect(segmentRenders).toContain('VRChat');

        segmentRenders.length = 0;
        act(() =>
            useRuntimeStore.getState().setNowPlayingState({ name: 'Next' })
        );
        expect(segmentRenders).toEqual(['status_bar.now_playing']);

        segmentRenders.length = 0;
        act(() =>
            useRuntimeStore.getState().setGameState({
                lastGameLogAt: '2026-10-29T00:00:00.000Z',
                lastGameLogType: 'location'
            })
        );
        expect(segmentRenders).toEqual(['VRChat']);
    });

    it('shows the media details on hover and holds the time while paused', async () => {
        useRuntimeStore.getState().setNowPlayingState({
            url: 'https://youtu.be/abc',
            name: 'Song',
            displayName: 'Alice',
            thumbnailUrl: 'https://img.test/a.jpg',
            length: 200,
            position: 30,
            startedAt: '2026-10-30T00:00:00.000Z',
            paused: true
        });
        render(<AppStatusBar />);
        await act(async () => {});

        const tooltip = screen
            .getAllByRole('tooltip')
            .find((element) => element.textContent?.includes('Alice'));
        expect(tooltip?.querySelector('img')?.getAttribute('src')).toBe(
            'https://img.test/a.jpg'
        );
        expect(tooltip?.textContent).toContain('https://youtu.be/abc');
        expect(screen.getByText('00:30 / 03:20')).not.toBeNull();
    });

    it('shows the reconnect state as text and retries on click', async () => {
        vi.mocked(commands.appRealtimeRetryNow).mockResolvedValue();
        render(<AppStatusBar />);
        await act(async () => {});
        expect(screen.queryByText(/status_bar\.realtime_retry/)).toBeNull();

        act(() =>
            useRuntimeStore.getState().setTransportState({
                websocketConnected: false,
                interrupted: true,
                retryWaiting: true,
                retryAt: new Date(Date.now() + 30_000).toISOString(),
                lastError: 'websocket read: connection reset',
                outageStartedAt: '2026-10-29T00:00:00.000Z'
            })
        );

        const segment = screen.getByRole('button', {
            name: /status_bar\.realtime_retry_in/
        });
        expect(
            screen.queryByText(/status_bar\.realtime_reason/)
        ).not.toBeNull();
        fireEvent.click(segment);

        expect(commands.appRealtimeRetryNow).toHaveBeenCalledTimes(1);
    });
});
