import { normalizeLanguageCode } from '@/localization/locales';
import { commands } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import {
    normalizePreferenceKey,
    publishPreferenceChanged
} from '@/shared/events/preferenceEvents';
import {
    normalizeTableLimits,
    normalizeTablePageSize,
    normalizeTablePageSizes,
    type PreferencesSnapshot,
    usePreferencesStore
} from '@/state/preferencesStore';
import { normalizeTableDensity } from '@/state/shellStore';

import {
    DEFAULT_TABLE_PAGE_SIZE,
    LEGACY_OVERLAY_NOTIFICATION_KEYS,
    WRIST_OVERLAY_RUNTIME_CONFIG_KEYS
} from './preferencesConstants';
import type {
    PreferenceKey,
    StorePreferenceConfigKey
} from './preferencesTypes';

export function setDocumentLanguage(language: string) {
    document.documentElement.setAttribute('lang', language);
}

export function applyAccessibleStatusClass(enabled: boolean) {
    document.documentElement.classList.toggle(
        'accessible-status-indicators',
        enabled
    );
}

export function applyTableDensityClass(density: unknown) {
    const normalized = normalizeTableDensity(density);
    document.documentElement.classList.remove('is-compact-table');
    if (normalized === 'compact') {
        document.documentElement.classList.add('is-compact-table');
    }
}

export function applyDataTableStripedClass(enabled: boolean) {
    document.documentElement.classList.toggle('is-striped-table', enabled);
}

export function patchPreferences(patch: Partial<PreferencesSnapshot>) {
    usePreferencesStore.getState().patchPreferences(patch);
}

export function normalizeStorePreferenceKey(
    key: StorePreferenceConfigKey
): PreferenceKey {
    return normalizePreferenceKey(key) as PreferenceKey;
}

export function patchPreferenceValue(
    key: StorePreferenceConfigKey,
    value: PreferencesSnapshot[PreferenceKey]
) {
    usePreferencesStore
        .getState()
        .setPreferenceValue(normalizeStorePreferenceKey(key), value);
}

export async function reloadWristOverlayRuntimeConfigIfNeeded(key: string) {
    const normalizedKey = normalizePreferenceKey(key);
    if (!WRIST_OVERLAY_RUNTIME_CONFIG_KEYS.has(normalizedKey)) {
        return;
    }
    await commands.appVrOverlayConfigReload().catch((error: unknown) => {
        console.warn('Failed to reload wrist overlay runtime config:', error);
    });
}

export function normalizeBioLanguage(language: unknown) {
    return normalizeLanguageCode(language);
}

export function normalizeStringList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map((entry) => String(entry ?? '').trim()).filter(Boolean)
        : [];
}

export async function getBoolConfigWithLegacy(
    key: string,
    defaultValue: boolean
) {
    if ((await configRepository.getRawValue(key)) !== null) {
        return configRepository.getBool(key, defaultValue);
    }
    const legacyKey = getLegacyOverlayNotificationKey(key);
    if (legacyKey && (await configRepository.getRawValue(legacyKey)) !== null) {
        return configRepository.getBool(legacyKey, defaultValue);
    }
    return defaultValue;
}

export async function getIntConfigWithLegacy(
    key: string,
    defaultValue: number
) {
    if ((await configRepository.getRawValue(key)) !== null) {
        return configRepository.getInt(key, defaultValue);
    }
    const legacyKey = getLegacyOverlayNotificationKey(key);
    if (legacyKey && (await configRepository.getRawValue(legacyKey)) !== null) {
        return configRepository.getInt(legacyKey, defaultValue);
    }
    return defaultValue;
}

export function getLegacyOverlayNotificationKey(key: string) {
    return LEGACY_OVERLAY_NOTIFICATION_KEYS[
        key as keyof typeof LEGACY_OVERLAY_NOTIFICATION_KEYS
    ];
}

export function resolveTablePageSize(candidate: unknown, pageSizes: unknown) {
    const allowed = normalizeTablePageSizes(pageSizes);
    const fallbackPageSize = allowed[0] ?? DEFAULT_TABLE_PAGE_SIZE;
    const nearestPageSize = (value: number) =>
        allowed.reduce((previous, size) =>
            Math.abs(size - value) < Math.abs(previous - value)
                ? size
                : previous
        );
    const parsed = normalizeTablePageSize(candidate, fallbackPageSize);
    return allowed.includes(parsed) ? parsed : nearestPageSize(parsed);
}

export {
    normalizePreferenceKey,
    normalizeTableLimits,
    normalizeTablePageSize,
    normalizeTablePageSizes,
    publishPreferenceChanged
};
