import {
    BookmarkIcon,
    ClockIcon,
    EraserIcon,
    HistoryIcon,
    SquarePenIcon
} from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { SocialStatusPreset } from '@/components/dialogs/user-dialog/userProfileFields';
import { LaunchModeContextMenuGroup } from '@/components/launch/LaunchModeContextMenuGroup';
import type { UserStatus } from '@/platform/tauri/bindings';
import { isActionRecent } from '@/services/recentActionService';
import { userStatusIndicatorClassName } from '@/shared/utils/userStatus';

import type { SidebarFriendRecord } from './friendsSidebarModel';

const statusOptions = [
    { value: 'join me', labelKey: 'dialog.user.status.join_me' },
    { value: 'active', labelKey: 'dialog.user.status.online' },
    { value: 'ask me', labelKey: 'dialog.user.status.ask_me' },
    { value: 'busy', labelKey: 'dialog.user.status.busy' }
] satisfies ReadonlyArray<{ value: UserStatus; labelKey: string }>;

export type StatusPreset = SocialStatusPreset;

type ContextMenuItemComponent = ComponentType<{
    children?: ReactNode;
    checked?: boolean;
    closeOnClick?: boolean;
    disabled?: boolean;
    onClick?: () => void;
}>;

type ContextMenuContainerComponent = ComponentType<{
    children?: ReactNode;
}>;

type ContextMenuSubTriggerComponent = ComponentType<{
    children?: ReactNode;
}>;

type ContextMenuSeparatorComponent = ComponentType;

function statusPresetLabel(
    preset: StatusPreset | null | undefined,
    t: (key: string) => string
) {
    if (preset?.statusDescription) {
        return preset.statusDescription;
    }
    const option = statusOptions.find((row) => row.value === preset?.status);
    return option ? t(option.labelKey) : preset?.status || '';
}

function StatusMenuIcon({ status }: { status: string }) {
    return (
        <span className="mr-2 flex size-4 shrink-0 items-center justify-center">
            <i
                aria-hidden="true"
                className={userStatusIndicatorClassName(status)}
            />
        </span>
    );
}

export function CurrentUserActionItems({
    friend,
    onOpen,
    onChangeStatus,
    onSetStatusDescription,
    onEditSocialStatus,
    onApplyStatusPreset,
    MenuItem,
    CheckboxItem,
    Group,
    Separator,
    Sub,
    SubTrigger,
    SubContent,
    statusPresets = []
}: {
    friend: SidebarFriendRecord & { statusHistory?: unknown };
    onOpen?: () => void;
    onChangeStatus?: (status: UserStatus) => void;
    onSetStatusDescription?: (statusDescription: string) => void;
    onEditSocialStatus?: () => void;
    onApplyStatusPreset?: (preset: StatusPreset) => void;
    MenuItem: ContextMenuItemComponent;
    CheckboxItem: ContextMenuItemComponent;
    Group: ContextMenuContainerComponent;
    Separator: ContextMenuSeparatorComponent;
    Sub: ContextMenuContainerComponent;
    SubTrigger: ContextMenuSubTriggerComponent;
    SubContent: ContextMenuContainerComponent;
    statusPresets?: StatusPreset[];
}) {
    const { t } = useTranslation();
    const statusHistory = Array.isArray(friend?.statusHistory)
        ? friend.statusHistory.slice(0, 10)
        : [];

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
                        <StatusMenuIcon status={option.value} />
                        {t(option.labelKey)}
                    </CheckboxItem>
                ))}
            </Group>
            <Separator />
            <Group>
                <MenuItem onClick={onEditSocialStatus}>
                    <SquarePenIcon className="mr-2 opacity-70" />
                    {t('dialog.user.action.edit_social_status')}
                </MenuItem>
                {friend?.statusDescription ? (
                    <MenuItem
                        onClick={() => {
                            onSetStatusDescription?.('');
                        }}
                    >
                        <EraserIcon className="mr-2 opacity-70" />
                        {t('side_panel.status_menu.clear_description')}
                    </MenuItem>
                ) : null}
                {statusHistory.length ? (
                    <Sub>
                        <SubTrigger>
                            <HistoryIcon className="mr-2 opacity-70" />
                            {t('side_panel.status_menu.recently_used')}
                        </SubTrigger>
                        <SubContent>
                            {statusHistory.map((item, index) => (
                                <CheckboxItem
                                    key={`${item}:${index}`}
                                    checked={friend?.statusDescription === item}
                                    closeOnClick
                                    onClick={() => {
                                        onSetStatusDescription?.(String(item));
                                    }}
                                >
                                    <span className="max-w-52 truncate">
                                        {String(item)}
                                    </span>
                                </CheckboxItem>
                            ))}
                        </SubContent>
                    </Sub>
                ) : null}
                {statusPresets.length ? (
                    <Sub>
                        <SubTrigger>
                            <BookmarkIcon className="mr-2 opacity-70" />
                            {t('side_panel.status_menu.presets')}
                        </SubTrigger>
                        <SubContent>
                            {statusPresets.map((preset, index) => (
                                <MenuItem
                                    key={`${preset?.status || 'status'}:${preset?.statusDescription || ''}:${index}`}
                                    onClick={() => {
                                        onApplyStatusPreset?.(preset);
                                    }}
                                >
                                    <StatusMenuIcon
                                        status={preset.status || 'active'}
                                    />
                                    <span className="max-w-52 truncate">
                                        {statusPresetLabel(preset, t)}
                                    </span>
                                </MenuItem>
                            ))}
                        </SubContent>
                    </Sub>
                ) : null}
            </Group>
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
    friendLocation: string;
    canUseFriendLocation?: boolean;
    canSendInvite?: boolean;
    canRequestInvite?: boolean;
    canBoop?: boolean;
    onOpen?: () => void;
    onSelfInvite?: (location: string) => void;
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
            <LaunchModeContextMenuGroup
                disabled={!canUseFriendLocation}
                errorMessage={t(
                    'component.friends_sidebar.toast.failed_to_launch_instance'
                )}
                location={friendLocation}
            />
            <Separator />
            <Group>
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
