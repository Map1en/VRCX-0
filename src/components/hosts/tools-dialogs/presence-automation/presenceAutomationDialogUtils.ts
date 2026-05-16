import { accessTypeLocaleKeyMap } from '@/shared/constants/accessType.js';

export const dayOptions = [
    { value: 1, labelKey: 'common.days.monday' },
    { value: 2, labelKey: 'common.days.tuesday' },
    { value: 3, labelKey: 'common.days.wednesday' },
    { value: 4, labelKey: 'common.days.thursday' },
    { value: 5, labelKey: 'common.days.friday' },
    { value: 6, labelKey: 'common.days.saturday' },
    { value: 7, labelKey: 'common.days.sunday' }
];

export const contextPresetOptions = [
    {
        value: 'alone',
        labelKey: 'view.tools.social_automation.preset_alone'
    },
    {
        value: 'withAnyone',
        labelKey: 'view.tools.social_automation.preset_with_anyone'
    },
    {
        value: 'withAnyFriend',
        labelKey:
            'view.tools.social_automation.preset_with_any_friend'
    },
    {
        value: 'friendCountAtLeast',
        labelKey:
            'view.tools.social_automation.preset_friend_count_at_least'
    },
    {
        value: 'playerCountAtLeast',
        labelKey:
            'view.tools.social_automation.preset_player_count_at_least'
    },
    {
        value: 'withSelectedGroups',
        labelKey:
            'view.tools.social_automation.preset_with_selected_groups'
    },
    {
        value: 'withSelectedFriend',
        labelKey:
            'view.tools.social_automation.preset_with_selected_friend'
    },
    {
        value: 'inSelectedInstanceTypes',
        labelKey:
            'view.tools.social_automation.preset_in_selected_room_types'
    }
];

export const priorityOptions = [
    {
        value: 'high',
        labelKey: 'view.tools.social_automation.priority_high',
        priority: 700
    },
    {
        value: 'medium',
        labelKey: 'view.tools.social_automation.priority_medium',
        priority: 400
    },
    {
        value: 'low',
        labelKey: 'view.tools.social_automation.priority_low',
        priority: 100
    }
];

export function priorityValueFromNumber(priority, fallback = 'medium') {
    const numericPriority = Number(priority);
    if (!Number.isFinite(numericPriority)) {
        return fallback;
    }
    if (numericPriority >= 600) {
        return 'high';
    }
    if (numericPriority >= 300) {
        return 'medium';
    }
    return 'low';
}

export function priorityLabelKeyFromNumber(priority, fallback = 'medium') {
    const value = priorityValueFromNumber(priority, fallback);
    return (
        priorityOptions.find((option) => option.value === value)?.labelKey ||
        priorityOptions[1].labelKey
    );
}

export function priorityNumberFromValue(value, fallback = 400) {
    return (
        priorityOptions.find((option) => option.value === value)?.priority ||
        fallback
    );
}

export function contextPresetLabelKeyFromValue(value) {
    return (
        contextPresetOptions.find((option) => option.value === value)
            ?.labelKey ||
        'view.tools.social_automation.preset_custom'
    );
}

export function createInstanceOptions(instanceTypes, t) {
    return instanceTypes.map((type) => {
        const mapKey = type === 'groupOnly' ? 'groupMembers' : type;
        const localeKey = accessTypeLocaleKeyMap[mapKey];
        const groupKey = accessTypeLocaleKeyMap.group;
        return {
            value: type,
            label:
                mapKey === 'groupPublic' ||
                mapKey === 'groupPlus' ||
                mapKey === 'groupMembers'
                    ? `${t(groupKey)} ${t(localeKey)}`
                    : localeKey
                      ? t(localeKey)
                      : type
        };
    });
}

export function createGroupOptions({
    favoriteFriendGroups,
    localFriendFavoriteGroups
}) {
    const remoteGroupOptions = (favoriteFriendGroups || []).map((group) => ({
        value: group.key,
        label: group.displayName || group.name || group.key
    }));
    const localGroupOptions = (localFriendFavoriteGroups || []).map(
        (group) => ({
            value: `local:${group}`,
            label: group
        })
    );
    return [...remoteGroupOptions, ...localGroupOptions].filter(
        (group) => group.value
    );
}

