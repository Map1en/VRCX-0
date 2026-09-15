import { invokeTauri } from '@/platform/tauri/invoke';
import { isRecord } from '@/shared/utils/record';

const HTTP_ERROR_STATUS_MIN = 400;
const HTTP_ERROR_STATUS_MAX = 599;
const MAX_MESSAGE_LENGTH = 12000;
const MAX_OBJECT_DEPTH = 3;

let installed = false;
let flushingLogQueue = false;
let originalConsoleError: ((...data: unknown[]) => void) | null = null;
const logQueue: string[] = [];

function pad(value: number, length: number = 2): string {
    return String(value).padStart(length, '0');
}

function formatLocalTimestamp(date: Date): string {
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absoluteOffset = Math.abs(offsetMinutes);

    return [
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`,
        `${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`
    ].join(' ');
}

function truncate(value: string): string {
    if (value.length <= MAX_MESSAGE_LENGTH) {
        return value;
    }

    return `${value.slice(0, MAX_MESSAGE_LENGTH)}\n... <truncated>`;
}

function serializeValue(
    value: unknown,
    depth: number = 0,
    seen: Set<unknown> = new Set<unknown>()
): string {
    if (value instanceof Error) {
        const details = value.stack || value.message || value.name;
        const diagnosticFields: string[] = [];
        if (isRecord(value)) {
            for (const key of [
                'code',
                'sqliteCategory',
                'statusCode',
                'port'
            ] as const) {
                const fieldValue = value[key];
                if (
                    typeof fieldValue === 'string' ||
                    typeof fieldValue === 'number'
                ) {
                    diagnosticFields.push(`${key}: ${fieldValue}`);
                }
            }
        }
        return [details, ...diagnosticFields].join('\n');
    }

    if (typeof value === 'string') {
        return value;
    }

    if (
        value === null ||
        value === undefined ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'bigint'
    ) {
        return String(value);
    }

    if (!isRecord(value)) {
        return String(value);
    }

    if (seen.has(value)) {
        return '[Circular]';
    }

    if (depth >= MAX_OBJECT_DEPTH) {
        return Object.prototype.toString.call(value);
    }

    try {
        seen.add(value);
        return JSON.stringify(
            value,
            (_: string, nestedValue: unknown) => {
                if (nestedValue instanceof Error) {
                    return {
                        name: nestedValue.name,
                        message: nestedValue.message,
                        stack: nestedValue.stack
                    };
                }
                return nestedValue;
            },
            2
        );
    } catch {
        return String(value);
    } finally {
        seen.delete(value);
    }
}

function collectText(
    value: unknown,
    depth: number = 0,
    seen: Set<unknown> = new Set<unknown>()
): string {
    if (value instanceof Error) {
        return [value.name, value.message, value.stack]
            .filter(Boolean)
            .join('\n');
    }

    if (typeof value === 'string') {
        return value;
    }

    if (!isRecord(value) || seen.has(value) || depth > MAX_OBJECT_DEPTH) {
        return '';
    }

    seen.add(value);
    const parts: string[] = [];
    for (const key of ['message', 'statusText', 'url', 'endpoint', 'stack']) {
        const field = value[key];
        if (typeof field === 'string') {
            parts.push(field);
        }
    }

    for (const key of ['error', 'cause', 'reason', 'response']) {
        const field = value[key];
        const text = collectText(field, depth + 1, seen);
        if (text) {
            parts.push(text);
        }
    }
    seen.delete(value);
    return parts.join('\n');
}

function hasHttpErrorStatus(
    value: unknown,
    depth: number = 0,
    seen: Set<unknown> = new Set<unknown>()
): boolean {
    if (!isRecord(value) || seen.has(value) || depth > MAX_OBJECT_DEPTH) {
        return false;
    }

    seen.add(value);
    for (const key of ['status', 'statusCode']) {
        const status = Number(value[key]);
        if (
            Number.isInteger(status) &&
            status >= HTTP_ERROR_STATUS_MIN &&
            status <= HTTP_ERROR_STATUS_MAX
        ) {
            seen.delete(value);
            return true;
        }
    }

    for (const key of ['error', 'cause', 'reason', 'response']) {
        if (hasHttpErrorStatus(value[key], depth + 1, seen)) {
            seen.delete(value);
            return true;
        }
    }

    seen.delete(value);
    return false;
}

const NETWORK_ERROR_MARKERS = [
    'failed to load resource',
    'web api execution failed',
    'vrchat request failed',
    'github release request failed',
    'translation api error',
    'avatar search failed',
    'media file upload failed',
    'update download failed'
];

function isVrchatWorldGetTransportFailure(text: string): boolean {
    const lower = text.toLowerCase();
    const isWorldGetCommand =
        lower.includes('command: app__world_get') ||
        lower.includes('tauri command failed: app__world_get');

    return (
        isWorldGetCommand &&
        lower.includes('error sending request for url') &&
        /https:\/\/api\.vrchat\.cloud\/api\/1\/worlds\//i.test(text)
    );
}

function hasNetworkErrorText(text: string): boolean {
    const lower = text.toLowerCase();
    if (NETWORK_ERROR_MARKERS.some((marker) => lower.includes(marker))) {
        return true;
    }

    return [
        /\bHTTP\s+(?:4\d\d|5\d\d)\b/i,
        /\bstatus(?:Code|\s+code)?[:=]?\s*(?:4\d\d|5\d\d)\b/i,
        /\b(?:GET|POST|PUT|PATCH|DELETE)\b[^\n]*(?:4\d\d|5\d\d)\b/i,
        /\brequest failed\s*\((?:4\d\d|5\d\d)\)/i,
        /\berror:\s*\{?[^\n]*(?:4\d\d|5\d\d)\b/i
    ].some((pattern) => pattern.test(text));
}

function shouldSkipErrorLog(values: unknown[]): boolean {
    if (values.some((value) => hasHttpErrorStatus(value))) {
        return true;
    }

    const text = values.map((value) => collectText(value)).join('\n');
    return hasNetworkErrorText(text) || isVrchatWorldGetTransportFailure(text);
}

function formatEntry(source: string, lines: string[]): string {
    const now = new Date();
    return truncate(
        [
            `[${formatLocalTimestamp(now)}] [${now.toISOString()}] [${source}]`,
            ...lines.filter(Boolean)
        ].join('\n')
    );
}

async function flushLogQueue(): Promise<void> {
    if (flushingLogQueue) {
        return;
    }

    flushingLogQueue = true;
    try {
        while (logQueue.length > 0) {
            const nextEntry = logQueue.shift();
            try {
                await invokeTauri('app__append_error_log', {
                    entry: nextEntry || ''
                });
            } catch {
                // Logging must never affect the app path that produced the error.
            }
        }
    } catch {
        // Logging must never affect the app path that produced the error.
    } finally {
        flushingLogQueue = false;
        if (logQueue.length > 0) {
            flushLogQueue();
        }
    }
}

async function appendEntry(entry: string): Promise<void> {
    logQueue.push(entry);
    await flushLogQueue();
}

export async function recordErrorLog(
    source: string,
    values: unknown
): Promise<void> {
    const normalizedValues = Array.isArray(values) ? values : [values];
    if (shouldSkipErrorLog(normalizedValues)) {
        return;
    }

    const entry = formatEntry(
        source,
        normalizedValues.map((value) => serializeValue(value))
    );
    await appendEntry(entry);
}

function handleWindowError(event: Event): void {
    if (typeof ErrorEvent !== 'undefined' && !(event instanceof ErrorEvent)) {
        return;
    }

    if (event.target && event.target !== window) {
        return;
    }

    const error = 'error' in event ? event.error : undefined;
    const message = 'message' in event ? event.message : undefined;
    const filename = 'filename' in event ? event.filename : undefined;
    const lineno = 'lineno' in event ? event.lineno : undefined;
    const colno = 'colno' in event ? event.colno : undefined;
    const values = [
        error,
        message,
        filename ? `${filename}:${lineno || 0}:${colno || 0}` : ''
    ].filter(Boolean);

    recordErrorLog('js:error', values);
}

function handleUnhandledRejection(event: PromiseRejectionEvent): void {
    recordErrorLog('js:unhandledrejection', [
        event.reason || 'Unhandled promise rejection'
    ]);
}

function installConsoleErrorCapture(): void {
    if (originalConsoleError) {
        return;
    }

    const capturedConsoleError = console.error.bind(console);
    originalConsoleError = capturedConsoleError;
    console.error = (...args: unknown[]) => {
        capturedConsoleError(...args);
        recordErrorLog('js:console.error', args);
    };
}

export function installErrorLogging() {
    if (installed || typeof window === 'undefined') {
        return;
    }

    installed = true;
    window.addEventListener('error', handleWindowError, true);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    installConsoleErrorCapture();
}
