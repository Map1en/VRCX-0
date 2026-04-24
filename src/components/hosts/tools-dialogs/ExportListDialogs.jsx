import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { myAvatarRepository } from '@/repositories/index.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { ToolTextarea } from './ToolsDialogControls.jsx';
import {
    csvEscape,
    getEndpoint,
    getFriendIds,
    getUserMemoMap
} from './toolsDialogUtils.js';

export function ExportDiscordNamesDialog({ open, onOpenChange }) {
    const { t } = useTranslation();
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const orderedFriendIds = useFriendRosterStore(
        (state) => state.orderedFriendIds
    );
    const [content, setContent] = useState('');

    useEffect(() => {
        if (!open) {
            return;
        }
        const lines = ['DisplayName,DiscordName'];
        const discordRegex = /(?:discord|dc|dis)(?: |=|:|\u02f8|;)(.*)/i;
        for (const userId of getFriendIds(orderedFriendIds)) {
            const friend = friendsById[userId];
            const match =
                discordRegex.exec(friend?.statusDescription || '') ||
                discordRegex.exec(friend?.bio || '');
            if (match?.[1]) {
                lines.push(
                    `${csvEscape(friend?.displayName || userId)},${csvEscape(match[1].trim())}`
                );
            }
        }
        setContent(lines.join('\n'));
    }, [friendsById, open, orderedFriendIds]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
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

export function ExportFriendsListDialog({ open, onOpenChange }) {
    const { t } = useTranslation();
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const orderedFriendIds = useFriendRosterStore(
        (state) => state.orderedFriendIds
    );
    const [csv, setCsv] = useState('');
    const [json, setJson] = useState('');
    const [tab, setTab] = useState('csv');

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
                const lines = ['UserID,DisplayName,Memo'];
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
            .catch((error) =>
                toast.error(
                    userFacingErrorMessage(
                        error,
                        t('host.tools_dialogs.generated_toast.failed_to_export_friends_list')
                    )
                )
            );
        return () => {
            active = false;
        };
    }, [friendsById, open, orderedFriendIds]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.export_friends_list.header')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('dialog.export_friends_list.description')}
                    </DialogDescription>
                </DialogHeader>
                <Tabs value={tab} onValueChange={setTab}>
                    <TabsList>
                        <TabsTrigger value="csv">
                            {t('dialog.export_friends_list.csv')}
                        </TabsTrigger>
                        <TabsTrigger value="json">
                            {t('dialog.export_friends_list.json')}
                        </TabsTrigger>
                    </TabsList>
                    <TabsContent value="csv">
                        <ToolTextarea value={csv} />
                    </TabsContent>
                    <TabsContent value="json">
                        <ToolTextarea value={json} />
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}

export function ExportAvatarsListDialog({ open, onOpenChange }) {
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
            .getMyAvatars({ endpoint: getEndpoint() })
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
            .catch((error) =>
                toast.error(
                    userFacingErrorMessage(
                        error,
                        t('host.tools_dialogs.generated_toast.failed_to_export_avatar_list')
                    )
                )
            )
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });
        return () => {
            active = false;
        };
    }, [open]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
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
