from __future__ import annotations

from aiogram import Router
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message

from config import config
from utils.keyboards import main_menu

router = Router()

CRM_WINDOW_KEYBOARD = InlineKeyboardMarkup(
    inline_keyboard=[[InlineKeyboardButton(text="Открыть CRM в окне", url=config.mini_app_url)]],
)


@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer(
        "Привет! Я бот для учёта заказов.\n\n"
        "Отправьте фото товара и штрихкода, чтобы добавить новый заказ, "
        "или воспользуйтесь меню.",
        reply_markup=main_menu(),
    )
    await message.answer("Для ПК можно открыть CRM отдельным окном.", reply_markup=CRM_WINDOW_KEYBOARD)
