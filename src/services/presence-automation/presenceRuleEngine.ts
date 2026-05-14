const STATUS_VALUES = new Set([
    'active',
    'join me',
    'ask me',
    'busy',
    'offline'
]);

function compareNumbers(left: number, op: string, right: number) {
    if (op === '>') {
        return left > right;
    }
    if (op === '>=') {
        return left >= right;
    }
    if (op === '<') {
        return left < right;
    }
    if (op === '<=') {
        return left <= right;
    }
    if (op === '!=') {
        return left !== right;
    }
    return left === right;
}

function parseClockMinutes(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
        return null;
    }
    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
    }
    return hours * 60 + minutes;
}

function getLocalDayValue(date, offsetDays = 0) {
    if (!offsetDays) {
        const day = date.getDay();
        return day === 0 ? 7 : day;
    }
    const shifted = new Date(date);
    shifted.setDate(shifted.getDate() + offsetDays);
    const day = shifted.getDay();
    return day === 0 ? 7 : day;
}

function matchesDayFilter(days, now, activeDayOffset = 0) {
    if (!days.length) {
        return true;
    }
    return days.includes(getLocalDayValue(now, activeDayOffset));
}

function matchesTimeWindow(condition: Record<string, any>, facts: Record<string, any>) {
    const start = parseClockMinutes(condition.start);
    const end = parseClockMinutes(condition.end);
    if (start === null || end === null) {
        return false;
    }

    const now = facts.now instanceof Date ? facts.now : new Date(facts.now);
    const days = Array.isArray(condition.days) ? condition.days : [];
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (start === end) {
        return matchesDayFilter(days, now);
    }
    if (end > start) {
        if (!matchesDayFilter(days, now)) {
            return false;
        }
        return nowMinutes >= start && nowMinutes < end;
    }
    if (nowMinutes >= start) {
        return matchesDayFilter(days, now);
    }
    if (nowMinutes < end) {
        return matchesDayFilter(days, now, -1);
    }
    return false;
}

function hasPlayerFacts(facts: Record<string, any>) {
    return facts?.playerFactsKnown === true;
}

function matchesCondition(condition: Record<string, any>, facts: Record<string, any>) {
    const type = condition?.type;
    if (!type) {
        return false;
    }

    if (type === 'timeWindow') {
        return matchesTimeWindow(condition, facts);
    }
    if (type === 'playerFactsKnown') {
        return hasPlayerFacts(facts) === Boolean(condition.value ?? true);
    }
    if (type === 'instanceTypeIn') {
        const values = Array.isArray(condition.values) ? condition.values : [];
        return values.includes(facts.instanceType);
    }
    if (type === 'playerCount') {
        if (!hasPlayerFacts(facts)) {
            return false;
        }
        return compareNumbers(
            facts.playerCount,
            condition.op || '==',
            Number(condition.value) || 0
        );
    }
    if (type === 'friendCount') {
        if (!hasPlayerFacts(facts)) {
            return false;
        }
        return compareNumbers(
            facts.friendCount,
            condition.op || '==',
            Number(condition.value) || 0
        );
    }
    if (type === 'hasAnyFriend') {
        if (!hasPlayerFacts(facts)) {
            return false;
        }
        return facts.friendCount > 0;
    }
    if (type === 'hasFriendInGroups') {
        if (!hasPlayerFacts(facts)) {
            return false;
        }
        const values = Array.isArray(condition.values) ? condition.values : [];
        return values.some((groupKey) =>
            facts.presentFavoriteGroupKeys.includes(groupKey)
        );
    }
    if (type === 'hasSpecificFriend') {
        if (!hasPlayerFacts(facts)) {
            return false;
        }
        const values = Array.isArray(condition.values) ? condition.values : [];
        return values.some((userId) => facts.presentFriendIds.includes(userId));
    }
    if (type === 'isAlone') {
        if (!hasPlayerFacts(facts)) {
            return false;
        }
        return facts.playerCount === 0;
    }
    if (type === 'withCompany') {
        if (!hasPlayerFacts(facts)) {
            return false;
        }
        return facts.playerCount > 0;
    }
    if (type === 'isTraveling') {
        return facts.isTraveling === Boolean(condition.value ?? true);
    }
    if (type === 'isGameRunning') {
        return facts.isGameRunning === Boolean(condition.value ?? true);
    }
    if (type === 'canInviteFromCurrentLocation') {
        return (
            facts.canInviteFromCurrentLocation ===
            Boolean(condition.value ?? true)
        );
    }

    return false;
}

function validateActionPatch(actions: Record<string, any> = {}) {
    const patch: Record<string, any> = {};
    if (actions.status && STATUS_VALUES.has(actions.status)) {
        patch.status = actions.status;
    }
    if (Object.prototype.hasOwnProperty.call(actions, 'statusDescription')) {
        patch.statusDescription = String(
            actions.statusDescription ?? ''
        ).slice(0, 32);
    } else if (actions.clearStatusDescription) {
        patch.statusDescription = '';
    }
    return patch;
}

function evaluateRule(rule: Record<string, any>, facts: Record<string, any>) {
    const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
    for (const condition of conditions) {
        if (!matchesCondition(condition, facts)) {
            return {
                matched: false,
                reason: `condition:${condition?.type || 'unknown'}`
            };
        }
    }
    return { matched: true, reason: 'matched' };
}

export function evaluatePresenceRules({ facts, rules }) {
    const sortedRules = [...(Array.isArray(rules) ? rules : [])]
        .filter((rule) => rule?.enabled !== false)
        .sort((left, right) => {
            const priorityDelta =
                Number(right.priority || 0) - Number(left.priority || 0);
            if (priorityDelta) {
                return priorityDelta;
            }
            return String(left.id || '').localeCompare(String(right.id || ''));
        });
    const patch: Record<string, any> = {};
    const fieldOwners: Record<string, string> = {};
    const stoppedDomains = new Set();
    const matchedRules = [];
    const skippedRules = [];

    for (const rule of sortedRules) {
        const domain = rule.domain || 'context';
        if (stoppedDomains.has(domain)) {
            skippedRules.push({
                id: rule.id,
                domain,
                reason: 'domain-stopped'
            });
            continue;
        }

        const result = evaluateRule(rule, facts);
        if (!result.matched) {
            skippedRules.push({
                id: rule.id,
                domain,
                reason: result.reason
            });
            continue;
        }

        const actionPatch = validateActionPatch(rule.actions || {});
        const ownedFields = [];
        for (const [field, value] of Object.entries(actionPatch)) {
            if (!Object.prototype.hasOwnProperty.call(fieldOwners, field)) {
                patch[field] = value;
                fieldOwners[field] = rule.id || '';
                ownedFields.push(field);
            }
        }

        matchedRules.push({
            id: rule.id,
            label: rule.label || rule.id,
            domain,
            priority: rule.priority || 0,
            restorePreviousState: rule.restorePreviousState !== false,
            ownedFields,
            actions: actionPatch
        });

        if (rule.stopProcessing) {
            stoppedDomains.add(domain);
        }
    }

    return {
        patch,
        fieldOwners,
        matchedRules,
        skippedRules,
        explanation: {
            desiredStatus: patch.status || facts.currentUser?.status || '',
            desiredStatusDescription:
                Object.prototype.hasOwnProperty.call(patch, 'statusDescription')
                    ? patch.statusDescription
                    : facts.currentUser?.statusDescription || '',
            matchedRuleCount: matchedRules.length,
            skippedRuleCount: skippedRules.length
        }
    };
}

export { STATUS_VALUES };
