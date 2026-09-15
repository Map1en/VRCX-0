import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useState
} from 'react';

import { cn } from '@/lib/utils';

// Types
type TimelineContextValue = {
    activeStep: number;
    setActiveStep: (step: number) => void;
};

// Context
const TimelineContext = createContext<TimelineContextValue | undefined>(
    undefined
);

const useTimeline = () => {
    const context = useContext(TimelineContext);
    if (!context) {
        throw new Error('useTimeline must be used within a Timeline');
    }
    return context;
};

// Components
interface TimelineProps extends useRender.ComponentProps<'div'> {
    defaultValue?: number;
    value?: number;
    onValueChange?: (value: number) => void;
    orientation?: 'horizontal' | 'vertical';
}

function Timeline({
    defaultValue = 1,
    value,
    onValueChange,
    orientation = 'vertical',
    className,
    render,
    children,
    ...props
}: TimelineProps) {
    const [activeStep, setInternalStep] = useState(defaultValue);

    const setActiveStep = useCallback(
        (step: number) => {
            if (value === undefined) {
                setInternalStep(step);
            }
            onValueChange?.(step);
        },
        [value, onValueChange]
    );

    const currentStep = value ?? activeStep;
    const contextValue = useMemo(
        () => ({ activeStep: currentStep, setActiveStep }),
        [currentStep, setActiveStep]
    );

    const defaultProps = {
        className: cn(
            'group/timeline flex data-[orientation=horizontal]:w-full data-[orientation=horizontal]:flex-row data-[orientation=vertical]:flex-col',
            className
        ),
        'data-orientation': orientation,
        'data-slot': 'timeline',
        children
    };

    return (
        <TimelineContext.Provider value={contextValue}>
            {useRender({
                defaultTagName: 'div',
                render,
                props: mergeProps<'div'>(defaultProps, props)
            })}
        </TimelineContext.Provider>
    );
}

// TimelineContent

// TimelineDate
type TimelineDateProps = useRender.ComponentProps<'time'>;

function TimelineDate({
    className,
    render,
    children,
    ...props
}: TimelineDateProps) {
    const defaultProps = {
        className: cn(
            'text-muted-foreground mb-1 block text-xs font-medium group-data-[orientation=vertical]/timeline:max-sm:h-4',
            className
        ),
        'data-slot': 'timeline-date',
        children
    };

    return useRender({
        defaultTagName: 'time',
        render,
        props: mergeProps<'time'>(defaultProps, props)
    });
}

// TimelineHeader
function TimelineHeader({
    className,
    render,
    children,
    ...props
}: useRender.ComponentProps<'div'>) {
    const defaultProps = {
        className: cn(className),
        'data-slot': 'timeline-header',
        children
    };

    return useRender({
        defaultTagName: 'div',
        render,
        props: mergeProps<'div'>(defaultProps, props)
    });
}

// TimelineIndicator
type TimelineIndicatorProps = useRender.ComponentProps<'div'>;

function TimelineIndicator({
    className,
    children,
    render,
    ...props
}: TimelineIndicatorProps) {
    const defaultProps = {
        'aria-hidden': true,
        className: cn(
            'border-primary/20 group-data-completed/timeline-item:border-primary absolute size-4 rounded-full border-2 group-data-[orientation=horizontal]/timeline:-top-6 group-data-[orientation=horizontal]/timeline:left-0 group-data-[orientation=horizontal]/timeline:-translate-y-1/2 group-data-[orientation=vertical]/timeline:top-0 group-data-[orientation=vertical]/timeline:-left-6 group-data-[orientation=vertical]/timeline:-translate-x-1/2',
            className
        ),
        'data-slot': 'timeline-indicator',
        children
    };

    return useRender({
        defaultTagName: 'div',
        render,
        props: mergeProps<'div'>(defaultProps, props)
    });
}

// TimelineItem
interface TimelineItemProps extends useRender.ComponentProps<'div'> {
    step: number;
}

function TimelineItem({
    step,
    className,
    render,
    children,
    ...props
}: TimelineItemProps) {
    const { activeStep } = useTimeline();

    const defaultProps = {
        className: cn(
            'group/timeline-item has-[+[data-completed]]:**:data-[slot=timeline-separator]:bg-primary relative flex flex-1 flex-col gap-0.5 group-data-[orientation=horizontal]/timeline:mt-8 group-data-[orientation=horizontal]/timeline:not-last:pe-8 group-data-[orientation=vertical]/timeline:ms-8 group-data-[orientation=vertical]/timeline:not-last:pb-6',
            className
        ),
        'data-completed': step <= activeStep || undefined,
        'data-slot': 'timeline-item',
        children
    };

    return useRender({
        defaultTagName: 'div',
        render,
        props: mergeProps<'div'>(defaultProps, props)
    });
}

// TimelineSeparator
function TimelineSeparator({
    className,
    render,
    children,
    ...props
}: useRender.ComponentProps<'div'>) {
    const defaultProps = {
        'aria-hidden': true,
        className: cn(
            'bg-primary/10 absolute self-start group-last/timeline-item:hidden group-data-[orientation=horizontal]/timeline:-top-6 group-data-[orientation=horizontal]/timeline:h-0.5 group-data-[orientation=horizontal]/timeline:w-[calc(100%-1rem-0.25rem)] group-data-[orientation=horizontal]/timeline:translate-x-4.5 group-data-[orientation=horizontal]/timeline:-translate-y-1/2 group-data-[orientation=vertical]/timeline:-left-6 group-data-[orientation=vertical]/timeline:h-[calc(100%-1rem-0.25rem)] group-data-[orientation=vertical]/timeline:w-0.5 group-data-[orientation=vertical]/timeline:-translate-x-1/2 group-data-[orientation=vertical]/timeline:translate-y-4.5',
            className
        ),
        'data-slot': 'timeline-separator',
        children
    };

    return useRender({
        defaultTagName: 'div',
        render,
        props: mergeProps<'div'>(defaultProps, props)
    });
}

// TimelineTitle
function TimelineTitle({
    className,
    render,
    children,
    ...props
}: useRender.ComponentProps<'h3'>) {
    const defaultProps = {
        className: cn('text-sm font-medium', className),
        'data-slot': 'timeline-title',
        children
    };

    return useRender({
        defaultTagName: 'h3',
        render,
        props: mergeProps<'h3'>(defaultProps, props)
    });
}

export {
    Timeline,
    TimelineDate,
    TimelineHeader,
    TimelineIndicator,
    TimelineItem,
    TimelineSeparator,
    TimelineTitle
};
