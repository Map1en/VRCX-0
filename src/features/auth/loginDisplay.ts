type LoginUserRecord = Record<string, unknown>;

function stringField(record: LoginUserRecord | null | undefined, key: string) {
    const value = record?.[key];
    return typeof value === 'string' ? value : '';
}

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
    return (
        stringField(user, 'displayName') ||
        stringField(user, 'username') ||
        stringField(user, 'id') ||
        'account'
    );
}

export function shouldShowLegacyMigrationAction(
    isLoading: boolean,
    savedAccounts: readonly unknown[]
): boolean {
    return !isLoading && savedAccounts.length === 0;
}
