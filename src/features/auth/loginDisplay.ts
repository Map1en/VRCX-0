type LoginUserRecord = {
    displayName?: string | null;
    id?: string | null;
    username?: string | null;
};

export function getLoginUserDisplayName(
    user: LoginUserRecord | null | undefined
): string {
    return user?.displayName || user?.username || user?.id || 'account';
}
