// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen
} from '@testing-library/react';
import type { PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commands, type FeedLoggerProbe } from '@/platform/tauri/bindings';
import {
    handleFeedLoggerHealthEvent,
    handleFeedLoggerSyncEvent
} from '@/services/offlineRecordService';
import { useOfflineRecordStore } from '@/state/offlineRecordStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { connectedRecorder } from '@/test/offlineRecordFixtures';

vi.mock('@/platform/tauri/bindings', async () =>
    (await import('@/test/mockCommands')).mockBindingsModule()
);

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

import { OfflineRecordIndicator } from './OfflineRecordIndicator';

const ORANGE = '--status-askme';
const RED = '--status-busy';
const animate = vi.fn(
    (): {
        onfinish: (() => void) | null;
        cancel: ReturnType<typeof vi.fn>;
    } => ({ onfinish: null, cancel: vi.fn() })
);

function completeAnimation() {
    act(() => animate.mock.results.at(-1)!.value.onfinish?.());
}

function finishSync() {
    handleFeedLoggerSyncEvent({ state: 'finished', inserted: 0, skipped: 0 });
}

function expectIcon(name: string) {
    expect(
        screen
            .getByRole('button', { name: 'offline_record.header' })
            .querySelector(`.lucide-${name}`)
    ).not.toBeNull();
}

function signIn(currentUserId: string | null) {
    useRuntimeStore.setState((state) => ({
        auth: { ...state.auth, currentUserId },
        systemHosts: { ...state.systemHosts, offlineRecordOpen: false }
    }));
}

function recorderReports(probe: FeedLoggerProbe) {
    act(() => handleFeedLoggerHealthEvent(probe));
}

function indicator() {
    return screen.queryByRole('button', { name: 'offline_record.header' });
}

beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'animate', {
        configurable: true,
        value: animate
    });
    useOfflineRecordStore.setState({
        health: null,
        syncProgress: null,
        syncOutcome: null,
        backfillRevision: 0
    });
    signIn('usr_self');
    vi.mocked(commands.appFeedLoggerStatus).mockResolvedValue({
        state: 'notConfigured'
    });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.documentElement.classList.remove('reduce-effects');
});

