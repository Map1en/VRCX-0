import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService';

import type { QuickSearchResult } from '../quickSearchCatalog';

export function useQuickSearchSelectResult({
    onOpenChange,
    setQuery
}: {
    onOpenChange: (open: boolean) => void;
    setQuery: (query: string) => void;
}) {
    return function selectResult(item: QuickSearchResult) {
        onOpenChange(false);
        setQuery('');
        if (item.type === 'friend') {
            openUserDialog({
                userId: item.id,
                title: item.name,
                seedData: item.seedData || null
            });
        } else if (item.type === 'avatar') {
            openAvatarDialog({
                avatarId: item.id,
                title: item.name,
                seedData: item.seedData || null
            });
        } else if (item.type === 'world') {
            openWorldDialog({
                worldId: item.id,
                title: item.name,
                seedData: item.seedData || null
            });
        } else if (item.type === 'group') {
            openGroupDialog({
                groupId: item.id,
                title: item.name,
                seedData: item.seedData || null
            });
        }
    };
}
