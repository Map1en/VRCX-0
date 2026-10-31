import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { usePreferencesStore } from '@/state/preferencesStore';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';

import { useSettingsPageSection } from '../../SettingsPageStateContext';
import { SettingsCard } from '../SettingsCard';
import { Field, FieldGroup, SettingsSectionHeading } from '../SettingsField';

type ProfileDecorationKind =
    | 'profileBackground'
    | 'profileEffect'
    | 'avatarFrame'
    | 'nameplate';

const PROFILE_DECORATION_LABEL_KEYS: Record<ProfileDecorationKind, string> = {
    profileBackground: 'dialog.inventory.background',
    profileEffect: 'dialog.inventory.profile_effect',
    avatarFrame: 'dialog.inventory.icon_frame',
    nameplate: 'dialog.inventory.nameplate_effect'
};

type ProfileDecorationToggle = {
    kind: ProfileDecorationKind;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
};

function ProfileDecorationField({
    settingId,
    label,
    toggles
}: {
    settingId: string;
    label: string;
    toggles: ProfileDecorationToggle[];
}) {
    const { t } = useTranslation();
    return (
        <Field
            settingId={settingId}
            label={label}
            className="lg:grid-cols-[minmax(0,1fr)_auto]"
            controlClassName="max-w-full overflow-x-auto"
        >
            <ToggleGroup
                multiple
                variant="outline"
                size="sm"
                aria-label={label}
                value={toggles
                    .filter((toggle) => toggle.checked)
                    .map((toggle) => toggle.kind)}
                onValueChange={(next) => {
                    for (const toggle of toggles) {
                        const checked = next.includes(toggle.kind);
                        if (checked !== toggle.checked) {
                            toggle.onCheckedChange(checked);
                        }
                    }
                }}
            >
                {toggles.map((toggle, index) => (
                    <Fragment key={toggle.kind}>
                        {index > 0 ? <ToggleGroupSeparator /> : null}
                        <ToggleGroupItem value={toggle.kind}>
                            {t(PROFILE_DECORATION_LABEL_KEYS[toggle.kind])}
                        </ToggleGroupItem>
                    </Fragment>
                ))}
            </ToggleGroup>
        </Field>
    );
}

