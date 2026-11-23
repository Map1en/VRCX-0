import { ChevronRightIcon, EyeIcon, ImageIcon } from 'lucide-react';
import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';

import { EconomyStoreListings } from '@/components/economy/EconomyStoreListings';
import { FreezeWhenHidden } from '@/components/FreezeWhenHidden';
import {
    ToolbarSearch,
    ToolbarStatus
} from '@/components/layout/ToolbarControls';
import { FadeInImage } from '@/components/media/FadeInImage';
import { TranslatableText } from '@/components/translation/TranslatableText';
import type {
    GroupAnnouncementRecord,
    GroupProfileRecord
} from '@/domain/entities/group';
import { formatDateFilter } from '@/lib/dateTime';
import { useVisitedTabs } from '@/lib/useVisitedTabs';
import { cn } from '@/lib/utils';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { IntentTooltip } from '@/ui/hint-tooltip';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Skeleton } from '@/ui/shadcn/skeleton';

import {
    EntityDialogTabContent,
    EntityDialogTabs,
    EntityInfoBlock,
    EntityInfoGrid,
    EntityRawJson
} from '../EntityDialogScaffold';
import { PreviousInstancesPanel } from '../PreviousInstancesTableDialog';
import { GroupEventsTab, GroupEventSummary } from './GroupDialogEvents';
import { GroupDialogInstancesTab } from './GroupDialogInstancesTab';
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
import { GroupGalleryPanel } from './GroupGalleryPanel';
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
                <div className="text-foreground truncate text-sm font-semibold">
                    {title}
                </div>
                {action}
            </div>
            <div className="min-w-0">{children}</div>
        </section>
    );
}

const CLAMP_CLASS_NAMES = {
    2: 'line-clamp-2',
    3: 'line-clamp-3',
    4: 'line-clamp-4'
} as const;

