import {
    FolderIcon,
    MoreHorizontalIcon,
    Trash2Icon,
    UsersRoundIcon
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GroupCard } from '@/components/groups/GroupCard';
import {
    EmptyState,
    PageScaffold,
    PageToolbar,
    PageToolbarRow
} from '@/components/layout/PageScaffold';
import {
    ToolbarActions,
    ToolbarRefreshButton,
    ToolbarSearch
} from '@/components/layout/ToolbarControls';
import type { GroupProfileRecord } from '@/domain/entities/group';
import {
    commands,
    type SavedGroupFavoritesSnapshot
} from '@/platform/tauri/bindings';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { openGroupDialog } from '@/services/dialogService';
import { toast } from '@/services/toastService';
import { useRuntimeStore } from '@/state/runtimeStore';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from '@/ui/shadcn/alert-dialog';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup
} from '@/ui/shadcn/resizable';

import { GroupRailSection } from './components/FavoritesGroupRail';
import type { FavoriteGroupView } from './favoritesTypes';

const SAVED_GROUP_FAVORITES_CHANGED_EVENT = 'saved-group-favorites-changed';

function SavedGroupFavoriteCard({
    busy,
    groupId,
    profile,
    onRemove
}: {
    busy: boolean;
    groupId: string;
    profile?: GroupProfileRecord;
    onRemove(groupId: string): void;
}) {
    const { t } = useTranslation();
    const group = profile || { id: groupId, name: groupId };

    return (
        <GroupCard
            group={group}
            onClick={() =>
                openGroupDialog({
                    groupId,
                    title: profile?.name
                })
            }
            actions={
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={
                            <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                disabled={busy}
                                aria-label={t('common.actions.configure')}
                            >
                                <MoreHorizontalIcon data-icon="inline-start" />
                            </Button>
                        }
                    />
                    <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuGroup>
                            <DropdownMenuItem
                                variant="destructive"
                                disabled={busy}
                                onClick={() => onRemove(groupId)}
                            >
                                <Trash2Icon data-icon="inline-start" />
                                {t('saved_group_favorites.remove')}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
            }
        />
    );
}

