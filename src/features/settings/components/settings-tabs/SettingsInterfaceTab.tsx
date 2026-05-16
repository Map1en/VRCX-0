// @ts-nocheck
import { SettingsTabContent } from '../SettingsViewParts';
import { SettingsInterfaceAppearanceCard } from './SettingsInterfaceAppearanceCard';
import { SettingsInterfaceDisplayCards } from './SettingsInterfaceDisplayCards';
import { SettingsInterfaceUserColorsCard } from './SettingsInterfaceUserColorsCard';

export function SettingsInterfaceTab({
    t,
    locale,
    prefs,
    zoomInput,
    zoomLevel,
    onLanguageChange,
    onFontFamilyChange,
    onCjkFontPackChange,
    onZoomInputChange,
    onZoomBlur,
    onDataTableStripedChange,
    onAccessibleStatusIndicatorsChange,
    onShowInstanceIdInLocationChange,
    onAgeGatedInstancesVisibleChange,
    onHideNicknamesChange,
    onDisplayVrcPlusIconsAsAvatarChange,
    onShowNewDashboardButtonChange,
    onOpenTablePageSizes,
    onOpenTableLimits,
    onHour12Change,
    onIsoFormatChange,
    onWeekStartsOnChange,
    onHideUserNotesChange,
    onHideUserMemosChange,
    onHideUnfriendsChange,
    onRandomUserColoursChange,
    onResetTrustColors,
    onSaveTrustColor,
    onTrustColorDraftChange
}) {
    return (
        <SettingsTabContent value="interface">
            <SettingsInterfaceAppearanceCard
                t={t}
                locale={locale}
                prefs={prefs}
                zoomInput={zoomInput}
                zoomLevel={zoomLevel}
                onLanguageChange={onLanguageChange}
                onFontFamilyChange={onFontFamilyChange}
                onCjkFontPackChange={onCjkFontPackChange}
                onZoomInputChange={onZoomInputChange}
                onZoomBlur={onZoomBlur}
                onDataTableStripedChange={onDataTableStripedChange}
                onAccessibleStatusIndicatorsChange={
                    onAccessibleStatusIndicatorsChange
                }
            />
            <SettingsInterfaceDisplayCards
                t={t}
                prefs={prefs}
                onShowInstanceIdInLocationChange={
                    onShowInstanceIdInLocationChange
                }
                onAgeGatedInstancesVisibleChange={
                    onAgeGatedInstancesVisibleChange
                }
                onHideNicknamesChange={onHideNicknamesChange}
                onDisplayVrcPlusIconsAsAvatarChange={
                    onDisplayVrcPlusIconsAsAvatarChange
                }
                onShowNewDashboardButtonChange={onShowNewDashboardButtonChange}
                onOpenTablePageSizes={onOpenTablePageSizes}
                onOpenTableLimits={onOpenTableLimits}
                onHour12Change={onHour12Change}
                onIsoFormatChange={onIsoFormatChange}
                onWeekStartsOnChange={onWeekStartsOnChange}
                onHideUserNotesChange={onHideUserNotesChange}
                onHideUserMemosChange={onHideUserMemosChange}
                onHideUnfriendsChange={onHideUnfriendsChange}
            />
            <SettingsInterfaceUserColorsCard
                t={t}
                prefs={prefs}
                onRandomUserColoursChange={onRandomUserColoursChange}
                onResetTrustColors={onResetTrustColors}
                onSaveTrustColor={onSaveTrustColor}
                onTrustColorDraftChange={onTrustColorDraftChange}
            />
        </SettingsTabContent>
    );
}
