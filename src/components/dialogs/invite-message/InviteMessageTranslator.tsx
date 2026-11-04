import { LanguagesIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TranslationLanguageSelect } from '@/components/translation/TranslationLanguageSelect';
import { cn } from '@/lib/utils';
import { languageCodes } from '@/localization/index';
import { commands, type TranslationProvider } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import { toast } from '@/services/toastService';
import { getTranslationConfig } from '@/services/translationService';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

const TARGET_CONFIG_KEY = 'inviteMessageTranslateTarget';
const DEFAULT_TARGET = 'en';
const SHORTEN_PROMPT =
    'You are a translation assistant for VRChat invite messages. Translate the user message into {targetLang} in at most {maxChars} characters, shortening the wording while keeping the meaning. Only return the translated text.';

type Translation = {
    source: string;
    target: string;
    text: string;
    provider: TranslationProvider;
};

export function InviteMessageTranslator({
    source,
    maxLength,
    disabled,
    onApply
}: {
    source: string;
    maxLength: number;
    disabled: boolean;
    onApply(text: string): void;
}) {
    const { t } = useTranslation();
    const [enabled, setEnabled] = useState(false);
    const [target, setTarget] = useState(DEFAULT_TARGET);
    const [translation, setTranslation] = useState<Translation | null>(null);
    const [busy, setBusy] = useState<'translate' | 'shorten' | null>(null);

    useEffect(() => {
        let active = true;
        void Promise.all([
            getTranslationConfig(),
            configRepository.getString(TARGET_CONFIG_KEY, DEFAULT_TARGET)
        ]).then(([config, storedTarget]) => {
            if (active) {
                setEnabled(config.enabled);
                setTarget(
                    languageCodes.includes(storedTarget)
                        ? storedTarget
                        : DEFAULT_TARGET
                );
            }
        });
        return () => {
            active = false;
        };
    }, []);

    if (!enabled) {
        return null;
    }

    const trimmed = source.trim();
    const current =
        translation?.source === trimmed && translation.target === target
            ? translation
            : null;
    const tooLong = current !== null && current.text.length > maxLength;

    function changeTarget(next: string) {
        setTarget(next);
        void configRepository.setString(TARGET_CONFIG_KEY, next);
    }

    async function run(mode: 'translate' | 'shorten') {
        setBusy(mode);
        try {
            const result = await commands.appTranslationTranslate({
                text: trimmed,
                targetLanguage: target,
                overrides:
                    mode === 'shorten'
                        ? {
                              enabled: null,
                              apiType: null,
                              key: null,
                              endpointId: null,
                              model: null,
                              prompt: SHORTEN_PROMPT.replace(
                                  '{maxChars}',
                                  String(maxLength)
                              ),
                              reasoningEffort: null
                          }
                        : null
            });
            setTranslation({
                source: trimmed,
                target,
                text: result.text.trim(),
                provider: result.provider
            });
        } catch {
            toast.add({
                type: 'error',
                title: t('dialog.invite_message.translate.failed')
            });
        } finally {
            setBusy(null);
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <LanguagesIcon className="text-muted-foreground size-4" />
                <span className="text-muted-foreground text-xs whitespace-nowrap">
                    {t('dialog.invite_message.translate.to')}
                </span>
                <TranslationLanguageSelect
                    value={target}
                    label={t('dialog.invite_message.translate.to')}
                    className="h-7 w-36"
                    onChange={changeTarget}
                />
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7"
                    disabled={disabled || busy !== null || !trimmed}
                    onClick={() => void run('translate')}
                >
                    {busy === 'translate' ? (
                        <Spinner data-icon="inline-start" />
                    ) : null}
                    {t('dialog.invite_message.translate.translate')}
                </Button>
            </div>
            {current ? (
                <div className="bg-background/60 flex flex-col gap-2 rounded-md border p-2.5">
                    <div className="text-muted-foreground flex items-center gap-2 text-xs">
                        <span className="flex-1">
                            {t('dialog.invite_message.translate.result')}
                        </span>
                        <span
                            className={cn(
                                'tabular-nums',
                                tooLong && 'text-destructive'
                            )}
                        >
                            {current.text.length}/{maxLength}
                        </span>
                    </div>
                    <p className="text-sm break-words whitespace-pre-wrap">
                        {current.text}
                    </p>
                    {tooLong ? (
                        <p className="text-destructive text-xs">
                            {t('dialog.invite_message.translate.too_long', {
                                max: maxLength
                            })}
                            {current.provider === 'openai'
                                ? ''
                                : ` ${t('dialog.invite_message.translate.shorten_needs_llm')}`}
                        </p>
                    ) : null}
                    <div className="flex items-center justify-end gap-2">
                        {tooLong && current.provider === 'openai' ? (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={disabled || busy !== null}
                                onClick={() => void run('shorten')}
                            >
                                {busy === 'shorten' ? (
                                    <Spinner data-icon="inline-start" />
                                ) : null}
                                {t('dialog.invite_message.translate.shorten')}
                            </Button>
                        ) : null}
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={disabled}
                            onClick={() => setTranslation(null)}
                        >
                            {t('common.actions.cancel')}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            disabled={disabled || busy !== null || tooLong}
                            onClick={() => {
                                onApply(current.text);
                                setTranslation(null);
                            }}
                        >
                            {t('dialog.invite_message.translate.use')}
                        </Button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
