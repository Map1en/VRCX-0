// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    ActivityTypeDefinition,
    NotificationSoundRule
} from '@/platform/tauri/bindings';

import { SettingsNotificationSoundsCard } from './SettingsNotificationSoundsCard';

const labels = 'view.settings.notifications.notifications.activity_sounds';
const mocks = vi.hoisted(() => ({
    appOverlayActivityDefinitionsGet:
        vi.fn<() => Promise<ActivityTypeDefinition[]>>(),
    appHostNotificationSoundRules:
        vi.fn<() => Promise<Record<string, NotificationSoundRule>>>(),
    appHostNotificationSoundSetRule:
        vi.fn<
            (event: string, rule: NotificationSoundRule | null) => Promise<null>
        >(),
    appHostNotificationSoundChooseFile: vi.fn<() => Promise<string | null>>(),
    appHostNotificationSoundPreview:
        vi.fn<(rule: NotificationSoundRule) => Promise<null>>()
}));

vi.mock('@/platform/tauri/bindings', () => ({ commands: mocks }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

const joinRule: NotificationSoundRule = {
    source: { kind: 'builtin', id: 'join_01_chime' },
    volume: 30
};

function combobox(label: 'event' | 'source') {
    return screen.findByRole('combobox', { name: `${labels}.${label}` });
}

async function selectOption(
    user: ReturnType<typeof userEvent.setup>,
    label: 'event' | 'source',
    optionName: string
) {
    const select = await combobox(label);
    await waitFor(() =>
        expect((select as HTMLButtonElement).disabled).toBe(false)
    );
    await user.click(select);
    await user.click(await screen.findByRole('option', { name: optionName }));
}

describe('SettingsNotificationSoundsCard', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.appOverlayActivityDefinitionsGet.mockResolvedValue([
            {
                key: 'OnPlayerJoined',
                category: 'currentInstance',
                allowedScopes: ['off', 'on', 'friends'],
                wristDefaultScope: 'off',
                alertDefaultScope: 'off',
                desktopDefaultScope: 'off',
                ttsDefaultScope: 'off',
                widgetDefaultScope: 'off',
                aliases: []
            }
        ]);
        mocks.appHostNotificationSoundRules.mockResolvedValue({
            OnPlayerJoined: joinRule
        });
        mocks.appHostNotificationSoundSetRule.mockResolvedValue(null);
        mocks.appHostNotificationSoundPreview.mockResolvedValue(null);
    });

    afterEach(cleanup);

    it('loads rules, stores a sound and volume for another log type, and previews that rule', async () => {
        const user = userEvent.setup();
        render(<SettingsNotificationSoundsCard />);
        expect(await screen.findByText('30%')).toBeTruthy();

        await selectOption(user, 'event', 'view.game_log.filters.PortalSpawn');
        expect(screen.getByText('50%')).toBeTruthy();
        await selectOption(user, 'source', `${labels}.builtin.join_03_arp`);
        const portalRule: NotificationSoundRule = {
            source: { kind: 'builtin', id: 'join_03_arp' },
            volume: 50
        };
        expect(mocks.appHostNotificationSoundSetRule).toHaveBeenLastCalledWith(
            'PortalSpawn',
            portalRule
        );

        const slider = await screen.findByLabelText(`${labels}.volume`);
        await waitFor(() =>
            expect((slider as HTMLInputElement).disabled).toBe(false)
        );
        fireEvent.keyDown(slider, { key: 'End' });
        await waitFor(() =>
            expect(
                mocks.appHostNotificationSoundSetRule
            ).toHaveBeenLastCalledWith('PortalSpawn', {
                ...portalRule,
                volume: 100
            })
        );
        expect(screen.getByText('100%')).toBeTruthy();
        const preview = screen.getByRole('button', { name: `${labels}.play` });
        await waitFor(() =>
            expect((preview as HTMLButtonElement).disabled).toBe(false)
        );
        await user.click(preview);
        expect(mocks.appHostNotificationSoundPreview).toHaveBeenLastCalledWith({
            ...portalRule,
            volume: 100
        });

        await selectOption(user, 'source', `${labels}.off`);
        expect(mocks.appHostNotificationSoundSetRule).toHaveBeenLastCalledWith(
            'PortalSpawn',
            null
        );
        await selectOption(
            user,
            'event',
            'dialog.wrist_feed_notifications.types.OnPlayerJoined'
        );
        expect(screen.getByText('30%')).toBeTruthy();
    });

    it('keeps the current rule when file selection is canceled and saves a selected custom file', async () => {
        const user = userEvent.setup();
        const path = 'C:\\Music\\short sound.wav';
        mocks.appHostNotificationSoundChooseFile
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(path);
        render(<SettingsNotificationSoundsCard />);

        await selectOption(user, 'source', `${labels}.custom`);
        expect(mocks.appHostNotificationSoundSetRule).not.toHaveBeenCalled();

        await selectOption(user, 'source', `${labels}.custom`);
        expect(mocks.appHostNotificationSoundSetRule).toHaveBeenLastCalledWith(
            'OnPlayerJoined',
            { source: { kind: 'custom', path }, volume: 30 }
        );
        expect(await screen.findByText('short sound.wav')).toBeTruthy();
        mocks.appHostNotificationSoundChooseFile.mockRejectedValueOnce(
            new Error('Unsupported file')
        );
        await user.click(
            screen.getByRole('button', { name: `${labels}.choose_file` })
        );
        expect((await screen.findByRole('alert')).textContent).toBe(
            `${labels}.file_failed`
        );
        expect(screen.getByText('short sound.wav')).toBeTruthy();
        expect(mocks.appHostNotificationSoundSetRule).toHaveBeenCalledTimes(1);
    });

    it('previews the common resource rule for an unconfigured image load', async () => {
        const user = userEvent.setup();
        const commonRule: NotificationSoundRule = {
            source: { kind: 'builtin', id: 'notify_01_ding' },
            volume: 75
        };
        mocks.appHostNotificationSoundRules.mockResolvedValue({
            ResourceLoad: commonRule
        });
        render(<SettingsNotificationSoundsCard />);

        await selectOption(user, 'event', 'view.game_log.filters.ImageLoad');
        expect((await combobox('source')).textContent).toContain(
            `${labels}.use_resource_default`
        );
        expect(screen.getByText('75%')).toBeTruthy();
        await user.click(
            screen.getByRole('button', { name: `${labels}.play` })
        );
        expect(mocks.appHostNotificationSoundPreview).toHaveBeenCalledWith(
            commonRule
        );
        expect(mocks.appHostNotificationSoundSetRule).not.toHaveBeenCalled();
    });

    it('allows the user to retry loading settings after a failure', async () => {
        const user = userEvent.setup();
        mocks.appHostNotificationSoundRules.mockRejectedValueOnce(
            new Error('Could not load settings')
        );
        render(<SettingsNotificationSoundsCard />);

        expect((await screen.findByRole('alert')).textContent).toBe(
            `${labels}.load_failed`
        );
        await user.click(
            screen.getByRole('button', { name: 'common.actions.retry' })
        );
        expect(await screen.findByText('30%')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });
});
