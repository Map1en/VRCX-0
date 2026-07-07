import { useTranslation } from 'react-i18next';

import {
    EmptyState as AppEmptyState,
    LoadingState as AppLoadingState
} from '@/components/layout/PageScaffold';

export function GraphLoadingState() {
    const { t } = useTranslation();

    return (
        <AppLoadingState
            className="min-h-80"
            label={t('view.charts.loading.loading_mutual_graph_snapshot')}
        />
    );
}

export function GraphEmptyState({ title, description }: any) {
    return (
        <AppEmptyState
            className="min-h-80"
            title={title}
            description={description}
            contentClassName="max-w-md"
        />
    );
}
