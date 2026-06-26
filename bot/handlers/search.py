from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from handlers.states import Search
from services import sheets
from utils.formatting import format_row_card
from utils.keyboards import (
    BTN_SEARCH,
    editable_fields_kb,
    main_menu,
    order_action_kb,
    search_results_kb,
)

router = Router()
log = logging.getLogger(__name__)


@router.message(F.text == BTN_SEARCH)
async def cmd_search(message: Message, state: FSMContext) -> None:
    await state.clear()
    await state.set_state(Search.waiting_query)
    await message.answer("Введите трек-номер для поиска:")


@router.message(Search.waiting_query, F.text)
async def on_search_query(message: Message, state: FSMContext) -> None:
    query = message.text.strip()
    try:
        results = await sheets.search_by_track(query)
    except Exception:
        log.exception("Sheets search error")
        await message.answer("Ошибка при поиске. Попробуйте ещё раз.", reply_markup=main_menu())
        await state.clear()
        return

    if not results:
        await message.answer(f"Заказ не найден.", reply_markup=main_menu())
        await state.clear()
        return

    if len(results) == 1:
        row_num, row_dict = results[0]
        await state.update_data(row_num=row_num)
        await state.set_state(Search.viewing_result)
        await message.answer(format_row_card(row_dict), reply_markup=order_action_kb())
        return

    await state.update_data(search_results=[(r, d) for r, d in results])
    await state.set_state(Search.viewing_result)
    await message.answer(
        f"Найдено {len(results)} совпадений. Выберите:",
        reply_markup=search_results_kb(results),
    )


@router.callback_query(Search.viewing_result, F.data.startswith("selectrow:"))
async def on_select_row(call: CallbackQuery, state: FSMContext) -> None:
    await call.answer()
    row_num = int(call.data.split(":")[1])
    await state.update_data(row_num=row_num)
    try:
        row_dict = await sheets.get_row(row_num)
    except Exception:
        log.exception("Failed to get row")
        await call.message.answer("Ошибка при загрузке заказа.", reply_markup=main_menu())
        await state.clear()
        return
    await call.message.edit_reply_markup(reply_markup=None)
    await call.message.answer(format_row_card(row_dict), reply_markup=order_action_kb())


@router.callback_query(Search.viewing_result, F.data == "rowaction:cancel")
@router.callback_query(Search.viewing_result, F.data == "search:cancel")
async def on_search_cancel(call: CallbackQuery, state: FSMContext) -> None:
    await call.answer()
    await call.message.edit_reply_markup(reply_markup=None)
    await state.clear()
    await call.message.answer("Отменено.", reply_markup=main_menu())


@router.callback_query(Search.viewing_result, F.data == "rowaction:edit")
async def on_row_edit(call: CallbackQuery, state: FSMContext) -> None:
    await call.answer()
    await call.message.edit_reply_markup(reply_markup=None)
    await state.set_state(Search.choosing_field)
    await call.message.answer("Какое поле изменить?", reply_markup=editable_fields_kb())


@router.callback_query(Search.choosing_field, F.data.startswith("field:"))
async def on_choose_field(call: CallbackQuery, state: FSMContext) -> None:
    await call.answer()
    field = call.data.split(":", 1)[1]

    if field == "cancel":
        await call.message.edit_reply_markup(reply_markup=None)
        await state.set_state(Search.viewing_result)
        data = await state.get_data()
        row_num: int = data["row_num"]
        try:
            row_dict = await sheets.get_row(row_num)
        except Exception:
            await call.message.answer("Ошибка.", reply_markup=main_menu())
            await state.clear()
            return
        await call.message.answer(format_row_card(row_dict), reply_markup=order_action_kb())
        return

    await state.update_data(editing_field=field)
    await state.set_state(Search.entering_new_value)
    await call.message.edit_reply_markup(reply_markup=None)
    await call.message.answer(f"Введите новое значение для поля [{field}]:")


@router.message(Search.entering_new_value, F.text)
async def on_new_field_value(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    row_num: int = data["row_num"]
    field: str = data["editing_field"]
    new_value = message.text.strip()

    try:
        await sheets.update_field(row_num, field, new_value)
        row_dict = await sheets.get_row(row_num)
    except Exception:
        log.exception("Failed to update field")
        await message.answer("Ошибка при обновлении.", reply_markup=main_menu())
        await state.clear()
        return

    await state.set_state(Search.viewing_result)
    await message.answer("Изменено\n\n" + format_row_card(row_dict), reply_markup=order_action_kb())
