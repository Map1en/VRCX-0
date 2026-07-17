import {
    CheckCircle2Icon,
    CopyIcon,
    ExternalLinkIcon,
    InfoIcon,
    Share2Icon,
    TriangleAlertIcon
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import shareCollectionRepository, {
    type ShareCollectionCreateResult
} from '@/repositories/shareCollectionRepository';
import { copyTextToClipboard } from '@/services/clipboardService';
import { openExternalLink } from '@/services/entityMediaService';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Field,
    FieldContent,
    FieldDescription,
    FieldGroup,
    FieldLabel,
    FieldTitle
} from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';
import { Switch } from '@/ui/shadcn/switch';

import type { FavoriteGroup, FavoriteItem } from '../favoritesTypes';
import {
    buildShareCollectionWorldIds,
    SHARE_COLLECTION_CLIENT_WORLD_CAP
} from '../shareCollectionDialogModel';

type FavoriteShareCollectionDialogProps = {
    open: boolean;
    onOpenChange(open: boolean): void;
    onOpenManage(): void;
    group: FavoriteGroup | null;
    items: FavoriteItem[];
};

type ShareCollectionSuccessProps = {
    url: string;
    skippedWorldCount: number;
    skippedIncompleteWorlds: ShareCollectionCreateResult['skippedWorlds'];
    onCopy(): void;
    onOpenManage(): void;
    onDone(): void;
};

type ShareOptionFieldProps = {
    id: string;
    title: string;
    description: string;
    checked: boolean;
    disabled: boolean;
    onCheckedChange(value: boolean): void;
};

type ShareCollectionFormProps = {
    title: string;
    listed: boolean;
    includeNotes: boolean;
    sharing: boolean;
    worldCount: number;
    totalWorldCount: number;
    truncated: boolean;
    onTitleChange(value: string): void;
    onListedChange(value: boolean): void;
    onIncludeNotesChange(value: boolean): void;
    onCreate(): void;
};

function ShareOptionField({
    id,
    title,
    description,
    checked,
    disabled,
    onCheckedChange
}: ShareOptionFieldProps) {
    return (
        <Field
            orientation="horizontal"
            className="items-start rounded-xl border p-4"
        >
            <FieldContent>
                <FieldTitle>{title}</FieldTitle>
                <FieldDescription>{description}</FieldDescription>
            </FieldContent>
            <Switch
                id={id}
                checked={checked}
                disabled={disabled}
                onCheckedChange={(value) => onCheckedChange(Boolean(value))}
            />
        </Field>
    );
}

