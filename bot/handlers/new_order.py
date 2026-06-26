from __future__ import annotations

import logging

from aiogram import Bot, F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import default_state
from aiogram.types import CallbackQuery, InputMediaPhoto, Message

from config import config
from handlers.states import NewOrder
from services import ocr as ocr_service
from services import sheets
from utils.formatting import format_order_card, format_new_order_summary
from utils.keyboards import (
    BTN_NEW_ORDER,
    main_menu,
    new_order_confirm_kb,
    order_status_kb,
    payment_status_kb,
    quantity_kb,
    sale_point_kb,
    skip_kb,
)

router = Router()
log = logging.getLogger(__name__)


# ── Трекинг сообщений для удаления ────────────────────────────────────────────

async def _track(state: FSMContext, *msg_ids: int) -> None:
    data = await state.get_data()
    ids = data.get("_msg_ids", [])
    ids.extend(m for m in msg_ids if m)
    await state.update_data(_msg_ids=ids)


async def _cleanup(bot: Bot, chat_id: int, state: FSMContext) -> None:
    data = await state.get_data()
    for msg_id in data.get("_msg_ids", []):
        try:
            await bot.delete_message(chat_id, msg_id)
        except Exception:
            pass


# ── Вход ──────────────────────────────────────────────────────────────────────

@router.message(F.text == BTN_NEW_ORDER)
async def cmd_new_order(message: Message, state: FSMContext) -> None:
    await state.clear()
    await _track(state, message.message_id)
    await state.set_state(NewOrder.waiting_product_photo)
    reply = await message.answer("Отправьте фото товара.")
    await _track(state, reply.message_id)


@router.message(StateFilter(default_state), F.photo)
async def photo_in_idle(message: Message, state: FSMContext) -> None:
    await state.clear()
    await _track(state, message.message_id)
    await state.update_data(product_photo_id=message.photo[-1].file_id,
                            media_group_id=message.media_group_id)
    await state.set_state(NewOrder.waiting_barcode_photo)
    if not message.media_group_id:
        reply = await message.answer("Фото товара получено. Отправьте фото штрихкода.")
        await _track(state, reply.message_id)


# ── Фото 1 ────────────────────────────────────────────────────────────────────

@router.message(NewOrder.waiting_product_photo, F.photo)
async def got_product_photo(message: Message, state: FSMContext) -> None:
    await _track(state, message.message_id)
    await state.update_data(product_photo_id=message.photo[-1].file_id,
                            media_group_id=message.media_group_id)
    await state.set_state(NewOrder.waiting_barcode_photo)
    if not message.media_group_id:
        reply = await message.answer("Теперь отправьте фото штрихкода.")
        await _track(state, reply.message_id)


# ── Фото 2 + OCR ──────────────────────────────────────────────────────────────

@router.message(NewOrder.waiting_barcode_photo, F.photo)
async def got_barcode_photo(message: Message, state: FSMContext, bot: Bot) -> None:
    await _track(state, message.message_id)
    await state.update_data(barcode_photo_id=message.photo[-1].file_id)

    status = await message.answer("Читаю трек-номер... ⏳")
    file = await bot.get_file(message.photo[-1].file_id)
    buf = await bot.download_file(file.file_path)
    image_bytes = buf.read()

    try:
        track, carrier = ocr_service.process_barcode_image(image_bytes)
    except Exception:
        log.exception("OCR failed")
        track, carrier = "", ""

    await status.delete()
    await state.update_data(track=track, carrier=carrier)

    if ocr_service.is_track_valid(track):
        carrier_line = f"\nТК: {carrier}" if carrier else ""
        reply = await message.answer(f"Трек: {track}{carrier_line}\n\nКакой размер?")
        await _track(state, reply.message_id)
        await state.set_state(NewOrder.waiting_size)
    else:
        await state.set_state(NewOrder.waiting_manual_track)
        reply = await message.answer("Не смог распознать трек. Введите вручную:")
        await _track(state, reply.message_id)


# ── Ручной трек ───────────────────────────────────────────────────────────────

@router.message(NewOrder.waiting_manual_track, F.text)
async def got_manual_track(message: Message, state: FSMContext) -> None:
    await _track(state, message.message_id)
    await state.update_data(track=message.text.strip())
    await state.set_state(NewOrder.waiting_size)
    reply = await message.answer("Какой размер?")
    await _track(state, reply.message_id)


