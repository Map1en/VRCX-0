import { memo, type ReactNode } from 'react';

export const FreezeWhenHidden = memo(
    function FreezeWhenHidden({
        children
    }: {
        active: boolean;
        children: ReactNode;
    }) {
        return children;
    },
    (prev, next) => !prev.active && !next.active
);
