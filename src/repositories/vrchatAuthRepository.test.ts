import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
    appVrchatAuthConfigGet: vi.fn(),
    appVrchatAuthCurrentUserGet: vi.fn(),
    appVrchatAuthSessionStart: vi.fn(),
    appVrchatAuthSessionRespond: vi.fn(),
    appVrchatAuthSessionCancel: vi.fn(),
    appVrchatAuthVisitsGet: vi.fn(),
    appVrchatAuthFileAnalysisGet: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: commandMocks
}));

import {
    cancelLoginSession,
    DEFAULT_ENDPOINT_DOMAIN,
    getConfig,
    getCurrentUser,
    getFileAnalysis,
    respondLoginSession,
    startLoginSession
} from './vrchatAuthRepository';

function response(status = 200, data: unknown = { id: 'usr_1' }) {
    return {
        status,
        data: typeof data === 'string' ? data : JSON.stringify(data)
    };
}

function cancelledState() {
    return { status: 'cancelled' };
}

describe('vrchatAuthRepository', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        for (const command of Object.values(commandMocks)) {
            command.mockResolvedValue(response());
        }
        commandMocks.appVrchatAuthSessionStart.mockResolvedValue(
            cancelledState()
        );
        commandMocks.appVrchatAuthSessionRespond.mockResolvedValue(
            cancelledState()
        );
        commandMocks.appVrchatAuthSessionCancel.mockResolvedValue(
            cancelledState()
        );
    });

    it('unwraps auth responses against the canonical VRChat endpoint', async () => {
        await expect(getCurrentUser()).resolves.toMatchObject({
            json: {
                id: 'usr_1'
            },
            status: 200,
            endpointDomain: DEFAULT_ENDPOINT_DOMAIN
        });

        expect(commandMocks.appVrchatAuthCurrentUserGet).toHaveBeenCalledWith();
    });

    it('passes normalized login-session payloads to the Tauri bridge', async () => {
        await startLoginSession({
            mode: 'basic',
            username: 'user@example.test',
            password: 123,
            saveCredentials: true
        });
        await startLoginSession({
            mode: 'savedCredential',
            userId: 456
        });
        await respondLoginSession({
            attemptId: 'attempt-1',
            method: 'totp',
            code: 111111
        });
        await cancelLoginSession('attempt-1');

        expect(commandMocks.appVrchatAuthSessionStart).toHaveBeenCalledWith({
            mode: 'basic',
            username: 'user@example.test',
            password: '123',
            saveCredentials: true
        });
        expect(commandMocks.appVrchatAuthSessionStart).toHaveBeenCalledWith({
            mode: 'savedCredential',
            userId: '456'
        });
        expect(commandMocks.appVrchatAuthSessionRespond).toHaveBeenCalledWith({
            attemptId: 'attempt-1',
            method: 'totp',
            code: '111111'
        });
        expect(commandMocks.appVrchatAuthSessionCancel).toHaveBeenCalledWith({
            attemptId: 'attempt-1'
        });
        expect(commandMocks.appVrchatAuthSessionCancel).toHaveBeenCalledTimes(
            1
        );
    });

    it('returns login-session states untouched instead of unwrapping them', async () => {
        const failed = {
            status: 'failed',
            reason: 'Invalid Username/Email or Password',
            kind: 'invalidCredentials'
        };
        commandMocks.appVrchatAuthSessionStart.mockResolvedValueOnce(failed);

        await expect(
            startLoginSession({
                mode: 'basic',
                username: 'user@example.test',
                password: 'secret'
            })
        ).resolves.toBe(failed);
    });

    it('builds file-analysis requests with numeric versions and encoded error endpoints', async () => {
        commandMocks.appVrchatAuthFileAnalysisGet.mockResolvedValueOnce(
            response(404, {
                error: {
                    message: 'Missing file analysis'
                }
            })
        );

        await expect(
            getFileAnalysis({
                fileId: 'file 1',
                version: '2',
                variant: 'Quest/Android'
            })
        ).rejects.toMatchObject({
            message: 'Missing file analysis',
            status: 404,
            endpoint: 'analysis/file%201/2/Quest%2FAndroid'
        });

        expect(commandMocks.appVrchatAuthFileAnalysisGet).toHaveBeenCalledWith({
            fileId: 'file 1',
            version: 2,
            variant: 'Quest/Android'
        });
    });

    it('throws a structured request error for a rejected config request', async () => {
        commandMocks.appVrchatAuthConfigGet.mockResolvedValueOnce(
            response(403, {
                error: {
                    message: 'Forbidden'
                }
            })
        );

        await expect(getConfig()).rejects.toMatchObject({
            message: 'Forbidden',
            status: 403,
            endpoint: 'config'
        });
    });
});
