import { ShieldQuestionMarkIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { UIApproval } from '@/domain/assistant/types';
import { Button } from '@/ui/shadcn/button';
import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemFooter,
    ItemMedia,
    ItemTitle
} from '@/ui/shadcn/item';

import { answerApproval } from '../assistantActions';

interface AssistantApprovalCardProps {
    tool: string;
    approval: UIApproval;
}

export function AssistantApprovalCard({
    tool,
    approval
}: AssistantApprovalCardProps) {
    const { t } = useTranslation();
    const action = t(`assistant.tools.${tool}`, { defaultValue: tool });

    const answer = (approved: boolean) => {
        void answerApproval(approval.sessionId, approval.id, approved).catch(
            (error) => {
                console.warn('[assistant] failed to answer approval', error);
            }
        );
    };

    return (
        <Item variant="outline" size="sm" role="group" aria-label={action}>
            <ItemMedia variant="icon">
                <ShieldQuestionMarkIcon />
            </ItemMedia>
            <ItemContent>
                <ItemTitle>
                    {t('assistant.approval.title', { action })}
                </ItemTitle>
                <ItemDescription>
                    {t('assistant.approval.description')}
                </ItemDescription>
            </ItemContent>
            <ItemActions>
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => answer(false)}
                >
                    {t('assistant.approval.deny')}
                </Button>
                <Button size="sm" onClick={() => answer(true)}>
                    {t('assistant.approval.approve')}
                </Button>
            </ItemActions>
            {approval.fields.length > 0 && (
                <ItemFooter>
                    <dl className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                        {approval.fields.map((field) => (
                            <div key={field.name} className="contents">
                                <dt className="text-muted-foreground">
                                    {t(
                                        `assistant.approval.fields.${field.name}`,
                                        {
                                            defaultValue: field.name
                                        }
                                    )}
                                </dt>
                                <dd className="max-h-40 overflow-auto font-mono break-words whitespace-pre-wrap">
                                    {field.value}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </ItemFooter>
            )}
        </Item>
    );
}
