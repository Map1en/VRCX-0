import { languageKeys } from '@/shared/constants/language';
import { PROFILE_LIST_LIMIT } from '@/shared/constants/profileLimits';
import { isRecord } from '@/shared/utils/record';

export type LanguageOption = {
    key?: string;
    id?: string;
    value?: string;
    label?: string;
    name?: string;
};
const fallbackLanguageDisplayNames: Readonly<Record<string, string>> =
    Object.freeze({
        afr: 'Afrikaans',
        ara: 'العربية',
        ase: 'American Sign Language',
        asf: 'Auslan (Australian Sign Language)',
        ben: 'বাংলা',
        bfi: 'British Sign Language',
        bul: 'български',
        ces: 'Čeština',
        cmn: '官话',
        cym: 'Cymraeg',
        dan: 'Dansk',
        deu: 'Deutsch',
        dse: 'Nederlandse Gebarentaal',
        ell: 'Ελληνικά',
        eng: 'English',
        epo: 'Esperanto',
        est: 'eesti',
        fil: 'Filipino',
        fin: 'Suomi',
        fra: 'Français',
        fsl: 'langue des signes française',
        gla: 'Gàidhlig',
        gle: 'Gaeilge',
        gsg: 'Deutsche Gebärdensprache',
        heb: 'עברית',
        hin: 'हिन्दी',
        hmn: 'Hmoob',
        hrv: 'hrvatski',
        hun: 'Magyar',
        hye: 'հայերեն',
        ind: 'Bahasa Indonesia',
        isl: 'íslenska',
        ita: 'Italiano',
        jpn: '日本語',
        jsl: '日本手話',
        kor: '한국어',
        kvk: '한국 수화 언어',
        lav: 'Latviešu',
        lit: 'lietuvių',
        ltz: 'Lëtzebuergesch',
        mar: 'मराठी',
        mkd: 'македонски',
        mlt: 'Malti',
        mri: 'Māori',
        msa: 'Bahasa Melayu',
        nld: 'Nederlands',
        nor: 'Norsk',
        nzs: 'New Zealand Sign Language',
        pol: 'Polski',
        por: 'Português',
        ron: 'Română',
        rus: 'Русский',
        sco: 'Scots',
        slk: 'slovenčina',
        slv: 'slovenščina',
        spa: 'Español',
        swe: 'Svenska',
        tel: 'తెలుగు',
        tha: 'ภาษาไทย',
        tok: 'toki pona',
        tur: 'Türkçe',
        tws: '潮州話',
        ukr: 'украї́нська',
        vie: 'Tiếng Việt',
        wuu: '吳語',
        yue: '廣東話',
        zho: '中文',
        zxx: 'No linguistic content'
    });

const translatedLanguageNameKeys: ReadonlySet<string> = new Set([
    'ase',
    'asf',
    'bfi',
    'cmn',
    'dse',
    'fsl',
    'gsg',
    'jsl',
    'kvk',
    'nzs',
    'tws'
]);

function fallbackLanguageDisplayName(key: string): string {
    return fallbackLanguageDisplayNames[key] ?? key.toUpperCase();
}

export function nativeLanguageName(key: unknown): string {
    const normalized = normalizeLanguageKey(key);
    return normalized ? fallbackLanguageDisplayName(normalized) : '';
}

export function languageShortCode(key: unknown): string {
    const normalized = normalizeLanguageKey(key);
    if (!normalized || translatedLanguageNameKeys.has(normalized)) {
        return normalized.toUpperCase();
    }
    let canonical = '';
    try {
        canonical = Intl.getCanonicalLocales(normalized)[0] ?? '';
    } catch {
        canonical = '';
    }
    return (canonical.length === 2 ? canonical : normalized).toUpperCase();
}

export function createLanguageNamer(
    locale: string,
    translatedName: (key: string) => string
): (key: unknown) => string {
    const displayNames = new Intl.DisplayNames([locale], {
        type: 'language',
        fallback: 'none'
    });
    return (key) => {
        const normalized = normalizeLanguageKey(key);
        if (!normalized) {
            return '';
        }
        let name = '';
        if (translatedLanguageNameKeys.has(normalized)) {
            name = translatedName(normalized);
        } else {
            try {
                name = displayNames.of(normalized) ?? '';
            } catch {
                name = '';
            }
        }
        return name || fallbackLanguageDisplayName(normalized);
    };
}

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

export function normalizeProfileLanguageKeys(values: unknown): string[] {
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const value of Array.isArray(values) ? values : []) {
        const key = normalizeLanguageKey(value);
        if (!key || seen.has(key)) {
            continue;
        }
        keys.push(key);
        seen.add(key);
        if (keys.length >= PROFILE_LIST_LIMIT) {
            break;
        }
    }
    return keys;
}

function languageDisplayName(option: LanguageOption): string {
    const key = normalizeLanguageKey(option?.key || option?.value);
    return normalizeLanguageText(
        option?.value ||
            option?.label ||
            option?.name ||
            fallbackLanguageDisplayName(key)
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
        .map((key) => ({ key, value: fallbackLanguageDisplayName(key) }));
}

export function normalizeLanguageOptionsFromConfig(
    json: unknown
): Array<{ key: string; value: string }> {
    const options =
        isRecord(json) &&
        isRecord(json.constants) &&
        isRecord(json.constants.LANGUAGE)
            ? json.constants.LANGUAGE.SPOKEN_LANGUAGE_OPTIONS
            : undefined;
    if (!options || typeof options !== 'object') {
        return [];
    }

    return Object.entries(options)
        .map(([key, value]) => ({
            key: normalizeLanguageKey(key),
            value: normalizeLanguageText(value)
        }))
        .filter((option) => option.key && option.value)
        .sort((left, right) => left.value.localeCompare(right.value));
}

export function normalizeProfileLanguageRows(
    profile: unknown,
    languageOptionMap: ReadonlyMap<string, LanguageOption> = new Map()
): Array<{ key: string; value: string }> {
    const profileRecord = isRecord(profile) ? profile : {};
    const rows: Array<{ key: string; value: string }> = [];
    const seen = new Set<string>();
    const addRow = (entry: unknown) => {
        const optionEntry = isRecord(entry) ? entry : null;
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
        const option = languageOptionMap.get(key);
        rows.push({
            key,
            value: normalizeLanguageText(
                option?.value ||
                    optionEntry?.value ||
                    optionEntry?.label ||
                    optionEntry?.name ||
                    fallbackLanguageDisplayName(key)
            )
        });
        seen.add(key);
    };

    if (Array.isArray(profileRecord.$languages)) {
        profileRecord.$languages.forEach(addRow);
    }
    if (Array.isArray(profileRecord.languages)) {
        profileRecord.languages.forEach(addRow);
    }
    if (Array.isArray(profileRecord.tags)) {
        profileRecord.tags.forEach((tag) => {
            const normalizedTag = normalizeLanguageText(tag).toLowerCase();
            if (normalizedTag.startsWith('language_')) {
                addRow(normalizedTag);
            }
        });
    }

    return rows;
}
