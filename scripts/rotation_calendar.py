"""Verified TW closure corrections, not a complete exchange calendar.

Only add dates with an official notice. Unknown long gaps remain unavailable.
The 2026-10-23 emergency closure was announced on 2026-10-22:
https://www.twfhcsec.com.tw/News/NewsContent?ID=1502
The 2026-10-26 substitute holiday is in TWSE's 2026 schedule:
https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=html
"""
from datetime import date, timedelta


TW_VERIFIED_CLOSURES = frozenset({date(2026, 10, 23), date(2026, 10, 26)})


def verified_tw_closure_gap(previous, current):
    """A long gap is valid only when all intervening weekdays are verified closed."""
    if previous >= current or previous.weekday() >= 5 or current.weekday() >= 5:
        return False
    if previous in TW_VERIFIED_CLOSURES or current in TW_VERIFIED_CLOSURES:
        return False
    day = previous + timedelta(days=1)
    saw_closure = False
    while day < current:
        if day.weekday() < 5:
            if day not in TW_VERIFIED_CLOSURES:
                return False
            saw_closure = True
        day += timedelta(days=1)
    return saw_closure
