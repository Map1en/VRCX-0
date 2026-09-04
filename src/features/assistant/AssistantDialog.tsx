import { PanelRightIcon, Settings2Icon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import {
    getEffectiveReasoningEffort,
    getModelReasoning,
    getValidReasoningEfforts,
    shouldShowReasoningEffortSelector
} from '@/features/llm/reasoning';
import { cn } from '@/lib/utils';
import {
    commands,
    type AssistantRuntimeSelection,
    type PlaybookMode,
    type Session
} from '@/platform/tauri/bindings';
import { useAssistantChatStore } from '@/state/assistantChatStore';
import { useLlmEndpointsStore } from '@/state/llmEndpointsStore';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Empty,
    EmptyContent,
    EmptyHeader,
    EmptyTitle
} from '@/ui/shadcn/empty';
import { Label } from '@/ui/shadcn/label';
import {
    Popover,
    PopoverContent,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger
} from '@/ui/shadcn/popover';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup
} from '@/ui/shadcn/resizable';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import {
    cancelActiveTurn,
    openSession,
    refreshSessions,
    sendMessage,
    setEntityPanelOpen
} from './assistantActions';
import { AssistantTranscript } from './components/AssistantTranscript';
import { Composer } from './components/Composer';
import { EntityPanel } from './components/EntityPanel';
import { RuntimeModelSelect } from './components/RuntimeModelSelect';
import { SessionSidebar } from './components/SessionSidebar';
import type { AssistantHealth } from './useAssistantHealth';
import { useAssistantHealth } from './useAssistantHealth';
import { useAssistantRuntimeStatus } from './useAssistantRuntimeStatus';

const HEALTH_DOT_CLASS: Record<AssistantHealth, string> = {
    checking: 'bg-amber-500 animate-pulse',
    ok: 'bg-emerald-500',
    error: 'bg-destructive',
    unconfigured: 'bg-muted-foreground/50'
};

const DEFAULT_RUNTIME_SELECTION: AssistantRuntimeSelection = {
    endpointId: null,
    model: null,
    allowWrites: false,
    playbookMode: 'auto'
};

const PLAYBOOK_MODES: PlaybookMode[] = ['auto', 'guided', 'open'];

