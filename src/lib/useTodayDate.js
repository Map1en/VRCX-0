import { useEffect, useState } from 'react';

function millisecondsUntilNextLocalDay() {
    const now = new Date();
    const nextDay = new Date(now);
    nextDay.setHours(24, 0, 1, 0);
    return Math.max(1000, nextDay.getTime() - now.getTime());
}

export function useTodayDate() {
    const [todayDate, setTodayDate] = useState(() => new Date());

    useEffect(() => {
        let timeoutId = window.setTimeout(function refreshToday() {
            setTodayDate(new Date());
            timeoutId = window.setTimeout(
                refreshToday,
                millisecondsUntilNextLocalDay()
            );
        }, millisecondsUntilNextLocalDay());

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, []);

    return todayDate;
}
