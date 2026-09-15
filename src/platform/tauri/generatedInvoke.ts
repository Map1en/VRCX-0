import { recordErrorLog } from '../../services/errorLogService';
import { notifySQLiteError } from '../../shared/sqliteErrorEvents';
import { normalizePlatformError } from './errors';
import { invokeTauri } from './invoke';

export interface CommandPromise<TResult> extends Promise<TResult> {
    catch<TResult2 = never>(
        onrejected?:
            | ((reason: Error) => TResult2 | PromiseLike<TResult2>)
            | null
    ): Promise<TResult | TResult2>;
}

export function invoke<TReturn = unknown>(
    command: string,
    args?: Record<string, unknown>
): CommandPromise<TReturn> {
    return invokeTauri<TReturn>(command, args).catch((error) => {
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
