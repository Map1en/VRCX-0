import type {
    IntegrationApiStartFailedPayload,
    IntegrationApiStatus
} from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';

import i18n from './i18nService';

type IntegrationApiStatusRefreshListener = () => void;

const statusRefreshListeners = new Set<IntegrationApiStatusRefreshListener>();
let lastPresentedFailure: { key: string; at: number } | null = null;

export function handleIntegrationApiStartFailed(
    failure: IntegrationApiStartFailedPayload
): void {
    presentStartFailure(failure);
    requestIntegrationApiStatusRefresh();
}

export function hydrateIntegrationApiStatus(
    status: IntegrationApiStatus
): void {
    if (status.state !== 'error' || !status.lastError) {
        lastPresentedFailure = null;
        return;
    }
    presentStartFailure({
        port: status.lastError.port ?? status.port,
        reason: status.lastError.code === 'portInUse' ? 'portInUse' : 'bind'
    });
    requestIntegrationApiStatusRefresh();
}

function requestIntegrationApiStatusRefresh(): void {
    for (const listener of statusRefreshListeners) {
        listener();
    }
}

export function subscribeIntegrationApiStatusRefresh(
    listener: IntegrationApiStatusRefreshListener
): () => void {
    statusRefreshListeners.add(listener);
    return () => {
        statusRefreshListeners.delete(listener);
    };
}

function presentStartFailure(failure: IntegrationApiStartFailedPayload): void {
    const key = `${failure.reason}:${failure.port}`;
    const now = Date.now();
    if (
        lastPresentedFailure?.key === key &&
        now - lastPresentedFailure.at < 5000
    ) {
        return;
    }
    lastPresentedFailure = { key, at: now };
    const reasonKey =
        failure.reason === 'portInUse'
            ? 'view.settings.integrations.integration_api.port_in_use'
            : 'view.settings.integrations.integration_api.bind_failed';
    const reason = i18n.t(reasonKey, { port: failure.port });
    toast.add({
        type: 'error',
        title: i18n.t(
            'view.settings.integrations.integration_api.start_failed',
            {
                reason
            }
        )
    });
}
