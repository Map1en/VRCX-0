import { DownloadIcon, ExternalLinkIcon, EyeIcon } from 'lucide-react';

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

import {
    EntityDialogTabContent,
    EntityDialogTabs,
    EntityInfoBlock,
    EntityInfoGrid,
    EntityRawJson
} from '../EntityDialogScaffold.jsx';
import { PreviousInstancesPanel } from '../PreviousInstancesTableDialog.jsx';
import { GroupInstanceRows } from './GroupInstanceRows.jsx';
import { RowList } from './GroupRowList.jsx';
import {
    announcementRoleNames,
    announcementTimestamp,
    announcementUserId,
    announcementUserLabel,
    firstArray
} from './groupDialogUtils.js';

function GroupAnnouncementInfo({ group, onPreviewImage, onOpenUser }) {
    const { t } = useTranslation();

    const announcement = group.announcement;
    const roleNames = announcementRoleNames(announcement, group);

    if (!announcement?.id && !announcement?.title) {
        return null;
    }

    return (
        <EntityInfoBlock label={t('dialog.group.info.announcement')} full>
            <span className="block truncate text-sm">
                {announcement.title || 'Announcement'}
            </span>
            {announcement.imageUrl ? (
                <Button
                    type="button"
                    variant="ghost"
                    className="mt-1.5 mr-1.5 h-auto p-0 align-top"
                    aria-label={`Preview ${announcement.title || 'announcement'} image`}
                    onClick={() =>
                        onPreviewImage(
                            convertFileUrlToImageUrl(announcement.imageUrl, 1024),
                            announcement.title || 'Announcement'
                        )
                    }
                >
                    <img
                        src={convertFileUrlToImageUrl(announcement.imageUrl, 128)}
                        alt=""
                        className="size-16 rounded-md object-cover"
                    />
                </Button>
            ) : null}
            <pre className="text-muted-foreground inline-block align-top font-sans text-xs whitespace-pre-wrap">
                {announcement.text || '—'}
            </pre>
            <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                {roleNames.length ? (
                    <Badge
                        variant="outline"
                        className="max-w-full"
                        title={roleNames.join(', ')}
                    >
                        <EyeIcon data-icon="inline-start" />
                        <span className="truncate">{roleNames.join(', ')}</span>
                    </Badge>
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
                            <span>{t('dialog.group.generated.author')}</span>
                            <span className="text-foreground font-medium">
                                {announcementUserLabel(announcement, 'author') ||
                                    announcementUserId(announcement, 'author')}
                            </span>
                        </Button>
                    ) : (
                        <span className="inline-flex items-center gap-1">
                            <span>{t('dialog.group.generated.author')}</span>
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
                                {announcementUserLabel(announcement, 'editor') ||
                                    announcementUserId(announcement, 'editor')}
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
                        <span>{t('dialog.group.generated.created')}</span>
                        <span className="text-foreground font-medium">
                            {announcementTimestamp(announcement.createdAt)}
                        </span>
                    </span>
                ) : null}
                {announcement.updatedAt ? (
                    <span className="inline-flex items-center gap-1">
                        <span>{t('dialog.group.generated.updated')}</span>
                        <span className="text-foreground font-medium">
                            {announcementTimestamp(announcement.updatedAt)}
                        </span>
                    </span>
                ) : null}
            </div>
        </EntityInfoBlock>
    );
}

