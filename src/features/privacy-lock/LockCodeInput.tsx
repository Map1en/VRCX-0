import { REGEXP_ONLY_DIGITS } from 'input-otp';

import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/ui/shadcn/input-otp';

export const LOCK_CODE_LENGTH = 4;

export function LockCodeInput({
    id,
    value,
    onChange,
    onComplete,
    disabled = false,
    autoFocus = false,
    invalid = false
}: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    onComplete?: (value: string) => void;
    disabled?: boolean;
    autoFocus?: boolean;
    invalid?: boolean;
}) {
    return (
        <InputOTP
            id={id}
            value={value}
            maxLength={LOCK_CODE_LENGTH}
            inputMode="numeric"
            pattern={REGEXP_ONLY_DIGITS}
            disabled={disabled}
            autoFocus={autoFocus}
            aria-invalid={invalid || undefined}
            containerClassName="justify-center"
            onChange={onChange}
            onComplete={onComplete}
        >
            <InputOTPGroup>
                {Array.from({ length: LOCK_CODE_LENGTH }, (_, index) => (
                    <InputOTPSlot
                        key={index}
                        index={index}
                        masked
                        className="size-10 text-base"
                    />
                ))}
            </InputOTPGroup>
        </InputOTP>
    );
}
