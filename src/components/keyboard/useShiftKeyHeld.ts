import { useEffect, useState } from 'react';

export function useShiftKeyHeld() {
    const [shiftHeld, setShiftHeld] = useState(false);

    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === 'Shift') {
                setShiftHeld(true);
            }
        }
        function handleKeyUp(event: KeyboardEvent) {
            if (event.key === 'Shift') {
                setShiftHeld(false);
            }
        }
        function handleBlur() {
            setShiftHeld(false);
        }
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', handleBlur);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', handleBlur);
        };
    }, []);

    return shiftHeld;
}