export function SettingsInterfaceProfileAppearanceCard() {
    const { t } = useTranslation();
    const settingsInterface = useSettingsPageSection('interface');
    const prefs = usePreferencesStore(
        useShallow((state) => ({
            showUserDialogProfileBackground:
                state.showUserDialogProfileBackground,
            showUserDialogAvatarFrame: state.showUserDialogAvatarFrame,
            showUserDialogProfileEffect: state.showUserDialogProfileEffect,
            showUserDialogNameplateEffect: state.showUserDialogNameplateEffect,
            showSidebarAvatarFrame: state.showSidebarAvatarFrame,
            showSidebarNameplate: state.showSidebarNameplate,
            showHoverCardAvatarFrame: state.showHoverCardAvatarFrame,
            showHoverCardProfileEffect: state.showHoverCardProfileEffect,
            showHoverCardNameplate: state.showHoverCardNameplate,
            showFriendsLocationsPeopleAvatarFrame:
                state.showFriendsLocationsPeopleAvatarFrame,
            showFriendsLocationsPeopleNameplate:
                state.showFriendsLocationsPeopleNameplate,
            showFriendsLocationsWorldsAvatarFrame:
                state.showFriendsLocationsWorldsAvatarFrame,
            showFriendsLocationsWorldsNameplate:
                state.showFriendsLocationsWorldsNameplate,
            showActivityJourneyAvatarFrame:
                state.showActivityJourneyAvatarFrame,
            showActivityJourneyNameplate: state.showActivityJourneyNameplate
        }))
    );
    const {
        onShowUserDialogProfileBackgroundChange,
        onShowUserDialogAvatarFrameChange,
        onShowUserDialogProfileEffectChange,
        onShowUserDialogNameplateEffectChange,
        onShowSidebarAvatarFrameChange,
        onShowSidebarNameplateChange,
        onShowHoverCardAvatarFrameChange,
        onShowHoverCardProfileEffectChange,
        onShowHoverCardNameplateChange,
        onShowFriendsLocationsPeopleAvatarFrameChange,
        onShowFriendsLocationsPeopleNameplateChange,
        onShowFriendsLocationsWorldsAvatarFrameChange,
        onShowFriendsLocationsWorldsNameplateChange,
        onShowActivityJourneyAvatarFrameChange,
        onShowActivityJourneyNameplateChange
    } = settingsInterface;

    return (
        <SettingsCard
            cardId="interface.profile-appearance"
            title={t('view.settings.appearance.profile_appearance.header')}
            bodyClassName="flex flex-col gap-5"
        >
            <FieldGroup className="gap-0">
                <ProfileDecorationField
                    settingId="interface.profile-appearance.user-dialog"
                    label={t('view.settings.appearance.user_dialog.header')}
                    toggles={[
                        {
                            kind: 'profileBackground',
                            checked: prefs.showUserDialogProfileBackground,
                            onCheckedChange:
                                onShowUserDialogProfileBackgroundChange
                        },
                        {
                            kind: 'profileEffect',
                            checked: prefs.showUserDialogProfileEffect,
                            onCheckedChange: onShowUserDialogProfileEffectChange
                        },
                        {
                            kind: 'avatarFrame',
                            checked: prefs.showUserDialogAvatarFrame,
                            onCheckedChange: onShowUserDialogAvatarFrameChange
                        },
                        {
                            kind: 'nameplate',
                            checked: prefs.showUserDialogNameplateEffect,
                            onCheckedChange:
                                onShowUserDialogNameplateEffectChange
                        }
                    ]}
                />
                <ProfileDecorationField
                    settingId="interface.profile-appearance.hover-card"
                    label={t(
                        'view.settings.appearance.profile_appearance.hover_card'
                    )}
                    toggles={[
                        {
                            kind: 'profileEffect',
                            checked: prefs.showHoverCardProfileEffect,
                            onCheckedChange: onShowHoverCardProfileEffectChange
                        },
                        {
                            kind: 'avatarFrame',
                            checked: prefs.showHoverCardAvatarFrame,
                            onCheckedChange: onShowHoverCardAvatarFrameChange
                        },
                        {
                            kind: 'nameplate',
                            checked: prefs.showHoverCardNameplate,
                            onCheckedChange: onShowHoverCardNameplateChange
                        }
                    ]}
                />
                <ProfileDecorationField
                    settingId="interface.profile-appearance.sidebar"
                    label={t(
                        'view.settings.appearance.profile_appearance.sidebar'
                    )}
                    toggles={[
                        {
                            kind: 'avatarFrame',
                            checked: prefs.showSidebarAvatarFrame,
                            onCheckedChange: onShowSidebarAvatarFrameChange
                        },
                        {
                            kind: 'nameplate',
                            checked: prefs.showSidebarNameplate,
                            onCheckedChange: onShowSidebarNameplateChange
                        }
                    ]}
                />
            </FieldGroup>

            <FieldGroup className="gap-0">
                <SettingsSectionHeading
                    title={t('app.routes.friend_locations')}
                />
                <ProfileDecorationField
                    settingId="interface.profile-appearance.friends-locations-people"
                    label={t('view.friends_locations.view_people')}
                    toggles={[
                        {
                            kind: 'avatarFrame',
                            checked:
                                prefs.showFriendsLocationsPeopleAvatarFrame,
                            onCheckedChange:
                                onShowFriendsLocationsPeopleAvatarFrameChange
                        },
                        {
                            kind: 'nameplate',
                            checked: prefs.showFriendsLocationsPeopleNameplate,
                            onCheckedChange:
                                onShowFriendsLocationsPeopleNameplateChange
                        }
                    ]}
                />
                <ProfileDecorationField
                    settingId="interface.profile-appearance.friends-locations-worlds"
                    label={t('view.friends_locations.view_worlds')}
                    toggles={[
                        {
                            kind: 'avatarFrame',
                            checked:
                                prefs.showFriendsLocationsWorldsAvatarFrame,
                            onCheckedChange:
                                onShowFriendsLocationsWorldsAvatarFrameChange
                        },
                        {
                            kind: 'nameplate',
                            checked: prefs.showFriendsLocationsWorldsNameplate,
                            onCheckedChange:
                                onShowFriendsLocationsWorldsNameplateChange
                        }
                    ]}
                />
            </FieldGroup>
            <FieldGroup className="gap-0">
                <SettingsSectionHeading title={t('view.activity.title')} />
                <ProfileDecorationField
                    settingId="interface.profile-appearance.activity-journey"
                    label={t('view.activity.mode.journey')}
                    toggles={[
                        {
                            kind: 'avatarFrame',
                            checked: prefs.showActivityJourneyAvatarFrame,
                            onCheckedChange:
                                onShowActivityJourneyAvatarFrameChange
                        },
                        {
                            kind: 'nameplate',
                            checked: prefs.showActivityJourneyNameplate,
                            onCheckedChange:
                                onShowActivityJourneyNameplateChange
                        }
                    ]}
                />
            </FieldGroup>
        </SettingsCard>
    );
}
