export type OverlayActivitySurface = 'wrist';

export type OverlayActivityCategory =
    | 'actionRequired'
    | 'currentInstance'
    | 'favoriteMovement'
    | 'profileChange'
    | 'groupSocial'
    | 'systemSafety'
    | 'media';

export type OverlayActivityScope =
    | 'off'
    | 'on'
    | 'friends'
    | 'selectedFavorites'
    | 'allFavorites'
    | 'everyoneInInstance';

export type OverlayActivityFavoriteGroupKeys = 'all' | string[];

export interface OverlayActivityRule {
    scope: OverlayActivityScope;
    favoriteGroupKeys: OverlayActivityFavoriteGroupKeys;
}

export interface OverlayActivityFilterProfilePreference {
    version: 1;
    types: Record<string, OverlayActivityRule>;
}

export interface OverlayActivityTypeDefinition {
    key: string;
    category: OverlayActivityCategory;
    allowedScopes: OverlayActivityScope[];
    defaultScope: OverlayActivityScope;
    aliases?: string[];
}

export interface OverlayActivityFiltersPreference {
    version: 1;
    wrist: {
        types: Record<string, OverlayActivityRule>;
    };
}

export const OVERLAY_ACTIVITY_CATEGORIES: OverlayActivityCategory[] = [
    'actionRequired',
    'currentInstance',
    'favoriteMovement',
    'profileChange',
    'groupSocial',
    'systemSafety',
    'media'
];

export const OVERLAY_ACTIVITY_SCOPES: OverlayActivityScope[] = [
    'off',
    'on',
    'friends',
    'selectedFavorites',
    'allFavorites',
    'everyoneInInstance'
];

const BOOLEAN_SCOPES: OverlayActivityScope[] = ['off', 'on'];
const DIRECT_ACTOR_SCOPES: OverlayActivityScope[] = [
    'off',
    'on',
    'friends',
    'selectedFavorites',
    'allFavorites'
];
const FRIEND_ACTOR_SCOPES: OverlayActivityScope[] = [
    'off',
    'friends',
    'selectedFavorites',
    'allFavorites'
];
const INSTANCE_ACTOR_SCOPES: OverlayActivityScope[] = [
    'off',
    'friends',
    'selectedFavorites',
    'allFavorites',
    'everyoneInInstance'
];
const REMOVED_OVERLAY_ACTIVITY_TYPE_KEYS = new Set(['PortalSpawn']);

function defineType(
    category: OverlayActivityCategory,
    key: string,
    allowedScopes: OverlayActivityScope[],
    defaultScope: OverlayActivityScope,
    aliases?: string[]
): OverlayActivityTypeDefinition {
    return { key, category, allowedScopes, defaultScope, aliases };
}

