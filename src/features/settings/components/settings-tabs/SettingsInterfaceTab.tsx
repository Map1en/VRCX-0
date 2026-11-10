import { useShallow } from 'zustand/react/shallow';

import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { useSettingsPageSection } from '../../SettingsPageStateContext';
import { SettingsTabContent } from '../SettingsViewParts';
import { SettingsInterfaceAppearanceCard } from './SettingsInterfaceAppearanceCard';
import { SettingsInterfaceDisplayCards } from './SettingsInterfaceDisplayCards';
import { SettingsInterfaceThemesCard } from './SettingsInterfaceThemesCard';
import { SettingsInterfaceUserColorsCard } from './SettingsInterfaceUserColorsCard';

export function SettingsInterfaceTab() {
    const settingsInterface = useSettingsPageSection('interface');
    const prefs = usePreferencesStore(
        useShallow((state) => ({
            appFontFamily: state.appFontFamily,
            appCjkFontPack: state.appCjkFontPack,
            customFontFamily: state.customFontFamily,
            customFontPrimary: state.customFontPrimary,
            customFontSecondary: state.customFontSecondary,
            customFontOverride: state.customFontOverride,
            tableDensity: state.tableDensity,
            dataTableStriped: state.dataTableStriped,
            reducedMotionAndBlur: state.reducedMotionAndBlur,
            ctrlWheelZoom: state.ctrlWheelZoom,
            accessibleStatusIndicators: state.accessibleStatusIndicators,
            showInstanceIdInLocation: state.showInstanceIdInLocation,
            isAgeGatedInstancesVisible: state.isAgeGatedInstancesVisible,
            showNewDashboardButton: state.showNewDashboardButton,
            dtHour12: state.dtHour12,
            dtIsoFormat: state.dtIsoFormat,
            weekStartsOn: state.weekStartsOn,
            feedTimeDisplayMode: state.feedTimeDisplayMode,
            randomUserColours: state.randomUserColours,
            randomUserColourStyle: state.randomUserColourStyle,
            trustColor: state.trustColor
        }))
    );
    const isMacHost = useRuntimeStore(
        (state) => state.hostCapabilities.platform === 'macos'
    );
    const {
        locale,
        zoomInput,
        onLanguageChange,
        onFontFamilyChange,
        onCjkFontPackChange,
        onZoomInputChange,
        onZoomBlur,
        onCtrlWheelZoomChange,
        onTableDensityChange,
        onDataTableStripedChange,
        onAccessibleStatusIndicatorsChange,
        onReducedMotionAndBlurChange,
        onShowInstanceIdInLocationChange,
        onAgeGatedInstancesVisibleChange,
        onShowNewDashboardButtonChange,
        onOpenTablePageSizes,
        onOpenTableLimits,
        onHour12Change,
        onIsoFormatChange,
        onWeekStartsOnChange,
        onFeedTimeDisplayModeChange,
        onRandomUserColoursChange,
        onRandomUserColourStyleChange,
        onResetTrustColors,
        onSaveTrustColor,
        onTrustColorDraftChange
    } = settingsInterface;
    return (
        <SettingsTabContent value="interface">
            <SettingsInterfaceAppearanceCard
                locale={locale}
                prefs={prefs}
                zoomInput={zoomInput}
                hideFontControls={isMacHost}
                onLanguageChange={onLanguageChange}
                onFontFamilyChange={onFontFamilyChange}
                onCjkFontPackChange={onCjkFontPackChange}
                onZoomInputChange={onZoomInputChange}
                onZoomBlur={onZoomBlur}
                onCtrlWheelZoomChange={onCtrlWheelZoomChange}
                onTableDensityChange={onTableDensityChange}
                onDataTableStripedChange={onDataTableStripedChange}
                onAccessibleStatusIndicatorsChange={
                    onAccessibleStatusIndicatorsChange
                }
                onReducedMotionAndBlurChange={onReducedMotionAndBlurChange}
            />
            <SettingsInterfaceThemesCard />
            <SettingsInterfaceDisplayCards
                prefs={prefs}
                onShowInstanceIdInLocationChange={
                    onShowInstanceIdInLocationChange
                }
                onAgeGatedInstancesVisibleChange={
                    onAgeGatedInstancesVisibleChange
                }
                onShowNewDashboardButtonChange={onShowNewDashboardButtonChange}
                onOpenTablePageSizes={onOpenTablePageSizes}
                onOpenTableLimits={onOpenTableLimits}
                onHour12Change={onHour12Change}
                onIsoFormatChange={onIsoFormatChange}
                onWeekStartsOnChange={onWeekStartsOnChange}
                onFeedTimeDisplayModeChange={onFeedTimeDisplayModeChange}
            />
            <SettingsInterfaceUserColorsCard
                prefs={prefs}
                onRandomUserColoursChange={onRandomUserColoursChange}
                onRandomUserColourStyleChange={onRandomUserColourStyleChange}
                onResetTrustColors={onResetTrustColors}
                onSaveTrustColor={onSaveTrustColor}
                onTrustColorDraftChange={onTrustColorDraftChange}
            />
        </SettingsTabContent>
    );
}
