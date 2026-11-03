import type { TrustColorKey } from '@/shared/utils/trustColors';
import {
    normalizeFeedTimeDisplayMode,
    normalizeUserNameColourStyle
} from '@/state/preferencesStore';
import type { TableDensity } from '@/state/shellStore';

import type { SettingsSectionInput } from '../settingsPageStateSectionTypes';

type InterfaceSectionInput = SettingsSectionInput<
    | 'locale'
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
    | 'saveStringPreference'
    | 'setTableDensityPreference'
>;

export function buildInterfaceSection({
    locale,
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
    saveStringPreference,
    setTableDensityPreference
}: InterfaceSectionInput) {
    return {
        locale,
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
        onShowUserDialogProfileBackgroundChange: (checked: boolean) => {
            saveBoolPreference(
                'showUserDialogProfileBackground',
                'showUserDialogProfileBackground',
                checked
            );
        },
        onShowUserDialogAvatarFrameChange: (checked: boolean) => {
            saveBoolPreference(
                'showUserDialogAvatarFrame',
                'showUserDialogAvatarFrame',
                checked
            );
        },
        onShowUserDialogProfileEffectChange: (checked: boolean) => {
            saveBoolPreference(
                'showUserDialogProfileEffect',
                'showUserDialogProfileEffect',
                checked
            );
        },
        onShowUserDialogNameplateEffectChange: (checked: boolean) => {
            saveBoolPreference(
                'showUserDialogNameplateEffect',
                'showUserDialogNameplateEffect',
                checked
            );
        },
        onShowSidebarAvatarFrameChange: (checked: boolean) => {
            saveBoolPreference(
                'showSidebarAvatarFrame',
                'showSidebarAvatarFrame',
                checked
            );
        },
        onShowSidebarNameplateChange: (checked: boolean) => {
            saveBoolPreference(
                'showSidebarNameplate',
                'showSidebarNameplate',
                checked
            );
        },
        onShowHoverCardAvatarFrameChange: (checked: boolean) => {
            saveBoolPreference(
                'showHoverCardAvatarFrame',
                'showHoverCardAvatarFrame',
                checked
            );
        },
        onShowHoverCardProfileEffectChange: (checked: boolean) => {
            saveBoolPreference(
                'showHoverCardProfileEffect',
                'showHoverCardProfileEffect',
                checked
            );
        },
        onShowHoverCardNameplateChange: (checked: boolean) => {
            saveBoolPreference(
                'showHoverCardNameplate',
                'showHoverCardNameplate',
                checked
            );
        },
        onShowFriendsLocationsPeopleAvatarFrameChange: (checked: boolean) => {
            saveBoolPreference(
                'showFriendsLocationsPeopleAvatarFrame',
                'showFriendsLocationsPeopleAvatarFrame',
                checked
            );
        },
        onShowFriendsLocationsPeopleNameplateChange: (checked: boolean) => {
            saveBoolPreference(
                'showFriendsLocationsPeopleNameplate',
                'showFriendsLocationsPeopleNameplate',
                checked
            );
        },
        onShowFriendsLocationsWorldsAvatarFrameChange: (checked: boolean) => {
            saveBoolPreference(
                'showFriendsLocationsWorldsAvatarFrame',
                'showFriendsLocationsWorldsAvatarFrame',
                checked
            );
        },
        onShowFriendsLocationsWorldsNameplateChange: (checked: boolean) => {
            saveBoolPreference(
                'showFriendsLocationsWorldsNameplate',
                'showFriendsLocationsWorldsNameplate',
                checked
            );
        },
        onShowActivityJourneyAvatarFrameChange: (checked: boolean) => {
            saveBoolPreference(
                'showActivityJourneyAvatarFrame',
                'showActivityJourneyAvatarFrame',
                checked
            );
        },
        onShowActivityJourneyNameplateChange: (checked: boolean) => {
            saveBoolPreference(
                'showActivityJourneyNameplate',
                'showActivityJourneyNameplate',
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
        onRandomUserColourStyleChange: (value: string) => {
            saveStringPreference(
                'randomUserColourStyle',
                'randomUserColourStyle',
                normalizeUserNameColourStyle(value)
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
