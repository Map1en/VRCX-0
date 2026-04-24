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
    SettingsIcon,
    Share2Icon,
    ShieldIcon,
    ShieldOffIcon,
    TicketIcon,
    UserIcon,
    UsersIcon,
    XIcon
} from 'lucide-react';

import { useTranslation } from 'react-i18next';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

import {
    EntityActionDropdown,
    EntityActionItem,
    EntityActionSeparator,
    EntityDialogHeader
} from '../EntityDialogScaffold.jsx';
import { GroupTitleLanguages } from './GroupDialogViewParts.jsx';

export function GroupDialogHeaderSection({ state, handlers }) {
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
        memberStatus,
        memberVisibility,
        ownerLinkLabel,
        remoteStatus,
        showMembershipBadge,
        showPrivacyBadge
    } = state;
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
    } = handlers;

    return (
        <EntityDialogHeader
            imageUrl={iconUrl}
            imageAlt={group.name || 'Group'}
            imageClassName="size-32"
            imagePlaceholder={<UsersIcon className="text-muted-foreground size-8" />}
            onImageClick={iconUrl ? onPreviewIcon : null}
            title={groupTitle}
            onTitleClick={group.name ? onCopyGroupName : undefined}
            titleMeta={<GroupTitleLanguages languages={languageRows} />}
            subtitle={
                group.shortCode && group.discriminator
                    ? `${group.shortCode}.${group.discriminator}`
                    : group.url || ''
            }
            description={group.description}
            detail={
                group.ownerId || detail ? (
                    <div className="flex flex-col items-start gap-1">
                        {group.ownerId ? (
                            <Button
                                type="button"
                                variant="ghost"
                                className="text-muted-foreground hover:text-primary h-auto justify-start gap-1 p-0 text-xs font-normal"
                                title={t(
                                    'dialog.group.generated.open_group_owner_profile'
                                )}
                                onClick={onOpenOwner}
                            >
                                <UserIcon data-icon="inline-start" />
                                {t('dialog.group.generated.owner')}{' '}
                                {ownerLinkLabel}
                            </Button>
                        ) : null}
                        {detail ? (
                            <span>
                                {userFacingErrorMessage(
                                    detail,
                                    'Failed to load group details.'
                                )}
                            </span>
                        ) : null}
                    </div>
                ) : null
            }
            badges={
                <>
                    {showPrivacyBadge ? (
                        <Badge variant="outline">
                            <ShieldIcon data-icon="inline-start" />
                            {group.privacy}
                        </Badge>
                    ) : null}
                    {showMembershipBadge ? (
                        <Badge variant="secondary">
                            {group.membershipStatus}
                        </Badge>
                    ) : null}
                    {group.isVerified ? (
                        <Badge>
                            <BadgeCheckIcon data-icon="inline-start" />
                            {t('dialog.group.tags.verified')}
                        </Badge>
                    ) : null}
                    <Badge variant="outline">
                        <UsersIcon data-icon="inline-start" />
                        {group.memberCount} {t('dialog.group.generated.members')}
                    </Badge>
                    {group.onlineMemberCount > 0 ? (
                        <Badge variant="outline">
                            <UsersIcon data-icon="inline-start" />
                            {group.onlineMemberCount}{' '}
                            {t('dashboard.widget.feed_online')}
                        </Badge>
                    ) : null}
                </>
            }
            actions={
                <>
                    {memberStatus === 'requested' ? (
                        <Button
                            type="button"
                            size="icon-lg"
                            variant="outline"
                            className="rounded-full"
                            aria-label="Cancel join request"
                            disabled={actionStatus === 'cancel-request'}
                            onClick={onCancelRequest}
                        >
                            <XIcon data-icon="inline-start" />
                        </Button>
                    ) : !isMember ? (
                        <Button
                            type="button"
                            size="icon-lg"
                            className="rounded-full"
                            aria-label="Join group"
                            disabled={!canJoin || actionStatus === 'join'}
                            onClick={onJoin}
                        >
                            <LogInIcon data-icon="inline-start" />
                        </Button>
                    ) : null}
                    <EntityActionDropdown busy={actionStatus !== 'idle'}>
                        <EntityActionItem
                            icon={RefreshCwIcon}
                            disabled={actionStatus === 'refresh'}
                            onSelect={onRefresh}
                        >
                            {t('common.actions.refresh')}
                        </EntityActionItem>
                        {groupUrl ? (
                            <>
                                <EntityActionItem
                                    icon={Share2Icon}
                                    onSelect={() => void onCopyGroupUrl()}
                                >
                                    {t('dialog.group.generated.share_copy_url')}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={ExternalLinkIcon}
                                    onSelect={onOpenGroupPage}
                                >
                                    {t('dialog.group.generated.open_group_page')}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={CopyIcon}
                                    onSelect={() => void onCopyGroupId()}
                                >
                                    {t('dialog.group.generated.copy_group_id')}
                                </EntityActionItem>
                            </>
                        ) : null}
                        {isMember ? (
                            <>
                                <EntityActionSeparator />
                                <EntityActionItem
                                    icon={ShieldIcon}
                                    disabled={
                                        actionStatus === 'represent' ||
                                        isPrivateGroup
                                    }
                                    onSelect={onRepresentToggle}
                                >
                                    {isRepresenting
                                        ? 'Unrepresent Group'
                                        : 'Represent Group'}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={
                                        isSubscribedToAnnouncements
                                            ? BellOffIcon
                                            : BellIcon
                                    }
                                    disabled={actionStatus === 'member-props'}
                                    onSelect={onSubscribeToggle}
                                >
                                    {isSubscribedToAnnouncements
                                        ? 'Unsubscribe Announcements'
                                        : 'Subscribe Announcements'}
                                </EntityActionItem>
                                {canInviteToGroup ? (
                                    <EntityActionItem
                                        icon={MessageSquareIcon}
                                        disabled={
                                            remoteStatus.members === 'running'
                                        }
                                        onSelect={() =>
                                            void onInviteUserToGroup()
                                        }
                                    >
                                        {t(
                                            'dialog.group.generated.invite_to_group'
                                        )}
                                    </EntityActionItem>
                                ) : null}
                                {canManagePosts ? (
                                    <EntityActionItem
                                        icon={TicketIcon}
                                        disabled={
                                            remoteStatus.posts === 'running'
                                        }
                                        onSelect={() => void onCreateGroupPost()}
                                    >
                                        {t(
                                            'dialog.group.generated.create_post'
                                        )}
                                    </EntityActionItem>
                                ) : null}
                                {canModerateGroup ? (
                                    <EntityActionItem
                                        icon={SettingsIcon}
                                        onSelect={onOpenModeration}
                                    >
                                        {t(
                                            'dialog.group.generated.moderation_tools'
                                        )}
                                    </EntityActionItem>
                                ) : null}
                                {canSetVisibility ? (
                                    <>
                                        <EntityActionSeparator />
                                        <EntityActionItem
                                            icon={UserIcon}
                                            disabled={
                                                actionStatus === 'member-props'
                                            }
                                            onSelect={() =>
                                                onVisibilityChange('visible')
                                            }
                                        >
                                            {memberVisibility === 'visible'
                                                ? 'Selected: '
                                                : ''}
                                            {t(
                                                'dialog.group.actions.visibility_everyone'
                                            )}
                                        </EntityActionItem>
                                        <EntityActionItem
                                            icon={UserIcon}
                                            disabled={
                                                actionStatus === 'member-props'
                                            }
                                            onSelect={() =>
                                                onVisibilityChange('friends')
                                            }
                                        >
                                            {memberVisibility === 'friends'
                                                ? 'Selected: '
                                                : ''}
                                            {t(
                                                'dialog.group.actions.visibility_friends'
                                            )}
                                        </EntityActionItem>
                                        <EntityActionItem
                                            icon={UserIcon}
                                            disabled={
                                                actionStatus === 'member-props'
                                            }
                                            onSelect={() =>
                                                onVisibilityChange('hidden')
                                            }
                                        >
                                            {memberVisibility === 'hidden'
                                                ? 'Selected: '
                                                : ''}
                                            {t(
                                                'dialog.group.actions.visibility_hidden'
                                            )}
                                        </EntityActionItem>
                                    </>
                                ) : null}
                                <EntityActionSeparator />
                                <EntityActionItem
                                    icon={LogOutIcon}
                                    destructive
                                    disabled={actionStatus === 'leave'}
                                    onSelect={onLeave}
                                >
                                    {t('dialog.group.generated.leave_group')}
                                </EntityActionItem>
                            </>
                        ) : (
                            <>
                                <EntityActionSeparator />
                                <EntityActionItem
                                    icon={isBlocked ? ShieldIcon : ShieldOffIcon}
                                    destructive={isBlocked}
                                    disabled={actionStatus === 'block'}
                                    onSelect={onBlockToggle}
                                >
                                    {isBlocked
                                        ? 'Unblock Group'
                                        : 'Block Group'}
                                </EntityActionItem>
                            </>
                        )}
                    </EntityActionDropdown>
                </>
            }
        />
    );
}
