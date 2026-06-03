import configRepository from '@/repositories/configRepository';
import { fetchLatestBranchRelease } from '@/services/updateService';

const STABLE_BRANCH = 'Stable';
const DEFAULT_CHANGELOG_LANG = 'en';
const DEFAULT_CHANGELOG_LABEL = 'English';
const MARKER_BLOCK_PATTERN =
    /<!--\s*vrcx-changelog:start\b([^>]*)-->([\s\S]*?)<!--\s*vrcx-changelog:end\s*-->/gi;
const MARKER_ATTRIBUTE_PATTERN =
    /([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
const MARKDOWN_ANCHOR_PATTERN =
    /^\s*<a\s+(?:name|id)=["'][^"']+["']\s*><\/a>\s*(?:\r?\n)?/gim;

export const POST_UPDATE_CHANGELOG_TOAST_CONFIG_KEY =
    'VRCX_showPostUpdateChangelogToast';
export const SEEN_POST_UPDATE_CHANGELOG_VERSION_CONFIG_KEY =
    'VRCX_seenPostUpdateChangelogVersion';
export const LAST_STARTED_VERSION_CONFIG_KEY = 'VRCX_lastStartedVersion';

export type LocalizedChangelogEntry = {
    lang: string;
    label: string;
    anchor: string;
    markdown: string;
};

type PostUpdateChangelogToastInput = {
    currentVersion?: unknown;
    lastStartedVersion?: unknown;
    seenVersion?: unknown;
    enabled?: unknown;
};

function normalizeVersion(value: unknown) {
    return String(value || '').trim();
}

function parseMarkerAttributes(attributeText: string) {
    const attributes: Record<string, string> = {};
    MARKER_ATTRIBUTE_PATTERN.lastIndex = 0;

    let match = MARKER_ATTRIBUTE_PATTERN.exec(attributeText);
    while (match) {
        const [, key, doubleQuotedValue, singleQuotedValue, bareValue] = match;
        attributes[key] = doubleQuotedValue ?? singleQuotedValue ?? bareValue ?? '';
        match = MARKER_ATTRIBUTE_PATTERN.exec(attributeText);
    }

    return attributes;
}

function sanitizeChangelogMarkdown(markdown: unknown) {
    return String(markdown || '')
        .replace(MARKDOWN_ANCHOR_PATTERN, '')
        .trim();
}

export function parseLocalizedChangelog(body: unknown) {
    const source = String(body || '');
    const entries: LocalizedChangelogEntry[] = [];
    MARKER_BLOCK_PATTERN.lastIndex = 0;

    let match = MARKER_BLOCK_PATTERN.exec(source);
    while (match) {
        const [, attributeText, markdown] = match;
        const attributes = parseMarkerAttributes(attributeText || '');
        const lang = attributes.lang || DEFAULT_CHANGELOG_LANG;
        const label = attributes.label || lang;
        const anchor = attributes.anchor || '';
        const sanitizedMarkdown = sanitizeChangelogMarkdown(markdown);

        if (sanitizedMarkdown) {
            entries.push({
                lang,
                label,
                anchor,
                markdown: sanitizedMarkdown
            });
        }

        match = MARKER_BLOCK_PATTERN.exec(source);
    }

    if (entries.length) {
        return entries;
    }

    return [
        {
            lang: DEFAULT_CHANGELOG_LANG,
            label: DEFAULT_CHANGELOG_LABEL,
            anchor: '',
            markdown: sanitizeChangelogMarkdown(source)
        }
    ];
}

export function resolvePreferredChangelogLanguage(
    entries: LocalizedChangelogEntry[],
    locale: unknown
) {
    const availableLanguages = entries.map((entry) => entry.lang);
    const requestedLocale = String(locale || '').trim();
    const baseLanguage = requestedLocale.split('-')[0];

    if (availableLanguages.includes(requestedLocale)) {
        return requestedLocale;
    }
    if (baseLanguage && availableLanguages.includes(baseLanguage)) {
        return baseLanguage;
    }
    if (availableLanguages.includes(DEFAULT_CHANGELOG_LANG)) {
        return DEFAULT_CHANGELOG_LANG;
    }
    return availableLanguages[0] || DEFAULT_CHANGELOG_LANG;
}

export function resolvePostUpdateChangelogToastState({
    currentVersion,
    lastStartedVersion,
    seenVersion,
    enabled
}: PostUpdateChangelogToastInput) {
    const normalizedCurrentVersion = normalizeVersion(currentVersion);
    const normalizedLastStartedVersion = normalizeVersion(lastStartedVersion);
    const normalizedSeenVersion = normalizeVersion(seenVersion);
    const hasPreviousVersion = Boolean(normalizedLastStartedVersion);
    const versionChanged =
        hasPreviousVersion &&
        normalizedLastStartedVersion !== normalizedCurrentVersion;

    return {
        currentVersion: normalizedCurrentVersion,
        shouldShow:
            Boolean(enabled) &&
            Boolean(normalizedCurrentVersion) &&
            versionChanged &&
            normalizedSeenVersion !== normalizedCurrentVersion,
        shouldRecordStartedVersion:
            Boolean(normalizedCurrentVersion) &&
            normalizedLastStartedVersion !== normalizedCurrentVersion
    };
}

function getCurrentVersion() {
    // oxlint-disable-next-line no-undef
    return typeof VERSION === 'undefined' ? '' : VERSION || '';
}

export async function fetchLatestChangelogRelease() {
    return fetchLatestBranchRelease(STABLE_BRANCH, {
        requireInstallerAsset: false
    });
}

export async function markPostUpdateChangelogVersionSeen(
    version: unknown = getCurrentVersion()
) {
    const normalizedVersion = normalizeVersion(version);
    if (!normalizedVersion) {
        return;
    }
    await configRepository.setString(
        SEEN_POST_UPDATE_CHANGELOG_VERSION_CONFIG_KEY,
        normalizedVersion
    );
    await configRepository.setString(
        LAST_STARTED_VERSION_CONFIG_KEY,
        normalizedVersion
    );
}

export async function loadPostUpdateChangelogToastState(
    version: unknown = getCurrentVersion()
) {
    const currentVersion = normalizeVersion(version);
    const [enabled, lastStartedVersion, seenVersion] = await Promise.all([
        configRepository.getBool(POST_UPDATE_CHANGELOG_TOAST_CONFIG_KEY, true),
        configRepository.getString(LAST_STARTED_VERSION_CONFIG_KEY, ''),
        configRepository.getString(
            SEEN_POST_UPDATE_CHANGELOG_VERSION_CONFIG_KEY,
            ''
        )
    ]);
    const state = resolvePostUpdateChangelogToastState({
        currentVersion,
        lastStartedVersion,
        seenVersion,
        enabled
    });

    if (state.shouldRecordStartedVersion && !state.shouldShow) {
        await configRepository.setString(
            LAST_STARTED_VERSION_CONFIG_KEY,
            state.currentVersion
        );
    }

    return state;
}
