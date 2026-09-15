import { PlusIcon, StarIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    commands,
    type SavedGroupFavoritesSnapshot
} from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { useModalStore } from '@/state/modalStore';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

const SAVED_GROUP_FAVORITES_CHANGED_EVENT = 'saved-group-favorites-changed';

export function SavedGroupFavoriteButton({ groupId }: { groupId: string }) {
    const { t } = useTranslation();
    const [snapshot, setSnapshot] = useState<SavedGroupFavoritesSnapshot>({
        collections: []
    });
    const [busy, setBusy] = useState(false);
    const prompt = useModalStore((state) => state.prompt);

    const load = useCallback(async () => {
        setSnapshot(await commands.appSavedGroupFavoritesGet());
    }, []);

    useEffect(() => {
        void load().catch(showError);
    }, [load]);

    const favoriteCollection = snapshot.collections.find((collection) =>
        collection.groupIds.includes(groupId)
    );

    async function mutate(operation: () => Promise<unknown>) {
        setBusy(true);
        try {
            await operation();
            await load();
            window.dispatchEvent(
                new Event(SAVED_GROUP_FAVORITES_CHANGED_EVENT)
            );
        } catch (error) {
            showError(error);
        } finally {
            setBusy(false);
        }
    }

    async function createAndAdd() {
        const result = await prompt({
            title: t('saved_group_favorites.new_collection'),
            description: t('saved_group_favorites.empty_collections'),
            inputValue: '',
            confirmText: t('common.actions.confirm'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok || typeof result.value !== 'string') {
            return;
        }
        const name = result.value.trim();
        if (!name) {
            return;
        }
        void mutate(async () => {
            const previousIds = new Set(
                snapshot.collections.map((collection) => collection.id)
            );
            await commands.appSavedGroupCollectionCreate({ name });
            const next = await commands.appSavedGroupFavoritesGet();
            const collection = next.collections.find(
                (candidate) => !previousIds.has(candidate.id)
            );
            if (!collection) {
                throw new Error('Saved group collection was not created.');
            }
            await commands.appSavedGroupFavoriteAdd({
                collectionId: collection.id,
                groupId
            });
        });
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        size="icon-lg"
                        variant={favoriteCollection ? 'secondary' : 'outline'}
                        disabled={busy}
                        aria-label={t('saved_group_favorites.toggle', {
                            defaultValue: '群组收藏'
                        })}
                    >
                        <StarIcon
                            className={favoriteCollection ? 'fill-current' : ''}
                        />
                    </Button>
                }
            />
            <DropdownMenuContent align="end" className="w-64">
                {favoriteCollection ? (
                    <DropdownMenuGroup>
                        <DropdownMenuLabel>
                            {favoriteCollection.name}
                        </DropdownMenuLabel>
                        <DropdownMenuItem
                            variant="destructive"
                            disabled={busy}
                            onClick={() =>
                                void mutate(() =>
                                    commands.appSavedGroupFavoriteRemove({
                                        groupId
                                    })
                                )
                            }
                        >
                            <Trash2Icon />
                            {t('saved_group_favorites.remove', {
                                defaultValue: '取消收藏'
                            })}
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                ) : (
                    <>
                        <DropdownMenuGroup>
                            <DropdownMenuLabel>
                                {t('saved_group_favorites.choose_collection', {
                                    defaultValue: '收藏到分组'
                                })}
                            </DropdownMenuLabel>
                            {snapshot.collections.map((collection) => (
                                <DropdownMenuItem
                                    key={collection.id}
                                    disabled={busy}
                                    onClick={() =>
                                        void mutate(() =>
                                            commands.appSavedGroupFavoriteAdd({
                                                collectionId: collection.id,
                                                groupId
                                            })
                                        )
                                    }
                                >
                                    {collection.name}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuGroup>
                        {snapshot.collections.length ? (
                            <DropdownMenuSeparator />
                        ) : null}
                        <DropdownMenuGroup>
                            <DropdownMenuItem
                                disabled={busy}
                                onClick={() => {
                                    void createAndAdd();
                                }}
                            >
                                <PlusIcon data-icon="inline-start" />
                                {t('saved_group_favorites.new_collection')}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function showError(error: unknown) {
    toast.add({
        type: 'error',
        title: error instanceof Error ? error.message : String(error)
    });
}
