import {
    ArrowDownIcon,
    ArrowUpIcon,
    DownloadIcon,
    EyeIcon,
    LogOutIcon,
    SettingsIcon,
    TagIcon,
    UsersIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils.js';
import { groupProfileRepository } from '@/repositories/index.js';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

import {
    groupIdForRow,
    groupMemberVisibility
} from '../userDialogGroupRows.js';
import { groupDisplayName } from '../userDialogRows.js';
import { rowImage } from './userDialogEntityImages.js';
import { openRow } from './userDialogEntityNavigation.js';

function visibilityLabel(visibility, t) {
    if (visibility === 'friends') {
        return t('dialog.user.generated.visibility_friends');
    }
    if (visibility === 'hidden') {
        return t('dialog.user.generated.visibility_hidden');
    }
    return t('dialog.user.generated.visibility_everyone');
}

export function UserGroupCard({
    group,
    currentEndpoint,
    editable = false,
    selectable = false,
    selected = false,
    busy = false,
    onVisibilityChange,
    onLeave,
    onMove,
    onSelectionChange
}) {
    const { t } = useTranslation();

    const groupId = groupIdForRow(group);
    const [profile, setProfile] = useState(null);

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
            .then((groupProfile) => {
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
    const visibilityValue = ['visible', 'friends', 'hidden'].includes(
        visibility
    )
        ? visibility
        : 'visible';
    const memberCount =
        Number(
            group?.memberCount ??
                group?.member_count ??
                group?.membershipCount ??
                group?.membership_count ??
                0
        ) || 0;

    return (
        <div
            className={cn(
                'flex items-center gap-1 p-1 text-sm',
                editable ? 'w-56' : 'w-44'
            )}
        >
            {selectable ? (
                <Checkbox
                    checked={selected}
                    disabled={busy}
                    aria-label={
                        label
                            ? `${t('common.actions.select')} ${label}`
                            : t('common.actions.select')
                    }
                    className="shrink-0"
                    onCheckedChange={(checked) =>
                        onSelectionChange?.(group, checked === true)
                    }
                />
            ) : null}
            <Button
                type="button"
                variant="ghost"
                className="h-auto min-w-0 flex-1 justify-start gap-2 px-1.5 py-1.5 text-left font-normal"
                onClick={() => openRow(displayGroup, 'group')}
            >
                {image ? (
                    <img
                        src={image}
                        alt=""
                        className="size-9 shrink-0 rounded-md object-cover"
                    />
                ) : (
                    <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md [&>svg]:size-4">
                        <UsersIcon className="text-muted-foreground" />
                    </span>
                )}
                <span className="min-w-0 flex-1 overflow-hidden">
                    <span className="block truncate leading-snug font-medium">
                        {label || '\u2014'}
                    </span>
                    <span className="text-muted-foreground inline-flex max-w-full items-center truncate text-xs [&>svg]:size-3.5">
                        {group?.isRepresenting || group?.is_representing ? (
                            <TagIcon
                                className="mr-1.5 shrink-0"
                                aria-label={t('dialog.group.info.representing')}
                            />
                        ) : null}
                        {visibility !== 'visible' ? (
                            <EyeIcon
                                className="mr-1.5 shrink-0"
                                aria-label={visibilityLabel(visibility, t)}
                            />
                        ) : null}
                        <span className="truncate">({memberCount})</span>
                    </span>
                </span>
            </Button>
            {editable ? (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            className="ml-1 shrink-0"
                            disabled={busy}
                            title={t(
                                'dialog.user.generated.manage_group_membership'
                            )}
                            aria-label={t(
                                'dialog.user.generated.manage_group_membership'
                            )}
                        >
                            <SettingsIcon data-icon="inline-start" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {onMove ? (
                            <>
                                <DropdownMenuGroup>
                                    <DropdownMenuItem
                                        onSelect={() =>
                                            void onMove(group, 'top')
                                        }
                                    >
                                        <DownloadIcon className="rotate-180" />
                                        {t('dialog.user.generated.move_top')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onSelect={() =>
                                            void onMove(group, 'up')
                                        }
                                    >
                                        <ArrowUpIcon />
                                        {t('dialog.user.generated.move_up')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onSelect={() =>
                                            void onMove(group, 'down')
                                        }
                                    >
                                        <ArrowDownIcon />
                                        {t('dialog.user.generated.move_down')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onSelect={() =>
                                            void onMove(group, 'bottom')
                                        }
                                    >
                                        <DownloadIcon />
                                        {t('dialog.user.generated.move_bottom')}
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                                <DropdownMenuSeparator />
                            </>
                        ) : null}
                        <DropdownMenuGroup>
                            <DropdownMenuRadioGroup
                                value={visibilityValue}
                                onValueChange={(value) =>
                                    onVisibilityChange?.(group, value)
                                }
                            >
                                <DropdownMenuRadioItem value="visible">
                                    {t(
                                        'dialog.user.generated.visibility_everyone'
                                    )}
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="friends">
                                    {t(
                                        'dialog.user.generated.visibility_friends'
                                    )}
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="hidden">
                                    {t(
                                        'dialog.user.generated.visibility_hidden'
                                    )}
                                </DropdownMenuRadioItem>
                            </DropdownMenuRadioGroup>
                            <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => onLeave?.(group)}
                            >
                                <LogOutIcon />
                                {t('dialog.user.generated.leave_group')}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : null}
        </div>
    );
}
