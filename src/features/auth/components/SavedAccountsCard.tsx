import { Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type {
    GenericRecord,
    SavedCredentialRecord
} from '@/repositories/authRepository';
import { userImage } from '@/services/entityMediaService';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Spinner } from '@/ui/shadcn/spinner';

import { getLoginUserDisplayName as getUserDisplayName } from '../loginDisplay';

function stringField(record: GenericRecord | null | undefined, key: string) {
    const value = record?.[key];
    return typeof value === 'string' ? value : '';
}

function getSavedAccountFallback(user: GenericRecord | null | undefined) {
    const label = getUserDisplayName(user);
    return label.trim().slice(0, 2).toUpperCase() || '?';
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

    return (
        <Card className="flex max-h-[60vh] min-h-0 flex-col">
            <CardHeader className="shrink-0">
                <CardTitle className="text-center">
                    {t('view.login.savedAccounts')}
                </CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
                <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
                    {accounts.map((entry, index) => {
                        const userId = stringField(entry.user, 'id');
                        const canUseSavedCredentials = Boolean(
                            userId && entry.hasLoginCredentials
                        );
                        const isRelogging = Boolean(
                            userId && activeSavedUserId === userId
                        );
                        const avatarUrl = userImage(entry.user, true, '64');

                        return (
                            <div
                                key={userId || index}
                                className="flex items-center gap-2"
                            >
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
                                            <AvatarImage
                                                src={avatarUrl}
                                                alt=""
                                            />
                                        ) : null}
                                        <AvatarFallback>
                                            {getSavedAccountFallback(
                                                entry.user
                                            )}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-medium">
                                            {getUserDisplayName(entry.user)}
                                        </div>
                                        <div className="text-muted-foreground truncate text-xs">
                                            {stringField(
                                                entry.user,
                                                'username'
                                            ) || userId}
                                        </div>
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
                    })}
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
