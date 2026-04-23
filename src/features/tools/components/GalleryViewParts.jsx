import {
    EmptyState as AppEmptyState,
    LoadingState as AppLoadingState
} from '@/components/layout/PageScaffold.jsx';

export function EmptyState({ title, description }) {
    return (
        <AppEmptyState
            className="min-h-72"
            title={title}
            description={description}
        />
    );
}

export function LoadingState() {
    return <AppLoadingState className="min-h-72" />;
}
