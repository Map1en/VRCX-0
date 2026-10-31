// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appMcpServerStatus: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appMcpServerStatus: mocks.appMcpServerStatus
    }
}));

import { McpServerSettingsGroup } from './McpServerSettingsGroup';

function codeLines() {
    return Array.from(
        document.querySelectorAll(
            '[data-slot="tabs-content"]:not([hidden]) [data-slot="code-block-line"]'
        ),
        (line) => line.textContent
    );
}

describe('McpServerSettingsGroup', () => {
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('shows each client config snippet in a tab of the config dialog', async () => {
        mocks.appMcpServerStatus.mockResolvedValue({
            enabled: true,
            allowLanConnections: false,
            allowVrchatWrites: false,
            state: 'running',
            port: 8798,
            token: 'secret',
            activeConnections: 0,
            lastError: null,
            clientConfig: {
                claudeCodeCommand: 'claude mcp add vrcx-0',
                mcpRemoteJson: '{\n  "remote": true\n}',
                genericJson: '{\n  "generic": true\n}'
            }
        });

        render(<McpServerSettingsGroup />);

        fireEvent.click(
            await screen.findByRole('button', {
                name: 'view.settings.integrations.mcp_server.view_client_config'
            })
        );

        await screen.findByText(
            'view.settings.integrations.mcp_server.client_config_description'
        );
        expect(codeLines()).toEqual(['claude mcp add vrcx-0']);
        expect(screen.getByText('common.label.terminal')).toBeTruthy();

        fireEvent.click(
            screen.getByRole('tab', {
                name: 'view.settings.integrations.mcp_server.copy_generic'
            })
        );
        expect(codeLines()).toEqual(['{', '  "generic": true', '}']);
        expect(screen.getByText('JSON')).toBeTruthy();
    });
});
