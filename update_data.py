"""
Marketing Radar — data builder.

Сейчас generate_demo_data() создаёт демонстрационные данные.
Когда подключите Яндекс Директ / Метрику, замените функцию fetch_source_data()
и передавайте реальные агрегаты в build_report().
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from pathlib import Path
import json
import random

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data" / "report.json"

def fetch_source_data():
    # TODO:
    # 1. Прочитать токены из ENV / GitHub Secrets, а НЕ из репозитория.
    # 2. Получить данные Direct API.
    # 3. Получить конверсии из Metrika API.
    # 4. Вернуть нормализованные дневные данные.
    return None

def generate_demo_data():
    rnd = random.Random(datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    campaigns = [
        {"name":"PPEM","spend":64200,"cpa":3567,"cr":4.6,"score":92},
        {"name":"AXE White Paper","spend":85300,"cpa":4265,"cr":3.8,"score":84},
        {"name":"Enterprise","spend":121400,"cpa":7825,"cr":2.1,"score":61},
        {"name":"Enterprise 1C","spend":96700,"cpa":8640,"cr":1.9,"score":53},
        {"name":"Gate","spend":47200,"cpa":11200,"cr":1.4,"score":38},
    ]
    alerts = [
        {"severity":"critical","title":"6 площадок РСЯ расходуют бюджет без конверсий","description":"За 30 дней площадки получили 214 кликов и не дали ни одной целевой конверсии.","impact":"−18 420 ₽ потенциал","entity":"Enterprise / РСЯ"},
        {"severity":"critical","title":"CPA Enterprise 1C выше нормы","description":"CPA на 36% выше собственного среднего за предыдущие 30 дней при сопоставимом объёме трафика.","impact":"CPA +36%","entity":"Enterprise 1C"},
        {"severity":"warning","title":"Creative AXE-04 показывает признаки выгорания","description":"CTR снижается 9 дней подряд, одновременно CPA вырос относительно первых 7 дней размещения.","impact":"CTR −38%","entity":"AXE / Creative 04"},
        {"severity":"warning","title":"CPC Gate растёт быстрее рынка кампании","description":"Средний CPC вырос на 24%, а конверсия страницы не улучшилась.","impact":"CPC +24%","entity":"Gate"},
        {"severity":"opportunity","title":"PPEM сохраняет низкий CPA при росте объёма","description":"Кампания масштабируется без заметного ухудшения стоимости конверсии.","impact":"+15 000 ₽ бюджет","entity":"PPEM"},
        {"severity":"opportunity","title":"AXE стабильно эффективнее среднего","description":"CPA ниже медианы активных кампаний, CR остаётся стабильным последние две недели.","impact":"+10 000 ₽ бюджет","entity":"AXE"},
    ]
    creatives = [
        {"name":"AXE-04","fatigue_score":82,"ctr_change":-38,"cpa_change":41,"recommendation":"Подготовить замену: оба ключевых показателя ухудшаются."},
        {"name":"Enterprise-07","fatigue_score":57,"ctr_change":-22,"cpa_change":18,"recommendation":"Оставить в ротации, но проверить ещё через несколько дней."},
        {"name":"PPEM-03","fatigue_score":21,"ctr_change":7,"cpa_change":-9,"recommendation":"Креатив стабилен, признаков выгорания нет."},
        {"name":"Gate-02","fatigue_score":68,"ctr_change":-29,"cpa_change":31,"recommendation":"Снизить долю показов и протестировать новую концепцию."},
        {"name":"1C-05","fatigue_score":35,"ctr_change":-8,"cpa_change":5,"recommendation":"Небольшое ухудшение в пределах рабочего диапазона."},
        {"name":"AXE-06","fatigue_score":18,"ctr_change":12,"cpa_change":-11,"recommendation":"Один из наиболее устойчивых активных креативов."},
    ]
    return {
        "meta":{
            "updated_at": (datetime.now(timezone.utc)+timedelta(hours=3)).strftime("%d.%m.%Y %H:%M"),
            "period_days":30,
            "source":"demo"
        },
        "summary":{
            "spend":414800,
            "spend_change":6.4,
            "conversions":71,
            "conversions_change":11.2,
            "cpa":5842,
            "cpa_change":-4.3,
            "ctr":2.84,
            "ctr_change":3.7,
            "health_score":74
        },
        "alerts":alerts,
        "campaigns":campaigns,
        "budget_recommendations":[
            {"name":"PPEM","current":64200,"recommended":79200,"change":15000,"reason":"Высокий score и стабильный CPA"},
            {"name":"AXE White Paper","current":85300,"recommended":95300,"change":10000,"reason":"CPA ниже медианы кампаний"},
            {"name":"Enterprise","current":121400,"recommended":116400,"change":-5000,"reason":"Слабая динамика CPA"},
            {"name":"Enterprise 1C","current":96700,"recommended":86700,"change":-10000,"reason":"CPA выше собственной нормы"},
            {"name":"Gate","current":47200,"recommended":37200,"change":-10000,"reason":"Низкий CR и высокий CPA"},
        ],
        "creatives":creatives
    }

def main():
    # source = fetch_source_data()
    report = generate_demo_data()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT}")

if __name__ == "__main__":
    main()
