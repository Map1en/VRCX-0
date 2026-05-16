// @ts-nocheck
import { GlobeIcon, ImageIcon, UserIcon, UsersIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { CommandGroup, CommandItem } from '@/ui/shadcn/command';

export function entityTypeLabel(type) {
    switch (type) {
        case 'friend':
            return 'User';
        case 'avatar':
            return 'Avatar';
        case 'world':
            return 'World';
        case 'group':
            return 'Group';
        default:
            return 'Result';
    }
}

function ResultRow({ item, onSelect }) {
    const Icon =
        item.type === 'friend'
            ? UserIcon
            : item.type === 'avatar'
              ? ImageIcon
              : item.type === 'world'
                ? GlobeIcon
                : UsersIcon;
    const isFriend = item.type === 'friend';

    return (
        <CommandItem
            value={[item.name, item.memo, item.note, item.id]
                .filter(Boolean)
                .join(' ')}
            className="gap-3"
            onSelect={() => onSelect(item)}
        >
            {item.imageUrl ? (
                <img
                    src={item.imageUrl}
                    alt=""
                    className={cn(
                        'size-6 shrink-0 object-cover',
                        isFriend ? 'rounded-full' : 'rounded'
                    )}
                    loading="lazy"
                />
            ) : (
                <Icon className="size-4 shrink-0" />
            )}
            {isFriend ? (
                <div className="flex min-w-0 flex-1 flex-col">
                    <span
                        className="truncate"
                        style={
                            item.userColour ? { color: item.userColour } : null
                        }
                    >
                        {item.name || entityTypeLabel(item.type)}
                    </span>
                    {item.matchedField !== 'name' && item.memo ? (
                        <span className="text-muted-foreground truncate text-xs">
                            Memo: {item.memo}
                        </span>
                    ) : null}
                    {item.matchedField !== 'name' && item.note ? (
                        <span className="text-muted-foreground truncate text-xs">
                            Note: {item.note}
                        </span>
                    ) : null}
                </div>
            ) : (
                <span className="min-w-0 flex-1 truncate">
                    {item.name || entityTypeLabel(item.type)}
                </span>
            )}
        </CommandItem>
    );
}

export function ResultGroup({ title, items, onSelect }) {
    if (!items.length) {
        return null;
    }
    return (
        <CommandGroup heading={title}>
            {items.map((item) => (
                <ResultRow
                    key={`${item.type}:${item.source}:${item.id}`}
                    item={item}
                    onSelect={onSelect}
                />
            ))}
        </CommandGroup>
    );
}
