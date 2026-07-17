import type { CommunityThemeInstallMetadata } from '@/features/themes/communityThemeTypes';
import {
    COMMUNITY_THEME_CATALOG_URL,
    COMMUNITY_THEME_CSS_FILE_NAME,
    resolveCommunityThemeAssetUrl
} from '@/repositories/communityThemeRepository';
import { COMMUNITY_THEME_CONFIG_KEYS } from '@/repositories/configKeys';
import configRepository from '@/repositories/configRepository';

const LEGACY_NASA_APOD_WALLPAPER_THEME_ID = 'nasa-apod-wallpaper';

export type CommunityThemeInstalledSnapshot = CommunityThemeInstallMetadata & {
    cssSnapshot: string;
};

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object';
}

export function currentTimestamp(): string {
    return new Date().toISOString();
}

export async function sha256Hex(value: string): Promise<string> {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
        let hash = 0;
        for (let index = 0; index < value.length; index += 1) {
            hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
        }
        return hash.toString(16).padStart(8, '0');
    }

    const data = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

export function normalizeInstallMetadata(
    value: unknown
): CommunityThemeInstallMetadata | null {
    if (!isUnknownRecord(value)) {
        return null;
    }
    if (!value.themeId || !value.themeName || !value.version) {
        return null;
    }
    return {
        themeId: String(value.themeId),
        themeName: String(value.themeName),
        version: String(value.version),
        sourceUrl: String(value.sourceUrl || ''),
        sha256: String(value.sha256 || ''),
        installedAt: String(value.installedAt || ''),
        updatedAt: String(value.updatedAt || ''),
        darkMode: value.darkMode !== false,
        accentMode: value.accentMode === true || value.accentMode === 'app'
    };
}

function normalizeInstallRecord(
    value: unknown
): CommunityThemeInstalledSnapshot | null {
    const metadata = normalizeInstallMetadata(value);
    if (!metadata || !isUnknownRecord(value)) {
        return null;
    }

    const cssSnapshot = String(value.cssSnapshot || '');
    if (!cssSnapshot.trim()) {
        return null;
    }

    return {
        ...metadata,
        cssSnapshot
    };
}

export function normalizeInstallRecords(
    value: unknown
): CommunityThemeInstalledSnapshot[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const records: CommunityThemeInstalledSnapshot[] = [];
    value.forEach((entry) => {
        const record = normalizeInstallRecord(entry);
        if (record) {
            records.push(record);
        }
    });
    return records;
}

export function stripCssSnapshot(
    record: CommunityThemeInstalledSnapshot
): CommunityThemeInstallMetadata {
    const { cssSnapshot: _cssSnapshot, ...metadata } = record;
    return metadata;
}

export function mergeInstallRecords(
    records: CommunityThemeInstalledSnapshot[]
): CommunityThemeInstalledSnapshot[] {
    const merged = new Map<string, CommunityThemeInstalledSnapshot>();
    records.forEach((record) => {
        if (record.themeId && record.cssSnapshot.trim()) {
            merged.set(record.themeId, record);
        }
    });
    return Array.from(merged.values());
}

export function isInstallRecordFromCurrentCatalog(
    record: CommunityThemeInstalledSnapshot
): boolean {
    return (
        record.sourceUrl ===
        resolveCommunityThemeAssetUrl(
            COMMUNITY_THEME_CATALOG_URL,
            record.themeId,
            COMMUNITY_THEME_CSS_FILE_NAME
        )
    );
}

export function isInstallRecordCssSnapshotAllowed(
    record: CommunityThemeInstalledSnapshot
): boolean {
    return record.themeId !== LEGACY_NASA_APOD_WALLPAPER_THEME_ID;
}

export function isLegacyNasaApodWallpaperThemeId(themeId: string): boolean {
    return themeId === LEGACY_NASA_APOD_WALLPAPER_THEME_ID;
}

export async function clearStoredCommunityThemeInstallState(): Promise<void> {
    await Promise.all([
        configRepository.setBool(COMMUNITY_THEME_CONFIG_KEYS.enabled, false),
        configRepository.remove(COMMUNITY_THEME_CONFIG_KEYS.id),
        configRepository.remove(COMMUNITY_THEME_CONFIG_KEYS.version),
        configRepository.remove(COMMUNITY_THEME_CONFIG_KEYS.cssSnapshot),
        configRepository.remove(COMMUNITY_THEME_CONFIG_KEYS.installMetadata),
        configRepository.remove(COMMUNITY_THEME_CONFIG_KEYS.installedThemes)
    ]);
}

export async function persistCommunityThemeInstallState({
    records,
    enabled,
    activeRecord
}: {
    records: CommunityThemeInstalledSnapshot[];
    enabled: boolean;
    activeRecord: CommunityThemeInstalledSnapshot | null;
}): Promise<void> {
    const installedThemesJson = JSON.stringify(records);
    if (enabled && activeRecord) {
        await configRepository.setMany([
            [COMMUNITY_THEME_CONFIG_KEYS.enabled, 'true'],
            [COMMUNITY_THEME_CONFIG_KEYS.id, activeRecord.themeId],
            [COMMUNITY_THEME_CONFIG_KEYS.version, activeRecord.version],
            [COMMUNITY_THEME_CONFIG_KEYS.cssSnapshot, activeRecord.cssSnapshot],
            [
                COMMUNITY_THEME_CONFIG_KEYS.installMetadata,
                JSON.stringify(stripCssSnapshot(activeRecord))
            ],
            [COMMUNITY_THEME_CONFIG_KEYS.installedThemes, installedThemesJson]
        ]);
        return;
    }

    await Promise.all([
        configRepository.setBool(COMMUNITY_THEME_CONFIG_KEYS.enabled, false),
        configRepository.setString(
            COMMUNITY_THEME_CONFIG_KEYS.installedThemes,
            installedThemesJson
        ),
        configRepository.remove(COMMUNITY_THEME_CONFIG_KEYS.id),
        configRepository.remove(COMMUNITY_THEME_CONFIG_KEYS.version),
        configRepository.remove(COMMUNITY_THEME_CONFIG_KEYS.cssSnapshot),
        configRepository.remove(COMMUNITY_THEME_CONFIG_KEYS.installMetadata)
    ]);
}
