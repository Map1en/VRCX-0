import { commands } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import {
    normalizeOverlayActivityFilterProfile,
    normalizeOverlayActivityFiltersWithDefinitions,
    type OverlayActivityTypeDefinition
} from '@/shared/constants/overlayActivityFilters';
import { normalizeOverlayActivityFilters } from '@/state/preferencesStore';

import { patchPreferences, publishPreferenceChanged } from './preferencesCore';

async function loadOverlayActivityTypeDefinitionsForSave() {
    return commands
        .appOverlayActivityDefinitionsGet()
        .catch((error: unknown) => {
            const fallbackDefinitions: OverlayActivityTypeDefinition[] = [];
            console.warn(
                'Failed to load overlay activity definitions for save:',
                error
            );
            return fallbackDefinitions;
        });
}

export async function setOverlayActivityFiltersPreference(
    value: unknown,
    definitions?: OverlayActivityTypeDefinition[]
) {
    const activityDefinitions =
        definitions ?? (await loadOverlayActivityTypeDefinitionsForSave());
    const overlayActivityFilters = activityDefinitions.length
        ? normalizeOverlayActivityFiltersWithDefinitions(
              value,
              activityDefinitions
          )
        : normalizeOverlayActivityFilters(value);
    await configRepository.setString(
        'overlayActivityFilters',
        JSON.stringify(overlayActivityFilters)
    );
    await commands.appOverlayActivityFiltersReload();
    patchPreferences({ overlayActivityFilters });
    publishPreferenceChanged('overlayActivityFilters', overlayActivityFilters);
    return overlayActivityFilters;
}

async function setNotificationActivityFilterSurfacePreference(
    key:
        | 'vrNotificationActivityFilters'
        | 'desktopNotificationActivityFilters'
        | 'webhookActivityFilters',
    value: unknown
) {
    const normalized = normalizeOverlayActivityFilterProfile(value);
    await configRepository.setString(key, JSON.stringify(normalized));
    await commands.appOverlayActivityFiltersReload();
    patchPreferences({ [key]: normalized });
    publishPreferenceChanged(key, normalized);
    return normalized;
}

export function setVrNotificationActivityFiltersPreference(value: unknown) {
    return setNotificationActivityFilterSurfacePreference(
        'vrNotificationActivityFilters',
        value
    );
}

export function setDesktopNotificationActivityFiltersPreference(
    value: unknown
) {
    return setNotificationActivityFilterSurfacePreference(
        'desktopNotificationActivityFilters',
        value
    );
}

export function setWebhookActivityFiltersPreference(value: unknown) {
    return setNotificationActivityFilterSurfacePreference(
        'webhookActivityFilters',
        value
    );
}

export async function setWristOverlayEnabledPreference(value: boolean) {
    const snapshot = await commands.appVrOverlayEnabledSet(value);
    const wristOverlayEnabled = Boolean(snapshot.enabled);
    patchPreferences({ wristOverlayEnabled });
    publishPreferenceChanged('wristOverlayEnabled', wristOverlayEnabled);
    return wristOverlayEnabled;
}
