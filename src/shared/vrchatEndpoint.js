export const DEFAULT_VRCHAT_API_ENDPOINT = 'https://api.vrchat.cloud/api/1';

function normalizeEndpointValue(endpoint) {
    return typeof endpoint === 'string'
        ? endpoint.trim()
        : String(endpoint ?? '').trim();
}

export function normalizeVrchatEndpoint(endpoint = '', options = {}) {
    const explicitEndpoint = normalizeEndpointValue(endpoint);
    if (explicitEndpoint) {
        return explicitEndpoint;
    }

    if (options.allowDebugEndpoint) {
        const debugEndpoint = normalizeEndpointValue(
            globalThis?.$debug?.endpointDomain
        );
        if (debugEndpoint) {
            return debugEndpoint;
        }
    }

    return DEFAULT_VRCHAT_API_ENDPOINT;
}

export function normalizeVrchatEndpointKey(endpoint = '') {
    return normalizeEndpointValue(endpoint).replace(/\/+$/, '');
}

export function normalizeVrchatEndpointDomain(endpoint = '', options = {}) {
    return normalizeVrchatEndpoint(endpoint, options).replace(/\/+$/, '');
}

export function getVrchatEndpointBase(endpoint = '', options = {}) {
    return `${normalizeVrchatEndpointDomain(endpoint, options)}/`;
}
