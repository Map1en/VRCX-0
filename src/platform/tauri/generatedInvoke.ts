import { recordErrorLog } from '../../services/errorLogService';
import { notifySQLiteError } from '../../shared/sqliteErrorEvents';
import { normalizePlatformError } from './errors';
import { invokeTauri } from './invoke';
import { queueTelemetryEvent } from './telemetryQueue';

export interface CommandPromise<TResult> extends Promise<TResult> {
    catch<TResult2 = never>(
        onrejected?:
            | ((reason: Error) => TResult2 | PromiseLike<TResult2>)
            | null
    ): Promise<TResult | TResult2>;
}

const SLOW_COMMAND_MS = 200;

function recordSlowCommand(command: string, startedAt: number): void {
    const duration = performance.now() - startedAt;
    if (duration < SLOW_COMMAND_MS) {
        return;
    }
    queueTelemetryEvent({
        type: 'slowCommand',
        command,
        duration_ms: Math.round(duration)
    });
}

export function invoke<TReturn = unknown>(
    command: string,
    args?: Record<string, unknown>
): CommandPromise<TReturn> {
    const startedAt = performance.now();
    const request = invokeTauri<TReturn>(command, args);
    void request.then(
        () => recordSlowCommand(command, startedAt),
        () => recordSlowCommand(command, startedAt)
    );
    return request.catch((error) => {
        const normalizedError = normalizePlatformError(
            error,
            `Tauri command failed: ${command}`
        );

        recordErrorLog('rust:command', [
            `command: ${command}`,
            normalizedError
        ]);
        notifySQLiteError(normalizedError);

        throw normalizedError;
    });
}
