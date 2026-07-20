const USR_ID_PATTERN =
    /usr_[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}/g;

export function extractGroupBanUserIds(input: string): string[] {
    const matches = input.match(USR_ID_PATTERN) ?? [];
    return Array.from(new Set(matches));
}
