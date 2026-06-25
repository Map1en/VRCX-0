import { commands } from '@/platform/tauri/bindings';

type RuntimeJobStatus =
    | 'frontend-owned'
    | 'running'
    | 'completed'
    | 'idle'
    | 'error'
    | string;

type RuntimeJobTelemetryRecord = {
    name: string;
    owner?: string;
    cadenceSeconds?: number | null;
    status: RuntimeJobStatus;
    detail?: string;
};

export async function recordRuntimeJobTelemetry(
    record: RuntimeJobTelemetryRecord
): Promise<void> {
    await commands
        .appRuntimeBackgroundJobRecord({
            owner: 'frontend',
            detail: '',
            ...record
        })
        .catch((error: unknown) => {
            console.warn(
                'Failed to record runtime background job state:',
                error
            );
        });
}

export async function runRuntimeTelemetryJob<T>(
    record: Omit<RuntimeJobTelemetryRecord, 'status'>,
    task: () => Promise<T>
): Promise<T> {
    await recordRuntimeJobTelemetry({
        ...record,
        status: 'running'
    });
    try {
        const result = await task();
        await recordRuntimeJobTelemetry({
            ...record,
            status: 'completed',
            detail: record.detail || 'Completed.'
        });
        return result;
    } catch (error) {
        await recordRuntimeJobTelemetry({
            ...record,
            status: 'error',
            detail: error instanceof Error ? error.message : String(error)
        });
        throw error;
    }
}
