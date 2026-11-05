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
    useOfflineRecordStore.setState({
        health: null,
        syncProgress: null,
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
});

describe('status bar recorder indicator', () => {
    it('is hidden until a recorder is set up', () => {
        render(<OfflineRecordIndicator />);
        expect(indicator()).toBeNull();

        recorderReports({ state: 'notConfigured' });
        expect(indicator()).toBeNull();
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
            situation: 'the recorder needs a VRChat login',
            probe: connectedRecorder({
                session: { state: 'noCredentials' },
                accountId: null
            }),
            colour: RED,
            message: 'offline_record.health.no_credentials'
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

            expect(indicator()?.className).toContain(colour);
            expect(indicator()?.className).not.toContain(
                '--state-selected-surface'
            );
            expect(screen.getByRole('tooltip').textContent).toContain(message);
        }
    );

    it('opens the recorder dialog when clicked', () => {
        render(<OfflineRecordIndicator />);
        recorderReports(connectedRecorder());

        fireEvent.click(indicator()!);

        expect(useRuntimeStore.getState().systemHosts.offlineRecordOpen).toBe(
            true
        );
    });

    it('shows filling-in progress while entries are filled in, then goes back to the plain icon', () => {
        render(<OfflineRecordIndicator />);
        recorderReports(connectedRecorder({ unsyncedFrames: 2000 }));

        act(() =>
            handleFeedLoggerSyncEvent({ state: 'pulling', frames: 2000 })
        );
        expect(indicator()?.textContent).toBe(
            'offline_record.status_bar.pulling'
        );

        act(() =>
            handleFeedLoggerSyncEvent({ state: 'writing', frames: 2000 })
        );
        expect(indicator()?.textContent).toBe(
            'offline_record.status_bar.writing'
        );

        act(() =>
            handleFeedLoggerSyncEvent({
                state: 'finished',
                inserted: 0,
                skipped: 0
            })
        );
        expect(indicator()?.textContent).toBe('');
    });
});
