# botv — генератор XML для Avito

Telegram-бот, который принимает архив с папками товаров (по одной фотопапке на товар),
получает цены от пользователя, загружает фотографии на Яндекс.Диск и формирует
готовый XML-файл для импорта в Avito.

## Как это работает

1. `/start` → бот ждёт архив `.zip`, `.rar` или `.7z`.
2. Пользователь присылает архив со структурой:
   ```
   Дроп/
     Футболка Oversize Black/
       photo1.jpg
       photo2.jpg
     Футболка White Basic/
       photo1.jpg
     ...
   ```
3. Бот распаковывает архив, находит товары и присылает их список.
4. Пользователь кнопками задаёт отдельное название объявления для каждого товара.
   Имя папки при этом сохраняется как первая строка описания.
5. Пользователь вручную отправляет цену для каждого товара сообщением:
   ```
   Футболка Oversize Black — 3290
   Футболка White Basic — 2990
   Футболка Vintage Grey — 3490
   ```
6. GigaChat определяет цвет по фотографии. Если это не удалось, бот просит
   пользователя ввести цвета вручную.
7. Бот заливает фотографии на Яндекс.Диск, публикует их и получает прямые ссылки.
8. Для каждого товара бот случайно выбирает размер 46, 48 или 50 и создаёт
   отдельное объявление для каждого адреса из `settings/locations.json`.
9. Бот собирает XML по шаблону `settings/xml_schema.json` +
   `settings/avito_defaults.json` + `settings/description_template.txt`
   и отправляет пользователю готовый файл.

## Установка

```powershell
cd botv
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Для распаковки `.rar` необходим установленный `unrar` (Windows: положить `UnRAR.exe`
в PATH; Linux/Mac: `apt install unrar` / `brew install rar`).

## Настройка `.env`

| Переменная | Что это |
|---|---|
| `BOT_TOKEN` | Токен от @BotFather |
| `ALLOWED_USER_IDS` | Через запятую — Telegram user id, кому разрешён доступ |
| `YANDEX_DISK_TOKEN` | OAuth-токен Яндекс.Диска (получить: https://yandex.ru/dev/disk/poligon/) |
| `YANDEX_DISK_UPLOAD_DIR` | Папка на Диске, куда складывать товары (по умолчанию `Avito`) |
| `MAX_ARCHIVE_MB` | Максимальный размер архива (МБ) |
| `GIGACHAT_CREDENTIALS` | Ключ авторизации GigaChat API |
| `GIGACHAT_SCOPE` | Scope проекта GigaChat, обычно `GIGACHAT_API_PERS` |
| `GIGACHAT_MODEL` | Модель GigaChat, по умолчанию `GigaChat` |
| `GIGACHAT_VERIFY_SSL` | Проверка TLS-сертификата; для стандартного GigaChat endpoint на Windows обычно `false` |

## Запуск

```powershell
python main.py
```

## Настраиваемые файлы (без изменения кода)

- `settings/description_template.txt` — шаблон описания.
  Доступные плейсхолдеры: `{title}`, `{color}`.
- `settings/avito_defaults.json` — постоянные поля Avito
  (категория, тип товара, контакты и т.д.).
- `settings/locations.json` — города и точные адреса публикации. Один товар
  создаётся во всех указанных точках.
- `settings/color_rules.json` — правила определения цвета по ключевым словам
  в названии товара + значение по умолчанию.
- `settings/xml_schema.json` — корневой тег, атрибуты, порядок полей,
  префикс `Id`.

## Структура

```
botv/
├── main.py
├── config.py
├── middleware.py
├── requirements.txt
├── .env.example
├── handlers/
│   ├── common.py       # /start, /help, /cancel
│   └── drop.py         # приём архива, парсинг цен, генерация XML
├── services/
│   ├── archive.py      # распаковка zip/rar/7z, сканирование товаров
│   ├── color_detector.py
│   ├── description.py  # рендер шаблона описания
│   ├── price_parser.py # парсинг сообщения с ценами
│   ├── xml_generator.py
│   └── yandex_disk.py  # загрузка и публикация на Диск
├── settings/
│   ├── avito_defaults.json
│   ├── color_rules.json
│   ├── description_template.txt
│   └── xml_schema.json
├── utils/
│   └── states.py       # FSM состояния
└── tmp/                # временные файлы (в gitignore)
```

## Ошибки, которые бот обрабатывает

- Неподдерживаемый формат архива.
- Архив больше `MAX_ARCHIVE_MB`.
- Пустой архив / нет фотографий в папках.
- В сообщении с ценами не хватает какого-то товара.
- Ошибка загрузки на Яндекс.Диск для отдельного товара — остальные всё равно попадут в XML.
- Ошибка публикации / получения прямой ссылки.

## Замечания по XML

XML собирается по описанию из `xml_schema.json`. Порядок тегов внутри `<Ad>`
задан в поле `fields_order`. Всё, что есть в `avito_defaults.json`, но не в
`fields_order`, добавляется в конец. Изображения оформляются как:

```xml
<Images>
  <Image url="https://..."/>
  <Image url="https://..."/>
</Images>
```
