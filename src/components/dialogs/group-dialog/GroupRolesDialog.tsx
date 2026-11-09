import {
    closestCenter,
    DndContext,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    GripVerticalIcon,
    PlusIcon,
    RefreshCwIcon,
    Trash2Icon
} from 'lucide-react';
import {
    useCallback,
    useEffect,
    useEffectEvent,
    useMemo,
    useState
} from 'react';
import { useTranslation } from 'react-i18next';

import type {
    GroupProfileRecord,
    GroupRoleRecord
} from '@/domain/entities/group';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { cn } from '@/lib/utils';
import { commands } from '@/platform/tauri/bindings';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { unwrapVrchatResponse } from '@/repositories/vrchatRequest';
import { toast } from '@/services/toastService';
import { isRecord } from '@/shared/utils/record';
import { useModalStore } from '@/state/modalStore';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel,
    FieldLegend,
    FieldSet
} from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import { Spinner } from '@/ui/shadcn/spinner';
import { Textarea } from '@/ui/shadcn/textarea';

import { hasGroupPermission } from './groupDialogUtils';
import {
    canToggleOwnRole,
    GROUP_ROLE_DESCRIPTION_MAX,
    GROUP_ROLE_NAME_MAX,
    groupPermissionDefinitions,
    groupRoleEditability,
    groupRoleForm,
    groupRoleMutation,
    isDefaultRole,
    isLockedRole,
    planGroupRoleReorder,
    sortGroupRoles,
    stringList,
    viewOnlyPermissionDefinitions,
    type GroupPermissionDefinition,
    type GroupRoleForm,
    type GroupRoleViewer
} from './groupRoleRules';

const I18N = 'dialog.group_roles';
const NEW_ROLE = '__new__';

function roleRecords(value: unknown): GroupRoleRecord[] {
    return (Array.isArray(value) ? value : []).filter(isRecord);
}

function RoleListItem({
    role,
    selected,
    draggable,
    deletable,
    assigned,
    onSelect,
    onDelete
}: {
    role: GroupRoleRecord;
    selected: boolean;
    draggable: boolean;
    deletable: boolean;
    assigned: boolean;
    onSelect(): void;
    onDelete(): void;
}) {
    const { t } = useTranslation();
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: role.id || '', disabled: !draggable });
    const badges = [
        assigned ? t(`${I18N}.assigned_to_you`) : '',
        isDefaultRole(role) ? t(`${I18N}.default_role`) : '',
        role.isSelfAssignable ? t(`${I18N}.self_assignable`) : '',
        role.isAddedOnJoin ? t(`${I18N}.added_on_join`) : '',
        role.requiresTwoFactor ? t(`${I18N}.requires_two_factor`) : '',
        role.requiresPurchase ? t(`${I18N}.requires_purchase`) : ''
    ].filter(Boolean);

    return (
        <div
            ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(transform), transition }}
            className={cn(
                'group/role flex items-start gap-1 rounded-md px-1 py-1.5',
                selected ? 'bg-accent' : 'hover:bg-muted/60',
                isDragging && 'opacity-50'
            )}
        >
            <span
                {...attributes}
                {...listeners}
                aria-hidden={!draggable}
                className={cn(
                    'text-muted-foreground mt-0.5 shrink-0',
                    draggable ? 'cursor-grab' : 'invisible'
                )}
            >
                <GripVerticalIcon className="size-4" />
            </span>
            <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={onSelect}
            >
                <span className="block truncate text-sm font-medium">
                    {role.name || role.id}
                </span>
                {badges.length ? (
                    <span className="mt-1 flex flex-wrap gap-1">
                        {badges.map((badge) => (
                            <Badge
                                key={badge}
                                variant="outline"
                                className="h-4 px-1 text-[10px]"
                            >
                                {badge}
                            </Badge>
                        ))}
                    </span>
                ) : null}
            </button>
            {deletable ? (
                <HintTooltip label={t(`${I18N}.delete`)}>
                    <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        className="opacity-0 group-hover/role:opacity-100 focus-visible:opacity-100"
                        onClick={onDelete}
                    >
                        <Trash2Icon />
                    </Button>
                </HintTooltip>
            ) : null}
        </div>
    );
}

