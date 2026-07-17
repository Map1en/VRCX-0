import {
    commands,
    type AutoLoginOutcome,
    type LoginSessionState
} from '@/platform/tauri/bindings';
import {
    DEFAULT_VRCHAT_API_ENDPOINT,
    normalizeVrchatEndpoint
} from '@/shared/vrchatEndpoint';

import {
    createRequestError,
    notifyVrchatAuthFailure,
    parseJsonResponse,
    type VrchatRequestResponse,
    unwrapErrorMessage
} from './vrchatRequest';

export const DEFAULT_ENDPOINT_DOMAIN = DEFAULT_VRCHAT_API_ENDPOINT;
export const DEFAULT_WEBSOCKET_DOMAIN = 'wss://pipeline.vrchat.cloud';

type VrchatApiResult = {
    status: number;
    data: unknown;
    raw: unknown;
};
type AuthRecord = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function unwrapVrchatAuthResponse<TJson = unknown>(
    response: VrchatApiResult,
    path: string,
    endpoint: string
): VrchatRequestResponse<TJson> {
    const json = parseJsonResponse(response.data);
    if (response.status >= 400 || (isRecord(json) && 'error' in json)) {
        const requestError = createRequestError(
            unwrapErrorMessage(json, response.status, {
                fallbackMessage: 'VRChat request failed'
            }),
            response.status,
            path,
            json
        );
        notifyVrchatAuthFailure(requestError);
        throw requestError;
    }

    return {
        json: json as TJson,
        status: response.status,
        endpointDomain: normalizeVrchatEndpoint(endpoint),
        raw: response.raw
    };
}

interface EndpointOptions {
    endpoint?: string;
}

interface FileAnalysisInput extends EndpointOptions {
    fileId?: unknown;
    version?: unknown;
    variant?: unknown;
}

async function getConfig({ endpoint = '' }: EndpointOptions = {}) {
    const response = await commands.appVrchatAuthConfigGet({
        endpoint: normalizeVrchatEndpoint(endpoint)
    });
    return unwrapVrchatAuthResponse<AuthRecord>(response, 'config', endpoint);
}

async function getCurrentUser({ endpoint = '' }: EndpointOptions = {}) {
    const response = await commands.appVrchatAuthCurrentUserGet({
        endpoint: normalizeVrchatEndpoint(endpoint)
    });
    return unwrapVrchatAuthResponse<AuthRecord>(
        response,
        'auth/user',
        endpoint
    );
}

async function getAuthSession({ endpoint = '' }: EndpointOptions = {}) {
    const response = await commands.appVrchatAuthSessionGet({
        endpoint: normalizeVrchatEndpoint(endpoint)
    });
    return unwrapVrchatAuthResponse<AuthRecord>(response, 'auth', endpoint);
}

interface StartBasicLoginSessionInput extends EndpointOptions {
    mode: 'basic';
    username?: unknown;
    password?: unknown;
    saveCredentials?: boolean;
}

interface StartSavedCredentialLoginSessionInput extends EndpointOptions {
    mode: 'savedCredential';
    userId?: unknown;
}

interface StartCookieRestoreLoginSessionInput extends EndpointOptions {
    mode: 'cookieRestore';
}

type StartLoginSessionInput =
    | StartBasicLoginSessionInput
    | StartSavedCredentialLoginSessionInput
    | StartCookieRestoreLoginSessionInput;

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value : String(value ?? '');
}

async function startLoginSession(
    input: StartLoginSessionInput
): Promise<LoginSessionState> {
    const endpoint = normalizeVrchatEndpoint(input.endpoint ?? '');
    switch (input.mode) {
        case 'basic':
            return commands.appVrchatAuthSessionStart({
                mode: 'basic',
                endpoint,
                username: normalizeString(input.username),
                password: normalizeString(input.password),
                saveCredentials: input.saveCredentials === true
            });
        case 'savedCredential':
            return commands.appVrchatAuthSessionStart({
                mode: 'savedCredential',
                endpoint,
                userId: normalizeString(input.userId)
            });
        default:
            return commands.appVrchatAuthSessionStart({
                mode: 'cookieRestore',
                endpoint
            });
    }
}

async function respondLoginSession({
    method,
    code
}: {
    method?: unknown;
    code?: unknown;
}): Promise<LoginSessionState> {
    return commands.appVrchatAuthSessionRespond({
        method: normalizeString(method),
        code: normalizeString(code)
    });
}

async function cancelLoginSession(): Promise<LoginSessionState> {
    return commands.appVrchatAuthSessionCancel();
}

interface AutoLoginStartInput extends EndpointOptions {
    userId?: unknown;
}

async function autoLoginStart({
    endpoint = '',
    userId
}: AutoLoginStartInput): Promise<AutoLoginOutcome> {
    return commands.appVrchatAuthAutoLoginStart({
        endpoint: normalizeVrchatEndpoint(endpoint),
        userId: normalizeString(userId)
    });
}

async function resetAutoLoginThrottle(): Promise<void> {
    await commands.appVrchatAuthAutoLoginThrottleReset();
}

async function getOnlineVisits({ endpoint = '' }: EndpointOptions = {}) {
    const response = await commands.appVrchatAuthVisitsGet({
        endpoint: normalizeVrchatEndpoint(endpoint)
    });
    return unwrapVrchatAuthResponse<unknown[]>(response, 'visits', endpoint);
}

async function getFileAnalysis({
    endpoint = '',
    fileId,
    version,
    variant
}: FileAnalysisInput) {
    const response = await commands.appVrchatAuthFileAnalysisGet({
        endpoint: normalizeVrchatEndpoint(endpoint),
        fileId: typeof fileId === 'string' ? fileId : String(fileId ?? ''),
        version: Number(version) || 0,
        variant: typeof variant === 'string' ? variant : String(variant ?? '')
    });
    return unwrapVrchatAuthResponse(
        response,
        `analysis/${encodeURIComponent(String(fileId ?? ''))}/${Number(version) || 0}/${encodeURIComponent(String(variant ?? ''))}`,
        endpoint
    );
}

const vrchatAuthRepository = Object.freeze({
    getConfig,
    getCurrentUser,
    getAuthSession,
    startLoginSession,
    respondLoginSession,
    cancelLoginSession,
    autoLoginStart,
    resetAutoLoginThrottle,
    getOnlineVisits,
    getFileAnalysis
});

export {
    getConfig,
    getCurrentUser,
    getAuthSession,
    startLoginSession,
    respondLoginSession,
    cancelLoginSession,
    autoLoginStart,
    resetAutoLoginThrottle,
    getOnlineVisits,
    getFileAnalysis
};
export type { StartLoginSessionInput };
export default vrchatAuthRepository;
