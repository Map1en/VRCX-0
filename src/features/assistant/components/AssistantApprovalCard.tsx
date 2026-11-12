import { ShieldQuestionMarkIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import type {
    AssistantFavoriteGroup,
    AssistantFavoriteMoveItem,
    AssistantFavoriteMovePreview,
    UIApproval
} from '@/domain/assistant/types';
import { cn } from '@/lib/utils';
import { useAssistantChatStore } from '@/state/assistantChatStore';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';
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

const FAVORITE_PAGE_BY_KIND: Record<string, string> = {
    world: '/favorites/worlds',
    friend: '/favorites/friends',
    avatar: '/favorites/avatars'
};

function FavoriteBackupNotice({ kind }: { kind: string | undefined }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const page = kind ? FAVORITE_PAGE_BY_KIND[kind] : undefined;

    const openBackup = () => {
        useAssistantChatStore.getState().setOpen(false);
        navigate(`${page}?export=1`);
    };

    return (
        <Alert>
            <TriangleAlertIcon />
            <AlertDescription className="flex flex-col items-start gap-1.5 text-xs">
                {t('assistant.approval.backup_hint')}
                {page && (
                    <Button size="xs" variant="outline" onClick={openBackup}>
                        {t('assistant.approval.backup_open')}
                    </Button>
                )}
            </AlertDescription>
        </Alert>
    );
}

function groupLabel(group: AssistantFavoriteGroup) {
    return group.displayName || group.name;
}

function FavoriteMoveItemNote({ item }: { item: AssistantFavoriteMoveItem }) {
    const { t } = useTranslation();
    if (item.status === 'alreadyInTarget') {
        return t('assistant.approval.favorite_move.already_in_target');
    }
    if (item.status === 'notFavorited') {
        return t('assistant.approval.favorite_move.not_favorited');
    }
    return item.source
        ? t('assistant.approval.favorite_move.source', {
              group: groupLabel(item.source)
          })
        : null;
}

function FavoriteMovePreviewList({
    preview,
    moving
}: {
    preview: AssistantFavoriteMovePreview;
    moving: number;
}) {
    const { t } = useTranslation();
    return (
        <div className="flex w-full flex-col gap-1.5 text-xs">
            <p className="font-medium">
                {t('assistant.approval.favorite_move.summary', {
                    target: groupLabel(preview.target),
                    count: moving
                })}
            </p>
            <ul className="flex max-h-56 flex-col gap-1 overflow-auto">
                {preview.items.map((item) => (
                    <li
                        key={item.entityId}
                        className={cn(
                            'flex items-baseline justify-between gap-3',
                            item.status !== 'wouldMove' &&
                                'text-muted-foreground'
                        )}
                    >
                        <span className="min-w-0 truncate">
                            {item.name ?? item.entityId}
                        </span>
                        <span className="text-muted-foreground shrink-0">
                            <FavoriteMoveItemNote item={item} />
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

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
    const favoriteMove = approval.favoriteMove;
    const moving =
        favoriteMove?.items.filter((item) => item.status === 'wouldMove')
            .length ?? 0;

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
                    {moving > 1
                        ? t('assistant.approval.approve_all')
                        : t('assistant.approval.approve')}
                </Button>
            </ItemActions>
            {tool === 'favorite_move' && (
                <ItemFooter>
                    <FavoriteBackupNotice
                        kind={
                            favoriteMove?.kind ??
                            approval.fields.find(
                                (field) => field.name === 'kind'
                            )?.value
                        }
                    />
                </ItemFooter>
            )}
            {favoriteMove && (
                <ItemFooter>
                    <FavoriteMovePreviewList
                        preview={favoriteMove}
                        moving={moving}
                    />
                </ItemFooter>
            )}
            {!favoriteMove && approval.fields.length > 0 && (
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
