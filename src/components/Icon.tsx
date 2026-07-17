import {
    LogInIcon,
    LogOutIcon,
    MapPinIcon,
    PencilLineIcon,
    PersonStandingIcon,
    FileTextIcon,
    UsersIcon,
    VideoIcon
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import React from 'react';

import { cn } from '@/lib/utils';

export type Meta = { Icon: LucideIcon; className: string };

export const IconType: Record<string, Meta> = {
    Location: { Icon: MapPinIcon, className: '' },
    LogIn: { Icon: LogInIcon, className: '' },
    LogOut: { Icon: LogOutIcon, className: '' },
    Status: { Icon: PencilLineIcon, className: '' },
    Avatar: { Icon: PersonStandingIcon, className: 'stroke-1.5 scale-145' },
    Doc: { Icon: FileTextIcon, className: '' },
    Users: { Icon: UsersIcon, className: '' },
    Video: { Icon: VideoIcon, className: '' }
};

export interface CustomIconProps extends React.ComponentPropsWithoutRef<'svg'> {
    containerClassName?: string;
}

interface IconProps extends CustomIconProps {
    meta: Meta;
}

function BaseIcon({
    meta,
    containerClassName,
    className,
    ...props
}: IconProps) {
    return (
        <div
            className={cn(
                'flex h-4 w-4 items-center justify-center',
                containerClassName
            )}
        >
            <meta.Icon
                aria-hidden="true"
                className={cn('size-3.5 shrink-0', meta.className, className)}
                {...props}
            />
        </div>
    );
}

export const Location = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Location}
        containerClassName={containerClassName}
        {...props}
    />
);

export const LogIn = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.LogIn}
        containerClassName={containerClassName}
        {...props}
    />
);

export const LogOut = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.LogOut}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Status = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Status}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Avatar = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Avatar}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Doc = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Doc}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Users = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Users}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Video = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Video}
        containerClassName={containerClassName}
        {...props}
    />
);
