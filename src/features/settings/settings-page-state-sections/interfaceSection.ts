import type { TrustColorKey } from '@/shared/utils/trustColors';
import { normalizeFeedTimeDisplayMode } from '@/state/preferencesStore';
import type { NotificationLayout, TableDensity } from '@/state/shellStore';

import { notificationLayoutOptions } from '../settingsOptions';
import type { SettingsSectionInput } from '../settingsPageStateSectionTypes';

type InterfaceSectionInput = SettingsSectionInput<
    | 'locale'
    | 'prefs'
    | 'zoomInput'
    | 'zoomLevel'
    | 'commit'
    | 'setAppLanguagePreference'
    | 'openCustomFontDialog'
    | 'saveFontFamilyPreference'
    | 'selectCjkFontPack'
    | 'setZoomInput'
    | 'setZoomLevelPreference'
    | 'saveBoolPreference'
    | 'savePreferenceValue'
    | 'setDataTableStripedPreference'
    | 'setAccessibleStatusIndicatorsPreference'
    | 'setShowNewDashboardButtonPreference'
    | 'openTablePageSizesDialog'
    | 'openTableLimitsDialog'
    | 'setIntConfigPreference'
    | 'resetTrustColors'
    | 'saveTrustColor'
    | 'setPrefs'
    | 'saveInterfaceZoomLevel'
    | 'setNotificationLayoutPreference'
    | 'saveStringPreference'
    | 'setTableDensityPreference'
>;