function selectionFromSession(session: Session): AssistantRuntimeSelection {
    return {
        endpointId: session.endpointId,
        model: session.model,
        allowWrites: session.allowWrites,
        playbookMode: session.playbookMode
    };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isEndpointRemovedError(error: unknown): boolean {
    return errorMessage(error).includes('assistant endpoint was removed');
}

export function AssistantDialog() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const runtimeStatus = useAssistantRuntimeStatus();
    const endpoints = useLlmEndpointsStore((state) => state.endpoints);
    const loadEndpoints = useLlmEndpointsStore((state) => state.load);
    const detectEndpointModels = useLlmEndpointsStore(
        (state) => state.detectModels
    );
    const [runtimeSelection, setRuntimeSelection] =
        useState<AssistantRuntimeSelection>(DEFAULT_RUNTIME_SELECTION);
    const [assistantReasoningEffort, setAssistantReasoningEffort] =
        useState('');
    const [endpointsLoaded, setEndpointsLoaded] = useState(false);

    const open = useAssistantChatStore((state) => state.open);
    const setOpen = useAssistantChatStore((state) => state.setOpen);
    const activeSessionId = useAssistantChatStore(
        (state) => state.activeSessionId
    );
    const entityPanelOpen = useAssistantChatStore((state) =>
        state.activeSessionId
            ? (state.entityPanelOpenBySession[state.activeSessionId] ?? false)
            : false
    );
    const messages = useAssistantChatStore((state) =>
        activeSessionId ? state.messagesBySession[activeSessionId] : undefined
    );
    const busy = useAssistantChatStore((state) =>
        activeSessionId ? Boolean(state.busySessions[activeSessionId]) : false
    );
    const selectedEndpoint = endpoints.find(
        (endpoint) => endpoint.id === runtimeSelection.endpointId
    );
    const hasRuntime = Boolean(selectedEndpoint && runtimeSelection.model);
    const showReasoningEffort = shouldShowReasoningEffortSelector(
        selectedEndpoint ?? null,
        runtimeSelection.model ?? null
    );
    const reasoningEffortOptions = showReasoningEffort
        ? getValidReasoningEfforts(
              getModelReasoning(
                  selectedEndpoint ?? null,
                  runtimeSelection.model ?? null
              )
          )
        : [];
    const effectiveAssistantEffort = showReasoningEffort
        ? (getEffectiveReasoningEffort(
              assistantReasoningEffort,
              getModelReasoning(
                  selectedEndpoint ?? null,
                  runtimeSelection.model ?? null
              )
          ) ?? '')
        : '';
    const health = useAssistantHealth(
        hasRuntime ? runtimeSelection.endpointId : null
    );

    useEffect(() => {
        if (open) {
            refreshSessions();
            loadEndpoints()
                .catch(() => {})
                .finally(() => setEndpointsLoaded(true));
            commands
                .appAssistantReasoningEffort()
                .then((effort) => setAssistantReasoningEffort(effort))
                .catch(() => {});
        }
    }, [loadEndpoints, open]);

    useEffect(() => {
        if (open && activeSessionId && !messages) {
            void openSession(activeSessionId).catch(() => {});
        }
    }, [activeSessionId, messages, open]);

    useEffect(() => {
        if (!activeSessionId && runtimeStatus?.lastSelection) {
            setRuntimeSelection(runtimeStatus.lastSelection);
        }
    }, [runtimeStatus, activeSessionId]);

    useEffect(() => {
        if (!open || !activeSessionId) {
            return;
        }
        let active = true;
        commands
            .appAssistantGetSession(activeSessionId)
            .then((session) => {
                if (active && session) {
                    setRuntimeSelection(selectionFromSession(session));
                }
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [activeSessionId, open]);

    async function updateRuntimeSelection(
        patch: Partial<AssistantRuntimeSelection>
    ) {
        const next = {
            ...runtimeSelection,
            ...patch
        };
        setRuntimeSelection(next);
        try {
            if (!activeSessionId) {
                const selection = await commands.appAssistantSetDefaultRuntime(
                    next.endpointId,
                    next.model,
                    next.allowWrites,
                    next.playbookMode
                );
                setRuntimeSelection(selection);
                return;
            }
            const session = await commands.appAssistantSetSessionRuntime(
                activeSessionId,
                next.endpointId,
                next.model,
                next.allowWrites,
                next.playbookMode
            );
            setRuntimeSelection(selectionFromSession(session));
        } catch (error) {
            toast.error(errorMessage(error));
        }
    }

    function refreshSelectableModels() {
        const stale = endpoints.filter(
            (endpoint) =>
                !endpoint.models.length ||
                endpoint.id === runtimeSelection.endpointId
        );
        for (const endpoint of stale) {
            detectEndpointModels({
                id: endpoint.id,
                baseUrl: null,
                apiKey: null,
                persist: true
            }).catch(() => {});
        }
    }

    async function updateReasoningEffort(effort: string) {
        const previous = assistantReasoningEffort;
        setAssistantReasoningEffort(effort);
        try {
            await commands.appAssistantSetReasoningEffort(effort);
        } catch (error) {
            setAssistantReasoningEffort(previous);
            toast.error(errorMessage(error));
        }
    }

    function openAssistantSettings() {
        setOpen(false);
        navigate('/settings?tab=ai');
    }

    async function handleSend(text: string) {
        try {
            await sendMessage(text);
        } catch (error) {
            if (isEndpointRemovedError(error)) {
                setRuntimeSelection((current) => ({
                    ...current,
                    endpointId: null,
                    model: null
                }));
                toast.error(t('assistant.not_configured'));
                return;
            }
            toast.error(errorMessage(error));
        }
    }

    const notConfigured = !hasRuntime;
    const showSetupGate = notConfigured && endpointsLoaded;
    const examplePrompts = useMemo(
        () => [
            t('assistant.example_1'),
            t('assistant.example_2'),
            t('assistant.example_3')
        ],
        [t]
    );

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent
                className="flex h-[84vh] w-[min(1360px,96vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
                showCloseButton={false}
                style={{ fontFamily: 'var(--vrcx-app-font-family, inherit)' }}
            >
                <DialogHeader className="border-border/40 flex-row items-center justify-between space-y-0 border-b py-3 pr-3 pl-4">
                    <DialogTitle
                        className="text-sm"
                        style={{ fontFamily: 'inherit' }}
                    >
                        {t('assistant.title')}
                    </DialogTitle>
                    <div className="flex items-center gap-1.5">
                        <Popover
                            onOpenChange={(popoverOpen) => {
                                if (popoverOpen) {
                                    refreshSelectableModels();
                                }
                            }}
                        >
                            <PopoverTrigger
                                render={
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 gap-1.5 px-2 text-xs"
                                    >
                                        <Settings2Icon
                                            data-icon="inline-start"
                                            className="size-4"
                                        />
                                        <span className="hidden max-w-40 truncate sm:inline">
                                            {selectedEndpoint?.name ||
                                                t(
                                                    'assistant.runtime.connection_unset'
                                                )}
                                        </span>
                                    </Button>
                                }
                            />
                            <PopoverContent align="end" className="w-80">
                                <PopoverHeader>
                                    <PopoverTitle>
                                        {t('assistant.runtime.title')}
                                    </PopoverTitle>
                                </PopoverHeader>
                                <div className="grid gap-3">
                                    {showSetupGate ? (
                                        <div className="grid gap-2.5 pb-1">
                                            <span className="text-muted-foreground">
                                                {t('assistant.setup_title')}
                                            </span>
                                            <Button
                                                type="button"
                                                size="sm"
                                                onClick={openAssistantSettings}
                                            >
                                                {t('assistant.open_settings')}
                                            </Button>
                                        </div>
                                    ) : (
                                        <RuntimeSettings
                                            selection={runtimeSelection}
                                            sessionScoped={Boolean(
                                                activeSessionId
                                            )}
                                            reasoningEffort={
                                                showReasoningEffort
                                                    ? effectiveAssistantEffort
                                                    : null
                                            }
                                            reasoningEffortOptions={
                                                reasoningEffortOptions
                                            }
                                            onSelectionChange={(patch) =>
                                                void updateRuntimeSelection(
                                                    patch
                                                )
                                            }
                                            onReasoningEffortChange={(effort) =>
                                                void updateReasoningEffort(
                                                    effort
                                                )
                                            }
                                            onOpenSettings={
                                                openAssistantSettings
                                            }
                                        />
                                    )}
                                </div>
                            </PopoverContent>
                        </Popover>
                        <span
                            className="text-muted-foreground mr-1 flex items-center gap-1.5 text-xs"
                            title={t(`assistant.connection.${health}`)}
                        >
                            <span
                                className={cn(
                                    'size-2 rounded-full',
                                    HEALTH_DOT_CLASS[health]
                                )}
                            />
                            <span className="hidden sm:inline">
                                {t(`assistant.connection.${health}`)}
                            </span>
                        </span>
                        <button
                            type="button"
                            onClick={() => setEntityPanelOpen(!entityPanelOpen)}
                            title={t('assistant.entities_title')}
                            className={cn(
                                'rounded-md p-1.5 transition-colors',
                                entityPanelOpen
                                    ? 'text-foreground bg-card'
                                    : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            <PanelRightIcon className="size-4" />
                        </button>
                        <DialogClose
                            className="text-muted-foreground hover:text-foreground rounded-md p-1.5 transition-colors"
                            title={t('assistant.close')}
                        >
                            <XIcon className="size-4" />
                            <span className="sr-only">
                                {t('assistant.close')}
                            </span>
                        </DialogClose>
                    </div>
                </DialogHeader>

                <ResizablePanelGroup
                    orientation="horizontal"
                    className="min-h-0 flex-1"
                >
                    <ResizablePanel
                        id="assistant-sessions"
                        defaultSize="20%"
                        minSize="12%"
                        maxSize="32%"
                    >
                        <SessionSidebar />
                    </ResizablePanel>
                    <ResizableHandle />
                    <ResizablePanel
                        id="assistant-chat"
                        defaultSize={entityPanelOpen ? '56%' : '80%'}
                        minSize="30%"
                    >
                        <div className="flex h-full min-w-0 flex-col">
                            <AssistantTranscript
                                sessionId={activeSessionId}
                                messages={messages}
                                thinkingLabel={t('assistant.thinking')}
                                scrollToLatestLabel={t(
                                    'assistant.scroll_to_latest'
                                )}
                                emptyState={
                                    <Empty className="py-12">
                                        <EmptyHeader>
                                            <EmptyTitle>
                                                {showSetupGate
                                                    ? t('assistant.setup_title')
                                                    : t(
                                                          'assistant.empty_title'
                                                      )}
                                            </EmptyTitle>
                                        </EmptyHeader>
                                        <EmptyContent>
                                            {showSetupGate ? (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    onClick={
                                                        openAssistantSettings
                                                    }
                                                >
                                                    {t(
                                                        'assistant.open_settings'
                                                    )}
                                                </Button>
                                            ) : (
                                                examplePrompts.map((prompt) => (
                                                    <Button
                                                        key={prompt}
                                                        type="button"
                                                        size="xs"
                                                        variant="outline"
                                                        disabled={notConfigured}
                                                        onClick={() =>
                                                            sendMessage(prompt)
                                                        }
                                                        className="h-auto max-w-full whitespace-normal"
                                                    >
                                                        {prompt}
                                                    </Button>
                                                ))
                                            )}
                                        </EmptyContent>
                                    </Empty>
                                }
                            />

                            {showSetupGate && messages?.length ? (
                                <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-2 px-3 pt-2 text-xs">
                                    <span>{t('assistant.not_configured')}</span>
                                    <Button
                                        type="button"
                                        size="xs"
                                        variant="outline"
                                        onClick={openAssistantSettings}
                                    >
                                        {t('assistant.open_settings')}
                                    </Button>
                                </div>
                            ) : null}
                            <Composer
                                busy={busy}
                                disabled={notConfigured}
                                onSend={handleSend}
                                onStop={() => cancelActiveTurn()}
                            />
                        </div>
                    </ResizablePanel>
                    {entityPanelOpen && (
                        <>
                            <ResizableHandle />
                            <ResizablePanel
                                id="assistant-entities"
                                defaultSize="24%"
                                minSize="288px"
                                maxSize="45%"
                            >
                                <EntityPanel />
                            </ResizablePanel>
                        </>
                    )}
                </ResizablePanelGroup>
            </DialogContent>
        </Dialog>
    );
}

type RuntimeSettingsProps = {
    selection: AssistantRuntimeSelection;
    sessionScoped: boolean;
    reasoningEffort: string | null;
    reasoningEffortOptions: string[];
    onSelectionChange: (patch: Partial<AssistantRuntimeSelection>) => void;
    onReasoningEffortChange: (effort: string) => void;
    onOpenSettings: () => void;
};

function RuntimeSettings({
    selection,
    sessionScoped,
    reasoningEffort,
    reasoningEffortOptions,
    onSelectionChange,
    onReasoningEffortChange,
    onOpenSettings
}: RuntimeSettingsProps) {
    const { t } = useTranslation();
    const providerDefaultEffort = t(
        'assistant.runtime.reasoning_effort_provider_default'
    );

    return (
        <>
            <div className="grid gap-1.5">
                <Label htmlFor="assistant-runtime-model">
                    {t('assistant.runtime.model')}
                </Label>
                <RuntimeModelSelect
                    id="assistant-runtime-model"
                    endpointId={selection.endpointId}
                    model={selection.model}
                    placeholder={t('assistant.runtime.model_unset')}
                    emptyLabel={t('assistant.runtime.model_unset')}
                    onSelect={onSelectionChange}
                />
            </div>
            {reasoningEffort !== null ? (
                <div className="grid gap-1.5">
                    <Label htmlFor="assistant-runtime-reasoning-effort">
                        {t('assistant.runtime.reasoning_effort')}
                    </Label>
                    <Select
                        value={reasoningEffort}
                        items={reasoningEffortOptions.map((effort) => ({
                            value: effort,
                            label: effort
                        }))}
                        onValueChange={(value) =>
                            onReasoningEffortChange(value ?? '')
                        }
                    >
                        <SelectTrigger
                            id="assistant-runtime-reasoning-effort"
                            className="data-placeholder:text-foreground w-full"
                        >
                            <SelectValue>
                                {reasoningEffort || providerDefaultEffort}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value="">
                                    {providerDefaultEffort}
                                </SelectItem>
                                {reasoningEffortOptions.map((effort) => (
                                    <SelectItem key={effort} value={effort}>
                                        {effort}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </div>
            ) : null}
            <div className="grid gap-1.5">
                <Label htmlFor="assistant-runtime-playbook">
                    {t('assistant.runtime.playbook_mode')}
                </Label>
                <Select
                    value={selection.playbookMode}
                    items={PLAYBOOK_MODES.map((mode) => ({
                        value: mode,
                        label: t(`assistant.settings.playbook_mode_${mode}`)
                    }))}
                    onValueChange={(value) =>
                        onSelectionChange({
                            playbookMode: value ?? 'auto'
                        })
                    }
                >
                    <SelectTrigger
                        id="assistant-runtime-playbook"
                        className="w-full"
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {PLAYBOOK_MODES.map((mode) => (
                                <SelectItem key={mode} value={mode}>
                                    {t(
                                        `assistant.settings.playbook_mode_${mode}`
                                    )}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </div>
            <div className="flex items-center justify-between gap-3 pt-0.5">
                <Label htmlFor="assistant-runtime-writes" className="text-sm">
                    {t('assistant.runtime.allow_writes')}
                </Label>
                <Switch
                    id="assistant-runtime-writes"
                    checked={selection.allowWrites}
                    onCheckedChange={(allowWrites) =>
                        onSelectionChange({ allowWrites })
                    }
                />
            </div>
            <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs">
                    {sessionScoped
                        ? t('assistant.runtime.scope_session')
                        : t('assistant.runtime.scope_default')}
                </span>
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-auto px-1.5 py-1 text-xs"
                    onClick={onOpenSettings}
                >
                    {t('assistant.open_settings')}
                </Button>
            </div>
        </>
    );
}