function PermissionGrid({
    title,
    permissions,
    selected,
    readOnly,
    onToggle
}: {
    title: string;
    permissions: GroupPermissionDefinition[];
    selected: string[];
    readOnly: boolean;
    onToggle(name: string, checked: boolean): void;
}) {
    if (!permissions.length) {
        return null;
    }
    const hasAll = selected.includes('*');
    return (
        <FieldSet>
            <FieldLegend variant="label">{title}</FieldLegend>
            <div className="grid gap-x-4 gap-y-2 xl:grid-cols-2">
                {permissions.map((permission) => {
                    const disabled = readOnly || !permission.allowedToAdd;
                    return (
                        <Field
                            key={permission.name}
                            orientation="horizontal"
                            data-disabled={disabled}
                        >
                            <Checkbox
                                id={`group-role-permission-${permission.name}`}
                                checked={
                                    hasAll || selected.includes(permission.name)
                                }
                                disabled={disabled}
                                onCheckedChange={(checked) =>
                                    onToggle(permission.name, checked === true)
                                }
                            />
                            <div className="min-w-0">
                                <FieldLabel
                                    htmlFor={`group-role-permission-${permission.name}`}
                                >
                                    {permission.displayName || permission.name}
                                </FieldLabel>
                                {permission.help ? (
                                    <FieldDescription>
                                        {permission.help}
                                    </FieldDescription>
                                ) : null}
                            </div>
                        </Field>
                    );
                })}
            </div>
        </FieldSet>
    );
}

