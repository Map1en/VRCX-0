import { configRepository } from '@/repositories/index.js';

function safeArray(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (typeof value !== 'string' || !value.trim()) {
        return [];
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function buildInstanceConditions(selectedInstanceTypes) {
    return Array.isArray(selectedInstanceTypes) && selectedInstanceTypes.length
        ? [{ type: 'instanceTypeIn', values: selectedInstanceTypes }]
        : [];
}

function buildCompanyConditions({ noFriends, selectedGroups }) {
    if (!noFriends) {
        return [{ type: 'withCompany' }];
    }
    if (Array.isArray(selectedGroups) && selectedGroups.length) {
        return [{ type: 'hasFriendInGroups', values: selectedGroups }];
    }
    return [{ type: 'hasAnyFriend' }];
}

async function loadLegacyRules() {
    const enabled = await configRepository.getBool(
        'autoStateChangeEnabled',
        false
    );
    if (!enabled) {
        return [];
    }

    const [
        noFriends,
        selectedGroupsRaw,
        selectedInstanceTypesRaw,
        aloneStatus,
        companyStatus,
        aloneDescEnabled,
        aloneDesc,
        companyDescEnabled,
        companyDesc
    ] = await Promise.all([
        configRepository.getBool('autoStateChangeNoFriends', false),
        configRepository.getString('autoStateChangeGroups', '[]'),
        configRepository.getString('autoStateChangeInstanceTypes', '[]'),
        configRepository.getString('autoStateChangeAloneStatus', 'join me'),
        configRepository.getString('autoStateChangeCompanyStatus', 'busy'),
        configRepository.getBool('autoStateChangeAloneDescEnabled', false),
        configRepository.getString('autoStateChangeAloneDesc', ''),
        configRepository.getBool('autoStateChangeCompanyDescEnabled', false),
        configRepository.getString('autoStateChangeCompanyDesc', '')
    ]);
    const selectedGroups = safeArray(selectedGroupsRaw);
    const selectedInstanceTypes = safeArray(selectedInstanceTypesRaw);
    const instanceConditions = buildInstanceConditions(selectedInstanceTypes);
    const companyActions: Record<string, unknown> = {
        status: companyStatus || 'busy'
    };
    const aloneActions: Record<string, unknown> = {
        status: aloneStatus || 'join me'
    };
    if (companyDescEnabled) {
        companyActions.statusDescription = companyDesc || '';
    }
    if (aloneDescEnabled) {
        aloneActions.statusDescription = aloneDesc || '';
    }

    return [
        {
            id: 'legacy-company',
            label: 'Legacy company rule',
            enabled: true,
            generated: true,
            domain: 'context',
            priority: 200,
            conditions: [
                { type: 'isGameRunning' },
                ...instanceConditions,
                ...buildCompanyConditions({ noFriends, selectedGroups })
            ],
            actions: companyActions,
            stopProcessing: true
        },
        {
            id: 'legacy-alone',
            label: 'Legacy alone rule',
            enabled: true,
            generated: true,
            domain: 'context',
            priority: 100,
            conditions: [
                { type: 'isGameRunning' },
                { type: 'playerFactsKnown' },
                ...instanceConditions
            ],
            actions: aloneActions,
            stopProcessing: true
        }
    ];
}

async function loadStoredRules(key) {
    return safeArray(await configRepository.getString(key, '[]')).filter(
        (rule) => rule && typeof rule === 'object'
    );
}

function forceGameRunningCondition(rule) {
    const conditions = Array.isArray(rule.conditions)
        ? rule.conditions.filter(
              (condition) => condition?.type !== 'isGameRunning'
          )
        : [];
    return {
        ...rule,
        conditions: [{ type: 'isGameRunning' }, ...conditions]
    };
}

function hasPresenceAction(rule) {
    const actions = rule?.actions;
    if (!actions || typeof actions !== 'object') {
        return false;
    }
    return (
        Object.prototype.hasOwnProperty.call(actions, 'status') ||
        Object.prototype.hasOwnProperty.call(actions, 'statusDescription') ||
        Object.prototype.hasOwnProperty.call(actions, 'clearStatusDescription')
    );
}

export async function loadPresenceAutomationConfig() {
    const [
        timeRules,
        storedContextRules,
        legacyRules,
        minStatus,
        minDescription,
        stable
    ] = await Promise.all([
        loadStoredRules('presenceAutomationTimeRules'),
        loadStoredRules('presenceAutomationContextRules'),
        loadLegacyRules(),
        configRepository.getInt(
            'presenceAutomationMinStatusWriteIntervalMs',
            60000
        ),
        configRepository.getInt(
            'presenceAutomationMinDescriptionWriteIntervalMs',
            60000
        ),
        configRepository.getInt('presenceAutomationStableLocationMs', 30000)
    ]);
    const contextRules = storedContextRules.map(forceGameRunningCondition);
    const rules = [...timeRules, ...contextRules, ...legacyRules];
    const enabledRules = rules.filter(
        (rule) => rule?.enabled !== false && hasPresenceAction(rule)
    );

    return {
        enabled: Boolean(enabledRules.length),
        legacyModeEnabled: legacyRules.length > 0,
        rules: enabledRules,
        throttle: {
            minStatusWriteIntervalMs: Number(minStatus) || 60000,
            minDescriptionWriteIntervalMs: Number(minDescription) || 60000,
            stableLocationMs: Number(stable) || 30000
        }
    };
}

export { safeArray };
