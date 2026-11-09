import {
    BookmarkPlusIcon,
    LanguagesIcon,
    Settings2Icon,
    XIcon
} from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { TranslationLanguageSelect } from '@/components/translation/TranslationLanguageSelect';
import { cn } from '@/lib/utils';
import { languageCodes } from '@/localization/index';
import {
    commands,
    type ChatboxPauseReason,
    type TranslationProvider
} from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import { toast } from '@/services/toastService';
import { getTranslationConfig } from '@/services/translationService';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Spinner } from '@/ui/shadcn/spinner';
import { Switch } from '@/ui/shadcn/switch';
import { Textarea } from '@/ui/shadcn/textarea';

import { chatboxCharCount, type ChatboxConfigUpdate } from '../chatboxConfig';

const TARGET_CONFIG_KEY = 'chatboxTranslateTarget';
const HISTORY_LIMIT = 20;
const TRANSLATION_SETTINGS_PATH =
    '/settings?tab=integrations&setting=integrations.translation.enabled';
const TRANSLATE_ON_CONFIG_KEY = 'chatboxTranslateEnabled';
const DEFAULT_TARGET = 'en';
const SHORTEN_PROMPT =
    'You are a translation assistant for a VRChat chatbox. Translate the user message into {targetLang} in at most {maxChars} characters, shortening the wording while keeping the meaning. Only return the translated text.';

type Translation = {
    source: string;
    text: string;
    provider: TranslationProvider;
};

const PAUSE_HINT_KEYS: Record<ChatboxPauseReason, string> = {
    gameNotRunning: 'view.tools.chatbox.composer.game_not_running',
    isolated: 'view.tools.chatbox.composer.isolated'
};

