import { SettingsVrTab } from './settings-tabs/SettingsVrTab';

export function SettingsVrSection({ vr }: any) {
    const {
        prefs,
        setWristFeedNotificationsDialogOpen,
        saveStringPreference,
        saveBoolPreference,
        saveWristOverlayEnabled
    } = vr;

    return (
        <SettingsVrTab
            prefs={prefs}
            onWristOverlayEnabledChange={saveWristOverlayEnabled}
            onWristOverlayStartModeChange={(value: any) => {
                saveStringPreference(
                    'wristOverlayStartMode',
                    'wristOverlayStartMode',
                    value
                );
            }}
            onWristOverlayButtonChange={(value: any) => {
                saveStringPreference(
                    'wristOverlayButton',
                    'wristOverlayButton',
                    value
                );
            }}
            onWristOverlayHandChange={(value: any) => {
                saveStringPreference(
                    'wristOverlayHand',
                    'wristOverlayHand',
                    value
                );
            }}
            onWristOverlaySizeChange={(value: any) => {
                saveStringPreference(
                    'wristOverlaySize',
                    'wristOverlaySize',
                    value
                );
            }}
            onWristOverlayDarkBackgroundChange={(checked: any) => {
                saveBoolPreference(
                    'wristOverlayDarkBackground',
                    'wristOverlayDarkBackground',
                    checked
                );
            }}
            onWristOverlayHidePrivateWorldsChange={(checked: any) => {
                saveBoolPreference(
                    'wristOverlayHidePrivateWorlds',
                    'wristOverlayHidePrivateWorlds',
                    checked
                );
            }}
            onWristOverlayShowDevicesChange={(checked: any) => {
                saveBoolPreference(
                    'wristOverlayShowDevices',
                    'wristOverlayShowDevices',
                    checked
                );
            }}
            onWristOverlayShowBatteryPercentChange={(checked: any) => {
                saveBoolPreference(
                    'wristOverlayShowBatteryPercent',
                    'wristOverlayShowBatteryPercent',
                    checked
                );
            }}
            onOpenWristFeedNotificationsDialog={() =>
                setWristFeedNotificationsDialogOpen(true)
            }
        />
    );
}
