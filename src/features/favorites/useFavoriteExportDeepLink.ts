import { useEffect } from 'react';
import { useSearchParams } from 'react-router';

import type { FavoriteKind } from '@/domain/favorites/types';

export function useFavoriteExportDeepLink({
    embedded,
    kind,
    setExportDialogOpen
}: {
    embedded: boolean;
    kind: FavoriteKind;
    setExportDialogOpen(open: boolean): void;
}) {
    const [searchParams, setSearchParams] = useSearchParams();
    const exportRequested = !embedded && searchParams.get('export') === '1';

    useEffect(() => {
        if (!exportRequested) {
            return;
        }
        setExportDialogOpen(true);
        setSearchParams(
            (params) => {
                params.delete('export');
                return params;
            },
            { replace: true }
        );
    }, [exportRequested, kind, setExportDialogOpen, setSearchParams]);
}
