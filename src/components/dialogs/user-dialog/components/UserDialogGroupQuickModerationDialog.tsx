import {
    ArrowRightIcon,
    BanIcon,
    LoaderCircleIcon,
    ShieldAlertIcon,
    UserMinusIcon,
    UsersRoundIcon,
    XIcon
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import type { GroupQuickModerationGroup } from '@/platform/tauri/bindings';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Button } from '@/ui/shadcn/button';
import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList
} from '@/ui/shadcn/combobox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle
} from '@/ui/shadcn/dialog';

import { useUserDialogGroupModeration } from '../useUserDialogGroupModeration';

interface UserDialogGroupQuickModerationDialogProps {
    open: boolean;
    endpoint?: string;
    currentUserId?: string;
    targetUserId?: string;
    targetLabel?: string;
    targetImageUrl?: string;
    onOpenChange: (open: boolean) => void;
    onDetailedManagement: (groupId: string) => void;
}

function displayInitials(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
        return '?';
    }
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length > 1) {
        return `${words[0]?.charAt(0) || ''}${words[1]?.charAt(0) || ''}`.toUpperCase();
    }
    return trimmed.slice(0, 2).toUpperCase();
}

function titleCaseValue(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }
    return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function groupSubtitle(
    group: GroupQuickModerationGroup,
    memberFallback: string
) {
    const membershipLabel =
        titleCaseValue(group.membershipLabel) || memberFallback;
    return [membershipLabel, group.roleLabel].filter(Boolean).join(' · ');
}

function GroupAvatar({ group }: { group: GroupQuickModerationGroup }) {
    const iconUrl = group.iconUrl
        ? convertFileUrlToImageUrl(group.iconUrl, 128)
        : '';
    return (
        <Avatar className="size-10 rounded-md after:rounded-md">
            {iconUrl ? (
                <AvatarImage src={iconUrl} alt="" className="rounded-md" />
            ) : null}
            <AvatarFallback className="bg-primary/15 text-primary rounded-md [&>svg]:size-4">
                <UsersRoundIcon aria-hidden="true" />
            </AvatarFallback>
        </Avatar>
    );
}

function SectionTitle({
    icon: Icon,
    title,
    count
}: {
    icon: typeof UsersRoundIcon;
    title: string;
    count?: string;
}) {
    return (
        <div className="text-muted-foreground flex items-center justify-between gap-3 px-6 text-sm font-semibold">
            <span className="inline-flex min-w-0 items-center gap-2">
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{title}</span>
            </span>
            {count ? (
                <span className="shrink-0 text-xs tabular-nums">{count}</span>
            ) : null}
        </div>
    );
}

function LoadingPanel({
    label,
    className
}: {
    label: string;
    className?: string;
}) {
    return (
        <div
            className={cn(
                'text-muted-foreground flex min-h-[72px] items-center justify-center gap-2 text-sm',
                className
            )}
        >
            <LoaderCircleIcon className="size-4 animate-spin" />
            <span>{label}</span>
        </div>
    );
}

function EmptyPanel({
    label,
    className
}: {
    label: string;
    className?: string;
}) {
    return (
        <div
            className={cn(
                'text-muted-foreground flex min-h-[72px] items-center justify-center px-4 text-center text-sm',
                className
            )}
        >
            {label}
        </div>
    );
}

function ErrorPanel({
    message,
    retryLabel,
    onRetry,
    className
}: {
    message: string;
    retryLabel: string;
    onRetry: () => void;
    className?: string;
}) {
    return (
        <div
            className={cn(
                'text-destructive flex min-h-[72px] flex-col items-center justify-center gap-2 px-4 text-center text-sm',
                className
            )}
        >
            <span>{message}</span>
            <Button size="sm" variant="outline" onClick={onRetry}>
                {retryLabel}
            </Button>
        </div>
    );
}

function InlineConfirmActions({
    busy,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel
}: {
    busy: boolean;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    return (
        <div className="flex shrink-0 items-center gap-2">
            <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={onConfirm}
            >
                {busy ? <LoaderCircleIcon className="animate-spin" /> : null}
                {confirmLabel}
            </Button>
            <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onCancel}
            >
                {cancelLabel}
            </Button>
        </div>
    );
}

