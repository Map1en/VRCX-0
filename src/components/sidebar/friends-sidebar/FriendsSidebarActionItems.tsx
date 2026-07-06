import { ClockIcon } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { isActionRecent } from '@/services/recentActionService';
import { userStatusIndicatorClassName } from '@/shared/utils/userStatus';

import type { SidebarFriendRecord } from './friendsSidebarModel';

const statusOptions = [
    { value: 'join me', labelKey: 'dialog.user.status.join_me' },
    { value: 'active', labelKey: 'dialog.user.status.online' },
    { value: 'ask me', labelKey: 'dialog.user.status.ask_me' },
    { value: 'busy', labelKey: 'dialog.user.status.busy' }
];

export type StatusPreset = {
    status?: unknown;
    statusDescription?: unknown;
};

type ContextMenuItemComponent = ComponentType<{
    children?: ReactNode;
    checked?: boolean;
    disabled?: boolean;
    onClick?: () => void;
}>;

type ContextMenuContainerComponent = ComponentType<{
    children?: ReactNode;
}>;

type ContextMenuSeparatorComponent = ComponentType;

function statusPresetLabel(
    preset: StatusPreset | null | undefined,
    t: (key: string) => string
) {
    if (preset?.statusDescription) {
        return String(preset.statusDescription);
    }
    const option = statusOptions.find((row) => row.value === preset?.status);
    return option ? t(option.labelKey) : String(preset?.status || '');
}

export function CurrentUserActionItems({
    friend,
    onOpen,
    onChangeStatus,
    onSetStatusDescription,
    onEditStatusDescription,
    onApplyStatusPreset,
    MenuItem,
    CheckboxItem,
    Group,
    Separator,
    statusPresets = []
}: {
    friend: SidebarFriendRecord & { statusHistory?: unknown };
    onOpen?: () => void;
    onChangeStatus?: (status: string) => void;
    onSetStatusDescription?: (statusDescription: string) => void;
    onEditStatusDescription?: () => void;
    onApplyStatusPreset?: (preset: StatusPreset) => void;
    MenuItem: ContextMenuItemComponent;
    CheckboxItem: ContextMenuItemComponent;
    Group: ContextMenuContainerComponent;
    Separator: ContextMenuSeparatorComponent;
    statusPresets?: StatusPreset[];
}) {
    const { t } = useTranslation();

    return (
        <>
            <Group>
                <MenuItem onClick={onOpen}>{t('common.actions.open')}</MenuItem>
            </Group>
            <Separator />
            <Group>
                {statusOptions.map((option) => (
                    <CheckboxItem
                        key={option.value}
                        checked={friend?.status === option.value}
                        onClick={() => {
                            onChangeStatus?.(option.value);
                        }}
                    >
                        <span
                            aria-hidden="true"
                            className={userStatusIndicatorClassName(
                                option.value,
                                { className: 'mr-2' }
                            )}
                        />
                        {t(option.labelKey)}
                    </CheckboxItem>
                ))}
                <MenuItem
                    onClick={() => {
                        onEditStatusDescription?.();
                    }}
                >
                    {t(
                        'view.settings.general.automation.change_status_description'
                    )}
                </MenuItem>
            </Group>
            {Array.isArray(friend?.statusHistory) &&
            friend.statusHistory.length ? (
                <>
                    <Separator />
                    <Group>
                        <CheckboxItem
                            checked={!friend?.statusDescription}
                            onClick={() => {
                                onSetStatusDescription?.('');
                            }}
                        >
                            {t('dialog.gallery_select.none')}
                        </CheckboxItem>
                        {friend.statusHistory
                            .slice(0, 10)
                            .map((item, index) => (
                                <CheckboxItem
                                    key={`${item}:${index}`}
                                    checked={friend?.statusDescription === item}
                                    onClick={() => {
                                        onSetStatusDescription?.(String(item));
                                    }}
                                >
                                    <span className="max-w-44 truncate">
                                        {String(item)}
                                    </span>
                                </CheckboxItem>
                            ))}
                    </Group>
                </>
            ) : null}
            {statusPresets.length ? (
                <>
                    <Separator />
                    <Group>
                        {statusPresets.map((preset, index) => (
                            <MenuItem
                                key={`${preset?.status || 'status'}:${preset?.statusDescription || ''}:${index}`}
                                onClick={() => {
                                    onApplyStatusPreset?.(preset);
                                }}
                            >
                                <span className="max-w-44 truncate">
                                    {statusPresetLabel(preset, t)}
                                </span>
                            </MenuItem>
                        ))}
                    </Group>
                </>
            ) : null}
        </>
    );
}

