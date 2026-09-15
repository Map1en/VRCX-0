import {
    BanIcon,
    HandIcon,
    type LucideIcon,
    MessageSquareIcon,
    MessageSquareXIcon,
    UserRoundCheckIcon,
    Volume2Icon,
    VolumeXIcon
} from 'lucide-react';

import { DataTableSortButton } from '@/components/data-table/DataTableSortButton';
import { EmptyState } from '@/components/layout/PageScaffold';
import { ToolbarFilterMenu } from '@/components/layout/ToolbarControls';
import { cn } from '@/lib/utils';
import { moderationTypes } from '@/shared/constants/moderation';
import {
    DropdownMenuCheckboxItem,
    DropdownMenuGroup
} from '@/ui/shadcn/dropdown-menu';

const MODERATION_TYPE_META: Record<
    string,
    { Icon: LucideIcon; iconClassName: string }
> = {
    block: { Icon: BanIcon, iconClassName: 'text-destructive' },
    unblock: {
        Icon: UserRoundCheckIcon,
        iconClassName: 'text-muted-foreground'
    },
    mute: { Icon: VolumeXIcon, iconClassName: 'text-amber-500' },
    unmute: { Icon: Volume2Icon, iconClassName: 'text-muted-foreground' },
    muteChat: { Icon: MessageSquareXIcon, iconClassName: 'text-amber-500' },
    unmuteChat: {
        Icon: MessageSquareIcon,
        iconClassName: 'text-muted-foreground'
    },
    interactOff: { Icon: HandIcon, iconClassName: 'text-amber-500' },
    interactOn: { Icon: HandIcon, iconClassName: 'text-muted-foreground' }
};

export { DataTableSortButton as SortButton };

export function ModerationTypeIndicator({
    type,
    label
}: {
    type: string;
    label: string;
}) {
    const meta = MODERATION_TYPE_META[type];
    return (
        <span className="inline-flex min-w-0 items-center gap-1.5">
            {meta ? (
                <meta.Icon
                    aria-hidden="true"
                    className={cn('size-3.5 shrink-0', meta.iconClassName)}
                />
            ) : null}
            <span className="text-foreground/80 min-w-0 truncate text-sm font-normal">
                {label}
            </span>
        </span>
    );
}

type ModerationEmptyStateProps = {
    title?: string;
    description?: string;
};

type ModerationTypeFilterDropdownProps = {
    value?: string[];
    onChange: (value: string[]) => void;
    getTypeLabel: (type: string) => string;
    sanitizeTypes?: (types: string[]) => string[];
};

export function ModerationEmptyState({
    title,
    description
}: ModerationEmptyStateProps) {
    return <EmptyState title={title} description={description} />;
}

export function ModerationTypeFilterDropdown({
    value,
    onChange,
    getTypeLabel,
    sanitizeTypes = (types) => types
}: ModerationTypeFilterDropdownProps) {
    const selectedTypes = Array.isArray(value) ? value : [];

    return (
        <ToolbarFilterMenu activeCount={selectedTypes.length}>
            <DropdownMenuGroup>
                {moderationTypes.map((type) => (
                    <DropdownMenuCheckboxItem
                        key={type}
                        checked={selectedTypes.includes(type)}
                        onCheckedChange={(checked) => {
                            const next = checked
                                ? [...selectedTypes, type]
                                : selectedTypes.filter(
                                      (entry) => entry !== type
                                  );
                            onChange(sanitizeTypes(next));
                        }}
                        onClick={(event) => event.preventDefault()}
                    >
                        {getTypeLabel(type)}
                    </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuGroup>
        </ToolbarFilterMenu>
    );
}
