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

import {
    commands,
    type DesktopWidgetSnapshot
} from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { useRuntimeStore } from '@/state/runtimeStore';

vi.mock('@/platform/tauri/bindings', async () =>
    (await import('@/test/mockCommands')).mockBindingsModule()
);

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

import { DesktopWidgetToggle } from './DesktopWidgetToggle';

function widgetIs(patch: Partial<DesktopWidgetSnapshot>) {
    act(() =>
        useRuntimeStore.getState().setDesktopWidget({
            supported: true,
            enabled: false,
            pinned: true,
            clickThrough: false,
            ...patch
        })
    );
}

function toggle() {
    return screen.queryByRole('button');
}

beforeEach(() => {
    widgetIs({});
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('status bar desktop overlay toggle', () => {
    it('is not offered where the desktop overlay is unavailable', () => {
        widgetIs({ supported: false });

        render(<DesktopWidgetToggle />);

        expect(toggle()).toBeNull();
    });

    it('turns the desktop overlay on with one click', async () => {
        vi.mocked(commands.appDesktopWidgetEnabledSet).mockResolvedValue({
            supported: true,
            enabled: true,
            pinned: true,
            clickThrough: false
        });
        render(<DesktopWidgetToggle />);
        expect(toggle()?.getAttribute('aria-pressed')).toBe('false');

        await act(async () => {
            fireEvent.click(toggle()!);
        });

        expect(commands.appDesktopWidgetEnabledSet).toHaveBeenCalledWith(true);
        expect(toggle()?.getAttribute('aria-pressed')).toBe('true');
    });

    it('turns an open desktop overlay off with one click', async () => {
        widgetIs({ enabled: true });
        vi.mocked(commands.appDesktopWidgetEnabledSet).mockResolvedValue({
            supported: true,
            enabled: false,
            pinned: true,
            clickThrough: false
        });
        render(<DesktopWidgetToggle />);

        await act(async () => {
            fireEvent.click(toggle()!);
        });

        expect(commands.appDesktopWidgetEnabledSet).toHaveBeenCalledWith(false);
        expect(toggle()?.getAttribute('aria-pressed')).toBe('false');
    });

    it('says when the open window lets clicks pass through and where to turn it off', () => {
        widgetIs({ enabled: true, clickThrough: true });

        render(<DesktopWidgetToggle />);

        expect(screen.getByRole('tooltip').textContent).toBe(
            'status_bar.desktop_widget_click_throughstatus_bar.desktop_widget_menu_hint'
        );
    });

    it('turns click-through off from the right-click menu', async () => {
        widgetIs({ enabled: true, clickThrough: true });
        vi.mocked(
            commands.appDesktopWidgetClickThroughToggle
        ).mockResolvedValue({
            supported: true,
            enabled: true,
            pinned: true,
            clickThrough: false
        });
        render(<DesktopWidgetToggle />);

        fireEvent.contextMenu(toggle()!);
        const item = await screen.findByRole('menuitemcheckbox', {
            name: 'desktop_widget.menu.click_through'
        });
        expect(item.getAttribute('aria-checked')).toBe('true');
        await act(async () => {
            fireEvent.click(item);
        });

        expect(commands.appDesktopWidgetClickThroughToggle).toHaveBeenCalled();
        expect(useRuntimeStore.getState().desktopWidget.clickThrough).toBe(
            false
        );
    });

    it('closes the desktop overlay from the right-click menu', async () => {
        widgetIs({ enabled: true });
        vi.mocked(commands.appDesktopWidgetEnabledSet).mockResolvedValue({
            supported: true,
            enabled: false,
            pinned: true,
            clickThrough: false
        });
        render(<DesktopWidgetToggle />);

        fireEvent.contextMenu(toggle()!);
        await act(async () => {
            fireEvent.click(
                await screen.findByRole('menuitem', {
                    name: 'desktop_widget.menu.close'
                })
            );
        });

        expect(commands.appDesktopWidgetEnabledSet).toHaveBeenCalledWith(false);
        expect(toggle()?.getAttribute('aria-pressed')).toBe('false');
    });

    it('tells the user when the window could not be switched', async () => {
        vi.mocked(commands.appDesktopWidgetEnabledSet).mockRejectedValue(
            new Error('boom')
        );
        render(<DesktopWidgetToggle />);

        await act(async () => {
            fireEvent.click(toggle()!);
        });

        expect(toast.add).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error' })
        );
        expect(toggle()?.getAttribute('aria-pressed')).toBe('false');
    });
});
