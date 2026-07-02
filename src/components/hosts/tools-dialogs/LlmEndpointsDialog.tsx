import {
    PlusIcon,
    RefreshCwIcon,
    SquarePenIcon,
    Trash2Icon
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { LlmEndpointDto } from '@/platform/tauri/bindings';
import {
    mergeManualModels,
    useLlmEndpointsStore
} from '@/state/llmEndpointsStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/ui/shadcn/table';
import { Textarea } from '@/ui/shadcn/textarea';

type EndpointDraft = {
    id: string | null;
    name: string;
    baseUrl: string;
    apiKey: string;
    clearKey: boolean;
    modelsText: string;
};

const emptyDraft: EndpointDraft = {
    id: null,
    name: '',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    clearKey: false,
    modelsText: ''
};

function draftFromEndpoint(endpoint: LlmEndpointDto): EndpointDraft {
    return {
        id: endpoint.id,
        name: endpoint.name,
        baseUrl: endpoint.baseUrl,
        apiKey: '',
        clearKey: false,
        modelsText: endpoint.models.join('\n')
    };
}

function formatModelSummary(models: string[], fallback: string): string {
    if (!models.length) {
        return fallback;
    }
    if (models.length <= 3) {
        return models.join(', ');
    }
    return `${models.slice(0, 3).join(', ')} +${models.length - 3}`;
}

function endpointApiKeyInput(draft: EndpointDraft): string | null {
    const apiKey = draft.apiKey.trim();
    if (!draft.id) {
        return apiKey;
    }
    if (draft.clearKey) {
        return '';
    }
    return apiKey || null;
}

type LlmEndpointsDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

export function LlmEndpointsDialog({
    open,
    onOpenChange
}: LlmEndpointsDialogProps) {
    const { t } = useTranslation();
    const endpoints = useLlmEndpointsStore((state) => state.endpoints);
    const loading = useLlmEndpointsStore((state) => state.loading);
    const load = useLlmEndpointsStore((state) => state.load);
    const upsert = useLlmEndpointsStore((state) => state.upsert);
    const deleteEndpoint = useLlmEndpointsStore(
        (state) => state.deleteEndpoint
    );
    const detectModels = useLlmEndpointsStore((state) => state.detectModels);
    const [view, setView] = useState<'list' | 'edit'>('list');
    const [draft, setDraft] = useState<EndpointDraft>(emptyDraft);
    const modelCount = useMemo(
        () =>
            endpoints.reduce(
                (count, endpoint) => count + endpoint.models.length,
                0
            ),
        [endpoints]
    );

    useEffect(() => {
        if (!open) {
            return;
        }
        setView('list');
        load().catch((error: unknown) => {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.tools.llm_endpoints.load_failed')
            );
        });
    }, [open, load, t]);

    function openAddView() {
        setDraft(emptyDraft);
        setView('edit');
    }

    function openEditView(endpoint: LlmEndpointDto) {
        setDraft(draftFromEndpoint(endpoint));
        setView('edit');
    }

    async function saveDraft() {
        const baseUrl = draft.baseUrl.trim();
        if (!baseUrl) {
            toast.warning(t('view.tools.llm_endpoints.base_url_required'));
            return;
        }
        try {
            await upsert({
                id: draft.id,
                name: draft.name.trim(),
                baseUrl,
                apiKey: endpointApiKeyInput(draft),
                models: mergeManualModels([], draft.modelsText)
            });
            toast.success(t('view.tools.llm_endpoints.saved'));
            setView('list');
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.tools.llm_endpoints.save_failed')
            );
        }
    }

    async function detectForDraft() {
        try {
            const models = await detectModels({
                id: draft.id,
                baseUrl: draft.baseUrl.trim() || null,
                apiKey: draft.apiKey.trim() || null,
                persist: true
            });
            setDraft((current) => ({
                ...current,
                modelsText: mergeManualModels(models, current.modelsText).join(
                    '\n'
                )
            }));
            toast.success(
                models.length
                    ? t('view.tools.llm_endpoints.models_detected', {
                          count: models.length
                      })
                    : t('view.tools.llm_endpoints.no_models_detected')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.tools.llm_endpoints.detect_failed')
            );
        }
    }

    function detectForRow(endpoint: LlmEndpointDto) {
        detectModels({
            id: endpoint.id,
            baseUrl: null,
            apiKey: null,
            persist: true
        }).catch((error: unknown) => {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.tools.llm_endpoints.detect_failed')
            );
        });
    }

    async function deleteEndpointWithFeedback(endpoint: LlmEndpointDto) {
        try {
            await deleteEndpoint(endpoint.id);
            toast.success(t('view.tools.llm_endpoints.deleted'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.tools.llm_endpoints.delete_failed')
            );
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
                <DialogHeader>
                    <DialogTitle>
                        {view === 'edit'
                            ? draft.id
                                ? t('view.tools.llm_endpoints.edit')
                                : t('view.tools.llm_endpoints.add')
                            : t('view.tools.llm_endpoints.title')}
                    </DialogTitle>
                    {view === 'list' ? (
                        <DialogDescription>
                            {t('view.tools.llm_endpoints.description')}
                        </DialogDescription>
                    ) : null}
                </DialogHeader>

                {view === 'list' ? (
                    <div className="grid gap-3">
                        <div className="flex items-center justify-between gap-2">
                            <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-2 text-sm">
                                <Badge variant="outline">
                                    {t(
                                        'view.tools.llm_endpoints.endpoint_count',
                                        { count: endpoints.length }
                                    )}
                                </Badge>
                                <Badge variant="outline">
                                    {t('view.tools.llm_endpoints.model_count', {
                                        count: modelCount
                                    })}
                                </Badge>
                            </div>
                            <Button
                                type="button"
                                size="sm"
                                onClick={openAddView}
                            >
                                <PlusIcon data-icon="inline-start" />
                                {t('view.tools.llm_endpoints.add')}
                            </Button>
                        </div>
                        {endpoints.length ? (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>
                                            {t('view.tools.llm_endpoints.name')}
                                        </TableHead>
                                        <TableHead>
                                            {t(
                                                'view.tools.llm_endpoints.base_url'
                                            )}
                                        </TableHead>
                                        <TableHead>
                                            {t(
                                                'view.tools.llm_endpoints.models'
                                            )}
                                        </TableHead>
                                        <TableHead>
                                            {t('view.tools.llm_endpoints.key')}
                                        </TableHead>
                                        <TableHead className="w-32 text-right">
                                            {t(
                                                'view.tools.llm_endpoints.actions'
                                            )}
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {endpoints.map((endpoint) => (
                                        <TableRow key={endpoint.id}>
                                            <TableCell className="font-medium">
                                                {endpoint.name}
                                            </TableCell>
                                            <TableCell className="max-w-[340px] truncate">
                                                {endpoint.baseUrl}
                                            </TableCell>
                                            <TableCell className="max-w-[400px] truncate">
                                                {formatModelSummary(
                                                    endpoint.models,
                                                    t(
                                                        'view.tools.llm_endpoints.no_models'
                                                    )
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <Badge
                                                    variant={
                                                        endpoint.hasKey
                                                            ? 'secondary'
                                                            : 'outline'
                                                    }
                                                >
                                                    {endpoint.hasKey
                                                        ? t(
                                                              'view.tools.llm_endpoints.key_saved'
                                                          )
                                                        : t(
                                                              'view.tools.llm_endpoints.key_empty'
                                                          )}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex justify-end gap-1">
                                                    <Button
                                                        type="button"
                                                        size="icon-xs"
                                                        variant="ghost"
                                                        aria-label={t(
                                                            'view.tools.llm_endpoints.detect_models'
                                                        )}
                                                        onClick={() =>
                                                            detectForRow(
                                                                endpoint
                                                            )
                                                        }
                                                    >
                                                        <RefreshCwIcon data-icon="inline-start" />
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        size="icon-xs"
                                                        variant="ghost"
                                                        aria-label={t(
                                                            'view.tools.llm_endpoints.edit'
                                                        )}
                                                        onClick={() =>
                                                            openEditView(
                                                                endpoint
                                                            )
                                                        }
                                                    >
                                                        <SquarePenIcon data-icon="inline-start" />
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        size="icon-xs"
                                                        variant="ghost"
                                                        aria-label={t(
                                                            'view.tools.llm_endpoints.delete'
                                                        )}
                                                        onClick={() =>
                                                            deleteEndpointWithFeedback(
                                                                endpoint
                                                            )
                                                        }
                                                    >
                                                        <Trash2Icon data-icon="inline-start" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        ) : (
                            <div className="text-muted-foreground rounded-md border border-dashed px-3 py-6 text-center text-sm">
                                {t(
                                    'view.tools.llm_endpoints.empty_description'
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="grid gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="llm-endpoint-dialog-name">
                                {t('view.tools.llm_endpoints.name')}
                            </Label>
                            <Input
                                id="llm-endpoint-dialog-name"
                                value={draft.name}
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        name: event.target.value
                                    }))
                                }
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="llm-endpoint-dialog-base-url">
                                {t('view.tools.llm_endpoints.base_url')}
                            </Label>
                            <Input
                                id="llm-endpoint-dialog-base-url"
                                value={draft.baseUrl}
                                placeholder="https://api.openai.com/v1"
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        baseUrl: event.target.value
                                    }))
                                }
                            />
                        </div>
                        <div className="grid gap-2">
                            <div className="flex items-center justify-between gap-2">
                                <Label htmlFor="llm-endpoint-dialog-api-key">
                                    {t('view.tools.llm_endpoints.api_key')}
                                </Label>
                                {draft.id ? (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={
                                            draft.clearKey
                                                ? 'secondary'
                                                : 'outline'
                                        }
                                        onClick={() =>
                                            setDraft((current) => ({
                                                ...current,
                                                clearKey: !current.clearKey
                                            }))
                                        }
                                    >
                                        {t(
                                            'view.tools.llm_endpoints.clear_key'
                                        )}
                                    </Button>
                                ) : null}
                            </div>
                            <Input
                                id="llm-endpoint-dialog-api-key"
                                type="password"
                                value={draft.apiKey}
                                disabled={draft.clearKey}
                                placeholder={
                                    draft.id
                                        ? t(
                                              'view.tools.llm_endpoints.key_preserve_placeholder'
                                          )
                                        : 'sk-...'
                                }
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        apiKey: event.target.value
                                    }))
                                }
                            />
                        </div>
                        <div className="grid gap-2">
                            <div className="flex items-center justify-between gap-2">
                                <Label htmlFor="llm-endpoint-dialog-models">
                                    {t('view.tools.llm_endpoints.models')}
                                </Label>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={loading}
                                    onClick={detectForDraft}
                                >
                                    <RefreshCwIcon data-icon="inline-start" />
                                    {t(
                                        'view.tools.llm_endpoints.detect_models'
                                    )}
                                </Button>
                            </div>
                            <Textarea
                                id="llm-endpoint-dialog-models"
                                rows={5}
                                value={draft.modelsText}
                                placeholder="gpt-4o-mini"
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        modelsText: event.target.value
                                    }))
                                }
                                className="resize-none"
                            />
                        </div>
                    </div>
                )}

                {view === 'edit' ? (
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setView('list')}
                        >
                            {t('common.actions.cancel')}
                        </Button>
                        <Button
                            type="button"
                            disabled={loading}
                            onClick={saveDraft}
                        >
                            {t('common.actions.save')}
                        </Button>
                    </DialogFooter>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}
