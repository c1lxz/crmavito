from __future__ import annotations

from aiogram.fsm.state import State, StatesGroup


class DropStates(StatesGroup):
    waiting_archive = State()
    waiting_prices = State()
    waiting_colors = State()
    waiting_rename = State()
    processing = State()
