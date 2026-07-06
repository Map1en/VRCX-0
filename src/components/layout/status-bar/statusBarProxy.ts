export type ProxyIndicatorTone = 'disabled' | 'direct' | 'enabled' | 'warning';

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
            className: 'text-muted-foreground hover:text-muted-foreground',
            server: normalizedServer,
            tone: 'disabled',
            tooltipKey: 'status_bar.proxy_disabled'
        };
    }
    if (hasNetworkIssue) {
        return {
            className:
                'text-[var(--status-askme)] hover:text-[var(--status-askme)]',
            server: normalizedServer,
            tone: 'warning',
            tooltipKey: 'status_bar.proxy_network_issue'
        };
    }
    if (!normalizedServer) {
        return {
            className: 'text-primary hover:text-primary',
            server: normalizedServer,
            tone: 'direct',
            tooltipKey: 'status_bar.proxy_enabled_direct'
        };
    }
    return {
        className: 'text-primary hover:text-primary',
        server: normalizedServer,
        tone: 'enabled',
        tooltipKey: 'status_bar.proxy_enabled_server',
        tooltipValues: {
            proxy: normalizedServer
        }
    };
}
