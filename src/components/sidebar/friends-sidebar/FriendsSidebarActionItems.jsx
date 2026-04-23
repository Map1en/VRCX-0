import { ClockIcon } from 'lucide-react';

import { userStatusIndicatorClassName } from '@/lib/userStatus.js';
import { isActionRecent } from '@/services/recentActionService.js';

const statusOptions = [
    { value: 'join me', labelKey: 'dialog.user.status.join_me' },
    { value: 'active', labelKey: 'dialog.user.status.online' },
    { value: 'ask me', labelKey: 'dialog.user.status.ask_me' },
    { value: 'busy', labelKey: 'dialog.user.status.busy' }
];

function statusPresetLabel(preset, t) {
    if (preset?.statusDescription) {
        return preset.statusDescription;
    }
    const option = statusOptions.find((row) => row.value === preset?.status);
    return option ? t(option.labelKey) : preset?.status || '';
}

export function CurrentUserActionItems({
    friend,
    actions,
    t,
    MenuItem,
    CheckboxItem,
    Group,
    Separator,
    Sub,
    SubTrigger,
    SubContent,
    statusPresets = []
}) {
    return (
        <>
            <Group>
                <MenuItem onSelect={() => actions.open()}>
                    {t('common.actions.open')}
                </MenuItem>
            </Group>
            <Separator />
            <Group>
                <Sub>
                    <SubTrigger>
                        {t('dialog.user.actions.edit_status')}
                    </SubTrigger>
                    <SubContent side="left" align="start" className="w-48">
                        <Group>
                            {statusOptions.map((option) => (
                                <CheckboxItem
                                    key={option.value}
                                    checked={friend?.status === option.value}
                                    onSelect={() =>
                                        void actions.changeStatus(option.value)
                                    }
                                >
                                    <i
                                        className={userStatusIndicatorClassName(
                                            option.value,
                                            { className: 'mr-2' }
                                        )}
                                    />
                                    {t(option.labelKey)}
                                </CheckboxItem>
                            ))}
                        </Group>
                    </SubContent>
                </Sub>
                <MenuItem onSelect={() => void actions.editStatusDescription()}>
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
                        <Sub>
                            <SubTrigger>
                                {t('dialog.social_status.history')}
                            </SubTrigger>
                            <SubContent
                                side="left"
                                align="start"
                                className="w-56"
                            >
                                <Group>
                                    <CheckboxItem
                                        checked={!friend?.statusDescription}
                                        onSelect={() =>
                                            void actions.setStatusDescription(
                                                ''
                                            )
                                        }
                                    >
                                        {t('dialog.gallery_select.none')}
                                    </CheckboxItem>
                                </Group>
                                <Separator />
                                <Group>
                                    {friend.statusHistory
                                        .slice(0, 10)
                                        .map((item, index) => (
                                            <CheckboxItem
                                                key={`${item}:${index}`}
                                                checked={
                                                    friend?.statusDescription ===
                                                    item
                                                }
                                                onSelect={() =>
                                                    void actions.setStatusDescription(
                                                        item
                                                    )
                                                }
                                            >
                                                <span className="max-w-44 truncate">
                                                    {item}
                                                </span>
                                            </CheckboxItem>
                                        ))}
                                </Group>
                            </SubContent>
                        </Sub>
                    </Group>
                </>
            ) : null}
            {statusPresets.length ? (
                <>
                    <Separator />
                    <Group>
                        <Sub>
                            <SubTrigger>
                                {t('dialog.social_status.presets')}
                            </SubTrigger>
                            <SubContent
                                side="left"
                                align="start"
                                className="w-56"
                            >
                                <Group>
                                    {statusPresets.map((preset, index) => (
                                        <MenuItem
                                            key={`${preset?.status || 'status'}:${preset?.statusDescription || ''}:${index}`}
                                            onSelect={() =>
                                                void actions.applyStatusPreset(
                                                    preset
                                                )
                                            }
                                        >
                                            <span className="max-w-44 truncate">
                                                {statusPresetLabel(preset, t)}
                                            </span>
                                        </MenuItem>
                                    ))}
                                </Group>
                            </SubContent>
                        </Sub>
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
    actions,
    t,
    MenuItem,
    Group,
    Separator,
    recentActionVersion = 0
}) {
    const recentInvite =
        recentActionVersion >= 0 && isActionRecent(friend?.id, 'Invite');
    const recentRequestInvite =
        recentActionVersion >= 0 &&
        isActionRecent(friend?.id, 'Request Invite');
    return (
        <>
            <Group>
                <MenuItem onSelect={() => actions.open()}>
                    {t('common.actions.open')}
                </MenuItem>
            </Group>
            <Separator />
            <Group>
                <MenuItem
                    disabled={!canUseFriendLocation}
                    onSelect={() => void actions.launch(friendLocation)}
                >
                    {t('dialog.user.info.launch_invite_tooltip')}
                </MenuItem>
                <MenuItem
                    disabled={!canUseFriendLocation}
                    onSelect={() => void actions.selfInvite(friendLocation)}
                >
                    {t('dialog.user.info.self_invite_tooltip')}
                </MenuItem>
            </Group>
            <Separator />
            <Group>
                <MenuItem
                    disabled={!canSendInvite}
                    onSelect={() => void actions.invite(friend)}
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
                    onSelect={() => void actions.requestInvite(friend)}
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
                    onSelect={() => void actions.boop(friend)}
                >
                    {t('dialog.user.actions.send_boop')}
                </MenuItem>
            </Group>
        </>
    );
}
