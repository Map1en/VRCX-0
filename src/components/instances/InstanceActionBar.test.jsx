import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    runtimeState: {
        auth: {
            currentUserEndpoint: 'https://api.example.test/api/1',
            currentUserId: 'usr_self'
        }
    },
    showLaunchDialog: vi.fn(),
    confirm: vi.fn(),
    getInstance: vi.fn(),
    closeInstance: vi.fn(),
    selfInviteToInstance: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn()
}));

vi.mock('sonner', () => ({
    toast: {
        success: mocks.toastSuccess,
        error: mocks.toastError
    }
}));

vi.mock('@/repositories/index.js', () => ({
    instanceRepository: {
        getInstance: mocks.getInstance,
        closeInstance: mocks.closeInstance
    }
}));

vi.mock('@/services/launchService.js', () => ({
    selfInviteToInstance: mocks.selfInviteToInstance
}));

vi.mock('@/state/launchStore.js', () => ({
    useLaunchStore: (selector) =>
        selector({
            showLaunchDialog: mocks.showLaunchDialog
        })
}));

vi.mock('@/state/modalStore.js', () => ({
    useModalStore: (selector) =>
        selector({
            confirm: mocks.confirm
        })
}));

vi.mock('@/state/runtimeStore.js', () => ({
    useRuntimeStore: (selector) => selector(mocks.runtimeState)
}));

vi.mock('react-i18next', () => {
    const translations = {
        'dialog.instance.generated.android': 'Android:',
        'dialog.instance.generated.ios': 'iOS:',
        'dialog.instance.generated.launch_instance': 'Launch instance',
        'dialog.instance.generated.self_invite': 'Self invite',
        'dialog.new_instance.ageGate': 'Age Gate',
        'dialog.new_instance.queueEnabled': 'Queue'
    };

    return {
        useTranslation: () => ({
            t: (key) => translations[key] || key
        })
    };
});

vi.mock('@/ui/shadcn/tooltip', async () => {
    const React = await import('react');

    return {
        Tooltip: ({ children }) => React.createElement(React.Fragment, null, children),
        TooltipTrigger: ({ children }) =>
            React.createElement(React.Fragment, null, children),
        TooltipContent: ({ children }) =>
            React.createElement('span', { 'data-tooltip-content': true }, children)
    };
});

import { InstanceActionBar } from './InstanceActionBar.jsx';

function renderActionBar(props = {}) {
    return renderToStaticMarkup(
        React.createElement(InstanceActionBar, props)
    );
}

describe('InstanceActionBar', () => {
    beforeEach(() => {
        mocks.runtimeState.auth.currentUserEndpoint =
            'https://api.example.test/api/1';
        mocks.runtimeState.auth.currentUserId = 'usr_self';
        mocks.showLaunchDialog.mockReset();
        mocks.confirm.mockReset();
        mocks.getInstance.mockReset();
        mocks.closeInstance.mockReset();
        mocks.selfInviteToInstance.mockReset();
        mocks.toastSuccess.mockReset();
        mocks.toastError.mockReset();
    });

    it('renders nothing without any location target', () => {
        expect(renderActionBar()).toBe('');
    });

    it('renders instance actions and summary for a real instance location', () => {
        const html = renderActionBar({
            location: 'wrld_test:12345~region(us)',
            instance: {
                userCount: 12,
                capacity: 40,
                queueSize: 3,
                ageGate: true,
                platforms: {
                    standalonewindows: 8,
                    android: 4,
                    ios: 1
                }
            },
            friendCount: 2,
            showHistory: true,
            historyTooltip: 'Open instance history'
        });

        expect(html).toContain('aria-label="Launch instance"');
        expect(html).toContain('aria-label="Self invite"');
        expect(html).toContain('aria-label="Refresh instance info"');
        expect(html).toContain('aria-label="Open instance history"');
        expect(html).toContain('12/40');
        expect(html).toContain('Queue 3');
        expect(html).toContain('Age Gate');
        expect(html).toContain('PC:');
        expect(html).toContain('Android:');
        expect(html).toContain('iOS:');
    });

    it('uses fallback player count and provided capacity without instance info', () => {
        const html = renderActionBar({
            location: 'wrld_test:12345',
            playerCount: 5,
            capacity: 16,
            showLaunch: false,
            showInvite: false,
            showRefresh: false
        });

        expect(html).toContain('5/16');
        expect(html).not.toContain('aria-label="Launch instance"');
        expect(html).not.toContain('aria-label="Self invite"');
        expect(html).not.toContain('aria-label="Refresh instance info"');
    });

    it('falls back to users length and world capacity from instance details', () => {
        const html = renderActionBar({
            location: 'wrld_test:12345',
            instance: {
                users: [{ id: 'usr_a' }, { id: 'usr_b' }, { id: 'usr_c' }],
                world: {
                    capacity: 24
                }
            },
            showLaunch: false,
            showInvite: false,
            showRefresh: false
        });

        expect(html).toContain('3/24');
    });

    it('does not render instance actions for private or non-instance locations', () => {
        const html = renderActionBar({
            location: 'private',
            playerCount: 1,
            capacity: 4
        });

        expect(html).toContain('1/4');
        expect(html).not.toContain('aria-label="Launch instance"');
        expect(html).not.toContain('aria-label="Self invite"');
        expect(html).not.toContain('aria-label="Refresh instance info"');
    });
});
