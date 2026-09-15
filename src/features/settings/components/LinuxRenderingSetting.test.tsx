// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LinuxRenderingSnapshot } from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    get: vi.fn<() => Promise<LinuxRenderingSnapshot | null>>(),
    set: vi.fn<(enabled: boolean) => Promise<LinuxRenderingSnapshot>>(),
    restart: vi.fn<() => Promise<void>>(),
    toast: vi.fn<
        (options: {
            title: string;
            actionProps: { children: string; onClick: () => void };
        }) => void
    >()
}));
vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appGetLinuxRendering: mocks.get,
        appSetLinuxRendering: mocks.set
    }
}));
vi.mock('@/services/shellIntegrationService', () => ({
    restartApplication: mocks.restart
}));
vi.mock('@/services/toastService', () => ({ toast: { add: mocks.toast } }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

import { useCriticalTaskStore } from '@/state/criticalTaskStore';

import { LinuxRenderingSetting } from './LinuxRenderingSetting';

afterEach(cleanup);
beforeEach(() => {
    vi.resetAllMocks();
    mocks.get.mockResolvedValue({ enabled: false, needsConfirmation: false });
    mocks.set.mockImplementation(async (enabled) => ({
        enabled,
        needsConfirmation: false
    }));
    mocks.restart.mockResolvedValue(undefined);
    useCriticalTaskStore.setState({ activeTasks: [] });
});

describe('Linux rendering setting', () => {
    it.each([false, true])(
        'saves the %s setting and leaves the restart to the user',
        async (enabled) => {
            mocks.get.mockResolvedValue({ enabled, needsConfirmation: false });
            render(<LinuxRenderingSetting />);
            const toggle = screen.getByRole('switch');
            await waitFor(() =>
                expect(toggle.hasAttribute('data-disabled')).toBe(false)
            );
            expect(toggle.getAttribute('aria-checked')).toBe(String(enabled));
            fireEvent.click(toggle);
            await waitFor(() => expect(mocks.toast).toHaveBeenCalledOnce());
            expect(mocks.set).toHaveBeenCalledWith(!enabled);
            expect(mocks.restart).not.toHaveBeenCalled();
            mocks.toast.mock.calls[0][0].actionProps.onClick();
            expect(mocks.restart).toHaveBeenCalledOnce();
        }
    );

    it('does not offer a restart when saving the setting fails', async () => {
        mocks.set.mockRejectedValue(new Error('storage unavailable'));
        render(<LinuxRenderingSetting />);
        const toggle = screen.getByRole('switch');
        await waitFor(() =>
            expect(toggle.hasAttribute('data-disabled')).toBe(false)
        );
        fireEvent.click(toggle);
        await screen.findByText('linux_rendering.failed');
        expect(mocks.toast).not.toHaveBeenCalled();
        expect(toggle.getAttribute('aria-checked')).toBe('false');
    });

    it('hides the setting when the environment owns the rendering mode', async () => {
        mocks.get.mockResolvedValue(null);
        const { container } = render(<LinuxRenderingSetting />);
        await waitFor(() =>
            expect(container.querySelector('[role="switch"]')).toBeNull()
        );
    });

    it('prevents a settings change while a critical task is active', async () => {
        useCriticalTaskStore
            .getState()
            .setCriticalTaskActive('databaseUpgrade', true);
        render(<LinuxRenderingSetting />);
        await waitFor(() => expect(mocks.get).toHaveBeenCalledOnce());
        const toggle = screen.getByRole('switch');
        expect(toggle.hasAttribute('data-disabled')).toBe(true);
        fireEvent.click(toggle);
        expect(mocks.set).not.toHaveBeenCalled();
    });
});
