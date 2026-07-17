import { useEffect, useState } from 'react';

import {
    createEmptyCatalog,
    loadQuickSearchCatalog
} from '../quickSearchCatalog';

export function useQuickSearchCatalogState({
    currentEndpoint,
    currentUserId,
    open
}: {
    currentEndpoint?: string | null;
    currentUserId?: string | null;
    open: boolean;
}) {
    const [catalog, setCatalog] = useState(() => createEmptyCatalog());

    useEffect(() => {
        if (!open || !currentUserId) {
            return;
        }

        let active = true;
        setCatalog(createEmptyCatalog('running'));
        loadQuickSearchCatalog({
            currentUserId,
            endpoint: currentEndpoint
        })
            .then((nextCatalog) => {
                if (active) {
                    setCatalog(nextCatalog);
                }
            })
            .catch((error: unknown) => {
                if (active) {
                    setCatalog(
                        createEmptyCatalog(
                            'error',
                            error instanceof Error
                                ? error.message
                                : 'Search index failed to load.'
                        )
                    );
                }
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, currentUserId, open]);

    return catalog;
}
