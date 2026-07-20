import type { SavedAuthSnapshot } from '@/repositories/authRepository';

export function sanitizeLoginRedirectTarget(value: unknown) {
    if (
        typeof value !== 'string' ||
        !value.startsWith('/') ||
        value.startsWith('/login')
    ) {
        return '/feed';
    }

    return value;
}

export function getSnapshotLoginParams(
    nextSnapshot:
        | Pick<SavedAuthSnapshot, 'lastUserLoggedIn' | 'savedCredentialsList'>
        | null
        | undefined
) {
    const lastUserId = nextSnapshot?.lastUserLoggedIn ?? '';
    const lastCredential = lastUserId
        ? nextSnapshot?.savedCredentialsList.find(
              (credential) => credential.user.id === lastUserId
          )
        : undefined;
    return (
        lastCredential?.loginParams ??
        nextSnapshot?.savedCredentialsList[0]?.loginParams ??
        {}
    );
}
