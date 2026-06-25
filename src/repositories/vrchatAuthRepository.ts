import { commands } from '@/platform/tauri/bindings';
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

interface BasicAuthInput extends EndpointOptions {
    username?: unknown;
    password?: unknown;
}

interface AuthCodeInput extends EndpointOptions {
    code?: unknown;
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

async function restoreCookieSession({ endpoint = '' }: EndpointOptions = {}) {
    const response = await commands.appVrchatAuthCookieSessionRestore({
        endpoint: normalizeVrchatEndpoint(endpoint)
    });
    return unwrapVrchatAuthResponse<AuthRecord>(
        response,
        'auth/user',
        endpoint
    );
}

async function loginWithBasicAuth({
    username,
    password,
    endpoint = ''
}: BasicAuthInput) {
    const response = await commands.appVrchatAuthLoginBasicStart({
        endpoint: normalizeVrchatEndpoint(endpoint),
        username:
            typeof username === 'string' ? username : String(username ?? ''),
        password:
            typeof password === 'string' ? password : String(password ?? '')
    });
    return unwrapVrchatAuthResponse<AuthRecord>(
        response,
        'auth/user',
        endpoint
    );
}

async function loginWithSavedCredential({
    userId,
    endpoint = ''
}: EndpointOptions & { userId?: unknown }) {
    const response = await commands.appVrchatAuthSavedCredentialLoginStart({
        endpoint: normalizeVrchatEndpoint(endpoint),
        userId: typeof userId === 'string' ? userId : String(userId ?? '')
    });
    return unwrapVrchatAuthResponse<AuthRecord>(
        response,
        'auth/user',
        endpoint
    );
}

async function verifyTOTP({ code, endpoint = '' }: AuthCodeInput) {
    const response = await commands.appVrchatAuthTotpVerify({
        endpoint: normalizeVrchatEndpoint(endpoint),
        code: typeof code === 'string' ? code : String(code ?? '')
    });
    return unwrapVrchatAuthResponse(
        response,
        'auth/twofactorauth/totp/verify',
        endpoint
    );
}

async function verifyOTP({ code, endpoint = '' }: AuthCodeInput) {
    const response = await commands.appVrchatAuthOtpVerify({
        endpoint: normalizeVrchatEndpoint(endpoint),
        code: typeof code === 'string' ? code : String(code ?? '')
    });
    return unwrapVrchatAuthResponse(
        response,
        'auth/twofactorauth/otp/verify',
        endpoint
    );
}

async function verifyEmailOTP({ code, endpoint = '' }: AuthCodeInput) {
    const response = await commands.appVrchatAuthEmailOtpVerify({
        endpoint: normalizeVrchatEndpoint(endpoint),
        code: typeof code === 'string' ? code : String(code ?? '')
    });
    return unwrapVrchatAuthResponse(
        response,
        'auth/twofactorauth/emailotp/verify',
        endpoint
    );
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
    restoreCookieSession,
    loginWithBasicAuth,
    loginWithSavedCredential,
    verifyTOTP,
    verifyOTP,
    verifyEmailOTP,
    getOnlineVisits,
    getFileAnalysis
});

export {
    getConfig,
    getCurrentUser,
    getAuthSession,
    restoreCookieSession,
    loginWithBasicAuth,
    loginWithSavedCredential,
    verifyTOTP,
    verifyOTP,
    verifyEmailOTP,
    getOnlineVisits,
    getFileAnalysis
};
export default vrchatAuthRepository;
