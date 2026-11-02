import type { ReactNode } from 'react';

import { UserHoverCard } from '@/components/user-hover-card/UserHoverCard';
import { openUserDialog, openWorldDialog } from '@/services/dialogService';

const CHIP_CLASS =
    'text-foreground cursor-pointer rounded-md bg-(--state-hover-surface) px-1 font-medium hover:bg-(--state-pressed-surface)';

interface EntityChipProps {
    kind: 'user' | 'world';
    id: string;
    children: ReactNode;
}

export function EntityChip({ kind, id, children }: EntityChipProps) {
    if (kind === 'world') {
        return (
            <button
                type="button"
                className={CHIP_CLASS}
                onClick={() => openWorldDialog({ worldId: id })}
            >
                {children}
            </button>
        );
    }
    return (
        <UserHoverCard userId={id}>
            <button
                type="button"
                className={CHIP_CLASS}
                onClick={() => openUserDialog({ userId: id })}
            >
                {children}
            </button>
        </UserHoverCard>
    );
}