export const OVERLAY_ACTIVITY_TYPE_DEFINITIONS: OverlayActivityTypeDefinition[] =
    [
        defineType('actionRequired', 'invite', DIRECT_ACTOR_SCOPES, 'friends'),
        defineType(
            'actionRequired',
            'requestInvite',
            DIRECT_ACTOR_SCOPES,
            'friends'
        ),
        defineType(
            'actionRequired',
            'inviteResponse',
            DIRECT_ACTOR_SCOPES,
            'friends'
        ),
        defineType(
            'actionRequired',
            'requestInviteResponse',
            DIRECT_ACTOR_SCOPES,
            'friends'
        ),
        defineType('actionRequired', 'friendRequest', BOOLEAN_SCOPES, 'on'),
        defineType('actionRequired', 'boop', DIRECT_ACTOR_SCOPES, 'friends'),
        defineType('actionRequired', 'group.queueReady', BOOLEAN_SCOPES, 'on'),
        defineType('actionRequired', 'instance.closed', BOOLEAN_SCOPES, 'on'),

        defineType(
            'currentInstance',
            'OnPlayerJoining',
            INSTANCE_ACTOR_SCOPES,
            'friends'
        ),
        defineType(
            'currentInstance',
            'OnPlayerJoined',
            INSTANCE_ACTOR_SCOPES,
            'everyoneInInstance'
        ),
        defineType(
            'currentInstance',
            'OnPlayerLeft',
            INSTANCE_ACTOR_SCOPES,
            'everyoneInInstance'
        ),
        defineType(
            'currentInstance',
            'ChatBoxMessage',
            INSTANCE_ACTOR_SCOPES,
            'off'
        ),

        defineType(
            'favoriteMovement',
            'Online',
            FRIEND_ACTOR_SCOPES,
            'friends'
        ),
        defineType(
            'favoriteMovement',
            'Offline',
            FRIEND_ACTOR_SCOPES,
            'friends'
        ),
        defineType('favoriteMovement', 'GPS', FRIEND_ACTOR_SCOPES, 'friends'),
        defineType(
            'favoriteMovement',
            'Status',
            FRIEND_ACTOR_SCOPES,
            'friends'
        ),

        defineType('profileChange', 'Friend', BOOLEAN_SCOPES, 'on'),
        defineType('profileChange', 'Unfriend', BOOLEAN_SCOPES, 'on'),
        defineType(
            'profileChange',
            'DisplayName',
            FRIEND_ACTOR_SCOPES,
            'friends'
        ),
        defineType(
            'profileChange',
            'TrustLevel',
            FRIEND_ACTOR_SCOPES,
            'friends'
        ),
        defineType(
            'profileChange',
            'AvatarChange',
            FRIEND_ACTOR_SCOPES,
            'off',
            ['Avatar']
        ),
        defineType('profileChange', 'Bio', FRIEND_ACTOR_SCOPES, 'off'),

        defineType('groupSocial', 'groupChange', BOOLEAN_SCOPES, 'on'),
        defineType('groupSocial', 'group.announcement', BOOLEAN_SCOPES, 'on'),
        defineType('groupSocial', 'group.informative', BOOLEAN_SCOPES, 'on'),
        defineType('groupSocial', 'group.invite', BOOLEAN_SCOPES, 'on'),
        defineType('groupSocial', 'group.joinRequest', BOOLEAN_SCOPES, 'on'),
        defineType('groupSocial', 'group.transfer', BOOLEAN_SCOPES, 'on'),

        defineType('systemSafety', 'Event', BOOLEAN_SCOPES, 'on'),
        defineType('systemSafety', 'External', BOOLEAN_SCOPES, 'on'),
        defineType('systemSafety', 'Blocked', BOOLEAN_SCOPES, 'on'),
        defineType('systemSafety', 'Unblocked', BOOLEAN_SCOPES, 'on'),
        defineType('systemSafety', 'Muted', BOOLEAN_SCOPES, 'on'),
        defineType('systemSafety', 'Unmuted', BOOLEAN_SCOPES, 'on'),
        defineType(
            'systemSafety',
            'BlockedOnPlayerJoined',
            INSTANCE_ACTOR_SCOPES,
            'off'
        ),
        defineType(
            'systemSafety',
            'BlockedOnPlayerLeft',
            INSTANCE_ACTOR_SCOPES,
            'off'
        ),
        defineType(
            'systemSafety',
            'MutedOnPlayerJoined',
            INSTANCE_ACTOR_SCOPES,
            'off'
        ),
        defineType(
            'systemSafety',
            'MutedOnPlayerLeft',
            INSTANCE_ACTOR_SCOPES,
            'off'
        ),

        defineType('media', 'VideoPlay', BOOLEAN_SCOPES, 'on')
    ];

export const OVERLAY_ACTIVITY_RAW_TYPES: Record<
    OverlayActivityCategory,
    string[]
