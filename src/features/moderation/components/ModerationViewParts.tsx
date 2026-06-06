import { useTranslation } from 'react-i18next';

import { DataTableSortButton } from '@/components/data-table/DataTableSortButton';
import { EmptyState } from '@/components/layout/PageScaffold';
import { moderationTypes } from '@/shared/constants/moderation';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

export { DataTableSortButton as SortButton };

export function ModerationEmptyState({ title, description }: any) {
    return <EmptyState title={title} description={description} />;
}

export function ModerationTypeFilterDropdown({
    value,
    onChange,
    getTypeLabel,
    sanitizeTypes = (types: any) => types
}: any) {
    const { t } = useTranslation();
    const selectedTypes = Array.isArray(value) ? value : [];
    const label = selectedTypes.length
        ? t('view.moderation.dynamic.selected_moderation_filters', {
              count: selectedTypes.length
          })
        : t('view.moderation.label.moderation_filters');

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    className="h-9 min-w-0 flex-1 justify-start truncate"
                >
                    {label}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuGroup>
                    {moderationTypes.map((type: any) => (
                        <DropdownMenuCheckboxItem
                            key={type}
                            checked={selectedTypes.includes(type)}
                            onCheckedChange={(checked: any) => {
                                const next = checked
                                    ? [...selectedTypes, type]
                                    : selectedTypes.filter(
                                          (entry: any) => entry !== type
                                      );
                                onChange(sanitizeTypes(next));
                            }}
                            onSelect={(event: any) => event.preventDefault()}
                        >
                            {getTypeLabel(type)}
                        </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
