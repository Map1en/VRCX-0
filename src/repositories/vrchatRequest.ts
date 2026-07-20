export type QueryValue = string | number | boolean | Date | null | undefined;
export type QueryParams = Record<string, QueryValue | QueryValue[]>;

export interface VrchatRequestResponse<TJson = unknown> {
    json: TJson;
    params?: QueryParams;
    status?: number;
    endpointDomain?: string;
    [key: string]: unknown;
}

export interface VrchatRequestError extends Error {
    status: number;
    endpoint: string;
    payload: unknown;
}

interface VrchatResponseEnvelope {
    status: number;
    data: unknown;
}

interface UnwrapResponseOptions {
    fallbackMessage?: string;
    responseType?: 'json' | 'text';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

export function isVrchatRequestError(
    error: unknown
): error is VrchatRequestError {
    return Boolean(
        error instanceof Error &&
        isRecord(error) &&
        typeof error.status === 'number' &&
        typeof error.endpoint === 'string'
    );
}

export function isVrchatMissingCredentialsError(error: unknown): boolean {
    const status =
        isRecord(error) && typeof error.status === 'number'
            ? error.status
            : undefined;
    const message = error instanceof Error ? error.message : undefined;
    return Boolean(
        error &&
        typeof error === 'object' &&
        (status === 401 ||
            (typeof message === 'string' &&
                message.includes('Missing Credentials')))
    );
}

function parseResponseData(data: unknown, allowPlainText: boolean): unknown {
    if (data === null || data === undefined || data === '') {
        return data === '' ? '' : null;
    }

    if (typeof data !== 'string') {
        return data;
    }

    if (!data.trim()) {
        return '';
    }

    try {
        return JSON.parse(data);
    } catch (error) {
        if (allowPlainText) {
            return data;
        }
        throw error;
    }
}

interface ErrorMessageOptions {
    fallbackMessage?: string;
}

export function unwrapErrorMessage(
    json: unknown,
    status: number,
    { fallbackMessage = 'VRChat request failed' }: ErrorMessageOptions = {}
): string {
    if (typeof json === 'string' && json.trim()) {
        return json.replace(/^"+|"+$/g, '');
    }

    const jsonRecord = isRecord(json) ? json : null;
    const rawError = jsonRecord?.error;
    if (typeof rawError === 'string' && rawError.trim()) {
        return rawError.replace(/^"+|"+$/g, '');
    }

    const error = isRecord(rawError) ? rawError : null;
    const message = error?.message ?? jsonRecord?.message;
    if (typeof message === 'string' && message.trim()) {
        return message.replace(/^"+|"+$/g, '');
    }

    return `${fallbackMessage} (${status})`;
}

function apiErrorStatus(json: unknown, fallbackStatus: number): number {
    const record = isRecord(json) ? json : null;
    const nestedError = isRecord(record?.error) ? record.error : null;
    const value = nestedError?.status_code ?? record?.status_code;
    const status = Number(value);
    return Number.isInteger(status) && status >= 100 && status <= 599
        ? status
        : fallbackStatus;
}

function hasApiError(json: unknown): boolean {
    if (!isRecord(json)) {
        return false;
    }
    return (
        isRecord(json.error) ||
        (typeof json.error === 'string' && Boolean(json.error.trim()))
    );
}

export function createRequestError(
    message: string,
    status: number,
    endpoint: string,
    payload: unknown = null
): VrchatRequestError {
    const error = new Error(message) as VrchatRequestError;
    error.status = status;
    error.endpoint = endpoint;
    error.payload = payload;
    return error;
}

export function unwrapVrchatResponse<TJson = unknown>(
    response: VrchatResponseEnvelope,
    endpoint: string,
    {
        fallbackMessage = 'VRChat request failed',
        responseType = 'json'
    }: UnwrapResponseOptions = {}
): VrchatRequestResponse<TJson> {
    const requestFailed = response.status < 200 || response.status >= 300;
    let json: unknown;

    try {
        json = parseResponseData(
            response.data,
            requestFailed || responseType === 'text'
        );
    } catch {
        const requestError = createRequestError(
            `${fallbackMessage}: invalid JSON response (${response.status})`,
            response.status,
            endpoint,
            response.data
        );
        throw requestError;
    }

    const apiError = hasApiError(json);
    if (requestFailed || apiError) {
        const status = apiError
            ? apiErrorStatus(json, requestFailed ? response.status : 0)
            : response.status;
        const requestError = createRequestError(
            unwrapErrorMessage(json, status, { fallbackMessage }),
            status,
            endpoint,
            json
        );
        throw requestError;
    }

    return {
        json: json as TJson,
        status: response.status
    };
}