export function GroupRolesDialog({
    open,
    group,
    currentUserId,
    onOpenChange,
    onChanged
}: {
    open: boolean;
    group: GroupProfileRecord;
    currentUserId: string | null;
    onOpenChange(open: boolean): void;
    onChanged(): void;
}) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const groupId = group.id || '';
    const myMember = isRecord(group.myMember) ? group.myMember : {};
    const canManage = hasGroupPermission(group, 'group-roles-manage');
    const canManageDefaultRole = hasGroupPermission(
        group,
        'group-default-role-manage'
    );
    const canEditRoles = canManage || canManageDefaultRole;
    const [roles, setRoles] = useState<GroupRoleRecord[]>([]);
    const [permissions, setPermissions] = useState<GroupPermissionDefinition[]>(
        []
    );
    const [myRoleIds, setMyRoleIds] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [selectedRoleId, setSelectedRoleId] = useState('');
    const [form, setForm] = useState<GroupRoleForm>(groupRoleForm(null));
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates
        })
    );
    const viewer: GroupRoleViewer = {
        canManage,
        canManageDefaultRole,
        canAssignRoles: hasGroupPermission(group, 'group-roles-assign'),
        myRoleIds,
        isMember: myMember.membershipStatus === 'member'
    };
    const sortedRoles = useMemo(() => sortGroupRoles(roles), [roles]);
    const managementRoles = sortedRoles.filter(
        (role) => role.isManagementRole === true
    );
    const memberRoles = sortedRoles.filter(
        (role) => role.isManagementRole !== true
    );
    const selectedRole =
        selectedRoleId && selectedRoleId !== NEW_ROLE
            ? (sortedRoles.find((role) => role.id === selectedRoleId) ?? null)
            : null;
    const isCreating = selectedRoleId === NEW_ROLE;
    const editability = groupRoleEditability(selectedRole, sortedRoles, viewer);
    const formReadOnly = editability.readOnly || saving;
    const canSave = !formReadOnly && form.name.trim().length > 0;

    const load = useCallback(async () => {
        if (!groupId) {
            return;
        }
        setLoading(true);
        try {
            if (canEditRoles) {
                const [rolesResponse, permissionsResponse] = await Promise.all([
                    commands.appVrchatGroupRolesGet({ groupId }),
                    commands.appVrchatGroupPermissionsGet({ groupId })
                ]);
                setRoles(
                    roleRecords(
                        unwrapVrchatResponse<unknown>(
                            rolesResponse,
                            `groups/${encodeURIComponent(groupId)}/roles`
                        ).json
                    )
                );
                setPermissions(
                    groupPermissionDefinitions(
                        unwrapVrchatResponse<unknown>(
                            permissionsResponse,
                            `groups/${encodeURIComponent(groupId)}/permissions`
                        ).json
                    )
                );
            } else {
                const nextRoles = roleRecords(group.roles);
                setRoles(nextRoles);
                setPermissions(viewOnlyPermissionDefinitions(nextRoles));
            }
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(error, t(`${I18N}.load_failed`))
            });
        } finally {
            setLoading(false);
        }
    }, [canEditRoles, group.roles, groupId, t]);

    const resetForOpen = useEffectEvent(() => {
        setSelectedRoleId('');
        setForm(groupRoleForm(null));
        setMyRoleIds(stringList(myMember.roleIds));
        void load();
    });

    useEffect(() => {
        if (open) {
            resetForOpen();
        }
    }, [open, groupId]);

    function selectRole(roleId: string) {
        setSelectedRoleId(roleId);
        setForm(
            groupRoleForm(
                roleId === NEW_ROLE
                    ? null
                    : (sortedRoles.find((role) => role.id === roleId) ?? null)
            )
        );
    }

    async function runMutation(
        action: () => Promise<void>,
        failureKey: string
    ) {
        setSaving(true);
        try {
            await action();
            await load();
            onChanged();
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(error, t(failureKey))
            });
        } finally {
            setSaving(false);
        }
    }

    async function saveRole() {
        if (!canSave) {
            return;
        }
        const params = groupRoleMutation(form, editability);
        await runMutation(async () => {
            if (isCreating) {
                const response = unwrapVrchatResponse<unknown>(
                    await commands.appVrchatGroupRoleCreate({
                        groupId,
                        params
                    }),
                    `groups/${encodeURIComponent(groupId)}/roles`
                );
                const createdId =
                    isRecord(response.json) &&
                    typeof response.json.id === 'string'
                        ? response.json.id
                        : '';
                setSelectedRoleId(createdId);
            } else if (selectedRole?.id) {
                unwrapVrchatResponse(
                    await commands.appVrchatGroupRoleUpdate({
                        groupId,
                        roleId: selectedRole.id,
                        params
                    }),
                    `groups/${encodeURIComponent(groupId)}/roles/${encodeURIComponent(selectedRole.id)}`
                );
            }
            toast.add({ type: 'success', title: t(`${I18N}.saved`) });
        }, `${I18N}.save_failed`);
    }

    async function deleteRole(role: GroupRoleRecord) {
        const roleId = role.id;
        if (!roleId) {
            return;
        }
        const result = await confirm({
            title: t(`${I18N}.delete_confirm`),
            description: role.name || roleId,
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        await runMutation(async () => {
            unwrapVrchatResponse(
                await commands.appVrchatGroupRoleDelete({ groupId, roleId }),
                `groups/${encodeURIComponent(groupId)}/roles/${encodeURIComponent(roleId)}`
            );
            if (selectedRoleId === roleId) {
                setSelectedRoleId('');
                setForm(groupRoleForm(null));
            }
            toast.add({ type: 'success', title: t(`${I18N}.deleted`) });
        }, `${I18N}.delete_failed`);
    }

    async function toggleOwnRole(role: GroupRoleRecord) {
        const roleId = role.id;
        if (!roleId || !currentUserId) {
            return;
        }
        const assigned = myRoleIds.includes(roleId);
        await runMutation(async () => {
            const input = { groupId, userId: currentUserId, roleId };
            const response = assigned
                ? await groupProfileRepository.removeGroupMemberRole(input)
                : await groupProfileRepository.addGroupMemberRole(input);
            setMyRoleIds(
                Array.isArray(response.json)
                    ? stringList(response.json)
                    : assigned
                      ? myRoleIds.filter((id) => id !== roleId)
                      : [...myRoleIds, roleId]
            );
            toast.add({
                type: 'success',
                title: t(
                    assigned
                        ? `${I18N}.self_role_removed`
                        : `${I18N}.self_role_added`
                )
            });
        }, `${I18N}.self_role_failed`);
    }

    function handleDragEnd({ active, over }: DragEndEvent) {
        if (!over || saving) {
            return;
        }
        const activeId = String(active.id);
        const overId = String(over.id);
        const section = [managementRoles, memberRoles]
            .map((rolesInSection) =>
                rolesInSection.map((role) => role.id || '')
            )
            .find((ids) => ids.includes(activeId) && ids.includes(overId));
        if (!section) {
            return;
        }
        const updates = planGroupRoleReorder(
            sortedRoles,
            section,
            activeId,
            overId,
            viewer
        );
        if (!updates?.length) {
            return;
        }
        void runMutation(async () => {
            for (const update of updates) {
                unwrapVrchatResponse(
                    await commands.appVrchatGroupRoleUpdate({
                        groupId,
                        roleId: update.roleId,
                        params: { order: update.order }
                    }),
                    `groups/${encodeURIComponent(groupId)}/roles/${encodeURIComponent(update.roleId)}`
                );
            }
        }, `${I18N}.save_failed`);
    }

    function renderSection(title: string, sectionRoles: GroupRoleRecord[]) {
        if (!sectionRoles.length) {
            return null;
        }
        return (
            <div className="flex flex-col gap-0.5">
                <div className="text-muted-foreground px-1 pt-2 pb-1 text-xs font-medium">
                    {title}
                </div>
                <SortableContext
                    items={sectionRoles.map((role) => role.id || '')}
                    strategy={verticalListSortingStrategy}
                >
                    {sectionRoles.map((role) => {
                        const locked = isLockedRole(role, sortedRoles, viewer);
                        return (
                            <RoleListItem
                                key={role.id}
                                role={role}
                                selected={role.id === selectedRoleId}
                                draggable={canManage && !locked && !saving}
                                deletable={canManage && !locked && !saving}
                                assigned={Boolean(
                                    role.id && myRoleIds.includes(role.id)
                                )}
                                onSelect={() => selectRole(role.id || '')}
                                onDelete={() => void deleteRole(role)}
                            />
                        );
                    })}
                </SortableContext>
            </div>
        );
    }

    function togglePermission(name: string, checked: boolean) {
        setForm((current) => ({
            ...current,
            permissions: checked
                ? Array.from(new Set([...current.permissions, name]))
                : current.permissions.filter(
                      (permission) => permission !== name
                  )
        }));
    }

    const flagFields = [
        ['isSelfAssignable', 'self_assignable'],
        ['isAddedOnJoin', 'added_on_join'],
        ['requiresTwoFactor', 'requires_two_factor'],
        ['requiresPurchase', 'requires_purchase']
    ] as const;
    const showEditor = isCreating || Boolean(selectedRole);
    const canToggleSelf =
        selectedRole !== null &&
        canToggleOwnRole(selectedRole, sortedRoles, viewer);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="grid h-[min(80vh,48rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-5xl">
                <DialogHeader>
                    <DialogTitle>
                        {t(
                            canEditRoles
                                ? `${I18N}.header`
                                : `${I18N}.view_header`
                        )}
                    </DialogTitle>
                    <DialogDescription>{group.name}</DialogDescription>
                </DialogHeader>
                <div className="grid min-h-0 gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
                    <div className="flex min-h-0 flex-col gap-2 md:border-r md:pr-3">
                        <div className="flex items-center gap-2">
                            {canManage ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={loading || saving}
                                    onClick={() => selectRole(NEW_ROLE)}
                                >
                                    <PlusIcon data-icon="inline-start" />
                                    {t(`${I18N}.new_role`)}
                                </Button>
                            ) : null}
                            <HintTooltip label={t('common.actions.refresh')}>
                                <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    className="ml-auto"
                                    disabled={loading || saving}
                                    onClick={() => void load()}
                                >
                                    {loading ? <Spinner /> : <RefreshCwIcon />}
                                </Button>
                            </HintTooltip>
                        </div>
                        <ScrollArea className="min-h-0 flex-1">
                            {sortedRoles.length ? (
                                <DndContext
                                    sensors={sensors}
                                    collisionDetection={closestCenter}
                                    onDragEnd={handleDragEnd}
                                >
                                    {renderSection(
                                        t(`${I18N}.management_roles`),
                                        managementRoles
                                    )}
                                    {renderSection(
                                        t(`${I18N}.member_roles`),
                                        memberRoles
                                    )}
                                </DndContext>
                            ) : (
                                <p className="text-muted-foreground p-2 text-sm">
                                    {loading
                                        ? t('common.loading')
                                        : t(`${I18N}.no_roles`)}
                                </p>
                            )}
                        </ScrollArea>
                    </div>
                    {showEditor ? (
                        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3">
                            <ScrollArea className="-mx-1 min-h-0">
                                <FieldGroup className="gap-4 px-1 pb-3">
                                    <Field>
                                        <div className="flex items-center justify-between gap-2">
                                            <FieldLabel htmlFor="group-role-name">
                                                {t(`${I18N}.name`)}
                                            </FieldLabel>
                                            <span className="text-muted-foreground text-xs tabular-nums">
                                                {form.name.length}/
                                                {GROUP_ROLE_NAME_MAX}
                                            </span>
                                        </div>
                                        <Input
                                            id="group-role-name"
                                            value={form.name}
                                            maxLength={GROUP_ROLE_NAME_MAX}
                                            disabled={
                                                formReadOnly ||
                                                editability.detailsReadOnly
                                            }
                                            onChange={(event) =>
                                                setForm((current) => ({
                                                    ...current,
                                                    name: event.target.value
                                                }))
                                            }
                                        />
                                    </Field>
                                    <Field>
                                        <div className="flex items-center justify-between gap-2">
                                            <FieldLabel htmlFor="group-role-description">
                                                {t(`${I18N}.description`)}
                                            </FieldLabel>
                                            <span className="text-muted-foreground text-xs tabular-nums">
                                                {form.description.length}/
                                                {GROUP_ROLE_DESCRIPTION_MAX}
                                            </span>
                                        </div>
                                        <Textarea
                                            id="group-role-description"
                                            rows={3}
                                            value={form.description}
                                            maxLength={
                                                GROUP_ROLE_DESCRIPTION_MAX
                                            }
                                            className="resize-none"
                                            disabled={
                                                formReadOnly ||
                                                editability.detailsReadOnly
                                            }
                                            onChange={(event) =>
                                                setForm((current) => ({
                                                    ...current,
                                                    description:
                                                        event.target.value
                                                }))
                                            }
                                        />
                                    </Field>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        {flagFields.map(([key, labelKey]) => {
                                            const disabled =
                                                formReadOnly ||
                                                (key === 'requiresTwoFactor'
                                                    ? editability.detailsReadOnly
                                                    : editability.flagsReadOnly);
                                            return (
                                                <Field
                                                    key={key}
                                                    orientation="horizontal"
                                                    data-disabled={disabled}
                                                >
                                                    <Checkbox
                                                        id={`group-role-${key}`}
                                                        checked={form[key]}
                                                        disabled={disabled}
                                                        onCheckedChange={(
                                                            checked
                                                        ) =>
                                                            setForm(
                                                                (current) => ({
                                                                    ...current,
                                                                    [key]:
                                                                        checked ===
                                                                        true
                                                                })
                                                            )
                                                        }
                                                    />
                                                    <div className="min-w-0">
                                                        <FieldLabel
                                                            htmlFor={`group-role-${key}`}
                                                        >
                                                            {t(
                                                                `${I18N}.${labelKey}`
                                                            )}
                                                        </FieldLabel>
                                                        <FieldDescription>
                                                            {t(
                                                                `${I18N}.${labelKey}_description`
                                                            )}
                                                        </FieldDescription>
                                                    </div>
                                                </Field>
                                            );
                                        })}
                                    </div>
                                    <PermissionGrid
                                        title={t(`${I18N}.permissions`)}
                                        permissions={permissions.filter(
                                            (permission) =>
                                                !permission.isManagementPermission
                                        )}
                                        selected={form.permissions}
                                        readOnly={
                                            formReadOnly ||
                                            editability.permissionsReadOnly
                                        }
                                        onToggle={togglePermission}
                                    />
                                    <PermissionGrid
                                        title={t(
                                            `${I18N}.management_permissions`
                                        )}
                                        permissions={permissions.filter(
                                            (permission) =>
                                                permission.isManagementPermission
                                        )}
                                        selected={form.permissions}
                                        readOnly={
                                            formReadOnly ||
                                            editability.permissionsReadOnly
                                        }
                                        onToggle={togglePermission}
                                    />
                                </FieldGroup>
                            </ScrollArea>
                            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                                {canToggleSelf && selectedRole ? (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        disabled={saving}
                                        onClick={() =>
                                            void toggleOwnRole(selectedRole)
                                        }
                                    >
                                        {t(
                                            selectedRole.id &&
                                                myRoleIds.includes(
                                                    selectedRole.id
                                                )
                                                ? `${I18N}.remove_self`
                                                : `${I18N}.add_self`
                                        )}
                                    </Button>
                                ) : null}
                                <div className="ml-auto flex gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        disabled={saving}
                                        onClick={() => selectRole('')}
                                    >
                                        {t('common.actions.cancel')}
                                    </Button>
                                    {editability.readOnly ? null : (
                                        <Button
                                            type="button"
                                            disabled={!canSave}
                                            onClick={() => void saveRole()}
                                        >
                                            {saving ? (
                                                <Spinner data-icon="inline-start" />
                                            ) : null}
                                            {t(
                                                isCreating
                                                    ? `${I18N}.create`
                                                    : `${I18N}.save`
                                            )}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-muted-foreground flex items-center justify-center rounded-md border border-dashed p-6 text-sm">
                            {t(`${I18N}.no_role_selected`)}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
