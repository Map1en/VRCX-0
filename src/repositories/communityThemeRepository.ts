import type {
    CommunityThemeAccentMode,
    CommunityThemeAuthor,
    CommunityThemeCatalog,
    CommunityThemeDarkMode,
    CommunityThemeManifest
} from '@/features/themes/communityThemeTypes';

export const COMMUNITY_THEME_CATALOG_URL =
    'https://raw.githubusercontent.com/Map1en/VRCX-0-Community-Themes/master/themes/index.json';
export const COMMUNITY_THEME_STATS_API_URL =
    'https://vrcx0-theme-stats-api.maplenagisa.workers.dev';

export const COMMUNITY_THEME_CSS_FILE_NAME = 'theme.css';
export const COMMUNITY_THEME_MANIFEST_FILE_NAME = 'theme.json';
export const COMMUNITY_THEME_PREVIEW_FILE_NAME = 'preview.webp';
export const COMMUNITY_THEME_README_FILE_NAME = 'README.md';

type RawCommunityThemeEntry = Record<string, unknown>;
type RawCommunityThemeStatsEntry = Record<string, unknown>;

const THEME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface CommunityThemeStatsEntry {
    downloads: number;
}

export type CommunityThemeStatsById = Record<string, CommunityThemeStatsEntry>;

export function isCommunityThemeId(value: string): boolean {
    return THEME_ID_PATTERN.test(value);
}

function requireString(
    entry: RawCommunityThemeEntry,
    field: string,
    context: string
): string {
    const value = entry[field];
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(
            `Invalid community theme ${context}: missing ${field}.`
        );
    }
    return value.trim();
}

function optionalString(
    entry: RawCommunityThemeEntry,
    field: string
): string | undefined {
    const value = entry[field];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeTags(value: unknown, context: string): string[] {
    if (!Array.isArray(value)) {
        throw new Error(`Invalid community theme ${context}: missing tags.`);
    }
    return value
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 3);
}

function normalizeAuthor(
    value: unknown,
    context: string
): CommunityThemeAuthor {
    if (!value || typeof value !== 'object') {
        throw new Error(`Invalid community theme ${context}: missing author.`);
    }

    const author = value as RawCommunityThemeEntry;
    return {
        name: requireString(author, 'name', `${context} author`),
        github: requireString(author, 'github', `${context} author`),
        url: optionalString(author, 'url')
    };
}

function normalizeAccentMode(value: unknown): CommunityThemeAccentMode {
    return value === true;
}

function normalizeDarkMode(value: unknown): CommunityThemeDarkMode {
    return value !== false;
}

function normalizeThemeIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
        throw new Error('Invalid community theme catalog: missing themes.');
    }

    return value.map((themeId) => {
        if (typeof themeId !== 'string') {
            throw new Error(
                'Invalid community theme catalog: theme id must be a string.'
            );
        }
        const normalizedThemeId = themeId.trim();
        if (!THEME_ID_PATTERN.test(normalizedThemeId)) {
            throw new Error(
                `Invalid community theme catalog id: ${normalizedThemeId || '(empty)'}.`
            );
        }
        return normalizedThemeId;
    });
}

function normalizeDownloadCount(value: unknown): number {
    const count = Number(value);
    if (!Number.isFinite(count) || count < 0) {
        return 0;
    }
    return Math.floor(count);
}

function normalizeCommunityThemeStats(value: unknown): CommunityThemeStatsById {
    if (!value || typeof value !== 'object') {
        return {};
    }

    const stats: CommunityThemeStatsById = {};
    for (const [themeId, rawEntry] of Object.entries(
        value as Record<string, unknown>
    )) {
        if (!isCommunityThemeId(themeId)) {
            continue;
        }
        if (!rawEntry || typeof rawEntry !== 'object') {
            continue;
        }

        const entry = rawEntry as RawCommunityThemeStatsEntry;
        stats[themeId] = {
            downloads: normalizeDownloadCount(entry.downloads)
        };
    }
    return stats;
}

export function normalizeCommunityThemeCatalogUrl(
    value?: string | null
): string {
    const catalogUrl = String(value || '').trim();
    if (!catalogUrl) {
        return COMMUNITY_THEME_CATALOG_URL;
    }
    return catalogUrl;
}

export function resolveCommunityThemeAssetUrl(
    catalogUrl: string,
    themeId: string,
    fileName: string
): string {
    const safeThemeId = themeId.replace(/^\/+|\/+$/g, '');
    const safeFileName = fileName.replace(/^\/+/, '');
    try {
        return new URL(`${safeThemeId}/${safeFileName}`, catalogUrl).toString();
    } catch {
        const catalogBaseUrl = catalogUrl.replace(/\/[^/]*$/, '/');
        return `${catalogBaseUrl}${safeThemeId}/${safeFileName}`;
    }
}

