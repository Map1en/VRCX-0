// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within
} from '@testing-library/react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

const mocks = vi.hoisted(() => ({
    runtimeState: {
        auth: {
            currentUserEndpoint: 'https://api.example.test/api/1',
            currentUserId: 'usr_self'
        },
        gameState: {
            isGameRunning: true
        }
    },
    showLaunchDialog: vi.fn(),
    tryOpenLaunchLocation: vi.fn(),
    selfInviteToInstance: vi.fn(),
    confirm: vi.fn(),
    getInstance: vi.fn(),
    closeInstance: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn()
}));

vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) => {
            switch (options.type) {
                case 'success':
                    return mocks.toastSuccess(options);
                case 'error':
                    return mocks.toastError(options);
                default:
                    throw new Error('Unhandled toast type: ' + options.type);
            }
        }
    }
}));

vi.mock('@/repositories/vrchatInstanceRepository', () => ({
    default: {
        getInstance: mocks.getInstance,
        closeInstance: mocks.closeInstance
    }
}));

vi.mock('@/services/directAccessService', () => ({
    tryOpenLaunchLocation: mocks.tryOpenLaunchLocation
}));

vi.mock('@/services/launchService', () => ({
    selfInviteToInstance: mocks.selfInviteToInstance
}));

vi.mock('@/state/launchStore', () => ({
    useLaunchStore: <T,>(
        selector: (state: {
            showLaunchDialog: typeof mocks.showLaunchDialog;
        }) => T
    ) =>
        selector({
            showLaunchDialog: mocks.showLaunchDialog
        })
}));

vi.mock('@/state/modalStore', () => ({
    useModalStore: <T,>(
        selector: (state: { confirm: typeof mocks.confirm }) => T
    ) =>
        selector({
            confirm: mocks.confirm
        })
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: <T,>(selector: (state: typeof mocks.runtimeState) => T) =>
        selector(mocks.runtimeState)
}));

vi.mock('react-i18next', async (importOriginal) => {
    const translations: Record<string, string> = {
        'dialog.instance.label.android': 'Android:',
        'dialog.instance.label.ios': 'iOS:',
        'dialog.instance.action.launch_instance': 'Launch instance',
        'dialog.instance.action.open_in_game': 'Open In-Game',
        'dialog.instance.action.close_instance': 'Close instance',
        'dialog.instance.label.self_invite': 'Self invite',
        'dialog.new_instance.ageGate': 'Age Gate',
        'dialog.new_instance.queueEnabled': 'Queue',
        'confirm.title': 'Confirm',
        'confirm.close_instance':
            'Continue? Close Instance, nobody will be able to join'
    };

    return {
        ...(await importOriginal<typeof import('react-i18next')>()),
        useTranslation: () => ({
            t: (key: string) => translations[key] || key,
            i18n: { language: 'en' }
        })
    };
});

vi.mock('@/ui/shadcn/tooltip', async () => {
    const ReactRuntime = await import('react');
    type MockRender =
        | React.ReactNode
        | ((props: object, state: object) => React.ReactNode);
    const renderMockSlot = (
        render: MockRender | undefined,
        children: React.ReactNode
    ) => {
        if (typeof render === 'function') {
            return render({}, {});
        }
        return ReactRuntime.isValidElement(render) ? render : children;
    };

    return {
        Tooltip: ({ children }: React.PropsWithChildren) =>
            ReactRuntime.createElement(
                'span',
                { 'data-tooltip-root': true },
                children
            ),
        TooltipTrigger: ({
            children,
            render
        }: {
            children?: React.ReactNode;
            render?: MockRender;
        }) =>
            ReactRuntime.createElement(
                ReactRuntime.Fragment,
                null,
                renderMockSlot(render, children)
            ),
        TooltipContent: ({ children }: React.PropsWithChildren) =>
            ReactRuntime.createElement(
                'span',
                { 'data-tooltip-content': true },
                children
            )
    };
});

import { InstanceActionBar } from './InstanceActionBar';

function renderActionBar(
    props: React.ComponentProps<typeof InstanceActionBar> = {}
) {
    return renderToStaticMarkup(React.createElement(InstanceActionBar, props));
}

