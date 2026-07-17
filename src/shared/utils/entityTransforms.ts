type EntityRecord = Record<string, unknown>;
type FavoriteCachedRef = EntityRecord & {
    id: string;
    type: string;
    favoriteId: string;
    tags: string[];
    $groupKey: string;
};

/**
 * Build a default cached favorite ref from JSON data.
 * Computes $groupKey from type and first tag.
 * @param {object} json
 * @returns {object}
 */
export function createDefaultFavoriteCachedRef(json: EntityRecord = {}) {
    const jsonTags = Array.isArray(json.tags)
        ? json.tags.map((value) => String(value))
        : [];
    const ref: FavoriteCachedRef = {
        ...json,
        id: '',
        type: '',
        favoriteId: '',
        tags: jsonTags,
        // VRCX
        $groupKey: ''
    };
    if (typeof json.id === 'string') {
        ref.id = json.id;
    }
    if (typeof json.type === 'string') {
        ref.type = json.type;
    }
    if (typeof json.favoriteId === 'string') {
        ref.favoriteId = json.favoriteId;
    }
    if (typeof json.$groupKey === 'string') {
        ref.$groupKey = json.$groupKey;
    }
    ref.$groupKey = `${ref.type}:${String(ref.tags[0])}`;
    return ref;
}
