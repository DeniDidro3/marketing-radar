import os
import json
import csv
import io
import time
import base64
import hashlib
import secrets
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


# ============================================================
# CONFIG
# ============================================================

DIRECT_REPORT_URL = "https://api.direct.yandex.com/json/v501/reports"

TOKEN = os.environ["YANDEX_DIRECT_TOKEN"]
REPORT_PASSWORD = os.environ["REPORT_PASSWORD"]

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data" / "report.enc"

REPORT_DAYS = 60

# Минимум данных для полноценной оценки
MIN_CLICKS_FOR_SCORE = 15

# Для тренда сравниваем последние 7 дней
TREND_DAYS = 7

# PBKDF2
PBKDF2_ITERATIONS = 600_000


# ============================================================
# HELPERS
# ============================================================

def safe_float(value, default=0.0):
    if value is None:
        return default

    value = str(value).strip()

    if value in ("", "-", "--", "null", "None"):
        return default

    value = value.replace(",", ".")

    try:
        return float(value)
    except (ValueError, TypeError):
        return default


def safe_int(value, default=0):
    if value is None:
        return default

    value = str(value).strip()

    if value in ("", "-", "--", "null", "None"):
        return default

    try:
        return int(float(value))
    except (ValueError, TypeError):
        return default


def clamp(value, minimum, maximum):
    return max(
        minimum,
        min(maximum, value)
    )


def percent_change(current, previous):
    if previous <= 0:
        return 0.0

    return (
        (current - previous)
        / previous
        * 100
    )


# ============================================================
# DIRECT REPORT REQUEST
# ============================================================

def request_direct_report(
    report_name,
    report_type,
    fields,
):
    today = datetime.now(timezone.utc).date()

    date_from = today - timedelta(
        days=REPORT_DAYS
    )

    date_to = today - timedelta(
        days=1
    )

    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Accept-Language": "ru",
        "processingMode": "auto",
        "returnMoneyInMicros": "false",
        "skipReportHeader": "true",
        "skipColumnHeader": "true",
        "skipReportSummary": "true",
    }

    body = {
        "params": {
            "SelectionCriteria": {
                "DateFrom": date_from.isoformat(),
                "DateTo": date_to.isoformat(),
            },

            "FieldNames": fields,

            "OrderBy": [
                {
                    "Field": "Date",
                    "SortOrder": "ASCENDING",
                }
            ],

            "ReportName": report_name,
            "ReportType": report_type,
            "DateRangeType": "CUSTOM_DATE",
            "Format": "TSV",
            "IncludeVAT": "YES",
            "IncludeDiscount": "YES",
        }
    }

    max_attempts = 20

    for attempt in range(
        1,
        max_attempts + 1
    ):
        print(
            f"[{attempt}/{max_attempts}] "
            f"{report_name}: "
            f"{date_from} — {date_to}",
            flush=True,
        )

        response = requests.post(
            DIRECT_REPORT_URL,
            headers=headers,
            json=body,
            timeout=120,
        )

        print(
            f"HTTP {response.status_code}",
            flush=True,
        )

        if response.status_code == 200:
            print(
                f"{report_name}: received.",
                flush=True,
            )

            return response.text

        if response.status_code in (
            201,
            202,
        ):
            retry_in = int(
                response.headers.get(
                    "retryIn",
                    "10"
                )
            )

            print(
                f"Report not ready. "
                f"Retry in {retry_in}s.",
                flush=True,
            )

            time.sleep(retry_in)
            continue

        print(
            response.text,
            flush=True,
        )

        raise RuntimeError(
            f"Direct API returned "
            f"HTTP {response.status_code}"
        )

    raise RuntimeError(
        f"{report_name} was not ready "
        f"after {max_attempts} attempts."
    )


# ============================================================
# CAMPAIGN REPORT
# ============================================================