export function GroupDialogTabPanels({ state, handlers }) {
    const { t } = useTranslation();

    const {
        activeInstances,
        activeTab,
        bannerUrl,
        canManagePosts,
        currentEndpoint,
        currentUserId,
        filteredMembers,
        filteredPosts,
        group,
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
        onRefreshMembers,
        onSearchMembersChange,
        onSearchPostsChange
    } = handlers;
    const members = filteredMembers.source || [];
    const memberRows = filteredMembers.rows || [];
    const languages = Array.isArray(group.languages) ? group.languages : [];
    const links = Array.isArray(group.links) ? group.links : [];
    const tags = Array.isArray(group.tags) ? group.tags : [];
    const roles = Array.isArray(group.roles) ? group.roles : [];

    return (
        <EntityDialogTabs value={activeTab} onValueChange={onChangeTab} tabs={tabs}>
            <EntityDialogTabContent value="info">
                {bannerUrl ? (
                    <Button
                        type="button"
                        variant="ghost"
                        className="bg-muted mb-3 h-auto w-full overflow-hidden rounded-md p-0"
                        aria-label={`Preview ${groupTitle} banner`}
                        onClick={() => onPreviewImage(bannerUrl, groupTitle)}
                    >
                        <img
                            src={bannerUrl}
                            alt={group.name || 'Group banner'}
                            className="aspect-[6/1] w-full object-cover"
                        />
                    </Button>
                ) : null}
                <EntityInfoGrid>
                    <GroupInstanceRows
                        instances={activeInstances}
                        currentUserId={currentUserId}
                        endpoint={currentEndpoint}
                    />
                    <GroupAnnouncementInfo
                        group={group}
                        onPreviewImage={onPreviewImage}
                        onOpenUser={onOpenUser}
                    />
                    {group.rules ? (
                        <EntityInfoBlock
                            label={t('dialog.group.info.rules')}
                            full
                        >
                            <pre className="text-muted-foreground font-sans text-xs whitespace-pre-wrap">
                                {group.rules}
                            </pre>
                        </EntityInfoBlock>
                    ) : null}
                    <EntityInfoBlock
                        label={t('dialog.group.generated.members_2')}
                        value={`${group.memberCount || 0} (${group.onlineMemberCount || 0})`}
                    />
                    <EntityInfoBlock
                        label={t('dialog.group.generated.created_at')}
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
                        label={t('dialog.group.generated.last_visited')}
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
                        label={t('dialog.group.generated.join_state')}
                        value={joinState || '—'}
                    />
                    <EntityInfoBlock
                        label={t('dialog.group.generated.membership')}
                        value={memberStatus || group.membershipStatus || '—'}
                    />
                    <EntityInfoBlock
                        label={t('dialog.group.generated.languages')}
                        value={languages.join(', ') || '—'}
                    />
                    <EntityInfoBlock
                        label={t('dialog.group.generated.privacy')}
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
                        onClick={groupUrl ? handlers.onCopyGroupUrl : undefined}
                    />
                    <EntityInfoBlock
                        label={t('dialog.group.info.id')}
                        value={group.id}
                        mono
                        wide
                    />
                    <EntityInfoBlock
                        label={t('dialog.group.generated.owner_2')}
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
                            label={t('dialog.group.generated.roles')}
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
            <EntityDialogTabContent value="posts" className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <div className="text-muted-foreground text-sm">
                        {filteredPosts.length}/{posts.length}{' '}
                        {t('dialog.group.generated.posts')}
                    </div>
                    <Input
                        value={search.posts}
                        onChange={(event) =>
                            onSearchPostsChange(event.target.value)
                        }
                        placeholder={t('dialog.group.generated.search_posts')}
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
                        {memberRows.length}/{group.memberCount || members.length}{' '}
                        {t('dialog.group.generated.members')}
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
                        {t('dialog.group.generated.load_all')}
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
                                    {t('dialog.group.generated.joined_newest')}
                                </SelectItem>
                                <SelectItem value="joinedAt:asc">
                                    {t('dialog.group.generated.joined_oldest')}
                                </SelectItem>
                                <SelectItem value="user.displayName:asc">
                                    {t('dialog.group.generated.name_a_z')}
                                </SelectItem>
                                <SelectItem value="user.displayName:desc">
                                    {t('dialog.group.generated.name_z_a')}
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
                                placeholder={t('dialog.group.generated.role')}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value="all">
                                    {t('dialog.group.generated.all_roles')}
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
                        placeholder={t(
                            'dialog.group.generated.search_members'
                        )}
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
