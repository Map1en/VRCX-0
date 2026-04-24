import { useSettingsMaintenanceActions } from './useSettingsMaintenanceActions.js';
import { useSettingsPreferenceActions } from './useSettingsPreferenceActions.js';
export function useSettingsPageActions(deps) {
    const preferenceActions = useSettingsPreferenceActions(deps);
    const maintenanceActions = useSettingsMaintenanceActions({
        ...deps,
        ...preferenceActions
    });
    return {
        ...preferenceActions,
        ...maintenanceActions
    };
}
