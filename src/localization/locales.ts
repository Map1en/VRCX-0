// Separate file, to be importable in `vite.config.mts`.
import languageCodes from './languageCodes.json';

const DEFAULT_LANGUAGE_CODE = 'en';

export { languageCodes };

export function normalizeLanguageCode(language: string | null | undefined) {
    const candidate = language?.trim().replace(/_/g, '-') ?? '';
    if (languageCodes.includes(candidate)) {
        return candidate;
    }

    const parts = candidate.split('-').filter(Boolean);
    const baseLanguage = parts[0]?.toLowerCase() || '';
    if (!baseLanguage) {
        return DEFAULT_LANGUAGE_CODE;
    }

    if (baseLanguage === 'zh') {
        const detailParts = parts.slice(1).map((part) => part.toLowerCase());
        const hasTraditionalScript = detailParts.includes('hant');
        const hasTraditionalRegion = detailParts.some((part) =>
            ['tw', 'hk', 'mo'].includes(part)
        );
        return hasTraditionalScript || hasTraditionalRegion ? 'zh-TW' : 'zh-CN';
    }

    const supportedBaseLanguage = languageCodes.find(
        (code) => code.toLowerCase() === baseLanguage
    );
    return supportedBaseLanguage ?? DEFAULT_LANGUAGE_CODE;
}
