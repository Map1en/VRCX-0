import { languageKeys } from '@/shared/constants/language';

type LanguageOption = {
    key?: unknown;
    id?: unknown;
    value?: unknown;
    label?: unknown;
    name?: unknown;
};
type ProfileLanguageSource = {
    $languages?: unknown[];
    languages?: unknown[];
    tags?: unknown[];
};

function normalizeLanguageText(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function normalizeLanguageKey(value: unknown): string {
    return normalizeLanguageText(value)
        .toLowerCase()
        .replace(/^language_/, '');
}

export function languageDisplayName(option: LanguageOption): string {
    const key = normalizeLanguageKey(option?.key || option?.value);
    return normalizeLanguageText(
        option?.value || option?.label || option?.name || key.toUpperCase()
    );
}

export function languageOptionLabel(option: LanguageOption): string {
    const key = normalizeLanguageKey(option?.key || option?.value);
    const value = languageDisplayName(option);
    return key ? `${value || key.toUpperCase()} (${key.toUpperCase()})` : value;
}

export function fallbackLanguageOptions(): Array<{
    key: string;
    value: string;
}> {
    return [...languageKeys]
        .sort()
        .map((key: any) => ({ key, value: key.toUpperCase() }));
}

export function normalizeLanguageOptionsFromConfig(
    json: unknown
): Array<{ key: string; value: string }> {
    const config = json as
        | { constants?: { LANGUAGE?: { SPOKEN_LANGUAGE_OPTIONS?: unknown } } }
        | null
        | undefined;
    const options = config?.constants?.LANGUAGE?.SPOKEN_LANGUAGE_OPTIONS;
    if (!options || typeof options !== 'object') {
        return [];
    }

    return Object.entries(options)
        .map(([key, value]: any) => ({
            key: normalizeLanguageKey(key),
            value: normalizeLanguageText(value)
        }))
        .filter((option: any) => option.key && option.value)
        .sort((left: any, right: any) => left.value.localeCompare(right.value));
}

export function normalizeProfileLanguageRows(
    profile: ProfileLanguageSource | null | undefined,
    languageOptionMap: any = new Map()
): Array<{ key: string; value: string }> {
    const rows: Array<{ key: string; value: string }> = [];
    const seen = new Set<string>();
    const options = languageOptionMap as Map<string, LanguageOption>;
    const addRow = (entry: unknown) => {
        const optionEntry = entry as LanguageOption | null | undefined;
        const key = normalizeLanguageKey(
            typeof entry === 'string'
                ? entry
                : optionEntry?.key ||
                      optionEntry?.id ||
                      optionEntry?.value ||
                      optionEntry?.label ||
                      optionEntry?.name
        );
        if (!key || seen.has(key)) {
            return;
        }
        const option = options.get(key);
        rows.push({
            key,
            value: normalizeLanguageText(
                option?.value ||
                    optionEntry?.value ||
                    optionEntry?.label ||
                    optionEntry?.name ||
                    key.toUpperCase()
            )
        });
        seen.add(key);
    };

    if (Array.isArray(profile?.$languages)) {
        profile.$languages.forEach(addRow);
    }
    if (Array.isArray(profile?.languages)) {
        profile.languages.forEach(addRow);
    }
    if (Array.isArray(profile?.tags)) {
        profile.tags.forEach((tag: any) => {
            const normalizedTag = normalizeLanguageText(tag).toLowerCase();
            if (normalizedTag.startsWith('language_')) {
                addRow(normalizedTag);
            }
        });
    }

    return rows;
}
