import { replaceBioSymbols } from './string';

export type NotificationRecord = Record<string, unknown>;

export interface NotificationV1Ref extends NotificationRecord {
    id: string;
    senderUserId: string;
    senderUsername: string;
    type: string;
    message: string;
    details: NotificationRecord;
    seen: boolean;
    created_at: string;
    $isExpired: boolean;
}

export interface NotificationV2Ref extends NotificationRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
    type: string;
    link: string;
    linkText: string;
    message: string;
    title: string;
    imageUrl: string;
    seen: boolean;
    senderUserId: string;
    senderUsername: string;
    data: NotificationRecord;
    responses: unknown[];
    details: NotificationRecord;
    version: 2;
}

/**
 * Remove null/undefined keys from a notification JSON object
 * and sanitize message/title fields with replaceBioSymbols.
 * @param {object} json - notification data (mutated in place)
 * @returns {object} the same json reference
 */
export function sanitizeNotificationJson(
    json: NotificationRecord
): NotificationRecord {
    for (const key in json) {
        if (json[key] === null || typeof json[key] === 'undefined') {
            delete json[key];
        }
    }
    if (json['message']) {
        json['message'] = replaceBioSymbols(String(json['message']));
    }
    if (json['title']) {
        json['title'] = replaceBioSymbols(String(json['title']));
    }
    return json;
}

/**
 * Parse a notification's details field from string to object if needed.
 * @param {*} details - raw details value
 * @returns {object} parsed details object
 */
export function parseNotificationDetails(details: unknown): NotificationRecord {
    if (details === Object(details)) {
        return details as NotificationRecord;
    }
    if (details !== '{}' && typeof details === 'string') {
        try {
            const object = JSON.parse(details);
            if (object && typeof object === 'object') {
                return object as NotificationRecord;
            }
        } catch {}
    }
    return {};
}

/**
 * Build a default V1 notification ref from JSON data.
 * Does NOT perform cache lookup — caller is responsible for
 * checking existing refs and merging.
 * @param {object} json - sanitized notification JSON
 * @returns {object} default notification ref
 */
export function createDefaultNotificationRef(
    json: NotificationRecord
): NotificationV1Ref {
    const ref: any = {
        id: '',
        senderUserId: '',
        senderUsername: '',
        type: '',
        message: '',
        details: {},
        seen: false,
        created_at: '',
        // VRCX
        $isExpired: false,
        //
        ...json
    };
    ref.details = parseNotificationDetails(ref.details);
    return ref;
}

/**
 * Build a default V2 notification ref from JSON data.
 * Handles boop legacy formatting.
 * @param {object} json - sanitized notification JSON
 * @param {string} endpointDomain - API endpoint domain for emoji URLs
 * @returns {object} default notification V2 ref
 */
export function createDefaultNotificationV2Ref(
    json: NotificationRecord
): NotificationV2Ref {
    return {
        id: '',
        createdAt: '',
        updatedAt: '',
        expiresAt: '',
        type: '',
        link: '',
        linkText: '',
        message: '',
        title: '',
        imageUrl: '',
        seen: false,
        senderUserId: '',
        senderUsername: '',
        data: {},
        responses: [],
        details: {},
        version: 2,
        ...json
    };
}

/**
 * Apply legacy boop formatting to a V2 notification ref.
 * Mutates the ref in place.
 * @param {object} ref - notification V2 ref
 * @param {string} endpointDomain - API endpoint domain for emoji URLs
 */
export function applyBoopLegacyHandling(
    ref: NotificationV2Ref,
    endpointDomain: string
): void {
    if (ref.type !== 'boop' || !ref.title) {
        return;
    }
    ref.message = ref.title;
    ref.title = '';
    const emojiId = ref.details.emojiId;
    if (typeof emojiId === 'string' && emojiId.startsWith('default_')) {
        ref.imageUrl = emojiId;
        ref.message += ` ${emojiId.replace('default_', '')}`;
    } else {
        ref.imageUrl = `${endpointDomain}/file/${String(emojiId)}/${ref.details.emojiVersion}`;
    }
}
