import { recordErrorLog } from '../../services/errorLogService';
import { notifySQLiteError } from '../../shared/sqliteErrorEvents';
import type { TelemetryClientEvent } from './bindings';
import { normalizePlatformError } from './errors';
import { invokeTauri } from './invoke';

export interface CommandPromise<TResult> extends Promise<TResult> {
    catch<TResult2 = never>(
        onrejected?:
            | ((reason: Error) => TResult2 | PromiseLike<TResult2>)
            | null
    ): Promise<TResult | TResult2>;
}

const SLOW_COMMAND_MS = 200;
const TELEMETRY_RECORD_COMMAND = 'app__telemetry_record_event';

function recordSlowCommand(command: string, startedAt: number): void {
    const duration = performance.now() - startedAt;
    if (duration < SLOW_COMMAND_MS || command === TELEMETRY_RECORD_COMMAND) {
        return;
    }
    const event: TelemetryClientEvent = {
        type: 'slowCommand',
        command,
        duration_ms: Math.round(duration)
    };
    void invokeTauri(TELEMETRY_RECORD_COMMAND, { event }).catch(() => {});
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
