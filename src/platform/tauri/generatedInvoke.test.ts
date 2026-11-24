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

    it('reports commands that take at least 200ms as slow command telemetry', async () => {
        const now = vi.spyOn(performance, 'now');
        now.mockReturnValueOnce(1_000).mockReturnValueOnce(1_350.4);
        mocks.invokeTauri.mockResolvedValue(null);

        await invoke('app__example');
        await Promise.resolve();

        expect(mocks.invokeTauri).toHaveBeenLastCalledWith(
            'app__telemetry_record_event',
            {
                event: {
                    type: 'slowCommand',
                    command: 'app__example',
                    duration_ms: 350
                }
            }
        );
        now.mockRestore();
    });

    it('does not report fast commands or its own telemetry command', async () => {
        const now = vi.spyOn(performance, 'now');
        now.mockReturnValueOnce(0)
            .mockReturnValueOnce(150)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(900);
        mocks.invokeTauri.mockResolvedValue(null);

        await invoke('app__example');
        await invoke('app__telemetry_record_event', { event: {} });
        await Promise.resolve();

        expect(mocks.invokeTauri).toHaveBeenCalledTimes(2);
        now.mockRestore();
    });
});
