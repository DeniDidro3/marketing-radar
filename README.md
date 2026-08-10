# Marketing Radar MVP

Статический performance-dashboard, который можно разместить на GitHub Pages.
Python на компьютере руководителя не нужен.

## Что уже есть

- Overview с KPI и health score
- Anomaly Radar
- Budget Optimizer
- Creative Fatigue
- `data/report.json` как слой данных
- `update_data.py` для генерации отчёта
- GitHub Actions для ежедневного обновления
- ручной запуск workflow через `workflow_dispatch`

## Как запустить локально

Из папки проекта:

```bash
python -m http.server 8000
```

Откройте `http://localhost:8000`.

## Как выложить на GitHub Pages

1. Создайте репозиторий и загрузите содержимое этой папки в ветку `main`.
2. GitHub → Settings → Pages.
3. Выберите публикацию из ветки `main`, каталог `/ (root)`.
4. После публикации откройте выданный GitHub Pages URL.
5. GitHub Actions ежедневно запустит `update_data.py`, обновит `data/report.json` и закоммитит новый файл.

## Как подключить реальные API

В `update_data.py` замените `generate_demo_data()` на обработку данных из `fetch_source_data()`.

Токены не храните в коде. Добавьте их:
GitHub → Settings → Secrets and variables → Actions → New repository secret.

Например:
- `YANDEX_DIRECT_TOKEN`
- `YANDEX_METRIKA_TOKEN`

После этого передайте их workflow через `env`.

## Расписание

Сейчас workflow запускается в `06:17 UTC` ежедневно.
Изменяется в `.github/workflows/daily-update.yml`.

## Важно

GitHub Pages — публичный статический хостинг в типовом сценарии. Если в отчёте будут внутренние/конфиденциальные маркетинговые данные, не публикуйте такой dashboard публично без согласования. Для корпоративной версии лучше использовать закрытый хостинг/авторизацию.
