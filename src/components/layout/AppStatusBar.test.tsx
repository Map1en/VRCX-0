// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
});
