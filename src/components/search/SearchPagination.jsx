import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react';

import { Button } from '@/ui/shadcn/button';
import {
    Pagination,
    PaginationContent,
    PaginationItem
} from '@/ui/shadcn/pagination';
import { appI18n } from '@/services/i18nService.js';

export function SearchPagination({
    show = false,
    prevDisabled = true,
    nextDisabled = true,
    onPrev,
    onNext
}) {
    if (!show) {
        return null;
    }

    return (
        <Pagination className="h-16 shrink-0">
            <PaginationContent>
                <PaginationItem>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={"Previous search page"}
                        disabled={prevDisabled}
                        onClick={onPrev}
                    >
                        <ArrowLeftIcon data-icon="inline-start" />
                        {appI18n.t('table.pagination.previous')}
                    </Button>
                </PaginationItem>
                <PaginationItem>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={"Next search page"}
                        disabled={nextDisabled}
                        onClick={onNext}
                    >
                        {appI18n.t('table.pagination.next')}
                        <ArrowRightIcon data-icon="inline-end" />
                    </Button>
                </PaginationItem>
            </PaginationContent>
        </Pagination>
    );
}
