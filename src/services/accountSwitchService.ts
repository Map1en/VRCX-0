import { type SavedCredentialRecord } from '@/repositories/authRepository';
import { toast } from '@/services/toastService';
import { usePendingLoginAccountStore } from '@/state/pendingLoginAccountStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    executeSavedCredentialLogin,
    logoutFromReactShell
} from './authExecutionService';
import i18n from './i18nService';

function savedAccountId(entry: SavedCredentialRecord): string {
    return typeof entry.user?.id === 'string' ? entry.user.id : '';
}

export function partitionSavedAccounts(
    accounts: SavedCredentialRecord[],
    currentUserId: string | null
): {
    switchable: SavedCredentialRecord[];
    requiresLogin: SavedCredentialRecord[];
} {
    const switchable: SavedCredentialRecord[] = [];
    const requiresLogin: SavedCredentialRecord[] = [];
    for (const entry of accounts) {
        if (
            entry.hasLoginCredentials ||
            (currentUserId !== null && savedAccountId(entry) === currentUserId)
        ) {
            switchable.push(entry);
        } else {
            requiresLogin.push(entry);
        }
    }
    return { switchable, requiresLogin };
}

async function openLoginForSavedAccount(
    entry: SavedCredentialRecord
): Promise<void> {
    const pendingLogin = usePendingLoginAccountStore.getState();
    pendingLogin.request({ account: entry, reason: 'switch' });
    try {
        if (!(await logoutFromReactShell())) {
            pendingLogin.clear();
        }
    } catch (error) {
        pendingLogin.clear();
        toast.add({
            type: 'error',
            title:
                error instanceof Error && error.message
                    ? error.message
                    : i18n.t('app_menu.messages.logout_failed')
        });
    }
}

export async function activateSavedAccount(
    entry: SavedCredentialRecord
): Promise<void> {
    const targetId = savedAccountId(entry);
    if (
        !targetId ||
        targetId === useRuntimeStore.getState().auth.currentUserId
    ) {
        return;
    }
    if (!entry.hasLoginCredentials) {
        await openLoginForSavedAccount(entry);
        return;
    }

    try {
        await executeSavedCredentialLogin(entry);
    } catch (error) {
        const message =
            error instanceof Error && error.message
                ? error.message
                : i18n.t('view.auth.toast.failed_to_restore_the_saved_account');
        toast.add({ type: 'error', title: message });
    }
}
