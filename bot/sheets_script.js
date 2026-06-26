// ═══════════════════════════════════════════════════════
//  Бот учёта заказов — Apps Script для Google Таблицы
//  Вставить в Extensions → Apps Script, сохранить,
//  развернуть как веб-приложение (доступ: Все)
// ═══════════════════════════════════════════════════════

const SECRET_KEY  = 'ЗАМЕНИТЕ_НА_ЛЮБОЙ_СЛУЧАЙНЫЙ_ТЕКСТ'; // придумайте любой пароль
const SHEET_NAME  = 'Заказы';   // название листа в таблице

// Порядок колонок — должен совпадать с ботом
const COLUMNS = [
  'Дата', 'Трек-номер', 'Наименование', 'Количество',
  'Цена продажи за 1 шт', 'Выручка', 'Закупка', 'Траты', 'Прибыль',
  'Статус заказа', 'Точка продаж', 'Статус оплаты поставщику', 'Контрагент'
];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.key !== SECRET_KEY) {
      return json({ error: 'Unauthorized' });
    }

    const sheet = SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(data.sheet || SHEET_NAME);

    if (!sheet) return json({ error: 'Sheet not found: ' + (data.sheet || SHEET_NAME) });

    switch (data.action) {

      case 'append':
        sheet.appendRow(data.row);
        return json({ status: 'ok' });

      case 'search': {
        const lastRow = sheet.getLastRow();
        if (lastRow < 2) return json({ results: [] });
        const trackVals = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
        const results = [];
        const q = (data.query || '').toLowerCase();
        trackVals.forEach((r, i) => {
          if (r[0] && r[0].toString().toLowerCase().includes(q)) {
            const rowNum = i + 2;
            const rowData = sheet.getRange(rowNum, 1, 1, COLUMNS.length).getValues()[0];
            results.push({ row_num: rowNum, row: rowData });
          }
        });
        return json({ results });
      }

      case 'get_row': {
        const rowData = sheet.getRange(data.row_num, 1, 1, COLUMNS.length).getValues()[0];
        return json({ row: rowData });
      }

      case 'update_cell':
        sheet.getRange(data.row_num, data.col_num).setValue(data.value);
        return json({ status: 'ok' });

      default:
        return json({ error: 'Unknown action: ' + data.action });
    }
  } catch (err) {
    return json({ error: err.toString() });
  }
}

function json(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
