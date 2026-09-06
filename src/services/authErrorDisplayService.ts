import i18n from './i18nService';

const loginErrorKeys = new Map([
    [
        "It looks like you're logging in from somewhere new! Check your email for a message from VRChat.",
        'view.auth.toast.new_location_login'
    ],
    [
        'Invalid Username/Email or Password',
        'view.auth.toast.invalid_credentials'
    ],
    ['Missing Credentials', 'view.auth.toast.missing_credentials'],
    [
        'The stored browser session still requires interactive verification.',
        'view.auth.toast.session_verification_required'
    ],
    [
        '2FA is required but no supported method was returned.',
        'view.auth.toast.two_factor_unavailable'
    ]
]);

export function getLoginErrorMessage(
    error: unknown,
    fallbackMessage: string
): string {
    if (!(error instanceof Error)) {
        return fallbackMessage;
    }

    if ('code' in error && error.code === 'AUTH_SAVED_CREDENTIALS_INVALID') {
        return i18n.t('view.auth.toast.saved_credentials_invalid');
    }

    const message = error.message.trim();
    if (!message) {
        return fallbackMessage;
    }
    const normalizedMessage =
        message.startsWith('"') && message.endsWith('"')
            ? message.slice(1, -1)
            : message;
    const key = loginErrorKeys.get(normalizedMessage);
    return key ? i18n.t(key) : error.message;
}
