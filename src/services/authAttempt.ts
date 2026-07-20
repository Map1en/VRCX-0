export type AuthAttempt = number;

let currentAuthAttempt = 0;

export class AuthAttemptSupersededError extends Error {
    readonly code = 'AUTH_ATTEMPT_SUPERSEDED';

    constructor() {
        super('Authentication was superseded by a newer action.');
        this.name = 'AuthAttemptSupersededError';
    }
}

export function beginAuthAttempt(): AuthAttempt {
    currentAuthAttempt += 1;
    return currentAuthAttempt;
}

export function isCurrentAuthAttempt(attempt: AuthAttempt): boolean {
    return attempt === currentAuthAttempt;
}

export function ensureCurrentAuthAttempt(attempt: AuthAttempt): void {
    if (!isCurrentAuthAttempt(attempt)) {
        throw new AuthAttemptSupersededError();
    }
}

export function isAuthAttemptSupersededError(
    error: unknown
): error is AuthAttemptSupersededError {
    return error instanceof AuthAttemptSupersededError;
}
