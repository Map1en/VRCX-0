import {
    getVrchatEndpointBase,
    normalizeVrchatEndpoint
} from '@/shared/vrchatEndpoint.js';

import { safeJsonParse } from './baseRepository.js';
import webRepository from './webRepository.js';

const JSON_CONTENT_TYPE = 'application/json;charset=utf-8';

function shouldSkipQueryValue(value, { skipEmptyString = false } = {}) {
    return (
        value === null ||
        value === undefined ||
        (skipEmptyString && value === '')
    );
}

function serializeQueryValue(value) {
    return value instanceof Date ? value.toISOString() : String(value);
}

export function appendParams(url, params = {}, options = {}) {
    if (!params || typeof params !== 'object') {
        return url;
    }

    for (const [key, value] of Object.entries(params)) {
        if (shouldSkipQueryValue(value, options)) {
            continue;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                if (shouldSkipQueryValue(item, options)) {
                    continue;
                }
                url.searchParams.append(key, serializeQueryValue(item));
            }
            continue;
        }

        url.searchParams.set(key, serializeQueryValue(value));
    }

    return url;
}

export function buildUrl(path, params = {}, endpoint = '', options = {}) {
    const url = new URL(
        path,
        getVrchatEndpointBase(endpoint, {
            allowDebugEndpoint: Boolean(options.allowDebugEndpoint)
        })
    );
    return appendParams(url, params, options).toString();
}

export function parseJsonResponse(data) {
    if (data === null || data === undefined || data === '') {
        return data ?? null;
    }

    if (typeof data !== 'string') {
        return data;
    }

    return safeJsonParse(data, data);
}

export function unwrapErrorMessage(
    json,
    status,
    { fallbackMessage = 'VRChat request failed' } = {}
) {
    if (typeof json === 'string' && json.trim()) {
        return json.replace(/^"+|"+$/g, '');
    }

    const message = json?.error?.message ?? json?.message;
    if (typeof message === 'string' && message.trim()) {
        return message.replace(/^"+|"+$/g, '');
    }

    return `${fallbackMessage} (${status})`;
}

export function createRequestError(message, status, endpoint, payload = null) {
    const error = new Error(message);
    error.status = status;
    error.endpoint = endpoint;
    error.payload = payload;
    return error;
}

function normalizeJsonBody(value) {
    return value && typeof value === 'object' ? value : {};
}

export async function executeVrchatRequest(
    path,
    {
        endpoint = '',
        method = 'GET',
        params = null,
        headers = {},
        allowDebugEndpoint = false,
        normalizeEndpoint = false,
        fallbackMessage = 'VRChat request failed',
        decorateError = true,
        includeParams = false,
        returnEndpointDomain = false,
        skipEmptyQueryString = false,
        jsonBody = method !== 'GET',
        body = params,
        queryParams = null,
        extra = {}
    } = {}
) {
    const requestMethod = String(method || 'GET').toUpperCase();
    const endpointDomain = normalizeEndpoint
        ? normalizeVrchatEndpoint(endpoint)
        : endpoint;
    const resolvedQueryParams =
        queryParams ?? (requestMethod === 'GET' ? (params ?? {}) : {});
    const requestOptions = {
        url: buildUrl(path, resolvedQueryParams, endpointDomain, {
            allowDebugEndpoint,
            skipEmptyString: skipEmptyQueryString
        }),
        method: requestMethod
    };

    if (headers && Object.keys(headers).length > 0) {
        requestOptions.headers = headers;
    }

    if (requestMethod !== 'GET' && jsonBody) {
        requestOptions.headers = {
            'Content-Type': JSON_CONTENT_TYPE,
            ...headers
        };
        requestOptions.body = JSON.stringify(normalizeJsonBody(body));
    }

    const response = await webRepository.execute(requestOptions);
    const json = parseJsonResponse(response.data);

    if (
        response.status >= 400 ||
        (json && typeof json === 'object' && 'error' in json)
    ) {
        const message = unwrapErrorMessage(json, response.status, {
            fallbackMessage
        });
        if (decorateError) {
            throw createRequestError(message, response.status, path, json);
        }
        throw new Error(message);
    }

    return {
        json,
        ...(includeParams ? { params: params ?? {} } : {}),
        ...extra,
        status: response.status,
        ...(returnEndpointDomain ? { endpointDomain } : {}),
        raw: response.raw
    };
}
