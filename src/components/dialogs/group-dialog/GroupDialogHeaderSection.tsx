import {
    BadgeCheckIcon,
    BellIcon,
    BellOffIcon,
    CopyIcon,
    ExternalLinkIcon,
    LogInIcon,
    LogOutIcon,
    MessageSquareIcon,
    RefreshCwIcon,
    Share2Icon,
    ShieldIcon,
    ShieldOffIcon,
    ShieldUserIcon,
    TagIcon,
    TicketIcon,
    UserIcon,
    UsersIcon,
    XIcon
} from 'lucide-react';
import {
    isValidElement,
    type ComponentProps,
    type ComponentType,
    type ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';

import type { GroupProfileRecord } from '@/domain/entities/profileEntities';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { CardTitle } from '@/ui/shadcn/card';
import { DropdownMenuCheckboxItem } from '@/ui/shadcn/dropdown-menu';
import { Separator } from '@/ui/shadcn/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    EntityActionDropdown,
    EntityActionItem,
    EntityActionSeparator,
    EntityActionSub,
    EntityOverviewCard
} from '../EntityDialogScaffold';
import type { GroupRemoteStatus } from './groupDialogTypes';
import { GroupTitleLanguages } from './GroupDialogViewParts';

interface GroupHeaderModel {
    actionStatus: string;
    canInviteToGroup: boolean;
    canJoin: boolean;
    canManagePosts: boolean;
    canModerateGroup: boolean;
    canSetVisibility: boolean;
    detail: string;
    group: GroupProfileRecord;
    groupTitle: string;
    groupUrl: string;
    iconUrl: string;
    isBlocked: boolean;
    isMember: boolean;
    isPrivateGroup: boolean;
    isRepresenting: boolean;
    isSubscribedToAnnouncements: boolean;
    languageRows: { key: string; value: string }[];
    joinState: string;
    memberStatus: string;
    memberVisibility: string;
    ownerLinkLabel: string;
    remoteStatus: GroupRemoteStatus;
    showMembershipBadge: boolean;
    showPrivacyBadge: boolean;
}

interface GroupHeaderCommands {
    onBlockToggle: () => void;
    onCancelRequest: () => void;
    onCopyGroupId: () => void;
    onCopyGroupName: () => void;
    onCopyGroupUrl: () => void;
    onCreateGroupPost: () => void;
    onJoin: () => void;
    onLeave: () => void;
    onOpenGroupPage: () => void;
    onOpenModeration: () => void;
    onOpenOwner: () => void;
    onPreviewIcon: () => void;
    onRefresh: () => void;
    onRepresentToggle: () => void;
    onSubscribeToggle: () => void;
    onInviteUserToGroup: () => void;
    onVisibilityChange: (visibility: string) => void;
}

function GroupRailMetric({
    label,
    value
}: {
    label: ReactNode;
    value: ReactNode;
}) {
    return (
        <div className="min-w-0">
            <div className="text-muted-foreground truncate text-xs">
                {label}
            </div>
            <div className="truncate text-sm font-medium tabular-nums">
                {value ?? '—'}
            </div>
        </div>
    );
}

