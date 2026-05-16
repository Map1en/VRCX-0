import { backend } from '@/platform/index.js';
import {
    DEFAULT_VRCHAT_API_ENDPOINT,
    normalizeVrchatEndpoint
} from '@/shared/vrchatEndpoint.js';

import {
    createRequestError,
    notifyVrchatAuthFailure,
    parseJsonResponse,
    type VrchatRequestResponse,
    unwrapErrorMessage
} from './vrchatRequest.js';

export const DEFAULT_ENDPOINT_DOMAIN = DEFAULT_VRCHAT_API_ENDPOINT;
export const DEFAULT_WEBSOCKET_DOMAIN = 'wss://pipeline.vrchat.cloud';

type BackendApiResult = {
    status: number;
    data: unknown;
    raw: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function unwrapBackendAuthResponse<TJson = unknown>(
    response: BackendApiResult,
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

async function getConfig({ endpoint = '' } = {}) {
    const response = await backend.app.BackendAuthConfigGet({
        endpoint: normalizeVrchatEndpoint(endpoint)
    });
    return unwrapBackendAuthResponse(response, 'config', endpoint);
}

async function getCurrentUser({ endpoint = '' } = {}) {
    const response = await backend.app.BackendAuthCurrentUserGet({
        endpoint: normalizeVrchatEndpoint(endpoint)
    });
    return unwrapBackendAuthResponse(response, 'auth/user', endpoint);
}

async function getAuthSession({ endpoint = '' } = {}) {
    const response = await backend.app.BackendAuthSessionGet({
        endpoint: normalizeVrchatEndpoint(endpoint)
    });
    return unwrapBackendAuthResponse(response, 'auth', endpoint);
}

async function loginWithBasicAuth({ username, password, endpoint = '' }) {
    const response = await backend.app.BackendAuthLoginBasic({
        endpoint: normalizeVrchatEndpoint(endpoint),
        username: typeof username === 'string' ? username : String(username ?? ''),
        password: typeof password === 'string' ? password : String(password ?? '')
    });
    return unwrapBackendAuthResponse(response, 'auth/user', endpoint);
}

async function verifyTOTP({ code, endpoint = '' }) {
    const response = await backend.app.BackendAuthTotpVerify({
        endpoint: normalizeVrchatEndpoint(endpoint),
        code: typeof code === 'string' ? code : String(code ?? '')
    });
    return unwrapBackendAuthResponse(
        response,
        'auth/twofactorauth/totp/verify',
        endpoint
    );
}

async function verifyOTP({ code, endpoint = '' }) {
    const response = await backend.app.BackendAuthOtpVerify({
        endpoint: normalizeVrchatEndpoint(endpoint),
        code: typeof code === 'string' ? code : String(code ?? '')
    });
    return unwrapBackendAuthResponse(
        response,
        'auth/twofactorauth/otp/verify',
        endpoint
    );
}

async function verifyEmailOTP({ code, endpoint = '' }) {
    const response = await backend.app.BackendAuthEmailOtpVerify({
        endpoint: normalizeVrchatEndpoint(endpoint),
        code: typeof code === 'string' ? code : String(code ?? '')
    });
    return unwrapBackendAuthResponse(
        response,
        'auth/twofactorauth/emailotp/verify',
        endpoint
    );
}

async function getOnlineVisits({ endpoint = '' } = {}) {
    const response = await backend.app.BackendAuthVisitsGet({
        endpoint: normalizeVrchatEndpoint(endpoint)
    });
    return unwrapBackendAuthResponse(response, 'visits', endpoint);
}

async function getFileAnalysis({
    endpoint = '',
    fileId,
    version,
    variant
}) {
    const response = await backend.app.BackendAuthFileAnalysisGet({
        endpoint: normalizeVrchatEndpoint(endpoint),
        fileId: typeof fileId === 'string' ? fileId : String(fileId ?? ''),
        version: Number(version) || 0,
        variant: typeof variant === 'string' ? variant : String(variant ?? '')
    });
    return unwrapBackendAuthResponse(
        response,
        `analysis/${encodeURIComponent(String(fileId ?? ''))}/${Number(version) || 0}/${encodeURIComponent(String(variant ?? ''))}`,
        endpoint
    );
}

const vrchatAuthRepository = Object.freeze({
    getConfig,
    getCurrentUser,
    getAuthSession,
    loginWithBasicAuth,
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
    loginWithBasicAuth,
    verifyTOTP,
    verifyOTP,
    verifyEmailOTP,
    getOnlineVisits,
    getFileAnalysis
};
export default vrchatAuthRepository;
