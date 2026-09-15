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
    confirm: vi.fn<() => Promise<LinuxRenderingSnapshot>>(),
    restart: vi.fn<() => Promise<void>>()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appGetLinuxRendering: mocks.get,
        appSetLinuxRendering: mocks.set,
        appConfirmLinuxRendering: mocks.confirm
    }
}));
vi.mock('@/services/shellIntegrationService', () => ({
    restartApplication: mocks.restart
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));
vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: (
        selector: (state: {
            hostCapabilities: { platform: 'linux' };
        }) => unknown
    ) => selector({ hostCapabilities: { platform: 'linux' } })
}));

import { LinuxRenderingTrialHost } from './LinuxRenderingTrialHost';

const trial: LinuxRenderingSnapshot = {
    enabled: true,
    needsConfirmation: true
};

afterEach(cleanup);
beforeEach(() => {
    vi.resetAllMocks();
    mocks.get.mockResolvedValue(trial);
    mocks.confirm.mockResolvedValue({
        enabled: true,
        needsConfirmation: false
    });
    mocks.set.mockResolvedValue({ enabled: false, needsConfirmation: false });
    mocks.restart.mockResolvedValue(undefined);
});

describe('Linux rendering trial confirmation', () => {
    it('requires an explicit keep action rather than accepting a rendered page', async () => {
        render(<LinuxRenderingTrialHost />);
        await screen.findByRole('dialog', {
            name: 'linux_rendering.confirm_title'
        });
        expect(mocks.confirm).not.toHaveBeenCalled();
        fireEvent.click(
            screen.getByRole('button', { name: 'linux_rendering.keep' })
        );
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(mocks.confirm).toHaveBeenCalledOnce();
        expect(mocks.restart).not.toHaveBeenCalled();
    });

    it('restores compatibility and restarts on rejection', async () => {
        render(<LinuxRenderingTrialHost />);
        fireEvent.click(
            await screen.findByRole('button', {
                name: 'linux_rendering.restore'
            })
        );
        await waitFor(() => expect(mocks.restart).toHaveBeenCalledOnce());
        expect(mocks.set).toHaveBeenCalledWith(false);
        expect(mocks.confirm).not.toHaveBeenCalled();
    });

    it('keeps the recovery action available after confirmation fails', async () => {
        mocks.confirm.mockRejectedValue(new Error('trial expired'));
        render(<LinuxRenderingTrialHost />);
        fireEvent.click(
            await screen.findByRole('button', { name: 'linux_rendering.keep' })
        );
        expect((await screen.findByRole('alert')).textContent).toBe(
            'linux_rendering.failed'
        );
        expect(
            screen
                .getByRole('button', { name: 'linux_rendering.restore' })
                .hasAttribute('disabled')
        ).toBe(false);
        expect(mocks.restart).not.toHaveBeenCalled();
    });
});
