import { cn } from '@/lib/utils';

import {
    STATUS_BAR_TOGGLE_ACTIVE,
    STATUS_BAR_TOGGLE_IDLE
} from './statusBarToggle';

type ProxyIndicatorTone = 'disabled' | 'direct' | 'enabled' | 'warning';

export type ProxyIndicatorInput = {
    enabled: boolean;
    server: string;
    hasNetworkIssue: boolean;
};

export type ProxyIndicatorState = {
    className: string;
    server: string;
    tone: ProxyIndicatorTone;
    tooltipKey: string;
    tooltipValues?: {
        proxy: string;
    };
};

export function resolveProxyIndicatorState({
    enabled,
    server,
    hasNetworkIssue
}: ProxyIndicatorInput): ProxyIndicatorState {
    const normalizedServer = server.trim();
    if (!enabled) {
        return {
            className: STATUS_BAR_TOGGLE_IDLE,
            server: normalizedServer,
            tone: 'disabled',
            tooltipKey: 'status_bar.proxy_disabled'
        };
    }
    if (hasNetworkIssue) {
        return {
            className: cn(
                STATUS_BAR_TOGGLE_ACTIVE,
                'text-[var(--status-askme)] hover:text-[var(--status-askme)]'
            ),
            server: normalizedServer,
            tone: 'warning',
            tooltipKey: 'status_bar.proxy_network_issue'
        };
    }
    if (!normalizedServer) {
        return {
            className: STATUS_BAR_TOGGLE_ACTIVE,
            server: normalizedServer,
            tone: 'direct',
            tooltipKey: 'status_bar.proxy_enabled_direct'
        };
    }
    return {
        className: STATUS_BAR_TOGGLE_ACTIVE,
        server: normalizedServer,
        tone: 'enabled',
        tooltipKey: 'status_bar.proxy_enabled_server',
        tooltipValues: {
            proxy: normalizedServer
        }
    };
}
