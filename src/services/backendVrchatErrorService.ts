import {
    createRequestError,
    isVrchatMissingCredentialsError,
    notifyVrchatAuthFailure,
    type VrchatRequestError
} from '@/repositories/vrchatRequest.js';

function asErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error ?? '');
}

export function notifyBackendVrchatAuthFailure(
    error: unknown,
    endpoint = '',
    path = 'backend/social-baseline'
): void {
    const message = asErrorMessage(error);
    if (!message.includes('Missing Credentials')) {
        return;
    }

    const requestError = createRequestError(
        message,
        401,
        path,
        null
    ) as VrchatRequestError;
    requestError.endpoint = endpoint;
    if (isVrchatMissingCredentialsError(requestError)) {
        notifyVrchatAuthFailure(requestError);
    }
}
