import { useRuntimeStore } from '@/state/runtimeStore';

import type { SettingsPageStateSections } from '../../settingsPageStateSections';
import { SettingsTabContent } from '../SettingsViewParts';
import { SettingsInterfaceAppearanceCard } from './SettingsInterfaceAppearanceCard';
import { SettingsInterfaceDisplayCards } from './SettingsInterfaceDisplayCards';
import { SettingsInterfaceThemesCard } from './SettingsInterfaceThemesCard';
import { SettingsInterfaceUserColorsCard } from './SettingsInterfaceUserColorsCard';

type SettingsInterfaceTabProps = {
    settingsInterface: SettingsPageStateSections['interface'];
};

export function SettingsInterfaceTab({
    settingsInterface
}: SettingsInterfaceTabProps) {
    const isMacHost = useRuntimeStore(
        (state) => state.hostCapabilities.platform === 'macos'
    );
    const {
        locale,
        prefs,
        zoomInput,
        onLanguageChange,
        onFontFamilyChange,
        onCjkFontPackChange,
        onZoomInputChange,
        onZoomBlur,
        notificationLayoutOptions,
        onNotificationLayoutChange,
        onNotificationIconDotChange,
        onTableDensityChange,
        onDataTableStripedChange,
        onAccessibleStatusIndicatorsChange,
        onReducedMotionAndBlurChange,
        onShowInstanceIdInLocationChange,
        onAgeGatedInstancesVisibleChange,
        onHideNicknamesChange,
        onDisplayVrcPlusIconsAsAvatarChange,
        onShowUserDialogProfileDecorationsChange,
        onShowNewDashboardButtonChange,
        onOpenTablePageSizes,
        onOpenTableLimits,
        onHour12Change,
        onIsoFormatChange,
        onWeekStartsOnChange,
        onFeedTimeDisplayModeChange,
        onHideUserNotesChange,
        onHideUserMemosChange,
        onRandomUserColoursChange,
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
                notificationLayoutOptions={notificationLayoutOptions}
                onNotificationLayoutChange={onNotificationLayoutChange}
                onNotificationIconDotChange={onNotificationIconDotChange}
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
                onHideNicknamesChange={onHideNicknamesChange}
                onDisplayVrcPlusIconsAsAvatarChange={
                    onDisplayVrcPlusIconsAsAvatarChange
                }
                onShowUserDialogProfileDecorationsChange={
                    onShowUserDialogProfileDecorationsChange
                }
                onShowNewDashboardButtonChange={onShowNewDashboardButtonChange}
                onOpenTablePageSizes={onOpenTablePageSizes}
                onOpenTableLimits={onOpenTableLimits}
                onHour12Change={onHour12Change}
                onIsoFormatChange={onIsoFormatChange}
                onWeekStartsOnChange={onWeekStartsOnChange}
                onFeedTimeDisplayModeChange={onFeedTimeDisplayModeChange}
                onHideUserNotesChange={onHideUserNotesChange}
                onHideUserMemosChange={onHideUserMemosChange}
            />
            <SettingsInterfaceUserColorsCard
                prefs={prefs}
                onRandomUserColoursChange={onRandomUserColoursChange}
                onResetTrustColors={onResetTrustColors}
                onSaveTrustColor={onSaveTrustColor}
                onTrustColorDraftChange={onTrustColorDraftChange}
            />
        </SettingsTabContent>
    );
}