# ── Размер → Количество ───────────────────────────────────────────────────────

@router.message(NewOrder.waiting_size, F.text)
async def got_size(message: Message, state: FSMContext) -> None:
    await _track(state, message.message_id)
    await state.update_data(size=message.text.strip().upper())
    await state.set_state(NewOrder.waiting_quantity)
    reply = await message.answer("Количество:", reply_markup=quantity_kb())
    await _track(state, reply.message_id)


# ── Количество ────────────────────────────────────────────────────────────────

@router.callback_query(NewOrder.waiting_quantity, F.data.startswith("qty:"))
async def on_qty_button(call: CallbackQuery, state: FSMContext) -> None:
    await call.answer()
    await _track(state, call.message.message_id)
    val = call.data.split(":")[1]
    if val == "other":
        await call.message.edit_reply_markup(reply_markup=None)
        reply = await call.message.answer("Введите количество:")
        await _track(state, reply.message_id)
        return
    await state.update_data(quantity=val)
    await call.message.edit_reply_markup(reply_markup=None)
    await _ask_sale_price(call.message, state)


@router.message(NewOrder.waiting_quantity, F.text)
async def on_qty_text(message: Message, state: FSMContext) -> None:
    await _track(state, message.message_id)
    await state.update_data(quantity=message.text.strip())
    await _ask_sale_price(message, state)


async def _ask_sale_price(message: Message, state: FSMContext) -> None:
    await state.set_state(NewOrder.waiting_sale_price)
    reply = await message.answer("Цена продажи (за 1 шт.):", reply_markup=skip_kb())
    await _track(state, reply.message_id)


# ── Цена продажи ──────────────────────────────────────────────────────────────

@router.callback_query(NewOrder.waiting_sale_price, F.data == "skip")
async def skip_sale_price(call: CallbackQuery, state: FSMContext) -> None:
    await call.answer()
    await _track(state, call.message.message_id)
    await state.update_data(sale_price="")
    await call.message.edit_reply_markup(reply_markup=None)
    await _ask_purchase_cost(call.message, state)


@router.message(NewOrder.waiting_sale_price, F.text)
async def on_sale_price(message: Message, state: FSMContext) -> None:
    await _track(state, message.message_id)
    await state.update_data(sale_price=message.text.strip())
    await _ask_purchase_cost(message, state)


async def _ask_purchase_cost(message: Message, state: FSMContext) -> None:
    await state.set_state(NewOrder.waiting_purchase_cost)
    reply = await message.answer("Закупочная стоимость:", reply_markup=skip_kb())
    await _track(state, reply.message_id)


# ── Закупка ───────────────────────────────────────────────────────────────────

@router.callback_query(NewOrder.waiting_purchase_cost, F.data == "skip")
async def skip_purchase_cost(call: CallbackQuery, state: FSMContext) -> None:
    await call.answer()
    await _track(state, call.message.message_id)
    await state.update_data(purchase_cost="")
    await call.message.edit_reply_markup(reply_markup=None)
    await _ask_expenses(call.message, state)


@router.message(NewOrder.waiting_purchase_cost, F.text)
async def on_purchase_cost(message: Message, state: FSMContext) -> None:
    await _track(state, message.message_id)
    await state.update_data(purchase_cost=message.text.strip())
    await _ask_expenses(message, state)


async def _ask_expenses(message: Message, state: FSMContext) -> None:
    await state.set_state(NewOrder.waiting_expenses)
    reply = await message.answer("Траты:", reply_markup=skip_kb())
    await _track(state, reply.message_id)


# ── Траты ─────────────────────────────────────────────────────────────────────

@router.callback_query(NewOrder.waiting_expenses, F.data == "skip")
async def skip_expenses(call: CallbackQuery, state: FSMContext) -> None:
    await call.answer()
    await _track(state, call.message.message_id)
    await state.update_data(expenses="")
    await call.message.edit_reply_markup(reply_markup=None)
    await _ask_profit(call.message, state)


@router.message(NewOrder.waiting_expenses, F.text)
async def on_expenses(message: Message, state: FSMContext) -> None:
    await _track(state, message.message_id)
    await state.update_data(expenses=message.text.strip())
    await _ask_profit(message, state)


async def _ask_profit(message: Message, state: FSMContext) -> None:
    await state.set_state(NewOrder.waiting_profit)
    reply = await message.answer("Прибыль:", reply_markup=skip_kb())
    await _track(state, reply.message_id)


