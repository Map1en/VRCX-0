import {
    ArrowUpRightIcon,
    BrainIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    MessageCircleDashedIcon,
    PanelRightIcon,
    Settings2Icon,
    XIcon
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

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
import { toast } from '@/services/toastService';
import { useAssistantChatStore } from '@/state/assistantChatStore';
import { useLlmEndpointsStore } from '@/state/llmEndpointsStore';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from '@/ui/shadcn/empty';
import { InputGroupButton } from '@/ui/shadcn/input-group';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup
} from '@/ui/shadcn/resizable';

import {
    cancelActiveTurn,
    openSession,
    refreshSessions,
    sendMessage,
    setEntityPanelOpen
} from './assistantActions';
import { useDraftPrompts } from './components/AssistantFollowUps';
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
    const assistantDraft = useAssistantChatStore(
        (state) => state.assistantDraft
    );
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
    const activeTitle = useAssistantChatStore(
        (state) =>
            state.sessions.find((session) => session.id === activeSessionId)
                ?.title ?? null
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
            toast.add({ type: 'error', title: errorMessage(error) });
        }
    }

    function refreshSelectableModels() {
        const stale = endpoints.filter((endpoint) => !endpoint.models.length);
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
            toast.add({ type: 'error', title: errorMessage(error) });
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
                toast.add({
                    type: 'error',
                    title: t('assistant.not_configured')
                });
                return;
            }
            toast.add({ type: 'error', title: errorMessage(error) });
        }
    }

    const notConfigured = !hasRuntime;
    const showSetupGate = notConfigured && endpointsLoaded;
    const examplePrompts = useMemo(
        () =>
            [
                t('assistant.example_1'),
                t('assistant.example_2'),
                t('assistant.example_3')
            ].map((text) => ({ label: text, text })),
        [t]
    );
    const draftPrompts = useDraftPrompts(assistantDraft);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent
                className="flex h-[84vh] w-[min(1360px,96vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
                showCloseButton={false}
                style={{ fontFamily: 'var(--vrcx-app-font-family, inherit)' }}
            >
                <DialogHeader className="border-border/40 flex-row items-center justify-between gap-3 space-y-0 border-b py-2.5 pr-3 pl-4">
                    <div className="flex min-w-0 items-center gap-1.5 text-sm">
                        <DialogTitle
                            className="text-muted-foreground shrink-0 text-sm font-medium"
                            style={{ fontFamily: 'inherit' }}
                        >
                            {t('assistant.title')}
                        </DialogTitle>
                        {activeTitle ? (
                            <>
                                <ChevronRightIcon className="text-muted-foreground/60 size-3.5 shrink-0" />
                                <span className="truncate font-medium">
                                    {activeTitle}
                                </span>
                            </>
                        ) : null}
                    </div>
                    <div className="flex items-center gap-1.5">
                        <HintTooltip label={t('assistant.entities_title')}>
                            <button
                                type="button"
                                onClick={() =>
                                    setEntityPanelOpen(!entityPanelOpen)
                                }
                                className={cn(
                                    'rounded-md p-1.5 transition-colors',
                                    entityPanelOpen
                                        ? 'text-foreground bg-(--state-pressed-surface)'
                                        : 'text-muted-foreground hover:text-foreground hover:bg-(--state-hover-surface)'
                                )}
                            >
                                <PanelRightIcon className="size-4" />
                            </button>
                        </HintTooltip>
                        <HintTooltip label={t('assistant.close')}>
                            <DialogClose className="text-muted-foreground hover:text-foreground rounded-md p-1.5 transition-colors">
                                <XIcon className="size-4" />
                            </DialogClose>
                        </HintTooltip>
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
                                busy={busy}
                                onSend={handleSend}
                                thinkingLabel={t('assistant.thinking')}
                                pendingLabel={t('assistant.pending')}
                                scrollToLatestLabel={t(
                                    'assistant.scroll_to_latest'
                                )}
                                emptyState={
                                    <Empty className="pb-16">
                                        <EmptyHeader className="max-w-md gap-3">
                                            <EmptyMedia
                                                variant="icon"
                                                className="border-border/60 text-muted-foreground size-12 rounded-2xl border bg-(--state-hover-surface) [&_svg:not([class*='size-'])]:size-5"
                                            >
                                                <MessageCircleDashedIcon />
                                            </EmptyMedia>
                                            <EmptyTitle className="text-xl font-semibold">
                                                {showSetupGate
                                                    ? t('assistant.setup_title')
                                                    : t(
                                                          'assistant.empty_title'
                                                      )}
                                            </EmptyTitle>
                                            {showSetupGate ? null : (
                                                <EmptyDescription>
                                                    {t(
                                                        'assistant.empty_description'
                                                    )}
                                                </EmptyDescription>
                                            )}
                                        </EmptyHeader>
                                        {showSetupGate ? (
                                            <EmptyContent>
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
                                            </EmptyContent>
                                        ) : null}
                                    </Empty>
                                }
                            />

                            {showSetupGate && messages?.length ? (
                                <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-2 px-6 pb-2 text-xs">
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
                                suggestions={
                                    messages?.length || notConfigured
                                        ? undefined
                                        : assistantDraft
                                          ? draftPrompts
                                          : examplePrompts
                                }
                                key={
                                    assistantDraft
                                        ? `${assistantDraft.topic}:${assistantDraft.target?.id ?? ''}`
                                        : undefined
                                }
                                mentioned={assistantDraft?.target}
                                onSend={handleSend}
                                onStop={() => cancelActiveTurn()}
                                toolbar={
                                    <RuntimeToolbar
                                        selection={runtimeSelection}
                                        sessionScoped={Boolean(activeSessionId)}
                                        health={health}
                                        reasoningEffort={
                                            showReasoningEffort
                                                ? effectiveAssistantEffort
                                                : null
                                        }
                                        reasoningEffortOptions={
                                            reasoningEffortOptions
                                        }
                                        onModelsOpen={refreshSelectableModels}
                                        onSelectionChange={(patch) =>
                                            void updateRuntimeSelection(patch)
                                        }
                                        onReasoningEffortChange={(effort) =>
                                            void updateReasoningEffort(effort)
                                        }
                                        onOpenSettings={openAssistantSettings}
                                    />
                                }
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

type RuntimeToolbarProps = {
    selection: AssistantRuntimeSelection;
    sessionScoped: boolean;
    health: AssistantHealth;
    reasoningEffort: string | null;
    reasoningEffortOptions: string[];
    onModelsOpen: () => void;
    onSelectionChange: (patch: Partial<AssistantRuntimeSelection>) => void;
    onReasoningEffortChange: (effort: string) => void;
    onOpenSettings: () => void;
};

function RuntimeToolbar({
    selection,
    sessionScoped,
    health,
    reasoningEffort,
    reasoningEffortOptions,
    onModelsOpen,
    onSelectionChange,
    onReasoningEffortChange,
    onOpenSettings
}: RuntimeToolbarProps) {
    const { t } = useTranslation();
    const providerDefaultEffort = t(
        'assistant.runtime.reasoning_effort_provider_default'
    );
    const guided = selection.playbookMode === 'guided';

    return (
        <>
            <RuntimeModelSelect
                endpointId={selection.endpointId}
                model={selection.model}
                placeholder={t('assistant.runtime.search_models')}
                emptyLabel={t('assistant.runtime.model_unset')}
                onOpenChange={(open) => {
                    if (open) {
                        onModelsOpen();
                    }
                }}
                onSelect={onSelectionChange}
            >
                <span
                    className={cn(
                        'size-2 shrink-0 rounded-full',
                        HEALTH_DOT_CLASS[health]
                    )}
                    title={t(`assistant.connection.${health}`)}
                />
                <span className="max-w-48 truncate">
                    {selection.model || t('assistant.runtime.model_unset')}
                </span>
            </RuntimeModelSelect>
            {reasoningEffort !== null ? (
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={
                            <InputGroupButton
                                size="sm"
                                title={t('assistant.runtime.reasoning_effort')}
                            />
                        }
                    >
                        <BrainIcon />
                        {reasoningEffort || providerDefaultEffort}
                        <ChevronDownIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="top" className="w-48">
                        <DropdownMenuGroup>
                            <DropdownMenuLabel>
                                {t('assistant.runtime.reasoning_effort')}
                            </DropdownMenuLabel>
                            <DropdownMenuRadioGroup
                                value={reasoningEffort}
                                onValueChange={(value) =>
                                    onReasoningEffortChange(String(value ?? ''))
                                }
                            >
                                <DropdownMenuRadioItem value="" closeOnClick>
                                    {providerDefaultEffort}
                                </DropdownMenuRadioItem>
                                {reasoningEffortOptions.map((effort) => (
                                    <DropdownMenuRadioItem
                                        key={effort}
                                        value={effort}
                                        closeOnClick
                                    >
                                        {effort}
                                    </DropdownMenuRadioItem>
                                ))}
                            </DropdownMenuRadioGroup>
                        </DropdownMenuGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : null}
            <DropdownMenu>
                <HintTooltip
                    label={t(
                        guided
                            ? 'assistant.runtime.guided_hint'
                            : 'assistant.runtime.title'
                    )}
                >
                    <DropdownMenuTrigger
                        render={
                            <InputGroupButton
                                size={guided ? 'sm' : 'icon-sm'}
                                aria-label={
                                    guided
                                        ? undefined
                                        : t('assistant.runtime.title')
                                }
                                className={cn(
                                    guided &&
                                        'bg-amber-500/10 text-amber-600 hover:bg-amber-500/15 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-400'
                                )}
                            />
                        }
                    >
                        <Settings2Icon />
                        {guided && t('assistant.runtime.guided_badge')}
                    </DropdownMenuTrigger>
                </HintTooltip>
                <DropdownMenuContent side="top" className="w-64">
                    <p className="text-muted-foreground px-1.5 py-1 text-xs">
                        {sessionScoped
                            ? t('assistant.runtime.scope_session')
                            : t('assistant.runtime.scope_default')}
                    </p>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        <DropdownMenuLabel>
                            {t('assistant.runtime.playbook_mode')}
                        </DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                            value={selection.playbookMode}
                            onValueChange={(value) =>
                                onSelectionChange({
                                    playbookMode:
                                        PLAYBOOK_MODES.find(
                                            (mode) => mode === value
                                        ) ?? 'auto'
                                })
                            }
                        >
                            {PLAYBOOK_MODES.map((mode) => (
                                <DropdownMenuRadioItem
                                    key={mode}
                                    value={mode}
                                    closeOnClick
                                >
                                    {t(
                                        `assistant.settings.playbook_mode_${mode}`
                                    )}
                                </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                        {guided && (
                            <p className="px-1.5 py-1 text-xs text-amber-600 dark:text-amber-400">
                                {t('assistant.runtime.guided_hint')}
                            </p>
                        )}
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                        checked={selection.allowWrites}
                        onCheckedChange={(allowWrites) =>
                            onSelectionChange({ allowWrites })
                        }
                    >
                        {t('assistant.runtime.allow_writes')}
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onOpenSettings}>
                        {t('assistant.runtime.more_settings')}
                        <ArrowUpRightIcon className="text-muted-foreground ml-auto" />
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    );
}