> = OVERLAY_ACTIVITY_CATEGORIES.reduce(
    (result, category) => {
        result[category] = OVERLAY_ACTIVITY_TYPE_DEFINITIONS.filter(
            (definition) => definition.category === category
        ).map((definition) => definition.key);
        return result;
    },
    {} as Record<OverlayActivityCategory, string[]>
);

export const OVERLAY_ACTIVITY_TYPE_DEFINITION_BY_KEY = Object.fromEntries(
    OVERLAY_ACTIVITY_TYPE_DEFINITIONS.map((definition) => [
        definition.key,
        definition
    ])
) as Record<string, OverlayActivityTypeDefinition>;

export const DEFAULT_OVERLAY_ACTIVITY_TYPES: Record<
    string,
    OverlayActivityRule
> = Object.fromEntries(
    OVERLAY_ACTIVITY_TYPE_DEFINITIONS.map((definition) => [
        definition.key,
        {
            scope: definition.defaultScope,
            favoriteGroupKeys: 'all'
        }
    ])
);

export const DEFAULT_OVERLAY_ACTIVITY_FILTER_PROFILE: OverlayActivityFilterProfilePreference =
    {
        version: 1,
        types: cloneOverlayActivityTypeRules(DEFAULT_OVERLAY_ACTIVITY_TYPES)
    };

export const DEFAULT_OVERLAY_ACTIVITY_FILTERS: OverlayActivityFiltersPreference =
    {
        version: 1,
        wrist: {
            types: cloneOverlayActivityTypeRules(
                DEFAULT_OVERLAY_ACTIVITY_FILTER_PROFILE.types
            )
        }
    };

export const DEFAULT_VR_NOTIFICATION_ACTIVITY_FILTERS =
    DEFAULT_OVERLAY_ACTIVITY_FILTER_PROFILE;

export function overlayActivityCategoriesFromDefinitions(
    definitions: OverlayActivityTypeDefinition[]
): OverlayActivityCategory[] {
    const categories: OverlayActivityCategory[] = [];
    for (const definition of definitions) {
        if (!categories.includes(definition.category)) {
            categories.push(definition.category);
        }
    }
    return categories;
}

export function overlayActivityRawTypesByCategoryFromDefinitions(
    definitions: OverlayActivityTypeDefinition[]
): Record<OverlayActivityCategory, string[]> {
    return definitions.reduce(
        (result, definition) => {
            result[definition.category] ||= [];
            result[definition.category].push(definition.key);
            return result;
        },
        {} as Record<OverlayActivityCategory, string[]>
    );
}

export function overlayActivityDefinitionByKeyFromDefinitions(
    definitions: OverlayActivityTypeDefinition[]
): Record<string, OverlayActivityTypeDefinition> {
    return Object.fromEntries(
        definitions.map((definition) => [definition.key, definition])
    ) as Record<string, OverlayActivityTypeDefinition>;
}

export function defaultOverlayActivityTypeRulesFromDefinitions(
    definitions: OverlayActivityTypeDefinition[]
): Record<string, OverlayActivityRule> {
    return Object.fromEntries(
        definitions.map((definition) => [
            definition.key,
            {
                scope: definition.defaultScope,
                favoriteGroupKeys: 'all'
            }
        ])
    );
}

export function defaultOverlayActivityFilterProfileFromDefinitions(
    definitions: OverlayActivityTypeDefinition[]
): OverlayActivityFilterProfilePreference {
    return {
        version: 1,
        types: cloneOverlayActivityTypeRules(
            defaultOverlayActivityTypeRulesFromDefinitions(definitions),
            definitions
        )
    };
}

export function defaultOverlayActivityFiltersFromDefinitions(
    definitions: OverlayActivityTypeDefinition[]
): OverlayActivityFiltersPreference {
    const profile = defaultOverlayActivityFilterProfileFromDefinitions(
        definitions
    );
    return {
        version: 1,
        wrist: {
            types: profile.types
        }
    };
}

