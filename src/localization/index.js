import csMessages from './cs.json';
import enMessages from './en.json';
import esMessages from './es.json';
import frMessages from './fr.json';
import huMessages from './hu.json';
import jaMessages from './ja.json';
import koMessages from './ko.json';
import plMessages from './pl.json';
import ptMessages from './pt.json';
import ruMessages from './ru.json';
import thMessages from './th.json';
import viMessages from './vi.json';
import zhCnMessages from './zh-CN.json';
import zhTwMessages from './zh-TW.json';

const localizedStrings = {
    cs: csMessages,
    en: enMessages,
    es: esMessages,
    fr: frMessages,
    hu: huMessages,
    ja: jaMessages,
    ko: koMessages,
    pl: plMessages,
    pt: ptMessages,
    ru: ruMessages,
    th: thMessages,
    vi: viMessages,
    'zh-CN': zhCnMessages,
    'zh-TW': zhTwMessages
};

function getAllLocalizedStrings() {
    return { ...localizedStrings };
}

async function getLocalizedStrings(code) {
    return localizedStrings[code] || localizedStrings.en || {};
}

function getLanguageName(code) {
    return String(localizedStrings[code]?.language ?? code).replace(
        /\s+\([^)]+\)$/,
        ''
    );
}

/**
 * @param {string} systemLanguage - BCP-47 code from backend.app.CurrentLanguage()
 * @param {string[]} codes - supported language codes
 * @returns {string | null} matched language code, or null
 */
function resolveSystemLanguage(systemLanguage, codes) {
    if (!systemLanguage) return null;

    // Exact match (e.g. zh-CN → zh-CN)
    if (codes.includes(systemLanguage)) {
        return systemLanguage;
    }

    const lang = systemLanguage.split('-')[0];

    // Chinese: script-tag and region-aware mapping
    // BCP-47 forms: zh-CN, zh-TW, zh-Hant, zh-Hans, zh-Hant-HK, zh-Hans-CN, etc.
    if (lang === 'zh') {
        const parts = systemLanguage.split('-').slice(1); // everything after 'zh'
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
        // Bare 'zh' or unknown region (e.g. zh-SG) → simplified
        return codes.includes('zh-CN') ? 'zh-CN' : null;
    }

    // Generic prefix match (e.g. ja-JP → ja)
    return codes.find((code) => code.split('-')[0] === lang) ?? null;
}

export * from './locales';
export {
    getAllLocalizedStrings,
    getLanguageName,
    getLocalizedStrings,
    resolveSystemLanguage
};
