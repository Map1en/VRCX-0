import { commands, type PrivacyLockOutcome } from '@/platform/tauri/bindings';
import { openPrivacyLockDialog } from '@/state/privacyLockDialogStore';
import { useRuntimeStore } from '@/state/runtimeStore';

function applyOutcome(outcome: PrivacyLockOutcome): PrivacyLockOutcome {
    if (outcome.status === 'ok') {
        useRuntimeStore.getState().setPrivacyLock(outcome.snapshot);
    }
    return outcome;
}

export const engagePrivacyLock = () =>
    commands.appPrivacyLockEngage().then(applyOutcome);

export const unlockPrivacyLock = (password: string) =>
    commands.appPrivacyLockUnlock(password).then(applyOutcome);

export const setPrivacyLockPassword = (password: string) =>
    commands.appPrivacyLockPasswordSet(password).then(applyOutcome);

export const changePrivacyLockPassword = (
    currentPassword: string,
    newPassword: string
) =>
    commands
        .appPrivacyLockPasswordChange(currentPassword, newPassword)
        .then(applyOutcome);

export const clearPrivacyLockPassword = (accountPassword: string) =>
    commands.appPrivacyLockPasswordClear(accountPassword).then(applyOutcome);

export async function requestPrivacyLock(): Promise<void> {
    if (useRuntimeStore.getState().privacyLock.hasPassword) {
        await engagePrivacyLock();
        return;
    }
    openPrivacyLockDialog({ engageAfterSetup: true });
}
