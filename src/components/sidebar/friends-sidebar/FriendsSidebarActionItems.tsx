import { ClockIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { isActionRecent } from '@/services/recentActionService';
import { userStatusIndicatorClassName } from '@/shared/utils/userStatus';

const statusOptions = [
    { value: 'join me', labelKey: 'dialog.user.status.join_me' },
    { value: 'active', labelKey: 'dialog.user.status.online' },
    { value: 'ask me', labelKey: 'dialog.user.status.ask_me' },
    { value: 'busy', labelKey: 'dialog.user.status.busy' }
];

function statusPresetLabel(preset: any, t: any) {
    if (preset?.statusDescription) {
        return preset.statusDescription;
    }
    const option = statusOptions.find(
        (row: any) => row.value === preset?.status
    );
    return option ? t(option.labelKey) : preset?.status || '';
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
}: any) {
    const { t } = useTranslation();

    return (
        <>
            <Group>
                <MenuItem onSelect={onOpen}>
                    {t('common.actions.open')}
                </MenuItem>
            </Group>
            <Separator />
            <Group>
                {statusOptions.map((option: any) => (
                    <CheckboxItem
                        key={option.value}
                        checked={friend?.status === option.value}
                        onSelect={() => {
                            onChangeStatus(option.value);
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
                    onSelect={() => {
                        onEditStatusDescription();
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
                            onSelect={() => {
                                onSetStatusDescription('');
                            }}
                        >
                            {t('dialog.gallery_select.none')}
                        </CheckboxItem>
                        {friend.statusHistory
                            .slice(0, 10)
                            .map((item: any, index: any) => (
                                <CheckboxItem
                                    key={`${item}:${index}`}
                                    checked={friend?.statusDescription === item}
                                    onSelect={() => {
                                        onSetStatusDescription(item);
                                    }}
                                >
                                    <span className="max-w-44 truncate">
                                        {item}
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
                        {statusPresets.map((preset: any, index: any) => (
                            <MenuItem
                                key={`${preset?.status || 'status'}:${preset?.statusDescription || ''}:${index}`}
                                onSelect={() => {
                                    onApplyStatusPreset(preset);
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
}: any) {
    const { t } = useTranslation();
    const recentInvite =
        recentActionVersion >= 0 && isActionRecent(friend?.id, 'Invite');
    const recentRequestInvite =
        recentActionVersion >= 0 &&
        isActionRecent(friend?.id, 'Request Invite');
    return (
        <>
            <Group>
                <MenuItem onSelect={onOpen}>
                    {t('common.actions.open')}
                </MenuItem>
            </Group>
            <Separator />
            <Group>
                <MenuItem
                    disabled={!canUseFriendLocation}
                    onSelect={() => {
                        onLaunch(friendLocation);
                    }}
                >
                    {t('dialog.user.info.launch_invite_tooltip')}
                </MenuItem>
                <MenuItem
                    disabled={!canUseFriendLocation}
                    onSelect={() => {
                        onSelfInvite(friendLocation);
                    }}
                >
                    {t('dialog.user.info.self_invite_tooltip')}
                </MenuItem>
            </Group>
            <Separator />
            <Group>
                <MenuItem
                    disabled={!canSendInvite}
                    onSelect={() => {
                        onInvite(friend);
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
                    onSelect={() => {
                        onRequestInvite(friend);
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
                    onSelect={() => {
                        onBoop(friend);
                    }}
                >
                    {t('dialog.user.actions.send_boop')}
                </MenuItem>
            </Group>
        </>
    );
}
