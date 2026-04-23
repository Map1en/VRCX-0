import { EyeIcon, ImageIcon, RefreshCwIcon, Trash2Icon, UploadIcon } from 'lucide-react';

import { formatDateFilter } from '@/lib/dateTime.js';
import { getPrintFileName } from '@/shared/utils/gallery.js';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { TabsContent } from '@/ui/shadcn/tabs';

import { EmptyState, LoadingState } from './GalleryViewParts.jsx';

export function GalleryPrintsTab({
    t,
    prints,
    loading,
    uploadingTab,
    mutatingKey,
    isVrcPlusSupporter,
    printUploadNote,
    printCropBorder,
    onRefresh,
    onBeginUpload,
    onPrintUploadNoteChange,
    onPrintCropBorderChange,
    onPreview,
    onDeletePrint
}) {
    return (
        <TabsContent value="prints" className="min-h-0">
            <Card>
                <CardHeader className="gap-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div>
                            <CardTitle>
                                {t('dialog.gallery_icons.prints')}
                            </CardTitle>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onRefresh('prints')}
                            >
                                <RefreshCwIcon data-icon="inline-start" />
                                {t('dialog.gallery_icons.refresh')}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={
                                    !isVrcPlusSupporter ||
                                    Boolean(uploadingTab)
                                }
                                onClick={() => onBeginUpload('prints')}
                            >
                                <UploadIcon data-icon="inline-start" />
                                {t('dialog.gallery_icons.upload')}
                            </Button>
                        </div>
                    </div>
                    <FieldGroup className="bg-muted/20 flex-row flex-wrap items-end gap-3 rounded-lg border p-3">
                        <Field className="w-80 max-w-full">
                            <FieldLabel htmlFor="gallery-print-upload-note">
                                {t('dialog.gallery_icons.note')}
                            </FieldLabel>
                            <Input
                                id="gallery-print-upload-note"
                                maxLength={32}
                                value={printUploadNote}
                                onChange={(event) =>
                                    onPrintUploadNoteChange(event.target.value)
                                }
                                placeholder={t('dialog.gallery_icons.note')}
                            />
                        </Field>
                        <Field orientation="horizontal" className="h-9 w-auto">
                            <Checkbox
                                id="gallery-print-crop-border"
                                checked={printCropBorder}
                                onCheckedChange={(value) =>
                                    onPrintCropBorderChange(Boolean(value))
                                }
                            />
                            <FieldLabel htmlFor="gallery-print-crop-border">
                                {t('dialog.gallery_icons.crop_print_border')}
                            </FieldLabel>
                        </Field>
                    </FieldGroup>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <LoadingState />
                    ) : prints.length > 0 ? (
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                            {prints.map((print) => {
                                const imageUrl = print?.files?.image || '';
                                const isMutating =
                                    mutatingKey === `prints:${print.id}`;
                                return (
                                    <Card
                                        key={print.id}
                                        className="overflow-hidden"
                                    >
                                        {imageUrl ? (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                className="h-auto w-full rounded-none p-0"
                                                onClick={() =>
                                                    onPreview({
                                                        id: print.id,
                                                        url: imageUrl,
                                                        title: getPrintFileName(
                                                            print
                                                        )
                                                    })
                                                }
                                            >
                                                <img
                                                    src={imageUrl}
                                                    alt={print.note || print.id}
                                                    loading="lazy"
                                                    className="aspect-[16/9] w-full object-cover"
                                                />
                                            </Button>
                                        ) : (
                                            <div className="bg-muted text-muted-foreground flex aspect-[16/9] w-full items-center justify-center">
                                                <ImageIcon className="size-8" />
                                            </div>
                                        )}
                                        <CardContent className="flex flex-col gap-3 p-4">
                                            <div className="flex flex-col gap-1">
                                                <div className="line-clamp-1 text-sm font-medium">
                                                    {print.note || print.id}
                                                </div>
                                                <div className="text-muted-foreground line-clamp-1 text-xs">
                                                    {print.worldName ||
                                                        print.worldId ||
                                                        '\u00A0'}
                                                </div>
                                                <div className="text-muted-foreground line-clamp-1 font-mono text-xs">
                                                    {print.authorName ||
                                                        print.authorId ||
                                                        '\u00A0'}
                                                </div>
                                                {print.createdAt ? (
                                                    <div className="text-muted-foreground line-clamp-1 font-mono text-xs">
                                                        {formatDateFilter(
                                                            print.createdAt,
                                                            'long'
                                                        )}
                                                    </div>
                                                ) : null}
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={!imageUrl}
                                                    onClick={() =>
                                                        onPreview({
                                                            id: print.id,
                                                            url: imageUrl,
                                                            title: getPrintFileName(
                                                                print
                                                            )
                                                        })
                                                    }
                                                >
                                                    <EyeIcon data-icon="inline-start" />
                                                    {t('view.tools.generated.preview')}
                                                </Button>
                                                <Button
                                                    variant="destructive"
                                                    size="sm"
                                                    disabled={isMutating}
                                                    onClick={() =>
                                                        onDeletePrint(print.id)
                                                    }
                                                >
                                                    <Trash2Icon data-icon="inline-start" />
                                                    {t('common.actions.delete')}
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    ) : (
                        <EmptyState
                            title={t('view.tools.generated.no_prints_loaded')}
                            description={t(
                                'view.tools.generated.refresh_this_tab_to_load_your_vrchat_prints'
                            )}
                        />
                    )}
                </CardContent>
            </Card>
        </TabsContent>
    );
}