def get_campaign_report():
    fields = [
        "Date",
        "CampaignId",
        "CampaignName",
        "Impressions",
        "Clicks",
        "Cost",
        "Ctr",
        "AvgCpc",
    ]

    text = request_direct_report(
        report_name=(
            "Marketing Radar Campaign Report"
        ),
        report_type=(
            "CAMPAIGN_PERFORMANCE_REPORT"
        ),
        fields=fields,
    )

    return parse_campaign_tsv(
        text,
        fields,
    )


def parse_campaign_tsv(
    text,
    fields,
):
    reader = csv.reader(
        io.StringIO(text),
        delimiter="\t",
    )

    rows = []

    for values in reader:
        if not values:
            continue

        if len(values) < len(fields):
            continue

        row = dict(
            zip(fields, values)
        )

        rows.append({
            "date": row.get(
                "Date",
                ""
            ),

            "campaign_id": row.get(
                "CampaignId",
                ""
            ),

            "campaign_name": row.get(
                "CampaignName",
                ""
            ),

            "impressions": safe_int(
                row.get("Impressions")
            ),

            "clicks": safe_int(
                row.get("Clicks")
            ),

            "cost": safe_float(
                row.get("Cost")
            ),

            "ctr": safe_float(
                row.get("Ctr")
            ),

            "avg_cpc": safe_float(
                row.get("AvgCpc")
            ),
        })

    return rows


# ============================================================
# AD / CREATIVE REPORT
# ============================================================

def get_ad_report():
    fields = [
        "Date",

        "CampaignId",
        "CampaignName",

        "AdGroupId",
        "AdGroupName",

        "AdId",

        "AdNetworkType",
        "AdFormat",

        "Impressions",
        "Clicks",
        "Cost",
        "Ctr",
        "AvgCpc",
    ]

    text = request_direct_report(
        report_name=(
            "Marketing Radar Ad Report"
        ),
        report_type=(
            "AD_PERFORMANCE_REPORT"
        ),
        fields=fields,
    )

    return parse_ad_tsv(
        text,
        fields,
    )


def parse_ad_tsv(
    text,
    fields,
):
    reader = csv.reader(
        io.StringIO(text),
        delimiter="\t",
    )

    rows = []

    for values in reader:
        if not values:
            continue

        if len(values) < len(fields):
            continue

        row = dict(
            zip(fields, values)
        )

        ad_id = row.get(
            "AdId",
            ""
        )

        if not ad_id:
            continue

        rows.append({
            "date": row.get(
                "Date",
                ""
            ),

            "campaign_id": row.get(
                "CampaignId",
                ""
            ),

            "campaign_name": row.get(
                "CampaignName",
                ""
            ),

            "ad_group_id": row.get(
                "AdGroupId",
                ""
            ),

            "ad_group_name": row.get(
                "AdGroupName",
                ""
            ),

            "ad_id": ad_id,

            "network": row.get(
                "AdNetworkType",
                "UNKNOWN"
            ),

            "format": row.get(
                "AdFormat",
                "UNKNOWN"
            ),

            "impressions": safe_int(
                row.get("Impressions")
            ),

            "clicks": safe_int(
                row.get("Clicks")
            ),

            "cost": safe_float(
                row.get("Cost")
            ),

            "ctr": safe_float(
                row.get("Ctr")
            ),

            "avg_cpc": safe_float(
                row.get("AvgCpc")
            ),
        })

    print(
        f"Ad daily rows: {len(rows)}",
        flush=True,
    )

    return rows


# ============================================================
# CAMPAIGN AGGREGATION
# ============================================================

