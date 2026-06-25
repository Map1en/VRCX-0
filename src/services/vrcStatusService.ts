import { commands } from '@/platform/tauri/bindings';
import externalApiRepository from '@/repositories/externalApiRepository';
import { useRuntimeStore } from '@/state/runtimeStore';

const OK_POLL_MS = 5 * 60 * 1000;
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

function hasStatusIssue(indicator: unknown, description: unknown): boolean {
    const normalizedIndicator = String(indicator || '');
    return (
        (Boolean(normalizedIndicator) && normalizedIndicator !== 'none') ||
        (Boolean(description) && description !== 'All Systems Operational')
    );
}

function componentStatusIndicator(status: unknown): string {
    switch (status) {
        case 'major_outage':
            return 'major';
        case 'partial_outage':
        case 'degraded_performance':
        case 'under_maintenance':
            return 'minor';
        default:
            return '';
    }
}

function strongerStatusIndicator(left: unknown, right: unknown): string {
    const severity: Record<string, number> = {
        critical: 3,
        major: 2,
        minor: 1,
        maintenance: 1,
        none: 0,
        '': 0
    };
    const leftValue = String(left || '');
    const rightValue = String(right || '');
    return (severity[rightValue] || 0) > (severity[leftValue] || 0)
        ? rightValue
        : leftValue;
}

let pollingTimer: ReturnType<typeof window.setTimeout> | null = null;
let pollingActive = false;
let pollingGeneration = 0;
let refreshPromise: Promise<void> | null = null;

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
    return JSON.parse(String(data));
}

async function getJson(path: string): Promise<VrcStatusResponse | null> {
    const response = await externalApiRepository.fetchVrcStatusJson(path);

    if (response.status !== 200) {
        throw new Error(`VRChat status request failed (${response.status})`);
    }

    return parseResponse(response.data) as VrcStatusResponse | null;
}

async function fetchSummaryIssue(): Promise<{
    indicator: string;
    summary: string;
}> {
    const data = await getJson('summary.json');
    const components = Array.isArray(data?.components)
        ? (data.components as VrcStatusComponent[])
        : [];
    const issueComponents = components.filter(
        (component: any) =>
            component?.status && component.status !== 'operational'
    );
    return {
        indicator: issueComponents.reduce(
            (current: string, component: any) =>
                strongerStatusIndicator(
                    current,
                    componentStatusIndicator(component.status)
                ),
            ''
        ),
        summary: issueComponents
            .map((component: any) => component.name)
            .filter(Boolean)
            .join(', ')
    };
}

async function runVrcStatusRefresh(): Promise<void> {
    const runtimeStore = useRuntimeStore.getState();
    runtimeStore.setVrcStatusState({
        refreshing: true
    });

    try {
        const data = await getJson('status.json');
        const description = data?.status?.description || '';
        const indicator = data?.status?.indicator || '';
        const updatedAt = data?.page?.updated_at || null;
        const summaryIssue = await fetchSummaryIssue().catch((error: any) => {
            console.warn('Failed to fetch VRChat status summary:', error);
            return {
                indicator: '',
                summary: ''
            };
        });
        const effectiveIndicator = strongerStatusIndicator(
            indicator,
            summaryIssue.indicator
        );

        if (!hasStatusIssue(effectiveIndicator, description)) {
            runtimeStore.setVrcStatusState({
                status: '',
                indicator: '',
                summary: '',
                updatedAt,
                lastFetchedAt: new Date().toISOString(),
                pollingIntervalMs: OK_POLL_MS,
                error: '',
                refreshing: false
            });
            return;
        }

        runtimeStore.setVrcStatusState({
            status:
                description && description !== 'All Systems Operational'
                    ? description
                    : 'VRChat Server Issues',
            indicator: effectiveIndicator,
            summary: summaryIssue.summary,
            updatedAt,
            lastFetchedAt: new Date().toISOString(),
            pollingIntervalMs: ISSUE_POLL_MS,
            error: '',
            refreshing: false
        });
    } catch (error) {
        const current = useRuntimeStore.getState().vrcStatus;
        runtimeStore.setVrcStatusState({
            status: current.status || '',
            indicator: current.indicator || '',
            summary: current.summary || '',
            lastFetchedAt: new Date().toISOString(),
            pollingIntervalMs: ISSUE_POLL_MS,
            error: error instanceof Error ? error.message : String(error),
            refreshing: false
        });
        throw error;
    }
}

export function refreshVrcStatus(): Promise<void> {
    if (!refreshPromise) {
        refreshPromise = runVrcStatusRefresh().finally(() => {
            refreshPromise = null;
        });
    }
    return refreshPromise;
}

async function deferNextVrcStatusRefresh(): Promise<void> {
    const interval = useRuntimeStore.getState().vrcStatus.pollingIntervalMs;
    await commands
        .appRuntimeFrontendScheduleJobDefer({
            name: VRC_STATUS_REFRESH_JOB,
            delaySeconds: pollingCadenceSeconds(interval)
        })
        .catch((error: any) => {
            console.warn('Failed to defer VRC status refresh:', error);
        });
}

async function claimVrcStatusRefreshDue(): Promise<boolean> {
    const interval = useRuntimeStore.getState().vrcStatus.pollingIntervalMs;
    return commands
        .appRuntimeFrontendScheduleJobDueClaim({
            name: VRC_STATUS_REFRESH_JOB,
            cadenceSeconds: pollingCadenceSeconds(interval),
            initialDelaySeconds: 0
        })
        .catch((error: any) => {
            console.warn('Failed to claim VRC status refresh schedule:', error);
            return true;
        });
}

export function handleBrowserFocus(): Promise<void> {
    const { vrcStatus } = useRuntimeStore.getState();
    const lastFetchedAt = Date.parse(String(vrcStatus.lastFetchedAt || ''));
    if (
        Number.isFinite(lastFetchedAt) &&
        Date.now() - lastFetchedAt < FOCUS_REFRESH_MS
    ) {
        return Promise.resolve();
    }

    return refreshVrcStatus().finally(() => deferNextVrcStatusRefresh());
}

export function refreshVrcStatusNow(): Promise<void> {
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
        let shouldDefer = false;
        try {
            const due = await claimVrcStatusRefreshDue();
            const lastFetchedAt =
                useRuntimeStore.getState().vrcStatus.lastFetchedAt;
            if (due || !lastFetchedAt) {
                shouldDefer = true;
                await refreshVrcStatus();
            }
        } catch (error) {
            console.warn('VRChat status refresh failed:', error);
        } finally {
            if (shouldDefer) {
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
