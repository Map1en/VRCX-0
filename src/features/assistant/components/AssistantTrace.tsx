import { CheckIcon, SparklesIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { UIToolCall } from '@/domain/assistant/types';
import { Spinner } from '@/ui/shadcn/spinner';
import {
    Trace,
    TraceCollapsible,
    TraceCollapsibleContent,
    TraceCollapsibleTrigger,
    TraceIcon,
    TraceLine,
    TraceTitle
} from '@/ui/shadcn/trace';

const STEP_DISPLAY = {
    pending: { Icon: Spinner, status: 'running' },
    done: { Icon: CheckIcon, status: undefined },
    error: { Icon: XIcon, status: 'error' }
} as const satisfies Record<
    UIToolCall['status'],
    {
        Icon: React.ComponentType;
        status: React.ComponentProps<typeof TraceLine>['status'];
    }
>;

interface AssistantTraceProps {
    toolCalls: readonly UIToolCall[];
    running: boolean;
    thinkingLabel: string;
}

export function AssistantTrace({
    toolCalls,
    running,
    thinkingLabel
}: AssistantTraceProps) {
    const { t } = useTranslation();
    const summaryIcon = running ? <Spinner /> : <SparklesIcon />;

    if (toolCalls.length === 0) {
        return (
            <Trace role="status">
                <TraceLine status="running">
                    <TraceIcon>{summaryIcon}</TraceIcon>
                    <TraceTitle>{thinkingLabel}</TraceTitle>
                </TraceLine>
            </Trace>
        );
    }

    return (
        <Trace role={running ? 'status' : undefined}>
            <TraceCollapsible>
                <TraceCollapsibleTrigger>
                    <TraceLine status={running ? 'running' : undefined}>
                        <TraceIcon>{summaryIcon}</TraceIcon>
                        <TraceTitle>
                            {t(
                                running
                                    ? 'assistant.trace.working'
                                    : 'assistant.trace.done'
                            )}
                        </TraceTitle>
                    </TraceLine>
                </TraceCollapsibleTrigger>
                <TraceCollapsibleContent>
                    <Trace className="gap-1.5">
                        {toolCalls.map((call) => {
                            const { Icon, status } = STEP_DISPLAY[call.status];
                            return (
                                <TraceLine
                                    key={call.id}
                                    status={status}
                                    title={call.summary || undefined}
                                >
                                    <TraceIcon>
                                        <Icon />
                                    </TraceIcon>
                                    <TraceTitle className="font-mono text-xs">
                                        {call.name}
                                    </TraceTitle>
                                </TraceLine>
                            );
                        })}
                    </Trace>
                </TraceCollapsibleContent>
            </TraceCollapsible>
        </Trace>
    );
}
