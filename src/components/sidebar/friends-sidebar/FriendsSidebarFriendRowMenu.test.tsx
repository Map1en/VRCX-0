// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/user-hover-card/UserHoverCard', () => ({
    UserHoverCard: ({ children }: PropsWithChildren) => children
}));

vi.mock('./SidebarUserRowContent', () => ({
    SidebarUserRowContent: ({
        displayName,
        subline
    }: {
        displayName: string;
        subline?: ReactNode;
    }) => (
        <div>
            {displayName}
            {subline}
        </div>
    )
}));

vi.mock('@/services/launchService', () => ({
    launchVrchat: vi.fn()
}));

vi.mock('./AccountSwitcherPopover', () => ({
    AccountSwitcherPopover: () => <button type="button">Switch account</button>
}));

import { isSidebarAutoHideInteractionBlocked } from '@/services/sidebarAutoHideService';
import { useShellStore } from '@/state/shellStore';

import { FriendRow } from './FriendsSidebarFriendRow';

const friend = {
    id: 'usr_friend',
    displayName: 'Friend',
    state: 'online',
    status: 'active',
    location: 'wrld_friends:1'
};

beforeEach(() => {
    useShellStore.setState({ windowDisplayMode: 'normal' });
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
});

afterEach(() => {
    cleanup();
    useShellStore.setState({ windowDisplayMode: 'normal' });
    vi.restoreAllMocks();
});

