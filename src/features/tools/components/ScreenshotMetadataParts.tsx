import { CameraIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ComponentProps } from 'react';

import { DataTableSortButton } from '@/components/data-table/DataTableSortButton';
import { EmptyState as AppEmptyState } from '@/components/layout/PageScaffold';
import type { AuthorDetail } from '@/platform/tauri/bindings';
import userProfileRepository from '@/repositories/userProfileRepository';
import { openUserDialog } from '@/services/dialogService';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import type { ScreenshotSearchSort } from '../screenshotMetadataValues';

export function EmptyState({
    title,
    description,
    loading = false
}: Pick<ComponentProps<typeof AppEmptyState>, 'title' | 'description'> & {
    loading?: boolean;
}) {
    return (
        <AppEmptyState
            className="min-h-72"
            title={title}
            description={description}
            icon={loading ? Spinner : undefined}
        />
    );
}

export function SearchSortHead({
    label,
    sortKey,
    sort,
    onToggle,
    className = ''
}: {
    label: string;
    sortKey: string;
    sort: ScreenshotSearchSort;
    onToggle: (key: string) => void;
    className?: string;
}) {
    const active = sort?.key === sortKey;

    return (
        <DataTableSortButton
            active={active}
            direction={active ? (sort.asc ? 'asc' : 'desc') : false}
            label={label}
            onSort={() => onToggle(sortKey)}
            className={className}
        />
    );
}

export function MetadataAuthorLink({ author }: { author: AuthorDetail }) {
    const userId = String(author?.id || '').trim();
    const hint = String(author?.displayName || '').trim();
    const [displayName, setDisplayName] = useState(hint || userId);

    useEffect(() => {
        let active = true;
        setDisplayName(hint || userId);
        if (!userId || hint) {
            return () => {
                active = false;
            };
        }

        userProfileRepository
            .getUserProfile({ userId })
            .then((profile) => {
                if (active) {
                    setDisplayName(
                        profile?.displayName || profile?.username || userId
                    );
                }
            })
            .catch(() => {});

        return () => {
            active = false;
        };
    }, [hint, userId]);

    if (!userId) {
        return <div className="text-sm">{hint || '—'}</div>;
    }

    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        className="text-muted-foreground hover:text-primary h-auto justify-start gap-1 p-0 text-left"
                        onClick={() =>
                            openUserDialog({
                                userId,
                                title: displayName || userId
                            })
                        }
                    >
                        <CameraIcon data-icon="inline-start" />
                        <span className="truncate">
                            {displayName || userId}
                        </span>
                    </Button>
                }
            />
            <TooltipContent>{userId}</TooltipContent>
        </Tooltip>
    );
}