export function overlayActivityTypeLabelKey(type: string) {
    return type.replace(/\./g, '_');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function cloneOverlayActivityTypeRules(
    types: Record<string, OverlayActivityRule>,
    definitions: OverlayActivityTypeDefinition[] = OVERLAY_ACTIVITY_TYPE_DEFINITIONS
): Record<string, OverlayActivityRule> {
    return Object.fromEntries(
        definitions.map((definition) => {
            const rule = types[definition.key];
            return [
                definition.key,
                {
                    scope: rule.scope,
                    favoriteGroupKeys: Array.isArray(rule.favoriteGroupKeys)
                        ? [...rule.favoriteGroupKeys]
                        : rule.favoriteGroupKeys
                }
            ];
        })
    );
}

function normalizeFavoriteGroupKeys(
    value: unknown
): OverlayActivityFavoriteGroupKeys {
    if (value === 'all') {
        return 'all';
    }
    if (!Array.isArray(value)) {
        return 'all';
    }
    const groupKeys = value
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
    const uniqueGroupKeys = Array.from(new Set(groupKeys));
    return uniqueGroupKeys.length ? uniqueGroupKeys : 'all';
}

function scopeUsesFavoriteGroups(scope: OverlayActivityScope) {
    return scope === 'selectedFavorites';
}

function mappedLegacyScope(
    scope: unknown,
    definition: OverlayActivityTypeDefinition
): OverlayActivityScope | null {
    if (typeof scope !== 'string') {
        return null;
    }
    const allowedScopes = definition.allowedScopes;
    if (allowedScopes.includes(scope as OverlayActivityScope)) {
        return scope as OverlayActivityScope;
    }
    if (scope === 'everyone' && allowedScopes.includes('everyoneInInstance')) {
        return 'everyoneInInstance';
    }
    if (
        scope === 'currentInstance' &&
        allowedScopes.includes('everyoneInInstance')
    ) {
        return 'everyoneInInstance';
    }
    if (scope === 'friendsAndFavorites' && allowedScopes.includes('friends')) {
        return 'friends';
    }
    if (
        (scope === 'direct' ||
            scope === 'criticalOnly' ||
            scope === 'everyone' ||
            scope === 'currentInstance') &&
        allowedScopes.includes('on')
    ) {
        return 'on';
    }
    return null;
}

function normalizeScope(
    value: unknown,
    definition: OverlayActivityTypeDefinition,
    fallback: OverlayActivityScope
) {
    const scope = mappedLegacyScope(value, definition);
    return scope && definition.allowedScopes.includes(scope) ? scope : fallback;
}

function normalizeRule(
    definition: OverlayActivityTypeDefinition,
    value: Record<string, unknown>,
    fallback: OverlayActivityRule
): OverlayActivityRule {
    const scope = normalizeScope(value.scope, definition, fallback.scope);
    return {
        scope,
        favoriteGroupKeys: scopeUsesFavoriteGroups(scope)
            ? normalizeFavoriteGroupKeys(
                  'favoriteGroupKeys' in value
                      ? value.favoriteGroupKeys
                      : fallback.favoriteGroupKeys
              )
            : 'all'
    };
}

function normalizeUnknownTypeRule(value: unknown): OverlayActivityRule | null {
    if (!isRecord(value)) {
        return null;
    }
    const scope = OVERLAY_ACTIVITY_SCOPES.includes(
        value.scope as OverlayActivityScope
    )
        ? (value.scope as OverlayActivityScope)
        : null;
    if (!scope) {
        return null;
    }
    return {
        scope,
        favoriteGroupKeys: scopeUsesFavoriteGroups(scope)
            ? normalizeFavoriteGroupKeys(value.favoriteGroupKeys)
            : 'all'
    };
}

function sharedFeedFilterScope(
    value: unknown,
    definition: OverlayActivityTypeDefinition
): OverlayActivityScope | null {
    const allowedScopes = definition.allowedScopes;
    switch (value) {
        case 'Off':
            return 'off';
        case 'VIP':
            if (allowedScopes.includes('allFavorites')) {
                return 'allFavorites';
            }
            if (allowedScopes.includes('selectedFavorites')) {
                return 'selectedFavorites';
            }
            return allowedScopes.includes('on') ? 'on' : null;
        case 'Friends':
            if (allowedScopes.includes('friends')) {
                return 'friends';
            }
            return allowedScopes.includes('on') ? 'on' : null;
        case 'Everyone':
            if (allowedScopes.includes('everyoneInInstance')) {
                return 'everyoneInInstance';
            }
            return allowedScopes.includes('on') ? 'on' : null;
        case 'On':
            return allowedScopes.includes('on') ? 'on' : null;
        default:
            return null;
    }
}

function getTypeCandidate(
    types: Record<string, unknown>,
    definition: OverlayActivityTypeDefinition
): Record<string, unknown> | null {
    const keys = [definition.key, ...(definition.aliases || [])];
    for (const key of keys) {
        const candidate = types[key];
        if (isRecord(candidate)) {
            return candidate;
        }
    }
    return null;
}

function getLegacyTypeRule(
    definition: OverlayActivityTypeDefinition,
    categories: Record<string, unknown>,
    legacyFavoriteGroupKeys: OverlayActivityFavoriteGroupKeys
): Record<string, unknown> | null {
    const categoryCandidate = categories[definition.category];
    if (!isRecord(categoryCandidate)) {
        return null;
    }
    const categoryRule: Record<string, unknown> = categoryCandidate;
    const categoryFavoriteGroupKeys =
        'favoriteGroupKeys' in categoryRule
            ? categoryRule.favoriteGroupKeys
            : legacyFavoriteGroupKeys;
    const typeOverrides = isRecord(categoryRule.typeOverrides)
        ? categoryRule.typeOverrides
        : {};
    const typeOverrideCandidate = getTypeCandidate(typeOverrides, definition);
    if (isRecord(typeOverrideCandidate)) {
        return {
            scope:
                'scope' in typeOverrideCandidate
                    ? typeOverrideCandidate.scope
                    : categoryRule.scope,
            favoriteGroupKeys:
                'favoriteGroupKeys' in typeOverrideCandidate
                    ? typeOverrideCandidate.favoriteGroupKeys
                    : categoryFavoriteGroupKeys
        };
    }
    return {
        scope: categoryRule.scope,
        favoriteGroupKeys: categoryFavoriteGroupKeys
    };
}

export function normalizeOverlayActivityFilters(
    value: unknown = {}
): OverlayActivityFiltersPreference {
    return normalizeOverlayActivityFiltersWithDefinitions(
        value,
        OVERLAY_ACTIVITY_TYPE_DEFINITIONS
    );
}

export function normalizeOverlayActivityFilterProfileWithDefinitions(
    value: unknown = {},
    definitions: OverlayActivityTypeDefinition[]
): OverlayActivityFilterProfilePreference {
    const source = isRecord(value) ? value : {};
    const filterProfile = isRecord(source.wrist) ? source.wrist : source;
    const types = isRecord(filterProfile.types) ? filterProfile.types : {};
    const categories = isRecord(filterProfile.categories)
        ? filterProfile.categories
        : {};
    const legacyFavoriteGroupKeys = normalizeFavoriteGroupKeys(
        filterProfile.favoriteGroupKeys
    );
    const defaultTypes =
        defaultOverlayActivityTypeRulesFromDefinitions(definitions);
    const definitionKeys = new Set(
        definitions.map((definition) => definition.key)
    );
    const aliasKeys = new Set(
        definitions.flatMap((definition) => definition.aliases || [])
    );
    const normalizedKnownTypes = definitions.map((definition) => {
        const defaultRule = defaultTypes[definition.key];
        const legacyRule = getLegacyTypeRule(
            definition,
            categories,
            legacyFavoriteGroupKeys
        );
        const typeCandidate = getTypeCandidate(types, definition);
        const sourceRule: Record<string, unknown> = typeCandidate
            ? typeCandidate
            : legacyRule || {};
        const fallbackRule = legacyRule
            ? normalizeRule(definition, legacyRule, defaultRule)
            : defaultRule;
        return [
            definition.key,
            normalizeRule(definition, sourceRule, fallbackRule)
        ];
    });
    const normalizedUnknownTypes = Object.entries(types).flatMap(
        ([key, value]) => {
            if (
                definitionKeys.has(key) ||
                aliasKeys.has(key) ||
                REMOVED_OVERLAY_ACTIVITY_TYPE_KEYS.has(key)
            ) {
                return [];
            }
            const rule = normalizeUnknownTypeRule(value);
            return rule ? [[key, rule]] : [];
        }
    );

    return {
        version: 1,
        types: Object.fromEntries([
            ...normalizedKnownTypes,
            ...normalizedUnknownTypes
        ])
    };
}

export function normalizeOverlayActivityFilterProfile(
    value: unknown = {}
): OverlayActivityFilterProfilePreference {
    return normalizeOverlayActivityFilterProfileWithDefinitions(
        value,
        OVERLAY_ACTIVITY_TYPE_DEFINITIONS
    );
}

export function normalizeOverlayActivityFiltersWithDefinitions(
    value: unknown = {},
    definitions: OverlayActivityTypeDefinition[]
): OverlayActivityFiltersPreference {
    const source = isRecord(value) ? value : {};
    const profile = normalizeOverlayActivityFilterProfileWithDefinitions(
        isRecord(source.wrist) ? source.wrist : source,
        definitions
    );
    return {
        version: 1,
        wrist: {
            types: profile.types
        }
    };
}

export function migrateLegacySharedFeedWristFilters(
    value: unknown = {}
): OverlayActivityFiltersPreference {
    if (typeof value === 'string') {
        try {
            return migrateLegacySharedFeedWristFilters(JSON.parse(value));
        } catch {
            return normalizeOverlayActivityFilters();
        }
    }
    const source = isRecord(value) ? value : {};
    const wrist = isRecord(source.wrist) ? source.wrist : {};
    const types = Object.fromEntries(
        OVERLAY_ACTIVITY_TYPE_DEFINITIONS.flatMap((definition) => {
            const keys = [definition.key, ...(definition.aliases || [])];
            const legacyValue = keys
                .map((key) => wrist[key])
                .find((candidate) => candidate !== undefined);
            const scope = sharedFeedFilterScope(legacyValue, definition);
            if (!scope) {
                return [];
            }
            return [
                [
                    definition.key,
                    {
                        scope,
                        favoriteGroupKeys: 'all'
                    }
                ]
            ];
        })
    );
    return normalizeOverlayActivityFilters({
        version: 1,
        wrist: {
            types
        }
    });
}

export function parseOverlayActivityFilters(
    value: unknown
): OverlayActivityFiltersPreference {
    if (!value) {
        return normalizeOverlayActivityFilters();
    }
    if (typeof value === 'object') {
        return normalizeOverlayActivityFilters(value);
    }
    try {
        return normalizeOverlayActivityFilters(JSON.parse(String(value)));
    } catch {
        return normalizeOverlayActivityFilters();
    }
}

export function parseOverlayActivityFilterProfile(
    value: unknown
): OverlayActivityFilterProfilePreference {
    if (!value) {
        return normalizeOverlayActivityFilterProfile();
    }
    if (typeof value === 'object') {
        return normalizeOverlayActivityFilterProfile(value);
    }
    try {
        return normalizeOverlayActivityFilterProfile(JSON.parse(String(value)));
    } catch {
        return normalizeOverlayActivityFilterProfile();
    }
}
