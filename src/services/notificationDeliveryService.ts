import configRepository from '@/repositories/configRepository';
import memoPersistenceRepository from '@/repositories/memoPersistenceRepository';
import { onPreferenceChanged } from '@/shared/events/preferenceEvents';

const DEFAULT_TTS_PREFERENCES = Object.freeze({
    notificationTTSVoice: '0',
    notificationTTSNickName: false
});

type TtsPreferenceKey = keyof typeof DEFAULT_TTS_PREFERENCES;

interface NotificationTtsDirective {
    sourceId?: string;
    activityType?: string;
    desktop?: boolean;
    vr?: boolean;
    title?: string;
    body?: string;
    text?: string;
    imageUrl?: string;
    actorUserId?: string;
}

let cachedPreferences: Record<TtsPreferenceKey, string | boolean> = {
    ...DEFAULT_TTS_PREFERENCES
};
let preferencesLoaded = false;
let preferencesLoadPromise: Promise<typeof cachedPreferences> | null = null;
let unsubscribePreferences: (() => void) | null = null;

function normalizeInteger(
    value: any,
    fallback: any,
    min: any = Number.MIN_SAFE_INTEGER,
    max: any = Number.MAX_SAFE_INTEGER
) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

function normalizeTtsPreference(key: TtsPreferenceKey, value: unknown) {
    if (key === 'notificationTTSNickName') {
        return Boolean(value);
    }
    return typeof value === 'string'
        ? value
        : String(value ?? DEFAULT_TTS_PREFERENCES[key] ?? '');
}

function initTtsPreferenceSubscription() {
    if (unsubscribePreferences) {
        return;
    }
    unsubscribePreferences = onPreferenceChanged(
        Object.keys(DEFAULT_TTS_PREFERENCES),
        (value: any, detail: any) => {
            const key = detail.normalizedKey as TtsPreferenceKey;
            if (
                !Object.prototype.hasOwnProperty.call(
                    DEFAULT_TTS_PREFERENCES,
                    key
                )
            ) {
                return;
            }
            cachedPreferences = {
                ...cachedPreferences,
                [key]: normalizeTtsPreference(key, value)
            };
        }
    );
}

async function loadTtsPreferences() {
    initTtsPreferenceSubscription();
    if (preferencesLoaded) {
        return cachedPreferences;
    }
    if (!preferencesLoadPromise) {
        preferencesLoadPromise = Promise.all([
            configRepository.getString(
                'notificationTTSVoice',
                DEFAULT_TTS_PREFERENCES.notificationTTSVoice
            ),
            configRepository.getBool(
                'notificationTTSNickName',
                DEFAULT_TTS_PREFERENCES.notificationTTSNickName
            )
        ])
            .then(([notificationTTSVoice, notificationTTSNickName]: any) => {
                cachedPreferences = {
                    notificationTTSVoice,
                    notificationTTSNickName
                };
                preferencesLoaded = true;
                preferencesLoadPromise = null;
                return cachedPreferences;
            })
            .catch(() => {
                cachedPreferences = { ...DEFAULT_TTS_PREFERENCES };
                preferencesLoaded = true;
                preferencesLoadPromise = null;
                return cachedPreferences;
            });
    }
    return preferencesLoadPromise;
}

function speakNotification(text: any, preferences: any) {
    if (
        !text ||
        typeof window === 'undefined' ||
        !window.speechSynthesis ||
        !window.SpeechSynthesisUtterance
    ) {
        return;
    }
    const voices = window.speechSynthesis.getVoices();
    const utterance = new window.SpeechSynthesisUtterance();
    const voiceIndex = normalizeInteger(
        preferences.notificationTTSVoice,
        0,
        0,
        Math.max(0, voices.length - 1)
    );
    if (voices[voiceIndex]) {
        utterance.voice = voices[voiceIndex];
    }
    utterance.text = text;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
}

async function resolveTtsText(
    directive: NotificationTtsDirective,
    overlayText: string,
    title: string,
    preferences: any
) {
    if (
        !preferences.notificationTTSNickName ||
        !directive.actorUserId ||
        !title.trim()
    ) {
        return overlayText;
    }
    const memo = await memoPersistenceRepository
        .getUserMemo(directive.actorUserId)
        .catch((): null => null);
    const nickName =
        typeof memo?.memo === 'string' ? memo.memo.split('\n')[0]?.trim() : '';
    if (!nickName) {
        return overlayText;
    }
    return overlayText.split(title).join(nickName);
}

export async function executeNotificationTts(
    directive: NotificationTtsDirective
) {
    if (!directive) {
        return;
    }
    const preferences: any = await loadTtsPreferences();
    const title = String(directive.title ?? '');
    const body = String(directive.body ?? '');
    const overlayText =
        String(directive.text ?? '') || [title, body].filter(Boolean).join(' ');
    speakNotification(
        await resolveTtsText(directive, overlayText, title, preferences),
        preferences
    );
}
