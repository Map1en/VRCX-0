import { SettingsTabContent } from '../SettingsViewParts.jsx';
import { SettingsInterfaceAppearanceCard } from './SettingsInterfaceAppearanceCard.jsx';
import { SettingsInterfaceDisplayCards } from './SettingsInterfaceDisplayCards.jsx';
import { SettingsInterfaceUserColorsCard } from './SettingsInterfaceUserColorsCard.jsx';

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
    onNotificationIconDotChange,
    onDataTableStripedChange,
    onPointerOnHoverChange,
    onAccessibleStatusIndicatorsChange,
    onShowInstanceIdInLocationChange,
    onAgeGatedInstancesVisibleChange,
    onHideNicknamesChange,
    onDisplayVrcPlusIconsAsAvatarChange,
    onShowNewDashboardButtonChange,
    onSortFavoritesChange,
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
                onNotificationIconDotChange={onNotificationIconDotChange}
                onDataTableStripedChange={onDataTableStripedChange}
                onPointerOnHoverChange={onPointerOnHoverChange}
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
                onShowNewDashboardButtonChange={
                    onShowNewDashboardButtonChange
                }
                onSortFavoritesChange={onSortFavoritesChange}
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
