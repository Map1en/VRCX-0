import csMessages from './cs.json';
import deMessages from './de.json';
import enMessages from './en.json';
import esMessages from './es.json';
import frMessages from './fr.json';
import jaMessages from './ja.json';
import koMessages from './ko.json';
import ptMessages from './pt.json';
import ruMessages from './ru.json';
import zhCnMessages from './zh-CN.json';
import zhTwMessages from './zh-TW.json';

type LocalizedStringTable = Record<string, unknown> & {
    language?: unknown;
};

const localizedStrings: Record<string, LocalizedStringTable> = {
    cs: csMessages,
    de: deMessages,
    en: enMessages,
    es: esMessages,
    fr: frMessages,
    ja: jaMessages,
    ko: koMessages,
    pt: ptMessages,
    ru: ruMessages,
    'zh-CN': zhCnMessages,
    'zh-TW': zhTwMessages
};

function getAllLocalizedStrings() {
    return { ...localizedStrings };
}

async function getLocalizedStrings(code: string) {
    return localizedStrings[code] || localizedStrings.en || {};
}

function getLanguageName(code: string) {
    return String(localizedStrings[code]?.language ?? code).replace(
        /\s+\([^)]+\)$/,
        ''
    );
}

function resolveSystemLanguage(
    systemLanguage: string | null | undefined,
    codes: readonly string[]
) {
    if (!systemLanguage) return null;

    if (codes.includes(systemLanguage)) {
        return systemLanguage;
    }

    const lang = systemLanguage.split('-')[0];

    if (lang === 'zh') {
        const parts = systemLanguage.split('-').slice(1);
        const hasHant = parts.includes('Hant');
        const hasHans = parts.includes('Hans');
        const traditionalRegions = ['TW', 'HK', 'MO'];
        const hasTraditionalRegion = parts.some((p) =>
            traditionalRegions.includes(p)
        );

        if (hasHant || hasTraditionalRegion) {
            return codes.includes('zh-TW') ? 'zh-TW' : null;
        }
        if (hasHans) {
            return codes.includes('zh-CN') ? 'zh-CN' : null;
        }
        return codes.includes('zh-CN') ? 'zh-CN' : null;
    }

    return codes.find((code) => code.split('-')[0] === lang) ?? null;
}

export * from './locales';
export {
    getAllLocalizedStrings,
    getLanguageName,
    getLocalizedStrings,
    resolveSystemLanguage
};
