import { Columns3Icon, TableIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ToolbarSegmented } from '@/components/layout/ToolbarControls';

import type { FeedViewMode } from '../feedColumnsState';

export function FeedViewModeToggle({
    value,
    onValueChange
}: {
    value: FeedViewMode;
    onValueChange(value: FeedViewMode): void;
}) {
    const { t } = useTranslation();

    return (
        <ToolbarSegmented
            iconOnly
            value={value}
            onValueChange={onValueChange}
            options={[
                {
                    value: 'table',
                    label: t('view.feed.modes.table'),
                    icon: TableIcon
                },
                {
                    value: 'columns',
                    label: t('view.feed.modes.columns'),
                    icon: Columns3Icon
                }
            ]}
        />
    );
}