export function resolveCommunityThemeCssUrl(
    catalogUrl: string,
    themeId: string
): string {
    return resolveCommunityThemeAssetUrl(
        normalizeCommunityThemeCatalogUrl(catalogUrl),
        themeId,
        COMMUNITY_THEME_CSS_FILE_NAME
    );
}

function normalizeCommunityThemeManifest(
    value: unknown,
    catalogUrl: string,
    expectedThemeId: string
): CommunityThemeManifest {
    if (!value || typeof value !== 'object') {
        throw new Error(
            `Invalid community theme manifest: ${expectedThemeId}.`
        );
    }

    const entry = value as RawCommunityThemeEntry;
    const context = requireString(entry, 'id', 'entry');
    if (!THEME_ID_PATTERN.test(context)) {
        throw new Error(`Invalid community theme ${context}: invalid id.`);
    }
    if (context !== expectedThemeId) {
        throw new Error(
            `Invalid community theme ${expectedThemeId}: theme.json id does not match directory.`
        );
    }

    return {
        id: context,
        name: requireString(entry, 'name', context),
        version: requireString(entry, 'version', context),
        author: normalizeAuthor(entry.author, context),
        description: requireString(entry, 'description', context),
        tags: normalizeTags(entry.tags, context),
        testedWith: requireString(entry, 'testedWith', context),
        remoteAssets: entry.remoteAssets === true,
        darkMode: normalizeDarkMode(entry.darkMode),
        accentMode: normalizeAccentMode(entry.accentMode),
        previewUrl: resolveCommunityThemeAssetUrl(
            catalogUrl,
            context,
            COMMUNITY_THEME_PREVIEW_FILE_NAME
        ),
        readmeUrl: resolveCommunityThemeAssetUrl(
            catalogUrl,
            context,
            COMMUNITY_THEME_README_FILE_NAME
        )
    };
}

async function loadCommunityThemeManifest(
    catalogUrl: string,
    themeId: string
): Promise<CommunityThemeManifest> {
    const manifestUrl = resolveCommunityThemeAssetUrl(
        catalogUrl,
        themeId,
        COMMUNITY_THEME_MANIFEST_FILE_NAME
    );
    const response = await fetch(manifestUrl, {
        cache: 'no-cache'
    });
    if (!response.ok) {
        throw new Error(
            `Failed to load community theme manifest ${themeId}: ${response.status} ${response.statusText}`
        );
    }

    return normalizeCommunityThemeManifest(
        await response.json(),
        catalogUrl,
        themeId
    );
}

export async function loadCommunityThemeCatalog(
    catalogUrl = COMMUNITY_THEME_CATALOG_URL
): Promise<CommunityThemeCatalog> {
    const normalizedCatalogUrl = normalizeCommunityThemeCatalogUrl(catalogUrl);
    const response = await fetch(normalizedCatalogUrl, {
        cache: 'no-cache'
    });
    if (!response.ok) {
        throw new Error(
            `Failed to load community theme catalog: ${response.status} ${response.statusText}`
        );
    }

    const payload = (await response.json()) as RawCommunityThemeEntry;
    const themeIds = normalizeThemeIds(payload.themes);
    return {
        sourceUrl: normalizedCatalogUrl,
        schemaVersion: Number(payload.schemaVersion) || 1,
        themes: await Promise.all(
            themeIds.map((themeId) =>
                loadCommunityThemeManifest(normalizedCatalogUrl, themeId)
            )
        )
    };
}

export async function loadCommunityThemeStats(): Promise<CommunityThemeStatsById> {
    const response = await fetch(
        `${COMMUNITY_THEME_STATS_API_URL}/v1/themes/stats`,
        {
            cache: 'no-cache'
        }
    );
    if (!response.ok) {
        throw new Error(
            `Failed to load community theme stats: ${response.status} ${response.statusText}`
        );
    }

    return normalizeCommunityThemeStats(await response.json());
}

export async function reportCommunityThemeInstall(
    themeId: string
): Promise<boolean> {
    const normalizedThemeId = String(themeId || '').trim();
    if (!isCommunityThemeId(normalizedThemeId)) {
        return false;
    }

    try {
        const response = await fetch(
            `${COMMUNITY_THEME_STATS_API_URL}/v1/themes/${encodeURIComponent(
                normalizedThemeId
            )}/install`,
            {
                method: 'POST'
            }
        );
        return response.ok;
    } catch {
        return false;
    }
}

export async function loadCommunityThemeCss(
    catalogUrl: string,
    theme: CommunityThemeManifest
): Promise<string> {
    return loadCommunityThemeCssById(catalogUrl, theme.id);
}

export async function loadCommunityThemeCssById(
    catalogUrl: string,
    themeId: string
): Promise<string> {
    const cssUrl = resolveCommunityThemeCssUrl(catalogUrl, themeId);
    const response = await fetch(cssUrl, {
        cache: 'no-cache'
    });
    if (!response.ok) {
        throw new Error(
            `Failed to load community theme CSS: ${response.status} ${response.statusText}`
        );
    }
    return response.text();
}