function ShareCollectionSuccess({
    url,
    skippedWorldCount,
    skippedIncompleteWorlds,
    onCopy,
    onOpenManage,
    onDone
}: ShareCollectionSuccessProps) {
    const { t } = useTranslation();

    return (
        <div className="grid gap-4">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2Icon className="size-5" />
                <span className="font-medium">
                    {t('view.favorite.share_collection.success.ready')}
                </span>
            </div>
            {skippedWorldCount > 0 ? (
                <Alert>
                    <TriangleAlertIcon />
                    <AlertDescription className="grid gap-2">
                        <span>
                            {t(
                                'view.favorite.share_collection.success.skipped',
                                {
                                    count: skippedWorldCount
                                }
                            )}
                        </span>
                        {skippedIncompleteWorlds.length > 0 ? (
                            <ul className="max-h-40 list-disc space-y-1 overflow-y-auto pl-5">
                                {skippedIncompleteWorlds.map((world, index) => (
                                    <li key={`${world.worldId}:${index}`}>
                                        {t(
                                            'view.favorite.share_collection.success.skipped_incomplete',
                                            {
                                                world:
                                                    world.name.trim() ||
                                                    world.worldId ||
                                                    t(
                                                        'view.favorites.empty.world_fallback'
                                                    )
                                            }
                                        )}
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                    </AlertDescription>
                </Alert>
            ) : null}
            <Field className="gap-1.5">
                <FieldLabel>
                    {t('view.favorite.share_collection.label.share_url')}
                </FieldLabel>
                <Input
                    readOnly
                    value={url}
                    onFocus={(event) => event.currentTarget.select()}
                />
            </Field>
            <div className="flex flex-wrap justify-end gap-2">
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                        void openExternalLink(url);
                    }}
                >
                    <ExternalLinkIcon data-icon="inline-start" />
                    {t('view.favorite.share_collection.action.open_share_page')}
                </Button>
                <Button type="button" onClick={onCopy}>
                    <CopyIcon data-icon="inline-start" />
                    {t('view.favorite.share_collection.action.copy_share_url')}
                </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                <Button type="button" variant="ghost" onClick={onOpenManage}>
                    <ExternalLinkIcon data-icon="inline-start" />
                    {t('view.favorite.share_collection.action.open_manage')}
                </Button>
                <Button type="button" variant="outline" onClick={onDone}>
                    {t('view.favorite.share_collection.action.done')}
                </Button>
            </div>
        </div>
    );
}

function ShareCollectionForm({
    title,
    listed,
    includeNotes,
    sharing,
    worldCount,
    totalWorldCount,
    truncated,
    onTitleChange,
    onListedChange,
    onIncludeNotesChange,
    onCreate
}: ShareCollectionFormProps) {
    const { t } = useTranslation();

    return (
        <FieldGroup className="gap-5">
            <Alert>
                <InfoIcon />
                <AlertDescription>
                    {t(
                        'view.favorite.share_collection.label.account_connection'
                    )}
                </AlertDescription>
            </Alert>
            <Field className="gap-2">
                <FieldLabel htmlFor="favorite-share-collection-title">
                    {t('view.favorite.share_collection.label.title')}
                </FieldLabel>
                <Input
                    id="favorite-share-collection-title"
                    value={title}
                    disabled={sharing}
                    onChange={(event) => onTitleChange(event.target.value)}
                />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
                <ShareOptionField
                    id="favorite-share-collection-listed"
                    title={t('view.favorite.share_collection.label.listed')}
                    description={t(
                        'view.favorite.share_collection.label.listed_description'
                    )}
                    checked={listed}
                    disabled={sharing}
                    onCheckedChange={onListedChange}
                />
                <ShareOptionField
                    id="favorite-share-collection-include-notes"
                    title={t(
                        'view.favorite.share_collection.label.include_notes'
                    )}
                    description={t(
                        'view.favorite.share_collection.label.include_notes_description'
                    )}
                    checked={includeNotes}
                    disabled={sharing}
                    onCheckedChange={onIncludeNotesChange}
                />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs tabular-nums">
                    <span>
                        {t('view.favorite.share_collection.label.worlds', {
                            count: worldCount,
                            total: totalWorldCount
                        })}
                    </span>
                    {truncated ? (
                        <span>
                            {t(
                                'view.favorite.share_collection.label.truncated',
                                { cap: SHARE_COLLECTION_CLIENT_WORLD_CAP }
                            )}
                        </span>
                    ) : null}
                </div>
                <Button
                    type="button"
                    disabled={sharing || !title.trim() || !worldCount}
                    onClick={onCreate}
                >
                    {sharing ? (
                        <Spinner data-icon="inline-start" />
                    ) : (
                        <Share2Icon data-icon="inline-start" />
                    )}
                    <span>
                        {t('view.favorite.share_collection.action.share')}
                    </span>
                </Button>
            </div>
        </FieldGroup>
    );
}

export function FavoriteShareCollectionDialog({
    open,
    onOpenChange,
    onOpenManage,
    group,
    items
}: FavoriteShareCollectionDialogProps) {
    const { t } = useTranslation();
    const [title, setTitle] = useState('');
    const [listed, setListed] = useState(false);
    const [includeNotes, setIncludeNotes] = useState(false);
    const [sharing, setSharing] = useState(false);
    const [result, setResult] = useState<ShareCollectionCreateResult | null>(
        null
    );
    const [skippedWorldCount, setSkippedWorldCount] = useState(0);
    const shareWorlds = useMemo(
        () => buildShareCollectionWorldIds(items),
        [items]
    );
    useEffect(() => {
        if (!open) {
            return;
        }
        setTitle(group?.label || '');
        setListed(false);
        setIncludeNotes(false);
        setResult(null);
        setSkippedWorldCount(0);
    }, [group?.label, open]);

    async function copyShareUrl(url: string): Promise<void> {
        await copyTextToClipboard(url, {
            successMessage: t(
                'view.favorite.share_collection.toast.copy_success'
            ),
            errorMessage: (error) =>
                userFacingErrorMessage(
                    error,
                    t('view.favorite.share_collection.toast.copy_failed')
                )
        });
    }

    async function createShare(): Promise<void> {
        if (!shareWorlds.worldIds.length) {
            toast.error(t('view.favorite.share_collection.toast.no_worlds'));
            return;
        }
        const submittedWorldCount = shareWorlds.worldIds.length;
        setSharing(true);
        try {
            const nextResult =
                await shareCollectionRepository.createShareCollection({
                    title,
                    listed,
                    includeNotes,
                    worldIds: shareWorlds.worldIds
                });
            setSkippedWorldCount(
                shareWorlds.skippedWorlds.length +
                    Math.max(submittedWorldCount - nextResult.worldCount, 0)
            );
            setResult(nextResult);
        } catch (error) {
            toast.error(
                userFacingErrorMessage(
                    error,
                    t('view.favorite.share_collection.toast.create_failed')
                )
            );
        } finally {
            setSharing(false);
        }
    }

    const dialogTitle = t(
        result
            ? 'view.favorite.share_collection.success.title'
            : 'view.favorite.share_collection.title'
    );
    let dialogDescription = t('view.favorite.share_collection.subtitle_empty');
    if (result) {
        dialogDescription = t(
            'view.favorite.share_collection.success.description',
            { count: result.worldCount }
        );
    } else if (group) {
        dialogDescription = t('view.favorite.share_collection.subtitle', {
            group: group.label
        });
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen && sharing) {
                    return;
                }
                onOpenChange(nextOpen);
            }}
        >
            <DialogContent className="sm:max-w-2xl" showCloseButton={!sharing}>
                <DialogHeader>
                    <DialogTitle>{dialogTitle}</DialogTitle>
                    <DialogDescription>{dialogDescription}</DialogDescription>
                </DialogHeader>

                {result ? (
                    <ShareCollectionSuccess
                        url={result.url}
                        skippedWorldCount={skippedWorldCount}
                        skippedIncompleteWorlds={[
                            ...shareWorlds.skippedWorlds,
                            ...result.skippedWorlds
                        ]}
                        onCopy={() => {
                            void copyShareUrl(result.url);
                        }}
                        onOpenManage={onOpenManage}
                        onDone={() => onOpenChange(false)}
                    />
                ) : (
                    <ShareCollectionForm
                        title={title}
                        listed={listed}
                        includeNotes={includeNotes}
                        sharing={sharing}
                        worldCount={shareWorlds.worldIds.length}
                        totalWorldCount={shareWorlds.totalWorldIds}
                        truncated={shareWorlds.truncated}
                        onTitleChange={setTitle}
                        onListedChange={setListed}
                        onIncludeNotesChange={setIncludeNotes}
                        onCreate={() => {
                            void createShare();
                        }}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}
