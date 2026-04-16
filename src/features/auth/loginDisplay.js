export function getLoginErrorMessage(error, fallbackMessage) {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    return fallbackMessage;
}

export function getLoginUserDisplayName(user) {
    return user?.displayName || user?.username || user?.id || 'account';
}

export function getAutoLoginStateLabel(status) {
    switch (status) {
    case 'scheduled':
        return 'Auto-login scheduled';
    case 'running':
        return 'Auto-login running';
    case 'success':
        return 'Auto-login succeeded';
    case 'cancelled':
        return 'Auto-login skipped';
    case 'throttled':
        return 'Auto-login throttled';
    case 'expired':
        return 'Session expired';
    case 'failed':
        return 'Auto-login failed';
    default:
        return 'Auto-login idle';
    }
}
