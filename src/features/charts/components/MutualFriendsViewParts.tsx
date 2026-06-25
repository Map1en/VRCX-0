import { CheckIcon, UserIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    EmptyState as AppEmptyState,
    LoadingState as AppLoadingState
} from '@/components/layout/PageScaffold';
import { cn } from '@/lib/utils';
import { userImage } from '@/services/entityMediaService';
import { Checkbox } from '@/ui/shadcn/checkbox';

export function UserPickerRow({
    option,
    selected = false,
    multiple = false,
    showSelection = true
}: any) {
    const { t } = useTranslation();

    const imageUrl = option?.user ? userImage(option.user, true, '64') : '';

    return (
        <span className="flex w-full items-center p-1.5 text-left text-sm">
            <span className="bg-muted mr-2.5 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full border">
                {imageUrl ? (
                    <img
                        src={imageUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                    />
                ) : (
                    <UserIcon className="text-muted-foreground size-4" />
                )}
            </span>
            <span className="min-w-0 flex-1 overflow-hidden">
                <span className="block truncate leading-5 font-medium">
                    {option?.label || option?.value}
                </span>
                {Number.isFinite(option?.degree) ? (
                    <span className="text-muted-foreground block truncate text-xs">
                        {option.degree} {t('view.charts.label.connections')}
                    </span>
                ) : null}
            </span>
            {showSelection ? (
                multiple ? (
                    <Checkbox
                        checked={selected}
                        tabIndex={-1}
                        aria-hidden="true"
                        className="ml-auto"
                    />
                ) : (
                    <CheckIcon
                        className={cn(
                            'ml-auto size-4',
                            selected ? 'opacity-100' : 'opacity-0'
                        )}
                    />
                )
            ) : null}
        </span>
    );
}

export function GraphLoadingState() {
    const { t } = useTranslation();

    return (
        <AppLoadingState
            className="min-h-80"
            label={t('view.charts.loading.loading_mutual_graph_snapshot')}
        />
    );
}

export function GraphEmptyState({ title, description }: any) {
    return (
        <AppEmptyState
            className="min-h-80"
            title={title}
            description={description}
            contentClassName="max-w-md"
        />
    );
}
