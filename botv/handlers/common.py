from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, KeyboardButton, Message, ReplyKeyboardMarkup, WebAppInfo

from config import config
from utils.states import DropStates

router = Router()


WELCOME = (
    "Пришли архив (.zip/.rar/.7z) или ссылку на Яндекс.Диск."
)

START_BUTTON_TEXT = "🚀 Начать"
MINI_APP_BUTTON_TEXT = "Открыть mini app"
MINI_APP_WINDOW_TEXT = "Открыть mini app в окне"
START_KEYBOARD = ReplyKeyboardMarkup(
    keyboard=[
        [KeyboardButton(text=MINI_APP_BUTTON_TEXT, web_app=WebAppInfo(url=config.mini_app_url))],
        [KeyboardButton(text=START_BUTTON_TEXT)],
    ],
    resize_keyboard=True,
    is_persistent=True,
    one_time_keyboard=False,
    input_field_placeholder="Нажми «Начать» или отправь файл/ссылку",
)
MINI_APP_WINDOW_KEYBOARD = InlineKeyboardMarkup(
    inline_keyboard=[[InlineKeyboardButton(text=MINI_APP_WINDOW_TEXT, url=config.mini_app_url)]],
)


async def _start_flow(message: Message, state: FSMContext) -> None:
    await state.clear()
    await state.set_state(DropStates.waiting_archive)
    await message.answer(WELCOME, reply_markup=START_KEYBOARD)
    await message.answer("Для ПК можно открыть mini app отдельным окном.", reply_markup=MINI_APP_WINDOW_KEYBOARD)


@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext) -> None:
    await _start_flow(message, state)


@router.message(F.text == START_BUTTON_TEXT)
async def start_button(message: Message, state: FSMContext) -> None:
    await _start_flow(message, state)


@router.message(Command("cancel"))
async def cmd_cancel(message: Message, state: FSMContext) -> None:
    await state.clear()
    await state.set_state(DropStates.waiting_archive)
    await message.answer("Отменено.", reply_markup=START_KEYBOARD)


@router.message(Command("help"))
async def cmd_help(message: Message) -> None:
    await message.answer(WELCOME, reply_markup=START_KEYBOARD)