describe('status bar recorder indicator', () => {
    it('shows a dim cloud-off until a recorder is set up', () => {
        render(<OfflineRecordIndicator />);
        expectIcon('cloud-off');
        expect(indicator()?.className).toContain('text-muted-foreground');

        recorderReports({ state: 'notConfigured' });
        expectIcon('cloud-off');
    });

    it('is hidden while nobody is signed in to VRCX-0', () => {
        signIn(null);
        render(<OfflineRecordIndicator />);

        recorderReports(connectedRecorder());

        expect(indicator()).toBeNull();
    });

    it('looks normal while the recorder is recording', () => {
        render(<OfflineRecordIndicator />);

        recorderReports(connectedRecorder());

        const className = indicator()?.className ?? '';
        expectIcon('cloud');
        expect(className).toContain('text-muted-foreground');
        expect(className).not.toContain(ORANGE);
        expect(className).not.toContain(RED);
        expect(className).not.toContain('--state-selected-surface');
        expect(screen.getByRole('tooltip').textContent).toContain(
            'offline_record.health.recording'
        );
    });

    it.each([
        {
            situation: 'the recorder is logging in',
            probe: connectedRecorder({ session: { state: 'loggingIn' } }),
            colour: ORANGE,
            message: 'offline_record.health.logging_in'
        },
        {
            situation: 'the recorder is reconnecting',
            probe: connectedRecorder({ session: { state: 'reconnecting' } }),
            colour: ORANGE,
            message: 'offline_record.health.reconnecting'
        },
        {
            situation: 'the recorder is logged into another account',
            probe: connectedRecorder({ accountId: 'usr_other' }),
            colour: ORANGE,
            message: 'offline_record.health.account_mismatch'
        },
        {
            situation: 'the recorder cannot be reached',
            probe: { state: 'unreachable', message: 'timeout' },
            colour: RED,
            message: 'offline_record.health.unreachable'
        },
        {
            situation: 'the recorder password is wrong',
            probe: { state: 'unauthorized' },
            colour: RED,
            message: 'offline_record.health.unauthorized'
        },
        {
            situation: 'VRCX-0 is too old for the recorder',
            probe: { state: 'clientTooOld' },
            colour: RED,
            message: 'offline_record.health.client_too_old'
        },
        {
            situation: 'the recorder is too old for VRCX-0',
            probe: { state: 'loggerTooOld' },
            colour: RED,
            message: 'offline_record.health.logger_too_old'
        },
        {
            situation: 'the recorder VRChat login failed',
            probe: connectedRecorder({
                session: { state: 'loginFailed', reason: 'bad password' }
            }),
            colour: RED,
            message: 'offline_record.health.login_failed'
        },
        {
            situation: 'the recorder needs a two-factor code',
            probe: connectedRecorder({
                session: { state: 'awaitingTwoFactor', methods: ['totp'] }
            }),
            colour: RED,
            message: 'offline_record.health.two_factor'
        }
    ] satisfies {
        situation: string;
        probe: FeedLoggerProbe;
        colour: string;
        message: string;
    }[])(
        'turns $colour and explains why when $situation',
        ({ probe, colour, message }) => {
            render(<OfflineRecordIndicator />);

            recorderReports(probe);

            expectIcon('cloud-exclamation-point');
            expect(indicator()?.className).toContain(colour);
            expect(indicator()?.className).not.toContain(
                '--state-selected-surface'
            );
            expect(screen.getByRole('tooltip').textContent).toContain(message);
        }
    );

    it('shows cloud-off when the recorder has no credentials', () => {
        render(<OfflineRecordIndicator />);
        recorderReports(
            connectedRecorder({
                session: { state: 'noCredentials' },
                accountId: null
            })
        );
        expectIcon('cloud-off');
        expect(indicator()?.className).toContain('text-muted-foreground');
        expect(screen.getByRole('tooltip').textContent).toContain(
            'offline_record.health.no_credentials'
        );
    });

    it('opens the recorder dialog when clicked', () => {
        render(<OfflineRecordIndicator />);
        recorderReports(connectedRecorder());

        fireEvent.click(indicator()!);

        expect(useRuntimeStore.getState().systemHosts.offlineRecordOpen).toBe(
            true
        );
    });

    it('finishes the sync breath and one success breath before returning to the dim cloud', () => {
        render(<OfflineRecordIndicator />);
        recorderReports(connectedRecorder({ unsyncedFrames: 2000 }));

        act(() =>
            handleFeedLoggerSyncEvent({ state: 'pulling', frames: 2000 })
        );
        expect(indicator()?.textContent).toBe(
            'offline_record.status_bar.pulling'
        );
        expectIcon('cloud-sync');
        expect(animate).toHaveBeenLastCalledWith(
            [{ opacity: 1 }, { opacity: 0.4 }],
            {
                duration: 600,
                iterations: 2,
                direction: 'alternate-reverse',
                easing: 'ease-in-out'
            }
        );

        act(() =>
            handleFeedLoggerSyncEvent({ state: 'writing', frames: 2000 })
        );
        expect(indicator()?.textContent).toBe(
            'offline_record.status_bar.writing'
        );
        expect(animate).toHaveBeenCalledTimes(1);

        act(() =>
            handleFeedLoggerSyncEvent({
                state: 'finished',
                inserted: 0,
                skipped: 0
            })
        );
        expect(indicator()?.textContent).toBe('');
        expectIcon('cloud-sync');
        expect(animate.mock.results[0].value.cancel).not.toHaveBeenCalled();
        completeAnimation();
        expectIcon('cloud-check');
        completeAnimation();
        expectIcon('cloud');
        expect(indicator()?.className).toContain('text-muted-foreground');
        expect(animate).toHaveBeenCalledTimes(2);
    });

    it('keeps breathing across cycles and does not restart on progress updates', () => {
        render(<OfflineRecordIndicator />);
        act(() => handleFeedLoggerSyncEvent({ state: 'pulling', frames: 0 }));
        completeAnimation();
        expectIcon('cloud-sync');
        expect(animate).toHaveBeenCalledTimes(2);
        act(() => handleFeedLoggerSyncEvent({ state: 'pulling', frames: 100 }));
        expect(animate).toHaveBeenCalledTimes(2);
    });

    it('preserves both cycles when sync starts and finishes in one render batch', () => {
        render(<OfflineRecordIndicator />);
        recorderReports(connectedRecorder());
        act(() => {
            handleFeedLoggerSyncEvent({ state: 'pulling', frames: 0 });
            finishSync();
        });
        expectIcon('cloud-sync');
        completeAnimation();
        expectIcon('cloud-check');
        completeAnimation();
        expectIcon('cloud');
    });

    it('finishes the success cycle before displaying the next sync', () => {
        render(<OfflineRecordIndicator />);
        act(() => handleFeedLoggerSyncEvent({ state: 'pulling', frames: 0 }));
        act(finishSync);
        completeAnimation();
        expectIcon('cloud-check');
        const success = animate.mock.results.at(-1)!.value;
        act(() => handleFeedLoggerSyncEvent({ state: 'pulling', frames: 0 }));
        expectIcon('cloud-check');
        expect(success.cancel).not.toHaveBeenCalled();
        completeAnimation();
        expectIcon('cloud-sync');
    });

    it('shows an error instead of success if synchronization fails', () => {
        render(<OfflineRecordIndicator />);
        recorderReports(connectedRecorder());
        act(() => handleFeedLoggerSyncEvent({ state: 'pulling', frames: 0 }));
        act(() =>
            handleFeedLoggerSyncEvent({ state: 'failed', message: 'disk full' })
        );
        expectIcon('cloud-exclamation-point');
        expect(indicator()?.className).toContain(RED);
        expect(animate.mock.results[0].value.cancel).toHaveBeenCalledOnce();
        expect(animate.mock.results[0].value.onfinish).toBeNull();
    });

    it.each(['system', 'app'])(
        'settles success without animation when %s motion is reduced',
        (source) => {
            vi.useFakeTimers();
            if (source === 'system') {
                vi.stubGlobal('matchMedia', () => ({ matches: true }));
            } else {
                document.documentElement.classList.add('reduce-effects');
            }
            render(<OfflineRecordIndicator />);
            recorderReports(connectedRecorder());
            act(() =>
                handleFeedLoggerSyncEvent({ state: 'pulling', frames: 0 })
            );
            expectIcon('cloud-sync');
            act(finishSync);
            expectIcon('cloud-check');
            act(() => vi.advanceTimersByTime(1200));
            expectIcon('cloud');
            expect(animate).not.toHaveBeenCalled();
        }
    );

    it('cancels animations on account changes and does not replay a previous success on remount', () => {
        const view = render(<OfflineRecordIndicator />);
        recorderReports(connectedRecorder());
        act(() => handleFeedLoggerSyncEvent({ state: 'pulling', frames: 0 }));
        act(finishSync);
        act(() => signIn(null));
        expect(indicator()).toBeNull();
        expect(animate.mock.results[0].value.cancel).toHaveBeenCalledOnce();
        view.unmount();
        signIn('usr_self');
        render(<OfflineRecordIndicator />);
        expectIcon('cloud');
        expect(animate).toHaveBeenCalledTimes(1);
    });
});
