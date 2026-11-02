import { Questionnaire as QuestionnairePrimitive } from '@shadcn/react/questionnaire';
import { CheckIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';
import { buttonVariants, type Button } from '@/ui/shadcn/button';

function Questionnaire({
    className,
    ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Root>) {
    return (
        <QuestionnairePrimitive.Root
            data-slot="questionnaire"
            className={cn('flex w-full min-w-0 flex-col gap-4', className)}
            {...props}
        />
    );
}

function QuestionnaireProgress({
    className,
    ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Progress>) {
    return (
        <QuestionnairePrimitive.Progress
            data-slot="questionnaire-progress"
            className={cn(
                'text-muted-foreground min-h-[1lh] w-fit min-w-[14ch] text-xs font-medium tabular-nums',
                className
            )}
            {...props}
        />
    );
}

function QuestionnaireItem({
    className,
    ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Item>) {
    return (
        <QuestionnairePrimitive.Item
            data-slot="questionnaire-item"
            className={cn(
                'flex min-w-0 flex-col gap-4 border-0 p-0 outline-none',
                className
            )}
            {...props}
        />
    );
}

function QuestionnaireTitle({
    className,
    ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Title>) {
    return (
        <QuestionnairePrimitive.Title
            data-slot="questionnaire-title"
            className={cn(
                'font-heading text-base leading-snug font-medium text-pretty [&:not(:has(~[data-slot=questionnaire-description]))]:mb-4',
                className
            )}
            {...props}
        />
    );
}

function QuestionnaireDescription({
    className,
    ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Description>) {
    return (
        <QuestionnairePrimitive.Description
            data-slot="questionnaire-description"
            className={cn(
                'text-muted-foreground text-sm text-pretty',
                className
            )}
            {...props}
        />
    );
}

function QuestionnaireChoices({
    className,
    ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Choices>) {
    return (
        <QuestionnairePrimitive.Choices
            data-slot="questionnaire-choices"
            className={cn(
                'group/questionnaire-choices grid min-w-0 gap-2',
                className
            )}
            {...props}
        />
    );
}

function QuestionnaireChoice({
    children,
    className,
    ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Choice>) {
    return (
        <QuestionnairePrimitive.Choice
            data-slot="questionnaire-choice"
            className={cn(
                'group/questionnaire-choice border-input hover:bg-muted/50 has-[>input:focus-visible]:border-ring has-[>input:focus-visible]:ring-ring/50 data-invalid:border-destructive dark:bg-input/20 data-checked:border-primary/40 data-checked:bg-muted dark:data-checked:bg-muted relative flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border bg-transparent px-3 py-2.5 text-start text-sm transition-colors outline-none select-none has-[>input:focus-visible]:ring-3',
                'data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50',
                className
            )}
            {...props}
        >
            <QuestionnairePrimitive.ChoiceInput
                data-slot="questionnaire-choice-input"
                className="absolute inset-0 z-10 size-full cursor-pointer opacity-0"
            />
            <span
                aria-hidden="true"
                data-slot="questionnaire-choice-indicator"
                className="border-input group-data-checked/questionnaire-choice:border-primary group-data-checked/questionnaire-choice:bg-primary group-data-checked/questionnaire-choice:text-primary-foreground dark:bg-input/30 dark:group-data-checked/questionnaire-choice:bg-primary pointer-events-none relative flex size-4 shrink-0 translate-y-[--spacing(0.45)] items-center justify-center rounded-[4px] border group-has-data-[slot=questionnaire-choice-description]/questionnaire-choice:translate-y-0.5 group-data-[type=radio]/questionnaire-choice:rounded-full"
            >
                <span
                    data-slot="questionnaire-choice-indicator-dot"
                    className="bg-primary-foreground hidden size-2 rounded-full group-data-checked/questionnaire-choice:block group-data-[type=checkbox]/questionnaire-choice:hidden"
                />
                <CheckIcon
                    data-slot="questionnaire-choice-indicator-check"
                    className="hidden size-3.5 group-data-checked/questionnaire-choice:block group-data-[type=radio]/questionnaire-choice:hidden"
                />
            </span>
            <QuestionnairePrimitive.ChoiceLabel
                data-slot="questionnaire-choice-label"
                className="flex min-w-0 flex-1 flex-col gap-0.5 leading-snug"
            >
                {children}
            </QuestionnairePrimitive.ChoiceLabel>
            <QuestionnairePrimitive.ChoiceShortcut
                data-slot="questionnaire-choice-shortcut"
                className="border-input bg-background text-muted-foreground pointer-events-none ms-auto hidden size-5 shrink-0 translate-y-[--spacing(0.45)] items-center justify-center rounded-md border font-mono text-[0.625rem] leading-none font-medium group-has-data-[slot=questionnaire-choice-description]/questionnaire-choice:translate-y-0.5 group-data-[shortcut]/questionnaire-choice:inline-flex"
            />
        </QuestionnairePrimitive.Choice>
    );
}

function QuestionnaireChoiceDescription({
    className,
    ...props
}: React.ComponentProps<'span'>) {
    return (
        <span
            data-slot="questionnaire-choice-description"
            className={cn('text-muted-foreground', className)}
            {...props}
        />
    );
}

function QuestionnaireInput({
    className,
    ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Input>) {
    return (
        <div
            data-slot="questionnaire-input-wrapper"
            className="group/questionnaire-input relative w-full min-w-0"
        >
            <QuestionnairePrimitive.Input
                data-slot="questionnaire-input"
                className={cn(
                    'border-input focus-visible:border-ring focus-visible:ring-ring/50 disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 h-8 min-h-11 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-[color,box-shadow,background-color] outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 sm:min-h-0 md:text-sm',
                    'selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground',
                    className
                )}
                {...props}
            />
        </div>
    );
}

function QuestionnaireError({
    className,
    ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Error>) {
    return (
        <QuestionnairePrimitive.Error
            data-slot="questionnaire-error"
            className={cn('text-destructive mt-2 text-sm', className)}
            {...props}
        />
    );
}

function QuestionnaireActions({
    className,
    ...props
}: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="questionnaire-actions"
            className={cn(
                'grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 sm:min-h-8',
                className
            )}
            {...props}
        />
    );
}

function QuestionnairePrevious({
    children,
    className,
    size = 'default',
    variant = 'outline',
    ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Previous> &
    Pick<React.ComponentProps<typeof Button>, 'size' | 'variant'>) {
    return (
        <QuestionnairePrimitive.Previous
            data-slot="questionnaire-previous"
            data-size={size}
            data-variant={variant}
            className={cn(
                buttonVariants({ size, variant }),
                'col-start-1 row-start-1 min-h-11 justify-self-start sm:min-h-0',
                className
            )}
            {...props}
        >
            {children ?? 'Previous'}
        </QuestionnairePrimitive.Previous>
    );
}

function QuestionnaireSkip({
    children,
    className,
    size = 'default',
    variant = 'outline',
    ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Skip> &
    Pick<React.ComponentProps<typeof Button>, 'size' | 'variant'>) {
    return (
        <QuestionnairePrimitive.Skip
            data-slot="questionnaire-skip"
            data-size={size}
            data-variant={variant}
            className={cn(
                buttonVariants({ size, variant }),
                'col-start-2 row-start-1 min-h-11 justify-self-end sm:min-h-0',
                className
            )}
            {...props}
        >
            {children ?? 'Skip'}
        </QuestionnairePrimitive.Skip>
    );
}

function QuestionnaireNext({
    children,
    className,
    size = 'default',
    variant = 'default',
    ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Next> &
    Pick<React.ComponentProps<typeof Button>, 'size' | 'variant'>) {
    return (
        <QuestionnairePrimitive.Next
            data-slot="questionnaire-next"
            data-size={size}
            data-variant={variant}
            className={cn(
                buttonVariants({ size, variant }),
                'col-start-3 row-start-1 min-h-11 justify-self-end sm:min-h-0',
                className
            )}
            {...props}
        >
            {children ?? 'Next'}
        </QuestionnairePrimitive.Next>
    );
}

function QuestionnaireSubmit({
    children,
    className,
    size = 'default',
    variant = 'default',
    ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Submit> &
    Pick<React.ComponentProps<typeof Button>, 'size' | 'variant'>) {
    return (
        <QuestionnairePrimitive.Submit
            data-slot="questionnaire-submit"
            data-size={size}
            data-variant={variant}
            className={cn(
                buttonVariants({ size, variant }),
                'col-start-3 row-start-1 min-h-11 justify-self-end sm:min-h-0',
                className
            )}
            {...props}
        >
            {children ?? 'Submit'}
        </QuestionnairePrimitive.Submit>
    );
}

export {
    Questionnaire,
    QuestionnaireActions,
    QuestionnaireChoice,
    QuestionnaireChoiceDescription,
    QuestionnaireChoices,
    QuestionnaireDescription,
    QuestionnaireError,
    QuestionnaireInput,
    QuestionnaireItem,
    QuestionnaireNext,
    QuestionnairePrevious,
    QuestionnaireProgress,
    QuestionnaireSkip,
    QuestionnaireSubmit,
    QuestionnaireTitle
};