describe('InstanceActionBar', () => {
    beforeEach(() => {
        mocks.runtimeState.auth.currentUserEndpoint =
            'https://api.example.test/api/1';
        mocks.runtimeState.auth.currentUserId = 'usr_self';
        mocks.runtimeState.gameState.isGameRunning = true;
        mocks.showLaunchDialog.mockReset();
        mocks.tryOpenLaunchLocation.mockReset();
        mocks.selfInviteToInstance.mockReset();
        mocks.confirm.mockReset();
        mocks.getInstance.mockReset();
        mocks.closeInstance.mockReset();
        mocks.toastSuccess.mockReset();
        mocks.toastError.mockReset();
    });

    afterEach(() => {
        cleanup();
    });

    it('renders nothing without any location target', () => {
        expect(renderActionBar()).toBe('');
    });

    it('renders instance actions and summary for a real instance location', () => {
        const html = renderActionBar({
            target: { location: 'wrld_test:12345~region(us)' },
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
        expect(html).toContain('aria-label="Open In-Game"');
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

    it('preserves markers-first summary ordering', () => {
        const html = renderActionBar({
            target: { location: 'wrld_test:12345' },
            instance: {
                userCount: 12,
                capacity: 40,
                queueSize: 3,
                ageGate: true
            },
            friendCount: 2,
            instanceSummaryOrder: 'markers-first',
            showLaunch: false,
            showInvite: false,
            showRefresh: false
        });

        expect(html.indexOf('Queue 3')).toBeLessThan(html.indexOf('12/40'));
        expect(html.indexOf('Age Gate')).toBeLessThan(html.indexOf('12/40'));
        expect(html.indexOf('lucide-users-round')).toBeLessThan(
            html.indexOf('12/40')
        );
    });

    it('keeps the close action outside the instance-info tooltip', () => {
        render(
            <InstanceActionBar
                target={{ location: 'wrld_test:12345' }}
                instance={{
                    ownerId: 'usr_self',
                    userCount: 2,
                    capacity: 16,
                    platforms: {
                        standalonewindows: 2,
                        android: 0,
                        ios: 0
                    }
                }}
                showLaunch={false}
                showInvite={false}
                showRefresh={false}
            />
        );

        const closeTooltip = screen
            .getByRole('button', { name: 'Close instance' })
            .closest('[data-tooltip-root]');

        expect(closeTooltip).not.toBeNull();
        expect(
            within(closeTooltip as HTMLElement).getByText('Close instance')
        ).toBeTruthy();
        expect(
            within(closeTooltip as HTMLElement).queryByText('PC:')
        ).toBeNull();
    });

    function renderClosableInstance() {
        render(
            <InstanceActionBar
                target={{ location: 'wrld_test:12345' }}
                instance={{
                    ownerId: 'usr_self',
                    userCount: 2,
                    capacity: 16
                }}
                showLaunch={false}
                showInvite={false}
                showRefresh={false}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: 'Close instance' }));
    }

    it('asks for destructive confirmation before closing', () => {
        mocks.confirm.mockResolvedValue({ ok: false });

        renderClosableInstance();

        expect(mocks.confirm).toHaveBeenCalledWith({
            title: 'Confirm',
            description:
                'Continue? Close Instance, nobody will be able to join',
            destructive: true
        });
        expect(mocks.closeInstance).not.toHaveBeenCalled();
    });

    it('closes the instance once the confirmation is accepted', async () => {
        mocks.confirm.mockResolvedValue({ ok: true });
        mocks.closeInstance.mockResolvedValue({ json: null });

        renderClosableInstance();

        await waitFor(() => {
            expect(mocks.closeInstance).toHaveBeenCalledWith({
                location: 'wrld_test:12345',
                hardClose: false
            });
        });
        await waitFor(() => {
            expect(mocks.toastSuccess).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'dialog.instance.label.instance_closed'
                })
            );
        });
    });

    it('offers event linking only to group managers who may link calendar events', () => {
        const groupInstance = (permissions: string[]) =>
            renderActionBar({
                target: { location: 'wrld_test:12345~group(grp_team)' },
                instance: {
                    ownerId: 'grp_team',
                    group: { myMember: { permissions } }
                },
                showLaunch: false,
                showInvite: false
            });
        const linkLabel =
            'aria-label="component.instance_action_bar.calendar_link.header"';

        expect(
            groupInstance([
                'group-instance-manage',
                'group-instance-calendar-link'
            ])
        ).toContain(linkLabel);
        expect(groupInstance(['group-instance-manage'])).not.toContain(
            linkLabel
        );
        expect(
            renderActionBar({
                target: { location: 'wrld_test:12345' },
                instance: {
                    ownerId: 'usr_self',
                    group: { myMember: { permissions: ['*'] } }
                }
            })
        ).not.toContain(linkLabel);
    });

    it('offers renaming for group managers and VRC+ owners only', () => {
        const renameLabel =
            'aria-label="component.instance_action_bar.rename.header"';
        const render = (instance: Record<string, unknown>) =>
            renderActionBar({
                target: { location: 'wrld_test:12345' },
                instance,
                showLaunch: false,
                showInvite: false
            });

        expect(
            render({
                ownerId: 'grp_team',
                group: { myMember: { permissions: ['group-instance-manage'] } }
            })
        ).toContain(renameLabel);
        expect(render({ ownerId: 'usr_self' })).not.toContain(renameLabel);
        expect(render({ ownerId: 'usr_other' })).not.toContain(renameLabel);
    });

    it('shows the linked event marker', () => {
        const html = renderActionBar({
            target: { location: 'wrld_test:12345~group(grp_team)' },
            instance: {
                ownerId: 'grp_team',
                displayName: 'Movie night',
                calendarEntryId: 'gcal_1'
            },
            showLaunch: false,
            showInvite: false
        });

        expect(html).toContain(
            'aria-label="component.instance_action_bar.calendar_event"'
        );
    });

    it('can show instance info while keeping action tooltips disabled', () => {
        render(
            <InstanceActionBar
                target={{ location: 'wrld_test:12345' }}
                instance={{
                    ownerId: 'usr_self',
                    userCount: 2,
                    capacity: 16,
                    platforms: {
                        standalonewindows: 1,
                        android: 1,
                        ios: 0
                    }
                }}
                disableTooltip
                disableInstanceInfoTooltip={false}
            />
        );

        expect(
            screen
                .getByRole('button', { name: 'Close instance' })
                .closest('[data-tooltip-root]')
        ).toBeNull();
        expect(screen.getByText('PC:').closest('[data-tooltip-root]')).not.toBe(
            null
        );
        expect(screen.getByText('2/16')).toBeTruthy();
    });

    it('uses fallback player count and provided capacity without instance info', () => {
        const html = renderActionBar({
            target: { location: 'wrld_test:12345' },
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

    it('does not display a negative instance player-count sentinel', () => {
        const apiFallbackHtml = renderActionBar({
            target: { location: 'wrld_test:12345' },
            instance: {
                userCount: -1,
                n_users: 4,
                capacity: 32
            }
        });
        const fallbackHtml = renderActionBar({
            target: { location: 'wrld_test:12345' },
            instance: {
                userCount: -1,
                capacity: 32
            },
            playerCount: 3
        });
        const unknownHtml = renderActionBar({
            target: { location: 'wrld_test:12345' },
            instance: {
                userCount: -1,
                capacity: 32
            }
        });

        expect(apiFallbackHtml).toContain('4/32');
        expect(fallbackHtml).toContain('3/32');
        expect(fallbackHtml).not.toContain('-1/32');
        expect(unknownHtml).toContain('—/32');
        expect(unknownHtml).not.toContain('-1/32');
    });

    it('falls back to users length and world capacity from instance details', () => {
        const html = renderActionBar({
            target: { location: 'wrld_test:12345' },
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

    it('routes independent target locations to their matching actions', async () => {
        const onRefresh = vi.fn().mockResolvedValue({});
        mocks.selfInviteToInstance.mockResolvedValue(undefined);

        render(
            <InstanceActionBar
                target={{
                    launchLocation: 'wrld_launch:12345~region(us)',
                    inviteLocation: 'wrld_invite:23456~region(jp)',
                    instanceLocation: 'wrld_refresh:34567~region(eu)',
                    shortName: 'fallback-token',
                    worldName: 'Action World'
                }}
                onRefresh={onRefresh}
                disableTooltip
            />
        );

        fireEvent.click(
            screen.getByRole('button', { name: 'Launch instance' })
        );
        expect(mocks.showLaunchDialog).toHaveBeenCalledWith(
            'wrld_launch:12345~region(us)',
            '',
            'fallback-token',
            { worldName: 'Action World' }
        );

        fireEvent.click(screen.getByRole('button', { name: 'Self invite' }));
        await waitFor(() => {
            expect(mocks.selfInviteToInstance).toHaveBeenCalledWith(
                'wrld_invite:23456~region(jp)',
                'fallback-token'
            );
            expect(
                screen
                    .getByRole('button', { name: 'Self invite' })
                    .hasAttribute('disabled')
            ).toBe(false);
        });

        fireEvent.click(
            screen.getByRole('button', { name: 'Refresh instance info' })
        );
        await waitFor(() => {
            expect(onRefresh).toHaveBeenCalledWith(
                'wrld_refresh:34567~region(eu)'
            );
        });
    });

    it('forces a fresh instance request for an explicit refresh', async () => {
        mocks.getInstance.mockResolvedValue({
            json: {
                id: 'wrld_refresh:34567~region(eu)',
                userCount: 7,
                capacity: 24
            }
        });

        render(
            <InstanceActionBar
                target={{ location: 'wrld_refresh:34567~region(eu)' }}
                disableTooltip
            />
        );

        fireEvent.click(
            screen.getByRole('button', { name: 'Refresh instance info' })
        );

        await waitFor(() => {
            expect(mocks.getInstance).toHaveBeenCalledWith({
                worldId: 'wrld_refresh',
                instanceId: '34567~region(eu)',
                force: true
            });
        });
    });

    it('hides the open in-game action while VRChat is not running', () => {
        mocks.runtimeState.gameState.isGameRunning = false;

        const html = renderActionBar({
            target: { location: 'wrld_test:12345' }
        });

        expect(html).toContain('aria-label="Launch instance"');
        expect(html).not.toContain('aria-label="Open In-Game"');
        expect(html).toContain('aria-label="Self invite"');
    });

    it('does not render instance actions for private or non-instance locations', () => {
        const html = renderActionBar({
            target: { location: 'private' },
            playerCount: 1,
            capacity: 4
        });

        expect(html).toContain('1/4');
        expect(html).not.toContain('aria-label="Launch instance"');
        expect(html).not.toContain('aria-label="Self invite"');
        expect(html).not.toContain('aria-label="Refresh instance info"');
    });
});
