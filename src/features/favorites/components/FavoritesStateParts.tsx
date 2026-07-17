import type { ReactNode } from 'react';

import { EmptyState, LoadingState } from '@/components/layout/PageScaffold';

function FavoritesEmptyState({
    title,
    description
}: {
    title?: ReactNode;
    description?: ReactNode;
}) {
    return (
        <EmptyState
            variant="panel"
            title={title}
            description={description}
            className="h-full min-h-60 border-0 p-6"
        />
    );
}

function FavoritesLoadingState({ title }: { title?: ReactNode }) {
    return (
        <LoadingState
            variant="panel"
            label={title}
            className="h-full min-h-60 border-0 p-6"
        />
    );
}

export { FavoritesEmptyState, FavoritesLoadingState };
