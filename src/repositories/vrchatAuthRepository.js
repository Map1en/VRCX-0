import { DEFAULT_VRCHAT_API_ENDPOINT } from '@/shared/vrchatEndpoint.js';

import { executeVrchatRequest } from './vrchatRequest.js';

export const DEFAULT_ENDPOINT_DOMAIN = DEFAULT_VRCHAT_API_ENDPOINT;
export const DEFAULT_WEBSOCKET_DOMAIN = 'wss://pipeline.vrchat.cloud';

async function execute(
    path,
    { endpoint = '', method = 'GET', headers = {}, params = null } = {}
) {
    return executeVrchatRequest(path, {
        endpoint,
        method,
        headers,
        body: params,
        normalizeEndpoint: true,
        fallbackMessage: 'VRChat request failed',
        returnEndpointDomain: true
    });
}

async function executeGet(path, options = {}) {
    return execute(path, { ...options, method: 'GET' });
}

async function executePost(path, params, options = {}) {
    return execute(path, { ...options, method: 'POST', params });
}

async function getConfig({ endpoint = '' } = {}) {
    return executeGet('config', { endpoint });
}

async function getCurrentUser({ endpoint = '' } = {}) {
    return executeGet('auth/user', { endpoint });
}

async function getAuthSession({ endpoint = '' } = {}) {
    return executeGet('auth', { endpoint });
}

async function loginWithBasicAuth({ username, password, endpoint = '' }) {
    const auth = globalThis.btoa(
        `${encodeURIComponent(username)}:${encodeURIComponent(password)}`
    );

    return executeGet('auth/user', {
        endpoint,
        headers: {
            Authorization: `Basic ${auth}`
        }
    });
}

async function verifyTOTP({ code, endpoint = '' }) {
    return executePost(
        'auth/twofactorauth/totp/verify',
        { code: typeof code === 'string' ? code.trim() : '' },
        { endpoint }
    );
}

async function verifyOTP({ code, endpoint = '' }) {
    const normalizedCode =
        typeof code === 'string' ? code.replace(/\s+/g, '') : '';
    const formattedCode =
        normalizedCode.length > 4 && !normalizedCode.includes('-')
            ? `${normalizedCode.slice(0, 4)}-${normalizedCode.slice(4)}`
            : normalizedCode;

    return executePost(
        'auth/twofactorauth/otp/verify',
        { code: formattedCode },
        { endpoint }
    );
}

async function verifyEmailOTP({ code, endpoint = '' }) {
    return executePost(
        'auth/twofactorauth/emailotp/verify',
        { code: typeof code === 'string' ? code.trim() : '' },
        { endpoint }
    );
}

const vrchatAuthRepository = Object.freeze({
    execute,
    executeGet,
    executePost,
    getConfig,
    getCurrentUser,
    getAuthSession,
    loginWithBasicAuth,
    verifyTOTP,
    verifyOTP,
    verifyEmailOTP
});

export {
    execute,
    executeGet,
    executePost,
    getConfig,
    getCurrentUser,
    getAuthSession,
    loginWithBasicAuth,
    verifyTOTP,
    verifyOTP,
    verifyEmailOTP
};
export default vrchatAuthRepository;
