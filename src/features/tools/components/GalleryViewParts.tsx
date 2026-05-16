// @ts-nocheck
import {
    EmptyState as AppEmptyState,
    LoadingState as AppLoadingState
} from '@/components/layout/PageScaffold';

export function EmptyState({ title, description, children }) {
    return (
        <AppEmptyState
            className="min-h-72"
            title={title}
            description={description}
        >
            {children}
        </AppEmptyState>
    );
}

export function LoadingState() {
    return <AppLoadingState className="min-h-72" />;
}
