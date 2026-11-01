// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appMcpServerStatus: vi.fn(),
    appMcpServerOpenClientInstall: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appMcpServerStatus: mocks.appMcpServerStatus,
        appMcpServerOpenClientInstall: mocks.appMcpServerOpenClientInstall
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

const RUNNING_STATUS = {
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
        genericJson: '{\n  "generic": true\n}',
        codexToml: '[mcp_servers.vrcx-0]',
        opencodeJson: '{\n  "opencode": true\n}'
    }
};

describe('McpServerSettingsGroup', () => {
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    async function openConnectDialog() {
        render(<McpServerSettingsGroup />);
        fireEvent.click(
            await screen.findByRole('button', {
                name: 'view.settings.integrations.mcp_server.connect_client_action'
            })
        );
        await screen.findByText(
            'view.settings.integrations.mcp_server.connect_dialog_description'
        );
    }

    it('shows each client its own guide and config', async () => {
        mocks.appMcpServerStatus.mockResolvedValue(RUNNING_STATUS);

        await openConnectDialog();

        expect(
            screen.getByText(
                'view.settings.integrations.mcp_server.guide.claude_desktop'
            )
        ).toBeTruthy();
        expect(codeLines()).toEqual(['{', '  "remote": true', '}']);

        fireEvent.click(screen.getByRole('tab', { name: 'Claude Code' }));
        expect(codeLines()).toEqual(['claude mcp add vrcx-0']);
        expect(screen.getByText('common.label.terminal')).toBeTruthy();

        fireEvent.click(screen.getByRole('tab', { name: 'Codex' }));
        expect(
            screen.getByText(
                'view.settings.integrations.mcp_server.guide.codex'
            )
        ).toBeTruthy();
        expect(codeLines()).toEqual(['[mcp_servers.vrcx-0]']);
    });

    it('asks the backend to open the selected client install link', async () => {
        mocks.appMcpServerStatus.mockResolvedValue(RUNNING_STATUS);
        mocks.appMcpServerOpenClientInstall.mockResolvedValue(null);

        await openConnectDialog();
        fireEvent.click(screen.getByRole('tab', { name: 'Cherry Studio' }));
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.settings.integrations.mcp_server.install_in_client'
            })
        );

        expect(mocks.appMcpServerOpenClientInstall).toHaveBeenCalledWith(
            'cherryStudio'
        );
    });

    it('keeps the port as plain digits without grouping', async () => {
        mocks.appMcpServerStatus.mockResolvedValue(RUNNING_STATUS);

        render(<McpServerSettingsGroup />);

        expect(await screen.findByDisplayValue('8798')).toBeTruthy();
    });
});
