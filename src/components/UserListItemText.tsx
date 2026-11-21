import type { CSSProperties, ReactNode } from 'react';

export function UserListItemText({
    displayName,
    namePrefix,
    nameSuffix,
    nameStyle,
    subline
}: {
    displayName: ReactNode;
    namePrefix?: ReactNode;
    nameSuffix?: ReactNode;
    nameStyle?: CSSProperties;
    subline?: ReactNode;
}) {
    return (
        <span className="min-w-0 flex-1 overflow-hidden">
            <span
                className="block truncate text-sm leading-5 font-medium"
                style={nameStyle}
            >
                {namePrefix || nameSuffix ? (
                    <span className="flex min-w-0 items-center gap-1">
                        {namePrefix}
                        <span className="min-w-0 truncate">{displayName}</span>
                        {nameSuffix}
                    </span>
                ) : (
                    displayName
                )}
            </span>
            {subline ? (
                <span className="text-content-secondary block truncate text-xs leading-4">
                    {subline}
                </span>
            ) : null}
        </span>
    );
}
