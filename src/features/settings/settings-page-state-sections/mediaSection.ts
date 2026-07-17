import { openUGCPhotosFolder } from '@/services/shellIntegrationService';
import { normalizeAutoDeletePrintsLimit } from '@/state/preferencesStore';

import type { BuildSettingsPageStateSectionsInput } from '../settingsPageStateSections';
import { normalizeCheckedState } from '../settingsValues';

export function buildMediaSection({
    prefs,
    commit,
    setScreenshotHelperPreference,
    setScreenshotHelperModifyFilenamePreference,
    setScreenshotHelperCopyToClipboardPreference,
    deleteAllScreenshotMetadata,
    openUgcFolderSelector,
    resetUgcFolder,
    setSaveInstancePrintsPreference,
    handleCropInstancePrintsChange,
    setSaveInstanceStickersPreference,
    setSaveInstanceEmojiPreference,
    setPrefs,
    savePreferenceValue,
    saveBoolPreference,
    setIntConfigPreference
}: BuildSettingsPageStateSectionsInput) {
    return {
        prefs,
        commit,
        setScreenshotHelperPreference,
        setScreenshotHelperModifyFilenamePreference,
        setScreenshotHelperCopyToClipboardPreference,
        deleteAllScreenshotMetadata,
        openUgcFolderSelector,
        resetUgcFolder,
        setSaveInstancePrintsPreference,
        handleCropInstancePrintsChange,
        setSaveInstanceStickersPreference,
        setSaveInstanceEmojiPreference,
        setPrefs,
        onScreenshotHelperChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            savePreferenceValue('screenshotHelper', enabled, () =>
                setScreenshotHelperPreference(enabled)
            );
        },
        onScreenshotHelperModifyFilenameChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            savePreferenceValue('screenshotHelperModifyFilename', enabled, () =>
                setScreenshotHelperModifyFilenamePreference(enabled)
            );
        },
        onScreenshotHelperCopyToClipboardChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            savePreferenceValue(
                'screenshotHelperCopyToClipboard',
                enabled,
                () => setScreenshotHelperCopyToClipboardPreference(enabled)
            );
        },
        onDeleteAllScreenshotMetadata: () => {
            deleteAllScreenshotMetadata();
        },
        onOpenUgcPhotosFolder: () => {
            commit(() => openUGCPhotosFolder(prefs.userGeneratedContentPath));
        },
        onOpenUgcFolderSelector: () => {
            openUgcFolderSelector();
        },
        onResetUgcFolder: () => {
            resetUgcFolder();
        },
        onSaveInstancePrintsChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            savePreferenceValue('saveInstancePrints', enabled, () =>
                setSaveInstancePrintsPreference(enabled)
            );
        },
        onCropInstancePrintsChange: (checked: unknown) => {
            handleCropInstancePrintsChange(normalizeCheckedState(checked));
        },
        onAutoDeleteOldPrintsChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            saveBoolPreference(
                'autoDeleteOldPrints',
                'autoDeleteOldPrints',
                enabled
            );
        },
        onAutoDeletePrintsLimitChange: (value: unknown) => {
            setPrefs((current) => ({
                ...current,
                autoDeletePrintsLimit: value
            }));
        },
        onAutoDeletePrintsLimitBlur: (value: unknown) => {
            const nextValue = normalizeAutoDeletePrintsLimit(value);
            savePreferenceValue('autoDeletePrintsLimit', nextValue, () =>
                setIntConfigPreference('autoDeletePrintsLimit', nextValue, {
                    min: 30,
                    max: 60,
                    fallback: 60
                })
            );
        },
        onSaveInstanceStickersChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            savePreferenceValue('saveInstanceStickers', enabled, () =>
                setSaveInstanceStickersPreference(enabled)
            );
        },
        onSaveInstanceEmojiChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            savePreferenceValue('saveInstanceEmoji', enabled, () =>
                setSaveInstanceEmojiPreference(enabled)
            );
        }
    };
}
