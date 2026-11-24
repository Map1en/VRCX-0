// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HeartRateStatus } from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    appHeartRateStatusGet: vi.fn(),
    appHeartRateConnectedSet: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appHeartRateStatusGet: mocks.appHeartRateStatusGet,
        appHeartRateConnectedSet: mocks.appHeartRateConnectedSet
    }
}));

import { ChatboxHeartRateCard } from './ChatboxHeartRateCard';

function status(overrides: Partial<HeartRateStatus>): HeartRateStatus {
    return {
        enabled: false,
        phase: 'off',
        deviceName: null,
        bpm: null,
        problem: null,
        ...overrides
    };
}

describe('ChatboxHeartRateCard', () => {
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('shows the live reading and disconnects on click', async () => {
        mocks.appHeartRateStatusGet.mockResolvedValue(
            status({
                enabled: true,
                phase: 'connected',
                deviceName: 'Band',
                bpm: 72
            })
        );
        mocks.appHeartRateConnectedSet.mockResolvedValue(
            status({ deviceName: 'Band' })
        );
        render(<ChatboxHeartRateCard />);

        await screen.findByText('view.tools.chatbox.heart_rate.connected');
        fireEvent.click(
            screen.getByRole('switch', {
                name: 'view.tools.chatbox.heart_rate.connect'
            })
        );

        await waitFor(() =>
            expect(mocks.appHeartRateConnectedSet).toHaveBeenCalledWith(false)
        );
        await waitFor(() =>
            expect(
                screen
                    .getByRole('switch', {
                        name: 'view.tools.chatbox.heart_rate.connect'
                    })
                    .getAttribute('aria-checked')
            ).toBe('false')
        );
    });

    it('disables the connect switch without Bluetooth', async () => {
        mocks.appHeartRateStatusGet.mockResolvedValue(
            status({ phase: 'unavailable' })
        );
        render(<ChatboxHeartRateCard />);

        await screen.findByText('view.tools.chatbox.heart_rate.unavailable');

        expect(
            screen
                .getByRole('switch', {
                    name: 'view.tools.chatbox.heart_rate.connect'
                })
                .hasAttribute('data-disabled')
        ).toBe(true);
    });

    it('can still be turned off when Bluetooth drops while connected', async () => {
        mocks.appHeartRateStatusGet.mockResolvedValue(
            status({ enabled: true, phase: 'unavailable' })
        );
        render(<ChatboxHeartRateCard />);

        await screen.findByText('view.tools.chatbox.heart_rate.unavailable');

        const toggle = screen.getByRole('switch', {
            name: 'view.tools.chatbox.heart_rate.connect'
        });
        expect(toggle.getAttribute('aria-checked')).toBe('true');
        expect(toggle.hasAttribute('data-disabled')).toBe(false);
    });

    it('explains why it stopped when the device has no heart rate', async () => {
        mocks.appHeartRateStatusGet.mockResolvedValue(
            status({ problem: 'incompatible' })
        );
        render(<ChatboxHeartRateCard />);

        await screen.findByText('view.tools.chatbox.heart_rate.incompatible');
    });
});
