import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { usePreferencesStore } from '@/state/preferencesStore';
import { Switch } from '@/ui/shadcn/switch';

import { SETTINGS_DEFAULT_VALUES } from '../../settingsFieldState';
import { useSettingsPageSection } from '../../SettingsPageStateContext';
import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';

export function SettingsInterfaceUserDialogCard() {
    const { t } = useTranslation();
    const settingsInterface = useSettingsPageSection('interface');
    const prefs = usePreferencesStore(
        useShallow((state) => ({
            hideNicknames: state.hideNicknames,
            hideUserNotes: state.hideUserNotes,
            hideUserMemos: state.hideUserMemos
        }))
    );
    const {
        onHideNicknamesChange,
        onHideUserNotesChange,
        onHideUserMemosChange
    } = settingsInterface;

    return (
        <SettingsCard
            cardId="interface.user-dialog"
            title={t('view.settings.appearance.user_dialog.header')}
        >
            <Field
                settingId="interface.user-dialog.nicknames"
                onReset={() =>
                    onHideNicknamesChange(
                        !SETTINGS_DEFAULT_VALUES.hideNicknames
                    )
                }
                label={t('view.settings.appearance.appearance.nicknames')}
                description={t(
                    'view.settings.appearance.appearance.nicknames_description'
                )}
            >
                <Switch
                    checked={!prefs.hideNicknames}
                    onCheckedChange={onHideNicknamesChange}
                />
            </Field>
            <Field
                settingId="interface.user-dialog.vrchat-notes"
                onReset={() =>
                    onHideUserNotesChange(
                        !SETTINGS_DEFAULT_VALUES.hideUserNotes
                    )
                }
                label={t('view.settings.appearance.user_dialog.vrchat_notes')}
                description={t(
                    'view.settings.appearance.user_dialog.vrchat_notes_description'
                )}
            >
                <Switch
                    checked={!prefs.hideUserNotes}
                    onCheckedChange={onHideUserNotesChange}
                />
            </Field>
            <Field
                settingId="interface.user-dialog.memos"
                onReset={() =>
                    onHideUserMemosChange(
                        !SETTINGS_DEFAULT_VALUES.hideUserMemos
                    )
                }
                label={t('view.settings.appearance.user_dialog.vrcx_memos')}
                description={t(
                    'view.settings.appearance.user_dialog.vrcx_memos_description'
                )}
            >
                <Switch
                    checked={!prefs.hideUserMemos}
                    onCheckedChange={onHideUserMemosChange}
                />
            </Field>
        </SettingsCard>
    );
}
