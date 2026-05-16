function normalizeUserTablePrefix(userId: unknown): string {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error('User table prefix requires a user id.');
    }

    let userPrefix = normalizedUserId.replaceAll('-', '').replaceAll('_', '');
    if (!/^[A-Za-z0-9]+$/.test(userPrefix)) {
        throw new Error('User table prefix contains invalid characters.');
    }
    if (/^\d/.test(userPrefix)) {
        userPrefix = `_${userPrefix}`;
    }

    return userPrefix;
}

function buildUserTableName(userIdOrPrefix: unknown, suffix: string): string {
    const value =
        typeof userIdOrPrefix === 'string'
            ? userIdOrPrefix.trim()
            : String(userIdOrPrefix ?? '').trim();
    const tablePrefix =
        /^[A-Za-z][A-Za-z0-9]*$/.test(value) || /^_[A-Za-z0-9]+$/.test(value)
            ? value
            : normalizeUserTablePrefix(value);
    if (!/^[A-Za-z_][A-Za-z0-9]*$/.test(tablePrefix)) {
        throw new Error('User table prefix contains invalid characters.');
    }
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(suffix)) {
        throw new Error('User table suffix contains invalid characters.');
    }
    return `${tablePrefix}_${suffix}`;
}

export { buildUserTableName, normalizeUserTablePrefix };
