import { useQuery } from '@tanstack/react-query';
import { RefreshCwIcon, ShieldUserIcon, UsersRoundIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ToolbarIconButton } from '@/components/layout/ToolbarControls';
import type { GroupProfileRecord } from '@/domain/entities/group';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { isGroupId } from '@/shared/constants/vrchatIds';
import { useRuntimeStore } from '@/state/runtimeStore';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Button } from '@/ui/shadcn/button';
import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
    ComboboxTrigger,
    ComboboxValue
} from '@/ui/shadcn/combobox';

interface GroupOption {
    id: string;
    name: string;
    iconUrl?: string;
    shortCode?: string;
    group: boolean;
}

function GroupIcon({
    iconUrl,
    className
}: {
    iconUrl: string | undefined;
    className: string;
}) {
    return (
        <Avatar className={`${className} shrink-0 rounded-md after:rounded-md`}>
            {iconUrl ? (
                <AvatarImage src={iconUrl} alt="" className="rounded-md" />
            ) : null}
            <AvatarFallback className="rounded-md [&>svg]:size-4">
                <UsersRoundIcon aria-hidden="true" />
            </AvatarFallback>
        </Avatar>
    );
}

function groupOptionOf(
    group: Pick<GroupProfileRecord, 'id' | 'name' | 'iconUrl' | 'shortCode'>
): GroupOption {
    return {
        id: group.id,
        name: group.name || group.id,
        iconUrl: group.iconUrl
            ? convertFileUrlToImageUrl(group.iconUrl, 128)
            : '',
        shortCode: group.shortCode,
        group: true
    };
}

export function PlayerListGroupSelector({
    active,
    value,
    groupId,
    instanceGroupId,
    onActiveChange,
    onChange,
    onRefresh
}: {
    active: boolean;
    value: string;
    groupId: string;
    instanceGroupId: string;
    onActiveChange(active: boolean): void;
    onChange(value: string): void;
    onRefresh(): void;
}) {
    const { t } = useTranslation();
    const toggle = (
        <ToolbarIconButton
            icon={ShieldUserIcon}
            label={t('table.playerList.groupRoles')}
            active={active}
            onClick={() => onActiveChange(!active)}
        />
    );
    if (!active) {
        return toggle;
    }
    return (
        <div className="flex items-center gap-1">
            {toggle}
            <PlayerListGroupCombobox
                value={value}
                groupId={groupId}
                instanceGroupId={instanceGroupId}
                onChange={onChange}
                onRefresh={onRefresh}
            />
        </div>
    );
}

function PlayerListGroupCombobox({
    value,
    groupId,
    instanceGroupId,
    onChange,
    onRefresh
}: {
    value: string;
    groupId: string;
    instanceGroupId: string;
    onChange(value: string): void;
    onRefresh(): void;
}) {
    const { t } = useTranslation();
    const ownerId = useRuntimeStore((state) => state.auth.currentUserId);
    const endpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const [input, setInput] = useState('');
    const [open, setOpen] = useState(false);
    const groups = useQuery({
        queryKey: ['player-list-group-options', ownerId, endpoint],
        enabled: Boolean(ownerId && open),
        retry: false,
        gcTime: 0,
        staleTime: Infinity,
        queryFn: () =>
            groupProfileRepository.getUserGroups({ userId: ownerId || '' })
    });
    const instanceGroup = useQuery({
        queryKey: [
            'player-list-instance-group',
            ownerId,
            endpoint,
            instanceGroupId
        ],
        enabled: Boolean(ownerId && instanceGroupId),
        retry: false,
        staleTime: Infinity,
        queryFn: () =>
            groupProfileRepository.getGroupProfile({
                groupId: instanceGroupId,
                includeRoles: true
            })
    });
    const typed = input.trim();
    const enteredId = isGroupId(typed) ? typed : '';
    const automaticLabel = t('view.player_list.group_roles.automatic');
    const options = useMemo(() => {
        const auto: GroupOption = instanceGroup.data
            ? {
                  ...groupOptionOf(instanceGroup.data),
                  id: 'auto',
                  shortCode: automaticLabel
              }
            : { id: 'auto', name: automaticLabel, group: false };
        const result = [
            auto,
            ...(groups.data ?? [])
                .map(groupOptionOf)
                .sort((a, b) => a.name.localeCompare(b.name))
        ];
        for (const id of [value, enteredId]) {
            if (isGroupId(id) && !result.some((option) => option.id === id))
                result.push({ id, name: id, group: true });
        }
        return result;
    }, [automaticLabel, enteredId, groups.data, instanceGroup.data, value]);
    const items = useMemo(() => options.map((option) => option.id), [options]);
    const groupOption = (id: string) =>
        options.find((option) => option.id === id);
    const groupLabel = (id: string) => groupOption(id)?.name ?? id;
    return (
        <div className="flex items-center gap-1">
            <Combobox
                items={items}
                value={value}
                open={open}
                onOpenChange={setOpen}
                itemToStringLabel={groupLabel}
                filter={(id: string, query: string) => {
                    const option = groupOption(id);
                    return `${option?.name ?? ''} ${option?.shortCode ?? ''} ${id}`
                        .toLocaleLowerCase()
                        .includes(query.toLocaleLowerCase());
                }}
                onInputValueChange={setInput}
                onValueChange={(id: string | null) => {
                    if (id) onChange(id);
                }}
            >
                <ComboboxTrigger
                    aria-label={t('view.player_list.group_roles.group')}
                    render={
                        <Button
                            variant="outline"
                            size="sm"
                            className="max-w-56 justify-between font-normal"
                        />
                    }
                >
                    <ComboboxValue>
                        {(id: string) => {
                            const option = groupOption(id);
                            return option?.group ? (
                                <span className="flex min-w-0 items-center gap-2">
                                    <GroupIcon
                                        iconUrl={option.iconUrl}
                                        className="size-5"
                                    />
                                    <span className="truncate">
                                        {option.name}
                                    </span>
                                </span>
                            ) : (
                                <span className="text-muted-foreground truncate">
                                    {option?.name ?? id}
                                </span>
                            );
                        }}
                    </ComboboxValue>
                </ComboboxTrigger>
                <ComboboxContent align="end" className="bg-popover! w-72">
                    <ComboboxInput
                        showTrigger={false}
                        placeholder={t(
                            'view.player_list.group_roles.placeholder'
                        )}
                    />
                    <ComboboxEmpty>
                        {t('view.player_list.group_roles.placeholder')}
                    </ComboboxEmpty>
                    <ComboboxList>
                        {(id: string) => {
                            const option = groupOption(id);
                            return (
                                <ComboboxItem
                                    key={id}
                                    value={id}
                                    className="py-1.5"
                                >
                                    {option?.group ? (
                                        <GroupIcon
                                            iconUrl={option.iconUrl}
                                            className="size-8"
                                        />
                                    ) : null}
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate font-medium">
                                            {option?.name ?? id}
                                        </span>
                                        {option?.shortCode ? (
                                            <span className="text-muted-foreground block truncate text-xs">
                                                {option.shortCode}
                                            </span>
                                        ) : null}
                                    </span>
                                </ComboboxItem>
                            );
                        }}
                    </ComboboxList>
                </ComboboxContent>
            </Combobox>
            {groupId ? (
                <HintTooltip label={t('view.player_list.group_roles.refresh')}>
                    <Button variant="ghost" size="icon-sm" onClick={onRefresh}>
                        <RefreshCwIcon />
                    </Button>
                </HintTooltip>
            ) : null}
        </div>
    );
}
