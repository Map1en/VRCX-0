type LoginUserRecord = {
    displayName?: string | null;
    id?: string | null;
    username?: string | null;
};

export function getLoginErrorMessage(
    error: unknown,
    fallbackMessage: string
): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    return fallbackMessage;
}

export function getLoginUserDisplayName(
    user: LoginUserRecord | null | undefined
): string {
    return user?.displayName || user?.username || user?.id || 'account';
}

export function shouldShowLegacyMigrationAction(
    isLoading: boolean,
    savedAccounts: readonly unknown[]
): boolean {
    return !isLoading && savedAccounts.length === 0;
}