export function FriendActionItems({
    friend,
    friendLocation,
    canUseFriendLocation,
    canSendInvite,
    canRequestInvite,
    canBoop,
    onOpen,
    onLaunch,
    onSelfInvite,
    onInvite,
    onRequestInvite,
    onBoop,
    MenuItem,
    Group,
    Separator,
    recentActionVersion = 0
}: {
    friend: SidebarFriendRecord;
    friendLocation?: unknown;
    canUseFriendLocation?: boolean;
    canSendInvite?: boolean;
    canRequestInvite?: boolean;
    canBoop?: boolean;
    onOpen?: () => void;
    onLaunch?: (location: unknown) => void;
    onSelfInvite?: (location: unknown) => void;
    onInvite?: (friend: SidebarFriendRecord) => void;
    onRequestInvite?: (friend: SidebarFriendRecord) => void;
    onBoop?: (friend: SidebarFriendRecord) => void;
    MenuItem: ContextMenuItemComponent;
    Group: ContextMenuContainerComponent;
    Separator: ContextMenuSeparatorComponent;
    recentActionVersion?: number;
}) {
    const { t } = useTranslation();
    const recentInvite =
        recentActionVersion >= 0 && isActionRecent(friend?.id, 'Invite');
    const recentRequestInvite =
        recentActionVersion >= 0 &&
        isActionRecent(friend?.id, 'Request Invite');
    return (
        <>
            <Group>
                <MenuItem onClick={onOpen}>{t('common.actions.open')}</MenuItem>
            </Group>
            <Separator />
            <Group>
                <MenuItem
                    disabled={!canUseFriendLocation}
                    onClick={() => {
                        onLaunch?.(friendLocation);
                    }}
                >
                    {t('dialog.user.info.launch_invite_tooltip')}
                </MenuItem>
                <MenuItem
                    disabled={!canUseFriendLocation}
                    onClick={() => {
                        onSelfInvite?.(friendLocation);
                    }}
                >
                    {t('dialog.user.info.self_invite_tooltip')}
                </MenuItem>
            </Group>
            <Separator />
            <Group>
                <MenuItem
                    disabled={!canSendInvite}
                    onClick={() => {
                        onInvite?.(friend);
                    }}
                >
                    <span className="min-w-0 flex-1">
                        {t('dialog.user.actions.invite')}
                    </span>
                    {recentInvite ? (
                        <ClockIcon className="text-muted-foreground ml-auto" />
                    ) : null}
                </MenuItem>
                <MenuItem
                    disabled={!canRequestInvite}
                    onClick={() => {
                        onRequestInvite?.(friend);
                    }}
                >
                    <span className="min-w-0 flex-1">
                        {t('dialog.user.actions.request_invite')}
                    </span>
                    {recentRequestInvite ? (
                        <ClockIcon className="text-muted-foreground ml-auto" />
                    ) : null}
                </MenuItem>
                <MenuItem
                    disabled={!canBoop}
                    onClick={() => {
                        onBoop?.(friend);
                    }}
                >
                    {t('dialog.user.actions.send_boop')}
                </MenuItem>
            </Group>
        </>
    );
}
