import { normalizeFeedTimeDisplayMode } from '@/state/preferencesStore';

import { notificationLayoutOptions } from '../settingsOptions';
import type { BuildSettingsPageStateSectionsInput } from '../settingsPageStateSections';
import { normalizeCheckedState } from '../settingsValues';

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
}: BuildSettingsPageStateSectionsInput) {
    return {
        locale,
        prefs,
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
        onLanguageChange: (value: unknown) => {
            setAppLanguagePreference(value);
        },
        onFontFamilyChange: (value: unknown) => {
            if (value === 'custom') {
                openCustomFontDialog();
                return;
            }
            saveFontFamilyPreference(value);
        },
        onCjkFontPackChange: (value: unknown) => {
            selectCjkFontPack(value);
        },
        onZoomInputChange: (value: unknown) => {
            setZoomInput(value);
        },
        onZoomBlur: (
            event: { target?: { value?: unknown } } | null | undefined
        ) => {
            saveInterfaceZoomLevel(event?.target?.value ?? zoomInput);
        },
        onNotificationLayoutChange: (value: string) => {
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
        onNotificationIconDotChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            saveBoolPreference(
                'notificationIconDot',
                'notificationIconDot',
                enabled
            );
        },
        onTableDensityChange: (value: unknown) => {
            savePreferenceValue('tableDensity', value, () =>
                setTableDensityPreference(value)
            );
        },
        onDataTableStripedChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            savePreferenceValue('dataTableStriped', enabled, () =>
                setDataTableStripedPreference(enabled)
            );
        },
        onAccessibleStatusIndicatorsChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            savePreferenceValue('accessibleStatusIndicators', enabled, () =>
                setAccessibleStatusIndicatorsPreference(enabled)
            );
        },
        onReducedMotionAndBlurChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            saveBoolPreference(
                'reducedMotionAndBlur',
                'reducedMotionAndBlur',
                enabled
            );
        },
        onShowInstanceIdInLocationChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            saveBoolPreference(
                'showInstanceIdInLocation',
                'VRCX_showInstanceIdInLocation',
                enabled
            );
        },
        onAgeGatedInstancesVisibleChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            saveBoolPreference(
                'isAgeGatedInstancesVisible',
                'VRCX_isAgeGatedInstancesVisible',
                enabled
            );
        },
        onHideNicknamesChange: (checked: unknown) => {
            saveBoolPreference(
                'hideNicknames',
                'hideNicknames',
                !normalizeCheckedState(checked)
            );
        },
        onDisplayVrcPlusIconsAsAvatarChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            saveBoolPreference(
                'displayVRCPlusIconsAsAvatar',
                'displayVRCPlusIconsAsAvatar',
                enabled
            );
        },
        onShowNewDashboardButtonChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            savePreferenceValue('showNewDashboardButton', enabled, () =>
                setShowNewDashboardButtonPreference(enabled)
            );
        },
        onOpenTablePageSizes: () => {
            openTablePageSizesDialog();
        },
        onOpenTableLimits: () => {
            openTableLimitsDialog();
        },
        onHour12Change: (value: unknown) => {
            saveBoolPreference('dtHour12', 'dtHour12', value === '12');
        },
        onIsoFormatChange: (checked: unknown) => {
            saveBoolPreference(
                'dtIsoFormat',
                'dtIsoFormat',
                normalizeCheckedState(checked)
            );
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
        onFeedTimeDisplayModeChange: (value: unknown) => {
            const nextValue = normalizeFeedTimeDisplayMode(value);
            saveStringPreference(
                'feedTimeDisplayMode',
                'feedTimeDisplayMode',
                nextValue
            );
        },
        onHideUserNotesChange: (checked: unknown) => {
            saveBoolPreference(
                'hideUserNotes',
                'hideUserNotes',
                !normalizeCheckedState(checked)
            );
        },
        onHideUserMemosChange: (checked: unknown) => {
            saveBoolPreference(
                'hideUserMemos',
                'hideUserMemos',
                !normalizeCheckedState(checked)
            );
        },
        onRandomUserColoursChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            saveBoolPreference(
                'randomUserColours',
                'randomUserColours',
                enabled
            );
        },
        onResetTrustColors: () => {
            resetTrustColors();
        },
        onSaveTrustColor: (key: string, value: string) => {
            saveTrustColor(key, value);
        },
        onTrustColorDraftChange: (key: string, value: string) => {
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
