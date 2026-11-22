import {
    GlobeIcon,
    type LucideIcon,
    PersonStandingIcon,
    UsersRoundIcon
} from 'lucide-react';

import { FadeInImage } from '@/components/media/FadeInImage';
import { cn } from '@/lib/utils';

export type EntityAvatarKind = 'group' | 'world' | 'avatar';
export type EntityAvatarSize = 'lg' | 'xl';

const SIZE_CLASS_NAMES: Record<EntityAvatarSize, string> = {
    lg: 'h-10 rounded-[10px]',
    xl: 'h-12 rounded-xl'
};

const WIDTH_CLASS_NAMES: Record<
    EntityAvatarSize,
    { square: string; landscape: string }
> = {
    lg: { square: 'w-10', landscape: 'w-[53px]' },
    xl: { square: 'w-12', landscape: 'w-16' }
};

const FALLBACK_ICONS: Record<EntityAvatarKind, LucideIcon> = {
    group: UsersRoundIcon,
    world: GlobeIcon,
    avatar: PersonStandingIcon
};

export function entityAvatarFrameClassName(
    kind: EntityAvatarKind,
    size: EntityAvatarSize = 'lg'
) {
    return cn(
        'bg-muted after:ring-foreground/10 relative flex shrink-0 items-center justify-center overflow-hidden after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:ring-inset',
        SIZE_CLASS_NAMES[size],
        WIDTH_CLASS_NAMES[size][kind === 'world' ? 'landscape' : 'square']
    );
}

export function EntityAvatar({
    kind,
    imageUrl = '',
    size = 'lg',
    className
}: {
    kind: EntityAvatarKind;
    imageUrl?: string;
    size?: EntityAvatarSize;
    className?: string;
}) {
    const FallbackIcon = FALLBACK_ICONS[kind];
    const fallback = (
        <FallbackIcon
            aria-hidden="true"
            className="text-muted-foreground size-4"
        />
    );

    return (
        <span
            data-kind={kind}
            className={cn(entityAvatarFrameClassName(kind, size), className)}
        >
            {imageUrl ? (
                <FadeInImage
                    src={imageUrl}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                    fallback={fallback}
                />
            ) : (
                fallback
            )}
        </span>
    );
}