# ── Прибыль ───────────────────────────────────────────────────────────────────

@router.callback_query(NewOrder.waiting_profit, F.data == "skip")
async def skip_profit(call: CallbackQuery, state: FSMContext) -> None:
    await call.answer()
    await _track(state, call.message.message_id)
    await state.update_data(profit="")
    await call.message.edit_reply_markup(reply_markup=None)
    await _ask_order_status(call.message, state)


@router.message(NewOrder.waiting_profit, F.text)
async def on_profit(message: Message, state: FSMContext) -> None:
    await _track(state, message.message_id)
    await state.update_data(profit=message.text.strip())
    await _ask_order_status(message, state)


async def _ask_order_status(message: Message, state: FSMContext) -> None:
    await state.set_state(NewOrder.waiting_order_status)
    reply = await message.answer("Статус заказа:", reply_markup=order_status_kb())
    await _track(state, reply.message_id)


# ── Статус заказа ─────────────────────────────────────────────────────────────

@router.callback_query(NewOrder.waiting_order_status, F.data.startswith("status:"))
async def on_order_status(call: CallbackQuery, state: FSMContext) -> None:
    await call.answer()
    await _track(state, call.message.message_id)
    val = call.data.split(":", 1)[1]
    if val == "other":
        await call.message.edit_reply_markup(reply_markup=None)
        reply = await call.message.answer("Введите статус заказа:")
        await _track(state, reply.message_id)
        return
    await state.update_data(order_status=val)
    await call.message.edit_reply_markup(reply_markup=None)
    await _ask_sale_point(call.message, state)


@router.message(NewOrder.waiting_order_status, F.text)
async def on_order_status_text(message: Message, state: FSMContext) -> None:
    await _track(state, message.message_id)
    await state.update_data(order_status=message.text.strip())
    await _ask_sale_point(message, state)


async def _ask_sale_point(message: Message, state: FSMContext) -> None:
    await state.set_state(NewOrder.waiting_sale_point)
    reply = await message.answer("Точка продаж:", reply_markup=sale_point_kb(config.sale_points))
    await _track(state, reply.message_id)


# ── Точка продаж ──────────────────────────────────────────────────────────────

@router.callback_query(NewOrder.waiting_sale_point, F.data.startswith("salepoint:"))
async def on_sale_point(call: CallbackQuery, state: FSMContext) -> None:
    await call.answer()
    await _track(state, call.message.message_id)
    val = call.data.split(":", 1)[1]
    if val == "other":
        await call.message.edit_reply_markup(reply_markup=None)
        reply = await call.message.answer("Введите точку продаж:")
        await _track(state, reply.message_id)
        return
    await state.update_data(sale_point=val)
    await call.message.edit_reply_markup(reply_markup=None)
    await _ask_payment_status(call.message, state)


@router.message(NewOrder.waiting_sale_point, F.text)
async def on_sale_point_text(message: Message, state: FSMContext) -> None:
    await _track(state, message.message_id)
    await state.update_data(sale_point=message.text.strip())
    await _ask_payment_status(message, state)


async def _ask_payment_status(message: Message, state: FSMContext) -> None:
    await state.set_state(NewOrder.waiting_payment_status)
    reply = await message.answer("Статус оплаты поставщику:", reply_markup=payment_status_kb())
    await _track(state, reply.message_id)


# ── Статус оплаты ─────────────────────────────────────────────────────────────

@router.callback_query(NewOrder.waiting_payment_status, F.data.startswith("payment:"))
async def on_payment_status(call: CallbackQuery, state: FSMContext) -> None:
    await call.answer()
    await _track(state, call.message.message_id)
    val = call.data.split(":", 1)[1]
    if val == "other":
        await call.message.edit_reply_markup(reply_markup=None)
        reply = await call.message.answer("Введите статус оплаты поставщику:")
        await _track(state, reply.message_id)
        return
    await state.update_data(payment_status=val)
    await call.message.edit_reply_markup(reply_markup=None)
    await _ask_counterparty(call.message, state)


@router.message(NewOrder.waiting_payment_status, F.text)
async def on_payment_status_text(message: Message, state: FSMContext) -> None:
    await _track(state, message.message_id)
    await state.update_data(payment_status=message.text.strip())
    await _ask_counterparty(message, state)


