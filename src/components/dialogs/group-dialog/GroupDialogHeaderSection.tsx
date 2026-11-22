import {
    BadgeCheckIcon,
    BellIcon,
    BellOffIcon,
    CalendarPlusIcon,
    CopyIcon,
    CrownIcon,
    ExternalLinkIcon,
    ImageIcon,
    KeyRoundIcon,
    LogInIcon,
    LogOutIcon,
    MessageSquareIcon,
    PencilIcon,
    RefreshCwIcon,
    SettingsIcon,
    Share2Icon,
    ShieldIcon,
    ShieldOffIcon,
    TagIcon,
    TicketIcon,
    Trash2Icon,
    UserIcon,
    UsersRoundIcon,
    XIcon
} from 'lucide-react';
import {
    isValidElement,
    type ComponentProps,
    type ComponentType,
    type ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';

import type { GroupProfileRecord } from '@/domain/entities/group';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import type { GroupMemberVisibility } from '@/platform/tauri/bindings';
import { HintTooltip } from '@/ui/hint-tooltip';
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
    EntityFactAction,
    EntityFactList,
    EntityFactRow,
    EntityFactValue,
    EntityLinkFactRow,
    EntityOverviewCard
} from '../EntityDialogScaffold';
import type { GroupActionStatus } from './groupDialogTypes';
import { groupValueLabel } from './groupDialogUtils';
import { GroupTitleLanguages } from './GroupDialogViewParts';
import { SavedGroupFavoriteButton } from './SavedGroupFavoriteButton';

interface GroupHeaderModel {
    actionStatus: GroupActionStatus;
    canDelete: boolean;
    canInviteToGroup: boolean;
    canEditProfile: boolean;
    canJoin: boolean;
    canLeave: boolean;
    canManageCalendar: boolean;
    canManagePosts: boolean;
    canManageRoles: boolean;
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
    postsLoading: boolean;
}