def aggregate_campaigns(rows):
    campaigns = {}

    for row in rows:
        cid = row["campaign_id"]

        if not cid:
            continue

        if cid not in campaigns:
            campaigns[cid] = {
                "campaign_id": cid,
                "name": row[
                    "campaign_name"
                ],
                "impressions": 0,
                "clicks": 0,
                "spend": 0.0,
            }

        item = campaigns[cid]

        item["impressions"] += (
            row["impressions"]
        )

        item["clicks"] += (
            row["clicks"]
        )

        item["spend"] += (
            row["cost"]
        )

    result = []

    for item in campaigns.values():
        impressions = item[
            "impressions"
        ]

        clicks = item[
            "clicks"
        ]

        spend = item[
            "spend"
        ]

        ctr = (
            clicks
            / impressions
            * 100
            if impressions
            else 0
        )

        cpc = (
            spend / clicks
            if clicks
            else 0
        )

        result.append({
            **item,

            "spend": round(
                spend,
                2
            ),

            "ctr": round(
                ctr,
                2
            ),

            "avg_cpc": round(
                cpc,
                2
            ),
        })

    result.sort(
        key=lambda x: x["spend"],
        reverse=True,
    )

    return result


# ============================================================
# CREATIVE AGGREGATION
# ============================================================

def aggregate_ads(rows):
    ads = {}

    for row in rows:
        # Один AdId отдельно для Search / Network
        key = (
            row["ad_id"],
            row["network"],
        )

        if key not in ads:
            ads[key] = {
                "ad_id": row["ad_id"],

                "campaign_id": (
                    row["campaign_id"]
                ),

                "campaign_name": (
                    row["campaign_name"]
                ),

                "ad_group_id": (
                    row["ad_group_id"]
                ),

                "ad_group_name": (
                    row["ad_group_name"]
                ),

                "network": (
                    row["network"]
                ),

                "format": (
                    row["format"]
                ),

                "impressions": 0,
                "clicks": 0,
                "spend": 0.0,

                "daily": [],
            }

        item = ads[key]

        item["impressions"] += (
            row["impressions"]
        )

        item["clicks"] += (
            row["clicks"]
        )

        item["spend"] += (
            row["cost"]
        )

        item["daily"].append(row)

    result = []

    for item in ads.values():
        impressions = item[
            "impressions"
        ]

        clicks = item[
            "clicks"
        ]

        spend = item[
            "spend"
        ]

        ctr = (
            clicks
            / impressions
            * 100
            if impressions
            else 0
        )

        cpc = (
            spend / clicks
            if clicks
            else 0
        )

        item["spend"] = round(
            spend,
            2
        )

        item["ctr"] = round(
            ctr,
            3
        )

        item["avg_cpc"] = round(
            cpc,
            2
        )

        result.append(item)

    return result


# ============================================================
# CREATIVE BASELINES
# ============================================================

def calculate_creative_baselines(
    creatives
):
    groups = defaultdict(
        lambda: {
            "impressions": 0,
            "clicks": 0,
            "spend": 0.0,
        }
    )

    for ad in creatives:
        key = (
            ad["campaign_id"],
            ad["network"],
        )

        group = groups[key]

        group["impressions"] += (
            ad["impressions"]
        )

        group["clicks"] += (
            ad["clicks"]
        )

        group["spend"] += (
            ad["spend"]
        )

    baselines = {}

    for key, group in groups.items():
        impressions = group[
            "impressions"
        ]

        clicks = group[
            "clicks"
        ]

        spend = group[
            "spend"
        ]

        ctr = (
            clicks
            / impressions
            * 100
            if impressions
            else 0
        )

        cpc = (
            spend / clicks
            if clicks
            else 0
        )

        baselines[key] = {
            "ctr": ctr,
            "cpc": cpc,
        }

    return baselines


# ============================================================
# CREATIVE TREND
# ============================================================

def aggregate_period(
    rows,
    start_date,
    end_date,
):
    impressions = 0
    clicks = 0
    spend = 0.0

    for row in rows:
        try:
            row_date = (
                datetime.strptime(
                    row["date"],
                    "%Y-%m-%d"
                ).date()
            )
        except Exception:
            continue

        if (
            start_date
            <= row_date
            <= end_date
        ):
            impressions += (
                row["impressions"]
            )

            clicks += (
                row["clicks"]
            )

            spend += (
                row["cost"]
            )

    ctr = (
        clicks
        / impressions
        * 100
        if impressions
        else 0
    )

    cpc = (
        spend / clicks
        if clicks
        else 0
    )

    return {
        "impressions": impressions,
        "clicks": clicks,
        "spend": spend,
        "ctr": ctr,
        "cpc": cpc,
    }