export function GroupDialogHeaderSection({
    headerModel: model,
    headerCommands: commands
}: {
    headerModel: GroupHeaderModel;
    headerCommands: GroupHeaderCommands;
}) {
    const { t } = useTranslation();

    const {
        actionStatus,
        canInviteToGroup,
        canJoin,
        canManagePosts,
        canModerateGroup,
        canSetVisibility,
        detail,
        group,
        groupTitle,
        groupUrl,
        iconUrl,
        isBlocked,
        isMember,
        isPrivateGroup,
        isRepresenting,
        isSubscribedToAnnouncements,
        languageRows,
        joinState,
        memberStatus,
        memberVisibility,
        ownerLinkLabel,
        remoteStatus,
        showMembershipBadge,
        showPrivacyBadge
    } = model;
    const {
        onBlockToggle,
        onCancelRequest,
        onCopyGroupId,
        onCopyGroupName,
        onCopyGroupUrl,
        onCreateGroupPost,
        onJoin,
        onLeave,
        onOpenGroupPage,
        onOpenModeration,
        onOpenOwner,
        onPreviewIcon,
        onRefresh,
        onRepresentToggle,
        onSubscribeToggle,
        onInviteUserToGroup,
        onVisibilityChange
    } = commands;

    const subtitle =
        group.shortCode && group.discriminator
            ? `${group.shortCode}.${group.discriminator}`
            : group.url || '';
    const primaryAction: {
        icon: ComponentType;
        label: string;
        disabled: boolean;
        onClick: () => void;
        variant: ComponentProps<typeof Button>['variant'];
    } =
        memberStatus === 'requested'
            ? {
                  icon: XIcon,
                  label: t('dialog.group.actions.cancel_join_request_tooltip'),
                  disabled: actionStatus === 'cancel-request',
                  onClick: onCancelRequest,
                  variant: 'outline'
              }
            : !isMember
              ? {
                    icon: LogInIcon,
                    label: t('dialog.group.actions.join_group_tooltip'),
                    disabled: !canJoin || actionStatus === 'join',
                    onClick: onJoin,
                    variant: 'default'
                }
              : {
                    icon: TagIcon,
                    label: t(
                        isRepresenting
                            ? 'dialog.group.actions.unrepresent_tooltip'
                            : 'dialog.group.actions.represent_tooltip'
                    ),
                    disabled:
                        actionStatus === 'represent' ||
                        (!isRepresenting && isPrivateGroup),
                    onClick: onRepresentToggle,
                    variant: isRepresenting ? 'secondary' : 'outline'
                };
    const PrimaryIcon = primaryAction.icon;

    return (
        <EntityOverviewCard
            media={
                <Button
                    type="button"
                    variant="ghost"
                    disabled={!iconUrl || !onPreviewIcon}
                    onClick={iconUrl ? onPreviewIcon : undefined}
                    className="bg-muted mx-auto aspect-square h-auto w-full max-w-64 overflow-hidden rounded-lg border p-0 disabled:pointer-events-none disabled:opacity-100"
                >
                    <Avatar className="size-full rounded-lg after:rounded-lg">
                        {iconUrl ? (
                            <AvatarImage
                                src={iconUrl}
                                alt={group.name || 'Group'}
                                className="rounded-lg object-cover"
                            />
                        ) : null}
                        <AvatarFallback className="rounded-lg [&>svg]:size-10">
                            <UsersIcon />
                        </AvatarFallback>
                    </Avatar>
                </Button>
            }
        >
            <div className="flex min-w-0 items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <CardTitle className="flex min-w-0 flex-wrap items-center gap-1.5 text-lg leading-tight">
                        {group.name ? (
                            <Tooltip>
                                <TooltipTrigger
                                    render={
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            className="hover:text-primary h-auto min-w-0 justify-start p-0 text-left text-lg leading-tight font-semibold break-words whitespace-normal"
                                            onClick={onCopyGroupName}
                                        >
                                            {groupTitle}
                                        </Button>
                                    }
                                />
                                <TooltipContent>
                                    {t('common.actions.copy')}
                                </TooltipContent>
                            </Tooltip>
                        ) : (
                            <span className="min-w-0 break-words">
                                {groupTitle}
                            </span>
                        )}
                        <GroupTitleLanguages
                            languages={languageRows}
                            limit={2}
                        />
                    </CardTitle>
                    {subtitle ? (
                        <div className="text-muted-foreground font-mono text-xs break-all">
                            {subtitle}
                        </div>
                    ) : null}
                    {group.ownerId ? (
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="text-muted-foreground hover:text-primary h-auto max-w-full justify-start gap-1 p-0 text-xs font-normal"
                                        onClick={onOpenOwner}
                                    >
                                        <UserIcon data-icon="inline-start" />
                                        <span className="truncate">
                                            {t('dialog.group.label.owner')}{' '}
                                            {ownerLinkLabel}
                                        </span>
                                    </Button>
                                }
                            />
                            <TooltipContent>
                                {t(
                                    'dialog.group.action.open_group_owner_profile'
                                )}
                            </TooltipContent>
                        </Tooltip>
                    ) : null}
                </div>
                {canModerateGroup ? (
                    <Button
                        type="button"
                        size="lg"
                        variant="outline"
                        onClick={onOpenModeration}
                    >
                        <ShieldUserIcon data-icon="inline-start" />
                        {t('dialog.group.actions.moderation_tools')}
                    </Button>
                ) : null}
                <EntityActionDropdown busy={actionStatus !== 'idle'}>
                    <EntityActionItem
                        icon={RefreshCwIcon}
                        disabled={actionStatus === 'refresh'}
                        onClick={onRefresh}
                    >
                        {t('common.actions.refresh')}
                    </EntityActionItem>
                    {groupUrl ? (
                        <>
                            <EntityActionItem
                                icon={Share2Icon}
                                onClick={() => {
                                    onCopyGroupUrl();
                                }}
                            >
                                {t('dialog.group.actions.share')}
                            </EntityActionItem>
                            <EntityActionItem
                                icon={ExternalLinkIcon}
                                onClick={onOpenGroupPage}
                            >
                                {t('common.actions.open_link')}
                            </EntityActionItem>
                            <EntityActionItem
                                icon={CopyIcon}
                                onClick={() => {
                                    onCopyGroupId();
                                }}
                            >
                                {t('dialog.group.info.id_tooltip')}
                            </EntityActionItem>
                        </>
                    ) : null}
                    {isMember ? (
                        <>
                            <EntityActionSeparator />
                            <EntityActionItem
                                icon={TagIcon}
                                disabled={
                                    actionStatus === 'represent' ||
                                    isPrivateGroup
                                }
                                onClick={onRepresentToggle}
                            >
                                {t(
                                    isRepresenting
                                        ? 'dialog.group.actions.unrepresent_tooltip'
                                        : 'dialog.group.actions.represent_tooltip'
                                )}
                            </EntityActionItem>
                            <EntityActionItem
                                icon={
                                    isSubscribedToAnnouncements
                                        ? BellOffIcon
                                        : BellIcon
                                }
                                disabled={actionStatus === 'member-props'}
                                onClick={onSubscribeToggle}
                            >
                                {t(
                                    isSubscribedToAnnouncements
                                        ? 'dialog.group.actions.unsubscribe'
                                        : 'dialog.group.actions.subscribe'
                                )}
                            </EntityActionItem>
                            {canInviteToGroup ? (
                                <EntityActionItem
                                    icon={MessageSquareIcon}
                                    disabled={
                                        remoteStatus.members === 'running'
                                    }
                                    onClick={() => {
                                        onInviteUserToGroup();
                                    }}
                                >
                                    {t('dialog.group.actions.invite_to_group')}
                                </EntityActionItem>
                            ) : null}
                            {canManagePosts ? (
                                <EntityActionItem
                                    icon={TicketIcon}
                                    disabled={remoteStatus.posts === 'running'}
                                    onClick={() => {
                                        onCreateGroupPost();
                                    }}
                                >
                                    {t('dialog.group.actions.create_post')}
                                </EntityActionItem>
                            ) : null}
                            {canSetVisibility ? (
                                <>
                                    <EntityActionSeparator />
                                    <EntityActionSub
                                        icon={UserIcon}
                                        label={t(
                                            'dialog.group.actions.visibility'
                                        )}
                                        disabled={
                                            actionStatus === 'member-props'
                                        }
                                    >
                                        <DropdownMenuCheckboxItem
                                            checked={
                                                memberVisibility === 'visible'
                                            }
                                            disabled={
                                                actionStatus === 'member-props'
                                            }
                                            onCheckedChange={(checked) => {
                                                if (checked) {
                                                    onVisibilityChange(
                                                        'visible'
                                                    );
                                                }
                                            }}
                                        >
                                            {t(
                                                'dialog.group.actions.visibility_everyone'
                                            )}
                                        </DropdownMenuCheckboxItem>
                                        <DropdownMenuCheckboxItem
                                            checked={
                                                memberVisibility === 'friends'
                                            }
                                            disabled={
                                                actionStatus === 'member-props'
                                            }
                                            onCheckedChange={(checked) => {
                                                if (checked) {
                                                    onVisibilityChange(
                                                        'friends'
                                                    );
                                                }
                                            }}
                                        >
                                            {t(
                                                'dialog.group.actions.visibility_friends'
                                            )}
                                        </DropdownMenuCheckboxItem>
                                        <DropdownMenuCheckboxItem
                                            checked={
                                                memberVisibility === 'hidden'
                                            }
                                            disabled={
                                                actionStatus === 'member-props'
                                            }
                                            onCheckedChange={(checked) => {
                                                if (checked) {
                                                    onVisibilityChange(
                                                        'hidden'
                                                    );
                                                }
                                            }}
                                        >
                                            {t(
                                                'dialog.group.actions.visibility_hidden'
                                            )}
                                        </DropdownMenuCheckboxItem>
                                    </EntityActionSub>
                                </>
                            ) : null}
                            <EntityActionSeparator />
                            <EntityActionItem
                                icon={LogOutIcon}
                                destructive
                                disabled={actionStatus === 'leave'}
                                onClick={onLeave}
                            >
                                {t('dialog.group.actions.leave')}
                            </EntityActionItem>
                        </>
                    ) : (
                        <>
                            <EntityActionSeparator />
                            <EntityActionItem
                                icon={isBlocked ? ShieldIcon : ShieldOffIcon}
                                destructive={isBlocked}
                                disabled={actionStatus === 'block'}
                                onClick={onBlockToggle}
                            >
                                {t(
                                    isBlocked
                                        ? 'dialog.group.actions.unblock'
                                        : 'dialog.group.actions.block'
                                )}
                            </EntityActionItem>
                        </>
                    )}
                </EntityActionDropdown>
            </div>

            <div className="flex flex-wrap gap-1.5">
                {showPrivacyBadge ? (
                    <Badge variant="outline">
                        <ShieldIcon data-icon="inline-start" />
                        {group.privacy}
                    </Badge>
                ) : null}
                {joinState ? (
                    <Badge variant="outline">{joinState}</Badge>
                ) : null}
                {showMembershipBadge ? (
                    <Badge variant="secondary">{group.membershipStatus}</Badge>
                ) : null}
                {group.isVerified ? (
                    <Badge>
                        <BadgeCheckIcon data-icon="inline-start" />
                        {t('dialog.group.tags.verified')}
                    </Badge>
                ) : null}
            </div>

            <Button
                type="button"
                className="w-full"
                variant={primaryAction.variant}
                disabled={primaryAction.disabled}
                onClick={primaryAction.onClick}
            >
                <PrimaryIcon data-icon="inline-start" />
                <span className="truncate">{primaryAction.label}</span>
            </Button>

            <Separator />

            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                <GroupRailMetric
                    label={t('dialog.group.info.members')}
                    value={group.memberCount}
                />
                <GroupRailMetric
                    label={t('dashboard.widget.feed_online')}
                    value={group.onlineMemberCount}
                />
                <GroupRailMetric
                    label={t('dialog.group.label.privacy')}
                    value={group.privacy}
                />
                <GroupRailMetric
                    label={t('dialog.group.label.membership')}
                    value={memberStatus || group.membershipStatus}
                />
            </div>

            {detail ? (
                <>
                    <Separator />
                    <div className="text-muted-foreground text-xs">
                        {isValidElement(detail)
                            ? detail
                            : userFacingErrorMessage(
                                  detail,
                                  t('dialog.group.error.failed_to_load_details')
                              )}
                    </div>
                </>
            ) : null}
        </EntityOverviewCard>
    );
}
