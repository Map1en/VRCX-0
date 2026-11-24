// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SettingsPageStateSections } from '../settingsPageStateSections';
import { useSettingsVrTabState } from './useSettingsVrTabState';

const captured = vi.hoisted(() => ({
    props: undefined as Record<string, unknown> | undefined,
    vr: undefined as unknown
}));

vi.mock('../SettingsPageStateContext', () => ({
    useSettingsPageSection: () => captured.vr
}));

type VrSectionState = SettingsPageStateSections['vr'];

function callback(name: string): (...args: unknown[]) => unknown {
    const value = captured.props?.[name];
    expect(value).toBeTypeOf('function');
    return value as (...args: unknown[]) => unknown;
}

function createVrSectionState(): VrSectionState {
    return {
        setHmdNotificationsDialogOpen: vi.fn(),
        setVrNotificationsDialogOpen: vi.fn(),
        setWristFeedNotificationsDialogOpen: vi.fn(),
        savePreferenceValue: vi.fn(),
        saveStringPreference: vi.fn(),
        saveBoolPreference: vi.fn(),
        setIntConfigPreference: vi.fn(),
        saveWristOverlayEnabled: vi.fn()
    };
}

function renderVrTabState() {
    const { result } = renderHook(() => useSettingsVrTabState());
    captured.props = result.current as Record<string, unknown>;
}

describe('useSettingsVrTabState', () => {
    beforeEach(() => {
        captured.props = undefined;
        captured.vr = undefined;
    });

    it('saves when external VR overlay notifications are shown', () => {
        const vr = createVrSectionState();
        captured.vr = vr;
        renderVrTabState();

        callback('onOverlayToastChange')('Game Closed');
        expect(vr.saveStringPreference).toHaveBeenLastCalledWith(
            'overlayToast',
            'overlayToast',
            'Game Closed'
        );
    });

    it('persists notification number inputs with their config bounds', () => {
        const vr = createVrSectionState();
        captured.vr = vr;
        renderVrTabState();

        callback('onNotificationTimeoutSecondsChange')('900');
        expect(vr.savePreferenceValue).toHaveBeenLastCalledWith(
            'notificationTimeout',
            600000,
            expect.any(Function)
        );
        const notificationTimeoutCommit = vi.mocked(vr.savePreferenceValue).mock
            .calls[0][2];
        notificationTimeoutCommit();
        expect(vr.setIntConfigPreference).toHaveBeenLastCalledWith(
            'notificationTimeout',
            600000,
            { min: 0, max: 600000, fallback: 3000 }
        );

        callback('onNotificationOpacityChange')(42.6);
        expect(vr.savePreferenceValue).toHaveBeenLastCalledWith(
            'notificationOpacity',
            43,
            expect.any(Function)
        );
        const notificationOpacityCommit = vi.mocked(vr.savePreferenceValue).mock
            .calls[1][2];
        notificationOpacityCommit();
        expect(vr.setIntConfigPreference).toHaveBeenLastCalledWith(
            'notificationOpacity',
            43,
            { min: 0, max: 100, fallback: 100 }
        );

        callback('onHmdNotificationTimeoutSecondsChange')('');
        expect(vr.savePreferenceValue).toHaveBeenLastCalledWith(
            'hmdNotificationTimeout',
            5000,
            expect.any(Function)
        );
        const hmdTimeoutCommit = vi.mocked(vr.savePreferenceValue).mock
            .calls[2][2];
        hmdTimeoutCommit();
        expect(vr.setIntConfigPreference).toHaveBeenLastCalledWith(
            'hmdNotificationTimeout',
            5000,
            { min: 1000, max: 30000, fallback: 5000 }
        );

        callback('onHmdNotificationOpacityChange')(-10);
        expect(vr.savePreferenceValue).toHaveBeenLastCalledWith(
            'hmdNotificationOpacity',
            0,
            expect.any(Function)
        );
    });

    it.each([
        ['onXsNotificationsChange', 'xsNotifications'],
        ['onOvrtHudNotificationsChange', 'ovrtHudNotifications'],
        ['onOvrtWristNotificationsChange', 'ovrtWristNotifications'],
        ['onImageNotificationsChange', 'imageNotifications'],
        ['onHmdNotificationsEnabledChange', 'hmdNotificationsEnabled'],
        ['onHmdNotificationAvatarsChange', 'hmdNotificationAvatars'],
        [
            'onHmdNotificationTrackerDisconnectChange',
            'hmdNotificationTrackerDisconnect'
        ],
        ['onWristOverlayDarkBackgroundChange', 'wristOverlayDarkBackground'],
        [
            'onWristOverlayHidePrivateWorldsChange',
            'wristOverlayHidePrivateWorlds'
        ],
        ['onWristOverlayShowDevicesChange', 'wristOverlayShowDevices'],
        [
            'onWristOverlayShowBatteryPercentChange',
            'wristOverlayShowBatteryPercent'
        ],
        ['onWristOverlayShowSecondsChange', 'wristOverlayShowSeconds']
    ])('maps %s to the %s boolean preference', (propName, key) => {
        const vr = createVrSectionState();
        captured.vr = vr;
        renderVrTabState();

        callback(propName)(true);

        expect(vr.saveBoolPreference).toHaveBeenCalledWith(key, key, true);
    });

    it.each([
        ['onHmdNotificationStartModeChange', 'hmdNotificationStartMode'],
        ['onHmdNotificationPositionChange', 'hmdNotificationPosition'],
        ['onHmdNotificationStyleChange', 'hmdNotificationStyle'],
        ['onWristOverlayStartModeChange', 'wristOverlayStartMode'],
        ['onWristOverlayButtonChange', 'wristOverlayButton'],
        ['onWristOverlayHandChange', 'wristOverlayHand'],
        ['onWristOverlaySizeChange', 'wristOverlaySize']
    ])('maps %s to the %s string preference', (propName, key) => {
        const vr = createVrSectionState();
        captured.vr = vr;
        renderVrTabState();

        callback(propName)('selected-value');

        expect(vr.saveStringPreference).toHaveBeenCalledWith(
            key,
            key,
            'selected-value'
        );
    });

    it('routes wrist enablement and filter-dialog actions to their owners', () => {
        const vr = createVrSectionState();
        captured.vr = vr;
        renderVrTabState();

        callback('onWristOverlayEnabledChange')(true);
        callback('onOpenVrNotificationFiltersDialog')();
        callback('onOpenHmdNotificationFiltersDialog')();
        callback('onOpenWristFeedNotificationsDialog')();

        expect(vr.saveWristOverlayEnabled).toHaveBeenCalledWith(true);
        expect(vr.setVrNotificationsDialogOpen).toHaveBeenCalledWith(true);
        expect(vr.setHmdNotificationsDialogOpen).toHaveBeenCalledWith(true);
        expect(vr.setWristFeedNotificationsDialogOpen).toHaveBeenCalledWith(
            true
        );
    });
});
