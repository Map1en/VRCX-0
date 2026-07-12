import { CopyIcon, ExternalLinkIcon, Share2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import shareCollectionRepository, {
    type ShareCollectionCreateResult
} from '@/repositories/shareCollectionRepository';
import { copyTextToClipboard } from '@/services/clipboardService';
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

type ShareLinkFieldProps = {
    label: string;
    value: string;
    copyLabel: string;
    onCopy(): void;
};

type FavoriteShareCollectionDialogProps = {
    open: boolean;
    onOpenChange(open: boolean): void;
    group: FavoriteGroup | null;
    items: FavoriteItem[];
};

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

function ShareLinkField({
    label,
    value,
    copyLabel,
    onCopy
}: ShareLinkFieldProps) {
    return (
        <Field className="gap-1.5">
            <FieldLabel>{label}</FieldLabel>
            <div className="flex min-w-0 gap-2">
                <Input
                    readOnly
                    value={value}
                    className="min-w-0 flex-1"
                    onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    aria-label={copyLabel}
                    onClick={onCopy}
                >
                    <CopyIcon data-icon="inline-start" />
                </Button>
            </div>
        </Field>
    );
}

export function FavoriteShareCollectionDialog({
    open,
    onOpenChange,
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
    }, [group?.label, open]);

    async function copyUrl(url: string, messageKey: string): Promise<void> {
        await copyTextToClipboard(url, {
            successMessage: t(messageKey),
            errorMessage: (error) =>
                errorMessage(
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
        setSharing(true);
        try {
            const nextResult =
                await shareCollectionRepository.createShareCollection({
                    title,
                    listed,
                    includeNotes,
                    worldIds: shareWorlds.worldIds
                });
            setResult(nextResult);
            const skipped = shareWorlds.worldIds.length - nextResult.worldCount;
            if (skipped > 0) {
                toast.warning(
                    t('view.favorite.share_collection.toast.skipped', {
                        count: skipped
                    })
                );
            } else {
                toast.success(
                    t('view.favorite.share_collection.toast.create_success')
                );
            }
        } catch (error) {
            toast.error(
                errorMessage(
                    error,
                    t('view.favorite.share_collection.toast.create_failed')
                )
            );
        } finally {
            setSharing(false);
        }
    }

    async function openManage(): Promise<void> {
        try {
            await shareCollectionRepository.openShareCollectionManage();
        } catch (error) {
            toast.error(
                errorMessage(
                    error,
                    t('view.favorite.share_collection.toast.open_manage_failed')
                )
            );
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        {t('view.favorite.share_collection.title')}
                    </DialogTitle>
                    <DialogDescription>
                        {group
                            ? t('view.favorite.share_collection.subtitle', {
                                  group: group.label
                              })
                            : t(
                                  'view.favorite.share_collection.subtitle_empty'
                              )}
                    </DialogDescription>
                </DialogHeader>

                <FieldGroup className="gap-4">
                    <Field className="gap-1.5">
                        <FieldLabel htmlFor="favorite-share-collection-title">
                            {t('view.favorite.share_collection.label.title')}
                        </FieldLabel>
                        <Input
                            id="favorite-share-collection-title"
                            value={title}
                            disabled={sharing}
                            onChange={(event) => setTitle(event.target.value)}
                        />
                    </Field>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field orientation="horizontal">
                            <Switch
                                id="favorite-share-collection-listed"
                                checked={listed}
                                disabled={sharing}
                                onCheckedChange={(checked) =>
                                    setListed(Boolean(checked))
                                }
                            />
                            <FieldContent>
                                <FieldTitle>
                                    {t(
                                        'view.favorite.share_collection.label.listed'
                                    )}
                                </FieldTitle>
                                <FieldDescription>
                                    {t(
                                        'view.favorite.share_collection.label.listed_description'
                                    )}
                                </FieldDescription>
                            </FieldContent>
                        </Field>
                        <Field orientation="horizontal">
                            <Switch
                                id="favorite-share-collection-include-notes"
                                checked={includeNotes}
                                disabled={sharing}
                                onCheckedChange={(checked) =>
                                    setIncludeNotes(Boolean(checked))
                                }
                            />
                            <FieldContent>
                                <FieldTitle>
                                    {t(
                                        'view.favorite.share_collection.label.include_notes'
                                    )}
                                </FieldTitle>
                                <FieldDescription>
                                    {t(
                                        'view.favorite.share_collection.label.include_notes_description'
                                    )}
                                </FieldDescription>
                            </FieldContent>
                        </Field>
                    </div>

                    <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                        <span>
                            {t('view.favorite.share_collection.label.worlds', {
                                count: shareWorlds.worldIds.length,
                                total: shareWorlds.totalWorldIds
                            })}
                        </span>
                        {shareWorlds.truncated ? (
                            <span>
                                {t(
                                    'view.favorite.share_collection.label.truncated',
                                    {
                                        cap: SHARE_COLLECTION_CLIENT_WORLD_CAP
                                    }
                                )}
                            </span>
                        ) : null}
                    </div>

                    <div className="flex flex-wrap justify-end gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                                void openManage();
                            }}
                        >
                            <ExternalLinkIcon data-icon="inline-start" />
                            <span>
                                {t(
                                    'view.favorite.share_collection.action.open_manage'
                                )}
                            </span>
                        </Button>
                        <Button
                            type="button"
                            disabled={
                                sharing ||
                                !title.trim() ||
                                !shareWorlds.worldIds.length
                            }
                            onClick={() => {
                                void createShare();
                            }}
                        >
                            {sharing ? (
                                <Spinner data-icon="inline-start" />
                            ) : (
                                <Share2Icon data-icon="inline-start" />
                            )}
                            <span>
                                {t(
                                    'view.favorite.share_collection.action.share'
                                )}
                            </span>
                        </Button>
                    </div>
                </FieldGroup>

                {result ? (
                    <div className="grid gap-3 rounded-lg border p-3">
                        <ShareLinkField
                            label={t(
                                'view.favorite.share_collection.label.share_url'
                            )}
                            value={result.url}
                            copyLabel={t(
                                'view.favorite.share_collection.action.copy_share_url'
                            )}
                            onCopy={() => {
                                void copyUrl(
                                    result.url,
                                    'view.favorite.share_collection.toast.copy_success'
                                );
                            }}
                        />
                        <ShareLinkField
                            label={t(
                                'view.favorite.share_collection.label.edit_url'
                            )}
                            value={result.editUrl}
                            copyLabel={t(
                                'view.favorite.share_collection.action.copy_edit_url'
                            )}
                            onCopy={() => {
                                void copyUrl(
                                    result.editUrl,
                                    'view.favorite.share_collection.toast.copy_edit_success'
                                );
                            }}
                        />
                        <Alert>
                            <AlertDescription>
                                {t(
                                    'view.favorite.share_collection.label.edit_url_warning'
                                )}
                            </AlertDescription>
                        </Alert>
                        <div className="flex justify-end">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    void openManage();
                                }}
                            >
                                <ExternalLinkIcon data-icon="inline-start" />
                                <span>
                                    {t(
                                        'view.favorite.share_collection.action.open_manage'
                                    )}
                                </span>
                            </Button>
                        </div>
                    </div>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}
