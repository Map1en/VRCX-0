import { CheckIcon, UserIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { FadeInImage } from '@/components/media/FadeInImage';
import { cn } from '@/lib/utils';
import { userImage } from '@/services/entityMediaService';
import { Checkbox } from '@/ui/shadcn/checkbox';

type UserPickerOption = {
    degree?: number;
    label?: ReactNode;
    user?: Record<string, unknown> | null;
    value?: ReactNode;
};

type UserPickerRowProps = {
    multiple?: boolean;
    option?: UserPickerOption | null;
    selected?: boolean;
    showSelection?: boolean;
};

export function UserPickerRow({
    option,
    selected = false,
    multiple = false,
    showSelection = true
}: UserPickerRowProps) {
    const { t } = useTranslation();

    const imageUrl = option?.user ? userImage(option.user, true, '64') : '';

    return (
        <span className="flex w-full items-center p-1.5 text-left text-sm">
            <span className="bg-muted mr-2.5 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full border">
                {imageUrl ? (
                    <FadeInImage
                        src={imageUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                        fallback={
                            <UserIcon className="text-muted-foreground size-4" />
                        }
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
                        {option?.degree} {t('view.charts.label.connections')}
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
