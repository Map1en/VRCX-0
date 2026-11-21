import { UserIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { FadeInImage } from '@/components/media/FadeInImage';
import { UserStatusDot } from '@/components/UserStatusDot';
import { cn } from '@/lib/utils';

export type UserAvatarSize = 'sm' | 'lg';

const AVATAR_SIZES: Record<UserAvatarSize, { avatar: number; dot: number }> = {
    sm: { avatar: 32, dot: 8 },
    lg: { avatar: 40, dot: 9 }
};

const DOT_CENTER = '85.36%';
const DOT_RING_PX = 3;

export function UserStatusAvatar({
    imageUrl = '',
    statusDotClassName = '',
    size = 'lg',
    className = '',
    frame
}: {
    imageUrl?: string;
    statusDotClassName?: string;
    size?: UserAvatarSize;
    className?: string;
    frame?: ReactNode;
}) {
    const { avatar, dot } = AVATAR_SIZES[size];
    const dotOuter = dot + DOT_RING_PX * 2;
    const dotOffset = `calc(${DOT_CENTER} - ${dotOuter / 2}px)`;

    return (
        <span
            data-size={size}
            style={{ width: avatar, height: avatar }}
            className={cn(
                'relative flex shrink-0 items-center justify-center overflow-visible',
                className
            )}
        >
            <span className="bg-muted relative z-0 flex size-full items-center justify-center overflow-hidden rounded-full border">
                {imageUrl ? (
                    <FadeInImage
                        src={imageUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                        fallback={
                            <UserIcon
                                data-icon="inline-start"
                                className="text-muted-foreground"
                            />
                        }
                    />
                ) : (
                    <UserIcon
                        data-icon="inline-start"
                        className="text-muted-foreground"
                    />
                )}
            </span>
            {frame}
            <UserStatusDot
                statusDotClassName={statusDotClassName}
                style={{
                    width: dotOuter,
                    height: dotOuter,
                    left: dotOffset,
                    top: dotOffset
                }}
                className="absolute z-10"
            />
        </span>
    );
}
