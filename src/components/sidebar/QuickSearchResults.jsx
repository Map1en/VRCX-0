import { GlobeIcon, ImageIcon, UserIcon, UsersIcon } from 'lucide-react';

import { Button } from '@/ui/shadcn/button';

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

    return (
        <Button
            type="button"
            variant="ghost"
            className="h-auto w-full justify-start gap-3 px-2 py-2 text-left font-normal"
            onClick={() => onSelect(item)}
        >
            <span className="bg-muted flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md [&>svg]:size-4">
                {item.imageUrl ? (
                    <img
                        src={item.imageUrl}
                        alt=""
                        className="size-full object-cover"
                        loading="lazy"
                    />
                ) : (
                    <Icon className="text-muted-foreground" />
                )}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                    {item.name || entityTypeLabel(item.type)}
                </span>
                {item.subtitle ? (
                    <span className="text-muted-foreground block truncate text-xs">
                        {item.subtitle}
                    </span>
                ) : null}
            </span>
        </Button>
    );
}

export function ResultGroup({ title, items, onSelect }) {
    if (!items.length) {
        return null;
    }
    return (
        <div className="py-1">
            <div className="text-muted-foreground px-2 py-1 text-xs font-medium">
                {title}
            </div>
            {items.map((item) => (
                <ResultRow
                    key={`${item.type}:${item.source}:${item.id}`}
                    item={item}
                    onSelect={onSelect}
                />
            ))}
        </div>
    );
}
