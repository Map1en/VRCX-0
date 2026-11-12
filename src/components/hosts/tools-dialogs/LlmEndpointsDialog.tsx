import {
    AlertTriangleIcon,
    PlusIcon,
    RefreshCwIcon,
    SquarePenIcon,
    Trash2Icon
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import type { LlmEndpointDto } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { mergeModels, useLlmEndpointsStore } from '@/state/llmEndpointsStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
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
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    CUSTOM_LLM_ENDPOINT_PROVIDER_ID,
    LLM_ENDPOINT_PROVIDER_PRESETS,
    applyLlmEndpointBaseUrl,
    applyLlmEndpointProviderPreset,
    createEmptyLlmEndpointDraft,
    findLlmEndpointProviderId,
    isLlmEndpointProviderId,
    shouldUseSavedLlmEndpointForDetect,
    type LlmEndpointProviderDraft
} from './llmEndpointPresets';

type EndpointDraft = LlmEndpointProviderDraft;

function parseModelIds(value: string): string[] {
    return mergeModels(value.split(/[,\n]/));
}

function draftFromEndpoint(endpoint: LlmEndpointDto): EndpointDraft {
    return {
        id: endpoint.id,
        savedBaseUrl: endpoint.baseUrl,
        providerId: findLlmEndpointProviderId(endpoint.baseUrl, endpoint.name),
        name: endpoint.name,
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        clearKey: false,
        models: endpoint.models,
        detectedModelReasoning: null
    };
}

function formatModelSummary(models: string[]): string {
    if (models.length <= 3) {
        return models.join(', ');
    }
    return `${models.slice(0, 3).join(', ')} +${models.length - 3}`;
}

function isValidBaseUrl(value: string): boolean {
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        return false;
    }
    return url.protocol === 'http:' || url.protocol === 'https:';
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

