// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/ui/shadcn/select', () => {
    type SelectProps = PropsWithChildren<{
        disabled?: boolean;
        value?: string;
        onValueChange(value: string | null): void;
    }>;
    type SelectItemProps = PropsWithChildren<{ value: string }>;

    return {
        Select: ({ children, disabled = false, value }: SelectProps) => (
            <div
                data-select-disabled={disabled ? 'true' : 'false'}
                data-select-value={value}
            >
                {children}
            </div>
        ),
        SelectContent: ({ children }: PropsWithChildren) => (
            <div>{children}</div>
        ),
        SelectGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
        SelectItem: ({ children, value }: SelectItemProps) => (
            <span data-value={value}>{children}</span>
        ),
        SelectTrigger: ({
            children,
            id
        }: PropsWithChildren<{ id?: string }>) => (
            <button id={id}>{children}</button>
        ),
        SelectValue: ({ placeholder }: { placeholder?: ReactNode }) => (
            <span>{placeholder}</span>
        )
    };
});

vi.mock('@/ui/shadcn/switch', () => ({
    Switch: ({
        checked = false,
        disabled = false,
        onCheckedChange
    }: {
        checked?: boolean;
        disabled?: boolean;
        onCheckedChange(value: boolean): void;
    }) => (
        <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(event) => onCheckedChange(event.currentTarget.checked)}
        />
    )
}));

vi.mock('@/ui/shadcn/slider', () => ({
    Slider: ({
        id,
        onValueChange,
        onValueCommitted,
        value
    }: {
        id?: string;
        onValueChange(value: number[]): void;
        onValueCommitted(value: number[]): void;
        value: number[];
    }) => (
        <input
            id={id}
            type="range"
            value={value[0]}
            onChange={(event) =>
                onValueChange([Number(event.currentTarget.value)])
            }
            onMouseUp={(event) =>
                onValueCommitted([Number(event.currentTarget.value)])
            }
        />
    )
}));

vi.mock('../SettingsField', () => ({
    Field: ({
        children,
        label,
        disabled = false
    }: {
        children?: ReactNode;
        label?: ReactNode;
        disabled?: boolean;
    }) => (
        <section
            data-field-label={String(label)}
            data-field-disabled={disabled ? 'true' : 'false'}
        >
            {children}
        </section>
    )
}));

vi.mock('../SettingsViewParts', () => ({
    SettingsTabContent: ({ children }: PropsWithChildren) => (
        <div>{children}</div>
    )
}));

import { SettingsNotificationsTabContent as SettingsNotificationsTab } from './SettingsNotificationsTab';

type TabProps = ComponentProps<typeof SettingsNotificationsTab>;

function createProps(overrides: Partial<TabProps> = {}): TabProps {
    return {
        desktopToastOptions: [['Always', 'desktop.always']],
        notificationTtsOptions: [
            ['Never', 'tts.never'],
            ['Always', 'tts.always']
        ],
        notificationTtsNameModeOptions: [
            ['username', 'tts.username'],
            ['displayName', 'tts.display_name']
        ],
        notificationLayoutOptions: [['table', 'layout.table']],
        showTaskbarIconDot: false,
        showDesktopWidget: false,
        onNotificationLayoutChange: vi.fn(),
        onNotificationIconDotChange: vi.fn(),
        onTaskbarIconDotChange: vi.fn(),
        onFriendLogNotificationDotChange: vi.fn(),
        notificationTtsTest: 'Hello from VRCX-0',
        notificationTtsTestVisible: true,
        onAfkDesktopToastChange: vi.fn(),
        onDesktopNotificationSoundChange: vi.fn(),
        onDesktopNotificationAvatarsChange: vi.fn(),
        onDesktopToastChange: vi.fn(),
        onNotificationTtsModeChange: vi.fn(),
        onNotificationDoNotDisturbEndOnGameStartChange: vi.fn(),
        onBusyStatusDoNotDisturbChange: vi.fn(),
        onHideVideoErrorNotificationsChange: vi.fn(),
        onNotificationTtsNameModeChange: vi.fn(),
        onNotificationTtsTestChange: vi.fn(),
        onNotificationTtsTestVisibleChange: vi.fn(),
        onNotificationTtsVoiceChange: vi.fn(),
        onNotificationTtsVolumeChange: vi.fn(),
        onOpenDesktopNotificationFiltersDialog: vi.fn(),
        onDesktopWidgetOpacityChange: vi.fn(),
        onDesktopWidgetOrderChange: vi.fn(),
        onOpenDesktopWidgetFiltersDialog: vi.fn(),
        onOpenTtsNotificationFiltersDialog: vi.fn(),
        onSendTestNotification: vi.fn(),
        onSpeakNotificationTts: vi.fn(),
        prefs: {
            notificationLayout: 'table',
            notificationIconDot: true,
            taskbarIconDot: true,
            friendLogNotificationDot: true,
            desktopToast: 'Always',
            afkDesktopToast: false,
            desktopNotificationSound: true,
            desktopNotificationAvatars: true,
            notificationDoNotDisturbEndOnGameStart: true,
            busyStatusDoNotDisturb: true,
            hideVideoErrorNotifications: false,
            notificationTTS: 'Never',
            notificationTTSNameMode: 'username',
            notificationTTSNickName: false,
            notificationTTSVoiceNative: '',
            notificationTTSVolume: 100,
            desktopWidgetOpacity: 55,
            desktopWidgetNewestOnTop: true
        },
        ttsVoices: [{ id: 'voice-1', name: 'Test Voice', language: 'en-US' }],
        ...overrides
    };
}