async def _ask_counterparty(message: Message, state: FSMContext) -> None:
    await state.set_state(NewOrder.waiting_counterparty)
    reply = await message.answer("Контрагент:", reply_markup=skip_kb())
    await _track(state, reply.message_id)


# ── Контрагент ────────────────────────────────────────────────────────────────

@router.callback_query(NewOrder.waiting_counterparty, F.data == "skip")
async def skip_counterparty(call: CallbackQuery, state: FSMContext, bot: Bot) -> None:
    await call.answer()
    await _track(state, call.message.message_id)
    await state.update_data(counterparty="")
    await call.message.edit_reply_markup(reply_markup=None)
    await _show_confirm(call.message, state, bot)


@router.message(NewOrder.waiting_counterparty, F.text)
async def on_counterparty(message: Message, state: FSMContext, bot: Bot) -> None:
    await _track(state, message.message_id)
    await state.update_data(counterparty=message.text.strip())
    await _show_confirm(message, state, bot)


# ── Карточка подтверждения с фото ─────────────────────────────────────────────

async def _show_confirm(message: Message, state: FSMContext, bot: Bot) -> None:
    await state.set_state(NewOrder.confirming)
    data = await state.get_data()

    try:
        album_msgs = await bot.send_media_group(
            message.chat.id,
            media=[
                InputMediaPhoto(media=data["product_photo_id"]),
                InputMediaPhoto(media=data["barcode_photo_id"]),
            ],
        )
        await _track(state, *[m.message_id for m in album_msgs])
    except Exception:
        log.exception("Failed to send preview photos")

    summary = format_new_order_summary(data)
    card_msg = await message.answer(summary, reply_markup=new_order_confirm_kb())
    await _track(state, card_msg.message_id)


# ── Подтверждение / Отмена ────────────────────────────────────────────────────

@router.callback_query(NewOrder.confirming, F.data == "neworder:confirm")
async def on_confirm(call: CallbackQuery, state: FSMContext, bot: Bot) -> None:
    await call.answer()
    chat_id = call.message.chat.id
    data = await state.get_data()

    # Удаляем все сообщения диалога
    await _cleanup(bot, chat_id, state)

    # Отправляем в группу (2 фото + краткий текст)
    caption = format_order_card(
        track=data.get("track", ""),
        carrier=data.get("carrier", ""),
        size=data.get("size", ""),
    )
    try:
        await bot.send_media_group(
            config.group_chat_id,
            media=[
                InputMediaPhoto(media=data["product_photo_id"]),
                InputMediaPhoto(media=data["barcode_photo_id"], caption=caption),
            ],
        )
    except Exception:
        log.exception("Failed to send to group")
        await bot.send_message(chat_id, "⚠️ Не удалось отправить в группу.")

    # Пишем в таблицу
    try:
        await sheets.append_order(
            track=data.get("track", ""),
            quantity=data.get("quantity", "1"),
            sale_price=data.get("sale_price", ""),
            purchase_cost=data.get("purchase_cost", ""),
            expenses=data.get("expenses", ""),
            profit=data.get("profit", ""),
            order_status=data.get("order_status", "Отправлен"),
            sale_point=data.get("sale_point", ""),
            payment_status=data.get("payment_status", ""),
            counterparty=data.get("counterparty", ""),
        )
    except Exception as e:
        log.exception("Failed to write to Sheets")
        await bot.send_message(chat_id, f"⚠️ В таблицу не записалось: {e}")

    await state.clear()
    await bot.send_message(chat_id, "Заказ добавлен ✅", reply_markup=main_menu())


@router.callback_query(NewOrder.confirming, F.data == "neworder:cancel")
async def on_cancel(call: CallbackQuery, state: FSMContext, bot: Bot) -> None:
    await call.answer()
    chat_id = call.message.chat.id
    await _cleanup(bot, chat_id, state)
    await state.clear()
    await bot.send_message(chat_id, "Отменено.", reply_markup=main_menu())


# ── Подсказки при неверном вводе ──────────────────────────────────────────────

@router.message(NewOrder.waiting_product_photo)
async def wrong_product(message: Message) -> None:
    await message.answer("Отправьте фото товара.")

@router.message(NewOrder.waiting_barcode_photo)
async def wrong_barcode(message: Message) -> None:
    await message.answer("Отправьте фото штрихкода.")

@router.message(NewOrder.waiting_size)
async def wrong_size(message: Message) -> None:
    await message.answer("Введите размер (например: M, 42, L/XL).")
