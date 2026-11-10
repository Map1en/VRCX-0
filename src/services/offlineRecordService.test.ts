import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/platform/tauri/bindings';
import { useOfflineRecordStore } from '@/state/offlineRecordStore';

const mocks = vi.hoisted(() => ({
    toastAdd: vi.fn(),
    t: vi.fn((key: string) => key)
}));

vi.mock('@/platform/tauri/bindings', async () =>
    (await import('@/test/mockCommands')).mockBindingsModule()
);

vi.mock('./toastService', () => ({
    toast: { add: mocks.toastAdd, close: vi.fn() }
}));

vi.mock('./i18nService', () => ({
    default: { t: mocks.t }
}));

import { normalizePlatformError } from '@/platform/tauri/errors';

import {
    handleFeedLoggerSyncEvent,
    offlineRecordErrorMessage,
    offlineRecordGuideUrl
} from './offlineRecordService';

beforeEach(() => {
    useOfflineRecordStore.setState({
        health: null,
        syncProgress: null,
        syncOutcome: null,
        backfillRevision: 0
    });
    vi.mocked(commands.appFeedLoggerStatus).mockResolvedValue({
        state: 'notConfigured'
    });
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('filling in entries recorded while VRCX-0 was closed', () => {
    it('shows a success toast when entries were written', () => {
        handleFeedLoggerSyncEvent({ state: 'pulling', frames: 2000 });
        handleFeedLoggerSyncEvent({
            state: 'finished',
            inserted: 12,
            skipped: 0
        });

        expect(mocks.toastAdd).toHaveBeenCalledWith({
            type: 'success',
            title: 'offline_record.toast.backfilled'
        });
        expect(commands.appFeedLoggerStatus).toHaveBeenCalled();
    });

    it('shows nothing when nothing new was written', () => {
        handleFeedLoggerSyncEvent({ state: 'writing', frames: 5 });
        handleFeedLoggerSyncEvent({
            state: 'finished',
            inserted: 0,
            skipped: 0
        });

        expect(mocks.toastAdd).not.toHaveBeenCalled();
        expect(useOfflineRecordStore.getState().syncProgress).toBeNull();
        expect(useOfflineRecordStore.getState().syncOutcome).toBe('finished');
    });

    it('warns when recorded entries could not be filled in for lack of a friend list', () => {
        handleFeedLoggerSyncEvent({
            state: 'finished',
            inserted: 0,
            skipped: 3
        });

        expect(mocks.toastAdd).toHaveBeenCalledWith({
            type: 'warning',
            title: 'offline_record.toast.skipped'
        });
    });

    it('shows an error toast with the reason when filling in fails', () => {
        handleFeedLoggerSyncEvent({ state: 'pulling', frames: 2000 });
        handleFeedLoggerSyncEvent({ state: 'failed', message: 'disk full' });

        expect(mocks.toastAdd).toHaveBeenCalledWith({
            type: 'error',
            title: 'offline_record.toast.backfill_failed',
            description: 'disk full'
        });
        expect(useOfflineRecordStore.getState().syncProgress).toBeNull();
        expect(useOfflineRecordStore.getState().syncOutcome).toBe('failed');
    });
});

describe('recorder errors', () => {
    it('quotes the reason the recorder gave without the command name', () => {
        const error = normalizePlatformError(
            {
                code: 'feed_logger',
                message: 'Invalid Username/Email or Password',
                feedLoggerCode: 'rejected'
            },
            'Tauri command failed: app__feed_logger_push_credentials'
        );

        expect(offlineRecordErrorMessage(error)).toBe(
            'offline_record.error.rejected'
        );
        expect(mocks.t).toHaveBeenCalledWith('offline_record.error.rejected', {
            message: 'Invalid Username/Email or Password'
        });
    });

    it('falls back to a generic message for errors from elsewhere', () => {
        expect(offlineRecordErrorMessage(new Error('boom'))).toBe(
            'offline_record.action_failed'
        );
    });
});

describe('recorder setup guide', () => {
    it.each([
        ['zh-CN', 'README.zh-CN.md'],
        ['zh-TW', 'README.zh-Hant.md'],
        ['ja', 'README.ja-JP.md'],
        ['ko', 'README.ko-KR.md'],
        ['en', 'README.md'],
        ['fr', 'README.md']
    ])(
        'opens the guide for the %s interface language as %s',
        (language, file) => {
            expect(offlineRecordGuideUrl(language)).toBe(
                `https://github.com/Map1en/VRCX-0/blob/master/crates/logger/${file}`
            );
        }
    );
});
