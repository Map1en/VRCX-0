import { AlertTriangleIcon, LoaderCircleIcon, UsersIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import groupProfileRepository from '@/repositories/groupProfileRepository';
import { isVrchatRequestError } from '@/repositories/vrchatRequest';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { Alert, AlertAction, AlertDescription } from '@/ui/shadcn/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Button } from '@/ui/shadcn/button';
import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList
} from '@/ui/shadcn/combobox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';

import { useUserDialogGroupInviteGroups } from '../useUserDialogGroupInviteGroups';

interface UserDialogGroupInviteDialogProps {
    open: boolean;
    endpoint: string;
    currentUserId: string;
    targetUserId: string;
    targetLabel?: string;
    onOpenChange: (open: boolean) => void;
}

function isAlreadyGroupMemberError(error: unknown) {
    return Boolean(
        isVrchatRequestError(error) &&
        error.status === 400 &&
        error.message.startsWith('User ') &&
        error.message.endsWith(' is already a member of this group.')
    );
}

export function UserDialogGroupInviteDialog({
    open,
    endpoint,
    currentUserId,
    targetUserId,
    targetLabel,
    onOpenChange
}: UserDialogGroupInviteDialogProps) {
    const { t } = useTranslation();
    const [selectedGroupId, setSelectedGroupId] = useState('');
    const [sending, setSending] = useState(false);
    const { groups, loading, permissionsDegraded, reload } =
        useUserDialogGroupInviteGroups({
            open,
            currentUserId,
            endpoint
        });

    useEffect(() => {
        if (open) {
            setSelectedGroupId('');
        }
    }, [currentUserId, endpoint, open]);

    const groupIds = useMemo(
        () => groups.map((group) => group.groupId),
        [groups]
    );
    const groupsById = useMemo(
        () => new Map(groups.map((group) => [group.groupId, group])),
        [groups]
    );

    function groupLabel(groupId: string) {
        const group = groupsById.get(groupId);
        const name = group?.name || groupId;
        return group?.shortCode ? `${name} (${group.shortCode})` : name;
    }

    async function invite() {
        if (!selectedGroupId || !targetUserId) {
            return;
        }
        setSending(true);
        try {
            await groupProfileRepository.sendGroupInvite({
                groupId: selectedGroupId,
                userId: targetUserId
            });
            toast.success(t('dialog.user.success.group_invite_sent'));
            onOpenChange(false);
        } catch (error) {
            toast.error(
                t(
                    isAlreadyGroupMemberError(error)
                        ? 'dialog.user.toast.user_already_group_member'
                        : 'dialog.user.toast.failed_to_send_group_invite'
                )
            );
        } finally {
            setSending(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.user.actions.invite_to_group')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('dialog.user.group_invite.description', {
                            value: targetLabel || targetUserId
                        })}
                    </DialogDescription>
                </DialogHeader>

                {permissionsDegraded ? (
                    <Alert>
                        <AlertTriangleIcon />
                        <AlertDescription>
                            {t('dialog.user.group_invite.permissions_degraded')}
                        </AlertDescription>
                        <AlertAction>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={loading || sending}
                                onClick={() => {
                                    setSelectedGroupId('');
                                    reload();
                                }}
                            >
                                {t('common.action.retry')}
                            </Button>
                        </AlertAction>
                    </Alert>
                ) : null}

                <Combobox
                    items={groupIds}
                    value={selectedGroupId || null}
                    itemToStringLabel={groupLabel}
                    onValueChange={(value: string | null) =>
                        setSelectedGroupId(value || '')
                    }
                >
                    <ComboboxInput
                        className="w-full"
                        disabled={loading || sending}
                        placeholder={t(
                            loading
                                ? 'dialog.user.group_invite.loading'
                                : 'dialog.user.group_invite.select_group'
                        )}
                    />
                    <ComboboxContent className="bg-popover!">
                        <ComboboxEmpty>
                            {t(
                                groupIds.length
                                    ? 'dialog.user.empty.no_results'
                                    : 'dialog.user.group_invite.no_groups'
                            )}
                        </ComboboxEmpty>
                        <ComboboxList>
                            {(groupId: string) => {
                                const group = groupsById.get(groupId);
                                const iconUrl = group?.iconUrl
                                    ? convertFileUrlToImageUrl(
                                          group.iconUrl,
                                          128
                                      )
                                    : '';
                                return (
                                    <ComboboxItem
                                        key={groupId}
                                        value={groupId}
                                        className="py-1.5"
                                    >
                                        <Avatar className="size-8 shrink-0 rounded-md after:rounded-md">
                                            {iconUrl ? (
                                                <AvatarImage
                                                    src={iconUrl}
                                                    alt=""
                                                    className="rounded-md"
                                                />
                                            ) : null}
                                            <AvatarFallback className="rounded-md [&>svg]:size-4">
                                                <UsersIcon aria-hidden="true" />
                                            </AvatarFallback>
                                        </Avatar>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate font-medium">
                                                {group?.name || groupId}
                                            </span>
                                            {group?.shortCode ? (
                                                <span className="text-muted-foreground block truncate text-xs">
                                                    {group.shortCode}
                                                </span>
                                            ) : null}
                                        </span>
                                    </ComboboxItem>
                                );
                            }}
                        </ComboboxList>
                    </ComboboxContent>
                </Combobox>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={sending}
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={!selectedGroupId || loading || sending}
                        onClick={invite}
                    >
                        {sending ? (
                            <LoaderCircleIcon className="animate-spin" />
                        ) : null}
                        {t('dialog.user.actions.invite')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