export function ChatboxComposer({
    maxChars,
    maxQuickPhrases,
    quickPhrases,
    pauseReason,
    onUpdate
}: {
    maxChars: number;
    maxQuickPhrases: number;
    quickPhrases: string[];
    pauseReason: ChatboxPauseReason | null;
    onUpdate(update: ChatboxConfigUpdate): void;
}) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [text, setText] = useState('');
    const typing = useRef(false);
    const history = useRef<string[]>([]);
    const historyIndex = useRef<number | null>(null);
    const [target, setTarget] = useState(DEFAULT_TARGET);
    const [translateOn, setTranslateOn] = useState(false);
    const [translationEnabled, setTranslationEnabled] = useState(false);
    const [translation, setTranslation] = useState<Translation | null>(null);
    const [busy, setBusy] = useState<'translate' | 'shorten' | 'send' | null>(
        null
    );

    useEffect(() => {
        let active = true;
        void Promise.all([
            getTranslationConfig(),
            configRepository.getString(TARGET_CONFIG_KEY, DEFAULT_TARGET),
            configRepository.getBool(TRANSLATE_ON_CONFIG_KEY, false)
        ]).then(([translationConfig, storedTarget, storedOn]) => {
            if (!active) {
                return;
            }
            setTranslationEnabled(translationConfig.enabled);
            setTarget(
                languageCodes.includes(storedTarget)
                    ? storedTarget
                    : DEFAULT_TARGET
            );
            setTranslateOn(storedOn);
        });
        return () => {
            active = false;
        };
    }, []);

    useEffect(
        () => () => {
            if (typing.current) {
                void commands.appChatboxTypingSet(false);
            }
        },
        []
    );

    const translating = translationEnabled && translateOn;
    const trimmedText = text.trim();
    const canSavePhrase =
        trimmedText !== '' &&
        chatboxCharCount(trimmedText) <= maxChars &&
        quickPhrases.length < maxQuickPhrases &&
        !quickPhrases.includes(trimmedText);

    function setTyping(next: boolean) {
        if (typing.current !== next) {
            typing.current = next;
            void commands.appChatboxTypingSet(next);
        }
    }

    function changeText(next: string) {
        setText(next);
        setTyping(next.trim() !== '');
        if (translation) {
            setTranslation(null);
        }
    }

    function recallHistory(direction: -1 | 1) {
        const entries = history.current;
        if (!entries.length) {
            return false;
        }
        const current = historyIndex.current ?? entries.length;
        const next = Math.min(Math.max(current + direction, 0), entries.length);
        historyIndex.current = next === entries.length ? null : next;
        changeText(entries[next] ?? '');
        return true;
    }

    function savePhrase() {
        const phrase = text.trim();
        onUpdate((current) => ({
            ...current,
            messages: {
                ...current.messages,
                quickPhrases: [...current.messages.quickPhrases, phrase]
            }
        }));
    }

    function removePhrase(index: number) {
        onUpdate((current) => ({
            ...current,
            messages: {
                ...current.messages,
                quickPhrases: current.messages.quickPhrases.filter(
                    (_, candidate) => candidate !== index
                )
            }
        }));
    }
    const translationTooLong =
        translation !== null && chatboxCharCount(translation.text) > maxChars;

    function openTranslationSettings() {
        navigate(TRANSLATION_SETTINGS_PATH);
    }

    function showTranslationFailed() {
        toast.add({
            type: 'error',
            title: t('view.tools.chatbox.composer.translation_failed')
        });
    }

    function changeTarget(next: string) {
        setTarget(next);
        setTranslation(null);
        void configRepository.setString(TARGET_CONFIG_KEY, next);
    }

    function changeTranslateOn(next: boolean) {
        setTranslateOn(next);
        setTranslation(null);
        void configRepository.setBool(TRANSLATE_ON_CONFIG_KEY, next);
    }

    async function send(message: string, source = message) {
        setBusy('send');
        try {
            const outcome = await commands.appChatboxSend(message);
            if (outcome.result === 'sent') {
                history.current = [
                    ...history.current.filter((entry) => entry !== source),
                    source
                ].slice(-HISTORY_LIMIT);
                historyIndex.current = null;
                setText('');
                setTranslation(null);
                setTyping(false);
            } else if (outcome.result === 'paused') {
                toast.add({
                    type: 'error',
                    title: t(PAUSE_HINT_KEYS[outcome.reason])
                });
            }
        } catch {
            toast.add({
                type: 'error',
                title: t('view.tools.chatbox.composer.send_failed')
            });
        } finally {
            setBusy(null);
        }
    }

    async function translate() {
        const source = text.trim();
        if (!source) {
            return;
        }
        setBusy('translate');
        try {
            const result = await commands.appTranslationTranslate({
                text: source,
                targetLanguage: target,
                overrides: null
            });
            setTranslation({
                source,
                text: result.text,
                provider: result.provider
            });
        } catch {
            showTranslationFailed();
        } finally {
            setBusy(null);
        }
    }

    async function shorten() {
        if (!translation) {
            return;
        }
        setBusy('shorten');
        try {
            const result = await commands.appTranslationTranslate({
                text: translation.source,
                targetLanguage: target,
                overrides: {
                    enabled: null,
                    apiType: null,
                    key: null,
                    endpointId: null,
                    model: null,
                    prompt: SHORTEN_PROMPT.replace(
                        '{maxChars}',
                        String(maxChars)
                    ),
                    reasoningEffort: null
                }
            });
            setTranslation({ ...translation, text: result.text });
        } catch {
            showTranslationFailed();
        } finally {
            setBusy(null);
        }
    }

    function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
        if (event.nativeEvent.isComposing) {
            return;
        }
        const element = event.currentTarget;
        const atStart =
            element.selectionStart === 0 && element.selectionEnd === 0;
        const atEnd = element.selectionStart === element.value.length;
        if (
            (event.key === 'ArrowUp' && atStart && recallHistory(-1)) ||
            (event.key === 'ArrowDown' &&
                atEnd &&
                historyIndex.current !== null &&
                recallHistory(1))
        ) {
            event.preventDefault();
            return;
        }
        if (event.key !== 'Enter' || event.shiftKey) {
            return;
        }
        event.preventDefault();
        if (busy) {
            return;
        }
        if (translating) {
            void translate();
        } else if (text.trim()) {
            void send(text);
        }
    }

    return (
        <Card size="sm">
            <CardHeader className="flex flex-row items-center gap-2">
                <CardTitle className="flex-1">
                    {t('view.tools.chatbox.composer.title')}
                </CardTitle>
                {translationEnabled ? (
                    <>
                        <label className="flex items-center gap-2 text-sm whitespace-nowrap">
                            <LanguagesIcon className="text-muted-foreground size-4" />
                            {t('view.tools.chatbox.composer.translate_to')}
                            <Switch
                                checked={translateOn}
                                onCheckedChange={changeTranslateOn}
                            />
                        </label>
                        <TranslationLanguageSelect
                            value={target}
                            label={t('view.tools.chatbox.composer.translation')}
                            className="w-40"
                            onChange={changeTarget}
                        />
                    </>
                ) : null}
                {translationEnabled ? (
                    <HintTooltip
                        label={t(
                            'view.tools.chatbox.composer.translation_settings'
                        )}
                    >
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={openTranslationSettings}
                        >
                            <Settings2Icon />
                        </Button>
                    </HintTooltip>
                ) : (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={openTranslationSettings}
                    >
                        <LanguagesIcon />
                        {t('view.tools.chatbox.composer.set_up_translation')}
                    </Button>
                )}
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-2">
                <Textarea
                    value={text}
                    rows={2}
                    maxLength={translating ? undefined : maxChars}
                    placeholder={t('view.tools.chatbox.composer.placeholder')}
                    className="flex-1 resize-none"
                    onChange={(event) => changeText(event.target.value)}
                    onKeyDown={handleKeyDown}
                />
                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                    <span className="flex-1">
                        {pauseReason
                            ? t(PAUSE_HINT_KEYS[pauseReason])
                            : t(
                                  translating
                                      ? 'view.tools.chatbox.composer.hint_translate'
                                      : 'view.tools.chatbox.composer.hint_direct'
                              )}
                    </span>
                    {translating ? null : (
                        <span>
                            {chatboxCharCount(text)} / {maxChars}
                        </span>
                    )}
                </div>
                {quickPhrases.length || canSavePhrase ? (
                    <div className="flex flex-wrap items-center gap-1">
                        {quickPhrases.map((phrase, index) => (
                            <span
                                key={phrase}
                                className="group/phrase bg-muted/60 hover:bg-muted flex max-w-full items-center rounded-md text-xs"
                            >
                                <button
                                    type="button"
                                    className="truncate px-2 py-1"
                                    title={t(
                                        'view.tools.chatbox.composer.send_phrase'
                                    )}
                                    onClick={() => void send(phrase)}
                                >
                                    {phrase}
                                </button>
                                <HintTooltip
                                    label={t(
                                        'view.tools.chatbox.composer.remove_phrase'
                                    )}
                                >
                                    <button
                                        type="button"
                                        className="text-muted-foreground hover:text-foreground pr-1.5 opacity-0 group-hover/phrase:opacity-100 focus-visible:opacity-100"
                                        onClick={() => removePhrase(index)}
                                    >
                                        <XIcon className="size-3" />
                                    </button>
                                </HintTooltip>
                            </span>
                        ))}
                        {canSavePhrase ? (
                            <Button
                                variant="ghost"
                                size="xs"
                                onClick={savePhrase}
                            >
                                <BookmarkPlusIcon />
                                {t('view.tools.chatbox.composer.save_phrase')}
                            </Button>
                        ) : null}
                    </div>
                ) : null}
                {busy === 'translate' ? (
                    <div className="text-muted-foreground flex items-center gap-2 text-sm">
                        <Spinner />
                        {t('view.tools.chatbox.composer.translating')}
                    </div>
                ) : null}
                {translation ? (
                    <div className="bg-muted/50 flex flex-col gap-2 rounded-md p-3">
                        <div className="text-muted-foreground flex items-center gap-2 text-xs">
                            <span className="flex-1">
                                {t('view.tools.chatbox.composer.translated')}
                            </span>
                            <span
                                className={cn(
                                    translationTooLong && 'text-destructive'
                                )}
                            >
                                {chatboxCharCount(translation.text)} /{' '}
                                {maxChars}
                            </span>
                        </div>
                        <p className="text-sm break-words whitespace-pre-line">
                            {translation.text}
                        </p>
                        {translationTooLong ? (
                            <p className="text-destructive text-xs">
                                {t('view.tools.chatbox.composer.too_long', {
                                    max: maxChars
                                })}
                                {translation.provider === 'openai'
                                    ? ''
                                    : ` ${t('view.tools.chatbox.composer.shorten_needs_llm')}`}
                            </p>
                        ) : null}
                        <div className="flex items-center justify-end gap-2">
                            {translationTooLong &&
                            translation.provider === 'openai' ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={busy !== null}
                                    onClick={() => void shorten()}
                                >
                                    {busy === 'shorten' ? <Spinner /> : null}
                                    {t('view.tools.chatbox.composer.shorten')}
                                </Button>
                            ) : null}
                            {translationTooLong &&
                            translation.provider !== 'openai' ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={openTranslationSettings}
                                >
                                    {t(
                                        'view.tools.chatbox.composer.translation_settings'
                                    )}
                                </Button>
                            ) : null}
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setTranslation(null)}
                            >
                                {t('view.tools.chatbox.composer.cancel')}
                            </Button>
                            <Button
                                size="sm"
                                disabled={busy !== null}
                                onClick={() =>
                                    void send(
                                        translation.text,
                                        translation.source
                                    )
                                }
                            >
                                {busy === 'send' ? <Spinner /> : null}
                                {t('view.tools.chatbox.composer.send')}
                            </Button>
                        </div>
                    </div>
                ) : null}
            </CardContent>
        </Card>
    );
}
