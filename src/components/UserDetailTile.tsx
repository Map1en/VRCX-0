import type { ComponentProps, CSSProperties, ReactNode } from 'react';

import { UserHoverCard } from '@/components/user-hover-card/UserHoverCard';
import { UserStatusAvatar } from '@/components/UserStatusAvatar';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';

type UserDetailContentProps = {
    imageUrl?: string;
    statusDotClassName?: string;
    displayName: ReactNode;
    nameStyle?: CSSProperties;
    subline?: ReactNode;
};

export function UserDetailContent({
    imageUrl = '',
    statusDotClassName = '',
    displayName,
    nameStyle,
    subline
}: UserDetailContentProps) {
    return (
        <>
            <UserStatusAvatar
                imageUrl={imageUrl}
                statusDotClassName={statusDotClassName}
            />
            <span className="min-w-0 flex-1 overflow-hidden">
                <span
                    className="block truncate leading-5 font-medium"
                    style={nameStyle}
                >
                    {displayName}
                </span>
                {subline ? (
                    <span className="text-muted-foreground block truncate text-xs">
                        {subline}
                    </span>
                ) : null}
            </span>
        </>
    );
}

type UserDetailTileProps = UserDetailContentProps & {
    userId?: unknown;
    seed?: ComponentProps<typeof UserHoverCard>['seed'];
    hoverSide?: ComponentProps<typeof UserHoverCard>['side'];
    hoverDisabled?: boolean;
    disabled?: boolean;
    className?: string;
    onOpen?: () => void;
};

export function UserDetailTile({
    userId,
    seed = null,
    hoverSide,
    hoverDisabled = false,
    disabled = false,
    className,
    onOpen,
    ...contentProps
}: UserDetailTileProps) {
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
                className={cn(
                    'h-auto min-w-0 justify-start gap-2 px-1.5 py-1.5 text-left font-normal',
                    className
                )}
                onClick={onOpen}
            >
                <UserDetailContent {...contentProps} />
            </Button>
        </UserHoverCard>
    );
}
