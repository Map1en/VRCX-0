import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
    appVrchatAuthConfigGet: vi.fn(),
    appVrchatAuthCurrentUserGet: vi.fn(),
    appVrchatAuthSessionGet: vi.fn(),
    appVrchatAuthSessionStart: vi.fn(),
    appVrchatAuthSessionRespond: vi.fn(),
    appVrchatAuthSessionCancel: vi.fn(),
    appVrchatAuthAutoLoginThrottleReset: vi.fn(),
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
    resetAutoLoginThrottle,
    respondLoginSession,
    startLoginSession
} from './vrchatAuthRepository';
import { setVrchatAuthFailureHandler } from './vrchatRequest';

function response(status = 200, data: unknown = { id: 'usr_1' }) {
    return {
        status,
        data: typeof data === 'string' ? data : JSON.stringify(data),
        raw: {
            status
        }
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
        setVrchatAuthFailureHandler(null);
    });

    it('normalizes default endpoints and unwraps successful auth responses', async () => {
        await expect(getCurrentUser()).resolves.toMatchObject({
            json: {
                id: 'usr_1'
            },
            status: 200,
            endpointDomain: DEFAULT_ENDPOINT_DOMAIN,
            raw: {
                status: 200
            }
        });

        expect(commandMocks.appVrchatAuthCurrentUserGet).toHaveBeenCalledWith({
            endpoint: DEFAULT_ENDPOINT_DOMAIN
        });
    });

    it('passes normalized login-session payloads to the Tauri bridge', async () => {
        await startLoginSession({
            mode: 'basic',
            username: 'user@example.test',
            password: 123,
            saveCredentials: true,
            endpoint: ' https://api.example.test/api/1 '
        });
        await startLoginSession({
            mode: 'savedCredential',
            userId: 456,
            endpoint: ''
        });
        await startLoginSession({ mode: 'cookieRestore' });
        await respondLoginSession({ method: 'totp', code: 111111 });
        await cancelLoginSession();

        expect(commandMocks.appVrchatAuthSessionStart).toHaveBeenCalledWith({
            mode: 'basic',
            endpoint: 'https://api.example.test/api/1',
            username: 'user@example.test',
            password: '123',
            saveCredentials: true
        });
        expect(commandMocks.appVrchatAuthSessionStart).toHaveBeenCalledWith({
            mode: 'savedCredential',
            endpoint: DEFAULT_ENDPOINT_DOMAIN,
            userId: '456'
        });
        expect(commandMocks.appVrchatAuthSessionStart).toHaveBeenCalledWith({
            mode: 'cookieRestore',
            endpoint: DEFAULT_ENDPOINT_DOMAIN
        });
        expect(commandMocks.appVrchatAuthSessionRespond).toHaveBeenCalledWith({
            method: 'totp',
            code: '111111'
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

    it('resets the backend auto-login throttle through its dedicated command', async () => {
        await resetAutoLoginThrottle();

        expect(
            commandMocks.appVrchatAuthAutoLoginThrottleReset
        ).toHaveBeenCalledTimes(1);
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
            endpoint: DEFAULT_ENDPOINT_DOMAIN,
            fileId: 'file 1',
            version: 2,
            variant: 'Quest/Android'
        });
    });

    it('throws request errors and notifies the auth failure handler for recoverable auth failures', async () => {
        const handler = vi.fn();
        setVrchatAuthFailureHandler(handler);
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
        expect(handler).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Forbidden',
                status: 403,
                endpoint: 'config'
            })
        );
    });

    it('treats payloads containing an error object as failed requests even with a 200 status', async () => {
        commandMocks.appVrchatAuthSessionGet.mockResolvedValueOnce(
            response(200, {
                error: {
                    message: 'Session rejected'
                }
            })
        );

        await expect(
            getCurrentUser({
                endpoint: 'https://api.example.test/api/1/'
            })
        ).resolves.toMatchObject({
            endpointDomain: 'https://api.example.test/api/1/'
        });
        await expect(
            import('./vrchatAuthRepository').then(({ getAuthSession }) =>
                getAuthSession()
            )
        ).rejects.toMatchObject({
            message: 'Session rejected',
            status: 200,
            endpoint: 'auth'
        });
    });
});