describe('FriendRow menus', () => {
    it.each([false, true])(
        'opens the profile on double click in sidebar mode (self: %s)',
        async (isCurrentUser) => {
            useShellStore.setState({ windowDisplayMode: 'sidebar' });
            const user = userEvent.setup();
            const onOpen = vi.fn();
            render(
                <FriendRow
                    friend={friend}
                    rowModel={{ isCurrentUser }}
                    rowCommands={{ onOpen }}
                />
            );
            await user.dblClick(
                screen.getByRole('button', { name: /^Friend/ })
            );
            expect(onOpen).toHaveBeenCalledOnce();
            await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
            expect(isSidebarAutoHideInteractionBlocked()).toBe(false);
            await user.click(screen.getByRole('button', { name: /^Friend/ }));
            expect(await screen.findAllByRole('menu')).toHaveLength(1);
            expect(onOpen).toHaveBeenCalledOnce();
        }
    );

    it('opens the profile directly on left click in normal mode', async () => {
        const user = userEvent.setup();
        const onOpen = vi.fn();
        render(<FriendRow friend={friend} rowCommands={{ onOpen }} />);

        const row = screen.getByRole('button', { name: /^Friend/ });
        expect(row.hasAttribute('aria-haspopup')).toBe(false);
        await user.click(row);

        expect(onOpen).toHaveBeenCalledOnce();
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it.each([false, true])(
        'keeps sidebar mode on left click and opens the profile only from the menu (self: %s)',
        async (isCurrentUser) => {
            useShellStore.setState({ windowDisplayMode: 'sidebar' });
            const user = userEvent.setup();
            const onOpen = vi.fn();
            render(
                <FriendRow
                    friend={friend}
                    rowModel={{ isCurrentUser }}
                    rowCommands={{ onOpen }}
                />
            );

            const row = screen.getByRole('button', { name: /^Friend/ });
            expect(row.getAttribute('aria-haspopup')).toBe('menu');
            await user.click(row);

            expect(await screen.findAllByRole('menu')).toHaveLength(1);
            expect(onOpen).not.toHaveBeenCalled();
            expect(useShellStore.getState().windowDisplayMode).toBe('sidebar');
            expect(isSidebarAutoHideInteractionBlocked()).toBe(true);

            await user.click(
                screen.getByRole('menuitem', {
                    name: 'common.actions.view_profile'
                })
            );

            expect(onOpen).toHaveBeenCalledOnce();
            await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
            expect(isSidebarAutoHideInteractionBlocked()).toBe(false);
        }
    );

    it.each(['normal', 'sidebar'] as const)(
        'preserves right-click actions in %s mode',
        async (windowDisplayMode) => {
            useShellStore.setState({ windowDisplayMode });
            const user = userEvent.setup();
            const onOpen = vi.fn();
            const onBoop = vi.fn();
            render(
                <FriendRow
                    friend={friend}
                    rowModel={{ canBoop: true }}
                    rowCommands={{ onOpen, onBoop }}
                />
            );

            await user.pointer({
                keys: '[MouseRight]',
                target: screen.getByRole('button', { name: /^Friend/ })
            });

            expect(await screen.findAllByRole('menu')).toHaveLength(1);
            expect(onOpen).not.toHaveBeenCalled();
            expect(isSidebarAutoHideInteractionBlocked()).toBe(true);
            await user.click(
                screen.getByRole('menuitem', {
                    name: 'dialog.user.actions.send_boop'
                })
            );

            expect(onBoop).toHaveBeenCalledExactlyOnceWith(friend);
            expect(onOpen).not.toHaveBeenCalled();
            expect(useShellStore.getState().windowDisplayMode).toBe(
                windowDisplayMode
            );
        }
    );

    it('uses the same quick action on left click without opening the profile', async () => {
        useShellStore.setState({ windowDisplayMode: 'sidebar' });
        const user = userEvent.setup();
        const onOpen = vi.fn();
        const onBoop = vi.fn();
        render(
            <FriendRow
                friend={friend}
                rowModel={{ canBoop: true }}
                rowCommands={{ onOpen, onBoop }}
            />
        );

        await user.click(screen.getByRole('button', { name: /^Friend/ }));
        await user.click(
            await screen.findByRole('menuitem', {
                name: 'dialog.user.actions.send_boop'
            })
        );

        expect(onBoop).toHaveBeenCalledExactlyOnceWith(friend);
        expect(onOpen).not.toHaveBeenCalled();
        expect(useShellStore.getState().windowDisplayMode).toBe('sidebar');
    });

    it.each(['[Enter]', '[Space]'])(
        'opens with %s and returns focus to the row on Escape',
        async (key) => {
            useShellStore.setState({ windowDisplayMode: 'sidebar' });
            const user = userEvent.setup();
            const onOpen = vi.fn();
            render(<FriendRow friend={friend} rowCommands={{ onOpen }} />);

            const row = screen.getByRole('button', { name: /^Friend/ });
            await user.tab();
            expect(document.activeElement).toBe(row);
            await user.keyboard(key);
            expect(await screen.findAllByRole('menu')).toHaveLength(1);
            expect(onOpen).not.toHaveBeenCalled();

            await user.keyboard('[Escape]');
            await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
            expect(document.activeElement).toBe(row);
            expect(isSidebarAutoHideInteractionBlocked()).toBe(false);
        }
    );

    it('reuses the same menu after switching between left and right click', async () => {
        useShellStore.setState({ windowDisplayMode: 'sidebar' });
        const user = userEvent.setup();
        render(<FriendRow friend={friend} />);
        const row = screen.getByRole('button', { name: /^Friend/ });

        await user.click(row);
        const leftMenu = await screen.findByRole('menu');
        const actions = leftMenu.textContent;
        await user.keyboard('[Escape]');
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
        await user.pointer({ keys: '[MouseRight]', target: row });

        const rightMenu = await screen.findByRole('menu');
        expect(rightMenu.textContent).toBe(actions);
        expect(screen.getAllByRole('menu')).toHaveLength(1);
        await user.keyboard('[Escape]');
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
        await user.click(screen.getByRole('button', { name: /^Friend/ }));
        expect((await screen.findByRole('menu')).textContent).toBe(actions);
    });

    it('supports keyboard selection in the self submenu opened by left click', async () => {
        useShellStore.setState({ windowDisplayMode: 'sidebar' });
        const user = userEvent.setup();
        const onSetStatusDescription = vi.fn();
        const onOpen = vi.fn();
        render(
            <FriendRow
                friend={{ ...friend, statusHistory: ['Previous status'] }}
                rowModel={{ isCurrentUser: true }}
                rowCommands={{ onOpen, onSetStatusDescription }}
            />
        );

        await user.click(screen.getByRole('button', { name: /^Friend/ }));
        await user.click(
            await screen.findByRole('menuitem', {
                name: 'side_panel.status_menu.recently_used'
            })
        );
        await user.keyboard('[ArrowRight]');
        const previousStatus = await screen.findByRole('menuitemcheckbox', {
            name: 'Previous status'
        });
        await waitFor(() =>
            expect(document.activeElement).toBe(previousStatus)
        );
        await user.keyboard('[Enter]');

        expect(onSetStatusDescription).toHaveBeenCalledExactlyOnceWith(
            'Previous status'
        );
        expect(onOpen).not.toHaveBeenCalled();
        expect(useShellStore.getState().windowDisplayMode).toBe('sidebar');
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
        expect(isSidebarAutoHideInteractionBlocked()).toBe(false);
    });

    it('keeps the account switcher independent of the self action menu', async () => {
        useShellStore.setState({ windowDisplayMode: 'sidebar' });
        const user = userEvent.setup();
        const onOpen = vi.fn();
        render(
            <FriendRow
                friend={friend}
                rowModel={{ isCurrentUser: true }}
                rowCommands={{ onOpen }}
            />
        );

        await user.click(
            screen.getByRole('button', { name: 'Switch account' })
        );

        expect(screen.queryByRole('menu')).toBeNull();
        expect(onOpen).not.toHaveBeenCalled();
    });
});
