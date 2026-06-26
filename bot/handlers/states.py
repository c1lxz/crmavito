from aiogram.fsm.state import State, StatesGroup


class NewOrder(StatesGroup):
    waiting_product_photo = State()
    waiting_barcode_photo = State()
    waiting_size = State()
    waiting_manual_track = State()
    waiting_quantity = State()
    waiting_sale_price = State()
    waiting_purchase_cost = State()
    waiting_expenses = State()
    waiting_profit = State()
    waiting_counterparty = State()
    waiting_order_status = State()
    waiting_sale_point = State()
    waiting_payment_status = State()
    confirming = State()


class Search(StatesGroup):
    waiting_query = State()
    viewing_result = State()
    choosing_field = State()
    entering_new_value = State()
