import type { TFunction } from 'i18next';

import type { PrivacyLockOutcome } from '@/platform/tauri/bindings';

export function privacyLockOutcomeMessage(
    t: TFunction,
    outcome: Exclude<PrivacyLockOutcome, { status: 'ok' }>
): string {
    switch (outcome.status) {
        case 'wrongPassword':
            return t('privacy_lock.error.wrong_password');
        case 'accountPasswordUnavailable':
            return t('privacy_lock.error.account_password_unavailable');
        case 'passwordNotSet':
            return t('privacy_lock.error.password_not_set');
        case 'passwordAlreadySet':
            return t('privacy_lock.error.password_already_set');
        case 'noActiveSession':
            return t('privacy_lock.error.no_session');
    }
}
