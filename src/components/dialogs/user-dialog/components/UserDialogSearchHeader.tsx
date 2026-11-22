import { ArrowUpDownIcon } from 'lucide-react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import {
    ToolbarActions,
    ToolbarRefreshButton,
    ToolbarSearch,
    ToolbarStatus,
    ToolbarViews
} from '@/components/layout/ToolbarControls';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

import type {
    UserDialogDataTab,
    UserDialogRemoteStatus
} from '../userDialogTabService';

export function UserDialogSortSelect<TValue extends string>({
    value,
    options,
    onValueChange,
    disabled = false,
    isOptionDisabled
}: {
    value: TValue;
    options: readonly { value: TValue; name: string }[];
    onValueChange: (value: TValue) => void;
    disabled?: boolean;
    isOptionDisabled?: (value: TValue) => boolean;
}) {
    const { t } = useTranslation();

    return (
        <Select<TValue>
            value={value}
            onValueChange={(next) => {
                if (next) {
                    onValueChange(next);
                }
            }}
            disabled={disabled}
            items={options.map((option) => ({
                value: option.value,
                label: t(option.name)
            }))}
        >
            <SelectTrigger className="max-w-56 min-w-36 shrink-0">
                <span className="flex min-w-0 items-center gap-2">
                    <ArrowUpDownIcon className="text-muted-foreground size-4 shrink-0" />
                    <SelectValue />
                </span>
            </SelectTrigger>
            <SelectContent>
                <SelectGroup>
                    {options.map((option) => (
                        <SelectItem
                            key={option.value}
                            value={option.value}
                            disabled={isOptionDisabled?.(option.value)}
                        >
                            {t(option.name)}
                        </SelectItem>
                    ))}
                </SelectGroup>
            </SelectContent>
        </Select>
    );
}

export function UserDialogSearchHeader<TSearch extends Record<string, string>>({
    searchKey,
    tab,
    rows,
    filteredRows,
    placeholder,
    views,
    actions,
    remoteStatus,
    loadTab,
    search,
    setSearch
}: {
    searchKey: keyof TSearch & string;
    tab?: UserDialogDataTab;
    rows: readonly unknown[];
    filteredRows: readonly unknown[];
    placeholder?: string;
    views?: ReactNode;
    actions?: ReactNode;
    remoteStatus: UserDialogRemoteStatus;
    loadTab: (tab: UserDialogDataTab, options: { force?: boolean }) => void;
    search: TSearch;
    setSearch: Dispatch<SetStateAction<TSearch>>;
}) {
    const currentSearch = String(search?.[searchKey] ?? '');
    const hasSearch = currentSearch.trim().length > 0;
    const running = tab ? remoteStatus[tab] === 'running' : false;

    return (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
            <ToolbarViews className="min-w-0 flex-wrap">{views}</ToolbarViews>
            {hasSearch ? (
                <ToolbarStatus className="tabular-nums">
                    {filteredRows.length}/{rows.length}
                </ToolbarStatus>
            ) : null}
            <ToolbarSearch
                value={currentSearch}
                placeholder={placeholder}
                onValueChange={(value) =>
                    setSearch((current) => ({
                        ...current,
                        [searchKey]: value
                    }))
                }
            />
            <ToolbarActions>
                {tab ? (
                    <ToolbarRefreshButton
                        loading={running}
                        onRefresh={() => {
                            loadTab(tab, { force: true });
                        }}
                    />
                ) : null}
                {actions}
            </ToolbarActions>
        </div>
    );
}
