import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { UIUserChoice } from '@/domain/assistant/types';
import { formatDateFilter } from '@/lib/dateTime';
import {
    Questionnaire,
    QuestionnaireActions,
    QuestionnaireChoice,
    QuestionnaireChoiceDescription,
    QuestionnaireChoices,
    QuestionnaireDescription,
    QuestionnaireError,
    QuestionnaireItem,
    QuestionnaireSkip,
    QuestionnaireSubmit,
    QuestionnaireTitle
} from '@/ui/shadcn/questionnaire';

import { answerChoice } from '../assistantActions';

interface AssistantChoiceCardProps {
    choice: UIUserChoice;
    active: boolean;
}

export function AssistantChoiceCard({
    choice,
    active
}: AssistantChoiceCardProps) {
    const { t } = useTranslation();

    if (choice.status !== 'pending' || !active) {
        const picked = choice.candidates.find(
            (candidate) => candidate.userId === choice.pickedUserId
        );
        return (
            <p className="text-muted-foreground text-xs">
                {picked
                    ? t('assistant.choice.picked', {
                          name: picked.displayName
                      })
                    : t('assistant.choice.skipped', { query: choice.query })}
            </p>
        );
    }

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const userId = new FormData(event.currentTarget).get('userId');
        void answerChoice(
            choice.sessionId,
            choice.id,
            typeof userId === 'string' ? userId : null
        ).catch((error) => {
            console.warn('[assistant] failed to answer choice', error);
        });
    };

    return (
        <Questionnaire
            onSubmit={handleSubmit}
            className="bg-card rounded-xl border p-4"
        >
            <QuestionnaireItem name="userId">
                <QuestionnaireTitle>
                    {t('assistant.choice.title', { query: choice.query })}
                </QuestionnaireTitle>
                <QuestionnaireDescription>
                    {t('assistant.choice.description')}
                </QuestionnaireDescription>
                <QuestionnaireChoices>
                    {choice.candidates.map((candidate) => (
                        <QuestionnaireChoice
                            key={candidate.userId}
                            value={candidate.userId}
                        >
                            <span className="font-medium">
                                {candidate.displayName}
                            </span>
                            <QuestionnaireChoiceDescription>
                                {[
                                    candidate.isFriend &&
                                        t('assistant.choice.friend'),
                                    t('assistant.choice.encounters', {
                                        count: candidate.encounterCount
                                    }),
                                    candidate.lastSeen &&
                                        t('assistant.choice.last_seen', {
                                            date: formatDateFilter(
                                                candidate.lastSeen,
                                                'date'
                                            )
                                        })
                                ]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </QuestionnaireChoiceDescription>
                        </QuestionnaireChoice>
                    ))}
                </QuestionnaireChoices>
                <QuestionnaireError>
                    {t('assistant.choice.required')}
                </QuestionnaireError>
            </QuestionnaireItem>
            <QuestionnaireActions>
                <QuestionnaireSkip size="sm">
                    {t('assistant.choice.skip')}
                </QuestionnaireSkip>
                <QuestionnaireSubmit size="sm">
                    {t('assistant.choice.confirm')}
                </QuestionnaireSubmit>
            </QuestionnaireActions>
        </Questionnaire>
    );
}
