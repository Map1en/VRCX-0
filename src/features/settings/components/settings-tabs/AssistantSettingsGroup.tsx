import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { RuntimeModelSelect } from '@/features/assistant/components/RuntimeModelSelect';
import {
    commands,
    type AssistantRuntimeSelection,
    type PlaybookMode
} from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import {
    openLlmEndpointsManager,
    useLlmEndpointsStore
} from '@/state/llmEndpointsStore';
import { Button } from '@/ui/shadcn/button';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';

const PLAYBOOK_MODES: PlaybookMode[] = ['auto', 'guided', 'open'];

type AssistantSettingsGroupProps = {
    active: boolean;
};

const EMPTY_SELECTION: AssistantRuntimeSelection = {
    endpointId: null,
    model: null,
    allowWrites: false,
    playbookMode: 'auto'
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function AssistantSettingsGroup({
    active
}: AssistantSettingsGroupProps) {
    const { t } = useTranslation();
    const endpoints = useLlmEndpointsStore((state) => state.endpoints);
    const loadEndpoints = useLlmEndpointsStore((state) => state.load);
    const [selection, setSelection] =
        useState<AssistantRuntimeSelection>(EMPTY_SELECTION);
    const [followCustomProxy, setFollowCustomProxy] = useState(true);
    const [proxyLoading, setProxyLoading] = useState(false);
    const [endpointsLoaded, setEndpointsLoaded] = useState(false);
    const showSetupGate =
        endpointsLoaded &&
        !endpoints.some((endpoint) => endpoint.models.length);

    useEffect(() => {
        if (!active) {
            return;
        }
        let stale = false;
        loadEndpoints()
            .catch(() => {})
            .finally(() => {
                if (!stale) {
                    setEndpointsLoaded(true);
                }
            });
        commands
            .appAssistantRuntimeStatus()
            .then((status) => {
                if (!stale) {
                    setSelection(status.lastSelection);
                }
            })
            .catch(() => {});
        commands
            .appLlmEndpointFollowCustomProxy()
            .then((enabled) => {
                if (!stale) {
                    setFollowCustomProxy(enabled);
                }
            })
            .catch(() => {});
        return () => {
            stale = true;
        };
    }, [active, loadEndpoints]);

    async function updateSelection(patch: Partial<AssistantRuntimeSelection>) {
        setSelection((current) => ({ ...current, ...patch }));
        try {
            const status = await commands.appAssistantRuntimeStatus();
            const next = { ...status.lastSelection, ...patch };
            setSelection(
                await commands.appAssistantSetDefaultRuntime(
                    next.endpointId,
                    next.model,
                    next.allowWrites,
                    next.playbookMode
                )
            );
        } catch (error) {
            toast.add({ type: 'error', title: errorMessage(error) });
        }
    }

    async function updateFollowCustomProxy(enabled: boolean) {
        setProxyLoading(true);
        try {
            setFollowCustomProxy(
                await commands.appLlmEndpointSetFollowCustomProxy(enabled)
            );
        } catch (error) {
            toast.add({ type: 'error', title: errorMessage(error) });
        } finally {
            setProxyLoading(false);
        }
    }

    const playbookItems = PLAYBOOK_MODES.map((mode) => ({
        value: mode,
        label: t(`assistant.settings.playbook_mode_${mode}`)
    }));

    return (
        <>
            <SettingsCard
                cardId="ai.assistant"
                title={t('view.settings.ai.header')}
                description={t('view.settings.ai.description')}
            >
                {showSetupGate ? (
                    <div className="flex flex-col items-center gap-3 py-6 text-center">
                        <span className="text-muted-foreground text-sm">
                            {t('view.settings.ai.setup_hint')}
                        </span>
                        <Button
                            type="button"
                            size="sm"
                            onClick={openLlmEndpointsManager}
                        >
                            {t('view.tools.llm_endpoints.add')}
                        </Button>
                    </div>
                ) : (
                    <>
                        <Field
                            settingId="ai.assistant.default-model"
                            label={t('view.settings.ai.default_model')}
                            description={t(
                                'view.settings.ai.default_model_description'
                            )}
                        >
                            <RuntimeModelSelect
                                endpointId={selection.endpointId}
                                model={selection.model}
                                placeholder={t(
                                    'view.settings.ai.default_model_unset'
                                )}
                                emptyLabel={t(
                                    'view.settings.ai.default_model_unset'
                                )}
                                onSelect={(ref) => void updateSelection(ref)}
                            />
                        </Field>

                        <Field
                            settingId="ai.assistant.playbook-mode"
                            label={t('assistant.runtime.playbook_mode')}
                            description={t(
                                'view.settings.ai.playbook_mode_description'
                            )}
                        >
                            <Select
                                value={selection.playbookMode}
                                items={playbookItems}
                                onValueChange={(value) =>
                                    void updateSelection({
                                        playbookMode: value ?? 'auto'
                                    })
                                }
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {playbookItems.map((item) => (
                                            <SelectItem
                                                key={item.value}
                                                value={item.value}
                                            >
                                                {item.label}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </Field>
                    </>
                )}
            </SettingsCard>

            <SettingsCard
                cardId="ai.endpoints"
                title={t('view.tools.llm_endpoints.title')}
                description={t('view.tools.llm_endpoints.description')}
                action={
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={openLlmEndpointsManager}
                    >
                        {t('assistant.runtime.manage_endpoints')}
                    </Button>
                }
            >
                <Field
                    settingId="ai.endpoints.follow-custom-proxy"
                    label={t('view.tools.llm_endpoints.follow_custom_proxy')}
                    description={t(
                        'view.tools.llm_endpoints.follow_custom_proxy_description'
                    )}
                >
                    <Switch
                        checked={followCustomProxy}
                        disabled={proxyLoading}
                        onCheckedChange={updateFollowCustomProxy}
                    />
                </Field>
            </SettingsCard>
        </>
    );
}
