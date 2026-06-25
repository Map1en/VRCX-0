import { ChevronDownIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import {
    Popover,
    PopoverAnchor,
    PopoverContent,
    PopoverTrigger
} from '@/ui/shadcn/popover';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import {
    normalizeInstanceDialogDisplayName,
    prependInstanceDialogDisplayNamePreset
} from './worldInstanceDisplayNamePresets';
import { buildLegacyCreatedInstance } from './worldInstances';

const accessTypeOptions = [
    { value: 'public', labelKey: 'dialog.new_instance.access_type_public' },
    {
        value: 'friends+',
        labelKey: 'dialog.new_instance.access_type_friend_plus'
    },
    { value: 'friends', labelKey: 'dialog.new_instance.access_type_friend' },
    {
        value: 'invite+',
        labelKey: 'dialog.new_instance.access_type_invite_plus'
    },
    { value: 'invite', labelKey: 'dialog.new_instance.access_type_invite' },
    { value: 'group', labelKey: 'dialog.new_instance.access_type_group' }
];

const regionOptions = [
    { value: 'US West', labelKey: 'dialog.new_instance.region_usw' },
    { value: 'US East', labelKey: 'dialog.new_instance.region_use' },
    { value: 'Europe', labelKey: 'dialog.new_instance.region_eu' },
    { value: 'Japan', labelKey: 'dialog.new_instance.region_jp' }
];
const groupAccessTypeOptions = [
    {
        value: 'public',
        labelKey: 'dialog.new_instance.group_access_type_public'
    },
    { value: 'plus', labelKey: 'dialog.new_instance.group_access_type_plus' },
    {
        value: 'members',
        labelKey: 'dialog.new_instance.group_access_type_members'
    }
];

function normalizeText(value: any) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function groupIdForOption(group: any) {
    return normalizeText(group?.groupId || group?.id);
}

function groupLabel(group: any) {
    const groupId = groupIdForOption(group);
    return normalizeText(group?.name || group?.displayName) || groupId;
}

function newInstanceDialogTitleKey(request: any) {
    if (request?.afterCreateAction === 'openInGame') {
        return 'dialog.world.actions.new_instance_and_open_ingame';
    }
    if (request?.selfInvite) {
        return 'dialog.world.actions.new_instance_and_self_invite';
    }
    return 'dialog.new_instance.header';
}

export function WorldNewInstanceDialog({
    open,
    request,
    world,
    currentUserId = '',
    isGameRunning = false,
    groupOptions = [],
    submitting,
    onOpenChange,
    onChange,
    onCommitDisplayName,
    onSubmit,
    onCopy,
    onSelfInvite,
    onInvite,
    onLaunch,
    onOpenInGame
}: any) {
    const { t } = useTranslation();

    const [form, setForm] = useState<any>({
        selectedTab: 'Normal',
        accessType: 'public',
        region: 'US West',
        groupId: '',
        groupAccessType: 'plus',
        queueEnabled: true,
        ageGate: false,
        displayName: '',
        displayNamePresets: [],
        roleIds: '',
        instanceName: '',
        legacyUserId: '',
        strict: false
    });
    const [legacySeed, setLegacySeed] = useState('00001');
    const [displayNamePresetsOpen, setDisplayNamePresetsOpen] = useState(false);

    useEffect(() => {
        if (open && request?.defaults) {
            setLegacySeed(
                String((99999 * Math.random() + 1).toFixed(0)).padStart(5, '0')
            );
            setForm({
                selectedTab: 'Normal',
                instanceName: '',
                legacyUserId: currentUserId || '',
                strict: false,
                ...request.defaults
            });
        }
    }, [currentUserId, open, request]);

    function patchForm(patch: any) {
        setForm((current: any) => {
            const next: any = { ...current, ...patch };
            onChange?.(next);
            return next;
        });
    }

    const legacyCreated =
        form.selectedTab === 'Legacy' && world?.id
            ? buildLegacyCreatedInstance({
                  worldId: world.id,
                  form,
                  currentUserId,
                  legacySeed
              })
            : null;
    const activeCreated = request?.created || legacyCreated;
    const activeAccessType = activeCreated?.accessType || form.accessType;
    const activeOwnerId = activeCreated?.ownerId || currentUserId;
    const selectedGroup =
        groupOptions.find(
            (group: any) => groupIdForOption(group) === form.groupId
        ) || null;
    const missingSelectedGroup =
        form.groupId && !selectedGroup
            ? {
                  id: form.groupId,
                  groupId: form.groupId,
                  name: form.groupName || form.groupId
              }
            : null;
    const visibleGroupOptions = missingSelectedGroup
        ? [missingSelectedGroup, ...groupOptions]
        : groupOptions;
    const inviteDisabled = Boolean(
        (activeAccessType === 'friends' || activeAccessType === 'invite') &&
        activeOwnerId &&
        currentUserId &&
        activeOwnerId !== currentUserId
    );

    function patchGroupId(groupId: any) {
        const group = groupOptions.find(
            (option: any) => groupIdForOption(option) === groupId
        );
        patchForm({
            groupId,
            groupName: groupLabel(group) || groupId,
            roleIds: ''
        });
    }

    const displayNamePresets = Array.isArray(form.displayNamePresets)
        ? form.displayNamePresets
        : [];

    function patchDisplayName(value: any) {
        patchForm({
            displayName: String(value ?? '')
        });
    }

    function commitDisplayNamePreset(value: any = form.displayName) {
        if (form.selectedTab !== 'Normal') {
            return;
        }

        const displayName = normalizeInstanceDialogDisplayName(value);
        if (!displayName) {
            return;
        }

        const nextPresets = prependInstanceDialogDisplayNamePreset(
            displayNamePresets,
            displayName
        );
        patchForm({
            displayName,
            displayNamePresets: nextPresets
        });
        onCommitDisplayName?.(displayName);
    }

    function selectDisplayNamePreset(value: any) {
        commitDisplayNamePreset(value);
        setDisplayNamePresetsOpen(false);
    }

    function renderGroupPicker(inputId: any, disabled: any = false) {
        if (!visibleGroupOptions.length) {
            return (
                <Input
                    id={inputId}
                    value={form.groupId}
                    disabled={disabled}
                    onChange={(event: any) =>
                        patchForm({
                            groupId: event.target.value,
                            groupName: '',
                            roleIds: ''
                        })
                    }
                />
            );
        }
        return (
            <Select
                value={form.groupId}
                disabled={disabled}
                onValueChange={patchGroupId}
            >
                <SelectTrigger id={inputId}>
                    <SelectValue
                        placeholder={t('dialog.new_instance.group_placeholder')}
                    />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {visibleGroupOptions.map((group: any) => {
                            const groupId = groupIdForOption(group);
                            return (
                                <SelectItem key={groupId} value={groupId}>
                                    {groupLabel(group)}
                                </SelectItem>
                            );
                        })}
                    </SelectGroup>
                </SelectContent>
            </Select>
        );
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[min(92vw,32rem)]">
                <DialogHeader>
                    <DialogTitle>
                        {t(newInstanceDialogTitleKey(request))}
                    </DialogTitle>
                    <DialogDescription>
                        {world?.name ||
                            world?.id ||
                            t('dialog.world.label.world')}
                    </DialogDescription>
                </DialogHeader>
                <Tabs
                    value={form.selectedTab}
                    onValueChange={(value: any) =>
                        patchForm({ selectedTab: value })
                    }
                >
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="Normal">
                            {t('dialog.new_instance.normal')}
                        </TabsTrigger>
                        <TabsTrigger value="Legacy">
                            {t('dialog.new_instance.legacy')}
                        </TabsTrigger>
                    </TabsList>
                    <TabsContent value="Normal">
                        <FieldGroup className="gap-4">
                            <Field>
                                <FieldLabel>
                                    {t('dialog.world.label.access')}
                                </FieldLabel>
                                <Select
                                    value={form.accessType}
                                    disabled={Boolean(request?.created)}
                                    onValueChange={(value: any) =>
                                        patchForm({ accessType: value })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {accessTypeOptions.map(
                                                (option: any) => (
                                                    <SelectItem
                                                        key={option.value}
                                                        value={option.value}
                                                    >
                                                        {t(option.labelKey)}
                                                    </SelectItem>
                                                )
                                            )}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field>
                                <FieldLabel>
                                    {t('dialog.new_instance.region')}
                                </FieldLabel>
                                <Select
                                    value={form.region}
                                    disabled={Boolean(request?.created)}
                                    onValueChange={(value: any) =>
                                        patchForm({ region: value })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {regionOptions.map(
                                                (region: any) => (
                                                    <SelectItem
                                                        key={region.value}
                                                        value={region.value}
                                                    >
                                                        {t(region.labelKey)}
                                                    </SelectItem>
                                                )
                                            )}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </Field>
                            {form.accessType === 'group' ? (
                                <>
                                    <Field>
                                        <FieldLabel htmlFor="world-instance-group-id">
                                            {t('dialog.new_instance.group_id')}
                                        </FieldLabel>
                                        {renderGroupPicker(
                                            'world-instance-group-id',
                                            Boolean(request?.created)
                                        )}
                                    </Field>
                                    <Field>
                                        <FieldLabel>
                                            {t(
                                                'dialog.new_instance.group_access_type'
                                            )}
                                        </FieldLabel>
                                        <Select
                                            value={form.groupAccessType}
                                            disabled={Boolean(request?.created)}
                                            onValueChange={(value: any) =>
                                                patchForm({
                                                    groupAccessType: value
                                                })
                                            }
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    {groupAccessTypeOptions.map(
                                                        (option: any) => (
                                                            <SelectItem
                                                                key={
                                                                    option.value
                                                                }
                                                                value={
                                                                    option.value
                                                                }
                                                            >
                                                                {t(
                                                                    option.labelKey
                                                                )}
                                                            </SelectItem>
                                                        )
                                                    )}
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                    {form.groupAccessType === 'members' ? (
                                        <Field>
                                            <FieldLabel htmlFor="world-instance-role-ids">
                                                {t(
                                                    'dialog.world.label.role_ids'
                                                )}
                                            </FieldLabel>
                                            <Input
                                                id="world-instance-role-ids"
                                                value={form.roleIds}
                                                disabled={Boolean(
                                                    request?.created
                                                )}
                                                onChange={(event: any) =>
                                                    patchForm({
                                                        roleIds:
                                                            event.target.value
                                                    })
                                                }
                                            />
                                        </Field>
                                    ) : null}
                                    <FieldGroup data-slot="checkbox-group">
                                        <Field
                                            orientation="horizontal"
                                            data-disabled={Boolean(
                                                request?.created
                                            )}
                                        >
                                            <Checkbox
                                                id="world-instance-queue-enabled"
                                                checked={form.queueEnabled}
                                                disabled={Boolean(
                                                    request?.created
                                                )}
                                                onCheckedChange={(value: any) =>
                                                    patchForm({
                                                        queueEnabled:
                                                            Boolean(value)
                                                    })
                                                }
                                            />
                                            <FieldLabel htmlFor="world-instance-queue-enabled">
                                                {t(
                                                    'dialog.world.label.queue_enabled'
                                                )}
                                            </FieldLabel>
                                        </Field>
                                        <Field
                                            orientation="horizontal"
                                            data-disabled={Boolean(
                                                request?.created
                                            )}
                                        >
                                            <Checkbox
                                                id="world-instance-age-gate"
                                                checked={form.ageGate}
                                                disabled={Boolean(
                                                    request?.created
                                                )}
                                                onCheckedChange={(value: any) =>
                                                    patchForm({
                                                        ageGate: Boolean(value)
                                                    })
                                                }
                                            />
                                            <FieldLabel htmlFor="world-instance-age-gate">
                                                {t(
                                                    'dialog.world.label.age_gate'
                                                )}
                                            </FieldLabel>
                                        </Field>
                                    </FieldGroup>
                                </>
                            ) : null}
                            <Field>
                                <FieldLabel htmlFor="world-instance-display-name">
                                    {t('dialog.world.label.display_name')}
                                </FieldLabel>
                                <Popover
                                    open={displayNamePresetsOpen}
                                    onOpenChange={setDisplayNamePresetsOpen}
                                >
                                    <PopoverAnchor asChild>
                                        <InputGroup>
                                            <InputGroupInput
                                                id="world-instance-display-name"
                                                value={form.displayName}
                                                disabled={Boolean(
                                                    request?.created
                                                )}
                                                onChange={(event: any) =>
                                                    patchDisplayName(
                                                        event.target.value
                                                    )
                                                }
                                            />
                                            {displayNamePresets.length ? (
                                                <InputGroupAddon align="inline-end">
                                                    <PopoverTrigger asChild>
                                                        <InputGroupButton
                                                            size="icon-xs"
                                                            aria-label={t(
                                                                'dialog.world.label.display_name'
                                                            )}
                                                            disabled={Boolean(
                                                                request?.created
                                                            )}
                                                        >
                                                            <ChevronDownIcon data-icon="inline-start" />
                                                        </InputGroupButton>
                                                    </PopoverTrigger>
                                                </InputGroupAddon>
                                            ) : null}
                                        </InputGroup>
                                    </PopoverAnchor>
                                    {displayNamePresets.length ? (
                                        <PopoverContent
                                            align="start"
                                            className="w-80 p-1"
                                        >
                                            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                                                {displayNamePresets.map(
                                                    (name: any) => (
                                                        <Button
                                                            key={name}
                                                            type="button"
                                                            variant="ghost"
                                                            className="h-auto w-full justify-start p-1.5 text-left font-normal"
                                                            onClick={() =>
                                                                selectDisplayNamePreset(
                                                                    name
                                                                )
                                                            }
                                                        >
                                                            <span className="truncate">
                                                                {name}
                                                            </span>
                                                        </Button>
                                                    )
                                                )}
                                            </div>
                                        </PopoverContent>
                                    ) : null}
                                </Popover>
                            </Field>
                        </FieldGroup>
                    </TabsContent>
                    <TabsContent value="Legacy">
                        <FieldGroup className="gap-4">
                            <Field>
                                <FieldLabel>
                                    {t('dialog.world.label.access')}
                                </FieldLabel>
                                <Select
                                    value={form.accessType}
                                    onValueChange={(value: any) =>
                                        patchForm({ accessType: value })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {accessTypeOptions.map(
                                                (option: any) => (
                                                    <SelectItem
                                                        key={option.value}
                                                        value={option.value}
                                                    >
                                                        {t(option.labelKey)}
                                                    </SelectItem>
                                                )
                                            )}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field>
                                <FieldLabel>
                                    {t('dialog.new_instance.region')}
                                </FieldLabel>
                                <Select
                                    value={form.region}
                                    onValueChange={(value: any) =>
                                        patchForm({ region: value })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {regionOptions.map(
                                                (region: any) => (
                                                    <SelectItem
                                                        key={region.value}
                                                        value={region.value}
                                                    >
                                                        {t(region.labelKey)}
                                                    </SelectItem>
                                                )
                                            )}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field>
                                <FieldLabel htmlFor="world-launch-instance-name">
                                    {t(
                                        'table.previous_instances.instance_name'
                                    )}
                                </FieldLabel>
                                <Input
                                    id="world-launch-instance-name"
                                    value={form.instanceName}
                                    onChange={(event: any) =>
                                        patchForm({
                                            instanceName:
                                                event.target.value.replace(
                                                    /[^A-Za-z0-9]/g,
                                                    ''
                                                )
                                        })
                                    }
                                />
                            </Field>
                            {form.accessType !== 'public' &&
                            form.accessType !== 'group' ? (
                                <Field>
                                    <FieldLabel htmlFor="world-launch-user-id">
                                        {t('dialog.world.label.user_id')}
                                    </FieldLabel>
                                    <Input
                                        id="world-launch-user-id"
                                        value={form.legacyUserId}
                                        onChange={(event: any) =>
                                            patchForm({
                                                legacyUserId: event.target.value
                                            })
                                        }
                                    />
                                </Field>
                            ) : null}
                            {form.accessType === 'group' ? (
                                <>
                                    <Field>
                                        <FieldLabel htmlFor="world-launch-group-id">
                                            {t('dialog.new_instance.group_id')}
                                        </FieldLabel>
                                        {renderGroupPicker(
                                            'world-launch-group-id'
                                        )}
                                    </Field>
                                    <Field>
                                        <FieldLabel>
                                            {t(
                                                'dialog.new_instance.group_access_type'
                                            )}
                                        </FieldLabel>
                                        <Select
                                            value={form.groupAccessType}
                                            onValueChange={(value: any) =>
                                                patchForm({
                                                    groupAccessType: value
                                                })
                                            }
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    {groupAccessTypeOptions.map(
                                                        (option: any) => (
                                                            <SelectItem
                                                                key={
                                                                    option.value
                                                                }
                                                                value={
                                                                    option.value
                                                                }
                                                            >
                                                                {t(
                                                                    option.labelKey
                                                                )}
                                                            </SelectItem>
                                                        )
                                                    )}
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                </>
                            ) : null}
                            {form.accessType === 'group' ? (
                                <Field orientation="horizontal">
                                    <Checkbox
                                        id="world-launch-age-gate"
                                        checked={form.ageGate}
                                        onCheckedChange={(value: any) =>
                                            patchForm({
                                                ageGate: Boolean(value)
                                            })
                                        }
                                    />
                                    <FieldLabel htmlFor="world-launch-age-gate">
                                        {t('dialog.world.label.age_gate')}
                                    </FieldLabel>
                                </Field>
                            ) : null}
                            {form.accessType === 'invite' ||
                            form.accessType === 'friends' ? (
                                <Field orientation="horizontal">
                                    <Checkbox
                                        id="world-launch-strict"
                                        checked={form.strict}
                                        onCheckedChange={(value: any) =>
                                            patchForm({
                                                strict: Boolean(value)
                                            })
                                        }
                                    />
                                    <FieldLabel htmlFor="world-launch-strict">
                                        {t('dialog.world.label.strict')}
                                    </FieldLabel>
                                </Field>
                            ) : null}
                        </FieldGroup>
                    </TabsContent>
                </Tabs>
                {activeCreated ? (
                    <FieldGroup className="gap-4">
                        <Field>
                            <FieldLabel htmlFor="world-created-location">
                                {t('dialog.world.label.location')}
                            </FieldLabel>
                            <Input
                                id="world-created-location"
                                readOnly
                                value={activeCreated.location || ''}
                                onClick={(event: any) =>
                                    event.currentTarget.select()
                                }
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="world-created-url">
                                {t('dialog.new_instance.url')}
                            </FieldLabel>
                            <Input
                                id="world-created-url"
                                readOnly
                                value={activeCreated.url || ''}
                                onClick={(event: any) =>
                                    event.currentTarget.select()
                                }
                            />
                        </Field>
                    </FieldGroup>
                ) : null}
                {activeCreated ? (
                    <DialogFooter className="gap-2 sm:justify-end">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={submitting}
                            onClick={() => {
                                commitDisplayNamePreset();
                                onCopy?.(activeCreated);
                            }}
                        >
                            {t('dialog.world.info.copy_url')}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={submitting}
                            onClick={() => {
                                commitDisplayNamePreset();
                                onSelfInvite?.(activeCreated);
                            }}
                        >
                            {t('dialog.world.label.self_invite')}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={submitting || inviteDisabled}
                            onClick={() => {
                                commitDisplayNamePreset();
                                onInvite?.(activeCreated);
                            }}
                        >
                            {t('dialog.world.action.invite')}
                        </Button>
                        <Button
                            type="button"
                            variant={isGameRunning ? 'secondary' : 'default'}
                            disabled={submitting}
                            onClick={() => {
                                commitDisplayNamePreset();
                                onLaunch?.(activeCreated);
                            }}
                        >
                            {t('dialog.world.action.launch')}
                        </Button>
                        {isGameRunning ? (
                            <Button
                                type="button"
                                disabled={submitting}
                                onClick={() => {
                                    commitDisplayNamePreset();
                                    onOpenInGame?.(activeCreated);
                                }}
                            >
                                {t('dialog.world.action.open_in_game')}
                            </Button>
                        ) : null}
                    </DialogFooter>
                ) : (
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={submitting}
                            onClick={() => onOpenChange(false)}
                        >
                            {t('common.actions.cancel')}
                        </Button>
                        <Button
                            type="button"
                            disabled={
                                submitting || form.selectedTab === 'Legacy'
                            }
                            onClick={() => {
                                commitDisplayNamePreset();
                                onSubmit(form);
                            }}
                        >
                            {request?.selfInvite
                                ? t('dialog.new_instance.create_and_invite')
                                : t('dialog.new_instance.create_instance')}
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}