export function UserDialogGroupQuickModerationDialog({
    open,
    endpoint,
    currentUserId,
    targetUserId,
    targetLabel = '',
    targetImageUrl = '',
    onOpenChange,
    onDetailedManagement
}: UserDialogGroupQuickModerationDialogProps) {
    const { t } = useTranslation();
    const moderation = useUserDialogGroupModeration({
        open,
        endpoint,
        currentUserId,
        targetUserId
    });
    const banGroupIds = useMemo(
        () => moderation.banGroups.map((group) => group.groupId),
        [moderation.banGroups]
    );
    const banGroupById = useMemo(
        () =>
            new Map(
                moderation.banGroups.map((group) => [group.groupId, group])
            ),
        [moderation.banGroups]
    );
    const memberLabel = t('dialog.user.group_moderation.member');
    const canUseGroups = moderation.groupsStatus === 'ready';
    const selectedBanGroupId = moderation.selectedBanGroupId || null;
    const detailedGroupId = moderation.detailedGroupId;
    const confirmLabel = t('common.actions.confirm');
    const cancelLabel = t('common.actions.cancel');

    function groupName(groupId: string) {
        return banGroupById.get(groupId)?.name || groupId;
    }

    function openDetailedManagement() {
        if (!detailedGroupId) {
            return;
        }
        onOpenChange(false);
        onDetailedManagement(detailedGroupId);
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                showCloseButton={false}
                className="max-h-[calc(100vh-3rem)] gap-0 overflow-hidden p-0 sm:max-w-[min(92vw,37rem)]"
            >
                <div className="flex items-center gap-3 border-b px-6 py-5">
                    <Avatar className="size-12">
                        {targetImageUrl ? (
                            <AvatarImage src={targetImageUrl} alt="" />
                        ) : null}
                        <AvatarFallback className="bg-primary/20 text-primary">
                            {displayInitials(targetLabel || targetUserId || '')}
                        </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                        <DialogTitle className="truncate text-lg">
                            {t('dialog.user.group_moderation.title')}
                        </DialogTitle>
                        <DialogDescription className="truncate text-sm font-medium">
                            {targetLabel ||
                                targetUserId ||
                                t('dialog.user.group_moderation.target')}
                        </DialogDescription>
                    </div>
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                    >
                        <XIcon />
                        <span className="sr-only">
                            {t('common.actions.close')}
                        </span>
                    </Button>
                </div>

                <div className="grid gap-5 px-0 py-5">
                    <section className="grid gap-3">
                        <SectionTitle
                            icon={UserMinusIcon}
                            title={t(
                                'dialog.user.group_moderation.kick_section'
                            )}
                            count={t(
                                'dialog.user.group_moderation.groups_count',
                                { count: moderation.kickGroups.length }
                            )}
                        />
                        <div className="bg-muted/30 mx-6 rounded-lg">
                            {moderation.groupsStatus === 'loading' ? (
                                moderation.groupsLoadingVisible ? (
                                    <LoadingPanel
                                        className="h-[132px]"
                                        label={t(
                                            'dialog.user.group_moderation.loading'
                                        )}
                                    />
                                ) : (
                                    <div className="h-[132px]" />
                                )
                            ) : moderation.groupsStatus === 'error' ? (
                                <ErrorPanel
                                    className="min-h-[132px]"
                                    message={moderation.groupsError}
                                    retryLabel={t('common.action.retry')}
                                    onRetry={moderation.reload}
                                />
                            ) : moderation.kickGroups.length ? (
                                <div className="max-h-[132px] overflow-y-auto p-1">
                                    {moderation.kickGroups.map((group) => {
                                        const pending =
                                            moderation.pendingKickGroupId ===
                                            group.groupId;
                                        const busy =
                                            moderation.kickBusyGroupId ===
                                            group.groupId;
                                        return (
                                            <div
                                                key={group.groupId}
                                                className="flex min-h-[60px] items-center gap-3 rounded-md px-3 py-2"
                                            >
                                                <GroupAvatar group={group} />
                                                <div className="min-w-0 flex-1">
                                                    <div className="truncate font-semibold">
                                                        {group.name ||
                                                            group.groupId}
                                                    </div>
                                                    <div className="text-muted-foreground truncate text-xs">
                                                        {groupSubtitle(
                                                            group,
                                                            memberLabel
                                                        )}
                                                    </div>
                                                </div>
                                                {pending ? (
                                                    <InlineConfirmActions
                                                        busy={busy}
                                                        confirmLabel={
                                                            confirmLabel
                                                        }
                                                        cancelLabel={
                                                            cancelLabel
                                                        }
                                                        onConfirm={() => {
                                                            moderation.kickGroup(
                                                                group
                                                            );
                                                        }}
                                                        onCancel={() =>
                                                            moderation.setPendingKickGroupId(
                                                                ''
                                                            )
                                                        }
                                                    />
                                                ) : (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        onClick={() =>
                                                            moderation.setPendingKickGroupId(
                                                                group.groupId
                                                            )
                                                        }
                                                    >
                                                        {t(
                                                            'dialog.group_member_moderation.kick'
                                                        )}
                                                    </Button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <EmptyPanel
                                    className="min-h-[132px]"
                                    label={t(
                                        'dialog.user.group_moderation.no_kickable'
                                    )}
                                />
                            )}
                        </div>
                    </section>

                    <section className="grid gap-3">
                        <SectionTitle
                            icon={BanIcon}
                            title={t(
                                'dialog.user.group_moderation.ban_section'
                            )}
                        />
                        <div className="mx-6 grid gap-3">
                            <Combobox
                                items={banGroupIds}
                                value={selectedBanGroupId}
                                itemToStringLabel={(groupId: string) =>
                                    groupName(groupId)
                                }
                                onValueChange={(value: string | null) => {
                                    moderation.setSelectedBanGroupId(
                                        typeof value === 'string' ? value : ''
                                    );
                                    moderation.setPendingBanGroupId('');
                                }}
                            >
                                <ComboboxInput
                                    className="w-full"
                                    disabled={
                                        !canUseGroups || !banGroupIds.length
                                    }
                                    placeholder={t(
                                        'dialog.user.group_moderation.select_group'
                                    )}
                                />
                                <ComboboxContent>
                                    <ComboboxEmpty>
                                        {t('dialog.user.empty.no_results')}
                                    </ComboboxEmpty>
                                    <ComboboxList>
                                        {(groupId: string) => {
                                            const group =
                                                banGroupById.get(groupId);
                                            return (
                                                <ComboboxItem
                                                    key={groupId}
                                                    value={groupId}
                                                >
                                                    <span className="min-w-0 truncate">
                                                        {group?.name || groupId}
                                                    </span>
                                                </ComboboxItem>
                                            );
                                        }}
                                    </ComboboxList>
                                </ComboboxContent>
                            </Combobox>
                            {moderation.groupsStatus === 'loading' ? (
                                moderation.groupsLoadingVisible ? (
                                    <LoadingPanel
                                        label={t(
                                            'dialog.user.group_moderation.loading'
                                        )}
                                    />
                                ) : (
                                    <div className="min-h-[72px]" />
                                )
                            ) : moderation.groupsStatus === 'error' ? (
                                <ErrorPanel
                                    message={moderation.groupsError}
                                    retryLabel={t('common.action.retry')}
                                    onRetry={moderation.reload}
                                />
                            ) : !moderation.banGroups.length ? (
                                <EmptyPanel
                                    label={t(
                                        'dialog.user.group_moderation.no_bannable'
                                    )}
                                />
                            ) : !moderation.selectedBanGroupId ? (
                                <EmptyPanel
                                    label={t(
                                        'dialog.user.group_moderation.select_group_hint'
                                    )}
                                />
                            ) : (
                                <div className="border-border flex min-h-[72px] items-center gap-3 rounded-lg border px-4 py-3">
                                    <ShieldAlertIcon className="text-muted-foreground size-5 shrink-0" />
                                    <span className="text-muted-foreground min-w-0 flex-1 text-sm">
                                        {t(
                                            'dialog.user.group_moderation.ban_ready'
                                        )}
                                    </span>
                                    {moderation.pendingBanGroupId ===
                                    moderation.selectedBanGroupId ? (
                                        <InlineConfirmActions
                                            busy={moderation.banBusy}
                                            confirmLabel={confirmLabel}
                                            cancelLabel={cancelLabel}
                                            onConfirm={() => {
                                                moderation.runBanAction();
                                            }}
                                            onCancel={() =>
                                                moderation.setPendingBanGroupId(
                                                    ''
                                                )
                                            }
                                        />
                                    ) : (
                                        <Button
                                            type="button"
                                            variant="destructive"
                                            onClick={() =>
                                                moderation.setPendingBanGroupId(
                                                    moderation.selectedBanGroupId
                                                )
                                            }
                                        >
                                            {t(
                                                'dialog.group_member_moderation.ban'
                                            )}
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>
                    </section>
                </div>

                <div className="bg-muted/40 flex justify-end border-t px-6 py-4">
                    <Button
                        type="button"
                        variant="outline"
                        disabled={!detailedGroupId}
                        onClick={openDetailedManagement}
                    >
                        {t('dialog.user.group_moderation.detailed')}
                        <ArrowRightIcon data-icon="inline-end" />
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
