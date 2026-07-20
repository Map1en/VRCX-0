import { toast } from 'sonner';

import { type SavedCredentialRecord } from '@/repositories/authRepository';
import { useRuntimeStore } from '@/state/runtimeStore';

import { executeSavedCredentialLogin } from './authExecutionService';
import i18n from './i18nService';

function savedAccountId(entry: SavedCredentialRecord): string {
    return typeof entry.user?.id === 'string' ? entry.user.id : '';
}

export function canQuickSwitchTo(
    entry: SavedCredentialRecord,
    currentUserId: string | null
): boolean {
    const targetId = savedAccountId(entry);
    return Boolean(
        targetId && entry.hasLoginCredentials && targetId !== currentUserId
    );
}

export async function switchToSavedAccount(
    entry: SavedCredentialRecord
): Promise<void> {
    const currentUserId = useRuntimeStore.getState().auth.currentUserId;
    if (!canQuickSwitchTo(entry, currentUserId)) {
        return;
    }

    try {
        await executeSavedCredentialLogin(entry);
    } catch (error) {
        const message =
            error instanceof Error && error.message
                ? error.message
                : i18n.t('view.auth.toast.failed_to_restore_the_saved_account');
        toast.error(message);
    }
}
