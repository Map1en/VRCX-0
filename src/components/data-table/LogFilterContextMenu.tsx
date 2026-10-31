import type { TFunction } from 'i18next';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuLabel,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';

export type LogFilterTarget = {
    userId?: string;
    userName?: string;
    type?: string;
    typeLabel?: string;
    worldId?: string;
    worldName?: string;
};

export type LogFilterCommands = {
    onlyUser?(userId: string, userName: string): void;
    addUserToScope?(userId: string): void;
    canFilterType?(type: string): boolean;
    onlyType?(type: string): void;
    canExcludeType?(type: string): boolean;
    excludeType?(type: string): void;
    onlyWorld?(worldId: string): void;
};

type LogFilterMenuItem = {
    key: string;
    label: string;
    onSelect(): void;
};

const LOG_FILTER_ROW_SELECTOR = '[data-log-filter-row]';

export function getLogFilterRowAttributes(target: LogFilterTarget) {
    return {
        'data-log-filter-row': '',
        'data-log-filter-user-id': target.userId || undefined,
        'data-log-filter-user-name': target.userName || undefined,
        'data-log-filter-type': target.type || undefined,
        'data-log-filter-type-label': target.typeLabel || undefined,
        'data-log-filter-world-id': target.worldId || undefined,
        'data-log-filter-world-name': target.worldName || undefined
    };
}

function readLogFilterTarget(element: HTMLElement): LogFilterTarget {
    const { dataset } = element;
    return {
        userId: dataset.logFilterUserId,
        userName: dataset.logFilterUserName,
        type: dataset.logFilterType,
        typeLabel: dataset.logFilterTypeLabel,
        worldId: dataset.logFilterWorldId,
        worldName: dataset.logFilterWorldName
    };
}

function buildLogFilterItems(
    target: LogFilterTarget,
    commands: LogFilterCommands,
    t: TFunction
): LogFilterMenuItem[] {
    const items: LogFilterMenuItem[] = [];
    const { userId, type, worldId } = target;
    if (userId) {
        const userName = target.userName || userId;
        if (commands.onlyUser) {
            const onlyUser = commands.onlyUser;
            items.push({
                key: 'only-user',
                label: t('table.filter_action.only_user', { value: userName }),
                onSelect: () => onlyUser(userId, userName)
            });
        }
        if (commands.addUserToScope) {
            const addUserToScope = commands.addUserToScope;
            items.push({
                key: 'add-user',
                label: t('table.filter_action.add_user_to_scope', {
                    value: userName
                }),
                onSelect: () => addUserToScope(userId)
            });
        }
    }
    if (type && (commands.canFilterType?.(type) ?? true)) {
        const typeLabel = target.typeLabel || type;
        if (commands.onlyType) {
            const onlyType = commands.onlyType;
            items.push({
                key: 'only-type',
                label: t('table.filter_action.only_type', { value: typeLabel }),
                onSelect: () => onlyType(type)
            });
        }
        if (commands.excludeType && (commands.canExcludeType?.(type) ?? true)) {
            const excludeType = commands.excludeType;
            items.push({
                key: 'exclude-type',
                label: t('table.filter_action.exclude_type', {
                    value: typeLabel
                }),
                onSelect: () => excludeType(type)
            });
        }
    }
    if (worldId && commands.onlyWorld) {
        const onlyWorld = commands.onlyWorld;
        items.push({
            key: 'only-world',
            label: t('table.filter_action.only_world', {
                value: target.worldName || worldId
            }),
            onSelect: () => onlyWorld(worldId)
        });
    }
    return items;
}

function LogFilterMenuGroup({ items }: { items: LogFilterMenuItem[] }) {
    const { t } = useTranslation();
    return (
        <ContextMenuGroup>
            <ContextMenuLabel>
                {t('table.filter_action.label')}
            </ContextMenuLabel>
            {items.map((item) => (
                <ContextMenuItem key={item.key} onClick={item.onSelect}>
                    <span className="min-w-0 flex-1 truncate">
                        {item.label}
                    </span>
                </ContextMenuItem>
            ))}
        </ContextMenuGroup>
    );
}

export function LogFilterMenuItems({
    target,
    commands
}: {
    target: LogFilterTarget;
    commands?: LogFilterCommands | null;
}) {
    const { t } = useTranslation();
    const items = commands ? buildLogFilterItems(target, commands, t) : [];
    if (!items.length) {
        return null;
    }
    return (
        <>
            <ContextMenuSeparator />
            <LogFilterMenuGroup items={items} />
        </>
    );
}

export function LogFilterContextMenu({
    commands,
    children
}: {
    commands?: LogFilterCommands | null;
    children: ReactElement;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<LogFilterMenuItem[]>([]);

    if (!commands) {
        return children;
    }

    return (
        <ContextMenu
            open={open}
            onOpenChange={(nextOpen, eventDetails) => {
                if (!nextOpen) {
                    setOpen(false);
                    return;
                }
                const eventTarget = eventDetails.event?.target;
                const row =
                    eventTarget instanceof Element
                        ? eventTarget.closest<HTMLElement>(
                              LOG_FILTER_ROW_SELECTOR
                          )
                        : null;
                const nextItems = row
                    ? buildLogFilterItems(readLogFilterTarget(row), commands, t)
                    : [];
                if (!nextItems.length) {
                    return;
                }
                setItems(nextItems);
                setOpen(true);
            }}
        >
            <ContextMenuTrigger render={children} />
            <ContextMenuContent className="w-56">
                <LogFilterMenuGroup items={items} />
            </ContextMenuContent>
        </ContextMenu>
    );
}
