import { externalApiRepository } from '@/repositories/index.js';
import { backend } from '@/platform/index.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

const OK_POLL_MS = 15 * 60 * 1000;
const ISSUE_POLL_MS = 2 * 60 * 1000;
const FOCUS_REFRESH_MS = 60 * 1000;
const POLL_EXECUTOR_TICK_MS = FOCUS_REFRESH_MS;
const VRC_STATUS_REFRESH_JOB = 'vrcStatusRefresh';

type VrcStatusStatus = Record<string, unknown> & {
    description?: unknown;
    indicator?: unknown;
};
type VrcStatusPage = Record<string, unknown> & {
    updated_at?: unknown;
};
type VrcStatusComponent = Record<string, unknown> & {
    name?: unknown;
    status?: unknown;
};
type VrcStatusResponse = Record<string, unknown> & {
    status?: VrcStatusStatus;
    page?: VrcStatusPage;
    components?: unknown;
};

let pollingTimer: ReturnType<typeof window.setTimeout> | null = null;
let pollingActive = false;
let pollingGeneration = 0;

function pollingCadenceSeconds(intervalMs: unknown): number {
    const interval = Number(intervalMs) || OK_POLL_MS;
    return Math.max(60, Math.ceil(interval / 1000));
}

function parseResponse(data: unknown): unknown {
    if (!data) {
        return null;
    }
    if (typeof data === 'object') {
        return data;
    }
    return JSON.parse(data as string);
}

async function getJson(path: string): Promise<VrcStatusResponse | null> {
    const response = await externalApiRepository.fetchVrcStatusJson(path);

    if (response.status !== 200) {
        throw new Error(`VRChat status request failed (${response.status})`);
    }

    return parseResponse(response.data) as VrcStatusResponse | null;
}

async function fetchSummary(): Promise<string> {
    const data = await getJson('summary.json');
    const components = Array.isArray(data?.components)
        ? (data.components as VrcStatusComponent[])
        : [];
    return components
        .filter(
            (component) =>
                component?.status && component.status !== 'operational'
        )
        .map((component) => component.name)
        .filter(Boolean)
        .join(', ');
}

export async function refreshVrcStatus(): Promise<void> {
    const runtimeStore = useRuntimeStore.getState();

    try {
        const data = await getJson('status.json');
        const description = data?.status?.description || '';
        const indicator = data?.status?.indicator || '';
        const updatedAt = data?.page?.updated_at || null;

        if (description === 'All Systems Operational') {
            runtimeStore.setVrcStatusState({
                status: '',
                indicator: '',
                summary: '',
                updatedAt,
                lastFetchedAt: new Date().toISOString(),
                pollingIntervalMs: OK_POLL_MS,
                error: ''
            });
            return;
        }

        runtimeStore.setVrcStatusState({
            status: description,
            indicator,
            summary: await fetchSummary(),
            updatedAt,
            lastFetchedAt: new Date().toISOString(),
            pollingIntervalMs: ISSUE_POLL_MS,
            error: ''
        });
    } catch (error) {
        runtimeStore.setVrcStatusState({
            status: 'Failed to fetch VRC status',
            indicator: 'minor',
            summary: '',
            lastFetchedAt: new Date().toISOString(),
            pollingIntervalMs: ISSUE_POLL_MS,
            error: error instanceof Error ? error.message : String(error)
        });
        throw error;
    }
}

async function deferNextVrcStatusRefresh(): Promise<void> {
    const interval = useRuntimeStore.getState().vrcStatus.pollingIntervalMs;
    await backend.app
        .BackendBackgroundFrontendJobDefer({
            name: VRC_STATUS_REFRESH_JOB,
            delaySeconds: pollingCadenceSeconds(interval)
        })
        .catch((error) => {
            console.warn('Failed to defer VRC status refresh:', error);
        });
}

async function claimVrcStatusRefreshDue(): Promise<boolean> {
    const interval = useRuntimeStore.getState().vrcStatus.pollingIntervalMs;
    return backend.app
        .BackendBackgroundFrontendJobDueClaim({
            name: VRC_STATUS_REFRESH_JOB,
            cadenceSeconds: pollingCadenceSeconds(interval),
            initialDelaySeconds: 0
        })
        .catch((error) => {
            console.warn('Failed to claim VRC status refresh schedule:', error);
            return true;
        });
}

export function handleBrowserFocus(): Promise<void> {
    const { vrcStatus } = useRuntimeStore.getState();
    const lastFetchedAt = Date.parse((vrcStatus.lastFetchedAt || '') as string);
    if (
        Number.isFinite(lastFetchedAt) &&
        Date.now() - lastFetchedAt < FOCUS_REFRESH_MS
    ) {
        return Promise.resolve();
    }

    return refreshVrcStatus().finally(() => deferNextVrcStatusRefresh());
}

export function startVrcStatusPolling(): () => void {
    if (pollingActive) {
        return stopVrcStatusPolling;
    }

    pollingActive = true;
    pollingGeneration += 1;
    const generation = pollingGeneration;

    const tick = async (): Promise<void> => {
        let due = false;
        try {
            due = await claimVrcStatusRefreshDue();
            if (due) {
                await refreshVrcStatus();
            }
        } catch (error) {
            console.warn('VRChat status refresh failed:', error);
        } finally {
            if (due) {
                await deferNextVrcStatusRefresh();
            }
        }

        if (!pollingActive || generation !== pollingGeneration) {
            return;
        }

        pollingTimer = window.setTimeout(tick, POLL_EXECUTOR_TICK_MS);
    };

    tick();
    return stopVrcStatusPolling;
}

export function stopVrcStatusPolling(): void {
    pollingActive = false;
    pollingGeneration += 1;

    if (pollingTimer !== null) {
        window.clearTimeout(pollingTimer);
        pollingTimer = null;
    }
}