interface GroupHeaderCommands {
    onBlockToggle: () => void;
    onCancelRequest: () => void;
    onCopyGroupId: () => void;
    onCopyGroupName: () => void;
    onCopyGroupUrl: () => void;
    onCreateGroupEvent: () => void;
    onOpenRoles: () => void;
    onCreateGroupPost: () => void;
    onDelete: () => void;
    onEditProfile: () => void;
    onEditProfileMedia: () => void;
    onJoin: () => void;
    onLeave: () => void;
    onOpenGroupPage: () => void;
    onOpenLink: (url: string) => void;
    onCopyLink: (url: string) => void;
    onOpenModeration: () => void;
    onOpenOwner: () => void;
    onPreviewIcon: () => void;
    onRefresh: () => void;
    onRepresentToggle: () => void;
    onSubscribeToggle: () => void;
    onInviteUserToGroup: () => void;
    onVisibilityChange: (visibility: GroupMemberVisibility) => void;
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
        canDelete,
        canInviteToGroup,
        canEditProfile,
        canJoin,
        canLeave,
        canManageCalendar,
        canManagePosts,
        canManageRoles,
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
        postsLoading
    } = model;
    const {
        onBlockToggle,
        onCancelRequest,
        onCopyGroupId,
        onCopyGroupName,
        onCopyGroupUrl,
        onCreateGroupEvent,
        onCreateGroupPost,
        onOpenRoles,
        onDelete,
        onEditProfile,
        onEditProfileMedia,
        onJoin,
        onLeave,
        onOpenGroupPage,
        onOpenLink,
        onCopyLink,
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

    const groupLinks = Array.isArray(group.links) ? group.links : [];
    const notableJoinState = Boolean(joinState) && joinState !== 'open';
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
                            <UsersRoundIcon />
                        </AvatarFallback>
                    </Avatar>
                </Button>
            }
        >
            <div className="flex min-w-0 flex-col gap-1.5">
                <CardTitle className="flex min-w-0 flex-wrap items-center gap-1.5 text-lg leading-tight">
                    {group.name ? (
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="h-auto min-w-0 flex-1 justify-start overflow-hidden p-0 text-left text-lg leading-tight font-semibold whitespace-normal hover:bg-transparent"
                                        onClick={onCopyGroupName}
                                    >
                                        <span className="line-clamp-2 min-w-0 text-balance break-words">
                                            {groupTitle}
                                        </span>
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
                </CardTitle>
                {subtitle ? (
                    <div className="text-muted-foreground font-mono text-xs break-all">
                        {subtitle}
                    </div>
                ) : null}
                <GroupTitleLanguages languages={languageRows} />
                {group.ownerId ? (
                    <span className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs">
                        <HintTooltip label={t('dialog.group.label.owner_2')}>
                            <span
                                role="img"
                                aria-label={t('dialog.group.label.owner_2')}
                                className="inline-flex shrink-0"
                            >
                                <CrownIcon className="size-3.5 opacity-70" />
                            </span>
                        </HintTooltip>
                        <button
                            type="button"
                            className="hover:text-foreground focus-visible:text-foreground min-w-0 cursor-pointer truncate text-left transition-colors outline-none"
                            title={t(
                                'dialog.group.action.open_group_owner_profile'
                            )}
                            onClick={onOpenOwner}
                        >
                            {ownerLinkLabel}
                        </button>
                    </span>
                ) : null}
            </div>
            <div className="flex items-center gap-2">
                <Button
                    type="button"
                    size="lg"
                    className="min-w-0 flex-1"
                    variant={primaryAction.variant}
                    disabled={primaryAction.disabled}
                    onClick={primaryAction.onClick}
                >
                    <PrimaryIcon data-icon="inline-start" />
                    <span className="truncate">{primaryAction.label}</span>
                </Button>
                {group.id ? (
                    <SavedGroupFavoriteButton groupId={group.id} />
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
                            {canEditProfile ? (
                                <>
                                    <EntityActionItem
                                        icon={PencilIcon}
                                        disabled={actionStatus === 'profile'}
                                        onClick={onEditProfile}
                                    >
                                        {t('dialog.group.actions.edit_profile')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={ImageIcon}
                                        disabled={actionStatus === 'profile'}
                                        onClick={onEditProfileMedia}
                                    >
                                        {t(
                                            'dialog.group.actions.edit_profile_media'
                                        )}
                                    </EntityActionItem>
                                </>
                            ) : null}
                            {canInviteToGroup ? (
                                <EntityActionItem
                                    icon={MessageSquareIcon}
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
                                    disabled={postsLoading}
                                    onClick={() => {
                                        onCreateGroupPost();
                                    }}
                                >
                                    {t('dialog.group.actions.create_post')}
                                </EntityActionItem>
                            ) : null}
                            {canManageCalendar ? (
                                <EntityActionItem
                                    icon={CalendarPlusIcon}
                                    onClick={onCreateGroupEvent}
                                >
                                    {t('dialog.group.actions.create_event')}
                                </EntityActionItem>
                            ) : null}
                            <EntityActionItem
                                icon={KeyRoundIcon}
                                onClick={onOpenRoles}
                            >
                                {t(
                                    canManageRoles
                                        ? 'dialog.group.actions.manage_roles'
                                        : 'dialog.group.actions.view_roles'
                                )}
                            </EntityActionItem>
                            {canModerateGroup ? (
                                <EntityActionItem
                                    icon={SettingsIcon}
                                    onClick={onOpenModeration}
                                >
                                    {t('dialog.group.actions.moderation_tools')}
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
                            {canLeave || canDelete ? (
                                <>
                                    <EntityActionSeparator />
                                    <EntityActionItem
                                        icon={
                                            canDelete ? Trash2Icon : LogOutIcon
                                        }
                                        destructive
                                        disabled={
                                            actionStatus === 'leave' ||
                                            actionStatus === 'delete'
                                        }
                                        onClick={canDelete ? onDelete : onLeave}
                                    >
                                        {t(
                                            canDelete
                                                ? 'dialog.group.actions.delete'
                                                : 'dialog.group.actions.leave'
                                        )}
                                    </EntityActionItem>
                                </>
                            ) : null}
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

            {group.isVerified || notableJoinState ? (
                <div className="flex flex-wrap gap-1.5">
                    {group.isVerified ? (
                        <Badge
                            variant="outline"
                            className="text-muted-foreground font-normal"
                        >
                            <BadgeCheckIcon data-icon="inline-start" />
                            {t('dialog.group.tags.verified')}
                        </Badge>
                    ) : null}
                    {notableJoinState ? (
                        <Badge
                            variant="outline"
                            className="text-muted-foreground font-normal"
                        >
                            {groupValueLabel(t, 'join_state', joinState)}
                        </Badge>
                    ) : null}
                </div>
            ) : null}

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
                    value={groupValueLabel(t, 'privacy', group.privacy)}
                />
                <GroupRailMetric
                    label={t('dialog.group.label.membership')}
                    value={groupValueLabel(
                        t,
                        'membership',
                        memberStatus || group.membershipStatus
                    )}
                />
            </div>

            {group.id ? (
                <EntityFactList className="border-t pt-3">
                    {groupUrl ? (
                        <EntityFactRow label={t('dialog.group.info.url')}>
                            <EntityFactValue
                                display={groupUrl.replace(/^https?:\/\//, '')}
                                title={groupUrl}
                            >
                                <EntityFactAction
                                    label={t('common.actions.open_link')}
                                    icon={ExternalLinkIcon}
                                    onClick={onOpenGroupPage}
                                />
                                <EntityFactAction
                                    label={t('common.actions.copy')}
                                    icon={CopyIcon}
                                    onClick={onCopyGroupUrl}
                                />
                            </EntityFactValue>
                        </EntityFactRow>
                    ) : null}
                    <EntityFactRow label={t('dialog.group.info.id')}>
                        <EntityFactValue
                            display={`${group.id.slice(0, 12)}\u2026${group.id.slice(-4)}`}
                            title={group.id}
                        >
                            <EntityFactAction
                                label={t('dialog.group.info.id_tooltip')}
                                icon={CopyIcon}
                                onClick={onCopyGroupId}
                            />
                        </EntityFactValue>
                    </EntityFactRow>
                    {groupLinks.map((link) => (
                        <EntityLinkFactRow
                            key={link}
                            link={link}
                            onOpen={onOpenLink}
                            onCopy={onCopyLink}
                        />
                    ))}
                </EntityFactList>
            ) : null}

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