export function SavedGroupFavoritesPage() {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const [snapshot, setSnapshot] = useState<SavedGroupFavoritesSnapshot>({
        collections: []
    });
    const [profiles, setProfiles] = useState<Map<string, GroupProfileRecord>>(
        new Map()
    );
    const [selectedCollectionId, setSelectedCollectionId] = useState('');
    const [newCollectionName, setNewCollectionName] = useState('');
    const [creatingCollection, setCreatingCollection] = useState(false);
    const [deletingCollectionId, setDeletingCollectionId] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            if (!currentUserId) {
                setSnapshot({ collections: [] });
                setProfiles(new Map());
                return;
            }
            const next = await commands.appSavedGroupFavoritesGet();
            setSnapshot(next);
            const groupIds = Array.from(
                new Set(
                    next.collections.flatMap(
                        (collection) => collection.groupIds
                    )
                )
            );
            const results = await Promise.allSettled(
                groupIds.map((groupId) =>
                    groupProfileRepository.fetchGroupProfile({
                        groupId,
                        includeRoles: false
                    })
                )
            );
            setProfiles(
                new Map(
                    results.flatMap((result) =>
                        result.status === 'fulfilled'
                            ? [[result.value.id, result.value] as const]
                            : []
                    )
                )
            );
        } finally {
            setLoading(false);
        }
    }, [currentUserId]);

    useEffect(() => {
        const refresh = () => void load().catch(showError);
        refresh();
        window.addEventListener(SAVED_GROUP_FAVORITES_CHANGED_EVENT, refresh);
        return () =>
            window.removeEventListener(
                SAVED_GROUP_FAVORITES_CHANGED_EVENT,
                refresh
            );
    }, [load]);

    useEffect(() => {
        if (
            selectedCollectionId &&
            snapshot.collections.some(
                (collection) => collection.id === selectedCollectionId
            )
        ) {
            return;
        }
        setSelectedCollectionId(snapshot.collections[0]?.id || '');
    }, [selectedCollectionId, snapshot.collections]);

    const collections = useMemo<FavoriteGroupView[]>(
        () =>
            snapshot.collections.map((collection) => ({
                key: collection.id,
                source: 'local',
                label: collection.name,
                count: collection.groupIds.length
            })),
        [snapshot.collections]
    );
    const selectedCollection = useMemo(
        () =>
            snapshot.collections.find(
                (collection) => collection.id === selectedCollectionId
            ),
        [selectedCollectionId, snapshot.collections]
    );
    const visibleGroupIds = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!selectedCollection || !query) {
            return selectedCollection?.groupIds || [];
        }
        return selectedCollection.groupIds.filter((groupId) => {
            const profile = profiles.get(groupId);
            return (
                groupId.toLowerCase().includes(query) ||
                profile?.name.toLowerCase().includes(query)
            );
        });
    }, [profiles, searchQuery, selectedCollection]);
    const deletingCollection = snapshot.collections.find(
        (collection) => collection.id === deletingCollectionId
    );

    async function mutate(operation: () => Promise<unknown>) {
        setBusy(true);
        try {
            await operation();
            window.dispatchEvent(
                new Event(SAVED_GROUP_FAVORITES_CHANGED_EVENT)
            );
        } catch (error) {
            showError(error);
        } finally {
            setBusy(false);
        }
    }

    function createCollection() {
        const name = newCollectionName.trim();
        if (!name) {
            return;
        }
        void mutate(async () => {
            await commands.appSavedGroupCollectionCreate({ name });
            setNewCollectionName('');
            setCreatingCollection(false);
        });
    }

    function removeFavorite(groupId: string) {
        void mutate(() => commands.appSavedGroupFavoriteRemove({ groupId }));
    }

    return (
        <PageScaffold className="flex-1" flushBottom>
            <PageToolbar>
                <PageToolbarRow>
                    <ToolbarSearch
                        className="ms-auto"
                        value={searchQuery}
                        onValueChange={setSearchQuery}
                        placeholder={t('common.actions.search')}
                    />
                    <ToolbarActions>
                        <ToolbarRefreshButton
                            onRefresh={() => void load().catch(showError)}
                            loading={loading}
                        />
                    </ToolbarActions>
                </PageToolbarRow>
            </PageToolbar>

            <div className="flex h-full min-h-0 min-w-0 flex-1">
                <ResizablePanelGroup
                    id="saved-group-favorites-splitter"
                    orientation="horizontal"
                    className="h-full min-h-0 min-w-0 flex-1"
                >
                    <ResizablePanel
                        id="saved-group-favorites-groups"
                        defaultSize={288}
                        minSize={0}
                        className="min-w-0"
                        collapsible
                        collapsedSize={0}
                        groupResizeBehavior="preserve-pixel-size"
                    >
                        <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-2">
                            <GroupRailSection
                                title={t('saved_group_favorites.title')}
                                icon={FolderIcon}
                                emptyTitle={t(
                                    'saved_group_favorites.empty_collections'
                                )}
                                emptyDescription={t(
                                    'saved_group_favorites.description'
                                )}
                                groups={collections}
                                selectedSource="local"
                                selectedGroupKey={selectedCollectionId}
                                loading={loading}
                                creating={creatingCollection}
                                newGroupName={newCollectionName}
                                newGroupLabel={t(
                                    'saved_group_favorites.new_collection'
                                )}
                                showNewGroup
                                onSelect={(group) => {
                                    setSearchQuery('');
                                    setSelectedCollectionId(group.key);
                                }}
                                onStartCreate={() => {
                                    setNewCollectionName('');
                                    setCreatingCollection(true);
                                }}
                                onNewGroupNameChange={setNewCollectionName}
                                onConfirmCreate={createCollection}
                                onCancelCreate={() => {
                                    setNewCollectionName('');
                                    setCreatingCollection(false);
                                }}
                                onLocalDelete={(group) =>
                                    setDeletingCollectionId(group.key)
                                }
                            />
                        </div>
                    </ResizablePanel>
                    <ResizableHandle withHandle />
                    <ResizablePanel
                        id="saved-group-favorites-content"
                        minSize={320}
                        className="min-w-0"
                    >
                        <div className="flex h-full min-h-0 min-w-0 flex-col px-5 pb-4">
                            <div className="mb-3 flex min-w-0 items-center justify-between gap-3 pl-0.5">
                                <div className="flex min-w-0 flex-col gap-0.5 text-base font-semibold">
                                    <span className="truncate">
                                        {selectedCollection?.name ||
                                            t(
                                                'view.favorites.empty.no_group_selected'
                                            )}
                                    </span>
                                    {selectedCollection ? (
                                        <small className="text-muted-foreground truncate text-xs font-normal tabular-nums">
                                            {selectedCollection.groupIds.length}
                                        </small>
                                    ) : null}
                                </div>
                            </div>
                            <div className="min-h-0 min-w-0 flex-1 overflow-auto pr-1">
                                {loading && !snapshot.collections.length ? (
                                    <EmptyState
                                        variant="panel"
                                        description={t(
                                            'view.favorite.loading.loading_favorites_baseline'
                                        )}
                                    />
                                ) : !selectedCollection ? (
                                    <EmptyState
                                        variant="panel"
                                        icon={FolderIcon}
                                        title={t(
                                            'saved_group_favorites.empty_collections'
                                        )}
                                        description={t(
                                            'saved_group_favorites.description'
                                        )}
                                    />
                                ) : !visibleGroupIds.length ? (
                                    <EmptyState
                                        variant="panel"
                                        icon={UsersRoundIcon}
                                        title={
                                            searchQuery.trim()
                                                ? t(
                                                      'common.no_matching_records'
                                                  )
                                                : t(
                                                      'saved_group_favorites.empty_group'
                                                  )
                                        }
                                        description={
                                            searchQuery.trim()
                                                ? t(
                                                      'view.favorite.label.try_a_different_search_term'
                                                  )
                                                : undefined
                                        }
                                    />
                                ) : (
                                    <div className="grid [grid-template-columns:repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-3">
                                        {visibleGroupIds.map((groupId) => (
                                            <SavedGroupFavoriteCard
                                                key={groupId}
                                                busy={busy}
                                                groupId={groupId}
                                                profile={profiles.get(groupId)}
                                                onRemove={removeFavorite}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </ResizablePanel>
                </ResizablePanelGroup>
            </div>

            <AlertDialog
                open={Boolean(deletingCollection)}
                onOpenChange={(open) => {
                    if (!open) {
                        setDeletingCollectionId('');
                    }
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t('saved_group_favorites.delete_title')}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('saved_group_favorites.delete_description', {
                                name: deletingCollection?.name,
                                count: deletingCollection?.groupIds.length || 0
                            })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>
                            {t('common.actions.cancel')}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={busy}
                            onClick={() => {
                                if (!deletingCollection) {
                                    return;
                                }
                                void mutate(() =>
                                    commands.appSavedGroupCollectionDelete({
                                        collectionId: deletingCollection.id
                                    })
                                );
                                setDeletingCollectionId('');
                            }}
                        >
                            {t('common.actions.delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </PageScaffold>
    );
}

function showError(error: unknown) {
    toast.add({
        type: 'error',
        title: error instanceof Error ? error.message : String(error)
    });
}
