import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { userStatusLabel } from '@/shared/utils/userStatus';
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
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';

import {
    AutomationSplitLayout,
    RuleEditorPanel,
    RuleList,
    RuleListItem,
    RuleSummaryBadge
} from './AutomationRuleLayout';
import {
    createTimeRule,
    dayOptions,
    getTimeWindow,
    hasGameRunningCondition,
    priorityLabelKeyFromNumber,
    priorityNumberFromValue,
    priorityOptions,
    priorityValueFromNumber,
    setGameRunningCondition,
    shouldRestorePreviousState,
    updateRule
} from './presenceAutomationDialogUtils';
import { PresenceRuleActionFields } from './PresenceRuleActionFields';

const I18N_ROOT = 'view.tools.social_automation';

function hasAction(rule: any, key: any) {
    return Object.prototype.hasOwnProperty.call(rule.actions || {}, key);
}

function updateTimeWindow(rule: any, patch: any) {
    const timeWindow = getTimeWindow(rule);
    const otherConditions = (rule.conditions || []).filter(
        (condition: any) => condition.type !== 'timeWindow'
    );
    return {
        ...rule,
        conditions: [{ ...timeWindow, ...patch }, ...otherConditions]
    };
}

function updateAction(rule: any, patch: any) {
    return {
        ...rule,
        actions: {
            ...(rule.actions || {}),
            ...patch
        }
    };
}

function removeAction(rule: any, key: any) {
    const actions: any = { ...(rule.actions || {}) };
    delete actions[key];
    return {
        ...rule,
        actions
    };
}

function ruleTitle(rule: any, t: any) {
    return rule?.label || t(`${I18N_ROOT}.schedule_rule_default`);
}

function daysSummary(days: any, t: any) {
    if (!Array.isArray(days) || days.length === 0) {
        return t(`${I18N_ROOT}.every_day`);
    }
    const selectedDays = new Set(days);
    return dayOptions
        .filter((day: any) => selectedDays.has(day.value))
        .map((day: any) => t(day.labelKey))
        .join(', ');
}

function actionSummary(rule: any, t: any) {
    const parts = [];
    if (rule.actions?.status) {
        parts.push(userStatusLabel(rule.actions.status, t));
    }
    if (hasAction(rule, 'statusDescription')) {
        parts.push(t(`${I18N_ROOT}.signature`));
    }
    return parts.length ? parts.join(' / ') : t(`${I18N_ROOT}.do_not_change`);
}