function selectDisabled(id: string) {
    const trigger = document.getElementById(id);
    expect(trigger).not.toBeNull();
    return trigger
        ?.closest('[data-field-label]')
        ?.getAttribute('data-field-disabled');
}

function ttsPreviewSwitch() {
    const field = document.querySelector(
        '[data-field-label="view.settings.notifications.notifications.text_to_speech.tts_test_placeholder"]'
    );
    const control = field?.querySelector('input');
    expect(control).toBeInstanceOf(HTMLInputElement);
    return control as HTMLInputElement;
}

const previewPlaceholder =
    'view.settings.notifications.notifications.text_to_speech.tts_test_placeholder';
const playLabel =
    'view.settings.notifications.notifications.text_to_speech.play';
const activityWindowHeader =
    'view.settings.notifications.notifications.desktop_widget.header';
const activityWindowUsageHint =
    'view.settings.notifications.notifications.desktop_widget.usage_hint';
const activityWindowFiltersLabel =
    'view.settings.notifications.notifications.desktop_widget.activity_filters';

describe('SettingsNotificationsTab', () => {
    afterEach(cleanup);

    it('sends a test notification from its settings field', () => {
        const props = createProps();
        render(<SettingsNotificationsTab {...props} />);

        const field = document.querySelector(
            '[data-field-label="view.settings.notifications.notifications.test_notification.send"]'
        );
        const button = field?.querySelector('button');
        expect(button).toBeInstanceOf(HTMLButtonElement);
        fireEvent.click(button as HTMLButtonElement);

        expect(props.onSendTestNotification).toHaveBeenCalledTimes(1);
    });

    it('disables automatic TTS details when delivery is Never but keeps manual preview available', () => {
        const props = createProps();
        render(<SettingsNotificationsTab {...props} />);

        expect(selectDisabled('settings-notification-tts-voice')).toBe('true');
        expect(selectDisabled('settings-notification-tts-name-mode')).toBe(
            'true'
        );
        expect(ttsPreviewSwitch().disabled).toBe(false);

        const input = screen.getByPlaceholderText(
            previewPlaceholder
        ) as HTMLInputElement;
        const play = screen.getByRole('button', {
            name: playLabel
        }) as HTMLButtonElement;
        expect(input.disabled).toBe(false);
        expect(play.disabled).toBe(false);

        fireEvent.click(play);
        expect(props.onSpeakNotificationTts).toHaveBeenCalledWith(
            'Hello from VRCX-0'
        );
    });

    it('enables automatic TTS details when delivery is active', () => {
        const props = createProps();
        render(
            <SettingsNotificationsTab
                {...props}
                prefs={{
                    ...props.prefs,
                    notificationTTS: 'Always',
                    notificationTTSNameMode: 'username',
                    notificationTTSVoiceNative: ''
                }}
            />
        );

        expect(selectDisabled('settings-notification-tts-voice')).toBe('false');
        expect(selectDisabled('settings-notification-tts-name-mode')).toBe(
            'false'
        );
    });

    it('keeps TTS volume adjustable while automatic delivery is disabled and saves on commit', () => {
        const props = createProps();
        render(<SettingsNotificationsTab {...props} />);

        const slider = document.getElementById(
            'settings-notification-tts-volume'
        ) as HTMLInputElement;
        expect(slider).toBeInstanceOf(HTMLInputElement);
        expect(slider.disabled).toBe(false);
        expect(screen.getByText('100%')).toBeTruthy();

        fireEvent.change(slider, { target: { value: '42' } });
        expect(screen.getByText('42%')).toBeTruthy();
        expect(props.onNotificationTtsVolumeChange).not.toHaveBeenCalled();

        fireEvent.mouseUp(slider, { target: { value: '42' } });
        expect(props.onNotificationTtsVolumeChange).toHaveBeenCalledWith(42);
    });

    it('offers desktop overlay settings only where the platform supports the window', () => {
        const props = createProps();
        const view = render(<SettingsNotificationsTab {...props} />);

        expect(screen.queryByText(activityWindowHeader)).toBeNull();
        expect(
            document.getElementById('settings-desktop-widget-opacity')
        ).toBeNull();

        view.rerender(
            <SettingsNotificationsTab {...props} showDesktopWidget />
        );

        expect(screen.getByText(activityWindowHeader)).toBeTruthy();
        expect(screen.getByText(activityWindowUsageHint)).toBeTruthy();
    });

    it('shows which end of the desktop overlay new activity appears at', () => {
        const defaults = createProps({ showDesktopWidget: true });
        render(
            <SettingsNotificationsTab
                {...defaults}
                prefs={{ ...defaults.prefs, desktopWidgetNewestOnTop: false }}
            />
        );

        const trigger = document.getElementById(
            'settings-desktop-widget-order'
        );
        expect(trigger?.parentElement?.getAttribute('data-select-value')).toBe(
            'bottom'
        );
        expect(
            screen.getByText(
                'view.settings.notifications.notifications.desktop_widget.order_newest_top'
            )
        ).toBeTruthy();
        expect(
            screen.getByText(
                'view.settings.notifications.notifications.desktop_widget.order_newest_bottom'
            )
        ).toBeTruthy();
    });

    it('saves the desktop overlay background opacity when the slider is released', () => {
        const props = createProps({ showDesktopWidget: true });
        render(<SettingsNotificationsTab {...props} />);

        const slider = document.getElementById(
            'settings-desktop-widget-opacity'
        ) as HTMLInputElement;
        expect(slider).toBeInstanceOf(HTMLInputElement);
        expect(screen.getByText('55%')).toBeTruthy();

        fireEvent.change(slider, { target: { value: '30' } });
        expect(screen.getByText('30%')).toBeTruthy();
        expect(props.onDesktopWidgetOpacityChange).not.toHaveBeenCalled();

        fireEvent.mouseUp(slider, { target: { value: '30' } });
        expect(props.onDesktopWidgetOpacityChange).toHaveBeenCalledWith(30);
    });

    it('opens the desktop overlay activity filters from its settings card', () => {
        const props = createProps({ showDesktopWidget: true });
        render(<SettingsNotificationsTab {...props} />);

        const field = document.querySelector(
            `[data-field-label="${activityWindowFiltersLabel}"]`
        );
        const button = field?.querySelector('button');
        expect(button).toBeInstanceOf(HTMLButtonElement);
        fireEvent.click(button as HTMLButtonElement);

        expect(props.onOpenDesktopWidgetFiltersDialog).toHaveBeenCalledTimes(1);
        expect(
            props.onOpenDesktopNotificationFiltersDialog
        ).not.toHaveBeenCalled();
    });

    it('renders preview input and play action only when the preview is visible', () => {
        const onVisibleChange = vi.fn();
        const props = createProps({
            notificationTtsTestVisible: false,
            onNotificationTtsTestVisibleChange: onVisibleChange
        });
        const view = render(<SettingsNotificationsTab {...props} />);

        expect(screen.queryByPlaceholderText(previewPlaceholder)).toBeNull();
        expect(screen.queryByRole('button', { name: playLabel })).toBeNull();

        fireEvent.click(ttsPreviewSwitch());
        expect(onVisibleChange).toHaveBeenCalledWith(true);

        view.rerender(
            <SettingsNotificationsTab {...props} notificationTtsTestVisible />
        );
        expect(screen.getByPlaceholderText(previewPlaceholder)).toBeTruthy();
        expect(screen.getByRole('button', { name: playLabel })).toBeTruthy();
    });
});

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn(), close: vi.fn() }
}));
