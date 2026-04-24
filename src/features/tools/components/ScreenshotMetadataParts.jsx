import {
    ArrowDownIcon,
    ArrowUpDownIcon,
    ArrowUpIcon,
    CameraIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { EmptyState as AppEmptyState } from '@/components/layout/PageScaffold.jsx';
import { userProfileRepository } from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

export function EmptyState({ title, description, loading = false }) {
    return (
        <AppEmptyState
            className="min-h-72"
            title={title}
            description={description}
            icon={loading ? Spinner : undefined}
        />
    );
}

export function SearchSortHead({ label, sortKey, sort, onToggle }) {
    const active = sort?.key === sortKey;
    const Icon = active
        ? sort.asc
            ? ArrowUpIcon
            : ArrowDownIcon
        : ArrowUpDownIcon;

    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground h-auto justify-start px-0 py-0 text-left text-xs font-medium tracking-wide uppercase"
            onClick={() => onToggle(sortKey)}
        >
            <span>{label}</span>
            <Icon data-icon="inline-end" />
        </Button>
    );
}

export function MetadataAuthorLink({ author, endpoint }) {
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
            .getUserProfile({ userId, endpoint })
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
    }, [endpoint, hint, userId]);

    if (!userId) {
        return <div className="text-sm">{hint || '—'}</div>;
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>
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
                    <span className="truncate">{displayName || userId}</span>
                </Button>
            </TooltipTrigger>
            <TooltipContent>{userId}</TooltipContent>
        </Tooltip>
    );
}