export function TimeRulesTab({ rules, disabled, onRulesChange }: any) {
    const { t } = useTranslation();
    const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);

    useEffect(() => {
        if (!rules.length) {
            setSelectedRuleId(null);
            return;
        }
        if (!rules.some((rule: any) => rule.id === selectedRuleId)) {
            setSelectedRuleId(rules[0].id);
        }
    }, [rules, selectedRuleId]);

    const selectedRule = useMemo(
        () => rules.find((rule: any) => rule.id === selectedRuleId) || null,
        [rules, selectedRuleId]
    );
    const selectedTimeWindow = selectedRule
        ? getTimeWindow(selectedRule)
        : null;

    function update(ruleId: any, updater: any) {
        onRulesChange(updateRule(rules, ruleId, updater));
    }

    function addRule() {
        const nextRule = createTimeRule(
            t(`${I18N_ROOT}.scheduled_presence_default`)
        );
        setSelectedRuleId(nextRule.id);
        onRulesChange([...rules, nextRule]);
    }

    function removeRule(ruleId: any) {
        const ruleIndex = rules.findIndex((rule: any) => rule.id === ruleId);
        const nextRules = rules.filter((rule: any) => rule.id !== ruleId);
        if (selectedRuleId === ruleId) {
            setSelectedRuleId(
                nextRules[Math.min(ruleIndex, nextRules.length - 1)]?.id ?? null
            );
        }
        onRulesChange(nextRules);
    }

    const list = (
        <RuleList
            title={t(`${I18N_ROOT}.schedule_rules`)}
            description={t(`${I18N_ROOT}.schedule_rules_description`)}
            addLabel={t(`${I18N_ROOT}.add_rule`)}
            disabled={disabled}
            isEmpty={!rules.length}
            emptyTitle={t(`${I18N_ROOT}.no_schedule_rules`)}
            emptyDescription={t(`${I18N_ROOT}.schedule_rules_description`)}
            onAdd={addRule}
        >
            {rules.map((rule: any) => {
                const timeWindow = getTimeWindow(rule);
                return (
                    <RuleListItem
                        key={rule.id}
                        selected={rule.id === selectedRuleId}
                        title={ruleTitle(rule, t)}
                        description={`${timeWindow.start} - ${timeWindow.end} / ${daysSummary(
                            timeWindow.days,
                            t
                        )}`}
                        enabled={rule.enabled !== false}
                        disabled={disabled}
                        removeLabel={t(`${I18N_ROOT}.remove_schedule_rule`)}
                        badges={
                            <>
                                <RuleSummaryBadge>
                                    {t(
                                        priorityLabelKeyFromNumber(
                                            rule.priority,
                                            'high'
                                        )
                                    )}
                                </RuleSummaryBadge>
                                <RuleSummaryBadge>
                                    {actionSummary(rule, t)}
                                </RuleSummaryBadge>
                                {hasGameRunningCondition(rule) ? (
                                    <RuleSummaryBadge>
                                        {t(
                                            `${I18N_ROOT}.only_when_game_running`
                                        )}
                                    </RuleSummaryBadge>
                                ) : null}
                            </>
                        }
                        onSelect={() => setSelectedRuleId(rule.id)}
                        onEnabledChange={(checked: any) =>
                            update(rule.id, (current: any) => ({
                                ...current,
                                enabled: checked
                            }))
                        }
                        onRemove={() => removeRule(rule.id)}
                    />
                );
            })}
        </RuleList>
    );

    const editor = (
        <RuleEditorPanel
            title={
                selectedRule
                    ? ruleTitle(selectedRule, t)
                    : t(`${I18N_ROOT}.schedule_rule_default`)
            }
            description={
                selectedTimeWindow
                    ? `${selectedTimeWindow.start} - ${selectedTimeWindow.end}`
                    : t(`${I18N_ROOT}.no_schedule_rules`)
            }
        >
            {selectedRule && selectedTimeWindow ? (
                <FieldGroup>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem]">
                        <Field>
                            <FieldLabel>
                                {t(`${I18N_ROOT}.rule_name`)}
                            </FieldLabel>
                            <Input
                                value={selectedRule.label || ''}
                                disabled={disabled}
                                onChange={(event: any) =>
                                    update(selectedRule.id, (current: any) => ({
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
                                    selectedRule.priority,
                                    'high'
                                )}
                                disabled={disabled}
                                onValueChange={(value: any) =>
                                    update(selectedRule.id, (current: any) => ({
                                        ...current,
                                        priority: priorityNumberFromValue(
                                            value,
                                            700
                                        )
                                    }))
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {priorityOptions.map((option: any) => (
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
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field>
                            <FieldLabel>{t(`${I18N_ROOT}.start`)}</FieldLabel>
                            <Input
                                type="time"
                                value={selectedTimeWindow.start}
                                disabled={disabled}
                                onChange={(event: any) =>
                                    update(selectedRule.id, (current: any) =>
                                        updateTimeWindow(current, {
                                            start: event.target.value
                                        })
                                    )
                                }
                            />
                        </Field>
                        <Field>
                            <FieldLabel>{t(`${I18N_ROOT}.end`)}</FieldLabel>
                            <Input
                                type="time"
                                value={selectedTimeWindow.end}
                                disabled={disabled}
                                onChange={(event: any) =>
                                    update(selectedRule.id, (current: any) =>
                                        updateTimeWindow(current, {
                                            end: event.target.value
                                        })
                                    )
                                }
                            />
                        </Field>
                    </div>
                    <Field>
                        <FieldLabel>{t(`${I18N_ROOT}.days`)}</FieldLabel>
                        <FieldDescription>
                            {t(`${I18N_ROOT}.run_every_day_hint`)}
                        </FieldDescription>
                        <ToggleGroup
                            type="multiple"
                            variant="outline"
                            size="sm"
                            spacing={1}
                            disabled={disabled}
                            value={(selectedTimeWindow.days || []).map(String)}
                            className="flex flex-wrap"
                            onValueChange={(values: any) =>
                                update(selectedRule.id, (current: any) =>
                                    updateTimeWindow(current, {
                                        days: values.map((value: any) =>
                                            Number.parseInt(value, 10)
                                        )
                                    })
                                )
                            }
                        >
                            {dayOptions.map((day: any) => (
                                <ToggleGroupItem
                                    key={day.value}
                                    value={String(day.value)}
                                    disabled={disabled}
                                >
                                    {t(day.labelKey)}
                                </ToggleGroupItem>
                            ))}
                        </ToggleGroup>
                    </Field>
                    <FieldSet
                        className="rounded-md border p-3"
                        disabled={disabled}
                        data-disabled={disabled}
                    >
                        <div className="flex min-w-0 items-start justify-between gap-3">
                            <div className="min-w-0">
                                <FieldLegend variant="label">
                                    {t(`${I18N_ROOT}.only_when_game_running`)}
                                </FieldLegend>
                                <FieldDescription className="text-xs leading-snug">
                                    {t(
                                        `${I18N_ROOT}.only_when_game_running_description`
                                    )}
                                </FieldDescription>
                            </div>
                            <Switch
                                checked={hasGameRunningCondition(selectedRule)}
                                disabled={disabled}
                                aria-label={t(
                                    `${I18N_ROOT}.only_when_game_running`
                                )}
                                onCheckedChange={(checked: any) =>
                                    update(selectedRule.id, (current: any) =>
                                        setGameRunningCondition(
                                            current,
                                            checked
                                        )
                                    )
                                }
                            />
                        </div>
                    </FieldSet>
                    <FieldSet
                        className="rounded-md border p-3"
                        disabled={disabled}
                        data-disabled={disabled}
                    >
                        <div className="flex min-w-0 items-start justify-between gap-3">
                            <div className="min-w-0">
                                <FieldLegend variant="label">
                                    {t(`${I18N_ROOT}.restore_previous_status`)}
                                </FieldLegend>
                                <FieldDescription className="text-xs leading-snug">
                                    {t(
                                        `${I18N_ROOT}.restore_previous_status_description`
                                    )}
                                </FieldDescription>
                            </div>
                            <Switch
                                checked={shouldRestorePreviousState(
                                    selectedRule
                                )}
                                disabled={disabled}
                                aria-label={t(
                                    `${I18N_ROOT}.restore_previous_status`
                                )}
                                onCheckedChange={(checked: any) =>
                                    update(selectedRule.id, (current: any) => ({
                                        ...current,
                                        restorePreviousState: checked
                                    }))
                                }
                            />
                        </div>
                    </FieldSet>
                    <PresenceRuleActionFields
                        idPrefix={selectedRule.id}
                        disabled={disabled}
                        status={selectedRule.actions?.status || 'no-change'}
                        statusDescriptionEnabled={hasAction(
                            selectedRule,
                            'statusDescription'
                        )}
                        statusDescription={
                            selectedRule.actions?.statusDescription || ''
                        }
                        onStatusChange={(value: any) =>
                            update(selectedRule.id, (current: any) =>
                                value === 'no-change'
                                    ? removeAction(current, 'status')
                                    : updateAction(current, { status: value })
                            )
                        }
                        onStatusDescriptionEnabledChange={(checked: any) =>
                            update(selectedRule.id, (current: any) =>
                                checked
                                    ? updateAction(current, {
                                          statusDescription: ''
                                      })
                                    : removeAction(current, 'statusDescription')
                            )
                        }
                        onStatusDescriptionChange={(value: any) =>
                            update(selectedRule.id, (current: any) =>
                                updateAction(current, {
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
                            {t(`${I18N_ROOT}.no_schedule_rules`)}
                        </EmptyTitle>
                        <EmptyDescription>
                            {t(`${I18N_ROOT}.schedule_rules_description`)}
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            )}
        </RuleEditorPanel>
    );

    return <AutomationSplitLayout list={list} editor={editor} />;
}
