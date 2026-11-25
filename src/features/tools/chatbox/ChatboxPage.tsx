import { useTranslation } from 'react-i18next';

import { PageBody, PageScaffold } from '@/components/layout/PageScaffold';
import { ToolPageHeader } from '@/components/layout/ToolPageHeader';
import { commands } from '@/platform/tauri/bindings';
import { chatboxStatusLabelKey } from '@/services/chatboxStatusLabel';
import { useChatboxStore } from '@/state/chatboxStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Empty,
    EmptyContent,
    EmptyHeader,
    EmptyTitle
} from '@/ui/shadcn/empty';
import { Spinner } from '@/ui/shadcn/spinner';

import { ChatboxAfkCard } from './components/ChatboxAfkCard';
import { ChatboxComposer } from './components/ChatboxComposer';
import { ChatboxConnectionMenu } from './components/ChatboxConnectionMenu';
import { ChatboxHeartRateCard } from './components/ChatboxHeartRateCard';
import { ChatboxPagesCard } from './components/ChatboxPagesCard';
import { ChatboxPreviewCard } from './components/ChatboxPreviewCard';
import { useChatboxController } from './useChatboxController';

export function ChatboxPage() {
    const { t } = useTranslation();
    const {
        config,
        meta,
        status,
        loadFailed,
        reload,
        updateConfig: onUpdate
    } = useChatboxController();
    const receivedAt = useChatboxStore((state) => state.receivedAt);

    const header = (
        <ToolPageHeader
            toolKey="chatbox"
            status={
                status ? (
                    <Badge variant="secondary">
                        {t(chatboxStatusLabelKey(status))}
                    </Badge>
                ) : null
            }
            actions={
                config ? (
                    <ChatboxConnectionMenu
                        config={config}
                        onUpdate={onUpdate}
                    />
                ) : null
            }
        />
    );

    return (
        <PageScaffold className="chatbox-page flex-1">
            {header}
            <PageBody>
                {config && meta ? (
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        <div className="grid items-start gap-3 pb-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                            <div className="flex flex-col gap-3 lg:sticky lg:top-0">
                                <ChatboxPreviewCard
                                    status={status}
                                    receivedAt={receivedAt}
                                    maxChars={meta.limits.maxChars}
                                />
                                <ChatboxComposer
                                    maxChars={meta.limits.maxChars}
                                    maxQuickPhrases={
                                        meta.limits.maxQuickPhrases
                                    }
                                    quickPhrases={config.messages.quickPhrases}
                                    typingIndicator={
                                        config.messages.typingIndicator
                                    }
                                    notifySound={config.messages.notifySound}
                                    pauseReason={status?.pauseReason ?? null}
                                    onUpdate={onUpdate}
                                />
                            </div>
                            <div className="flex flex-col gap-3">
                                <ChatboxPagesCard
                                    config={config}
                                    meta={meta}
                                    activePageId={
                                        status?.activity === 'status'
                                            ? status.pageId
                                            : null
                                    }
                                    onUpdate={onUpdate}
                                />
                                <ChatboxAfkCard
                                    config={config}
                                    limits={meta.limits}
                                    status={status}
                                    onUpdate={onUpdate}
                                    onManualAfkChange={(afk) =>
                                        void commands.appChatboxAfkSet(afk)
                                    }
                                />
                                <ChatboxHeartRateCard />
                            </div>
                        </div>
                    </div>
                ) : loadFailed ? (
                    <Empty className="flex-1">
                        <EmptyHeader>
                            <EmptyTitle>
                                {t('view.tools.chatbox.load_failed')}
                            </EmptyTitle>
                        </EmptyHeader>
                        <EmptyContent>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={reload}
                            >
                                {t('common.action.retry')}
                            </Button>
                        </EmptyContent>
                    </Empty>
                ) : (
                    <div className="flex flex-1 items-center justify-center">
                        <Spinner />
                    </div>
                )}
            </PageBody>
        </PageScaffold>
    );
}
