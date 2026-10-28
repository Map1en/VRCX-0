// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    DEFAULT_PREFERENCES,
    usePreferencesStore
} from '@/state/preferencesStore';

import { useSettingsHighlightStore } from '../settingsHighlightStore';
import { Field } from './SettingsField';

function Probe({ disabled = false }: { disabled?: boolean }) {
    return <span data-testid="probe" data-disabled={String(disabled)} />;
}

function row(settingId: string) {
    return document.querySelector(`[data-setting-id="${settingId}"]`);
}

describe('settings Field metadata', () => {
    afterEach(() => {
        cleanup();
        usePreferencesStore.getState().hydratePreferences(DEFAULT_PREFERENCES);
        useSettingsHighlightStore.getState().setHighlightedSetting(null);
    });

    it('disables a child whose parent in the same card is off and passes it to nested controls', () => {
        usePreferencesStore
            .getState()
            .patchPreferences({ hmdNotificationsEnabled: false });

        render(
            <Field settingId="vr.hmd.position" label="Position">
                <div>
                    <Probe />
                </div>
            </Field>
        );

        expect(row('vr.hmd.position')?.getAttribute('data-disabled')).toBe(
            'true'
        );
        expect(screen.getByTestId('probe').dataset.disabled).toBe('true');
        expect(
            screen.getByText('view.settings.field.requires_parent')
        ).toBeTruthy();

        act(() => {
            usePreferencesStore
                .getState()
                .patchPreferences({ hmdNotificationsEnabled: true });
        });

        expect(row('vr.hmd.position')?.hasAttribute('data-disabled')).toBe(
            false
        );
        expect(screen.getByTestId('probe').dataset.disabled).toBe('false');
        expect(
            screen.queryByText('view.settings.field.requires_parent')
        ).toBeNull();
    });

    it('blocks a grandchild when its outer parent is off', () => {
        usePreferencesStore.getState().patchPreferences({
            wristOverlayEnabled: false,
            wristOverlayShowDevices: true
        });

        render(
            <Field settingId="vr.wrist.battery-percent" label="Battery">
                <Probe />
            </Field>
        );

        expect(screen.getByTestId('probe').dataset.disabled).toBe('true');
    });

    it('marks a changed preference with text and resets through the provided handler', () => {
        const onReset = vi.fn();
        usePreferencesStore.getState().patchPreferences({
            hmdNotificationsEnabled: true,
            hmdNotificationPosition: 'top'
        });

        render(
            <Field
                settingId="vr.hmd.position"
                label="Position"
                onReset={onReset}
            >
                <Probe />
            </Field>
        );

        expect(row('vr.hmd.position')?.getAttribute('data-modified')).toBe(
            'true'
        );
        expect(screen.getByText('view.settings.field.modified')).toBeTruthy();
        fireEvent.click(
            screen.getByRole('button', { name: 'view.settings.field.reset' })
        );
        expect(onReset).toHaveBeenCalledTimes(1);
    });

    it('shows no marker or reset while the preference is at its default', () => {
        render(
            <Field
                settingId="vr.hmd.position"
                label="Position"
                onReset={vi.fn()}
            >
                <Probe />
            </Field>
        );

        expect(row('vr.hmd.position')?.hasAttribute('data-modified')).toBe(
            false
        );
        expect(screen.queryByText('view.settings.field.modified')).toBeNull();
        expect(
            screen.queryByRole('button', { name: 'view.settings.field.reset' })
        ).toBeNull();
    });

    it('labels settings that need a restart', () => {
        render(
            <Field settingId="system.network.proxy" label="Proxy">
                <Probe />
            </Field>
        );

        expect(
            screen.getByText('view.settings.field.restart_required')
        ).toBeTruthy();
    });

    it('marks the highlighted row', () => {
        render(
            <Field settingId="system.network.proxy" label="Proxy">
                <Probe />
            </Field>
        );

        act(() => {
            useSettingsHighlightStore
                .getState()
                .setHighlightedSetting('system.network.proxy');
        });

        expect(
            row('system.network.proxy')?.getAttribute('data-highlighted')
        ).toBe('true');
    });
});
