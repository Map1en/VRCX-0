// @ts-nocheck
import {
    DownloadIcon,
    ExternalLinkIcon,
    EyeIcon,
    ImageIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDateFilter } from '@/lib/dateTime.js';
import { convertFileUrlToImageUrl } from '@/lib/entityMedia.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    EntityDialogTabContent,
    EntityDialogTabs,
    EntityInfoBlock,
    EntityInfoGrid,
    EntityRawJson
} from '../EntityDialogScaffold';
import { PreviousInstancesPanel } from '../PreviousInstancesTableDialog';
import { GroupEventsTab, GroupEventSummary } from './GroupDialogEvents';
import {
    announcementRoleNames,
    announcementTimestamp,
    announcementUserId,
    announcementUserLabel,
    firstArray
} from './groupDialogUtils.js';
import { GroupInstanceRows } from './GroupInstanceRows';
import { RowList } from './GroupRowList';

function GroupBannerFallback() {
    return (
        <Skeleton className="text-muted-foreground flex aspect-[6/1] w-full items-center justify-center rounded-md">
            <ImageIcon className="size-6" />
        </Skeleton>
    );
}

function GroupOverviewSection({ title, action = null, children }) {
    return (
        <section className="bg-card/40 flex min-w-0 flex-col gap-2 rounded-md border p-3">
            <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="truncate text-sm font-medium">{title}</div>
                {action}
            </div>
            <div className="min-w-0">{children}</div>
        </section>
    );
}

function GroupAnnouncementPanel({ group, onPreviewImage, onOpenUser }) {
    const { t } = useTranslation();

    const announcement = group.announcement;
    const roleNames = announcementRoleNames(announcement, group);

    if (!announcement?.id && !announcement?.title) {
        return null;
    }

    return (
        <div className="min-w-0 text-sm">
            <span className="block truncate font-medium">
                {announcement.title || t('dialog.group.info.announcement')}
            </span>
            <div className="mt-1.5 flex min-w-0 items-start gap-2">
                {announcement.imageUrl ? (
                    <Button
                        type="button"
                        variant="ghost"
                        className="h-auto shrink-0 p-0"
                        aria-label={`Preview ${announcement.title || 'announcement'} image`}
                        onClick={() =>
                            onPreviewImage(
                                convertFileUrlToImageUrl(
                                    announcement.imageUrl,
                                    1024
                                ),
                                announcement.title ||
                                    t('dialog.group.info.announcement')
                            )
                        }
                    >
                        <img
                            src={convertFileUrlToImageUrl(
                                announcement.imageUrl,
                                128
                            )}
                            alt=""
                            className="size-16 rounded-md object-cover"
                        />
                    </Button>
                ) : null}
                <pre className="text-muted-foreground max-h-40 min-w-0 flex-1 overflow-auto font-sans text-xs whitespace-pre-wrap">
                    {announcement.text || '\u2014'}
                </pre>
            </div>
            <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                {roleNames.length ? (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Badge variant="outline" className="max-w-full">
                                <EyeIcon data-icon="inline-start" />
                                <span className="truncate">
                                    {roleNames.join(', ')}
                                </span>
                            </Badge>
                        </TooltipTrigger>
                        <TooltipContent>{roleNames.join(', ')}</TooltipContent>
                    </Tooltip>
                ) : null}
                {announcementUserId(announcement, 'author') ||
                announcementUserLabel(announcement, 'author') ? (
                    announcementUserId(announcement, 'author') ? (
                        <Button
                            type="button"
                            variant="ghost"
                            className="hover:text-primary h-auto gap-1 p-0 text-xs font-normal"
                            onClick={() =>
                                onOpenUser(
                                    announcementUserId(announcement, 'author'),
                                    announcementUserLabel(
                                        announcement,
                                        'author'
                                    ) || undefined
                                )
                            }
                        >
                            <span>{t('table.import.author')}</span>
                            <span className="text-foreground font-medium">
                                {announcementUserLabel(
                                    announcement,
                                    'author'
                                ) || announcementUserId(announcement, 'author')}
                            </span>
                        </Button>
                    ) : (
                        <span className="inline-flex items-center gap-1">
                            <span>{t('table.import.author')}</span>
                            <span className="text-foreground font-medium">
                                {announcementUserLabel(announcement, 'author')}
                            </span>
                        </span>
                    )
                ) : null}
                {announcementUserId(announcement, 'editor') ||
                announcementUserLabel(announcement, 'editor') ? (
                    announcementUserId(announcement, 'editor') ? (
                        <Button
                            type="button"
                            variant="ghost"
                            className="hover:text-primary h-auto gap-1 p-0 text-xs font-normal"
                            onClick={() =>
                                onOpenUser(
                                    announcementUserId(announcement, 'editor'),
                                    announcementUserLabel(
                                        announcement,
                                        'editor'
                                    ) || undefined
                                )
                            }
                        >
                            <span>{t('dialog.group.posts.edited_by')}</span>
                            <span className="text-foreground font-medium">
                                {announcementUserLabel(
                                    announcement,
                                    'editor'
                                ) || announcementUserId(announcement, 'editor')}
                            </span>
                        </Button>
                    ) : (
                        <span className="inline-flex items-center gap-1">
                            <span>{t('dialog.group.posts.edited_by')}</span>
                            <span className="text-foreground font-medium">
                                {announcementUserLabel(announcement, 'editor')}
                            </span>
                        </span>
                    )
                ) : null}
                {announcement.createdAt ? (
                    <span className="inline-flex items-center gap-1">
                        <span>{t('dialog.group.posts.created_at')}</span>
                        <span className="text-foreground font-medium">
                            {announcementTimestamp(announcement.createdAt)}
                        </span>
                    </span>
                ) : null}
                {announcement.updatedAt ? (
                    <span className="inline-flex items-center gap-1">
                        <span>{t('dialog.group.posts.edited_at')}</span>
                        <span className="text-foreground font-medium">
                            {announcementTimestamp(announcement.updatedAt)}
                        </span>
                    </span>
                ) : null}
            </div>
        </div>
    );
}

