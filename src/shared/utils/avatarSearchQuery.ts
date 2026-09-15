const AVATAR_SEARCH_MINIMUM_ENGLISH_EQUIVALENT_LENGTH = 3;

function avatarSearchEnglishEquivalentLength(query: string): number {
    const normalizedQuery = query.trim().normalize('NFC');
    let length = 0;

    for (const char of normalizedQuery) {
        length += char.charCodeAt(0) <= 0x7f ? 1 : 2;
    }

    return length;
}

function isAvatarSearchQueryLongEnough(query: string): boolean {
    return (
        avatarSearchEnglishEquivalentLength(query) >=
        AVATAR_SEARCH_MINIMUM_ENGLISH_EQUIVALENT_LENGTH
    );
}

export { avatarSearchEnglishEquivalentLength, isAvatarSearchQueryLongEnough };