def calculate_creative_trend(ad):
    today = datetime.now(
        timezone.utc
    ).date()

    current_end = (
        today
        - timedelta(days=1)
    )

    current_start = (
        current_end
        - timedelta(
            days=TREND_DAYS - 1
        )
    )

    previous_end = (
        current_start
        - timedelta(days=1)
    )

    previous_start = (
        previous_end
        - timedelta(
            days=TREND_DAYS - 1
        )
    )

    current = aggregate_period(
        ad["daily"],
        current_start,
        current_end,
    )

    previous = aggregate_period(
        ad["daily"],
        previous_start,
        previous_end,
    )

    ctr_change = percent_change(
        current["ctr"],
        previous["ctr"],
    )

    cpc_change = percent_change(
        current["cpc"],
        previous["cpc"],
    )

    trend_status = "stable"

    # Недостаточно данных именно по тренду
    if (
        current["clicks"] < 5
        or previous["clicks"] < 5
    ):
        trend_status = (
            "insufficient_data"
        )

    elif (
        ctr_change <= -20
        and cpc_change >= 15
    ):
        trend_status = "fatigue"

    elif (
        ctr_change >= 20
        and cpc_change <= -10
    ):
        trend_status = "improving"

    elif ctr_change <= -20:
        trend_status = (
            "ctr_declining"
        )

    elif cpc_change >= 20:
        trend_status = (
            "cpc_growing"
        )

    return {
        "current_7d": {
            "impressions": (
                current["impressions"]
            ),
            "clicks": (
                current["clicks"]
            ),
            "spend": round(
                current["spend"],
                2
            ),
            "ctr": round(
                current["ctr"],
                3
            ),
            "cpc": round(
                current["cpc"],
                2
            ),
        },

        "previous_7d": {
            "impressions": (
                previous[
                    "impressions"
                ]
            ),
            "clicks": (
                previous["clicks"]
            ),
            "spend": round(
                previous["spend"],
                2
            ),
            "ctr": round(
                previous["ctr"],
                3
            ),
            "cpc": round(
                previous["cpc"],
                2
            ),
        },

        "ctr_change": round(
            ctr_change,
            1
        ),

        "cpc_change": round(
            cpc_change,
            1
        ),

        "status": trend_status,
    }


# ============================================================
# CREATIVE SCORE
# ============================================================

def calculate_creative_score(
    ad,
    baseline,
):
    clicks = ad["clicks"]

    if clicks < MIN_CLICKS_FOR_SCORE:
        return {
            "score": None,
            "status": (
                "insufficient_data"
            ),
            "reason": (
                "Недостаточно кликов "
                "для уверенной оценки"
            ),
        }

    ad_ctr = ad["ctr"]
    ad_cpc = ad["avg_cpc"]

    baseline_ctr = (
        baseline["ctr"]
    )

    baseline_cpc = (
        baseline["cpc"]
    )

    # Индекс CTR:
    # 1.0 = среднее кампании
    ctr_index = (
        ad_ctr / baseline_ctr
        if baseline_ctr > 0
        else 1
    )

    # Индекс CPC:
    # > 1 означает дешевле среднего
    cpc_index = (
        baseline_cpc / ad_cpc
        if ad_cpc > 0
        else 1
    )

    # Ограничиваем влияние экстремальных значений
    ctr_index = clamp(
        ctr_index,
        0.4,
        1.8
    )

    cpc_index = clamp(
        cpc_index,
        0.4,
        1.8
    )

    # Базовая точка = 50.
    # CTR важнее CPC.
    score = (
        50
        + (ctr_index - 1) * 45
        + (cpc_index - 1) * 30
    )

    # Немного учитываем объём:
    # 15 кликов = минимум,
    # 100+ = высокая уверенность.
    confidence_bonus = (
        min(clicks, 100)
        / 100
        * 5
    )

    score += confidence_bonus

    score = int(
        round(
            clamp(
                score,
                0,
                100
            )
        )
    )

    if score >= 70:
        status = "successful"
        reason = (
            "Эффективнее среднего "
            "по кампании"
        )

    elif score >= 45:
        status = "normal"
        reason = (
            "Показатели близки "
            "к средним"
        )

    else:
        status = "weak"
        reason = (
            "Уступает сопоставимым "
            "объявлениям"
        )

    return {
        "score": score,
        "status": status,
        "reason": reason,
        "ctr_index": round(
            ctr_index,
            2
        ),
        "cpc_index": round(
            cpc_index,
            2
        ),
    }


