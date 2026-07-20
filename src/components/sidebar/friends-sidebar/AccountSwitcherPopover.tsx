import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import authRepository, {
    type SavedAuthSnapshot,
    type SavedCredentialRecord,
    type SavedCredentialUser
} from '@/repositories/authRepository';
import {
    canQuickSwitchTo,
    switchToSavedAccount
} from '@/services/accountSwitchService';
import { logoutFromReactShell } from '@/services/authExecutionService';
import { userImage } from '@/services/entityMediaService';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Button } from '@/ui/shadcn/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
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

export function AccountSwitcherPopover() {
    const { t } = useTranslation();
    const savedCredentialCount = useRuntimeStore((state) =>
        Number(state.auth.savedCredentialCount)
    );
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

    if (!Number.isFinite(savedCredentialCount) || savedCredentialCount < 2) {
        return null;
    }

    function handleSwitch(entry: SavedCredentialRecord) {
        setOpen(false);
        void switchToSavedAccount(entry);
    }

    function handleUseOtherAccount() {
        setOpen(false);
        void logoutFromReactShell();
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('view.login.savedAccounts')}
                        className={cn(
                            'text-muted-foreground shrink-0 transition-opacity',
                            open
                                ? 'opacity-100'
                                : 'opacity-0 group-hover:opacity-100'
                        )}
                    >
                        <ChevronDownIcon />
                    </Button>
                }
            />
            <PopoverContent
                side="bottom"
                align="end"
                className="w-64 gap-1 p-1.5"
            >
                <div className="text-muted-foreground px-2 py-1 text-xs">
                    {t('view.login.savedAccounts')}
                </div>
                {isLoading ? (
                    <div className="flex justify-center py-3">
                        <Spinner className="text-muted-foreground" />
                    </div>
                ) : (
                    accounts.map((entry, index) => {
                        const userId = entry.user.id;
                        const isCurrent = Boolean(
                            userId && userId === currentUserId
                        );
                        const canSwitch = canQuickSwitchTo(
                            entry,
                            currentUserId
                        );
                        const avatarUrl = userImage(entry.user, true, '64');
                        return (
                            <Button
                                key={userId || index}
                                type="button"
                                variant="ghost"
                                disabled={!isCurrent && !canSwitch}
                                aria-current={isCurrent}
                                className="aria-[current=true]:bg-accent/60 h-auto w-full min-w-0 justify-start gap-2.5 p-1.5 text-left font-normal"
                                onClick={
                                    canSwitch
                                        ? () => handleSwitch(entry)
                                        : undefined
                                }
                            >
                                <Avatar size="sm">
                                    {avatarUrl ? (
                                        <AvatarImage src={avatarUrl} alt="" />
                                    ) : null}
                                    <AvatarFallback>
                                        {accountFallback(entry.user)}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm">
                                        {accountDisplayName(entry.user)}
                                    </div>
                                    <div className="text-muted-foreground truncate text-xs">
                                        {entry.user.username || userId}
                                    </div>
                                </div>
                                {isCurrent ? (
                                    <CheckIcon className="text-foreground/70 shrink-0" />
                                ) : null}
                            </Button>
                        );
                    })
                )}
                <div className="bg-border my-0.5 h-px" />
                <Button
                    type="button"
                    variant="ghost"
                    className="w-full justify-start font-normal"
                    onClick={handleUseOtherAccount}
                >
                    {t('view.login.useOtherAccount')}
                </Button>
            </PopoverContent>
        </Popover>
    );
}
