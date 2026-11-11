import { ChevronDownIcon, RotateCcwIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { WorldProfileRecord } from '@/domain/entities/world';
import { languageOptionLabel } from '@/shared/utils/userLanguage';
import { HintTooltip } from '@/ui/hint-tooltip';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { Textarea } from '@/ui/shadcn/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { useSpokenLanguageSelection } from '../useSpokenLanguageSelection';
import { normalizeMinimumAvatarPerformance } from './worldDialogHelpers';
import {
    INSTANCE_DESCRIPTION_MAX,
    INSTANCE_DISPLAY_NAME_MAX,
    INSTANCE_LANGUAGE_LIMIT,
    INSTANCE_VIBE_LIMIT,
    instanceCreateOptionLabel,
    instanceCreateOptionTranslation
} from './worldInstanceCreateOptions';
import {
    normalizeInstanceDialogDisplayName,
    prependInstanceDialogDisplayNamePreset
} from './worldInstanceDisplayNamePresets';
import { buildLegacyCreatedInstance } from './worldInstances';
import { WorldNewInstanceMultiSelectField } from './WorldNewInstanceMultiSelectField';
import { isWorldNewInstanceTab } from './worldNewInstanceTypes';
import type {
    CreatedWorldInstance,
    InstanceGroupOption,
    WorldNewInstanceForm,
    WorldNewInstanceRequest
} from './worldNewInstanceTypes';

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
const minimumAvatarPerformanceOptions = [
    {
        value: 'none',
        labelKey: 'dialog.new_instance.minimum_avatar_performance_none'
    },
    {
        value: 'Poor',
        labelKey: 'dialog.new_instance.minimum_avatar_performance_poor'
    },
    {
        value: 'Medium',
        labelKey: 'dialog.new_instance.minimum_avatar_performance_medium'
    },
    {
        value: 'Good',
        labelKey: 'dialog.new_instance.minimum_avatar_performance_good'
    }
];

const normalTabDefaults = {
    accessType: 'public',
    region: 'US West',
    groupId: '',
    groupAccessType: 'plus',
    minimumAvatarPerformance: '',
    queueEnabled: true,
    ageGate: false,
    displayName: '',
    description: '',
    categoryId: '',
    vibeIds: [],
    languages: [],
    roleIds: ''
} satisfies Partial<WorldNewInstanceForm>;

function normalizeText(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function groupIdForOption(group?: InstanceGroupOption | null) {
    return normalizeText(group?.groupId || group?.id);
}

function groupLabel(group?: InstanceGroupOption | null) {
    const groupId = groupIdForOption(group);
    return normalizeText(group?.name || group?.displayName) || groupId;
}

function newInstanceDialogTitleKey(request: WorldNewInstanceRequest | null) {
    if (request?.afterCreateAction === 'openInGame') {
        return 'dialog.world.actions.new_instance_and_open_ingame';
    }
    if (request?.selfInvite) {
        return 'dialog.world.actions.new_instance_and_self_invite';
    }
    return 'dialog.new_instance.header';
}

interface WorldNewInstanceDialogProps {
    open: boolean;
    request: WorldNewInstanceRequest | null;
    world: WorldProfileRecord;
    currentUserId?: string | null;
    isGameRunning?: boolean;
    groupOptions?: InstanceGroupOption[];
    submitting: boolean;
    onOpenChange: (open: boolean) => void;
    onChange?: (form: WorldNewInstanceForm) => void;
    onCommitDisplayName?: (value: string) => void;
    onSubmit: (form: WorldNewInstanceForm) => void;
    onCopy: (created: CreatedWorldInstance) => void;
    onSelfInvite: (created: CreatedWorldInstance) => void;
    onInvite: (created: CreatedWorldInstance) => void;
    onLaunch: (created: CreatedWorldInstance) => void;
    onOpenInGame: (created: CreatedWorldInstance) => void;
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
}: WorldNewInstanceDialogProps) {
    const { t } = useTranslation();

    const [form, setForm] = useState<WorldNewInstanceForm>({
        selectedTab: 'Normal',
        ...normalTabDefaults,
        displayNamePresets: [],
        instanceName: '',
        legacyUserId: '',
        strict: false
    });
    const [legacySeed, setLegacySeed] = useState('00001');
    const [displayNamePresetsOpen, setDisplayNamePresetsOpen] = useState(false);
    const displayNameAnchorRef = useRef<HTMLDivElement>(null);
    const languageSelection = useSpokenLanguageSelection(form.languages);
    const createOptions = request?.createOptions ?? null;

    useEffect(() => {
        if (open && request?.defaults) {
            setLegacySeed(
                String((99999 * Math.random() + 1).toFixed(0)).padStart(5, '0')
            );
            setForm({
                selectedTab: 'Normal',
                ...normalTabDefaults,
                displayNamePresets: [],
                instanceName: '',
                legacyUserId: currentUserId || '',
                strict: false,
                ...request.defaults
            });
        }
    }, [currentUserId, open, request]);

    function patchForm(patch: Partial<WorldNewInstanceForm>) {
        setForm((current) => {
            const next: WorldNewInstanceForm = { ...current, ...patch };
            onChange?.(next);
            return next;
        });
    }

    const legacyCreated =
        form.selectedTab === 'Legacy' && world?.id
            ? buildLegacyCreatedInstance({
                  worldId: world.id,
                  form,
                  currentUserId: currentUserId || '',
                  legacySeed
              })
            : null;
    const selectedGroup =
        groupOptions.find(
            (group) => groupIdForOption(group) === form.groupId
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
        legacyCreated &&
        (legacyCreated.accessType === 'friends' ||
            legacyCreated.accessType === 'invite') &&
        legacyCreated.ownerId &&
        currentUserId &&
        legacyCreated.ownerId !== currentUserId
    );

    function resetNormalTab() {
        patchForm({
            ...normalTabDefaults,
            groupName: '',
            categoryId: createOptions?.categories[0]?.id ?? ''
        });
    }

    const languageItems = [
        ...languageSelection.languageRows.filter(
            (row) => !languageSelection.languageOptionsMap.has(row.key)
        ),
        ...languageSelection.languageOptionsMap.values()
    ].map((option) => ({
        value: option.key,
        label: languageOptionLabel(option)
    }));
    const vibeItems = (createOptions?.vibes ?? []).map((vibe) => ({
        value: vibe.id,
        label: instanceCreateOptionLabel(vibe, 'vibe', t)
    }));

    function patchGroupId(groupId: string | null) {
        const normalizedGroupId = groupId || '';
        const group = groupOptions.find(
            (option) => groupIdForOption(option) === normalizedGroupId
        );
        patchForm({
            groupId: normalizedGroupId,
            groupName: groupLabel(group) || normalizedGroupId,
            roleIds: ''
        });
    }

    const displayNamePresets = Array.isArray(form.displayNamePresets)
        ? form.displayNamePresets
        : [];

    function patchDisplayName(value: string) {
        patchForm({
            displayName: String(value ?? '')
        });
    }

    function commitDisplayNamePreset(
        value: string = form.displayName
    ): string | null {
        const displayName = normalizeInstanceDialogDisplayName(value);
        if (!displayName) {
            return null;
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
        return displayName;
    }

    function selectDisplayNamePreset(value: string) {
        commitDisplayNamePreset(value);
        setDisplayNamePresetsOpen(false);
    }

    function renderGroupPicker(inputId: string) {
        if (!visibleGroupOptions.length) {
            return (
                <Input
                    id={inputId}
                    value={form.groupId}
                    onChange={(event) =>
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
                items={visibleGroupOptions.map((group: InstanceGroupOption) => {
                    const groupId = groupIdForOption(group);
                    return {
                        value: groupId,
                        label: groupLabel(group)
                    };
                })}
                onValueChange={patchGroupId}
            >
                <SelectTrigger id={inputId}>
                    <SelectValue
                        placeholder={t('dialog.new_instance.group_placeholder')}
                    />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {visibleGroupOptions.map((group) => {
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
            <DialogContent
                className={
                    form.selectedTab === 'Normal'
                        ? 'sm:max-w-[min(92vw,52rem)]'
                        : 'sm:max-w-[min(92vw,32rem)]'
                }
            >
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
                    onValueChange={(value) => {
                        if (isWorldNewInstanceTab(value)) {
                            patchForm({ selectedTab: value });
                        }
                    }}
                >
                    <TabsList>
                        <TabsTrigger value="Normal">
                            {t('dialog.new_instance.normal')}
                        </TabsTrigger>
                        <TabsTrigger value="Legacy">
                            {t('dialog.new_instance.legacy')}
                        </TabsTrigger>
                    </TabsList>
                    <TabsContent value="Normal">
                        <div className="flex flex-col gap-4">
                            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                                <Field>
                                    <FieldLabel>
                                        {t('dialog.world.label.access')}
                                    </FieldLabel>
                                    <Select
                                        value={form.accessType}
                                        items={accessTypeOptions.map(
                                            (option) => ({
                                                value: option.value,
                                                label: t(option.labelKey)
                                            })
                                        )}
                                        onValueChange={(value) =>
                                            patchForm({
                                                accessType: value || 'public'
                                            })
                                        }
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectGroup>
                                                {accessTypeOptions.map(
                                                    (option) => (
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
                                    <FieldLabel htmlFor="world-instance-display-name">
                                        {t('dialog.new_instance.display_name')}
                                    </FieldLabel>
                                    <Popover
                                        open={displayNamePresetsOpen}
                                        onOpenChange={setDisplayNamePresetsOpen}
                                    >
                                        <InputGroup ref={displayNameAnchorRef}>
                                            <InputGroupInput
                                                id="world-instance-display-name"
                                                value={form.displayName}
                                                maxLength={
                                                    INSTANCE_DISPLAY_NAME_MAX
                                                }
                                                onChange={(event) =>
                                                    patchDisplayName(
                                                        event.target.value
                                                    )
                                                }
                                            />
                                            {displayNamePresets.length ? (
                                                <InputGroupAddon align="inline-end">
                                                    <HintTooltip
                                                        label={t(
                                                            'dialog.new_instance.display_name'
                                                        )}
                                                    >
                                                        <PopoverTrigger
                                                            render={
                                                                <InputGroupButton size="icon-xs">
                                                                    <ChevronDownIcon data-icon="inline-start" />
                                                                </InputGroupButton>
                                                            }
                                                        />
                                                    </HintTooltip>
                                                </InputGroupAddon>
                                            ) : null}
                                        </InputGroup>
                                        {displayNamePresets.length ? (
                                            <PopoverContent
                                                align="start"
                                                anchor={displayNameAnchorRef}
                                                className="w-80 p-1"
                                            >
                                                <div className="flex max-h-64 flex-col gap-1 overflow-y-auto p-1">
                                                    {displayNamePresets.map(
                                                        (name) => (
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
                            </div>
                            <Field>
                                <div className="flex items-center justify-between gap-2">
                                    <FieldLabel htmlFor="world-instance-description">
                                        {t('dialog.new_instance.description')}
                                    </FieldLabel>
                                    <span className="text-muted-foreground text-xs tabular-nums">
                                        {form.description.length}/
                                        {INSTANCE_DESCRIPTION_MAX}
                                    </span>
                                </div>
                                <Textarea
                                    id="world-instance-description"
                                    rows={3}
                                    value={form.description}
                                    maxLength={INSTANCE_DESCRIPTION_MAX}
                                    className="resize-none"
                                    onChange={(event) =>
                                        patchForm({
                                            description: event.target.value
                                        })
                                    }
                                />
                            </Field>
                            {createOptions?.categories.length ? (
                                <Field>
                                    <FieldLabel>
                                        {t('dialog.new_instance.category')}
                                    </FieldLabel>
                                    <ToggleGroup
                                        variant="outline"
                                        size="sm"
                                        value={[form.categoryId]}
                                        className="flex w-full flex-wrap gap-1.5"
                                    >
                                        {createOptions.categories.map(
                                            (category) => {
                                                const translated =
                                                    instanceCreateOptionTranslation(
                                                        category,
                                                        'category',
                                                        t
                                                    );
                                                const item = (
                                                    <ToggleGroupItem
                                                        key={category.id}
                                                        value={category.id}
                                                        disabled={submitting}
                                                        className="rounded-full! border! px-3 text-xs"
                                                        onClick={() =>
                                                            patchForm({
                                                                categoryId:
                                                                    category.id
                                                            })
                                                        }
                                                    >
                                                        <span className="truncate">
                                                            {category.name}
                                                        </span>
                                                    </ToggleGroupItem>
                                                );
                                                return translated ? (
                                                    <Tooltip key={category.id}>
                                                        <TooltipTrigger
                                                            render={item}
                                                        />
                                                        <TooltipContent>
                                                            {translated}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                ) : (
                                                    item
                                                );
                                            }
                                        )}
                                    </ToggleGroup>
                                </Field>
                            ) : null}
                            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                                <WorldNewInstanceMultiSelectField
                                    id="world-instance-languages"
                                    label={t('dialog.user.label.languages')}
                                    placeholder={t(
                                        'dialog.user.action.select_language'
                                    )}
                                    description={
                                        languageSelection.languageOptionsStatus ===
                                        'error'
                                            ? t(
                                                  'dialog.user.label.vrchat_language_list_unavailable_using_local_language_codes'
                                              )
                                            : undefined
                                    }
                                    options={languageItems}
                                    value={form.languages}
                                    limit={INSTANCE_LANGUAGE_LIMIT}
                                    disabled={submitting}
                                    onChange={(languages) =>
                                        patchForm({ languages })
                                    }
                                />
                                {createOptions ? (
                                    <>
                                        <WorldNewInstanceMultiSelectField
                                            id="world-instance-vibes"
                                            label={t(
                                                'dialog.new_instance.vibes'
                                            )}
                                            placeholder={t(
                                                'dialog.new_instance.vibes_placeholder'
                                            )}
                                            description={t(
                                                'dialog.new_instance.vibes_hint'
                                            )}
                                            options={vibeItems}
                                            value={form.vibeIds}
                                            limit={INSTANCE_VIBE_LIMIT}
                                            disabled={submitting}
                                            onChange={(vibeIds) =>
                                                patchForm({ vibeIds })
                                            }
                                        />
                                    </>
                                ) : null}
                            </div>
                            <div className="grid gap-x-6 gap-y-4 border-t pt-4 sm:grid-cols-2">
                                <Field>
                                    <FieldLabel>
                                        {t('dialog.new_instance.region')}
                                    </FieldLabel>
                                    <Select
                                        value={form.region}
                                        items={regionOptions.map((region) => ({
                                            value: region.value,
                                            label: t(region.labelKey)
                                        }))}
                                        onValueChange={(value) =>
                                            patchForm({
                                                region: value || 'US West'
                                            })
                                        }
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectGroup>
                                                {regionOptions.map((region) => (
                                                    <SelectItem
                                                        key={region.value}
                                                        value={region.value}
                                                    >
                                                        {t(region.labelKey)}
                                                    </SelectItem>
                                                ))}
                                            </SelectGroup>
                                        </SelectContent>
                                    </Select>
                                </Field>
                                {form.accessType === 'group' ? (
                                    <>
                                        <Field>
                                            <FieldLabel htmlFor="world-instance-group-id">
                                                {t(
                                                    'dialog.new_instance.group_id'
                                                )}
                                            </FieldLabel>
                                            {renderGroupPicker(
                                                'world-instance-group-id'
                                            )}
                                        </Field>
                                        <Field>
                                            <FieldLabel htmlFor="world-instance-minimum-avatar-performance">
                                                {t(
                                                    'dialog.new_instance.minimum_avatar_performance'
                                                )}
                                            </FieldLabel>
                                            <Select
                                                value={
                                                    form.minimumAvatarPerformance ||
                                                    'none'
                                                }
                                                items={minimumAvatarPerformanceOptions.map(
                                                    (option) => ({
                                                        value: option.value,
                                                        label: t(
                                                            option.labelKey
                                                        )
                                                    })
                                                )}
                                                onValueChange={(value) =>
                                                    patchForm({
                                                        minimumAvatarPerformance:
                                                            normalizeMinimumAvatarPerformance(
                                                                value === 'none'
                                                                    ? ''
                                                                    : value
                                                            )
                                                    })
                                                }
                                            >
                                                <SelectTrigger id="world-instance-minimum-avatar-performance">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectGroup>
                                                        {minimumAvatarPerformanceOptions.map(
                                                            (option) => (
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
                                        <Field>
                                            <FieldLabel>
                                                {t(
                                                    'dialog.new_instance.group_access_type'
                                                )}
                                            </FieldLabel>
                                            <Select
                                                value={form.groupAccessType}
                                                items={groupAccessTypeOptions.map(
                                                    (option) => ({
                                                        value: option.value,
                                                        label: t(
                                                            option.labelKey
                                                        )
                                                    })
                                                )}
                                                onValueChange={(value) =>
                                                    patchForm({
                                                        groupAccessType:
                                                            value || 'plus'
                                                    })
                                                }
                                            >
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectGroup>
                                                        {groupAccessTypeOptions.map(
                                                            (option) => (
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
                                                    onChange={(event) =>
                                                        patchForm({
                                                            roleIds:
                                                                event.target
                                                                    .value
                                                        })
                                                    }
                                                />
                                            </Field>
                                        ) : null}
                                        <FieldGroup data-slot="checkbox-group">
                                            <Field orientation="horizontal">
                                                <Checkbox
                                                    id="world-instance-queue-enabled"
                                                    checked={form.queueEnabled}
                                                    onCheckedChange={(value) =>
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
                                            <Field orientation="horizontal">
                                                <Checkbox
                                                    id="world-instance-age-gate"
                                                    checked={form.ageGate}
                                                    onCheckedChange={(value) =>
                                                        patchForm({
                                                            ageGate:
                                                                Boolean(value)
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
                            </div>
                        </div>
                    </TabsContent>
                    <TabsContent value="Legacy">
                        <FieldGroup className="gap-4">
                            <Field>
                                <FieldLabel>
                                    {t('dialog.world.label.access')}
                                </FieldLabel>
                                <Select
                                    value={form.accessType}
                                    items={accessTypeOptions.map((option) => ({
                                        value: option.value,
                                        label: t(option.labelKey)
                                    }))}
                                    onValueChange={(value) =>
                                        patchForm({
                                            accessType: value || 'public'
                                        })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {accessTypeOptions.map((option) => (
                                                <SelectItem
                                                    key={option.value}
                                                    value={option.value}
                                                >
                                                    {t(option.labelKey)}
                                                </SelectItem>
                                            ))}
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
                                    items={regionOptions.map((region) => ({
                                        value: region.value,
                                        label: t(region.labelKey)
                                    }))}
                                    onValueChange={(value) =>
                                        patchForm({
                                            region: value || 'US West'
                                        })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {regionOptions.map((region) => (
                                                <SelectItem
                                                    key={region.value}
                                                    value={region.value}
                                                >
                                                    {t(region.labelKey)}
                                                </SelectItem>
                                            ))}
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
                                    onChange={(event) =>
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
                                        onChange={(event) =>
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
                                            items={groupAccessTypeOptions.map(
                                                (option) => ({
                                                    value: option.value,
                                                    label: t(option.labelKey)
                                                })
                                            )}
                                            onValueChange={(value) =>
                                                patchForm({
                                                    groupAccessType:
                                                        value || 'plus'
                                                })
                                            }
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    {groupAccessTypeOptions.map(
                                                        (option) => (
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
                                        onCheckedChange={(value) =>
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
                                        onCheckedChange={(value) =>
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
                {legacyCreated ? (
                    <FieldGroup className="gap-4">
                        <Field>
                            <FieldLabel htmlFor="world-created-location">
                                {t('dialog.world.label.location')}
                            </FieldLabel>
                            <Input
                                id="world-created-location"
                                readOnly
                                value={legacyCreated.location || ''}
                                onClick={(event) =>
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
                                value={legacyCreated.url || ''}
                                onClick={(event) =>
                                    event.currentTarget.select()
                                }
                            />
                        </Field>
                    </FieldGroup>
                ) : null}
                {legacyCreated ? (
                    <DialogFooter className="gap-2 sm:justify-end">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={submitting}
                            onClick={() => onCopy(legacyCreated)}
                        >
                            {t('dialog.world.info.copy_url')}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={submitting}
                            onClick={() => onSelfInvite(legacyCreated)}
                        >
                            {t('dialog.world.label.self_invite')}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={submitting || inviteDisabled}
                            onClick={() => onInvite(legacyCreated)}
                        >
                            {t('dialog.world.action.invite')}
                        </Button>
                        <Button
                            type="button"
                            variant={isGameRunning ? 'secondary' : 'default'}
                            disabled={submitting}
                            onClick={() => onLaunch(legacyCreated)}
                        >
                            {t('dialog.world.action.launch')}
                        </Button>
                        {isGameRunning ? (
                            <Button
                                type="button"
                                disabled={submitting}
                                onClick={() => onOpenInGame(legacyCreated)}
                            >
                                {t('dialog.world.action.open_in_game')}
                            </Button>
                        ) : null}
                    </DialogFooter>
                ) : (
                    <DialogFooter>
                        {form.selectedTab === 'Normal' ? (
                            <Button
                                type="button"
                                variant="ghost"
                                className="sm:mr-auto"
                                disabled={submitting}
                                onClick={resetNormalTab}
                            >
                                <RotateCcwIcon data-icon="inline-start" />
                                {t('dialog.new_instance.reset_defaults')}
                            </Button>
                        ) : null}
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
                                const displayName = commitDisplayNamePreset();
                                onSubmit(
                                    displayName
                                        ? { ...form, displayName }
                                        : form
                                );
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
