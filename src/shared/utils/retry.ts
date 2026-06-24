import { delay as waitForDelay } from './delays';

type BackoffOptions = {
    maxRetries?: number;
    baseDelay?: number;
    shouldRetry?: (error: unknown) => boolean;
    isCancelled?: () => boolean;
};

const BACKOFF_CANCELLED_MESSAGE = 'cancelled';
const BACKOFF_CANCEL_CHECK_INTERVAL_MS = 100;

function createBackoffCancelledError() {
    const error = new Error(BACKOFF_CANCELLED_MESSAGE) as Error & {
        cancelled?: boolean;
    };
    error.cancelled = true;
    return error;
}

export function isBackoffCancelledError(error: unknown) {
    return Boolean(
        error &&
            typeof error === 'object' &&
            (error as { cancelled?: unknown }).cancelled === true
    );
}

type CancelCheck = (() => boolean) | null;

function throwIfCancelled(isCancelled: CancelCheck) {
    if (isCancelled?.()) {
        throw createBackoffCancelledError();
    }
}

async function sleepWithCancel(
    delay: number,
    isCancelled: CancelCheck
): Promise<void> {
    if (!isCancelled) {
        await waitForDelay(delay);
        return;
    }

    let remaining = delay;
    while (remaining > 0) {
        throwIfCancelled(isCancelled);
        const wait = Math.min(remaining, BACKOFF_CANCEL_CHECK_INTERVAL_MS);
        await waitForDelay(wait);
        remaining -= wait;
    }
    throwIfCancelled(isCancelled);
}

export async function executeWithBackoff<T>(
    fn: () => Promise<T> | T,
    options: BackoffOptions = {}
): Promise<T> {
    const {
        maxRetries = 5,
        baseDelay = 1000,
        shouldRetry = () => true
    } = options;
    const isCancelled = options.isCancelled ?? null;

    async function attempt(remaining: number): Promise<T> {
        try {
            throwIfCancelled(isCancelled);
            return await fn();
        } catch (err) {
            throwIfCancelled(isCancelled);
            if (remaining <= 0 || !shouldRetry(err)) {
                throw err;
            }
            const delay =
                baseDelay *
                Math.pow(2, (options.maxRetries || maxRetries) - remaining);
            await sleepWithCancel(delay, isCancelled);
            return attempt(remaining - 1);
        }
    }

    return attempt(maxRetries);
}
