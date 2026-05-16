import { backend } from '@/platform/index.js';
import type {
    BackendAppSnapshot,
    BackendBackgroundJobSnapshot,
    BackendDiagnosticsSnapshot,
    BackendRuntimeSnapshot,
    BackendSyncSnapshot
} from '@/platform/tauri/backend.js';

async function getAppSnapshot(): Promise<BackendAppSnapshot> {
    return backend.app.BackendAppSnapshotGet();
}

async function getRuntimeSnapshot(): Promise<BackendRuntimeSnapshot> {
    return backend.app.BackendRuntimeSnapshotGet();
}

async function getBackgroundJobsSnapshot(): Promise<
    BackendBackgroundJobSnapshot[]
> {
    return backend.app.BackendBackgroundJobsSnapshotGet();
}

async function getSyncSnapshot(): Promise<BackendSyncSnapshot> {
    return backend.app.BackendSyncSnapshotGet();
}

async function getDiagnostics(): Promise<BackendDiagnosticsSnapshot> {
    return backend.app.BackendDiagnosticsGet();
}

const backendRuntimeRepository = Object.freeze({
    getAppSnapshot,
    getBackgroundJobsSnapshot,
    getDiagnostics,
    getRuntimeSnapshot,
    getSyncSnapshot
});

export {
    getAppSnapshot,
    getBackgroundJobsSnapshot,
    getDiagnostics,
    getRuntimeSnapshot,
    getSyncSnapshot
};

export default backendRuntimeRepository;
