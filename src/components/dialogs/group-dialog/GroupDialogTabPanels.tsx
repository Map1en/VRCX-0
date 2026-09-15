import { ExternalLinkIcon, EyeIcon, ImageIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { FadeInImage } from '@/components/media/FadeInImage';
import { TranslatableText } from '@/components/translation/TranslatableText';
import type {
    GroupAnnouncementRecord,
    GroupProfileRecord
} from '@/domain/entities/group';
import { formatDateFilter } from '@/lib/dateTime';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
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
import type {
    GroupDialogTabCommands,
    GroupDialogTabModel
} from './groupDialogTypes';
import {
    announcementRoleNames,
    announcementTimestamp,
    announcementUserId,
    announcementUserLabel
} from './groupDialogUtils';
import { GroupInstanceRows } from './GroupInstanceRows';
import { GroupMembersPanel } from './GroupMembersPanel';
import { GroupPostUserButton, RowList } from './GroupRowList';

function GroupBannerFallback() {
    return (
        <Skeleton className="text-muted-foreground flex aspect-[6/1] w-full items-center justify-center rounded-md">
            <ImageIcon className="size-6" />
        </Skeleton>
    );
}

function GroupOverviewSection({
    title,
    action = null,
    children
}: {
    title: ReactNode;
    action?: ReactNode;
    children?: ReactNode;
}) {
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

function GroupAnnouncementPanel({
    announcement,
    group,
    onPreviewImage,
    children
}: {
    announcement: GroupAnnouncementRecord;
    group: GroupProfileRecord;
    onPreviewImage: (url: string, title: string) => void;
    children: ReactNode;
}) {
    const { t } = useTranslation();

    const roleNames = announcementRoleNames(announcement, group);
    const authorId = announcementUserId(announcement, 'author');
    const authorLabel = announcementUserLabel(announcement, 'author');
    const editorId = announcementUserId(announcement, 'editor');
    const editorLabel = announcementUserLabel(announcement, 'editor');

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
                        aria-label={t('accessibility.preview_image', {
                            item:
                                announcement.title ||
                                t('accessibility.announcement')
                        })}
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
                        <FadeInImage
                            src={convertFileUrlToImageUrl(
                                announcement.imageUrl,
                                128
                            )}
                            alt=""
                            className="size-16 rounded-md object-cover"
                        />
                    </Button>
                ) : null}
                {children}
            </div>
            <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                {roleNames.length ? (
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Badge variant="outline" className="max-w-full">
                                    <EyeIcon data-icon="inline-start" />
                                    <span className="truncate">
                                        {roleNames.join(', ')}
                                    </span>
                                </Badge>
                            }
                        />
                        <TooltipContent>{roleNames.join(', ')}</TooltipContent>
                    </Tooltip>
                ) : null}
                {authorId || authorLabel ? (
                    authorId ? (
                        <GroupPostUserButton
                            userId={authorId}
                            displayName={authorLabel}
                            label={<span>{t('table.import.author')}</span>}
                        />
                    ) : (
                        <span className="inline-flex items-center gap-1">
                            <span>{t('table.import.author')}</span>
                            <span className="text-foreground font-medium">
                                {authorLabel}
                            </span>
                        </span>
                    )
                ) : null}
                {editorId || editorLabel ? (
                    editorId ? (
                        <GroupPostUserButton
                            userId={editorId}
                            displayName={editorLabel}
                            label={
                                <span>{t('dialog.group.posts.edited_by')}</span>
                            }
                        />
                    ) : (
                        <span className="inline-flex items-center gap-1">
                            <span>{t('dialog.group.posts.edited_by')}</span>
                            <span className="text-foreground font-medium">
                                {editorLabel}
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

export function GroupDialogTabPanels({
    tabModel: model,
    tabCommands: commands
}: {
    tabModel: GroupDialogTabModel;
    tabCommands: GroupDialogTabCommands;
}) {
    const { t } = useTranslation();

    const {
        activeInstances,
        activeTab,
        announcement,
        bannerUrl,
        canManagePosts,
        currentUserId,
        filteredPosts,
        group,
        groupEvents,
        groupEventsError,
        groupEventsStatus,
        groupTitle,
        groupUrl,
        joinState,
        members,
        memberStatus,
        ownerLabel,
        photos,
        posts,
        previousInstances,
        remoteErrors,
        remoteStatus,
        search,
        tabs
    } = model;
    const {
        onChangeTab,
        onDeletePost,
        onEditPost,
        onExportMembers,
        onLoadMoreMembers,
        onOpenLink,
        onOpenOwner,
        onPreviousInstancesChange,
        onPreviewImage,
        onPreviewRowImage,
        onRefreshEvents,
        onRefreshMembers,
        onSearchMembersChange,
        onSearchPostsChange,
        onToggleEventFollow
    } = commands;
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
                        <FadeInImage
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
                    <TranslatableText
                        source={group.description}
                        entityId={group.id || ''}
                        density="button"
                    >
                        {({ action, meta, error, text }) => (
                            <GroupOverviewSection
                                title={t('dialog.group.overview.description')}
                                action={action}
                            >
                                {meta}
                                <div className="text-muted-foreground max-h-32 overflow-auto text-sm whitespace-pre-wrap">
                                    {text}
                                </div>
                                {error}
                            </GroupOverviewSection>
                        )}
                    </TranslatableText>
                ) : null}

                <GroupOverviewSection title={t('dialog.group.info.instances')}>
                    <GroupInstanceRows
                        instances={activeInstances}
                        currentUserId={currentUserId}
                    />
                </GroupOverviewSection>

                {announcement?.id || announcement?.title ? (
                    <TranslatableText
                        source={announcement.text || ''}
                        entityId={announcement.id || group.id || ''}
                        density="button"
                    >
                        {({ action, meta, error, text }) => (
                            <GroupOverviewSection
                                title={t('dialog.group.info.announcement')}
                                action={action}
                            >
                                <GroupAnnouncementPanel
                                    announcement={announcement}
                                    group={group}
                                    onPreviewImage={onPreviewImage}
                                >
                                    <div className="min-w-0 flex-1">
                                        {meta}
                                        <pre className="text-muted-foreground max-h-40 min-w-0 overflow-auto font-sans text-xs whitespace-pre-wrap">
                                            {text || '\u2014'}
                                        </pre>
                                        {error}
                                    </div>
                                </GroupAnnouncementPanel>
                            </GroupOverviewSection>
                        )}
                    </TranslatableText>
                ) : null}

                {group.rules ? (
                    <TranslatableText
                        source={group.rules}
                        entityId={group.id || ''}
                        density="button"
                    >
                        {({ action, meta, error, text }) => (
                            <GroupOverviewSection
                                title={t('dialog.group.info.rules')}
                                action={action}
                            >
                                {meta}
                                <pre className="text-muted-foreground max-h-40 overflow-auto font-sans text-sm whitespace-pre-wrap">
                                    {text}
                                </pre>
                                {error}
                            </GroupOverviewSection>
                        )}
                    </TranslatableText>
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
                                groupUrl ? commands.onCopyGroupUrl : undefined
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
            <EntityDialogTabContent value="members">
                <GroupMembersPanel
                    active={activeTab === 'members'}
                    group={group}
                    members={members}
                    onExport={onExportMembers}
                    onLoadMore={onLoadMoreMembers}
                    onQueryChange={onSearchMembersChange}
                    onRefresh={onRefreshMembers}
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
                <EntityRawJson value={group} />
            </EntityDialogTabContent>
        </EntityDialogTabs>
    );
}
