import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

type SelectionActionBarProps = {
    status: ReactNode;
    selectAllLabel: ReactNode;
    clearLabel: string;
    pending?: boolean;
    clearDisabled?: boolean;
    onSelectAll(): void;
    onClearSelection(): void;
    children?: ReactNode;
};

function SelectionActionBar({
    status,
    selectAllLabel,
    clearLabel,
    pending = false,
    clearDisabled = false,
    onSelectAll,
    onClearSelection,
    children
}: SelectionActionBarProps) {
    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-2">
            <div className="bg-popover text-popover-foreground pointer-events-auto flex max-w-full flex-wrap items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm shadow-lg">
                <span className="text-muted-foreground px-1.5 font-medium whitespace-nowrap tabular-nums">
                    {status}
                </span>
                {pending ? (
                    <Spinner className="size-4" />
                ) : (
                    <>
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={onSelectAll}
                        >
                            {selectAllLabel}
                        </Button>
                        {children}
                        <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            className="rounded-full"
                            aria-label={clearLabel}
                            disabled={clearDisabled}
                            onClick={onClearSelection}
                        >
                            <XIcon data-icon="icon" />
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}

export { SelectionActionBar };
