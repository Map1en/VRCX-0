import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useLocalWorldFavorites } from '@/components/favorites/useLocalWorldFavorites';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle
} from '@/ui/shadcn/empty';
import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel,
    FieldLegend,
    FieldSet
} from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import {
    NumberField,
    NumberFieldDecrement,
    NumberFieldGroup,
    NumberFieldIncrement,
    NumberFieldInput
} from '@/ui/shadcn/number-field';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

import { instanceTypes } from '../toolsDialogUtils';
import {
    AutomationSplitLayout,
    CompactCheckList,
    RuleEditorPanel,
    RuleList,
    RuleListItem,
    RuleSummaryBadge
} from './AutomationRuleLayout';
import { FriendMultiSelect } from './FriendMultiSelect';
import {
    contextPresetLabelKeyFromValue,
    contextPresetOptions,
    createGroupOptions,
    createInstanceOptions,
    createContextRule,
    hasRuleAction,
    normalizeContextRule,
    type ContextAutomationRule,
    priorityLabelKeyFromNumber,
    priorityNumberFromValue,
    priorityOptions,
    priorityValueFromNumber,
    removeRuleAction,
    ruleActionSummary,
    ruleTitle,
    updateRule,
    updateRuleAction
} from './presenceAutomationDialogUtils';
import { PresenceRuleActionFields } from './PresenceRuleActionFields';
import { useFavoriteFriendGroupOptions } from './useFavoriteFriendGroupOptions';
import { useRuleSelection } from './useRuleSelection';

const I18N_ROOT = 'view.tools.social_automation';
const TITLE_FALLBACK_KEY = `${I18N_ROOT}.room_rule_default`;

type ContextRulesTabProps = {
    contextRules: ContextAutomationRule[];
    loading: boolean;
    onRulesChange: (rules: ContextAutomationRule[]) => void;
};

