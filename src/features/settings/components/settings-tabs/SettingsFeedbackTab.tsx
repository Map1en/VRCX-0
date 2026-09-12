import { CheckCircle2Icon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { openExternalLink } from '@/services/entityMediaService';
import { submitTelemetryFeedback } from '@/services/telemetry/telemetryEvent';
import { toast } from '@/services/toastService';
import { links } from '@/shared/constants/link';
import {
    feedbackCooldownRemainingMs,
    useFeedbackDraftStore
} from '@/state/feedbackDraftStore';
import { Button } from '@/ui/shadcn/button';
import { Textarea } from '@/ui/shadcn/textarea';

import { SettingsCard } from '../SettingsCard';
import { SettingsTabContent } from '../SettingsViewParts';

const MAX_FEEDBACK_LENGTH = 2000;
const COUNTER_VISIBLE_LENGTH = Math.round(MAX_FEEDBACK_LENGTH * 0.8);

const COMPOSER_CLASS =
    '[&>[data-slot=card]]:transition-[box-shadow] [&>[data-slot=card]]:duration-150 [&:has(textarea:focus-visible)>[data-slot=card]]:ring-ring/50 [&:has(textarea:focus-visible)>[data-slot=card]]:ring-3';
const STATUS_ANIMATION =
    'animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:animate-none';

export function SettingsFeedbackTab() {
    const { t } = useTranslation();
    const draft = useFeedbackDraftStore((state) => state.draft);
    const submitting = useFeedbackDraftStore((state) => state.submitting);
    const thanksVisible = useFeedbackDraftStore((state) => state.thanksVisible);
    const submittedAt = useFeedbackDraftStore((state) => state.submittedAt);
    const setDraft = useFeedbackDraftStore((state) => state.setDraft);
    const setSubmitting = useFeedbackDraftStore((state) => state.setSubmitting);
    const markSubmitted = useFeedbackDraftStore((state) => state.markSubmitted);
    const [now, setNow] = useState(() => Date.now());

    const cooldownRemaining = feedbackCooldownRemainingMs(submittedAt, now);

    useEffect(() => {
        if (feedbackCooldownRemainingMs(submittedAt, Date.now()) === 0) {
            return;
        }
        const timer = window.setInterval(() => {
            const tick = Date.now();
            setNow(tick);
            if (feedbackCooldownRemainingMs(submittedAt, tick) === 0) {
                window.clearInterval(timer);
            }
        }, 1000);
        return () => window.clearInterval(timer);
    }, [submittedAt]);

    const canSubmit =
        !submitting && cooldownRemaining === 0 && draft.trim().length > 0;

    async function submit() {
        if (!canSubmit) {
            return;
        }
        setSubmitting(true);
        try {
            await submitTelemetryFeedback(draft);
            markSubmitted(Date.now());
            setNow(Date.now());
        } catch {
            toast.add({
                type: 'error',
                title: t('view.settings.feedback.error_generic')
            });
        } finally {
            setSubmitting(false);
        }
    }

    function renderStatus(): ReactNode {
        if (thanksVisible) {
            return (
                <div
                    className={`flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400 ${STATUS_ANIMATION}`}
                >
                    <CheckCircle2Icon className="size-4" data-icon />
                    {t('view.settings.feedback.thanks')}
                </div>
            );
        }
        if (cooldownRemaining > 0) {
            return (
                <span
                    className={`text-muted-foreground text-xs tabular-nums ${STATUS_ANIMATION}`}
                >
                    {t('view.settings.feedback.cooldown', {
                        seconds: Math.ceil(cooldownRemaining / 1000)
                    })}
                </span>
            );
        }
        if (draft.length >= COUNTER_VISIBLE_LENGTH) {
            return (
                <span className="text-muted-foreground text-xs tabular-nums">
                    {draft.length}/{MAX_FEEDBACK_LENGTH}
                </span>
            );
        }
        return null;
    }

    return (
        <SettingsTabContent value="feedback">
            <div className="flex max-w-2xl shrink-0 flex-col gap-2">
                <SettingsCard
                    cardId="feedback.message"
                    className={COMPOSER_CLASS}
                    title={t('view.settings.feedback.title')}
                    description={
                        <>
                            {t('view.settings.feedback.description')}
                            <span className="text-muted-foreground/70 mt-0.5 block text-xs">
                                {t('view.settings.feedback.privacy_note')}
                            </span>
                        </>
                    }
                    bodyClassName="flex flex-col gap-2"
                >
                    <Textarea
                        value={draft}
                        maxLength={MAX_FEEDBACK_LENGTH}
                        disabled={submitting}
                        placeholder={t('view.settings.feedback.placeholder')}
                        className="min-h-32 resize-y rounded-none border-0 bg-transparent p-0 focus-visible:ring-0 disabled:bg-transparent dark:bg-transparent dark:disabled:bg-transparent"
                        onChange={(event) => setDraft(event.target.value)}
                    />
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">{renderStatus()}</div>
                        <Button
                            type="button"
                            size="sm"
                            disabled={!canSubmit}
                            onClick={() => void submit()}
                        >
                            {submitting
                                ? t('view.settings.feedback.submitting')
                                : t('view.settings.feedback.submit')}
                        </Button>
                    </div>
                </SettingsCard>
                <p className="text-muted-foreground px-1 text-xs">
                    {t('view.settings.feedback.reply_note')}
                    <br />
                    {t('view.settings.feedback.more_help')}{' '}
                    <button
                        type="button"
                        className="hover:text-foreground underline underline-offset-2 transition-colors"
                        onClick={() => void openExternalLink(links.issues)}
                    >
                        GitHub Issues
                    </button>
                    {' · '}
                    <button
                        type="button"
                        className="hover:text-foreground underline underline-offset-2 transition-colors"
                        onClick={() => void openExternalLink(links.discord)}
                    >
                        Discord
                    </button>
                    {' · '}
                    <button
                        type="button"
                        className="hover:text-foreground underline underline-offset-2 transition-colors"
                        onClick={() => void openExternalLink(links.qqGroup)}
                    >
                        {t('nav_menu.qq_group')}
                    </button>
                </p>
            </div>
        </SettingsTabContent>
    );
}
