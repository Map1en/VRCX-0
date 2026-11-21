import type { ComponentProps, CSSProperties, ReactNode } from 'react';

import { UserHoverCard } from '@/components/user-hover-card/UserHoverCard';
import { UserListItemText } from '@/components/UserListItemText';
import {
    type UserAvatarSize,
    UserStatusAvatar
} from '@/components/UserStatusAvatar';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';

type UserListItemProps = {
    imageUrl?: string;
    statusDotClassName?: string;
    displayName: ReactNode;
    namePrefix?: ReactNode;
    nameSuffix?: ReactNode;
    nameStyle?: CSSProperties;
    subline?: ReactNode;
    size?: UserAvatarSize;
    userId?: string;
    seed?: ComponentProps<typeof UserHoverCard>['seed'];
    hoverSide?: ComponentProps<typeof UserHoverCard>['side'];
    hoverDisabled?: boolean;
    disabled?: boolean;
    className?: string;
    onOpen?: () => void;
};

export function UserListItem({
    imageUrl = '',
    statusDotClassName = '',
    displayName,
    namePrefix,
    nameSuffix,
    nameStyle,
    subline,
    size = 'lg',
    userId,
    seed = null,
    hoverSide,
    hoverDisabled = false,
    disabled = false,
    className,
    onOpen
}: UserListItemProps) {
    return (
        <UserHoverCard
            userId={userId}
            seed={seed}
            side={hoverSide}
            disabled={hoverDisabled || disabled}
        >
            <Button
                type="button"
                variant="ghost"
                disabled={disabled}
                data-size={size}
                className={cn(
                    'h-auto min-w-0 justify-start gap-2.5 px-2 text-left font-normal active:not-aria-[haspopup]:translate-y-0',
                    size === 'sm' ? 'py-1' : 'py-1.5',
                    className
                )}
                onClick={onOpen}
            >
                <UserStatusAvatar
                    imageUrl={imageUrl}
                    statusDotClassName={statusDotClassName}
                    size={size}
                />
                <UserListItemText
                    displayName={displayName}
                    namePrefix={namePrefix}
                    nameSuffix={nameSuffix}
                    nameStyle={nameStyle}
                    subline={subline}
                />
            </Button>
        </UserHoverCard>
    );
}
