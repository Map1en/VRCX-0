import { Trash2Icon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
    EntityRecord,
    GroupProfileRecord
} from '@/domain/entities/profileEntities';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Spinner } from '@/ui/shadcn/spinner';
import { Textarea } from '@/ui/shadcn/textarea';

import { hasGroupPermission } from './groupDialogUtils';
import { moderationRowLabel, moderationRowUserId } from './groupModerationRows';

const VISIBLE_SELECTION_BADGES = 8;

export interface GroupModerationBulkProgress {
    current: number;
    total: number;
}

export function GroupModerationBulkPanel({
    tabValue,
    group,
    selectedRows,
    busy,
    progress,
    onClear,
    onRemoveRow,
    onKick,
    onBan,
    onUnban,
    onSaveNote,
    onAddRoles,
    onRemoveRoles
}: {
    tabValue: 'bans' | 'members';
    group: GroupProfileRecord;
    selectedRows: EntityRecord[];
    busy: boolean;
    progress: GroupModerationBulkProgress | null;
    onClear: () => void;
    onRemoveRow: (userId: string) => void;
    onKick?: () => void;
    onBan?: () => void;
    onUnban?: () => void;
    onSaveNote?: (note: string) => void;
    onAddRoles?: (roleIds: string[]) => void;
    onRemoveRoles?: (roleIds: string[]) => void;
}) {
    const { t } = useTranslation();
    const [note, setNote] = useState('');
    const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);

    useEffect(() => {
        setNote('');
        setSelectedRoleIds([]);
    }, [tabValue]);

    const roles = Array.isArray(group.roles) ? group.roles : [];
    const canAssignRoles = hasGroupPermission(group, 'group-roles-assign');
    const canManageMembers = hasGroupPermission(group, 'group-members-manage');
    const canRemoveMembers = hasGroupPermission(group, 'group-members-remove');
    const canManageBans = hasGroupPermission(group, 'group-bans-manage');

    function toggleRoleId(roleId: string, checked: boolean) {
        setSelectedRoleIds((current) => {
            const next = new Set(current);
            if (checked) {
                next.add(roleId);
            } else {
                next.delete(roleId);
            }
            return Array.from(next);
        });
    }

    return (
        <div className="bg-muted/40 mb-3 flex flex-col gap-3 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">
                        {t(
                            'dialog.group_member_moderation.selected_users_count',
                            { count: selectedRows.length }
                        )}
                    </span>
                    {selectedRows
                        .slice(0, VISIBLE_SELECTION_BADGES)
                        .map((row) => {
                            const userId = moderationRowUserId(row);
                            return (
                                <Badge
                                    key={userId}
                                    variant="outline"
                                    className="gap-1"
                                >
                                    <span className="max-w-32 truncate">
                                        {moderationRowLabel(row)}
                                    </span>
                                    <button
                                        type="button"
                                        aria-label={t('common.actions.delete')}
                                        disabled={busy}
                                        onClick={() => onRemoveRow(userId)}
                                    >
                                        <XIcon className="size-3" />
                                    </button>
                                </Badge>
                            );
                        })}
                    {selectedRows.length > VISIBLE_SELECTION_BADGES ? (
                        <span className="text-muted-foreground text-xs">
                            +{selectedRows.length - VISIBLE_SELECTION_BADGES}
                        </span>
                    ) : null}
                </div>
                <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    className="rounded-full"
                    disabled={busy}
                    onClick={onClear}
                    aria-label={t('common.actions.delete')}
                >
                    <Trash2Icon />
                </Button>
            </div>

            {tabValue === 'members' ? (
                <>
                    <div className="flex flex-col gap-1.5">
                        <span className="text-muted-foreground text-xs">
                            {t('dialog.group_member_moderation.notes')}
                        </span>
                        <Textarea
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                            rows={2}
                            className="resize-none text-xs"
                            placeholder={t(
                                'dialog.group_member_moderation.note_placeholder'
                            )}
                            disabled={busy || !canManageMembers}
                        />
                    </div>
                    {roles.length ? (
                        <div className="flex flex-col gap-1.5">
                            <span className="text-muted-foreground text-xs">
                                {t(
                                    'dialog.group_member_moderation.selected_roles'
                                )}
                            </span>
                            <DropdownMenu>
                                <DropdownMenuTrigger
                                    render={
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={busy || !canAssignRoles}
                                            className="w-fit"
                                        >
                                            {selectedRoleIds.length
                                                ? t(
                                                      'dialog.group_member_moderation.roles_count',
                                                      {
                                                          count: selectedRoleIds.length
                                                      }
                                                  )
                                                : t(
                                                      'dialog.group_member_moderation.choose_roles_placeholder'
                                                  )}
                                        </Button>
                                    }
                                />
                                <DropdownMenuContent className="max-h-80 w-64 overflow-y-auto">
                                    {roles.map((role) => {
                                        const roleId = role.id || '';
                                        if (!roleId) {
                                            return null;
                                        }
                                        return (
                                            <DropdownMenuCheckboxItem
                                                key={roleId}
                                                checked={selectedRoleIds.includes(
                                                    roleId
                                                )}
                                                onClick={(event) =>
                                                    event.preventDefault()
                                                }
                                                onCheckedChange={() =>
                                                    toggleRoleId(
                                                        roleId,
                                                        !selectedRoleIds.includes(
                                                            roleId
                                                        )
                                                    )
                                                }
                                            >
                                                <span className="truncate">
                                                    {role.name || roleId}
                                                </span>
                                            </DropdownMenuCheckboxItem>
                                        );
                                    })}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    ) : null}
                </>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
                {tabValue === 'members' ? (
                    <>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={
                                busy ||
                                !selectedRoleIds.length ||
                                !canAssignRoles
                            }
                            onClick={() => onAddRoles?.(selectedRoleIds)}
                        >
                            {t('dialog.group_member_moderation.add_roles')}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={
                                busy ||
                                !selectedRoleIds.length ||
                                !canAssignRoles
                            }
                            onClick={() => onRemoveRoles?.(selectedRoleIds)}
                        >
                            {t('dialog.group_member_moderation.remove_roles')}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy || !canManageMembers}
                            onClick={() => onSaveNote?.(note)}
                        >
                            {t('dialog.group_member_moderation.save_note')}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy || !canRemoveMembers}
                            onClick={onKick}
                        >
                            {t('dialog.group_member_moderation.kick')}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy || !canManageBans}
                            onClick={onBan}
                        >
                            {t('dialog.group_member_moderation.ban')}
                        </Button>
                    </>
                ) : (
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy || !canManageBans}
                        onClick={onUnban}
                    >
                        {t('dialog.group_member_moderation.unban')}
                    </Button>
                )}
                {progress ? (
                    <span className="text-muted-foreground flex items-center gap-2 text-sm">
                        <Spinner />
                        {t('dialog.group_member_moderation.progress')}{' '}
                        {progress.current}/{progress.total}
                    </span>
                ) : null}
            </div>
        </div>
    );
}
