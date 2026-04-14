import { webRepository } from '@/repositories/index.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

const STATUS_API_URL = 'https://status.vrchat.com/api/v2';
const OK_POLL_MS = 15 * 60 * 1000;
const ISSUE_POLL_MS = 2 * 60 * 1000;
const FOCUS_REFRESH_MS = 60 * 1000;

let pollingTimer = null;
let pollingActive = false;
let pollingGeneration = 0;

function parseResponse(data) {
    if (!data) {
        return null;
    }
    if (typeof data === 'object') {
        return data;
    }
    return JSON.parse(data);
}

async function getJson(path) {
    const response = await webRepository.execute({
        url: `${STATUS_API_URL}/${path}`,
        method: 'GET',
        headers: {
            Referer: 'https://vrcx.app'
        }
    });

    if (response.status !== 200) {
        throw new Error(`VRChat status request failed (${response.status})`);
    }

    return parseResponse(response.data);
}

async function fetchSummary() {
    const data = await getJson('summary.json');
    const components = Array.isArray(data?.components) ? data.components : [];
    return components
        .filter((component) => component?.status && component.status !== 'operational')
        .map((component) => component.name)
        .filter(Boolean)
        .join(', ');
}

export async function refreshVrcStatus() {
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

export function handleBrowserFocus() {
    const { vrcStatus } = useRuntimeStore.getState();
    const lastFetchedAt = Date.parse(vrcStatus.lastFetchedAt || '');
    if (Number.isFinite(lastFetchedAt) && Date.now() - lastFetchedAt < FOCUS_REFRESH_MS) {
        return Promise.resolve();
    }

    return refreshVrcStatus();
}

export function startVrcStatusPolling() {
    if (pollingActive) {
        return stopVrcStatusPolling;
    }

    pollingActive = true;
    pollingGeneration += 1;
    const generation = pollingGeneration;

    const tick = async () => {
        try {
            await refreshVrcStatus();
        } catch (error) {
            console.warn('VRChat status refresh failed:', error);
        }

        if (!pollingActive || generation !== pollingGeneration) {
            return;
        }

        const interval = useRuntimeStore.getState().vrcStatus.pollingIntervalMs || OK_POLL_MS;
        pollingTimer = window.setTimeout(tick, Math.max(FOCUS_REFRESH_MS, interval));
    };

    tick();
    return stopVrcStatusPolling;
}

export function stopVrcStatusPolling() {
    pollingActive = false;
    pollingGeneration += 1;

    if (pollingTimer !== null) {
        window.clearTimeout(pollingTimer);
        pollingTimer = null;
    }
}
