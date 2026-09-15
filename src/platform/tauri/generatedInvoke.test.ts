import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    invokeTauri: vi.fn(),
    normalizePlatformError: vi.fn(),
    notifySQLiteError: vi.fn(),
    recordErrorLog: vi.fn()
}));

vi.mock('../../services/errorLogService', () => ({
    recordErrorLog: mocks.recordErrorLog
}));

vi.mock('../../shared/sqliteErrorEvents', () => ({
    notifySQLiteError: mocks.notifySQLiteError
}));

vi.mock('./errors', () => ({
    normalizePlatformError: mocks.normalizePlatformError
}));

vi.mock('./invoke', () => ({
    invokeTauri: mocks.invokeTauri
}));

import { invoke } from './generatedInvoke';

describe('generatedInvoke', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns successful command results without error side effects', async () => {
        mocks.invokeTauri.mockResolvedValue({ ok: true });

        await expect(invoke('app__example')).resolves.toEqual({ ok: true });
        expect(mocks.recordErrorLog).not.toHaveBeenCalled();
        expect(mocks.notifySQLiteError).not.toHaveBeenCalled();
    });

    it('types command promise rejections as Error', () => {
        type RejectionHandler = NonNullable<
            Parameters<ReturnType<typeof invoke>['catch']>[0]
        >;
        type Rejection = Parameters<RejectionHandler>[0];

        expectTypeOf<Rejection>().toEqualTypeOf<Error>();
    });

    it('notifies SQLite listeners and rethrows the normalized IPC error', async () => {
        const rawError = new Error('database is locked');
        const normalizedError = new Error(
            'Tauri command failed: app__example: database is locked'
        );
        mocks.invokeTauri.mockRejectedValue(rawError);
        mocks.normalizePlatformError.mockReturnValue(normalizedError);

        await expect(invoke('app__example')).rejects.toBe(normalizedError);
        expect(mocks.normalizePlatformError).toHaveBeenCalledWith(
            rawError,
            'Tauri command failed: app__example'
        );
        expect(mocks.recordErrorLog).toHaveBeenCalledWith('rust:command', [
            'command: app__example',
            normalizedError
        ]);
        expect(mocks.notifySQLiteError).toHaveBeenCalledWith(normalizedError);
    });

    it('normalizes non-Error command rejections into Error', async () => {
        const normalizedError = new Error('normalized command failure');
        mocks.invokeTauri.mockRejectedValue('legacy command failure');
        mocks.normalizePlatformError.mockReturnValue(normalizedError);

        await expect(invoke('app__example')).rejects.toBe(normalizedError);
        expect(mocks.normalizePlatformError).toHaveBeenCalledWith(
            'legacy command failure',
            'Tauri command failed: app__example'
        );
    });
});
