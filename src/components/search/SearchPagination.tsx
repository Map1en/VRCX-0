import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { KeyboardShortcut } from '@/components/keyboard/KeyboardShortcut';
import { usePaginationKeyboardShortcuts } from '@/components/keyboard/usePaginationKeyboardShortcuts';
import { Button } from '@/ui/shadcn/button';

export function SearchPagination({
    show = false,
    page = 1,
    prevDisabled = true,
    nextDisabled = true,
    onPrev,
    onNext
}: {
    show?: boolean;
    page?: number;
    prevDisabled?: boolean;
    nextDisabled?: boolean;
    onPrev: () => void;
    onNext: () => void;
}) {
    const { t } = useTranslation();
    const paginationRef = usePaginationKeyboardShortcuts<HTMLDivElement>({
        enabled: show,
        canPrevious: !prevDisabled,
        canNext: !nextDisabled,
        onPrevious: onPrev,
        onNext
    });

    if (!show) {
        return null;
    }

    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-2">
            <div
                ref={paginationRef}
                className="bg-popover text-popover-foreground pointer-events-auto flex max-w-full items-center gap-1 rounded-full border px-1.5 py-1 text-sm shadow-lg"
            >
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-full"
                    aria-label={t('table.pagination.previous')}
                    disabled={prevDisabled}
                    onClick={onPrev}
                >
                    <ArrowLeftIcon data-icon="inline-start" />
                    {t('table.pagination.previous')}
                    <KeyboardShortcut keys="ArrowLeft" />
                </Button>
                <span className="text-muted-foreground px-2 font-medium whitespace-nowrap tabular-nums">
                    {t('table.pagination.page_number', { page })}
                </span>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-full"
                    aria-label={t('table.pagination.next')}
                    disabled={nextDisabled}
                    onClick={onNext}
                >
                    {t('table.pagination.next')}
                    <KeyboardShortcut keys="ArrowRight" />
                    <ArrowRightIcon data-icon="inline-end" />
                </Button>
            </div>
        </div>
    );
}
