import configRepository from '@/repositories/configRepository';
import { fetchLatestBranchRelease } from '@/services/updateService';

const STABLE_BRANCH = 'Stable';
const DEFAULT_CHANGELOG_LANG = 'en';
const DEFAULT_CHANGELOG_LABEL = 'English';
const MARKER_BLOCK_PATTERN =
    /<!--\s*vrcx-0-changelog:start\s+tag\s*=\s*(vrcx-0-v\d+-[a-z]{2}(?:-[a-z]{2})?)\s*-->([\s\S]*?)<!--\s*vrcx-0-changelog:end\s*-->/gi;
const NOTE_MARKER_PATTERN = /<!--\s*vrcx-0-changelog:note\s*([\s\S]*?)-->/i;
const CHANGELOG_TAG_PATTERN =
    /^vrcx-0-v\d+-([a-z]{2}(?:-[a-z]{2})?)$/i;
const MARKDOWN_ANCHOR_PATTERN =
    /^\s*<a\s+(?:name|id)=["'][^"']+["']\s*><\/a>\s*(?:\r?\n)?/gim;
const LANGUAGE_LABELS: Record<string, string> = {
    en: 'English',
    ja: '日本語',
    ko: '한국어',
    'zh-CN': '简体中文',
    'zh-TW': '繁體中文'
};

export const POST_UPDATE_CHANGELOG_TOAST_CONFIG_KEY =
    'VRCX_showPostUpdateChangelogToast';
export const SEEN_POST_UPDATE_CHANGELOG_VERSION_CONFIG_KEY =
    'VRCX_seenPostUpdateChangelogVersion';
export const LAST_STARTED_VERSION_CONFIG_KEY = 'VRCX_lastStartedVersion';

export type LocalizedChangelogEntry = {
    lang: string;
    label: string;
    tag: string;
    markdown: string;
};

export type ParsedLocalizedChangelog = {
    note: string;
    entries: LocalizedChangelogEntry[];
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

function sanitizeChangelogMarkdown(markdown: unknown) {
    return String(markdown || '')
        .replace(MARKDOWN_ANCHOR_PATTERN, '')
        .trim();
}

function normalizeChangelogLanguage(language: string) {
    const [base = '', region = ''] = language.split('-');
    if (!region) {
        return base.toLowerCase();
    }
    return `${base.toLowerCase()}-${region.toUpperCase()}`;
}

function resolveChangelogLanguageFromTag(tag: string) {
    const match = CHANGELOG_TAG_PATTERN.exec(tag);
    const lang = normalizeChangelogLanguage(match?.[1] || DEFAULT_CHANGELOG_LANG);
    return {
        lang,
        label: LANGUAGE_LABELS[lang] || lang
    };
}

export function parseChangelog(body: unknown): ParsedLocalizedChangelog {
    const source = String(body || '');
    const note = sanitizeChangelogMarkdown(
        NOTE_MARKER_PATTERN.exec(source)?.[1] || ''
    );
    const entries: LocalizedChangelogEntry[] = [];
    MARKER_BLOCK_PATTERN.lastIndex = 0;

    let match = MARKER_BLOCK_PATTERN.exec(source);
    while (match) {
        const [, tag, markdown] = match;
        const { lang, label } = resolveChangelogLanguageFromTag(tag);
        const sanitizedMarkdown = sanitizeChangelogMarkdown(markdown);

        if (sanitizedMarkdown) {
            entries.push({
                lang,
                label,
                tag,
                markdown: sanitizedMarkdown
            });
        }

        match = MARKER_BLOCK_PATTERN.exec(source);
    }

    if (entries.length) {
        return {
            note,
            entries
        };
    }

    return {
        note,
        entries: [
            {
                lang: DEFAULT_CHANGELOG_LANG,
                label: DEFAULT_CHANGELOG_LABEL,
                tag: '',
                markdown: sanitizeChangelogMarkdown(source)
            }
        ]
    };
}

export function parseLocalizedChangelog(body: unknown) {
    return parseChangelog(body).entries;
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
