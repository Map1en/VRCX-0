import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key
    })
}));

type ChildrenProps = {
    children?: ReactNode;
};

type FieldProps = ChildrenProps & {
    label?: ReactNode;
};

type SwitchProps = {
    checked?: boolean;
    disabled?: boolean;
};

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({ children }: ChildrenProps) => <button>{children}</button>
}));

vi.mock('@/ui/shadcn/input', () => ({
    Input: () => <input />
}));

vi.mock('@/ui/shadcn/select', () => ({
    Select: ({ children }: ChildrenProps) => <div>{children}</div>,
    SelectContent: ({ children }: ChildrenProps) => <div>{children}</div>,
    SelectGroup: ({ children }: ChildrenProps) => <div>{children}</div>,
    SelectItem: ({ children }: ChildrenProps) => <div>{children}</div>,
    SelectTrigger: ({ children }: ChildrenProps) => <button>{children}</button>,
    SelectValue: () => <span />
}));

vi.mock('@/ui/shadcn/slider', () => ({
    Slider: () => <div />
}));

vi.mock('@/ui/shadcn/switch', () => ({
    Switch: ({ checked, disabled }: SwitchProps) => (
        <span
            data-checked={checked ? 'true' : 'false'}
            data-disabled={disabled ? 'true' : 'false'}
        />
    )
}));

vi.mock('../SettingsField', () => ({
    Field: ({ label, children }: FieldProps) => (
        <section>
            <span>{label}</span>
            {children}
        </section>
    ),
    SettingsGroup: ({
        title,
        children
    }: ChildrenProps & { title?: ReactNode }) => (
        <section>
            <h2>{title}</h2>
            {children}
        </section>
    )
}));

vi.mock('../SettingsViewParts', () => ({
    SettingsTabContent: ({ children }: ChildrenProps) => <div>{children}</div>
}));

import { SettingsVrTab } from './SettingsVrTab';

function noop() {}

const handlers = {
    onImageNotificationsChange: noop,
    onHmdNotificationOpacityChange: noop,
    onHmdNotificationPositionChange: noop,
    onHmdNotificationStartModeChange: noop,
    onHmdNotificationTimeoutSecondsChange: noop,
    onHmdNotificationsEnabledChange: noop,
    onNotificationOpacityChange: noop,
    onNotificationTimeoutSecondsChange: noop,
    onOpenHmdNotificationFiltersDialog: noop,
    onOpenVrNotificationFiltersDialog: noop,
    onOpenWristFeedNotificationsDialog: noop,
    onOvrtHudNotificationsChange: noop,
    onOvrtWristNotificationsChange: noop,
    onWristOverlayButtonChange: noop,
    onWristOverlayDarkBackgroundChange: noop,
    onWristOverlayEnabledChange: noop,
    onWristOverlayHandChange: noop,
    onWristOverlayHidePrivateWorldsChange: noop,
    onWristOverlayShowBatteryPercentChange: noop,
    onWristOverlayShowDevicesChange: noop,
    onWristOverlaySizeChange: noop,
    onWristOverlayStartModeChange: noop,
    onXsNotificationsChange: noop
};

describe('SettingsVrTab', () => {
    it('hides the interactive friends panel settings', () => {
        const html = renderToStaticMarkup(
            <SettingsVrTab
                prefs={{
                    vrOverlayPanelEnabled: true,
                    vrOverlayPanelAllFriendsIncludesFavorites: true,
                    wristOverlayEnabled: false
                }}
                {...handlers}
            />
        );

        expect(html).not.toContain('view.settings.vr.interactive_panel.header');
        expect(html).not.toContain(
            'view.settings.vr.interactive_panel.enabled'
        );
        expect(html).not.toContain(
            'view.settings.vr.interactive_panel.all_friends_include_favorites'
        );
        expect(html).not.toContain(
            'view.settings.vr.interactive_panel.summon_hint'
        );
        expect(html).not.toContain(
            'view.settings.vr.interactive_panel.openvr_required'
        );
    });
});
