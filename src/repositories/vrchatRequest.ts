import { safeJsonParse } from './baseRepository.js';

export type QueryValue = string | number | boolean | Date | null | undefined;
export type QueryParams = Record<string, QueryValue | QueryValue[]>;

export interface VrchatRequestResponse<TJson = unknown> {
    json: TJson;
    params?: QueryParams;
    status: number;
    endpointDomain?: string;
    raw: unknown;
    [key: string]: unknown;
}

export interface VrchatRequestError extends Error {
    status: number;
    endpoint: string;
    payload: unknown;
}

export type VrchatAuthFailureHandler = (
    error: VrchatRequestError
) => void | Promise<void>;

let vrchatAuthFailureHandler: VrchatAuthFailureHandler | null = null;
let vrchatAuthFailureHandlerRegistrationId = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

export function setVrchatAuthFailureHandler(
    handler: VrchatAuthFailureHandler | null
): () => void {
    const registrationId = ++vrchatAuthFailureHandlerRegistrationId;
    vrchatAuthFailureHandler = typeof handler === 'function' ? handler : null;

    return () => {
        if (vrchatAuthFailureHandlerRegistrationId === registrationId) {
            vrchatAuthFailureHandler = null;
        }
    };
}

export function isVrchatMissingCredentialsError(
    error: unknown
): error is VrchatRequestError {
    const status =
        error && typeof error === 'object'
            ? (error as Partial<VrchatRequestError>).status
            : undefined;
    const message =
        error && typeof error === 'object'
            ? (error as Error).message
            : undefined;
    return Boolean(
        error &&
            typeof error === 'object' &&
            (status === 401 ||
                (typeof message === 'string' &&
                    message.includes('Missing Credentials')))
    );
}

export function notifyVrchatAuthFailure(error: VrchatRequestError): void {
    if (!isVrchatMissingCredentialsError(error) || !vrchatAuthFailureHandler) {
        return;
    }

    try {
        void Promise.resolve(vrchatAuthFailureHandler(error)).catch(
            (handlerError) => {
                console.warn(
                    'VRChat auth failure handler failed:',
                    handlerError
                );
            }
        );
    } catch (handlerError) {
        console.warn('VRChat auth failure handler failed:', handlerError);
    }
}

export function parseJsonResponse(data: unknown): unknown {
    if (data === null || data === undefined || data === '') {
        return data ?? null;
    }

    if (typeof data !== 'string') {
        return data;
    }

    return safeJsonParse(data, data);
}

export function unwrapErrorMessage(
    json: unknown,
    status: number,
    { fallbackMessage = 'VRChat request failed' } = {}
): string {
    if (typeof json === 'string' && json.trim()) {
        return json.replace(/^"+|"+$/g, '');
    }

    const jsonRecord = isRecord(json) ? json : null;
    const error = isRecord(jsonRecord?.error) ? jsonRecord.error : null;
    const message = error?.message ?? jsonRecord?.message;
    if (typeof message === 'string' && message.trim()) {
        return message.replace(/^"+|"+$/g, '');
    }

    return `${fallbackMessage} (${status})`;
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
