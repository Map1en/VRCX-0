import { ArrowLeftIcon, ArrowRightIcon, Rows3Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { KeyboardShortcut } from '@/components/keyboard/KeyboardShortcut';
import { usePaginationKeyboardShortcuts } from '@/components/keyboard/usePaginationKeyboardShortcuts';
import { Button } from '@/ui/shadcn/button';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

export function SearchPagination({
    show = false,
    page = 1,
    prevDisabled = true,
    nextDisabled = true,
    onPrev,
    onNext,
    pageSize,
    pageSizes = [],
    onPageSizeChange
}: {
    show?: boolean;
    page?: number;
    prevDisabled?: boolean;
    nextDisabled?: boolean;
    onPrev: () => void;
    onNext: () => void;
    pageSize?: number;
    pageSizes?: readonly number[];
    onPageSizeChange?: (pageSize: number) => void;
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
                {pageSize && pageSizes.length && onPageSizeChange ? (
                    <Select<string>
                        value={String(pageSize)}
                        onValueChange={(value) => {
                            if (value) {
                                onPageSizeChange(Number(value));
                            }
                        }}
                    >
                        <SelectTrigger
                            size="sm"
                            aria-label={t('table.pagination.rows_per_page')}
                            title={t('table.pagination.rows_per_page')}
                            className="w-auto rounded-full border-0 bg-transparent dark:bg-transparent"
                        >
                            <Rows3Icon className="text-muted-foreground size-4" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="center">
                            <SelectGroup>
                                {pageSizes.map((size) => (
                                    <SelectItem key={size} value={String(size)}>
                                        {size}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                ) : null}
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
