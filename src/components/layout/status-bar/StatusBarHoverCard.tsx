import {
    type ComponentProps,
    type ReactElement,
    type ReactNode,
    useState
} from 'react';
import { useTranslation } from 'react-i18next';

import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger
} from '@/ui/shadcn/hover-card';
import { Kbd } from '@/ui/shadcn/kbd';

export type StatusBarHoverCardActions = {
    click?: string;
    rightClick?: string;
};

export function StatusBarHoverCard({
    trigger,
    icon,
    title,
    state,
    description,
    actions,
    suppressed = false,
    side = 'top',
    children
}: {
    trigger: ReactElement;
    icon: ReactNode;
    title: string;
    state?: ReactNode;
    description?: ReactNode;
    actions: StatusBarHoverCardActions;
    suppressed?: boolean;
    side?: ComponentProps<typeof HoverCardContent>['side'];
    children?: ReactNode;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);

    return (
        <HoverCard open={open && !suppressed} onOpenChange={setOpen}>
            <HoverCardTrigger
                delay={400}
                closeDelay={100}
                render={trigger}
                onPointerDown={() => setOpen(false)}
                onContextMenu={() => setOpen(false)}
            />
            <HoverCardContent
                side={side}
                align="end"
                className="flex w-72 flex-col gap-2 text-xs"
            >
                <div className="flex items-center gap-2">
                    <span className="text-muted-foreground inline-flex shrink-0 [&_svg]:size-4">
                        {icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {title}
                    </span>
                    {state ? (
                        <span className="text-muted-foreground shrink-0">
                            {state}
                        </span>
                    ) : null}
                </div>
                {description ? (
                    <p className="text-muted-foreground leading-relaxed">
                        {description}
                    </p>
                ) : null}
                {children}
                <div className="flex flex-col gap-1 border-t pt-2">
                    {actions.click ? (
                        <div className="flex items-center gap-2">
                            <Kbd>{t('status_bar.card.click')}</Kbd>
                            <span className="text-muted-foreground">
                                {actions.click}
                            </span>
                        </div>
                    ) : null}
                    {actions.rightClick ? (
                        <div className="flex items-center gap-2">
                            <Kbd>{t('status_bar.card.right_click')}</Kbd>
                            <span className="text-muted-foreground">
                                {actions.rightClick}
                            </span>
                        </div>
                    ) : null}
                </div>
            </HoverCardContent>
        </HoverCard>
    );
}
