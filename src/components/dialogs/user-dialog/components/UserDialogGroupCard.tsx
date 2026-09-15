import type { LucideIcon } from 'lucide-react';
import {
    CrownIcon,
    EyeOffIcon,
    Link2Icon,
    TagIcon,
    UsersIcon,
    UsersRoundIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { EntityRecord } from '@/domain/entities/shared';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Button } from '@/ui/shadcn/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { groupMemberVisibility } from '../userDialogGroupRows';
import { groupDisplayName } from '../userDialogRows';
import { rowImage } from './userDialogEntityImages';
import { openRow } from './userDialogEntityNavigation';

export type UserGroupCardMarkers = {
    own: ReadonlySet<string>;
    mutual: ReadonlySet<string>;
};

function MarkerIcon({
    icon: Icon,
    label,
    className = 'text-muted-foreground'
}: {
    icon: LucideIcon;
    label: string;
    className?: string;
}) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Icon
                        aria-label={label}
                        className={`size-3.5 shrink-0 ${className}`}
                    />
                }
            />
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

export function UserGroupCard({
    group,
    isOwner = false,
    isMutual = false
}: {
    group: EntityRecord;
    isOwner?: boolean;
    isMutual?: boolean;
}) {
    const { t } = useTranslation();

    const image = rowImage(group, 'group');
    const label = groupDisplayName(group);
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
        <Button
            type="button"
            variant="ghost"
            className="box-border h-auto w-full min-w-0 justify-start gap-2.5 p-1.5 text-left text-sm font-normal"
            onClick={() => openRow(group, 'group')}
        >
            <Avatar className="size-9 rounded-md after:rounded-md">
                {image ? (
                    <AvatarImage src={image} alt="" className="rounded-md" />
                ) : null}
                <AvatarFallback className="rounded-md [&>svg]:size-4">
                    <UsersRoundIcon aria-hidden="true" />
                </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 overflow-hidden">
                <span className="flex min-w-0 items-center gap-1 leading-5 font-medium">
                    <span className="truncate">{label || '—'}</span>
                    {isOwner ? (
                        <MarkerIcon
                            icon={CrownIcon}
                            label={t('dialog.group.label.owner_2')}
                            className="text-amber-400"
                        />
                    ) : null}
                    {isMutual ? (
                        <MarkerIcon
                            icon={Link2Icon}
                            label={t('dialog.user.groups.mutual_groups')}
                        />
                    ) : null}
                    {isRepresenting ? (
                        <MarkerIcon
                            icon={TagIcon}
                            label={t('dialog.group.members.representing')}
                        />
                    ) : null}
                    {visibility === 'friends' ? (
                        <MarkerIcon
                            icon={UsersIcon}
                            label={t('dialog.user.label.visibility_friends')}
                        />
                    ) : visibility === 'hidden' ? (
                        <MarkerIcon
                            icon={EyeOffIcon}
                            label={t('dialog.user.label.visibility_hidden')}
                        />
                    ) : null}
                </span>
                <span className="text-muted-foreground block truncate text-xs tabular-nums">
                    {t('host.tools_dialogs.group_moderation.member_count', {
                        count: memberCount
                    })}
                </span>
            </span>
        </Button>
    );
}