export function buildInterfaceSection({
    locale,
    prefs,
    zoomInput,
    zoomLevel,
    commit,
    setAppLanguagePreference,
    openCustomFontDialog,
    saveFontFamilyPreference,
    selectCjkFontPack,
    setZoomInput,
    setZoomLevelPreference,
    saveBoolPreference,
    savePreferenceValue,
    setDataTableStripedPreference,
    setAccessibleStatusIndicatorsPreference,
    setShowNewDashboardButtonPreference,
    openTablePageSizesDialog,
    openTableLimitsDialog,
    setIntConfigPreference,
    resetTrustColors,
    saveTrustColor,
    setPrefs,
    saveInterfaceZoomLevel,
    setNotificationLayoutPreference,
    saveStringPreference,
    setTableDensityPreference
}: InterfaceSectionInput) {
    return {
        locale,
        zoomInput,
        zoomLevel,
        notificationLayoutOptions,
        commit,
        setAppLanguagePreference,
        openCustomFontDialog,
        saveFontFamilyPreference,
        selectCjkFontPack,
        setZoomInput,
        setZoomLevelPreference,
        saveBoolPreference,
        savePreferenceValue,
        setDataTableStripedPreference,
        setAccessibleStatusIndicatorsPreference,
        setShowNewDashboardButtonPreference,
        openTablePageSizesDialog,
        openTableLimitsDialog,
        setIntConfigPreference,
        resetTrustColors,
        saveTrustColor,
        setPrefs,
        onLanguageChange: (value: string | null) => {
            setAppLanguagePreference(value);
        },
        onFontFamilyChange: (value: string) => {
            if (value === 'custom') {
                openCustomFontDialog();
                return;
            }
            saveFontFamilyPreference(value);
        },
        onCjkFontPackChange: (value: string) => {
            selectCjkFontPack(value);
        },
        onZoomInputChange: (value: string) => {
            setZoomInput(value);
        },
        onZoomBlur: (value: string) => {
            saveInterfaceZoomLevel(value);
        },
        onNotificationLayoutChange: (value: NotificationLayout) => {
            commit(
                async () => {
                    const nextLayout =
                        await setNotificationLayoutPreference(value);
                    setPrefs((current) => ({
                        ...current,
                        notificationLayout: nextLayout
                    }));
                },
                () => {
                    const previous = prefs.notificationLayout;
                    setPrefs((current) => ({
                        ...current,
                        notificationLayout: value
                    }));
                    return () =>
                        setPrefs((current) => ({
                            ...current,
                            notificationLayout: previous
                        }));
                }
            );
        },
        onNotificationIconDotChange: (checked: boolean) => {
            saveBoolPreference(
                'notificationIconDot',
                'notificationIconDot',
                checked
            );
        },
        onTaskbarIconDotChange: (checked: boolean) => {
            saveBoolPreference('taskbarIconDot', 'taskbarIconDot', checked);
        },
        onTableDensityChange: (value: TableDensity) => {
            savePreferenceValue('tableDensity', value, () =>
                setTableDensityPreference(value)
            );
        },
        onDataTableStripedChange: (checked: boolean) => {
            savePreferenceValue('dataTableStriped', checked, () =>
                setDataTableStripedPreference(checked)
            );
        },
        onAccessibleStatusIndicatorsChange: (checked: boolean) => {
            savePreferenceValue('accessibleStatusIndicators', checked, () =>
                setAccessibleStatusIndicatorsPreference(checked)
            );
        },
        onReducedMotionAndBlurChange: (checked: boolean) => {
            saveBoolPreference(
                'reducedMotionAndBlur',
                'reducedMotionAndBlur',
                checked
            );
        },
        onShowInstanceIdInLocationChange: (checked: boolean) => {
            saveBoolPreference(
                'showInstanceIdInLocation',
                'VRCX_showInstanceIdInLocation',
                checked
            );
        },
        onAgeGatedInstancesVisibleChange: (checked: boolean) => {
            saveBoolPreference(
                'isAgeGatedInstancesVisible',
                'VRCX_isAgeGatedInstancesVisible',
                checked
            );
        },
        onHideNicknamesChange: (checked: boolean) => {
            saveBoolPreference('hideNicknames', 'hideNicknames', !checked);
        },
        onDisplayVrcPlusIconsAsAvatarChange: (checked: boolean) => {
            saveBoolPreference(
                'displayVRCPlusIconsAsAvatar',
                'displayVRCPlusIconsAsAvatar',
                checked
            );
        },
        onShowUserDialogProfileDecorationsChange: (checked: boolean) => {
            saveBoolPreference(
                'showUserDialogProfileDecorations',
                'showUserDialogProfileDecorations',
                checked
            );
        },
        onShowNewDashboardButtonChange: (checked: boolean) => {
            savePreferenceValue('showNewDashboardButton', checked, () =>
                setShowNewDashboardButtonPreference(checked)
            );
        },
        onOpenTablePageSizes: () => {
            openTablePageSizesDialog();
        },
        onOpenTableLimits: () => {
            openTableLimitsDialog();
        },
        onHour12Change: (value: string) => {
            saveBoolPreference('dtHour12', 'dtHour12', value === '12');
        },
        onIsoFormatChange: (checked: boolean) => {
            saveBoolPreference('dtIsoFormat', 'dtIsoFormat', checked);
        },
        onWeekStartsOnChange: (value: string) => {
            const nextValue = Number.parseInt(value, 10);
            savePreferenceValue('weekStartsOn', nextValue, () =>
                setIntConfigPreference('weekStartsOn', nextValue, {
                    min: 0,
                    max: 6,
                    fallback: 1
                })
            );
        },
        onFeedTimeDisplayModeChange: (value: string) => {
            const nextValue = normalizeFeedTimeDisplayMode(value);
            saveStringPreference(
                'feedTimeDisplayMode',
                'feedTimeDisplayMode',
                nextValue
            );
        },
        onHideUserNotesChange: (checked: boolean) => {
            saveBoolPreference('hideUserNotes', 'hideUserNotes', !checked);
        },
        onHideUserMemosChange: (checked: boolean) => {
            saveBoolPreference('hideUserMemos', 'hideUserMemos', !checked);
        },
        onRandomUserColoursChange: (checked: boolean) => {
            saveBoolPreference(
                'randomUserColours',
                'randomUserColours',
                checked
            );
        },
        onResetTrustColors: () => {
            resetTrustColors();
        },
        onSaveTrustColor: (key: TrustColorKey, value: string) => {
            saveTrustColor(key, value);
        },
        onTrustColorDraftChange: (key: TrustColorKey, value: string) => {
            setPrefs((current) => ({
                ...current,
                trustColor: {
                    ...current.trustColor,
                    [key]: value
                }
            }));
        }
    };
}
