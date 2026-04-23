import { EmptyState as AppEmptyState } from '@/components/layout/PageScaffold.jsx';
import { Spinner } from '@/ui/shadcn/spinner';

export function UserDialogEmptyState({ title, description, loading = false }) {
    return (
        <AppEmptyState
            className="min-h-56"
            title={title}
            description={description}
            icon={loading ? Spinner : undefined}
        />
    );
}