# ============================================================
# ENRICH CREATIVES
# ============================================================

def analyze_creatives(
    creatives
):
    baselines = (
        calculate_creative_baselines(
            creatives
        )
    )

    analyzed = []

    for ad in creatives:
        key = (
            ad["campaign_id"],
            ad["network"],
        )

        baseline = baselines.get(
            key,
            {
                "ctr": 0,
                "cpc": 0,
            }
        )

        score_data = (
            calculate_creative_score(
                ad,
                baseline,
            )
        )

        trend = (
            calculate_creative_trend(
                ad
            )
        )

        # Если креатив формально хороший,
        # но уже выгорает — это важный сигнал.
        final_status = (
            score_data["status"]
        )

        if trend["status"] == "fatigue":
            final_status = "fatigue"

        elif (
            trend["status"]
            == "improving"
            and score_data["status"]
            in (
                "normal",
                "successful",
            )
        ):
            final_status = (
                "improving"
            )

        analyzed.append({
            "ad_id": ad["ad_id"],

            "campaign_id": (
                ad["campaign_id"]
            ),

            "campaign_name": (
                ad["campaign_name"]
            ),

            "ad_group_id": (
                ad["ad_group_id"]
            ),

            "ad_group_name": (
                ad["ad_group_name"]
            ),

            "network": (
                ad["network"]
            ),

            "format": (
                ad["format"]
            ),

            "impressions": (
                ad["impressions"]
            ),

            "clicks": (
                ad["clicks"]
            ),

            "spend": (
                ad["spend"]
            ),

            "ctr": (
                ad["ctr"]
            ),

            "avg_cpc": (
                ad["avg_cpc"]
            ),

            "baseline_ctr": round(
                baseline["ctr"],
                3
            ),

            "baseline_cpc": round(
                baseline["cpc"],
                2
            ),

            "score": score_data[
                "score"
            ],

            "status": final_status,

            "score_status": (
                score_data["status"]
            ),

            "reason": (
                score_data["reason"]
            ),

            "ctr_index": (
                score_data.get(
                    "ctr_index"
                )
            ),

            "cpc_index": (
                score_data.get(
                    "cpc_index"
                )
            ),

            "trend": trend,
        })

    # Самые важные наверх:
    # fatigue → weak → successful
    priority = {
        "fatigue": 0,
        "weak": 1,
        "improving": 2,
        "successful": 3,
        "normal": 4,
        "insufficient_data": 5,
    }

    analyzed.sort(
        key=lambda x: (
            priority.get(
                x["status"],
                99
            ),
            -(
                x["spend"]
                or 0
            ),
        )
    )

    return analyzed


# ============================================================
# SUMMARY
# ============================================================