export function createTimeRule(label = '') {
    return {
        id: `time-${Date.now()}`,
        enabled: true,
        domain: 'time',
        priority: 700,
        label,
        restorePreviousState: true,
        conditions: [
            {
                type: 'timeWindow',
                start: '21:00',
                end: '02:00',
                days: [],
                timezone: 'local'
            }
        ],
        actions: {}
    };
}

export function getTimeWindow(rule) {
    return (
        rule.conditions?.find((condition) => condition.type === 'timeWindow') || {
            type: 'timeWindow',
            start: '21:00',
            end: '02:00',
            days: [],
            timezone: 'local'
        }
    );
}

export function shouldRestorePreviousState(rule) {
    return rule?.restorePreviousState !== false;
}

export function hasGameRunningCondition(rule) {
    return Boolean(
        rule.conditions?.some(
            (condition) =>
                condition?.type === 'isGameRunning' &&
                condition.value !== false
        )
    );
}

export function setGameRunningCondition(rule, enabled) {
    const otherConditions = (rule.conditions || []).filter(
        (condition) => condition?.type !== 'isGameRunning'
    );
    return {
        ...rule,
        conditions: enabled
            ? [{ type: 'isGameRunning' }, ...otherConditions]
            : otherConditions
    };
}

export function buildContextConditions(rule) {
    const conditions: Array<Record<string, unknown>> = [
        { type: 'isGameRunning' }
    ];
    if (rule.preset === 'alone') {
        conditions.push({ type: 'isAlone' });
    } else if (rule.preset === 'withAnyone') {
        conditions.push({ type: 'withCompany' });
    } else if (rule.preset === 'withAnyFriend') {
        conditions.push({ type: 'hasAnyFriend' });
    } else if (rule.preset === 'friendCountAtLeast') {
        conditions.push({
            type: 'friendCount',
            op: '>=',
            value: Number(rule.friendCountValue) || 1
        });
    } else if (rule.preset === 'playerCountAtLeast') {
        conditions.push({
            type: 'playerCount',
            op: '>=',
            value: Number(rule.playerCountValue) || 1
        });
    } else if (rule.preset === 'withSelectedGroups') {
        conditions.push({
            type: 'hasFriendInGroups',
            values: rule.selectedGroups || []
        });
    } else if (rule.preset === 'withSelectedFriend') {
        conditions.push({
            type: 'hasSpecificFriend',
            values: rule.specificFriendIds || []
        });
    }

    if (rule.selectedInstanceTypes?.length) {
        conditions.push({
            type: 'instanceTypeIn',
            values: rule.selectedInstanceTypes || []
        });
    }
    return conditions;
}

export function createContextRule(label = '') {
    const rule = {
        id: `context-${Date.now()}`,
        enabled: true,
        domain: 'context',
        priority: 400,
        label,
        preset: 'alone',
        selectedGroups: [],
        selectedInstanceTypes: ['public', 'friends+'],
        specificFriendIds: [],
        friendCountValue: 1,
        playerCountValue: 1,
        actions: {
            status: 'join me'
        }
    };
    return {
        ...rule,
        conditions: buildContextConditions(rule)
    };
}

export function normalizeContextRule(rule) {
    const normalized = {
        ...rule,
        domain: 'context',
        preset: rule.preset || 'alone',
        selectedGroups: Array.isArray(rule.selectedGroups)
            ? rule.selectedGroups
            : [],
        selectedInstanceTypes: Array.isArray(rule.selectedInstanceTypes)
            ? rule.selectedInstanceTypes
            : [],
        specificFriendIds: Array.isArray(rule.specificFriendIds)
            ? rule.specificFriendIds
            : [],
        friendCountValue: Number(rule.friendCountValue) || 1,
        playerCountValue: Number(rule.playerCountValue) || 1,
        actions: rule.actions || {}
    };
    return {
        ...normalized,
        conditions: buildContextConditions(normalized)
    };
}

export function updateRule(rules, ruleId, updater) {
    return rules.map((rule) => {
        if (rule.id !== ruleId) {
            return rule;
        }
        return updater(rule);
    });
}
