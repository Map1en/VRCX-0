import { ExternalLinkIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    MutualFriendAvatars,
    toMutualFriendAvatar
} from '@/components/mutual-friends/MutualFriendAvatars';
import { formatDateFilterOrFallback, timeToText } from '@/lib/dateTime';
import { openExternalLink } from '@/services/entityMediaService';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { Badge } from '@/ui/shadcn/badge';

import {
    EntityInfoBlock,
    EntityInfoSection,
    EntityInfoSections,
    EntityMemoTextarea
} from '../EntityDialogScaffold';
import { formatPreviousInstanceCount } from '../previous-instances-table/previousInstancesRows';
import type { WorldDialogTabModel } from './WorldDialogTabbedView';
import { friendVisitSummary } from './worldDialogUtils';
import {
    fileAnalysisSizeForPlatform,
    platformDisplayName
} from './WorldDialogViewParts';

const VISITOR_AVATAR_LIMIT = 6;

const WORLD_DATE_FALLBACKS = {
    empty: '',
    invalid: String
};

function formatWorldDate(value: unknown) {
    return formatDateFilterOrFallback(value, 'long', WORLD_DATE_FALLBACKS);
}

function presentNumber(value: unknown) {
    return typeof value === 'number' && value > 0 ? value.toLocaleString() : '';
}