def calculate_summary(
    campaigns
):
    impressions = sum(
        c["impressions"]
        for c in campaigns
    )

    clicks = sum(
        c["clicks"]
        for c in campaigns
    )

    spend = sum(
        c["spend"]
        for c in campaigns
    )

    ctr = (
        clicks
        / impressions
        * 100
        if impressions
        else 0
    )

    cpc = (
        spend / clicks
        if clicks
        else 0
    )

    return {
        "spend": round(
            spend,
            2
        ),

        "impressions": impressions,

        "clicks": clicks,

        "ctr": round(
            ctr,
            2
        ),

        "avg_cpc": round(
            cpc,
            2
        ),
    }


def calculate_creative_summary(
    creatives
):
    counts = defaultdict(int)

    for ad in creatives:
        counts[
            ad["status"]
        ] += 1

    return {
        "total": len(creatives),

        "successful": counts[
            "successful"
        ],

        "normal": counts[
            "normal"
        ],

        "weak": counts[
            "weak"
        ],

        "fatigue": counts[
            "fatigue"
        ],

        "improving": counts[
            "improving"
        ],

        "insufficient_data": counts[
            "insufficient_data"
        ],
    }


# ============================================================
# BUILD REPORT
# ============================================================

def build_report():
    print(
        "Downloading campaign statistics...",
        flush=True,
    )

    campaign_rows = (
        get_campaign_report()
    )

    print(
        "Downloading ad statistics...",
        flush=True,
    )

    ad_rows = (
        get_ad_report()
    )

    campaigns = (
        aggregate_campaigns(
            campaign_rows
        )
    )

    raw_creatives = (
        aggregate_ads(
            ad_rows
        )
    )

    creatives = (
        analyze_creatives(
            raw_creatives
        )
    )

    summary = calculate_summary(
        campaigns
    )

    creative_summary = (
        calculate_creative_summary(
            creatives
        )
    )

    print(
        f"Campaigns: "
        f"{len(campaigns)}",
        flush=True,
    )

    print(
        f"Creatives: "
        f"{len(creatives)}",
        flush=True,
    )

    print(
        "Creative summary:",
        creative_summary,
        flush=True,
    )

    return {
        "meta": {
            "updated_at": (
                datetime.now(
                    timezone.utc
                ).isoformat()
            ),

            "source": (
                "yandex_direct"
            ),

            "period_days": (
                REPORT_DAYS
            ),

            "creative_method": (
                "traffic_efficiency_v1"
            ),
        },

        "summary": summary,

        "campaigns": campaigns,

        "creative_summary": (
            creative_summary
        ),

        "creatives": creatives,

        # Дневные данные кампаний
        # оставляем для будущих сравнений.
        "daily": campaign_rows,
    }


# ============================================================
# ENCRYPTION
# ============================================================

def derive_key(
    password,
    salt,
):
    return hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
        dklen=32,
    )


def encrypt_report(report):
    plaintext = json.dumps(
        report,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")

    salt = secrets.token_bytes(16)
    nonce = secrets.token_bytes(12)

    key = derive_key(
        REPORT_PASSWORD,
        salt,
    )

    aesgcm = AESGCM(key)

    ciphertext = aesgcm.encrypt(
        nonce,
        plaintext,
        None,
    )

    return {
        "version": 1,

        "kdf": (
            "PBKDF2-SHA256"
        ),

        "iterations": (
            PBKDF2_ITERATIONS
        ),

        "cipher": (
            "AES-256-GCM"
        ),

        "salt": base64.b64encode(
            salt
        ).decode("ascii"),

        "nonce": base64.b64encode(
            nonce
        ).decode("ascii"),

        "ciphertext": (
            base64.b64encode(
                ciphertext
            ).decode("ascii")
        ),
    }


# ============================================================
# MAIN
# ============================================================

def main():
    report = build_report()

    encrypted = encrypt_report(
        report
    )

    OUT.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    OUT.write_text(
        json.dumps(
            encrypted,
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )

    print(
        f"Encrypted report saved: {OUT}",
        flush=True,
    )


if __name__ == "__main__":
    main()
