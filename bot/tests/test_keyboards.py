from __future__ import annotations

from handlers.common import CRM_WINDOW_KEYBOARD
from utils.keyboards import BTN_MINI_APP, main_menu


def test_main_menu_has_crm_mini_app_button():
    keyboard = main_menu()
    button = keyboard.keyboard[0][0]

    assert button.text == BTN_MINI_APP
    assert button.web_app is not None
    assert button.web_app.url == "https://crmavito.duckdns.org"


def test_crm_window_keyboard_uses_url_button():
    button = CRM_WINDOW_KEYBOARD.inline_keyboard[0][0]

    assert button.url == "https://crmavito.duckdns.org"
    assert button.web_app is None
