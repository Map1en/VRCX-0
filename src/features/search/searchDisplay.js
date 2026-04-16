import { languageMappings } from '@/shared/constants/language.js';

export function resolveUserLanguages(user) {
    if (Array.isArray(user?.$languages) && user.$languages.length) {
        return user.$languages;
    }

    const tags = Array.isArray(user?.tags) ? user.tags : [];
    return tags
        .filter((tag) => typeof tag === 'string' && tag.startsWith('language_'))
        .map((tag) => {
            const key = tag.slice('language_'.length);
            return {
                key,
                value: languageMappings[key] || key
            };
        })
        .filter((entry) => entry.key);
}

export function languageFlagLabel(languageKey) {
    const countryCode = languageMappings[String(languageKey || '').toLowerCase()];
    if (!countryCode || !/^[a-z]{2}$/i.test(countryCode)) {
        return String(languageKey || '?').slice(0, 3).toUpperCase() || '?';
    }

    return String.fromCodePoint(
        ...countryCode
            .toUpperCase()
            .split('')
            .map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65)
    );
}
