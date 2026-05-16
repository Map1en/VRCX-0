import { backend } from '@/platform/index.js';

type BackendJobStatus =
    | 'frontend-owned'
    | 'running'
    | 'completed'
    | 'idle'
    | 'error'
    | string;

type BackendJobRecord = {
    name: string;
    owner?: string;
    cadenceSeconds?: number | null;
    status: BackendJobStatus;
    detail?: string;
};

export async function recordBackendBackgroundJob(
    record: BackendJobRecord
): Promise<void> {
    await backend.app.BackendBackgroundJobRecord({
        owner: 'frontend',
        detail: '',
        ...record
    }).catch((error) => {
        console.warn('Failed to record backend background job state:', error);
    });
}

export async function runRecordedBackendJob<T>(
    record: Omit<BackendJobRecord, 'status'>,
    task: () => Promise<T>
): Promise<T> {
    await recordBackendBackgroundJob({
        ...record,
        status: 'running'
    });
    try {
        const result = await task();
        await recordBackendBackgroundJob({
            ...record,
            status: 'completed',
            detail: record.detail || 'Completed.'
        });
        return result;
    } catch (error) {
        await recordBackendBackgroundJob({
            ...record,
            status: 'error',
            detail: error instanceof Error ? error.message : String(error)
        });
        throw error;
    }
}
