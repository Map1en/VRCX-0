import { UserIcon, UsersIcon } from 'lucide-react';

import { InstanceActionBar } from '@/components/instances/InstanceActionBar.jsx';
import { LocationWorld } from '@/components/LocationWorld.jsx';
import { timeToText } from '@/lib/dateTime.js';
import { openExternalLink } from '@/lib/entityMedia.js';
import { Badge } from '@/ui/shadcn/badge';

import {
    EntityDialogTabContent,
    EntityDialogTabs,
    EntityInfoBlock,
    EntityInfoGrid,
    EntityMemoTextarea,
    EntityRawJson
} from '../EntityDialogScaffold.jsx';
import { PreviousInstancesPanel } from '../PreviousInstancesTableDialog.jsx';
import {
    InstanceUserTiles,
    WorldInstancesEmptyState,
    resolveLaunchLocation
} from './WorldDialogViewParts.jsx';

export function WorldDialogTabPanels({ handlers, helpers, state, t }) {
    const {
        activeTab,
        authorTags,
        currentUserId,
        displayInstanceRows,
        favoriteRate,
        hasPersistData,
        isInstanceLocation,
        lastVisitedInstance,
        memo,
        previousInstances,
        previewUrl,
        tabs,
        totalVisitTime,
        world,
        worldDialogShortName
    } = state;
    const {
        onChangeTab,
        onOpenAuthor,
        onPreviousInstancesChange,
        onSaveMemo
    } = handlers;
    const { formatDate } = helpers;

    return (
        <EntityDialogTabs value={activeTab} onValueChange={onChangeTab} tabs={tabs}>
            <EntityDialogTabContent
                value="instances"
                className="flex flex-col gap-4"
            >
                <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="inline-flex items-center gap-1">
                        <UserIcon className="size-4" />
                        {t('dialog.world.generated.public')}{' '}
                        {world.publicOccupants ?? 0}
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <UserIcon className="size-4" />
                        {t('dialog.world.generated.private')}{' '}
                        {world.privateOccupants ?? 0}
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <UsersIcon className="size-4" />
                        {t('dialog.world.info.capacity')}{' '}
                        {world.recommendedCapacity || '—'} /{' '}
                        {world.capacity || '—'}
                    </span>
                </div>
                <div className="flex flex-col gap-2">
                    {displayInstanceRows.length ? (
                        displayInstanceRows.map((instance) => {
                            const location = resolveLaunchLocation(world, instance);
                            const shortName = instance.shortName || '';
                            const launchToken =
                                instance.shortName || instance.secureName || '';
                            return (
                                <div
                                    key={instance.id}
                                    className="rounded-md border px-3 py-2 text-sm"
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <LocationWorld
                                            locationObject={{
                                                ...(instance.ref || {}),
                                                ...instance,
                                                tag: location,
                                                location,
                                                shortName,
                                                launchToken
                                            }}
                                            currentUserId={currentUserId}
                                            worldDialogShortName={
                                                worldDialogShortName
                                            }
                                            grouphint={
                                                instance.groupName ||
                                                instance.group?.name ||
                                                ''
                                            }
                                            hint={
                                                world.name ||
                                                instance.worldName ||
                                                instance.world?.name ||
                                                ''
                                            }
                                        />
                                        <InstanceActionBar
                                            location={location}
                                            launchLocation={location}
                                            inviteLocation={location}
                                            instanceLocation={location}
                                            shortName={launchToken}
                                            worldName={
                                                world.name ||
                                                instance.worldName ||
                                                instance.world?.name ||
                                                ''
                                            }
                                            instance={instance}
                                            friendCount={
                                                Number(instance.friendCount) ||
                                                undefined
                                            }
                                            playerCount={
                                                instance.playerCount ??
                                                instance.userCount ??
                                                instance.occupants
                                            }
                                            showHistory={Boolean(
                                                previousInstances.length
                                            )}
                                            historyTooltip="Visit history"
                                            onHistory={() =>
                                                onChangeTab('visit-history')
                                            }
                                        />
                                    </div>
                                    <InstanceUserTiles instance={instance} />
                                </div>
                            );
                        })
                    ) : !isInstanceLocation ? (
                        <WorldInstancesEmptyState />
                    ) : null}
                </div>
            </EntityDialogTabContent>
            <EntityDialogTabContent
                value="visit-history"
                className="flex min-h-0 flex-col"
            >
                <PreviousInstancesPanel
                    title={t('dialog.world.generated.visit_history')}
                    instances={previousInstances}
                    variant="world"
                    targetRef={world}
                    onRowsChange={onPreviousInstancesChange}
                    className="flex-1"
                />
            </EntityDialogTabContent>
            <EntityDialogTabContent value="info" forceMount>
                <EntityInfoGrid>
                    <EntityMemoTextarea
                        label={t('dialog.world.generated.memo')}
                        value={memo}
                        placeholder={t('dialog.world.generated.memo')}
                        onSave={onSaveMemo}
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.generated.world_id')}
                        value={world.id}
                        mono
                        full
                    />
                    {previewUrl ? (
                        <EntityInfoBlock
                            label={t('dialog.world.generated.youtube_preview')}
                            wide
                            onClick={() => openExternalLink(previewUrl)}
                        >
                            <span className="block truncate text-xs">
                                {previewUrl}
                            </span>
                        </EntityInfoBlock>
                    ) : null}
                    <EntityInfoBlock
                        label={t('dialog.world.generated.author')}
                        onClick={world.authorId ? onOpenAuthor : undefined}
                    >
                        <span className="block truncate text-xs">
                            {world.authorName || '—'}
                        </span>
                    </EntityInfoBlock>
                    <EntityInfoBlock
                        label={t('dialog.world.generated.players')}
                        value={world.occupants ? String(world.occupants) : '—'}
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.generated.favorites')}
                        value={
                            world.favorites
                                ? `${world.favorites}${favoriteRate ? ` (${favoriteRate}%)` : ''}`
                                : '—'
                        }
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.info.visits')}
                        value={world.visits ? String(world.visits) : '—'}
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.info.capacity')}
                        value={`${world.recommendedCapacity || '—'} (${world.capacity || '—'})`}
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.generated.created')}
                        value={formatDate(world.createdAt || world.created_at)}
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.generated.last_updated')}
                        value={formatDate(world.updatedAt || world.updated_at)}
                    />
                    {world.labsPublicationDate &&
                    world.labsPublicationDate !== 'none' ? (
                        <EntityInfoBlock
                            label={t('dialog.world.info.labs_publication_date')}
                            value={formatDate(world.labsPublicationDate)}
                        />
                    ) : null}
                    <EntityInfoBlock
                        label={t('dialog.world.info.publication_date')}
                        value={formatDate(world.publicationDate)}
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.generated.last_visited')}
                        value={formatDate(
                            lastVisitedInstance?.created_at ||
                                lastVisitedInstance?.createdAt
                        )}
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.info.visit_count')}
                        value={
                            previousInstances.length
                                ? String(previousInstances.length)
                                : '—'
                        }
                        onClick={
                            previousInstances.length
                                ? () => onChangeTab('visit-history')
                                : undefined
                        }
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.generated.time_spent')}
                        value={
                            totalVisitTime > 0
                                ? timeToText(totalVisitTime)
                                : '—'
                        }
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.generated.version')}
                        value={world.version ? String(world.version) : '—'}
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.info.heat')}
                        value={world.heat ? String(world.heat) : '—'}
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.generated.popularity')}
                        value={
                            world.popularity ? String(world.popularity) : '—'
                        }
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.generated.persistent_data')}
                        value={hasPersistData ? 'Available' : '—'}
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.generated.platform')}
                        full
                    >
                        <span className="block text-xs whitespace-normal">
                            {world.platforms?.join(', ') || '—'}
                        </span>
                    </EntityInfoBlock>
                    {Array.isArray(world.urlList) && world.urlList.length ? (
                        <EntityInfoBlock
                            label={t(
                                'dialog.allowed_video_player_domains.header'
                            )}
                            full
                        >
                            <div className="flex flex-wrap gap-1.5">
                                {world.urlList.map((url) => (
                                    <Badge key={url} variant="outline">
                                        {url}
                                    </Badge>
                                ))}
                            </div>
                        </EntityInfoBlock>
                    ) : null}
                    {authorTags.length ? (
                        <EntityInfoBlock
                            label={t('dialog.world.info.author_tags')}
                            full
                        >
                            <div className="flex flex-wrap gap-1.5">
                                {authorTags.map((tag) => (
                                    <Badge key={tag} variant="outline">
                                        {tag}
                                    </Badge>
                                ))}
                            </div>
                        </EntityInfoBlock>
                    ) : null}
                </EntityInfoGrid>
            </EntityDialogTabContent>
            <EntityDialogTabContent value="json">
                <EntityRawJson
                    value={{
                        world,
                        memo,
                        hasPersistData,
                        fileAnalysis: world.fileAnalysis || {}
                    }}
                />
            </EntityDialogTabContent>
        </EntityDialogTabs>
    );
}
