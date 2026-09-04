import { Suspense, useState, type ReactNode } from 'react';

export function MountOnFirstOpen({
    open,
    children
}: {
    open: boolean;
    children: ReactNode;
}) {
    const [hasOpened, setHasOpened] = useState(open);
    if (open && !hasOpened) {
        setHasOpened(true);
    }
    return hasOpened ? <Suspense fallback={null}>{children}</Suspense> : null;
}
