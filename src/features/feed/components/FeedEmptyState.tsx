import { RssIcon, SearchXIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/layout/PageScaffold';
import { Button } from '@/ui/shadcn/button';

export type FeedEmptyFilterModel = {
    hasActiveFilters: boolean;
    onClearFilters(): void;
};

export function FeedEmptyState({
    hasActiveFilters,
    onClearFilters
}: FeedEmptyFilterModel) {
    const { t } = useTranslation();

    if (hasActiveFilters) {
        return (
            <EmptyState
                variant="table"
                className="text-foreground"
                icon={SearchXIcon}
                title={t(
                    'view.feed.empty.no_feed_rows_match_the_current_filters'
                )}
            >
                <Button type="button" variant="link" onClick={onClearFilters}>
                    {t('empty_state.clear_search_and_filters')}
                </Button>
            </EmptyState>
        );
    }

    return (
        <EmptyState
            variant="table"
            className="text-foreground"
            icon={RssIcon}
            title={t('empty_state.feed_title')}
            description={t('empty_state.feed_description')}
        />
    );
}
