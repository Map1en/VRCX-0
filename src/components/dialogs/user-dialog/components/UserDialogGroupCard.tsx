import { EyeIcon, TagIcon, UsersIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import groupProfileRepository from '@/repositories/groupProfileRepository';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Button } from '@/ui/shadcn/button';

import { groupIdForRow, groupMemberVisibility } from '../userDialogGroupRows';
import { groupDisplayName } from '../userDialogRows';
import { rowImage } from './userDialogEntityImages';
import { openRow } from './userDialogEntityNavigation';

function visibilityLabel(visibility: any, t: any) {
    if (visibility === 'friends') {
        return t('dialog.user.label.visibility_friends');
    }
    if (visibility === 'hidden') {
        return t('dialog.user.label.visibility_hidden');
    }
    return t('dialog.user.label.visibility_everyone');
}

export function UserGroupCard({ group, currentEndpoint }: any) {
    const { t } = useTranslation();

    const groupId = groupIdForRow(group);
    const [profile, setProfile] = useState<any>(null);

    useEffect(() => {
        let active = true;
        setProfile(null);

        if (!groupId) {
            return () => {
                active = false;
            };
        }

        groupProfileRepository
            .getGroupProfile({
                groupId,
                endpoint: currentEndpoint,
                includeRoles: false
            })
            .then((groupProfile: any) => {
                if (active) {
                    setProfile(groupProfile);
                }
            })
            .catch(() => {});

        return () => {
            active = false;
        };
    }, [currentEndpoint, groupId]);

    const displayGroup = profile ? { ...group, ...profile } : group;
    const image = rowImage(displayGroup, 'group');
    const label = groupDisplayName(displayGroup);
    const visibility = groupMemberVisibility(group);
    const isRepresenting = Boolean(
        group?.isRepresenting || group?.is_representing
    );
    const memberCount =
        Number(
            group?.memberCount ??
                group?.member_count ??
                group?.membershipCount ??
                group?.membership_count ??
                0
        ) || 0;

    return (
        <div className="flex min-w-0 items-center p-1 text-sm">
            <Button
                type="button"
                variant="ghost"
                className="h-auto min-w-0 flex-1 justify-start gap-2 px-1.5 py-1.5 text-left font-normal"
                onClick={() => openRow(displayGroup, 'group')}
            >
                <Avatar className="size-9 rounded-md after:rounded-md">
                    {image ? (
                        <AvatarImage
                            src={image}
                            alt=""
                            className="rounded-md"
                        />
                    ) : null}
                    <AvatarFallback className="rounded-md [&>svg]:size-4">
                        <UsersIcon aria-hidden="true" />
                    </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 overflow-hidden">
                    <span className="block truncate leading-snug font-medium">
                        {label || '\u2014'}
                    </span>
                    <span className="text-muted-foreground flex max-w-full items-center gap-1.5 overflow-hidden text-xs">
                        {isRepresenting ? (
                            <span className="inline-flex min-w-0 shrink items-center gap-1 truncate">
                                <TagIcon className="size-3.5 shrink-0" />
                                <span className="truncate">
                                    {t('dialog.group.members.representing')}
                                </span>
                            </span>
                        ) : null}
                        {visibility !== 'visible' ? (
                            <span className="inline-flex min-w-0 shrink items-center gap-1 truncate">
                                <EyeIcon className="size-3.5 shrink-0" />
                                <span className="truncate">
                                    {visibilityLabel(visibility, t)}
                                </span>
                            </span>
                        ) : null}
                        <span className="inline-flex shrink-0 items-center gap-1 tabular-nums">
                            <UsersIcon className="size-3.5" />
                            {memberCount}
                        </span>
                    </span>
                </span>
            </Button>
        </div>
    );
}
