from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict

from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery, Message, TelegramObject

from config import config


class AllowlistMiddleware(BaseMiddleware):
    async def __call__(
        self,
        handler: Callable[[TelegramObject, Dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: Dict[str, Any],
    ) -> Any:
        if isinstance(event, (Message, CallbackQuery)):
            user = event.from_user
            if user and user.id not in config.allowed_user_ids:
                await event.answer("У вас нет доступа к этому боту.")
                return
        return await handler(event, data)
