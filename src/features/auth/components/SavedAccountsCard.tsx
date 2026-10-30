import { LogInIcon, Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type {
    SavedCredentialRecord,
    SavedCredentialUser
} from '@/repositories/authRepository';
import { partitionSavedAccounts } from '@/services/accountSwitchService';
import { userImage } from '@/services/entityMediaService';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Spinner } from '@/ui/shadcn/spinner';

import { getLoginUserDisplayName as getUserDisplayName } from '../loginDisplay';

function getSavedAccountFallback(user: SavedCredentialUser) {
    const label = getUserDisplayName(user);
    return label.trim().slice(0, 2).toUpperCase() || '?';
}

function SavedAccountGroupLabel({
    title,
    hint
}: {
    title: string;
    hint: string;
}) {
    return (
        <div className="flex items-baseline justify-between gap-2 px-2 text-xs">
            <span className="text-foreground/80 font-medium">{title}</span>
            <span className="text-muted-foreground">{hint}</span>
        </div>
    );
}

type SavedAccountsCardProps = {
    accounts: SavedCredentialRecord[];
    activeSavedUserId: string;
    isAuthBusy: boolean;
    isDeleting: boolean;
    onCancelAutoLogin: () => void;
    onDeleteStart: (entry: SavedCredentialRecord) => void;
    onLogin: (entry: SavedCredentialRecord) => void;
    onUseOtherAccount: (entry?: SavedCredentialRecord) => void;
};

export function SavedAccountsCard({
    accounts,
    activeSavedUserId,
    isDeleting,
    isAuthBusy,
    onLogin,
    onDeleteStart,
    onCancelAutoLogin,
    onUseOtherAccount
}: SavedAccountsCardProps) {
    const { t } = useTranslation();
    const {
        switchable: passwordAccounts,
        requiresLogin: passwordlessAccounts
    } = partitionSavedAccounts(accounts, null);

    function renderAccount(entry: SavedCredentialRecord, index: number) {
        const userId = entry.user.id;
        const canUseSavedCredentials = Boolean(
            userId && entry.hasLoginCredentials
        );
        const isRelogging = Boolean(userId && activeSavedUserId === userId);
        const avatarUrl = userImage(entry.user, 64);

        return (
            <div key={userId || index} className="flex items-center gap-2">
                <Button
                    type="button"
                    variant="ghost"
                    className="bg-muted/40 hover:bg-muted h-auto min-w-0 flex-1 justify-start gap-3 p-2 text-left font-normal"
                    disabled={isAuthBusy || isDeleting}
                    onClick={() => {
                        if (canUseSavedCredentials) {
                            onLogin(entry);
                        } else {
                            onUseOtherAccount(entry);
                        }
                    }}
                >
                    <Avatar size="lg">
                        {avatarUrl ? (
                            <AvatarImage src={avatarUrl} alt="" />
                        ) : null}
                        <AvatarFallback>
                            {getSavedAccountFallback(entry.user)}
                        </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                            {getUserDisplayName(entry.user)}
                        </div>
                        <div className="text-muted-foreground truncate text-xs">
                            {entry.user.username || userId}
                        </div>
                    </div>
                    {isRelogging ? (
                        <Spinner
                            data-icon="inline-end"
                            className="text-muted-foreground shrink-0"
                        />
                    ) : null}
                    {canUseSavedCredentials ? null : (
                        <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
                            <LogInIcon className="size-3.5" />
                            {t('view.login.saved_group.requires_login')}
                        </span>
                    )}
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t(
                        'view.login.saved_account_remove.description',
                        {
                            name: getUserDisplayName(entry.user)
                        }
                    )}
                    disabled={isDeleting || isAuthBusy}
                    onClick={() => {
                        onCancelAutoLogin();
                        onDeleteStart(entry);
                    }}
                >
                    <Trash2Icon data-icon="inline-start" />
                </Button>
            </div>
        );
    }

    return (
        <Card className="flex max-h-[60vh] min-h-0 flex-col">
            <CardHeader className="shrink-0">
                <CardTitle className="text-center">
                    {t('view.login.savedAccounts')}
                </CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
                <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-1">
                    {passwordAccounts.length > 0 &&
                    passwordlessAccounts.length > 0 ? (
                        <SavedAccountGroupLabel
                            title={t('view.login.saved_group.with_password')}
                            hint={t(
                                'view.login.saved_group.with_password_hint'
                            )}
                        />
                    ) : null}
                    {passwordAccounts.map(renderAccount)}
                    {passwordlessAccounts.length > 0 ? (
                        <>
                            {passwordAccounts.length > 0 ? (
                                <div className="bg-border mx-2 my-1 h-px" />
                            ) : null}
                            <SavedAccountGroupLabel
                                title={t(
                                    'view.login.saved_group.without_password'
                                )}
                                hint={t(
                                    'view.login.saved_group.without_password_hint'
                                )}
                            />
                            {passwordlessAccounts.map(renderAccount)}
                        </>
                    ) : null}
                </div>
                <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    disabled={isAuthBusy || isDeleting}
                    onClick={() => {
                        onUseOtherAccount();
                    }}
                >
                    {t('view.login.useOtherAccount')}
                </Button>
            </CardContent>
        </Card>
    );
}
