import { describe, expect, it } from 'vitest';

import { resolveProxyIndicatorState } from './statusBarProxy';

describe('statusBarProxy', () => {
    it('renders disabled proxy as muted', () => {
        expect(
            resolveProxyIndicatorState({
                enabled: false,
                server: '127.0.0.1:7890',
                hasNetworkIssue: false
            })
        ).toMatchObject({
            tone: 'disabled',
            className: expect.stringContaining('text-muted-foreground'),
            tooltipKey: 'status_bar.proxy_disabled'
        });
    });

    it('renders enabled direct proxy state as highlighted', () => {
        expect(
            resolveProxyIndicatorState({
                enabled: true,
                server: '',
                hasNetworkIssue: false
            })
        ).toMatchObject({
            tone: 'direct',
            className: expect.stringContaining('text-primary'),
            tooltipKey: 'status_bar.proxy_enabled_direct'
        });
    });

    it('renders enabled configured proxy state as highlighted', () => {
        expect(
            resolveProxyIndicatorState({
                enabled: true,
                server: '  127.0.0.1:7890  ',
                hasNetworkIssue: false
            })
        ).toMatchObject({
            tone: 'enabled',
            className: expect.stringContaining('text-primary'),
            tooltipKey: 'status_bar.proxy_enabled_server',
            tooltipValues: {
                proxy: '127.0.0.1:7890'
            }
        });
    });

    it('renders enabled proxy with network issue using server degraded yellow', () => {
        expect(
            resolveProxyIndicatorState({
                enabled: true,
                server: '127.0.0.1:7890',
                hasNetworkIssue: true
            })
        ).toMatchObject({
            tone: 'warning',
            className: expect.stringContaining('text-[var(--status-askme)]'),
            tooltipKey: 'status_bar.proxy_network_issue'
        });
    });
});
