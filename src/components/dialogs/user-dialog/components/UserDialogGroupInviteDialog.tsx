import { LoaderCircleIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import type { UserGroupsOverviewGroup } from '@/platform/tauri/bindings';
import groupProfileRepository from '@/repositories/groupProfileRepository';
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

interface UserDialogGroupInviteDialogProps {
    open: boolean;
    endpoint: string;
    currentUserId: string;
    targetUserId: string;
    targetLabel?: string;
    onOpenChange: (open: boolean) => void;
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
    const [groups, setGroups] = useState<UserGroupsOverviewGroup[]>([]);
    const [selectedGroupId, setSelectedGroupId] = useState('');
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);

    useEffect(() => {
        if (!open) {
            return;
        }

        let active = true;
        setGroups([]);
        setSelectedGroupId('');
        setLoading(true);
        groupProfileRepository
            .getUserGroupsOverview({ userId: currentUserId, endpoint })
            .then((result) => {
                if (!active) {
                    return;
                }
                setGroups(
                    result.groups.filter((group) =>
                        group.permissions?.some(
                            (permission) =>
                                permission === '*' ||
                                permission === 'group-invites-manage'
                        )
                    )
                );
            })
            .catch((error: unknown) => {
                if (active) {
                    toast.error(
                        userFacingErrorMessage(
                            error,
                            t('dialog.user.group_invite.load_failed')
                        )
                    );
                }
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [currentUserId, endpoint, open, t]);

    const groupIds = useMemo(
        () => groups.map((group) => group.groupId),
        [groups]
    );

    function groupLabel(groupId: string) {
        const group = groups.find((item) => item.groupId === groupId);
        return group?.name || groupId;
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
                userFacingErrorMessage(
                    error,
                    t('dialog.user.toast.failed_to_send_group_invite')
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
                    <ComboboxContent>
                        <ComboboxEmpty>
                            {t(
                                groupIds.length
                                    ? 'dialog.user.empty.no_results'
                                    : 'dialog.user.group_invite.no_groups'
                            )}
                        </ComboboxEmpty>
                        <ComboboxList>
                            {(groupId: string) => (
                                <ComboboxItem key={groupId} value={groupId}>
                                    {groupLabel(groupId)}
                                </ComboboxItem>
                            )}
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