function ExpandableText({
    lines,
    className,
    children
}: {
    lines: keyof typeof CLAMP_CLASS_NAMES;
    className?: string;
    children: ReactNode;
}) {
    const { t } = useTranslation();
    const textRef = useRef<HTMLDivElement>(null);
    const [expanded, setExpanded] = useState(false);
    const [overflowing, setOverflowing] = useState(false);

    useLayoutEffect(() => {
        const element = textRef.current;
        if (element && !expanded) {
            setOverflowing(element.scrollHeight > element.clientHeight + 1);
        }
    }, [children, expanded]);

    return (
        <div className="min-w-0">
            <div
                ref={textRef}
                className={cn(
                    'break-words whitespace-pre-wrap',
                    className,
                    !expanded && CLAMP_CLASS_NAMES[lines]
                )}
            >
                {children}
            </div>
            {overflowing || expanded ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground hover:text-foreground mt-1 h-auto px-0 hover:bg-transparent"
                    onClick={() => setExpanded((value) => !value)}
                >
                    {t(
                        expanded
                            ? 'dialog.group.posts.collapse'
                            : 'dialog.group.posts.expand'
                    )}
                </Button>
            ) : null}
        </div>
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
                    <IntentTooltip content={roleNames.join(', ')}>
                        <Badge variant="outline" className="max-w-full">
                            <EyeIcon data-icon="inline-start" />
                            <span className="truncate">
                                {roleNames.join(', ')}
                            </span>
                        </Badge>
                    </IntentTooltip>
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
        canManageCalendar,
        canManagePosts,
        currentUserId,
        filteredPosts,
        group,
        groupEvents,
        groupEventsError,
        groupEventsStatus,
        groupTitle,
        members,
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
        onCreateEvent,
        onDeleteEvent,
        onDeletePost,
        onEditEvent,
        onEditPost,
        onExportMembers,
        onLoadMoreMembers,
        onPreviousInstancesChange,
        onPreviewImage,
        onPreviewRowImage,
        onGalleriesChanged,
        onPhotosChanged,
        onRefreshEvents,
        onRefreshMembers,
        onSearchMembersChange,
        onSearchPostsChange,
        onToggleEventFollow
    } = commands;
    const tags = (Array.isArray(group.tags) ? group.tags : []).filter(
        (tag) => !String(tag).startsWith('admin_')
    );
    const roles = Array.isArray(group.roles) ? group.roles : [];
    const lastVisitedAt =
        previousInstances[0]?.created_at || previousInstances[0]?.createdAt;
    const [bannerFailed, setBannerFailed] = useState(false);
    const visitedTabs = useVisitedTabs(activeTab, group.id);

    useEffect(() => {
        setBannerFailed(false);
    }, [bannerUrl]);

    return (
        <EntityDialogTabs
            value={activeTab}
            onValueChange={onChangeTab}
            tabs={tabs}
            keptTabs={visitedTabs}
        >
            <EntityDialogTabContent
                value="overview"
                className="flex flex-col gap-4 pt-3"
            >
                <FreezeWhenHidden active={activeTab === 'overview'}>
                    {bannerUrl && !bannerFailed ? (
                        <Button
                            type="button"
                            variant="ghost"
                            className="bg-muted h-auto w-full overflow-hidden rounded-md p-0"
                            aria-label={t(
                                'dialog.group.overview.preview_banner',
                                {
                                    value: groupTitle
                                }
                            )}
                            onClick={() =>
                                onPreviewImage(bannerUrl, groupTitle)
                            }
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
                                    title={t(
                                        'dialog.group.overview.description'
                                    )}
                                    action={action}
                                >
                                    {meta}
                                    <ExpandableText
                                        lines={4}
                                        className="text-muted-foreground text-sm"
                                    >
                                        {text}
                                    </ExpandableText>
                                    {error}
                                </GroupOverviewSection>
                            )}
                        </TranslatableText>
                    ) : null}

                    {activeInstances.length ? (
                        <Button
                            type="button"
                            variant="ghost"
                            className="bg-card/40 h-auto w-full justify-between rounded-md border px-3 py-2.5 text-left font-normal"
                            onClick={() => onChangeTab('instances')}
                        >
                            <span className="flex items-center gap-2 text-sm">
                                <span className="size-2 rounded-full bg-(--status-online)" />
                                {t('dialog.group.overview.open_instances', {
                                    count: activeInstances.length
                                })}
                            </span>
                            <ChevronRightIcon
                                data-icon="inline-end"
                                className="text-muted-foreground opacity-60"
                            />
                        </Button>
                    ) : null}

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
                                            <ExpandableText
                                                lines={2}
                                                className="text-muted-foreground text-xs"
                                            >
                                                {text || '\u2014'}
                                            </ExpandableText>
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
                                    <ExpandableText
                                        lines={3}
                                        className="text-muted-foreground text-sm"
                                    >
                                        {text}
                                    </ExpandableText>
                                    {error}
                                </GroupOverviewSection>
                            )}
                        </TranslatableText>
                    ) : null}

                    {groupEvents.length ||
                    groupEventsError ||
                    groupEventsStatus === 'running' ? (
                        <GroupOverviewSection
                            title={t('dialog.group.overview.recent_events')}
                            action={
                                <Button
                                    type="button"
                                    size="xs"
                                    variant="ghost"
                                    className="text-muted-foreground hover:text-foreground"
                                    onClick={() => onChangeTab('events')}
                                >
                                    {t('dialog.group.overview.open_events')}
                                    <ChevronRightIcon data-icon="inline-end" />
                                </Button>
                            }
                        >
                            <GroupEventSummary
                                events={groupEvents}
                                status={groupEventsStatus}
                                error={groupEventsError}
                                group={group}
                                onOpenEvents={() => onChangeTab('events')}
                                onToggleFollow={onToggleEventFollow}
                            />
                        </GroupOverviewSection>
                    ) : null}

                    <GroupOverviewSection
                        title={t('dialog.group.overview.basics')}
                    >
                        <EntityInfoGrid className="px-0">
                            {group.createdAt || group.created_at ? (
                                <EntityInfoBlock
                                    label={t('dialog.group.info.created_at')}
                                    value={formatDateFilter(
                                        group.createdAt || group.created_at,
                                        'long'
                                    )}
                                />
                            ) : null}
                            {lastVisitedAt ? (
                                <EntityInfoBlock
                                    label={t('dialog.group.info.last_visited')}
                                    value={formatDateFilter(
                                        lastVisitedAt,
                                        'long'
                                    )}
                                    onClick={() =>
                                        onChangeTab('instance-history')
                                    }
                                />
                            ) : null}
                            {roles.length ? (
                                <EntityInfoBlock
                                    label={t('dialog.group.info.roles')}
                                    value={String(roles.length)}
                                    onClick={() => onChangeTab('members')}
                                />
                            ) : null}
                            {tags.length ? (
                                <EntityInfoBlock
                                    label={t('dialog.avatar.info.tags')}
                                    full
                                >
                                    <div className="flex flex-wrap gap-1.5">
                                        {tags.map((tag) => (
                                            <Badge
                                                key={tag}
                                                variant="outline"
                                                className="text-muted-foreground font-normal"
                                            >
                                                {tag}
                                            </Badge>
                                        ))}
                                    </div>
                                </EntityInfoBlock>
                            ) : null}
                        </EntityInfoGrid>
                    </GroupOverviewSection>
                </FreezeWhenHidden>
            </EntityDialogTabContent>
            {activeInstances.length ? (
                <EntityDialogTabContent value="instances" className="pt-3">
                    <FreezeWhenHidden active={activeTab === 'instances'}>
                        <GroupDialogInstancesTab
                            instances={activeInstances}
                            currentUserId={currentUserId}
                            onRefresh={commands.onRefreshInstances}
                        />
                    </FreezeWhenHidden>
                </EntityDialogTabContent>
            ) : null}
            <EntityDialogTabContent
                value="events"
                className="flex flex-col gap-3 pt-3"
            >
                <FreezeWhenHidden active={activeTab === 'events'}>
                    <GroupEventsTab
                        events={groupEvents}
                        status={groupEventsStatus}
                        error={groupEventsError}
                        group={group}
                        canManage={canManageCalendar}
                        onRefresh={onRefreshEvents}
                        onToggleFollow={onToggleEventFollow}
                        onCreate={onCreateEvent}
                        onEdit={onEditEvent}
                        onDelete={onDeleteEvent}
                    />
                </FreezeWhenHidden>
            </EntityDialogTabContent>
            <EntityDialogTabContent
                value="instance-history"
                className="flex min-h-0 flex-col"
            >
                <FreezeWhenHidden active={activeTab === 'instance-history'}>
                    <PreviousInstancesPanel
                        title={t('dialog.previous_instances.header')}
                        instances={previousInstances}
                        variant="group"
                        onRowsChange={onPreviousInstancesChange}
                        showHeader={false}
                        className="flex-1 pt-3"
                    />
                </FreezeWhenHidden>
            </EntityDialogTabContent>
            <EntityDialogTabContent
                value="posts"
                className="flex flex-col gap-2"
            >
                <FreezeWhenHidden active={activeTab === 'posts'}>
                    <div className="flex flex-wrap items-center gap-2">
                        <ToolbarStatus className="mr-auto tabular-nums">
                            {filteredPosts.length}/{posts.length}{' '}
                            {t('dialog.group.posts.header')}
                        </ToolbarStatus>
                        <ToolbarSearch
                            value={search.posts}
                            onValueChange={onSearchPostsChange}
                            placeholder={t(
                                'dialog.group.posts.search_placeholder'
                            )}
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
                </FreezeWhenHidden>
            </EntityDialogTabContent>
            <EntityDialogTabContent value="members">
                <FreezeWhenHidden active={activeTab === 'members'}>
                    <GroupMembersPanel
                        active={activeTab === 'members'}
                        group={group}
                        members={members}
                        onExport={onExportMembers}
                        onLoadMore={onLoadMoreMembers}
                        onQueryChange={onSearchMembersChange}
                        onRefresh={onRefreshMembers}
                    />
                </FreezeWhenHidden>
            </EntityDialogTabContent>
            <EntityDialogTabContent
                value="photos"
                className="flex flex-col gap-2"
            >
                <FreezeWhenHidden active={activeTab === 'photos'}>
                    <GroupGalleryPanel
                        group={group}
                        rows={photos}
                        loading={remoteStatus.photos === 'running'}
                        error={remoteErrors.photos ?? ''}
                        currentUserId={currentUserId}
                        onPreviewImage={onPreviewRowImage}
                        onGalleriesChanged={onGalleriesChanged}
                        onImagesChanged={onPhotosChanged}
                    />
                </FreezeWhenHidden>
            </EntityDialogTabContent>
            {group.storeId ? (
                <EntityDialogTabContent value="store">
                    <FreezeWhenHidden active={activeTab === 'store'}>
                        <EconomyStoreListings storeId={group.storeId} />
                    </FreezeWhenHidden>
                </EntityDialogTabContent>
            ) : null}
            <EntityDialogTabContent value="json">
                <FreezeWhenHidden active={activeTab === 'json'}>
                    <EntityRawJson value={group} />
                </FreezeWhenHidden>
            </EntityDialogTabContent>
        </EntityDialogTabs>
    );
}
