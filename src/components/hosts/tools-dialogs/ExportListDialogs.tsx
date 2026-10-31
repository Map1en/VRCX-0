import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ToolbarSegmented } from '@/components/layout/ToolbarControls';
import type { FriendRosterById } from '@/domain/friends/types';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import myAvatarRepository from '@/repositories/myAvatarRepository';
import { toast } from '@/services/toastService';
import { replaceBioSymbols } from '@/shared/utils/string';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';

import { ToolTextarea } from './ToolsDialogControls';
import {
    csvEscape,
    getFriendIds,
    getProfileBioMap,
    getUserMemoMap
} from './toolsDialogUtils';

type ExportDialogProps = {
    open: boolean;
    onOpenChange(open: boolean): void;
};

const EMPTY_FRIENDS: FriendRosterById = {};
const EMPTY_FRIEND_IDS: string[] = [];

export function ExportDiscordNamesDialog({
    open,
    onOpenChange
}: ExportDialogProps) {
    const { t } = useTranslation();
    const friendsById = useFriendRosterStore((state) =>
        open ? state.friendsById : EMPTY_FRIENDS
    );
    const orderedFriendIds = useFriendRosterStore((state) =>
        open ? state.orderedFriendIds : EMPTY_FRIEND_IDS
    );
    const [content, setContent] = useState('');

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        let active = true;
        void getProfileBioMap().then((bioById) => {
            if (!active) {
                return;
            }
            const lines = ['DisplayName,DiscordName'];
            const discordRegex = /(?:discord|dc|dis)(?: |=|:|\u02f8|;)(.*)/i;
            for (const userId of getFriendIds(orderedFriendIds)) {
                const friend = friendsById[userId];
                const discordName = [
                    friend?.statusDescription || '',
                    replaceBioSymbols(bioById.get(userId) || '')
                ]
                    .map((text) => discordRegex.exec(text)?.[1]?.trim())
                    .find(Boolean);
                if (discordName) {
                    lines.push(
                        `${csvEscape(friend?.displayName || userId)},${csvEscape(discordName)}`
                    );
                }
            }
            setContent(lines.join('\n'));
        });
        return () => {
            active = false;
        };
    }, [friendsById, open, orderedFriendIds]);

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            onOpenChangeComplete={(nextOpen) => {
                if (!nextOpen && !open) {
                    setContent('');
                }
            }}
        >
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.discord_names.header')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('dialog.discord_names.description')}
                    </DialogDescription>
                </DialogHeader>
                <ToolTextarea value={content} />
            </DialogContent>
        </Dialog>
    );
}

export function ExportFriendsListDialog({
    open,
    onOpenChange
}: ExportDialogProps) {
    const { t } = useTranslation();
    const friendsById = useFriendRosterStore((state) =>
        open ? state.friendsById : EMPTY_FRIENDS
    );
    const orderedFriendIds = useFriendRosterStore((state) =>
        open ? state.orderedFriendIds : EMPTY_FRIEND_IDS
    );
    const [csv, setCsv] = useState('');
    const [json, setJson] = useState('');
    const [format, setFormat] = useState<'csv' | 'json'>('csv');

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        let active = true;
        getUserMemoMap()
            .then((memosById) => {
                if (!active) {
                    return;
                }
                const lines = ['UserID,DisplayName,LocalNote'];
                const friendsList = [];
                for (const userId of getFriendIds(orderedFriendIds)) {
                    const friend = friendsById[userId];
                    const memo = String(
                        memosById.get(userId) || friend?.memo || ''
                    ).replace(/\n/g, ' ');
                    lines.push(
                        `${csvEscape(userId)},${csvEscape(friend?.displayName || friend?.name || '')},${csvEscape(memo)}`
                    );
                    friendsList.push(userId);
                }
                setCsv(lines.join('\n'));
                setJson(JSON.stringify({ friends: friendsList }, null, 4));
            })
            .catch((error: unknown) =>
                toast.add({
                    type: 'error',
                    title: userFacingErrorMessage(
                        error,
                        t(
                            'host.tools_dialogs.toast.failed_to_export_friends_list'
                        )
                    )
                })
            );
        return () => {
            active = false;
        };
    }, [friendsById, open, orderedFriendIds, t]);

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            onOpenChangeComplete={(nextOpen) => {
                if (!nextOpen && !open) {
                    setCsv('');
                    setJson('');
                }
            }}
        >
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.export_friends_list.header')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('dialog.export_friends_list.description')}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-2">
                    <ToolbarSegmented
                        value={format}
                        onValueChange={setFormat}
                        options={[
                            {
                                value: 'csv',
                                label: t('dialog.export_friends_list.csv')
                            },
                            {
                                value: 'json',
                                label: t('dialog.export_friends_list.json')
                            }
                        ]}
                    />
                    <ToolTextarea
                        key={format}
                        value={format === 'csv' ? csv : json}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}

export function ExportAvatarsListDialog({
    open,
    onOpenChange
}: ExportDialogProps) {
    const { t } = useTranslation();
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        let active = true;
        setLoading(true);
        myAvatarRepository
            .getMyAvatars()
            .then((avatars) => {
                if (!active) {
                    return;
                }
                const lines = ['AvatarID,AvatarName'];
                for (const avatar of Array.isArray(avatars) ? avatars : []) {
                    lines.push(
                        `${csvEscape(avatar.id)},${csvEscape(avatar.name)}`
                    );
                }
                setContent(lines.join('\n'));
            })
            .catch((error: unknown) =>
                toast.add({
                    type: 'error',
                    title: userFacingErrorMessage(
                        error,
                        t(
                            'host.tools_dialogs.toast.failed_to_export_avatar_list'
                        )
                    )
                })
            )
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });
        return () => {
            active = false;
        };
    }, [open, t]);

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            onOpenChangeComplete={(nextOpen) => {
                if (!nextOpen && !open) {
                    setContent('');
                }
            }}
        >
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.export_own_avatars.header')}
                    </DialogTitle>
                    <DialogDescription>
                        {loading
                            ? 'Loading avatars.'
                            : t('dialog.export_own_avatars.description')}
                    </DialogDescription>
                </DialogHeader>
                <ToolTextarea value={content} />
            </DialogContent>
        </Dialog>
    );
}
