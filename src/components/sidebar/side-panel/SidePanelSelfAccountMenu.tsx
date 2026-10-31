import {
    CheckIcon,
    LockIcon,
    LogInIcon,
    MoreHorizontalIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import authRepository, {
    type SavedAuthSnapshot,
    type SavedCredentialRecord,
    type SavedCredentialUser
} from '@/repositories/authRepository';
import {
    activateSavedAccount,
    partitionSavedAccounts
} from '@/services/accountSwitchService';
import { logoutFromReactShell } from '@/services/authExecutionService';
import { userImage } from '@/services/entityMediaService';
import { requestPrivacyLock } from '@/services/privacyLockService';
import { toast } from '@/services/toastService';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Spinner } from '@/ui/shadcn/spinner';

function accountDisplayName(user: SavedCredentialUser) {
    return user.displayName || user.username || user.id || 'account';
}

function accountFallback(user: SavedCredentialUser) {
    return accountDisplayName(user).trim().slice(0, 2).toUpperCase() || '?';
}

function readSavedAccounts(
    snapshot: SavedAuthSnapshot
): SavedCredentialRecord[] {
    return snapshot.savedCredentialsList;
}

export function SidePanelSelfAccountMenu() {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const [open, setOpen] = useState(false);
    const [accounts, setAccounts] = useState<SavedCredentialRecord[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!open) {
            return;
        }
        let active = true;
        setIsLoading(true);
        authRepository
            .getSavedAuthSnapshot()
            .then((snapshot) => {
                if (active) {
                    setAccounts(readSavedAccounts(snapshot));
                }
            })
            .catch(() => {
                if (active) {
                    setAccounts([]);
                }
            })
            .finally(() => {
                if (active) {
                    setIsLoading(false);
                }
            });
        return () => {
            active = false;
        };
    }, [open]);

    function handleActivate(entry: SavedCredentialRecord) {
        setOpen(false);
        void activateSavedAccount(entry);
    }

    function handleLock() {
        setOpen(false);
        requestPrivacyLock().catch((error: unknown) => {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('privacy_lock.error.failed')
            });
        });
    }

    function handleUseOtherAccount() {
        setOpen(false);
        void logoutFromReactShell();
    }

    const { switchable, requiresLogin } = partitionSavedAccounts(
        accounts,
        currentUserId
    );

    function renderAccount(entry: SavedCredentialRecord, index: number) {
        const userId = entry.user.id;
        const isCurrent = Boolean(userId && userId === currentUserId);
        const needsLogin = !isCurrent && !entry.hasLoginCredentials;
        const avatarUrl = userImage(entry.user, 64);
        return (
            <DropdownMenuItem
                key={userId || index}
                disabled={!userId}
                className="gap-2.5 p-1.5"
                onClick={isCurrent ? undefined : () => handleActivate(entry)}
            >
                <Avatar>
                    {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
                    <AvatarFallback>
                        {accountFallback(entry.user)}
                    </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm leading-4">
                        {accountDisplayName(entry.user)}
                    </div>
                    <div className="text-muted-foreground truncate text-xs leading-4">
                        {entry.user.username || userId}
                    </div>
                </div>
                {isCurrent ? (
                    <CheckIcon className="shrink-0 opacity-70" />
                ) : null}
                {needsLogin ? (
                    <LogInIcon className="text-muted-foreground shrink-0" />
                ) : null}
            </DropdownMenuItem>
        );
    }

    async function handleLogout() {
        setOpen(false);
        try {
            await logoutFromReactShell();
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('app_menu.messages.logout_failed')
            });
        }
    }

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('side_panel.self_more_actions')}
                        className="text-muted-foreground shrink-0"
                    >
                        <MoreHorizontalIcon />
                    </Button>
                }
            />
            <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                        {t('side_panel.switch_account')}
                    </DropdownMenuLabel>
                    {isLoading ? (
                        <div className="flex justify-center py-3">
                            <Spinner className="text-muted-foreground" />
                        </div>
                    ) : (
                        switchable.map(renderAccount)
                    )}
                </DropdownMenuGroup>
                {!isLoading && requiresLogin.length > 0 ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                                {t(
                                    'view.login.saved_group.switch_requires_login'
                                )}
                            </DropdownMenuLabel>
                            {requiresLogin.map(renderAccount)}
                        </DropdownMenuGroup>
                    </>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLock}>
                    <LockIcon />
                    {t('privacy_lock.action.lock')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleUseOtherAccount}>
                    {t('view.login.useOtherAccount')}
                </DropdownMenuItem>
                <DropdownMenuItem
                    variant="destructive"
                    onClick={() => {
                        void handleLogout();
                    }}
                >
                    {t('app_menu.logout')}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
