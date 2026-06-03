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
    selfInvite: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn()
}));

vi.mock('sonner', () => ({
    toast: {
        success: mocks.toastSuccess,
        error: mocks.toastError
    }
}));

vi.mock('@/repositories/vrchatInstanceRepository', () => ({
    default: {
        getInstance: mocks.getInstance,
        closeInstance: mocks.closeInstance,
        selfInvite: mocks.selfInvite
    }
}));

vi.mock('@/state/launchStore', () => ({
    useLaunchStore: (selector: any) =>
        selector({
            showLaunchDialog: mocks.showLaunchDialog
        })
}));

vi.mock('@/state/modalStore', () => ({
    useModalStore: (selector: any) =>
        selector({
            confirm: mocks.confirm
        })
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: (selector: any) => selector(mocks.runtimeState)
}));

vi.mock('react-i18next', () => {
    const translations: any = {
        'dialog.instance.label.android': 'Android:',
        'dialog.instance.label.ios': 'iOS:',
        'dialog.instance.action.launch_instance': 'Launch instance',
        'dialog.instance.label.self_invite': 'Self invite',
        'dialog.new_instance.ageGate': 'Age Gate',
        'dialog.new_instance.queueEnabled': 'Queue'
    };

    return {
        useTranslation: () => ({
            t: (key: any) => translations[key] || key
        })
    };
});

vi.mock('@/ui/shadcn/tooltip', async () => {
    const React = await import('react');

    return {
        Tooltip: ({ children }: any) =>
            React.createElement(React.Fragment, null, children),
        TooltipTrigger: ({ children }: any) =>
            React.createElement(React.Fragment, null, children),
        TooltipContent: ({ children }: any) =>
            React.createElement(
                'span',
                { 'data-tooltip-content': true },
                children
            )
    };
});

import {
    buildInstanceActionSelfInviteRequest,
    InstanceActionBar
} from './InstanceActionBar';
import { buildInstanceActionTarget } from '@/components/location/locationModel';

function renderActionBar(props: any = {}) {
    return renderToStaticMarkup(React.createElement(InstanceActionBar, props));
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
        mocks.selfInvite.mockReset();
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

    it('accepts a normalized target without repeating location props', () => {
        const html = renderActionBar({
            target: {
                location: 'wrld_test:12345~hidden(usr_owner)&shortName=tok',
                shortName: 'tok',
                worldName: 'Target World'
            },
            playerCount: 4,
            capacity: 12
        });

        expect(html).toContain('aria-label="Launch instance"');
        expect(html).toContain('aria-label="Self invite"');
        expect(html).toContain('aria-label="Refresh instance info"');
        expect(html).toContain('4/12');
    });

    it('builds self invite requests from target shortName without resolving shortName first', () => {
        const actionTarget = buildInstanceActionTarget({
            target: {
                location: 'wrld_test:12345~hidden(usr_owner)',
                shortName: 'tok'
            }
        });

        expect(
            buildInstanceActionSelfInviteRequest(
                actionTarget,
                'https://api.example.test/api/1'
            )
        ).toEqual({
            worldId: 'wrld_test',
            instanceId: '12345~hidden(usr_owner)',
            shortName: 'tok',
            endpoint: 'https://api.example.test/api/1'
        });
    });

    it('prefers shortName embedded in the invite location', () => {
        const actionTarget = buildInstanceActionTarget({
            target: {
                location:
                    'wrld_test:12345~hidden(usr_owner)&shortName=fromLocation',
                shortName: 'fromTarget'
            }
        });

        expect(
            buildInstanceActionSelfInviteRequest(
                actionTarget,
                'https://api.example.test/api/1'
            ).shortName
        ).toBe('fromLocation');
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
