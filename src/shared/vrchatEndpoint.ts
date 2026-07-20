export const DEFAULT_VRCHAT_API_ENDPOINT = 'https://api.vrchat.cloud/api/1';

function normalizeEndpointValue(endpoint: unknown): string {
    return typeof endpoint === 'string'
        ? endpoint.trim()
        : String(endpoint ?? '').trim();
}

export function normalizeVrchatEndpoint(endpoint: unknown = ''): string {
    const explicitEndpoint = normalizeEndpointValue(endpoint);
    if (explicitEndpoint) {
        return explicitEndpoint;
    }

    return DEFAULT_VRCHAT_API_ENDPOINT;
}

export function normalizeVrchatEndpointKey(endpoint: unknown = ''): string {
    return normalizeEndpointValue(endpoint).replace(/\/+$/, '');
}

export function normalizeVrchatEndpointDomain(endpoint: unknown = ''): string {
    return normalizeVrchatEndpoint(endpoint).replace(/\/+$/, '');
}

export function getVrchatEndpointBase(endpoint: unknown = ''): string {
    return `${normalizeVrchatEndpointDomain(endpoint)}/`;
}
