from __future__ import annotations

from aiogram import Router
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import Message

from utils.keyboards import main_menu

router = Router()


@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer(
        "Привет! Я бот для учёта заказов.\n\n"
        "Отправьте фото товара и штрихкода, чтобы добавить новый заказ, "
        "или воспользуйтесь меню.",
        reply_markup=main_menu(),
    )
