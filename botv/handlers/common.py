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
CRM_OPEN_BUTTON_TEXT = "Открыть"
CRM_MOBILE_BUTTON_TEXT = "📱 Мобильная версия"
CRM_DESKTOP_BUTTON_TEXT = "💻 Версия для ПК"
START_KEYBOARD = ReplyKeyboardMarkup(
    keyboard=[
        [KeyboardButton(text=CRM_OPEN_BUTTON_TEXT)],
        [KeyboardButton(text=START_BUTTON_TEXT)],
    ],
    resize_keyboard=True,
    is_persistent=True,
    one_time_keyboard=False,
    input_field_placeholder="Нажми «Открыть», «Начать» или отправь файл/ссылку",
)
CRM_VERSION_KEYBOARD = InlineKeyboardMarkup(
    inline_keyboard=[
        [InlineKeyboardButton(text=CRM_MOBILE_BUTTON_TEXT, web_app=WebAppInfo(url=config.crm_mobile_url))],
        [InlineKeyboardButton(text=CRM_DESKTOP_BUTTON_TEXT, url=config.crm_desktop_url)],
    ],
)


async def _start_flow(message: Message, state: FSMContext) -> None:
    await state.clear()
    await state.set_state(DropStates.waiting_archive)
    await message.answer(WELCOME, reply_markup=START_KEYBOARD)
    await message.answer("CRM можно открыть в мобильной версии или версии для ПК.", reply_markup=CRM_VERSION_KEYBOARD)


@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext) -> None:
    await _start_flow(message, state)


@router.message(F.text == START_BUTTON_TEXT)
async def start_button(message: Message, state: FSMContext) -> None:
    await _start_flow(message, state)


@router.message(F.text == CRM_OPEN_BUTTON_TEXT)
async def crm_open_button(message: Message) -> None:
    await message.answer("Выбери версию CRM:", reply_markup=CRM_VERSION_KEYBOARD)


@router.message(Command("cancel"))
async def cmd_cancel(message: Message, state: FSMContext) -> None:
    await state.clear()
    await state.set_state(DropStates.waiting_archive)
    await message.answer("Отменено.", reply_markup=START_KEYBOARD)


@router.message(Command("help"))
async def cmd_help(message: Message) -> None:
    await message.answer(WELCOME, reply_markup=START_KEYBOARD)
