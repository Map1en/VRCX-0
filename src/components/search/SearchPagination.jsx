import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react';

import { Button } from '@/ui/shadcn/button.jsx';

export function SearchPagination({ show = false, prevDisabled = true, nextDisabled = true, onPrev, onNext }) {
    if (!show) {
        return null;
    }

    return (
        <div className="flex h-[60px] shrink-0 items-center justify-center">
            <div className="inline-flex items-center rounded-lg shadow-lg">
                <Button type="button" variant="outline" size="sm" disabled={prevDisabled} onClick={onPrev}>
                    <ArrowLeftIcon className="size-4" />
                    <span className="ml-1 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">
                        Alt
                    </span>
                    <span className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">
                        ←
                    </span>
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={nextDisabled} onClick={onNext}>
                    <span className="ml-1 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">
                        Alt
                    </span>
                    <span className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">
                        →
                    </span>
                    <ArrowRightIcon className="size-4" />
                </Button>
            </div>
        </div>
    );
}
