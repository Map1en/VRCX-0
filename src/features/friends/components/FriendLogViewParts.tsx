import type { TFunction } from 'i18next';
import {
    ArrowRightIcon,
    CheckIcon,
    ChevronDownIcon,
    ListFilterIcon,
    PencilIcon,
    SendIcon,
    ShieldCheckIcon,
    UserMinusIcon,
    UserPlusIcon,
    XIcon,
    type LucideIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DataTableSortButton } from '@/components/data-table/DataTableSortButton';
import { EmptyState } from '@/components/layout/PageScaffold';
import { cn } from '@/lib/utils';
import { openUserDialog } from '@/services/dialogService';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

export const FRIEND_LOG_TYPES = [
    'Friend',
    'Unfriend',
    'FriendRequest',
    'CancelFriendRequest',
    'DisplayName',
    'TrustLevel'
] as const;

type FriendLogType = (typeof FRIEND_LOG_TYPES)[number];

const FRIEND_LOG_TYPE_GROUPS = [
    {
        labelKey: 'view.friend_log.groups.relationships',
        types: ['Friend', 'Unfriend']
    },
    {
        labelKey: 'view.friend_log.groups.requests',
        types: ['FriendRequest', 'CancelFriendRequest']
    },
    {
        labelKey: 'view.friend_log.groups.profile_changes',
        types: ['DisplayName', 'TrustLevel']
    }
] as const satisfies ReadonlyArray<{
    labelKey: string;
    types: readonly FriendLogType[];
}>;

const FRIEND_LOG_TYPE_META: Record<
    FriendLogType,
    { Icon: LucideIcon; iconClassName: string }
> = {
    Friend: { Icon: UserPlusIcon, iconClassName: 'text-emerald-500' },
    Unfriend: { Icon: UserMinusIcon, iconClassName: 'text-muted-foreground' },
    FriendRequest: { Icon: SendIcon, iconClassName: 'text-sky-500' },
    CancelFriendRequest: {
        Icon: XIcon,
        iconClassName: 'text-muted-foreground'
    },
    DisplayName: { Icon: PencilIcon, iconClassName: 'text-muted-foreground' },
    TrustLevel: {
        Icon: ShieldCheckIcon,
        iconClassName: 'text-muted-foreground'
    }
};

export { DataTableSortButton as SortButton };

export function FriendLogEmptyState({ title, description }: any) {
    return <EmptyState title={title} description={description} />;
}

function isFriendLogType(type: unknown): type is FriendLogType {
    return (
        typeof type === 'string' &&
        (FRIEND_LOG_TYPES as readonly string[]).includes(type)
    );
}

export function friendLogTypeLabel(type: unknown, t: TFunction) {
    return isFriendLogType(type) ? t(`view.friend_log.filters.${type}`) : '';
}

function FriendLogTypeIcon({ type }: { type: unknown }) {
    if (!isFriendLogType(type)) {
        return null;
    }
    const { Icon, iconClassName } = FRIEND_LOG_TYPE_META[type];
    return (
        <Icon aria-hidden="true" className={cn('size-3.5', iconClassName)} />
    );
}

export function FriendLogTypeIndicator({ type }: { type: unknown }) {
    const { t } = useTranslation();
    const label = friendLogTypeLabel(type, t) || String(type || '');
    return (
        <span className="inline-flex min-w-0 items-center gap-1.5">
            <FriendLogTypeIcon type={type} />
            <span className="text-foreground/80 truncate text-sm font-normal">
                {label}
            </span>
        </span>
    );
}

export function FriendLogTypeFilterDropdown({
    value,
    onChange
}: {
    value: string[];
    onChange: (value: string[]) => void;
}) {
    const { t } = useTranslation();
    const valueSet = new Set(value);
    const label =
        value.length === 0
            ? t('view.friend_log.all_types')
            : value.length === 1
              ? friendLogTypeLabel(value[0], t)
              : t('view.friend_log.selected_types', { count: value.length });

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        variant="outline"
                        className="min-w-56 justify-start"
                    >
                        <ListFilterIcon
                            data-icon="inline-start"
                            className="text-muted-foreground"
                        />
                        <span className="min-w-0 flex-1 truncate text-left">
                            {label}
                        </span>
                        <ChevronDownIcon
                            data-icon="inline-end"
                            className="text-muted-foreground"
                        />
                    </Button>
                }
            />
            <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => onChange([])}>
                        {t('view.friend_log.all_types')}
                        <CheckIcon
                            className={cn(
                                'ml-auto',
                                value.length > 0 && 'opacity-0'
                            )}
                        />
                    </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                {FRIEND_LOG_TYPE_GROUPS.map((group) => (
                    <DropdownMenuGroup key={group.labelKey}>
                        <DropdownMenuLabel>
                            {t(group.labelKey)}
                        </DropdownMenuLabel>
                        {group.types.map((type) => (
                            <DropdownMenuCheckboxItem
                                key={type}
                                checked={valueSet.has(type)}
                                onClick={(event) => event.preventDefault()}
                                onCheckedChange={(checked) => {
                                    onChange(
                                        checked
                                            ? [...value, type]
                                            : value.filter(
                                                  (entry) => entry !== type
                                              )
                                    );
                                }}
                            >
                                <FriendLogTypeIcon type={type} />
                                {friendLogTypeLabel(type, t)}
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuGroup>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function renderUserCell(row: any) {
    const displayName =
        row?.resolvedDisplayName || row?.displayName || row?.userId || '';
    const userLabel = row?.userId ? (
        <Button
            type="button"
            variant="ghost"
            className="hover:text-primary h-auto justify-start p-0 text-left text-sm font-medium"
            onClick={() =>
                openUserDialog({
                    userId: row.userId,
                    title: displayName
                })
            }
        >
            {displayName}
        </Button>
    ) : (
        <div className="text-sm font-medium">{displayName}</div>
    );

    if (row?.type === 'DisplayName') {
        return (
            <div className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
                <span className="text-muted-foreground">
                    {row.previousDisplayName || ''}
                </span>
                <ArrowRightIcon className="text-muted-foreground size-3.5" />
                {userLabel}
            </div>
        );
    }

    if (row?.type === 'TrustLevel') {
        return (
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                {userLabel}
                <span className="inline-flex items-center gap-1">
                    <span className="text-muted-foreground">
                        {row.previousTrustLevel || ''}
                    </span>
                    <ArrowRightIcon className="text-muted-foreground size-3.5" />
                    <span className="font-medium">{row.trustLevel || ''}</span>
                </span>
            </div>
        );
    }

    return userLabel;
}