export function GroupDialogTabPanels({ state, handlers }) {
    const { t } = useTranslation();

    const {
        activeInstances,
        activeTab,
        bannerUrl,
        canManagePosts,
        currentUserId,
        filteredMembers,
        filteredPosts,
        group,
        groupEvents,
        groupEventsError,
        groupEventsStatus,
        groupTitle,
        groupUrl,
        joinState,
        memberRoleId,
        memberSort,
        memberStatus,
        ownerLabel,
        photos,
        posts,
        previousInstances,
        remoteErrors,
        remoteStatus,
        search,
        tabs
    } = state;
    const {
        onChangeTab,
        onDeletePost,
        onDownloadMembersJson,
        onEditPost,
        onLoadAllMembers,
        onMemberRoleChange,
        onMemberSortChange,
        onOpenLink,
        onOpenOwner,
        onOpenUser,
        onPreviousInstancesChange,
        onPreviewImage,
        onPreviewRowImage,
        onRefreshEvents,
        onRefreshMembers,
        onSearchMembersChange,
        onSearchPostsChange,
        onToggleEventFollow
    } = handlers;
    const members = filteredMembers.source || [];
    const memberRows = filteredMembers.rows || [];
    const languages = Array.isArray(group.languages) ? group.languages : [];
    const links = Array.isArray(group.links) ? group.links : [];
    const tags = Array.isArray(group.tags) ? group.tags : [];
    const roles = Array.isArray(group.roles) ? group.roles : [];
    const [bannerFailed, setBannerFailed] = useState(false);

    useEffect(() => {
        setBannerFailed(false);
    }, [bannerUrl]);

    return (
        <EntityDialogTabs
            value={activeTab}
            onValueChange={onChangeTab}
            tabs={tabs}
        >
            <EntityDialogTabContent
                value="overview"
                className="flex flex-col gap-4 px-px pt-3 pb-px"
            >
                {bannerUrl && !bannerFailed ? (
                    <Button
                        type="button"
                        variant="ghost"
                        className="bg-muted h-auto w-full overflow-hidden rounded-md p-0"
                        aria-label={t('dialog.group.overview.preview_banner', {
                            value: groupTitle
                        })}
                        onClick={() => onPreviewImage(bannerUrl, groupTitle)}
                    >
                        <img
                            src={bannerUrl}
                            alt={group.name || 'Group banner'}
                            className="aspect-[6/1] w-full object-cover"
                            onError={() => setBannerFailed(true)}
                        />
                    </Button>
                ) : (
                    <GroupBannerFallback />
                )}

                {group.description ? (
                    <GroupOverviewSection
                        title={t('dialog.group.overview.description')}
                    >
                        <div className="text-muted-foreground max-h-32 overflow-auto text-sm whitespace-pre-wrap">
                            {group.description}
                        </div>
                    </GroupOverviewSection>
                ) : null}

                <GroupOverviewSection title={t('dialog.group.info.instances')}>
                    <GroupInstanceRows
                        instances={activeInstances}
                        currentUserId={currentUserId}
                    />
                </GroupOverviewSection>

                {group.announcement?.id || group.announcement?.title ? (
                    <GroupOverviewSection
                        title={t('dialog.group.info.announcement')}
                    >
                        <GroupAnnouncementPanel
                            group={group}
                            onPreviewImage={onPreviewImage}
                            onOpenUser={onOpenUser}
                        />
                    </GroupOverviewSection>
                ) : null}

                {group.rules ? (
                    <GroupOverviewSection title={t('dialog.group.info.rules')}>
                        <pre className="text-muted-foreground max-h-40 overflow-auto font-sans text-sm whitespace-pre-wrap">
                            {group.rules}
                        </pre>
                    </GroupOverviewSection>
                ) : null}

                <GroupOverviewSection
                    title={t('dialog.group.overview.recent_events')}
                    action={
                        <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() => onChangeTab('events')}
                        >
                            {t('dialog.group.overview.open_events')}
                        </Button>
                    }
                >
                    <GroupEventSummary
                        events={groupEvents}
                        status={groupEventsStatus}
                        error={groupEventsError}
                        group={group}
                        onOpenEvents={() => onChangeTab('events')}
                        t={t}
                    />
                </GroupOverviewSection>

                <GroupOverviewSection title={t('dialog.group.overview.basics')}>
                    <EntityInfoGrid className="px-0">
                        <EntityInfoBlock
                            label={t('dialog.group.info.members')}
                            value={`${group.memberCount || 0} (${group.onlineMemberCount || 0})`}
                        />
                        <EntityInfoBlock
                            label={t('dialog.group.info.created_at')}
                            value={
                                group.createdAt || group.created_at
                                    ? formatDateFilter(
                                          group.createdAt || group.created_at,
                                          'long'
                                      )
                                    : '—'
                            }
                        />
                        <EntityInfoBlock
                            label={t('dialog.group.info.last_visited')}
                            value={
                                previousInstances[0]?.created_at ||
                                previousInstances[0]?.createdAt
                                    ? formatDateFilter(
                                          previousInstances[0]?.created_at ||
                                              previousInstances[0]?.createdAt,
                                          'long'
                                      )
                                    : '—'
                            }
                            onClick={
                                previousInstances.length
                                    ? () => onChangeTab('instance-history')
                                    : undefined
                            }
                        />
                        <EntityInfoBlock
                            label={t('dialog.group.action.join_state')}
                            value={joinState || '—'}
                        />
                        <EntityInfoBlock
                            label={t('dialog.group.label.membership')}
                            value={
                                memberStatus || group.membershipStatus || '—'
                            }
                        />
                        <EntityInfoBlock
                            label={t('dialog.group.label.languages')}
                            value={languages.join(', ') || '—'}
                        />
                        <EntityInfoBlock
                            label={t('dialog.group.label.privacy')}
                            value={group.privacy || '—'}
                        />
                        {links.length ? (
                            <EntityInfoBlock
                                label={t('dialog.group.info.links')}
                                full
                            >
                                <div className="flex flex-wrap gap-1.5">
                                    {links.map((link) => (
                                        <Button
                                            key={link}
                                            type="button"
                                            variant="link"
                                            size="xs"
                                            className="h-auto max-w-full min-w-0 justify-start p-0 text-left break-all whitespace-normal"
                                            onClick={() => onOpenLink(link)}
                                        >
                                            <ExternalLinkIcon data-icon="inline-start" />
                                            <span className="min-w-0 break-all">
                                                {link}
                                            </span>
                                        </Button>
                                    ))}
                                </div>
                            </EntityInfoBlock>
                        ) : null}
                        <EntityInfoBlock
                            label="URL"
                            value={groupUrl || '—'}
                            mono
                            wide
                            onClick={
                                groupUrl ? handlers.onCopyGroupUrl : undefined
                            }
                        />
                        <EntityInfoBlock
                            label={t('dialog.group.info.id')}
                            value={group.id}
                            mono
                            wide
                        />
                        <EntityInfoBlock
                            label={t('dialog.group.label.owner_2')}
                            value={ownerLabel || '—'}
                            wide
                            onClick={group.ownerId ? onOpenOwner : undefined}
                        />
                        {tags.length ? (
                            <EntityInfoBlock
                                label={t('dialog.avatar.info.tags')}
                                full
                            >
                                <div className="flex flex-wrap gap-1.5">
                                    {tags.map((tag) => (
                                        <Badge key={tag} variant="outline">
                                            {tag}
                                        </Badge>
                                    ))}
                                </div>
                            </EntityInfoBlock>
                        ) : null}
                        {roles.length ? (
                            <EntityInfoBlock
                                label={t('dialog.group.info.roles')}
                                full
                            >
                                <div className="flex flex-wrap gap-1.5">
                                    {roles.map((role) => (
                                        <Badge
                                            key={role.id || role.name}
                                            variant="outline"
                                        >
                                            {role.name || 'Role'}
                                        </Badge>
                                    ))}
                                </div>
                            </EntityInfoBlock>
                        ) : null}
                    </EntityInfoGrid>
                </GroupOverviewSection>
            </EntityDialogTabContent>
            <EntityDialogTabContent
                value="events"
                className="flex flex-col gap-3 px-px pt-3 pb-px"
            >
                <GroupEventsTab
                    events={groupEvents}
                    status={groupEventsStatus}
                    error={groupEventsError}
                    group={group}
                    onRefresh={onRefreshEvents}
                    onToggleFollow={onToggleEventFollow}
                    t={t}
                />
            </EntityDialogTabContent>
            <EntityDialogTabContent
                value="instance-history"
                className="flex min-h-0 flex-col"
            >
                <PreviousInstancesPanel
                    title={t('dialog.previous_instances.header')}
                    instances={previousInstances}
                    variant="group"
                    targetRef={group}
                    onRowsChange={onPreviousInstancesChange}
                    className="flex-1"
                />
            </EntityDialogTabContent>
            <EntityDialogTabContent
                value="posts"
                className="flex flex-col gap-2"
            >
                <div className="flex items-center gap-2">
                    <div className="text-muted-foreground text-sm">
                        {filteredPosts.length}/{posts.length}{' '}
                        {t('dialog.group.posts.header')}
                    </div>
                    <Input
                        value={search.posts}
                        onChange={(event) =>
                            onSearchPostsChange(event.target.value)
                        }
                        placeholder={t('dialog.group.posts.search_placeholder')}
                        className="ml-auto h-8 max-w-64"
                    />
                </div>
                <RowList
                    rows={filteredPosts}
                    group={group}
                    kind="posts"
                    loading={remoteStatus.posts === 'running'}
                    error={remoteErrors.posts}
                    canManagePosts={canManagePosts}
                    onPreviewImage={onPreviewRowImage}
                    onEditPost={onEditPost}
                    onDeletePost={onDeletePost}
                />
            </EntityDialogTabContent>
            <EntityDialogTabContent
                value="members"
                className="flex flex-col gap-2"
            >
                <div className="flex flex-wrap items-center gap-2">
                    <div className="text-muted-foreground text-sm">
                        {memberRows.length}/
                        {group.memberCount || members.length}{' '}
                        {t('dialog.group.members.header')}
                    </div>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={remoteStatus.members === 'running'}
                        onClick={onRefreshMembers}
                    >
                        {t('common.actions.refresh')}
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={remoteStatus.members === 'running'}
                        onClick={onLoadAllMembers}
                    >
                        {t('dialog.group.action.load_all')}
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!members.length}
                        onClick={onDownloadMembersJson}
                    >
                        <DownloadIcon data-icon="inline-start" />
                        JSON
                    </Button>
                    <Select
                        value={memberSort}
                        onValueChange={onMemberSortChange}
                        disabled={remoteStatus.members === 'running'}
                    >
                        <SelectTrigger size="sm" className="w-44">
                            <SelectValue
                                placeholder={t('side_panel.settings.sort')}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value="joinedAt:desc">
                                    {t('dialog.group.success.joined_newest')}
                                </SelectItem>
                                <SelectItem value="joinedAt:asc">
                                    {t('dialog.group.success.joined_oldest')}
                                </SelectItem>
                                <SelectItem value="user.displayName:asc">
                                    {t('dialog.group.label.name_a_z')}
                                </SelectItem>
                                <SelectItem value="user.displayName:desc">
                                    {t('dialog.group.label.name_z_a')}
                                </SelectItem>
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <Select
                        value={memberRoleId || 'all'}
                        onValueChange={onMemberRoleChange}
                        disabled={remoteStatus.members === 'running'}
                    >
                        <SelectTrigger size="sm" className="w-48">
                            <SelectValue
                                placeholder={t('dialog.group.label.role')}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value="all">
                                    {t('dialog.group.label.all_roles')}
                                </SelectItem>
                                {roles.map((role) => (
                                    <SelectItem
                                        key={role.id || role.name}
                                        value={role.id || role.name}
                                    >
                                        {role.name || 'Role'}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <Input
                        value={search.members}
                        onChange={(event) =>
                            onSearchMembersChange(event.target.value)
                        }
                        placeholder={t('dialog.group.members.search')}
                        className="ml-auto h-8 max-w-64"
                    />
                </div>
                <RowList
                    rows={memberRows}
                    group={group}
                    kind="members"
                    loading={remoteStatus.members === 'running'}
                    error={remoteErrors.members}
                />
            </EntityDialogTabContent>
            <EntityDialogTabContent
                value="photos"
                className="flex flex-col gap-2"
            >
                <RowList
                    rows={photos}
                    group={group}
                    kind="photos"
                    loading={remoteStatus.photos === 'running'}
                    error={remoteErrors.photos}
                    onPreviewImage={onPreviewRowImage}
                />
            </EntityDialogTabContent>
            <EntityDialogTabContent value="json">
                <EntityRawJson
                    value={{
                        group,
                        posts,
                        events: groupEvents,
                        instances: activeInstances,
                        members,
                        galleries: firstArray(group.galleries),
                        photos,
                        activeInstances
                    }}
                />
            </EntityDialogTabContent>
        </EntityDialogTabs>
    );
}
