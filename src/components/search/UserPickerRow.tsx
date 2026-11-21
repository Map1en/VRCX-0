import { CheckIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { UserListItemText } from '@/components/UserListItemText';
import { UserStatusAvatar } from '@/components/UserStatusAvatar';
import { cn } from '@/lib/utils';
import { userImage } from '@/services/entityMediaService';

type UserPickerOption = {
    degree?: number;
    label?: ReactNode;
    user?: Record<string, unknown> | null;
    value?: ReactNode;
};

type UserPickerRowProps = {
    option?: UserPickerOption | null;
    selected?: boolean;
    showSelection?: boolean;
};

export function UserPickerRow({
    option,
    selected = false,
    showSelection = true
}: UserPickerRowProps) {
    const { t } = useTranslation();

    const imageUrl = option?.user ? userImage(option.user, 64) : '';

    return (
        <span className="flex w-full items-center gap-2.5 px-2 py-1.5 text-left">
            <UserStatusAvatar imageUrl={imageUrl} />
            <UserListItemText
                displayName={option?.label || option?.value}
                subline={
                    Number.isFinite(option?.degree)
                        ? `${option?.degree} ${t('view.charts.label.connections')}`
                        : undefined
                }
            />
            {showSelection ? (
                <CheckIcon
                    className={cn(
                        'ml-auto size-4 shrink-0',
                        selected ? 'opacity-100' : 'opacity-0'
                    )}
                />
            ) : null}
        </span>
    );
}
