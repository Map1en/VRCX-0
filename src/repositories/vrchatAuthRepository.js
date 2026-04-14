import webRepository from './webRepository.js';
import { safeJsonParse } from './baseRepository.js';

export const DEFAULT_ENDPOINT_DOMAIN = 'https://api.vrchat.cloud/api/1';
export const DEFAULT_WEBSOCKET_DOMAIN = 'wss://pipeline.vrchat.cloud';

function normalizeEndpointDomain(endpointDomain) {
    if (typeof endpointDomain === 'string' && endpointDomain.trim()) {
        return endpointDomain.trim();
    }

    return DEFAULT_ENDPOINT_DOMAIN;
}

function buildUrl(path, endpointDomain) {
    const baseUrl = normalizeEndpointDomain(endpointDomain).replace(/\/?$/, '/');
    return new URL(path, baseUrl).toString();
}

function parseJsonResponse(data) {
    if (data === null || data === undefined || data === '') {
        return data ?? null;
    }

    if (typeof data !== 'string') {
        return data;
    }

    return safeJsonParse(data, data);
}

function unwrapErrorMessage(json, status) {
    if (typeof json === 'string' && json.trim()) {
        return json.replace(/^"+|"+$/g, '');
    }

    const message = json?.error?.message ?? json?.message;
    if (typeof message === 'string' && message.trim()) {
        return message.replace(/^"+|"+$/g, '');
    }

    return `VRChat request failed (${status})`;
}

function createAuthError(message, status, endpoint, payload = null) {
    const error = new Error(message);
    error.status = status;
    error.endpoint = endpoint;
    error.payload = payload;
    return error;
}

class VrchatAuthRepository {
    async execute(path, { endpoint = '', method = 'GET', headers = {}, params = null } = {}) {
        const endpointDomain = normalizeEndpointDomain(endpoint);
        const requestOptions = {
            url: buildUrl(path, endpointDomain),
            method,
            headers
        };

        if (method !== 'GET') {
            requestOptions.headers = {
                'Content-Type': 'application/json;charset=utf-8',
                ...headers
            };
            requestOptions.body = JSON.stringify(params ?? {});
        }

        const response = await webRepository.execute(requestOptions);
        const json = parseJsonResponse(response.data);

        if (response.status >= 400) {
            throw createAuthError(
                unwrapErrorMessage(json, response.status),
                response.status,
                path,
                json
            );
        }

        if (json && typeof json === 'object' && 'error' in json) {
            throw createAuthError(
                unwrapErrorMessage(json, response.status),
                response.status,
                path,
                json
            );
        }

        return {
            json,
            status: response.status,
            endpointDomain,
            raw: response.raw
        };
    }

    async executeGet(path, options = {}) {
        return this.execute(path, { ...options, method: 'GET' });
    }

    async executePost(path, params, options = {}) {
        return this.execute(path, { ...options, method: 'POST', params });
    }

    async getConfig({ endpoint = '' } = {}) {
        return this.executeGet('config', { endpoint });
    }

    async getCurrentUser({ endpoint = '' } = {}) {
        return this.executeGet('auth/user', { endpoint });
    }

    async getAuthSession({ endpoint = '' } = {}) {
        return this.executeGet('auth', { endpoint });
    }

    async loginWithBasicAuth({ username, password, endpoint = '' }) {
        const auth = globalThis.btoa(
            `${encodeURIComponent(username)}:${encodeURIComponent(password)}`
        );

        return this.executeGet('auth/user', {
            endpoint,
            headers: {
                Authorization: `Basic ${auth}`
            }
        });
    }

    async verifyTOTP({ code, endpoint = '' }) {
        return this.executePost(
            'auth/twofactorauth/totp/verify',
            { code: typeof code === 'string' ? code.trim() : '' },
            { endpoint }
        );
    }

    async verifyOTP({ code, endpoint = '' }) {
        const normalizedCode = typeof code === 'string' ? code.replace(/\s+/g, '') : '';
        const formattedCode =
            normalizedCode.length > 4 && !normalizedCode.includes('-')
                ? `${normalizedCode.slice(0, 4)}-${normalizedCode.slice(4)}`
                : normalizedCode;

        return this.executePost(
            'auth/twofactorauth/otp/verify',
            { code: formattedCode },
            { endpoint }
        );
    }

    async verifyEmailOTP({ code, endpoint = '' }) {
        return this.executePost(
            'auth/twofactorauth/emailotp/verify',
            { code: typeof code === 'string' ? code.trim() : '' },
            { endpoint }
        );
    }
}

const vrchatAuthRepository = new VrchatAuthRepository();

export { VrchatAuthRepository };
export default vrchatAuthRepository;