export function WorldInfoSections({
    world,
    authorTags,
    favoriteRate,
    friendVisits,
    hasPersistData,
    lastVisitedInstance,
    memo,
    previousInstanceCount,
    previewUrl,
    restrictions,
    attributes,
    totalVisitTime,
    onOpenVisitHistory,
    onSaveMemo
}: Pick<
    WorldDialogTabModel,
    | 'world'
    | 'authorTags'
    | 'favoriteRate'
    | 'friendVisits'
    | 'hasPersistData'
    | 'lastVisitedInstance'
    | 'memo'
    | 'previewUrl'
    | 'restrictions'
    | 'attributes'
    | 'totalVisitTime'
> & {
    previousInstanceCount: number;
    onOpenVisitHistory: () => void;
    onSaveMemo: (value: string) => void | Promise<void>;
}) {
    const { t } = useTranslation();
    const [domainsOpen, setDomainsOpen] = useState(false);
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const visitorAvatars = (friendVisits?.friends ?? [])
        .slice(0, VISITOR_AVATAR_LIMIT)
        .map((row) =>
            toMutualFriendAvatar(
                row.userId,
                friendsById[row.userId] ?? { displayName: row.displayName }
            )
        );
    const lastVisited = formatWorldDate(lastVisitedInstance?.created_at);
    const friendsLastVisited = friendVisits?.friendCount
        ? formatWorldDate(friendVisits.lastVisitedAt)
        : '';
    const releaseStatusLabel = world.isLabs
        ? t('dialog.world.tags.labs')
        : world.releaseStatus === 'public'
          ? t('dialog.world.tags.public')
          : world.releaseStatus === 'private'
            ? t('dialog.world.tags.private')
            : '';
    const labsDate =
        world.labsPublicationDate && world.labsPublicationDate !== 'none'
            ? formatWorldDate(world.labsPublicationDate)
            : '';
    const platformSizes = (world.platforms ?? []).map((platform) => ({
        platform,
        name: platformDisplayName(platform),
        size: fileAnalysisSizeForPlatform(world.fileAnalysis, platform)
    }));
    const cacheSize = world.$isCached ? world.$cacheSize || '' : '';
    const domains = Array.isArray(world.urlList) ? world.urlList : [];
    const capacityText =
        world.recommendedCapacity && world.capacity
            ? t('dialog.world.info.capacity_value', {
                  recommended: world.recommendedCapacity,
                  max: world.capacity
              })
            : presentNumber(world.recommendedCapacity || world.capacity);
    const occupantHint =
        world.occupants && (world.publicOccupants || world.privateOccupants)
            ? `${t('dialog.world.instances.public_count', {
                  count: world.publicOccupants ?? 0
              })} · ${t('dialog.world.instances.private_count', {
                  count: world.privateOccupants ?? 0
              })}`
            : undefined;

    return (
        <EntityInfoSections>
            <EntityInfoSection title={t('dialog.world.info.sections.personal')}>
                <EntityMemoTextarea
                    label={t('dialog.world.info.memo')}
                    value={memo}
                    placeholder={t('dialog.world.info.memo_placeholder')}
                    onSave={onSaveMemo}
                />
                {lastVisited ? (
                    <EntityInfoBlock
                        label={t('dialog.world.info.last_visited')}
                        value={lastVisited}
                    />
                ) : null}
                {previousInstanceCount ? (
                    <EntityInfoBlock
                        label={t('dialog.world.info.visit_count')}
                        value={formatPreviousInstanceCount(
                            previousInstanceCount
                        )}
                        onClick={onOpenVisitHistory}
                    />
                ) : null}
                {totalVisitTime > 0 ? (
                    <EntityInfoBlock
                        label={t('dialog.world.info.time_spent')}
                        value={timeToText(totalVisitTime)}
                    />
                ) : null}
                {friendVisits && friendVisits.friendCount > 0 ? (
                    <EntityInfoBlock
                        label={t('dialog.world.info.friends_visited')}
                        wide
                    >
                        <span className="flex min-w-0 items-center gap-2">
                            <span className="shrink-0 text-sm leading-snug font-medium">
                                {friendVisits.friendCount.toLocaleString()}
                            </span>
                            <MutualFriendAvatars friends={visitorAvatars} />
                            <span className="text-muted-foreground min-w-0 truncate text-xs">
                                {friendVisitSummary(friendVisits)}
                            </span>
                        </span>
                    </EntityInfoBlock>
                ) : null}
                {friendsLastVisited ? (
                    <EntityInfoBlock
                        label={t('dialog.world.info.friends_last_visited')}
                        value={friendsLastVisited}
                    />
                ) : null}
            </EntityInfoSection>

            <EntityInfoSection title={t('dialog.world.info.sections.stats')}>
                <EntityInfoBlock
                    label={t('dialog.world.info.players')}
                    value={presentNumber(world.occupants)}
                    hint={occupantHint}
                />
                <EntityInfoBlock
                    label={t('dialog.world.info.favorites')}
                    value={presentNumber(world.favorites)}
                    hint={
                        world.favorites && favoriteRate
                            ? t('dialog.world.info.favorite_rate', {
                                  rate: favoriteRate
                              })
                            : undefined
                    }
                />
                <EntityInfoBlock
                    label={t('dialog.world.info.visits')}
                    value={presentNumber(world.visits)}
                />
                {capacityText ? (
                    <EntityInfoBlock
                        label={t('dialog.world.info.capacity')}
                        value={capacityText}
                    />
                ) : null}
            </EntityInfoSection>

            <EntityInfoSection title={t('dialog.world.info.sections.release')}>
                {releaseStatusLabel ? (
                    <EntityInfoBlock
                        label={t('dialog.world.info.release_status')}
                        value={releaseStatusLabel}
                    />
                ) : null}
                {world.version ? (
                    <EntityInfoBlock
                        label={t('dialog.world.info.version')}
                        value={String(world.version)}
                    />
                ) : null}
                <EntityInfoBlock
                    label={t('dialog.world.info.last_updated')}
                    value={formatWorldDate(world.updatedAt || world.updated_at)}
                />
                <EntityInfoBlock
                    label={t('dialog.world.info.created_at')}
                    value={formatWorldDate(world.createdAt || world.created_at)}
                />
                {labsDate ? (
                    <EntityInfoBlock
                        label={t('dialog.world.info.labs_publication_date')}
                        value={labsDate}
                    />
                ) : null}
                {world.publicationDate && world.publicationDate !== 'none' ? (
                    <EntityInfoBlock
                        label={t('dialog.world.info.publication_date')}
                        value={formatWorldDate(world.publicationDate)}
                    />
                ) : null}
            </EntityInfoSection>

            {platformSizes.length || hasPersistData || cacheSize ? (
                <EntityInfoSection
                    title={t('dialog.world.info.sections.technical')}
                >
                    {platformSizes.map(({ platform, name, size }) => (
                        <EntityInfoBlock
                            key={platform}
                            label={name}
                            value={size || '✓'}
                        />
                    ))}
                    {hasPersistData ? (
                        <EntityInfoBlock
                            label={t('dialog.world.info.persistent_data')}
                            value="✓"
                        />
                    ) : null}
                    {cacheSize ? (
                        <EntityInfoBlock
                            label={t('dialog.world.info.cache_size')}
                            value={cacheSize}
                        />
                    ) : null}
                </EntityInfoSection>
            ) : null}

            {authorTags.length ||
            restrictions.length ||
            attributes.length ||
            domains.length ||
            previewUrl ? (
                <EntityInfoSection title={t('dialog.world.info.sections.tags')}>
                    {authorTags.length ? (
                        <EntityInfoBlock
                            label={t('dialog.world.info.author_tags')}
                            full
                        >
                            <div className="mt-1 flex flex-wrap gap-1.5">
                                {authorTags.map((tag) => (
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
                    {restrictions.length ? (
                        <EntityInfoBlock
                            label={t('dialog.world.info.restrictions')}
                            full
                        >
                            <div className="mt-1 flex flex-wrap gap-1.5">
                                {restrictions.map((tag) => (
                                    <Badge
                                        key={tag.key}
                                        variant="outline"
                                        className="text-muted-foreground font-normal"
                                    >
                                        {tag.label}
                                    </Badge>
                                ))}
                            </div>
                        </EntityInfoBlock>
                    ) : null}
                    {attributes.length ? (
                        <EntityInfoBlock
                            label={t('dialog.world.info.attributes')}
                            full
                        >
                            <div className="mt-1 flex flex-wrap gap-1.5">
                                {attributes.map((tag) => (
                                    <Badge
                                        key={tag.key}
                                        variant="outline"
                                        className="text-muted-foreground font-normal"
                                    >
                                        {tag.label}
                                    </Badge>
                                ))}
                            </div>
                        </EntityInfoBlock>
                    ) : null}
                    {previewUrl ? (
                        <EntityInfoBlock
                            label={t('dialog.world.info.youtube_preview')}
                            onClick={() => openExternalLink(previewUrl)}
                        >
                            <span className="flex items-center gap-1.5 text-sm leading-snug font-medium">
                                YouTube
                                <ExternalLinkIcon className="text-muted-foreground size-3.5" />
                            </span>
                        </EntityInfoBlock>
                    ) : null}
                    {domains.length ? (
                        <EntityInfoBlock
                            label={t(
                                'dialog.allowed_video_player_domains.header'
                            )}
                            value={t('dialog.world.info.video_domains_count', {
                                count: domains.length
                            })}
                            onClick={() => setDomainsOpen((open) => !open)}
                        />
                    ) : null}
                    {domainsOpen && domains.length ? (
                        <div className="col-span-full flex flex-wrap gap-1.5 pb-1">
                            {domains.map((url) => (
                                <Badge
                                    key={url}
                                    variant="outline"
                                    className="text-muted-foreground font-normal"
                                >
                                    {url}
                                </Badge>
                            ))}
                        </div>
                    ) : null}
                </EntityInfoSection>
            ) : null}
        </EntityInfoSections>
    );
}