function sameDetectionTarget(
    current: EndpointDraft,
    requested: EndpointDraft
): boolean {
    return (
        current.id === requested.id &&
        current.baseUrl.trim() === requested.baseUrl.trim() &&
        current.apiKey.trim() === requested.apiKey.trim() &&
        current.clearKey === requested.clearKey
    );
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
    const [draft, setDraft] = useState<EndpointDraft>(
        createEmptyLlmEndpointDraft
    );
    const draftRef = useRef(draft);
    draftRef.current = draft;
    const [catalog, setCatalog] = useState<{
        target: EndpointDraft;
        models: string[];
    } | null>(null);
    const detectionRevision = useRef(0);
    const [modelSearch, setModelSearch] = useState('');
    const [manualModels, setManualModels] = useState('');
    const [saving, setSaving] = useState(false);
    const baseUrlValid = isValidBaseUrl(draft.baseUrl);
    const modelOptions = mergeModels(
        catalog && sameDetectionTarget(catalog.target, draft)
            ? catalog.models
            : [],
        draft.models
    );
    const visibleModels = modelOptions.filter((model) =>
        model.toLowerCase().includes(modelSearch.trim().toLowerCase())
    );
    const providerOptions = [
        {
            value: CUSTOM_LLM_ENDPOINT_PROVIDER_ID,
            label: t('view.tools.llm_endpoints.preset_custom')
        },
        ...LLM_ENDPOINT_PROVIDER_PRESETS.map((preset) => ({
            value: preset.id,
            label: preset.labelKey ? t(preset.labelKey) : preset.label
        }))
    ];

    useEffect(() => {
        detectionRevision.current += 1;
        if (!open) {
            return;
        }
        setView('list');
        load().catch((error: unknown) => {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.tools.llm_endpoints.load_failed')
            });
        });
        return () => {
            detectionRevision.current += 1;
        };
    }, [open, load, t]);

    function closeEditView() {
        detectionRevision.current += 1;
        setView('list');
    }

    function dialogTitle(): string {
        if (view === 'list') {
            return t('view.tools.llm_endpoints.title');
        }
        return draft.id
            ? t('view.tools.llm_endpoints.edit')
            : t('view.tools.llm_endpoints.add');
    }

    function openAddView() {
        detectionRevision.current += 1;
        setDraft(createEmptyLlmEndpointDraft());
        setCatalog(null);
        setModelSearch('');
        setManualModels('');
        setView('edit');
    }

    function openEditView(endpoint: LlmEndpointDto) {
        detectionRevision.current += 1;
        const target = draftFromEndpoint(endpoint);
        draftRef.current = target;
        setDraft(target);
        setCatalog({ target, models: endpoint.models });
        setModelSearch('');
        setManualModels('');
        setView('edit');
        return target;
    }

    function updateDraftProvider(value: string | null) {
        if (!isLlmEndpointProviderId(value)) {
            return;
        }
        setDraft((current) => applyLlmEndpointProviderPreset(current, value));
        setCatalog(null);
        setModelSearch('');
        setManualModels('');
    }

    async function detectForDraft(target = draft) {
        const revision = ++detectionRevision.current;
        try {
            const useSavedEndpoint = shouldUseSavedLlmEndpointForDetect(target);
            const result = await detectModels({
                id: useSavedEndpoint ? target.id : null,
                baseUrl: useSavedEndpoint
                    ? null
                    : target.baseUrl.trim() || null,
                apiKey: useSavedEndpoint ? null : target.apiKey.trim() || null,
                persist: false
            });
            if (
                revision !== detectionRevision.current ||
                !sameDetectionTarget(draftRef.current, target)
            ) {
                return;
            }
            setCatalog({
                target,
                models: mergeModels(result.models, draftRef.current.models)
            });
            setDraft((current) =>
                sameDetectionTarget(current, target)
                    ? {
                          ...current,
                          detectedModelReasoning: result.modelReasoning
                      }
                    : current
            );
            toast.add({
                type: 'success',
                title: result.models.length
                    ? t('view.tools.llm_endpoints.models_detected', {
                          count: result.models.length
                      })
                    : t('view.tools.llm_endpoints.no_models_detected')
            });
        } catch (error) {
            if (
                revision !== detectionRevision.current ||
                !sameDetectionTarget(draftRef.current, target)
            ) {
                return;
            }
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.tools.llm_endpoints.detect_failed')
            });
        }
    }

    async function saveDraft() {
        const target = {
            ...draft,
            models: mergeModels(draft.models, parseModelIds(manualModels))
        };
        setSaving(true);
        try {
            const { models } = target;
            await upsert({
                id: target.id,
                name: target.name.trim(),
                baseUrl: target.baseUrl.trim(),
                apiKey: endpointApiKeyInput(target),
                models,
                modelReasoning: target.detectedModelReasoning
            });
            toast.add({
                type: models.length ? 'success' : 'warning',
                title: t(
                    models.length
                        ? 'view.tools.llm_endpoints.saved'
                        : 'view.tools.llm_endpoints.saved_unusable'
                )
            });
            closeEditView();
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.tools.llm_endpoints.save_failed')
            });
        } finally {
            setSaving(false);
        }
    }

    function addManualModels() {
        const models = parseModelIds(manualModels);
        setCatalog({
            target: draft,
            models: mergeModels(modelOptions, models)
        });
        setDraft((current) => ({
            ...current,
            models: mergeModels(current.models, models)
        }));
        setManualModels('');
        setModelSearch('');
    }

    function removeModel(model: string) {
        setCatalog({
            target: draft,
            models: modelOptions.filter((value) => value !== model)
        });
        setDraft((current) => ({
            ...current,
            models: current.models.filter((value) => value !== model)
        }));
    }

    function detectForRow(endpoint: LlmEndpointDto) {
        const target = openEditView(endpoint);
        void detectForDraft(target);
    }

    async function deleteEndpointWithFeedback(endpoint: LlmEndpointDto) {
        try {
            await deleteEndpoint(endpoint.id);
            toast.add({
                type: 'success',
                title: t('view.tools.llm_endpoints.deleted')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.tools.llm_endpoints.delete_failed')
            });
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className={cn(
                    'max-h-[85vh] overflow-y-auto',
                    view === 'edit' ? 'sm:max-w-lg' : 'sm:max-w-3xl'
                )}
            >
                <DialogHeader>
                    <DialogTitle>{dialogTitle()}</DialogTitle>
                    {view === 'list' ? (
                        <DialogDescription>
                            {t('view.tools.llm_endpoints.description')}
                        </DialogDescription>
                    ) : null}
                </DialogHeader>

                {view === 'list' ? (
                    <div className="grid gap-2">
                        {endpoints.length ? (
                            <>
                                {endpoints.map((endpoint) => (
                                    <EndpointRow
                                        key={endpoint.id}
                                        endpoint={endpoint}
                                        disabled={loading}
                                        onDetect={() => detectForRow(endpoint)}
                                        onEdit={() => openEditView(endpoint)}
                                        onDelete={() =>
                                            deleteEndpointWithFeedback(endpoint)
                                        }
                                    />
                                ))}
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="justify-self-start"
                                    onClick={openAddView}
                                >
                                    <PlusIcon data-icon="inline-start" />
                                    {t('view.tools.llm_endpoints.add')}
                                </Button>
                            </>
                        ) : (
                            <div className="flex flex-col items-center gap-3 rounded-md border border-dashed px-3 py-8 text-center">
                                <span className="text-muted-foreground text-sm">
                                    {t(
                                        'view.tools.llm_endpoints.empty_description'
                                    )}
                                </span>
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={openAddView}
                                >
                                    <PlusIcon data-icon="inline-start" />
                                    {t('view.tools.llm_endpoints.add')}
                                </Button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="grid gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="llm-endpoint-dialog-preset">
                                {t('view.tools.llm_endpoints.preset')}
                            </Label>
                            <Select
                                value={draft.providerId}
                                items={providerOptions}
                                onValueChange={updateDraftProvider}
                            >
                                <SelectTrigger
                                    id="llm-endpoint-dialog-preset"
                                    className="w-full"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {providerOptions.map((option) => (
                                            <SelectItem
                                                key={option.value}
                                                value={option.value}
                                            >
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </div>
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
                                        name: event.target.value,
                                        providerId: findLlmEndpointProviderId(
                                            current.baseUrl,
                                            event.target.value
                                        )
                                    }))
                                }
                            />
                            <span className="text-muted-foreground text-xs">
                                {t('view.tools.llm_endpoints.name_description')}
                            </span>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="llm-endpoint-dialog-base-url">
                                {t('view.tools.llm_endpoints.base_url')}
                            </Label>
                            <Input
                                id="llm-endpoint-dialog-base-url"
                                value={draft.baseUrl}
                                aria-invalid={
                                    Boolean(draft.baseUrl) && !baseUrlValid
                                }
                                placeholder="https://api.openai.com/v1"
                                onChange={(event) =>
                                    setDraft((current) =>
                                        applyLlmEndpointBaseUrl(
                                            current,
                                            event.target.value
                                        )
                                    )
                                }
                            />
                            {draft.baseUrl && !baseUrlValid ? (
                                <span className="text-destructive text-xs">
                                    {t(
                                        'view.tools.llm_endpoints.base_url_invalid'
                                    )}
                                </span>
                            ) : null}
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
                                type="text"
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
                        <fieldset className="grid min-w-0 gap-2">
                            <legend className="sr-only">
                                {t('view.tools.llm_endpoints.models')}
                            </legend>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium">
                                    {t('view.tools.llm_endpoints.models')}
                                </span>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={loading || !baseUrlValid}
                                    onClick={() => void detectForDraft()}
                                >
                                    <RefreshCwIcon data-icon="inline-start" />
                                    {t(
                                        'view.tools.llm_endpoints.detect_models'
                                    )}
                                </Button>
                            </div>
                            <p className="text-muted-foreground text-xs">
                                {t(
                                    'view.tools.llm_endpoints.models_description'
                                )}
                            </p>
                            <Label htmlFor="llm-endpoint-model-search">
                                {t('view.tools.llm_endpoints.models_search')}
                            </Label>
                            <Input
                                id="llm-endpoint-model-search"
                                type="search"
                                value={modelSearch}
                                autoComplete="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                onChange={(event) =>
                                    setModelSearch(event.target.value)
                                }
                            />
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                <span className="text-muted-foreground">
                                    {t(
                                        'view.tools.llm_endpoints.models_selected',
                                        {
                                            count: draft.models.length
                                        }
                                    )}
                                </span>
                                <div className="flex gap-1">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        disabled={!visibleModels.length}
                                        onClick={() =>
                                            setDraft((current) => ({
                                                ...current,
                                                models: mergeModels(
                                                    current.models,
                                                    visibleModels
                                                )
                                            }))
                                        }
                                    >
                                        {t(
                                            'view.tools.llm_endpoints.models_select_visible'
                                        )}
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        disabled={!draft.models.length}
                                        onClick={() => {
                                            setCatalog({
                                                target: draft,
                                                models: modelOptions
                                            });
                                            setDraft((current) => ({
                                                ...current,
                                                models: []
                                            }));
                                        }}
                                    >
                                        {t(
                                            'view.tools.llm_endpoints.models_clear'
                                        )}
                                    </Button>
                                </div>
                            </div>
                            <div className="max-h-56 min-h-24 overflow-y-auto rounded-md border p-1">
                                {visibleModels.length ? (
                                    visibleModels.map((model) => (
                                        <div
                                            key={model}
                                            className="hover:bg-muted/50 flex items-center gap-1 rounded-sm pr-1"
                                        >
                                            <Label
                                                htmlFor={`llm-endpoint-model-${encodeURIComponent(model)}`}
                                                className="flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-3 px-2 py-2 text-sm font-normal"
                                            >
                                                <Checkbox
                                                    id={`llm-endpoint-model-${encodeURIComponent(model)}`}
                                                    checked={draft.models.includes(
                                                        model
                                                    )}
                                                    onCheckedChange={(
                                                        checked
                                                    ) => {
                                                        setCatalog({
                                                            target: draft,
                                                            models: modelOptions
                                                        });
                                                        setDraft((current) => ({
                                                            ...current,
                                                            models: checked
                                                                ? mergeModels(
                                                                      current.models,
                                                                      [model]
                                                                  )
                                                                : current.models.filter(
                                                                      (value) =>
                                                                          value !==
                                                                          model
                                                                  )
                                                        }));
                                                    }}
                                                />
                                                <span className="min-w-0 break-all">
                                                    {model}
                                                </span>
                                            </Label>
                                            <Button
                                                type="button"
                                                size="icon-sm"
                                                variant="ghost"
                                                aria-label={t(
                                                    'view.tools.llm_endpoints.models_remove',
                                                    { model }
                                                )}
                                                onClick={() =>
                                                    removeModel(model)
                                                }
                                            >
                                                <Trash2Icon aria-hidden="true" />
                                            </Button>
                                        </div>
                                    ))
                                ) : (
                                    <p className="text-muted-foreground px-2 py-5 text-center text-sm">
                                        {t(
                                            modelOptions.length
                                                ? 'view.tools.llm_endpoints.models_no_matches'
                                                : 'view.tools.llm_endpoints.models_empty'
                                        )}
                                    </p>
                                )}
                            </div>
                            <Label htmlFor="llm-endpoint-manual-models">
                                {t('view.tools.llm_endpoints.models_manual')}
                            </Label>
                            <div className="flex gap-2">
                                <Input
                                    id="llm-endpoint-manual-models"
                                    value={manualModels}
                                    autoComplete="off"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    aria-describedby="llm-endpoint-manual-models-hint"
                                    onChange={(event) =>
                                        setManualModels(event.target.value)
                                    }
                                    onKeyDown={(event) => {
                                        if (
                                            event.key === 'Enter' &&
                                            !event.nativeEvent.isComposing
                                        ) {
                                            event.preventDefault();
                                            addManualModels();
                                        }
                                    }}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={
                                        !parseModelIds(manualModels).length
                                    }
                                    onClick={addManualModels}
                                >
                                    <PlusIcon data-icon="inline-start" />
                                    {t('view.tools.llm_endpoints.models_add')}
                                </Button>
                            </div>
                            <p
                                id="llm-endpoint-manual-models-hint"
                                className="text-muted-foreground text-xs"
                            >
                                {t(
                                    'view.tools.llm_endpoints.models_manual_hint'
                                )}
                            </p>
                        </fieldset>
                    </div>
                )}

                {view === 'edit' ? (
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={closeEditView}
                        >
                            {t('common.actions.cancel')}
                        </Button>
                        <Button
                            type="button"
                            disabled={loading || saving || !baseUrlValid}
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

type EndpointRowProps = {
    endpoint: LlmEndpointDto;
    disabled: boolean;
    onDetect: () => void;
    onEdit: () => void;
    onDelete: () => void;
};

function EndpointRow({
    endpoint,
    disabled,
    onDetect,
    onEdit,
    onDelete
}: EndpointRowProps) {
    const { t } = useTranslation();
    const unusable = !endpoint.models.length;

    return (
        <div
            className={cn(
                'grid gap-2 rounded-md border px-3 py-2.5',
                unusable && 'border-destructive/40'
            )}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="grid min-w-0 gap-0.5">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">
                            {endpoint.name}
                        </span>
                        <Badge
                            variant={endpoint.hasKey ? 'secondary' : 'outline'}
                        >
                            {endpoint.hasKey
                                ? t('view.tools.llm_endpoints.key_saved')
                                : t('view.tools.llm_endpoints.key_empty')}
                        </Badge>
                    </div>
                    <span className="text-muted-foreground truncate text-xs">
                        {endpoint.baseUrl}
                    </span>
                    {unusable ? null : (
                        <span className="text-muted-foreground truncate text-xs">
                            {formatModelSummary(endpoint.models)}
                        </span>
                    )}
                </div>
                <div className="flex shrink-0 gap-1">
                    <RowAction
                        label={t('view.tools.llm_endpoints.detect_models')}
                        disabled={disabled}
                        onClick={onDetect}
                    >
                        <RefreshCwIcon data-icon="inline-start" />
                    </RowAction>
                    <RowAction
                        label={t('view.tools.llm_endpoints.edit')}
                        disabled={disabled}
                        onClick={onEdit}
                    >
                        <SquarePenIcon data-icon="inline-start" />
                    </RowAction>
                    <RowAction
                        label={t('view.tools.llm_endpoints.delete')}
                        disabled={disabled}
                        onClick={onDelete}
                    >
                        <Trash2Icon data-icon="inline-start" />
                    </RowAction>
                </div>
            </div>
            {unusable ? (
                <div className="text-destructive flex flex-wrap items-center gap-2 text-xs">
                    <AlertTriangleIcon className="size-3.5" />
                    <span>{t('view.tools.llm_endpoints.unusable')}</span>
                    <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={disabled}
                        onClick={onDetect}
                    >
                        {t('view.tools.llm_endpoints.detect_models')}
                    </Button>
                </div>
            ) : null}
        </div>
    );
}

type RowActionProps = {
    label: string;
    disabled: boolean;
    onClick: () => void;
    children: React.ReactNode;
};

function RowAction({ label, disabled, onClick, children }: RowActionProps) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={label}
                        disabled={disabled}
                        onClick={onClick}
                    />
                }
            >
                {children}
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}