export function ContextRulesTab({
    loading,
    contextRules,
    onRulesChange
}: ContextRulesTabProps) {
    const { t } = useTranslation();
    const favoriteWorldGroups = useFavoriteStore(
        (state) => state.favoriteWorldGroups
    );
    const localWorldFavorites = useLocalWorldFavorites();
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const orderedFriendIds = useFriendRosterStore(
        (state) => state.orderedFriendIds
    );
    const groupOptions = useFavoriteFriendGroupOptions();
    const worldGroupOptions = useMemo(
        () =>
            createGroupOptions({
                remoteGroups: favoriteWorldGroups,
                localGroups: localWorldFavorites.groupNames
            }),
        [favoriteWorldGroups, localWorldFavorites.groupNames]
    );
    const instanceOptions = useMemo(
        () => createInstanceOptions(instanceTypes, t),
        [t]
    );
    const rules = Array.isArray(contextRules) ? contextRules : [];
    const {
        selectedRule,
        selectedRuleId,
        setSelectedRuleId,
        removeRule: removeRuleFromSelection
    } = useRuleSelection(rules);

    function update(
        ruleId: string,
        updater: (rule: ContextAutomationRule) => ContextAutomationRule
    ) {
        onRulesChange(
            updateRule(rules, ruleId, (rule) =>
                normalizeContextRule(updater(rule))
            )
        );
    }

    function addRule() {
        const nextRule = createContextRule(t(TITLE_FALLBACK_KEY));
        setSelectedRuleId(nextRule.id);
        onRulesChange([...rules, nextRule]);
    }

    function removeRule(ruleId: string) {
        onRulesChange(removeRuleFromSelection(ruleId));
    }

    const customRulesList = (
        <RuleList
            title={t(`${I18N_ROOT}.room_social_rules`)}
            description={t(`${I18N_ROOT}.room_social_rules_description`)}
            addLabel={t(`${I18N_ROOT}.add_rule`)}
            disabled={loading}
            isEmpty={!rules.length}
            emptyTitle={t('empty_state.context_rules_title')}
            emptyDescription={t('empty_state.context_rules_description')}
            onAdd={addRule}
        >
            {rules.map((rule) => (
                <RuleListItem
                    key={rule.id}
                    selected={rule.id === selectedRuleId}
                    title={ruleTitle(rule, t, TITLE_FALLBACK_KEY)}
                    description={t(contextPresetLabelKeyFromValue(rule.preset))}
                    enabled={rule.enabled !== false}
                    disabled={loading}
                    removeLabel={t(`${I18N_ROOT}.remove_room_rule`)}
                    badges={
                        <>
                            <RuleSummaryBadge>
                                {t(priorityLabelKeyFromNumber(rule.priority))}
                            </RuleSummaryBadge>
                            <RuleSummaryBadge>
                                {ruleActionSummary(rule, t)}
                            </RuleSummaryBadge>
                        </>
                    }
                    onSelect={() => setSelectedRuleId(rule.id)}
                    onEnabledChange={(checked) =>
                        update(rule.id, (current) => ({
                            ...current,
                            enabled: checked
                        }))
                    }
                    onRemove={() => removeRule(rule.id)}
                />
            ))}
        </RuleList>
    );

    const customRulesEditor = (
        <RuleEditorPanel
            title={
                selectedRule
                    ? ruleTitle(selectedRule, t, TITLE_FALLBACK_KEY)
                    : t(`${I18N_ROOT}.room_rule_default`)
            }
            description={
                selectedRule
                    ? t(contextPresetLabelKeyFromValue(selectedRule.preset))
                    : t('empty_state.context_rules_title')
            }
        >
            {selectedRule ? (
                <FieldGroup>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem]">
                        <Field>
                            <FieldLabel>
                                {t(`${I18N_ROOT}.rule_name`)}
                            </FieldLabel>
                            <Input
                                value={selectedRule.label || ''}
                                disabled={loading}
                                onChange={(event) =>
                                    update(selectedRule.id, (current) => ({
                                        ...current,
                                        label: event.target.value
                                    }))
                                }
                            />
                        </Field>
                        <Field>
                            <FieldLabel>
                                {t(`${I18N_ROOT}.priority`)}
                            </FieldLabel>
                            <Select
                                value={priorityValueFromNumber(
                                    selectedRule.priority
                                )}
                                disabled={loading}
                                items={priorityOptions.map((option) => ({
                                    value: option.value,
                                    label: t(option.labelKey)
                                }))}
                                onValueChange={(value) =>
                                    update(selectedRule.id, (current) => ({
                                        ...current,
                                        priority: priorityNumberFromValue(value)
                                    }))
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {priorityOptions.map((option) => (
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
                    </div>
                    <FieldSet className="border-t pt-4">
                        <FieldLegend variant="label">
                            {t(`${I18N_ROOT}.when`)}
                        </FieldLegend>
                        <FieldGroup>
                            <Field>
                                <Select
                                    value={selectedRule.preset || 'alone'}
                                    disabled={loading}
                                    items={contextPresetOptions.map(
                                        (preset) => ({
                                            value: preset.value,
                                            label: t(preset.labelKey)
                                        })
                                    )}
                                    onValueChange={(value) =>
                                        update(selectedRule.id, (current) => ({
                                            ...current,
                                            preset: value ?? ''
                                        }))
                                    }
                                >
                                    <SelectTrigger
                                        aria-label={t(`${I18N_ROOT}.when`)}
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {contextPresetOptions.map(
                                                (preset) => (
                                                    <SelectItem
                                                        key={preset.value}
                                                        value={preset.value}
                                                    >
                                                        {t(preset.labelKey)}
                                                    </SelectItem>
                                                )
                                            )}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </Field>
                            {selectedRule.preset === 'withSelectedGroups' ? (
                                <Field>
                                    <FieldLabel>
                                        {t(`${I18N_ROOT}.friend_groups`)}
                                    </FieldLabel>
                                    <CompactCheckList
                                        values={
                                            selectedRule.selectedGroups || []
                                        }
                                        options={groupOptions}
                                        disabled={loading}
                                        onChange={(next) =>
                                            update(
                                                selectedRule.id,
                                                (current) => ({
                                                    ...current,
                                                    selectedGroups: next
                                                })
                                            )
                                        }
                                    />
                                </Field>
                            ) : null}
                            {selectedRule.preset === 'inFavoriteWorlds' ? (
                                <Field>
                                    <FieldLabel>
                                        {t(`${I18N_ROOT}.world_groups`)}
                                    </FieldLabel>
                                    <FieldDescription>
                                        {t(`${I18N_ROOT}.world_groups_hint`)}
                                    </FieldDescription>
                                    <CompactCheckList
                                        values={
                                            selectedRule.selectedWorldGroups ||
                                            []
                                        }
                                        options={worldGroupOptions}
                                        disabled={loading}
                                        onChange={(next) =>
                                            update(
                                                selectedRule.id,
                                                (current) => ({
                                                    ...current,
                                                    selectedWorldGroups: next
                                                })
                                            )
                                        }
                                    />
                                </Field>
                            ) : null}
                            {selectedRule.preset === 'friendCountAtLeast' ? (
                                <Field>
                                    <FieldLabel>
                                        {t(`${I18N_ROOT}.minimum_friends`)}
                                    </FieldLabel>
                                    <NumberField
                                        min={1}
                                        value={
                                            selectedRule.friendCountValue || 1
                                        }
                                        disabled={loading}
                                        onValueChange={(value) =>
                                            update(
                                                selectedRule.id,
                                                (current) => ({
                                                    ...current,
                                                    friendCountValue:
                                                        Number.parseInt(
                                                            String(value),
                                                            10
                                                        ) || 1
                                                })
                                            )
                                        }
                                    >
                                        <NumberFieldGroup>
                                            <NumberFieldDecrement />
                                            <NumberFieldInput />
                                            <NumberFieldIncrement />
                                        </NumberFieldGroup>
                                    </NumberField>
                                </Field>
                            ) : null}
                            {selectedRule.preset === 'playerCountAtLeast' ? (
                                <Field>
                                    <FieldLabel>
                                        {t(`${I18N_ROOT}.minimum_players`)}
                                    </FieldLabel>
                                    <NumberField
                                        min={1}
                                        value={
                                            selectedRule.playerCountValue || 1
                                        }
                                        disabled={loading}
                                        onValueChange={(value) =>
                                            update(
                                                selectedRule.id,
                                                (current) => ({
                                                    ...current,
                                                    playerCountValue:
                                                        Number.parseInt(
                                                            String(value),
                                                            10
                                                        ) || 1
                                                })
                                            )
                                        }
                                    >
                                        <NumberFieldGroup>
                                            <NumberFieldDecrement />
                                            <NumberFieldInput />
                                            <NumberFieldIncrement />
                                        </NumberFieldGroup>
                                    </NumberField>
                                </Field>
                            ) : null}
                            {selectedRule.preset === 'withSelectedFriend' ? (
                                <Field>
                                    <FieldLabel>
                                        {t('common.affinity.friend')}
                                    </FieldLabel>
                                    <FriendMultiSelect
                                        idPrefix={selectedRule.id}
                                        values={
                                            selectedRule.specificFriendIds || []
                                        }
                                        friendsById={friendsById}
                                        orderedFriendIds={orderedFriendIds}
                                        disabled={loading}
                                        onChange={(specificFriendIds) =>
                                            update(
                                                selectedRule.id,
                                                (current) => ({
                                                    ...current,
                                                    specificFriendIds
                                                })
                                            )
                                        }
                                    />
                                </Field>
                            ) : null}
                            <Field>
                                <FieldLabel>
                                    {t(`${I18N_ROOT}.room_types`)}
                                </FieldLabel>
                                <FieldDescription>
                                    {t(`${I18N_ROOT}.room_types_hint`)}
                                </FieldDescription>
                                <CompactCheckList
                                    values={
                                        selectedRule.selectedInstanceTypes || []
                                    }
                                    options={instanceOptions}
                                    disabled={loading}
                                    onChange={(next) =>
                                        update(selectedRule.id, (current) => ({
                                            ...current,
                                            selectedInstanceTypes: next
                                        }))
                                    }
                                />
                            </Field>
                        </FieldGroup>
                    </FieldSet>
                    <PresenceRuleActionFields
                        idPrefix={selectedRule.id}
                        disabled={loading}
                        status={selectedRule.actions?.status || 'no-change'}
                        statusDescriptionEnabled={hasRuleAction(
                            selectedRule,
                            'statusDescription'
                        )}
                        statusDescription={
                            selectedRule.actions?.statusDescription || ''
                        }
                        onStatusChange={(value) =>
                            update(selectedRule.id, (current) =>
                                value === 'no-change'
                                    ? removeRuleAction(current, 'status')
                                    : updateRuleAction(current, {
                                          status: value
                                      })
                            )
                        }
                        onStatusDescriptionEnabledChange={(checked) =>
                            update(selectedRule.id, (current) =>
                                checked
                                    ? updateRuleAction(current, {
                                          statusDescription: ''
                                      })
                                    : removeRuleAction(
                                          current,
                                          'statusDescription'
                                      )
                            )
                        }
                        onStatusDescriptionChange={(value) =>
                            update(selectedRule.id, (current) =>
                                updateRuleAction(current, {
                                    statusDescription: value
                                })
                            )
                        }
                    />
                </FieldGroup>
            ) : (
                <Empty className="min-h-[18rem] border">
                    <EmptyHeader>
                        <EmptyTitle>
                            {t('empty_state.context_rules_title')}
                        </EmptyTitle>
                        <EmptyDescription>
                            {t('empty_state.context_rules_description')}
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            )}
        </RuleEditorPanel>
    );

    return (
        <AutomationSplitLayout
            list={customRulesList}
            editor={customRulesEditor}
        />
    );
}
