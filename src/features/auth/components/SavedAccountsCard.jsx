import { Trash2Icon } from 'lucide-react';

import { useTranslation } from 'react-i18next';
import { userImage } from '@/lib/entityMedia.js';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Spinner } from '@/ui/shadcn/spinner';

import { getLoginUserDisplayName as getUserDisplayName } from '../loginDisplay.js';

function getSavedAccountFallback(user) {
    const label = getUserDisplayName(user) || user?.username || user?.id || '?';
    return String(label).trim().slice(0, 2).toUpperCase() || '?';
}

export function SavedAccountsCard({
    visible,
    accounts,
    activeSavedUserId,
    isDeleting,
    isAuthBusy,
    onLogin,
    onDeleteStart,
    onCancelAutoLogin
}) {
    const { t } = useTranslation();

    if (!visible) {
        return null;
    }

    return (
        <>
            <div className="bg-border hidden w-px md:block" />
            <Card className="flex h-full min-h-0 flex-col">
                <CardHeader>
                    <CardTitle className="text-center">
                        {t('view.login.savedAccounts')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="min-h-0 flex-1 overflow-y-auto">
                    <div className="flex flex-col gap-2">
                        {accounts.map((entry) => {
                            const hasStoredCredentials = Boolean(
                                entry.loginParams?.username &&
                                    entry.loginParams?.password
                            );
                            const isRelogging = activeSavedUserId === entry.user.id;
                            const avatarUrl = userImage(entry.user, true, '64');

                            return (
                                <div
                                    key={entry.user.id}
                                    className="flex items-center gap-2"
                                >
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="h-auto min-w-0 flex-1 justify-start gap-3 p-2 text-left font-normal"
                                        disabled={
                                            !hasStoredCredentials ||
                                            isAuthBusy ||
                                            isDeleting
                                        }
                                        onClick={() => void onLogin(entry)}
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
                                                {entry.user.username || entry.user.id}
                                            </div>
                                            {entry.loginParams.endpoint ? (
                                                <div className="text-muted-foreground truncate text-xs">
                                                    {entry.loginParams.endpoint}
                                                </div>
                                            ) : null}
                                        </div>
                                        {isRelogging ? (
                                            <Spinner
                                                data-icon="inline-end"
                                                className="text-muted-foreground shrink-0"
                                            />
                                        ) : null}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={t(
                                            'view.login.saved_account_remove.description',
                                            {
                                                name: getUserDisplayName(
                                                    entry.user
                                                )
                                            }
                                        )}
                                        disabled={isDeleting || isAuthBusy}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onCancelAutoLogin(
                                                t(
                                                    'view.auth.auto_login.skipped_saved_account_edited'
                                                )
                                            );
                                            onDeleteStart(entry);
                                        }}
                                    >
                                        <Trash2Icon data-icon="inline-start" />
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>
        </>
    );
}
