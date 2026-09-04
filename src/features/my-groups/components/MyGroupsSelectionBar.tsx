import { EyeIcon, LogOutIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { SelectionActionBar } from '@/components/layout/SelectionActionBar';
import type { GroupMemberVisibility } from '@/platform/tauri/bindings';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

const visibilityLabelKeys: Record<GroupMemberVisibility, string> = {
    visible: 'dialog.group.actions.visibility_everyone',
    friends: 'dialog.group.actions.visibility_friends',
    hidden: 'dialog.group.actions.visibility_hidden'
};

const visibilityOptions: GroupMemberVisibility[] = [
    'visible',
    'friends',
    'hidden'
];

export function MyGroupsSelectionBar({
    selectedCount,
    leavableCount,
    allSelected,
    busy,
    progress,
    onSelectAll,
    onClearSelection,
    onSetVisibility,
    onLeave
}: {
    selectedCount: number;
    leavableCount: number;
    allSelected: boolean;
    busy: boolean;
    progress: { current: number; total: number } | null;
    onSelectAll(): void;
    onClearSelection(): void;
    onSetVisibility(visibility: GroupMemberVisibility): void;
    onLeave(): void;
}) {
    const { t } = useTranslation();

    return (
        <SelectionActionBar
            status={
                busy && progress
                    ? t('view.my_groups.batch_progress', {
                          current: progress.current,
                          total: progress.total
                      })
                    : t('view.my_groups.selected_count', {
                          count: selectedCount
                      })
            }
            selectAllLabel={
                allSelected
                    ? t('view.tools.gallery_selection.deselect_all')
                    : t('view.tools.gallery_selection.select_all')
            }
            clearLabel={t('common.actions.clear')}
            pending={busy}
            clearDisabled={selectedCount === 0}
            onSelectAll={onSelectAll}
            onClearSelection={onClearSelection}
        >
            <DropdownMenu>
                <DropdownMenuTrigger
                    render={
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={selectedCount === 0}
                        >
                            <EyeIcon data-icon="inline-start" />
                            {t('dialog.group.actions.visibility')}
                        </Button>
                    }
                />
                <DropdownMenuContent side="top" align="center">
                    {visibilityOptions.map((option) => (
                        <DropdownMenuItem
                            key={option}
                            onClick={() => onSetVisibility(option)}
                        >
                            {t(visibilityLabelKeys[option])}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
            <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={leavableCount === 0}
                title={
                    leavableCount === 0
                        ? t('view.my_groups.leave_owner_locked')
                        : undefined
                }
                onClick={onLeave}
            >
                <LogOutIcon data-icon="inline-start" />
                {leavableCount < selectedCount
                    ? t('view.my_groups.leave_partial', {
                          count: leavableCount
                      })
                    : t('view.my_groups.leave')}
            </Button>
        </SelectionActionBar>
    );
}
