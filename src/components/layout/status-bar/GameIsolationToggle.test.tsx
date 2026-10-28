// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen
} from '@testing-library/react';
import type { PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { useRuntimeStore } from '@/state/runtimeStore';

const trayEvents = vi.hoisted(() => ({
    handlers: new Map<string, () => void>()
}));

vi.mock('@/platform/tauri/bindings', async () =>
    (await import('@/test/mockCommands')).mockBindingsModule()
);

vi.mock('@/platform/tauri/client', () => ({
    tauriClient: {
        events: {
            subscribe: vi.fn((name: string, handler: () => void) => {
                trayEvents.handlers.set(name, handler);
                return Promise.resolve(() => trayEvents.handlers.delete(name));
            })
        }
    }
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn(), close: vi.fn() }
}));

vi.mock('@/ui/shadcn/tooltip', () => ({
    Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
    TooltipContent: ({ children }: PropsWithChildren) => (
        <div role="tooltip">{children}</div>
    ),
    TooltipTrigger: ({ render }: { render?: ReactNode }) => <>{render}</>
}));

import { useGameIsolationCardStore } from './gameIsolationCardStore';
import { GameIsolationToggle } from './GameIsolationToggle';

function isolationIs(enabled: boolean, revision = 1) {
    act(() =>
        useRuntimeStore.getState().setGameIsolation({ revision, enabled })
    );
}

function icon() {
    return screen.getByRole('button', { name: /status_bar\.game_isolation/ });
}

function card() {
    return screen.queryByRole('dialog');
}

beforeEach(() => {
    useRuntimeStore.getState().resetRuntimeState();
    useRuntimeStore.setState((state) => ({
        hostCapabilities: {
            ...state.hostCapabilities,
            gameProcessMonitor: {
                supported: true,
                enabled: true,
                available: true,
                reason: ''
            }
        }
    }));
    useGameIsolationCardStore.getState().setOpen(false);
    act(() =>
        useRuntimeStore.getState().setGameState({ isGameRunning: false })
    );
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    trayEvents.handlers.clear();
});

describe('status bar game isolation', () => {
    it('is not offered where the local game cannot be monitored', () => {
        useRuntimeStore.setState((state) => ({
            hostCapabilities: {
                ...state.hostCapabilities,
                gameProcessMonitor: {
                    ...state.hostCapabilities.gameProcessMonitor,
                    available: false
                }
            }
        }));

        render(<GameIsolationToggle />);

        expect(screen.queryByRole('button')).toBeNull();
    });

    it('asks for confirmation before isolating the account', async () => {
        render(<GameIsolationToggle />);

        fireEvent.click(icon());

        expect(
            await screen.findByText('game_isolation.confirm_title')
        ).toBeTruthy();
        expect(
            screen.getByText('game_isolation.hint_before_launch')
        ).toBeTruthy();
        expect(commands.appGameIsolationSet).not.toHaveBeenCalled();
    });

    it('isolates the account only after the user confirms', async () => {
        vi.mocked(commands.appGameIsolationSet).mockResolvedValue({
            revision: 1,
            enabled: true
        });
        render(<GameIsolationToggle />);
        fireEvent.click(icon());

        await act(async () => {
            fireEvent.click(
                await screen.findByRole('button', {
                    name: 'game_isolation.confirm'
                })
            );
        });

        expect(commands.appGameIsolationSet).toHaveBeenCalledWith(true);
        expect(useRuntimeStore.getState().gameIsolation.enabled).toBe(true);
        expect(icon().getAttribute('aria-pressed')).toBe('true');
        expect(useGameIsolationCardStore.getState().open).toBe(false);
    });

    it('cancelling leaves the account as it was', async () => {
        render(<GameIsolationToggle />);
        fireEvent.click(icon());

        fireEvent.click(
            await screen.findByRole('button', { name: 'game_isolation.cancel' })
        );

        expect(commands.appGameIsolationSet).not.toHaveBeenCalled();
        expect(useGameIsolationCardStore.getState().open).toBe(false);
    });

    it('warns that the current room is still recorded when the game is already running', async () => {
        act(() =>
            useRuntimeStore.getState().setGameState({ isGameRunning: true })
        );
        render(<GameIsolationToggle />);

        fireEvent.click(icon());

        expect(
            await screen.findByText('game_isolation.hint_running_enable')
        ).toBeTruthy();
    });

    it('turns isolation off with one click and no card', async () => {
        isolationIs(true);
        vi.mocked(commands.appGameIsolationSet).mockResolvedValue({
            revision: 2,
            enabled: false
        });
        render(<GameIsolationToggle />);

        await act(async () => {
            fireEvent.click(icon());
        });

        expect(commands.appGameIsolationSet).toHaveBeenCalledWith(false);
        expect(card()).toBeNull();
        expect(toast.add).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'game_isolation.toast_off' })
        );
    });

    it('says recording resumes from the next room when turned off mid-game', async () => {
        isolationIs(true);
        act(() =>
            useRuntimeStore.getState().setGameState({ isGameRunning: true })
        );
        vi.mocked(commands.appGameIsolationSet).mockResolvedValue({
            revision: 2,
            enabled: false
        });
        render(<GameIsolationToggle />);

        await act(async () => {
            fireEvent.click(icon());
        });

        expect(toast.add).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'game_isolation.toast_off_running'
            })
        );
    });

    it('right-click shows the explanation and can turn isolation off', async () => {
        isolationIs(true);
        vi.mocked(commands.appGameIsolationSet).mockResolvedValue({
            revision: 2,
            enabled: false
        });
        render(<GameIsolationToggle />);

        fireEvent.contextMenu(icon());
        expect(
            await screen.findByText('game_isolation.active_title')
        ).toBeTruthy();
        await act(async () => {
            fireEvent.click(
                screen.getByRole('button', { name: 'game_isolation.turn_off' })
            );
        });

        expect(commands.appGameIsolationSet).toHaveBeenCalledWith(false);
    });

    it('opens the confirmation card when the tray asks for it', async () => {
        render(<GameIsolationToggle />);
        await act(async () => {});

        act(() => trayEvents.handlers.get('gameIsolationConfirmRequested')?.());

        expect(
            await screen.findByText('game_isolation.confirm_title')
        ).toBeTruthy();
    });

    it('tells the user when isolation could not be changed', async () => {
        vi.mocked(commands.appGameIsolationSet).mockRejectedValue(
            new Error('boom')
        );
        render(<GameIsolationToggle />);
        fireEvent.click(icon());

        await act(async () => {
            fireEvent.click(
                await screen.findByRole('button', {
                    name: 'game_isolation.confirm'
                })
            );
        });

        expect(toast.add).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error' })
        );
        expect(useRuntimeStore.getState().gameIsolation.enabled).toBe(false);
    });
});
