import {
    getSettingsCard,
    getSettingsTabLabelKey,
    resolveSettingForContext,
    SETTINGS_MANIFEST,
    type SettingsAvailabilityContext,
    type SettingsManifestEntry
} from '@/shared/constants/settingsManifest';

type Translate = (key: string) => string;

type SettingsSearchDocument = {
    entry: SettingsManifestEntry;
    labels: string[];
    descriptions: string[];
    context: string[];
};

const KATAKANA_TO_HIRAGANA_OFFSET = 0x60;
const LABEL_WEIGHT = 3;
const DESCRIPTION_WEIGHT = 2;
const CONTEXT_WEIGHT = 1;

export function normalizeSettingsSearchText(value: string): string {
    return value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[ァ-ヶ]/g, (char) =>
            String.fromCharCode(
                char.charCodeAt(0) - KATAKANA_TO_HIRAGANA_OFFSET
            )
        )
        .replace(/\s+/g, ' ')
        .trim();
}

function translateAll(translators: readonly Translate[], key?: string) {
    if (!key) {
        return [];
    }
    return [
        ...new Set(
            translators.map((translate) =>
                normalizeSettingsSearchText(translate(key))
            )
        )
    ];
}

export function buildSettingsSearchIndex(
    translators: readonly Translate[],
    context: SettingsAvailabilityContext
): SettingsSearchDocument[] {
    return SETTINGS_MANIFEST.flatMap((manifestEntry) => {
        const entry = resolveSettingForContext(manifestEntry, context);
        return entry ? [entry] : [];
    }).map((entry) => ({
        entry,
        labels: translateAll(translators, entry.labelKey),
        descriptions: translateAll(translators, entry.descriptionKey),
        context: [
            ...translateAll(
                translators,
                getSettingsCard(entry.cardId)?.titleKey
            ),
            ...translateAll(translators, getSettingsTabLabelKey(entry.tab))
        ]
    }));
}

function scoreToken(document: SettingsSearchDocument, token: string) {
    if (document.labels.some((text) => text.includes(token))) {
        return LABEL_WEIGHT;
    }
    if (document.descriptions.some((text) => text.includes(token))) {
        return DESCRIPTION_WEIGHT;
    }
    if (document.context.some((text) => text.includes(token))) {
        return CONTEXT_WEIGHT;
    }
    return 0;
}

export function searchSettingsIndex(
    index: readonly SettingsSearchDocument[],
    query: string,
    limit = Number.POSITIVE_INFINITY
): SettingsManifestEntry[] {
    const tokens = normalizeSettingsSearchText(query)
        .split(' ')
        .filter(Boolean);
    if (!tokens.length) {
        return [];
    }
    const normalizedQuery = tokens.join(' ');
    return index
        .map((document, order) => {
            let score = 0;
            for (const token of tokens) {
                const tokenScore = scoreToken(document, token);
                if (!tokenScore) {
                    return null;
                }
                score += tokenScore;
            }
            if (
                document.labels.some((text) => text.startsWith(normalizedQuery))
            ) {
                score += LABEL_WEIGHT;
            }
            return { entry: document.entry, score, order };
        })
        .filter((result) => result !== null)
        .sort(
            (left, right) =>
                right.score - left.score || left.order - right.order
        )
        .slice(0, limit)
        .map((result) => result.entry);
}
