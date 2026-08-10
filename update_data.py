import os
import json
import csv
import io
import time
import base64
import hashlib
import secrets
import re

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import median

import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


# ============================================================
# CONFIG
# ============================================================

TOKEN = os.environ["YANDEX_DIRECT_TOKEN"]
REPORT_PASSWORD = os.environ["REPORT_PASSWORD"]

REPORTS_URL = "https://api.direct.yandex.com/json/v501/reports"
ADS_URL = "https://api.direct.yandex.com/json/v5/ads"
ADIMAGES_URL = "https://api.direct.yandex.com/json/v5/adimages"
CREATIVES_URL = "https://api.direct.yandex.com/json/v5/creatives"
CAMPAIGNS_URL = "https://api.direct.yandex.com/json/v501/campaigns"
RETARGETINGLISTS_URL = "https://api.direct.yandex.com/json/v5/retargetinglists"
STRATEGIES_URL = "https://api.direct.yandex.com/json/v501/strategies"
KEYWORDS_URL = "https://api.direct.yandex.com/json/v5/keywords"

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data" / "report.enc"

REPORT_DAYS = 60
TREND_DAYS = 7

MIN_CLICKS_FOR_SCORE = 15
MIN_CLICKS_FOR_BASELINE = 5
MIN_CLICKS_FOR_TREND = 5

PBKDF2_ITERATIONS = 600_000


# ============================================================
# TRACKED CONVERSIONS
# ============================================================

# Используем одну модель атрибуции во всех отчётах, чтобы
# показатели между разделами были сопоставимы.
# LSCCD = последний значимый / непрямой клик cross-device.
CONVERSION_ATTRIBUTION_MODEL = "LSCCD"

ORDER_GOALS = {
    "Order Enterprise": 492494230,
    "Order Standard": 492494285,
    "Order Certified": 492494335,
    "Order Enterprise Certified": 492494419,
    "Order Shardman": 492494539,
    "Order AXE": 508996626,
    "Order PPEM": 519141790,
    "Order Enterprise 1C": 519142162,
}

# Пока ID целей регистраций на вебинары/митапы не заданы.
# Поле в отчёте и интерфейсе остаётся, значения будут 0.
WEBINAR_GOALS = {}

SURVEY_GOALS = {
    "BHT опрос": 487692912,
    "White Paper AXE опрос": 541257934,
}

TRACKED_GOAL_IDS = (
    list(ORDER_GOALS.values())
    + list(WEBINAR_GOALS.values())
    + list(SURVEY_GOALS.values())
)


KNOWN_GOAL_NAMES = {
    **{
        str(goal_id): name
        for name, goal_id in ORDER_GOALS.items()
    },
    **{
        str(goal_id): name
        for name, goal_id in WEBINAR_GOALS.items()
    },
    **{
        str(goal_id): name
        for name, goal_id in SURVEY_GOALS.items()
    },
    "12": "Вовлечённые сессии",
    "13": "Priority Goals",
}

# В Direct Reports API за один запрос можно передать до 10 целей.
# Сейчас их ровно 10.
if len(TRACKED_GOAL_IDS) > 10:
    raise RuntimeError(
        "TRACKED_GOAL_IDS > 10. Разбейте цели на несколько отчётов."
    )


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


def chunks(items, size):
    items = list(items)

    for i in range(
        0,
        len(items),
        size
    ):
        yield items[i:i + size]


# ============================================================
# REPORT NAME
# ============================================================

def make_report_name(
    prefix,
    report_type,
    fields,
    date_from,
    date_to,
):
    """
    ReportName должен быть стабильным для одного
    набора параметров и отличаться, если набор
    параметров изменился.
    """

    signature = json.dumps(
        {
            "report_type": report_type,
            "fields": fields,
            "date_from": str(date_from),
            "date_to": str(date_to),
        },
        sort_keys=True,
        ensure_ascii=False,
    )

    short_hash = hashlib.sha1(
        signature.encode("utf-8")
    ).hexdigest()[:10]

    return (
        f"{prefix} "
        f"{date_to.strftime('%Y%m%d')} "
        f"{short_hash}"
    )


# ============================================================
# REPORTS API
# ============================================================

def request_report(
    prefix,
    report_type,
    fields,
):
    today = datetime.now(
        timezone.utc
    ).date()

    date_from = (
        today
        - timedelta(days=REPORT_DAYS)
    )

    date_to = (
        today
        - timedelta(days=1)
    )

    # Добавляем сигнатуру списка целей и модели в ReportName.
    # Это предотвращает HTTP 400, если набор целей позже изменится.
    tracking_signature = hashlib.sha1(
        json.dumps(
            {
                "goals": TRACKED_GOAL_IDS if "Conversions" in fields else [],
                "model": CONVERSION_ATTRIBUTION_MODEL if "Conversions" in fields else None,
            },
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()[:8]

    report_name = make_report_name(
        f"{prefix} {tracking_signature}",
        report_type,
        fields,
        date_from,
        date_to,
    )

    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Accept-Language": "ru",
        "processingMode": "auto",
        "returnMoneyInMicros": "false",
        "skipReportHeader": "true",
        # Нужен заголовок: при Goals поле Conversions заменяется
        # динамическими Conversions_<goal>_<model>.
        "skipColumnHeader": "false",
        "skipReportSummary": "true",
    }

    params = {
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

    if "Conversions" in fields:
        params["Goals"] = [
            str(goal_id)
            for goal_id in TRACKED_GOAL_IDS
        ]
        params["AttributionModels"] = [
            CONVERSION_ATTRIBUTION_MODEL
        ]

    body = {
        "params": params
    }

    max_attempts = 20

    for attempt in range(
        1,
        max_attempts + 1
    ):
        print(
            f"[{attempt}/{max_attempts}] "
            f"{report_name}",
            flush=True,
        )

        response = requests.post(
            REPORTS_URL,
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
                "Report ready.",
                flush=True,
            )
            return response.text

        if response.status_code in (
            201,
            202,
        ):
            retry_in = safe_int(
                response.headers.get(
                    "retryIn",
                    10
                ),
                10,
            )
            print(
                f"Waiting {retry_in}s...",
                flush=True,
            )
            time.sleep(retry_in)
            continue

        print(
            response.text,
            flush=True,
        )
        raise RuntimeError(
            f"Reports API HTTP "
            f"{response.status_code}"
        )

    raise RuntimeError(
        "Report generation timeout"
    )


# ============================================================
# CONVERSION HELPERS
# ============================================================

def goal_conversion_field(
    goal_id,
    model=CONVERSION_ATTRIBUTION_MODEL,
):
    return (
        f"Conversions_{goal_id}_{model}"
    )


def conversion_breakdown_from_row(row):
    order_conversions = sum(
        safe_float(
            row.get(
                goal_conversion_field(goal_id)
            )
        )
        for goal_id in ORDER_GOALS.values()
    )

    webinar_conversions = sum(
        safe_float(
            row.get(
                goal_conversion_field(goal_id)
            )
        )
        for goal_id in WEBINAR_GOALS.values()
    )

    survey_conversions = sum(
        safe_float(
            row.get(
                goal_conversion_field(goal_id)
            )
        )
        for goal_id in SURVEY_GOALS.values()
    )

    conversions = (
        order_conversions
        + webinar_conversions
        + survey_conversions
    )

    return {
        "order_conversions": round(
            order_conversions,
            2
        ),
        "webinar_conversions": round(
            webinar_conversions,
            2
        ),
        "survey_conversions": round(
            survey_conversions,
            2
        ),
        # Для обратной совместимости conversions = сумма
        # только трёх отслеживаемых категорий.
        "conversions": round(
            conversions,
            2
        ),
    }


def conversion_metrics(
    cost,
    clicks,
    breakdown,
):
    cost = safe_float(cost)
    clicks = safe_int(clicks)

    order_conversions = safe_float(
        breakdown.get(
            "order_conversions"
        )
    )
    webinar_conversions = safe_float(
        breakdown.get(
            "webinar_conversions"
        )
    )
    survey_conversions = safe_float(
        breakdown.get(
            "survey_conversions"
        )
    )
    conversions = (
        order_conversions
        + webinar_conversions
        + survey_conversions
    )

    return {
        "order_conversions": round(
            order_conversions,
            2
        ),
        "webinar_conversions": round(
            webinar_conversions,
            2
        ),
        "survey_conversions": round(
            survey_conversions,
            2
        ),
        "conversions": round(
            conversions,
            2
        ),
        "order_cr": round(
            order_conversions
            / clicks
            * 100,
            3,
        ) if clicks else 0,
        "webinar_cr": round(
            webinar_conversions
            / clicks
            * 100,
            3,
        ) if clicks else 0,
        "survey_cr": round(
            survey_conversions
            / clicks
            * 100,
            3,
        ) if clicks else 0,
        "conversion_rate": round(
            conversions
            / clicks
            * 100,
            3,
        ) if clicks else 0,
        "order_cpa": round(
            cost
            / order_conversions,
            2,
        ) if order_conversions else 0,
        "webinar_cpa": round(
            cost
            / webinar_conversions,
            2,
        ) if webinar_conversions else 0,
        "survey_cpa": round(
            cost
            / survey_conversions,
            2,
        ) if survey_conversions else 0,
        "cpa": round(
            cost
            / conversions,
            2,
        ) if conversions else 0,
    }


def metrics_from_report_row(row):
    breakdown = conversion_breakdown_from_row(
        row
    )

    base = metrics_from_values(
        row.get("Impressions"),
        row.get("Clicks"),
        row.get("Cost"),
        breakdown["conversions"],
    )

    base.update(
        conversion_metrics(
            row.get("Cost"),
            row.get("Clicks"),
            breakdown,
        )
    )

    return base


# ============================================================
# CAMPAIGN REPORT
# ============================================================

def get_campaign_rows():
    fields = [
        "Date",
        "CampaignId",
        "CampaignName",
        "Impressions",
        "Clicks",
        "Cost",
        "Conversions",
    ]

    text = request_report(
        "MR Campaign goals v8",
        "CAMPAIGN_PERFORMANCE_REPORT",
        fields,
    )

    reader = csv.DictReader(
        io.StringIO(text),
        delimiter="\t",
    )

    rows = []

    for row in reader:
        if not row:
            continue

        breakdown = (
            conversion_breakdown_from_row(
                row
            )
        )

        conv_metrics = (
            conversion_metrics(
                row.get("Cost"),
                row.get("Clicks"),
                breakdown,
            )
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
            **conv_metrics,
        })

    print(
        "Campaign rows:",
        len(rows),
        flush=True,
    )

    return rows

# ============================================================
# AD PERFORMANCE REPORT
# ============================================================

def get_ad_rows():
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
        "Conversions",
    ]

    text = request_report(
        "MR Creative Performance goals v8",
        "AD_PERFORMANCE_REPORT",
        fields,
    )

    reader = csv.DictReader(
        io.StringIO(text),
        delimiter="\t",
    )

    rows = []

    for row in reader:
        if not row:
            continue

        ad_id = str(
            row.get(
                "AdId",
                ""
            )
        ).strip()

        if ad_id in (
            "",
            "-",
            "--",
        ):
            continue

        breakdown = (
            conversion_breakdown_from_row(
                row
            )
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
            "ad_format": row.get(
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
            **conversion_metrics(
                row.get("Cost"),
                row.get("Clicks"),
                breakdown,
            ),
        })

    print(
        "Ad rows:",
        len(rows),
        flush=True,
    )

    return rows

# ============================================================
# GENERIC DIRECT JSON API
# ============================================================

def direct_api(
    url,
    payload,
    service_name,
):
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Accept-Language": "ru",
        "Content-Type": (
            "application/json; charset=utf-8"
        ),
    }

    response = requests.post(
        url,
        headers=headers,
        json=payload,
        timeout=120,
    )

    print(
        f"{service_name}: "
        f"HTTP {response.status_code}",
        flush=True,
    )

    if response.status_code != 200:
        print(
            response.text,
            flush=True,
        )

        raise RuntimeError(
            f"{service_name}: "
            f"HTTP {response.status_code}"
        )

    data = response.json()

    if "error" in data:
        print(
            json.dumps(
                data,
                ensure_ascii=False,
                indent=2,
            ),
            flush=True,
        )

        raise RuntimeError(
            f"{service_name}: API error"
        )

    return data.get(
        "result",
        {}
    )


# ============================================================
# ADS.GET
# ============================================================

def get_ads(ad_ids):
    result = {}

    numeric_ids = []

    for ad_id in ad_ids:
        try:
            numeric_ids.append(
                int(ad_id)
            )
        except Exception:
            continue

    for id_chunk in chunks(
        numeric_ids,
        3000
    ):
        print(
            "Ads.get batch:",
            len(id_chunk),
            flush=True,
        )

        payload = {
            "method": "get",

            "params": {
                "SelectionCriteria": {
                    "Ids": id_chunk,
                },

                "FieldNames": [
                    "Id",
                    "CampaignId",
                    "AdGroupId",
                    "Type",
                    "Subtype",
                ],

                # Обычное Text & Image объявление.
                "TextAdFieldNames": [
                    "AdImageHash",
                    "VideoExtension",
                ],

                "DynamicTextAdFieldNames": [
                    "AdImageHash",
                ],

                "MobileAppAdFieldNames": [
                    "AdImageHash",
                    "VideoExtension",
                ],

                # IMAGE_AD из загруженной картинки.
                "TextImageAdFieldNames": [
                    "AdImageHash",
                ],

                "MobileAppImageAdFieldNames": [
                    "AdImageHash",
                ],

                # IMAGE_AD из конструктора.
                "TextAdBuilderAdFieldNames": [
                    "Creative",
                ],

                "MobileAppAdBuilderAdFieldNames": [
                    "Creative",
                ],

                # CPC video.
                "MobileAppCpcVideoAdBuilderAdFieldNames": [
                    "Creative",
                ],

                "CpcVideoAdBuilderAdFieldNames": [
                    "Creative",
                ],

                # CPM.
                "CpmBannerAdBuilderAdFieldNames": [
                    "Creative",
                ],

                "CpmVideoAdBuilderAdFieldNames": [
                    "Creative",
                ],

                "SmartAdBuilderAdFieldNames": [
                    "Creative",
                ],

                # Комбинаторное объявление.
                "ResponsiveAdFieldNames": [
                    "AdImages",
                    "VideoExtensions",
                ],

                "Page": {
                    "Limit": 10000,
                    "Offset": 0,
                },
            }
        }

        api_result = direct_api(
            ADS_URL,
            payload,
            "Ads.get",
        )

        for ad in api_result.get(
            "Ads",
            []
        ):
            result[
                str(ad["Id"])
            ] = ad

    print(
        "Ads received:",
        len(result),
        flush=True,
    )

    return result


# ============================================================
# ASSET HELPERS
# ============================================================

def image_asset(
    image_hash,
    source,
):
    if not image_hash:
        return None

    image_hash = str(
        image_hash
    )

    return {
        "asset_key": (
            f"image:{image_hash}"
        ),

        "asset_id": image_hash,

        "kind": "image",

        "source": source,
    }


def creative_asset(
    creative,
    kind,
    source,
):
    if not creative:
        return None

    creative_id = creative.get(
        "CreativeId"
    )

    if creative_id is None:
        return None

    creative_id = str(
        creative_id
    )

    return {
        "asset_key": (
            f"creative:{creative_id}"
        ),

        "asset_id": creative_id,

        "kind": kind,

        "source": source,

        "preview_url": creative.get(
            "PreviewUrl"
        ),

        "thumbnail_url": creative.get(
            "ThumbnailUrl"
        ),
    }


# ============================================================
# EXTRACT VISUAL ASSETS
# ============================================================

def extract_ad_assets(ad):
    assets = []

    def safe_block(name):
        value = ad.get(name)
        return value if isinstance(value, dict) else {}

    def add_image(hash_value, source, mode):
        if hash_value:
            asset = image_asset(
                hash_value,
                source,
            )

            if asset:
                asset["ad_asset_mode"] = mode
                assets.append(asset)

    def add_creative(value, kind, source, mode):
        if isinstance(value, dict):
            asset = creative_asset(
                value,
                kind,
                source,
            )

            if asset:
                asset["ad_asset_mode"] = mode
                assets.append(asset)


    # TEXT AD
    text_ad = safe_block(
        "TextAd"
    )

    add_image(
        text_ad.get(
            "AdImageHash"
        ),
        "TextAd.AdImageHash",
        "single_image_extension",
    )

    add_creative(
        text_ad.get(
            "VideoExtension"
        ),
        "video",
        "TextAd.VideoExtension",
        "single_video_extension",
    )


    # DYNAMIC TEXT
    dynamic = safe_block(
        "DynamicTextAd"
    )

    add_image(
        dynamic.get(
            "AdImageHash"
        ),
        "DynamicTextAd.AdImageHash",
        "single_image_extension",
    )


    # MOBILE APP
    mobile = safe_block(
        "MobileAppAd"
    )

    add_image(
        mobile.get(
            "AdImageHash"
        ),
        "MobileAppAd.AdImageHash",
        "single_image_extension",
    )

    add_creative(
        mobile.get(
            "VideoExtension"
        ),
        "video",
        "MobileAppAd.VideoExtension",
        "single_video_extension",
    )


    # IMAGE ADS
    for block_name in [
        "TextImageAd",
        "MobileAppImageAd",
    ]:

        block = safe_block(
            block_name
        )

        add_image(
            block.get(
                "AdImageHash"
            ),
            f"{block_name}.AdImageHash",
            "dedicated_image_ad",
        )


    # BUILDER IMAGE
    for block_name in [
        "TextAdBuilderAd",
        "MobileAppAdBuilderAd",
        "CpmBannerAdBuilderAd",
    ]:

        block = safe_block(
            block_name
        )

        add_creative(
            block.get(
                "Creative"
            ),
            "image",
            f"{block_name}.Creative",
            "dedicated_image_ad",
        )


    # VIDEO
    for block_name in [
        "MobileAppCpcVideoAdBuilderAd",
        "CpcVideoAdBuilderAd",
        "CpmVideoAdBuilderAd",
    ]:

        block = safe_block(
            block_name
        )

        add_creative(
            block.get(
                "Creative"
            ),
            "video",
            f"{block_name}.Creative",
            "dedicated_video_ad",
        )


    # SMART
    smart = safe_block(
        "SmartAdBuilderAd"
    )

    add_creative(
        smart.get(
            "Creative"
        ),
        "smart",
        "SmartAdBuilderAd.Creative",
        "dedicated_smart_ad",
    )


    # RESPONSIVE
    responsive = safe_block(
        "ResponsiveAd"
    )

    ad_images_value = responsive.get("AdImages")
    ad_images = (
        ad_images_value
        if isinstance(ad_images_value, dict)
        else {}
    )

    for image in (
        ad_images.get(
            "Items",
            []
        ) or []
    ):

        if isinstance(image, dict):

            add_image(
                image.get(
                    "ImageHash"
                ),
                "ResponsiveAd.AdImages",
                "responsive_multi",
            )


    video_extensions_value = responsive.get("VideoExtensions")
    video_extensions = (
        video_extensions_value
        if isinstance(video_extensions_value, dict)
        else {}
    )

    for video in (
        video_extensions.get(
            "Items",
            []
        ) or []
    ):

        add_creative(
            video,
            "video",
            "ResponsiveAd.VideoExtensions",
            "responsive_multi",
        )


    # REMOVE DUPLICATES

    unique = {}

    for asset in assets:
        unique[
            asset["asset_key"]
        ] = asset


    return list(
        unique.values()
    )


# ============================================================
# IMAGE METADATA
# ============================================================

def get_image_metadata(
    image_hashes
):
    metadata = {}

    image_hashes = sorted(
        set(image_hashes)
    )

    for hash_chunk in chunks(
        image_hashes,
        5000
    ):
        if not hash_chunk:
            continue

        payload = {
            "method": "get",

            "params": {
                "SelectionCriteria": {
                    "AdImageHashes": (
                        hash_chunk
                    ),
                },

                "FieldNames": [
                    "AdImageHash",
                    "OriginalUrl",
                    "PreviewUrl",
                    "Name",
                    "Type",
                    "Subtype",
                    "Associated",
                ],

                "Page": {
                    "Limit": 10000,
                    "Offset": 0,
                },
            }
        }

        result = direct_api(
            ADIMAGES_URL,
            payload,
            "AdImages.get",
        )

        for item in result.get(
            "AdImages",
            []
        ):
            metadata[
                str(
                    item[
                        "AdImageHash"
                    ]
                )
            ] = item

    print(
        "Image metadata:",
        len(metadata),
        flush=True,
    )

    return metadata


# ============================================================
# CREATIVE METADATA
# ============================================================

def get_creative_metadata(
    creative_ids
):
    metadata = {}

    numeric_ids = []

    for creative_id in set(
        creative_ids
    ):
        try:
            numeric_ids.append(
                int(creative_id)
            )
        except Exception:
            continue

    for id_chunk in chunks(
        numeric_ids,
        5000
    ):
        if not id_chunk:
            continue

        payload = {
            "method": "get",

            "params": {
                "SelectionCriteria": {
                    "Ids": id_chunk,
                },

                "FieldNames": [
                    "Id",
                    "Type",
                    "Name",
                    "PreviewUrl",
                    "ThumbnailUrl",
                    "Width",
                    "Height",
                    "Associated",
                    "IsAdaptive",
                ],

                "Page": {
                    "Limit": 10000,
                    "Offset": 0,
                },
            }
        }

        result = direct_api(
            CREATIVES_URL,
            payload,
            "Creatives.get",
        )

        for item in result.get(
            "Creatives",
            []
        ):
            metadata[
                str(item["Id"])
            ] = item

    print(
        "Creative metadata:",
        len(metadata),
        flush=True,
    )

    return metadata


# ============================================================
# PERFORMANCE OBJECT
# ============================================================

def create_performance_item(
    asset,
    row,
):
    return {
        "asset_key": (
            asset["asset_key"]
        ),

        "asset_id": (
            asset["asset_id"]
        ),

        "kind": (
            asset["kind"]
        ),

        "source": (
            asset.get("source")
        ),

        "asset_mode": (
            asset.get(
                "ad_asset_mode"
            )
        ),

        "campaign_id": (
            row["campaign_id"]
        ),

        "campaign_name": (
            row["campaign_name"]
        ),

        "network": (
            row["network"]
        ),

        "impressions": 0,

        "clicks": 0,

        "spend": 0.0,

        "order_conversions": 0.0,
        "webinar_conversions": 0.0,
        "survey_conversions": 0.0,
        "conversions": 0.0,

        "ad_ids": set(),

        "ad_group_ids": set(),

        "daily": [],

        "exact_impressions": 0,

        "exact_clicks": 0,

        "exact_spend": 0.0,

        "proxy_impressions": 0,

        "proxy_clicks": 0,

        "proxy_spend": 0.0,

        "shared_proxy_impressions": 0,
        "shared_proxy_clicks": 0,
        "shared_proxy_spend": 0.0,
        "shared_asset_count": 0,

        "unattributed_impressions": 0,

        "unattributed_clicks": 0,

        "unattributed_spend": 0.0,

        "unattributed_ad_ids": set(),

        "attribution_types": set(),
    }


# ============================================================
# ADD STATS TO ASSET
# ============================================================

def add_stats(
    item,
    row,
    attribution,
):
    item["impressions"] += (
        row["impressions"]
    )

    item["clicks"] += (
        row["clicks"]
    )

    item["spend"] += (
        row["cost"]
    )

    for conversion_field in (
        "order_conversions",
        "webinar_conversions",
        "survey_conversions",
        "conversions",
    ):
        item[conversion_field] += safe_float(
            row.get(
                conversion_field,
                0
            )
        )

    item["ad_ids"].add(
        row["ad_id"]
    )

    if row["ad_group_id"]:
        item[
            "ad_group_ids"
        ].add(
            row["ad_group_id"]
        )

    item[
        "attribution_types"
    ].add(
        attribution
    )

    if attribution == "exact":
        item[
            "exact_impressions"
        ] += row["impressions"]

        item[
            "exact_clicks"
        ] += row["clicks"]

        item[
            "exact_spend"
        ] += row["cost"]

    elif attribution == "proxy":
        item[
            "proxy_impressions"
        ] += row["impressions"]

        item[
            "proxy_clicks"
        ] += row["clicks"]

        item[
            "proxy_spend"
        ] += row["cost"]

    elif attribution == "shared_proxy":
        # Контекстная proxy-атрибуция: статистика объявления
        # присваивается каждому визуалу, который присутствовал в нём.
        # Это НЕ точная asset-level атрибуция, но позволяет сравнивать
        # контексты использования креатива вместо вывода нулей.
        item[
            "proxy_impressions"
        ] += row["impressions"]

        item[
            "proxy_clicks"
        ] += row["clicks"]

        item[
            "proxy_spend"
        ] += row["cost"]

        item[
            "shared_proxy_impressions"
        ] += row["impressions"]

        item[
            "shared_proxy_clicks"
        ] += row["clicks"]

        item[
            "shared_proxy_spend"
        ] += row["cost"]

    item["daily"].append({
        "date": row["date"],

        "impressions": (
            row["impressions"]
        ),

        "clicks": (
            row["clicks"]
        ),

        "cost": (
            row["cost"]
        ),
    })


# ============================================================
# BUILD ASSET PERFORMANCE
# ============================================================

def build_asset_performance(
    ad_rows,
    ad_asset_map,
):
    """
    Главная логика v5.

    1. Dedicated IMAGE_AD -> exact.
    2. Dedicated VIDEO_AD -> exact.
    3. TEXT_AD + одна картинка -> proxy.
    4. TEXT_AD + одно видео и VIDEO row -> exact/proxy.
    5. RESPONSIVE с несколькими ассетами ->
       не распределяем статистику.
    """

    performances = {}

    def get_item(
        asset,
        row,
    ):
        key = (
            asset["asset_key"],
            row["campaign_id"],
            row["network"],
        )

        if key not in performances:
            performances[key] = (
                create_performance_item(
                    asset,
                    row,
                )
            )

        return performances[key]

    for row in ad_rows:
        assets = ad_asset_map.get(
            row["ad_id"],
            []
        )

        if not assets:
            continue

        images = [
            a
            for a in assets
            if a["kind"] == "image"
        ]

        videos = [
            a
            for a in assets
            if a["kind"] == "video"
        ]

        smart_assets = [
            a
            for a in assets
            if a["kind"] == "smart"
        ]

        ad_format = str(
            row.get(
                "ad_format",
                ""
            )
        ).upper()

        # ====================================================
        # RESPONSIVE / MULTI-ASSET
        # ====================================================

        responsive_assets = [
            a
            for a in assets
            if a.get(
                "ad_asset_mode"
            ) == "responsive_multi"
        ]

        if responsive_assets:
            # Если у responsive ровно один image asset
            # и строка не VIDEO — можем использовать proxy.
            responsive_images = [
                a
                for a in responsive_assets
                if a["kind"] == "image"
            ]

            responsive_videos = [
                a
                for a in responsive_assets
                if a["kind"] == "video"
            ]

            if (
                ad_format == "VIDEO"
                and len(
                    responsive_videos
                ) == 1
            ):
                item = get_item(
                    responsive_videos[0],
                    row,
                )

                add_stats(
                    item,
                    row,
                    "proxy",
                )

                continue

            if (
                ad_format != "VIDEO"
                and len(
                    responsive_images
                ) == 1
            ):
                item = get_item(
                    responsive_images[0],
                    row,
                )

                add_stats(
                    item,
                    row,
                    "proxy",
                )

                continue

            # Если ассетов несколько, Direct не отдаёт статистику
            # конкретного изображения внутри responsive-объявления.
            # Вместо нулей используем shared/context proxy:
            # каждому ассету присваиваем статистику объявления, в котором
            # он участвовал. Это позволяет оценить контекст использования,
            # но НЕ является точной индивидуальной атрибуцией.
            target_assets = (
                responsive_videos
                if ad_format == "VIDEO"
                else responsive_images
            )

            for asset in target_assets:
                item = get_item(
                    asset,
                    row,
                )

                item["shared_asset_count"] = max(
                    item.get(
                        "shared_asset_count",
                        0
                    ),
                    len(
                        target_assets
                    ),
                )

                add_stats(
                    item,
                    row,
                    "shared_proxy",
                )

            continue

        # ====================================================
        # VIDEO ROW
        # ====================================================

        if ad_format == "VIDEO":
            if len(videos) == 1:
                item = get_item(
                    videos[0],
                    row,
                )

                mode = videos[0].get(
                    "ad_asset_mode"
                )

                attribution = (
                    "exact"
                    if mode
                    == "dedicated_video_ad"
                    else "proxy"
                )

                add_stats(
                    item,
                    row,
                    attribution,
                )

            continue

        # ====================================================
        # DEDICATED IMAGE AD
        # ====================================================

        dedicated_images = [
            a
            for a in images
            if a.get(
                "ad_asset_mode"
            )
            == "dedicated_image_ad"
        ]

        if len(
            dedicated_images
        ) == 1:
            item = get_item(
                dedicated_images[0],
                row,
            )

            add_stats(
                item,
                row,
                "exact",
            )

            continue

        # ====================================================
        # NORMAL TEXT/DYNAMIC AD WITH ONE IMAGE
        #
        # Вот главное изменение:
        # всю non-video статистику объявления
        # используем как proxy статистику картинки.
        # ====================================================

        extension_images = [
            a
            for a in images
            if a.get(
                "ad_asset_mode"
            )
            == "single_image_extension"
        ]

        if len(
            extension_images
        ) == 1:
            item = get_item(
                extension_images[0],
                row,
            )

            add_stats(
                item,
                row,
                "proxy",
            )

            continue

        # ====================================================
        # SMART
        # ====================================================

        if len(
            smart_assets
        ) == 1:
            item = get_item(
                smart_assets[0],
                row,
            )

            add_stats(
                item,
                row,
                "proxy",
            )

    # ========================================================
    # FINALIZE
    # ========================================================

    result = []

    for item in performances.values():
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
            if impressions > 0
            else 0
        )

        avg_cpc = (
            spend / clicks
            if clicks > 0
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
            avg_cpc,
            2
        )

        item.update(
            conversion_metrics(
                spend,
                clicks,
                {
                    "order_conversions": item.get("order_conversions", 0),
                    "webinar_conversions": item.get("webinar_conversions", 0),
                    "survey_conversions": item.get("survey_conversions", 0),
                },
            )
        )

        item[
            "exact_spend"
        ] = round(
            item[
                "exact_spend"
            ],
            2
        )

        item[
            "proxy_spend"
        ] = round(
            item[
                "proxy_spend"
            ],
            2
        )

        item[
            "shared_proxy_spend"
        ] = round(
            item[
                "shared_proxy_spend"
            ],
            2
        )

        item[
            "unattributed_spend"
        ] = round(
            item[
                "unattributed_spend"
            ],
            2
        )

        item["ad_ids"] = sorted(
            item["ad_ids"]
        )

        item[
            "ad_group_ids"
        ] = sorted(
            item[
                "ad_group_ids"
            ]
        )

        item[
            "unattributed_ad_ids"
        ] = sorted(
            item[
                "unattributed_ad_ids"
            ]
        )

        item[
            "attribution_types"
        ] = sorted(
            item[
                "attribution_types"
            ]
        )

        # Итоговый уровень уверенности.
        if (
            item[
                "exact_impressions"
            ] > 0
            and item[
                "proxy_impressions"
            ] == 0
        ):
            item[
                "attribution"
            ] = "exact"

        elif (
            item.get(
                "shared_proxy_impressions",
                0
            ) > 0
            and item[
                "exact_impressions"
            ] == 0
            and (
                item[
                    "proxy_impressions"
                ]
                ==
                item.get(
                    "shared_proxy_impressions",
                    0
                )
            )
        ):
            item[
                "attribution"
            ] = "shared_proxy"

        elif item[
            "impressions"
        ] > 0:
            item[
                "attribution"
            ] = "proxy"

        else:
            item[
                "attribution"
            ] = "unattributable"

        result.append(item)

    print(
        "Asset performance:",
        len(result),
        flush=True,
    )

    return result


# ============================================================
# METADATA
# ============================================================

def enrich_metadata(
    performances,
    registry,
    image_metadata,
    creative_metadata,
):
    for item in performances:
        registry_item = (
            registry.get(
                item["asset_key"],
                {}
            )
        )

        item["preview_url"] = (
            registry_item.get(
                "preview_url"
            )
        )

        item["thumbnail_url"] = (
            registry_item.get(
                "thumbnail_url"
            )
        )

        item["original_url"] = None
        item["name"] = None
        item["width"] = None
        item["height"] = None

        item["asset_type"] = (
            item["kind"]
        )

        item["subtype"] = None

        if item[
            "asset_key"
        ].startswith(
            "image:"
        ):
            meta = (
                image_metadata.get(
                    item["asset_id"],
                    {}
                )
            )

            item["name"] = (
                meta.get("Name")
            )

            item["preview_url"] = (
                meta.get("PreviewUrl")
                or item["preview_url"]
            )

            item["original_url"] = (
                meta.get("OriginalUrl")
            )

            item["asset_type"] = (
                meta.get("Type")
                or "IMAGE"
            )

            item["subtype"] = (
                meta.get("Subtype")
            )

        else:
            meta = (
                creative_metadata.get(
                    item["asset_id"],
                    {}
                )
            )

            item["name"] = (
                meta.get("Name")
            )

            item["preview_url"] = (
                meta.get("PreviewUrl")
                or item["preview_url"]
            )

            item["thumbnail_url"] = (
                meta.get("ThumbnailUrl")
                or item["thumbnail_url"]
            )

            item["asset_type"] = (
                meta.get("Type")
                or item["kind"]
            )

            item["width"] = (
                meta.get("Width")
            )

            item["height"] = (
                meta.get("Height")
            )


# ============================================================
# PERIOD STATS
# ============================================================

def period_stats(
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
                    "%Y-%m-%d",
                ).date()
            )

        except Exception:
            continue

        if not (
            start_date
            <= row_date
            <= end_date
        ):
            continue

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
        if impressions > 0
        else 0
    )

    cpc = (
        spend / clicks
        if clicks > 0
        else 0
    )

    return {
        "impressions": impressions,

        "clicks": clicks,

        "spend": round(
            spend,
            2
        ),

        "ctr": round(
            ctr,
            3
        ),

        "cpc": round(
            cpc,
            2
        ),
    }


# ============================================================
# TREND
# ============================================================

def calculate_trend(item):
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

    current = period_stats(
        item["daily"],
        current_start,
        current_end,
    )

    previous = period_stats(
        item["daily"],
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

    status = "stable"

    if (
        current["clicks"]
        < MIN_CLICKS_FOR_TREND
        or previous["clicks"]
        < MIN_CLICKS_FOR_TREND
    ):
        status = (
            "insufficient_data"
        )

    elif (
        ctr_change <= -20
        and cpc_change >= 15
    ):
        status = "fatigue"

    elif (
        ctr_change >= 20
        and cpc_change <= -10
    ):
        status = "improving"

    elif ctr_change <= -20:
        status = "ctr_declining"

    elif cpc_change >= 20:
        status = "cpc_growing"

    return {
        "current_7d": current,

        "previous_7d": previous,

        "ctr_change": round(
            ctr_change,
            1
        ),

        "cpc_change": round(
            cpc_change,
            1
        ),

        "status": status,
    }


# ============================================================
# BASELINES
# ============================================================

def build_baselines(
    performances
):
    groups = defaultdict(list)

    for item in performances:
        if (
            item["clicks"]
            < MIN_CLICKS_FOR_BASELINE
        ):
            continue

        if item[
            "impressions"
        ] <= 0:
            continue

        if item[
            "attribution"
        ] == "unattributable":
            continue

        key = (
            item["campaign_id"],
            item["network"],
            item["kind"],
        )

        groups[key].append(item)

    baselines = {}

    for key, items in groups.items():
        ctr_values = [
            item["ctr"]
            for item in items
            if item["ctr"] > 0
        ]

        cpc_values = [
            item["avg_cpc"]
            for item in items
            if item["avg_cpc"] > 0
        ]

        baselines[key] = {
            "count": len(items),

            "ctr": (
                median(ctr_values)
                if ctr_values
                else 0
            ),

            "cpc": (
                median(cpc_values)
                if cpc_values
                else 0
            ),
        }

    return baselines


# ============================================================
# SCORE
# ============================================================

def analyze_performance(
    item,
    baseline,
):
    # Вообще нет пригодной статистики.
    if item[
        "impressions"
    ] <= 0:
        return {
            "score": None,

            "status": (
                "unattributable"
            ),

            "reason": (
                "Яндекс не позволяет "
                "надёжно распределить "
                "статистику между несколькими "
                "визуальными ассетами."
            ),
        }

    if item[
        "clicks"
    ] < MIN_CLICKS_FOR_SCORE:
        return {
            "score": None,

            "status": (
                "insufficient_data"
            ),

            "reason": (
                "Креатив найден и статистика "
                "есть, но пока недостаточно "
                f"данных: меньше "
                f"{MIN_CLICKS_FOR_SCORE} кликов."
            ),
        }

    if (
        not baseline
        or baseline["count"] < 2
        or baseline["ctr"] <= 0
        or baseline["cpc"] <= 0
    ):
        return {
            "score": None,

            "status": "no_peers",

            "reason": (
                "Статистика есть, но в этой "
                "кампании недостаточно других "
                "сопоставимых креативов."
            ),
        }

    ctr_ratio = (
        item["ctr"]
        / baseline["ctr"]
    )

    cpc_ratio = (
        baseline["cpc"]
        / item["avg_cpc"]
        if item["avg_cpc"] > 0
        else 1
    )

    ctr_component = clamp(
        50
        + (
            ctr_ratio - 1
        ) * 100,
        0,
        100,
    )

    cpc_component = clamp(
        50
        + (
            cpc_ratio - 1
        ) * 100,
        0,
        100,
    )

    # CTR важнее.
    score = round(
        ctr_component * 0.60
        + cpc_component * 0.40
    )

    score = int(
        clamp(
            score,
            0,
            100
        )
    )

    if score >= 70:
        status = "successful"

        reason = (
            "Креатив работает лучше "
            "медианы сопоставимых "
            "креативов кампании."
        )

    elif score >= 45:
        status = "normal"

        reason = (
            "Креатив работает примерно "
            "на уровне медианы кампании."
        )

    else:
        status = "weak"

        reason = (
            "Креатив уступает "
            "сопоставимым визуалам "
            "по CTR и/или CPC."
        )

    if item[
        "attribution"
    ] == "proxy":
        reason += (
            " Оценка основана на "
            "статистике объявления, "
            "к которому привязан этот "
            "единственный визуал."
        )

    elif item[
        "attribution"
    ] == "shared_proxy":
        reason += (
            " Это контекстная proxy-оценка: "
            "в объявлении несколько визуалов, "
            "поэтому статистика объявления "
            "используется для каждого присутствующего "
            "ассета. Сравнение полезно для поиска "
            "сильных контекстов, но не доказывает "
            "индивидуальный вклад картинки."
        )

    return {
        "score": score,

        "status": status,

        "reason": reason,

        "ctr_ratio": round(
            ctr_ratio,
            2
        ),

        "cpc_ratio": round(
            cpc_ratio,
            2
        ),

        "baseline_ctr": round(
            baseline["ctr"],
            3
        ),

        "baseline_cpc": round(
            baseline["cpc"],
            2
        ),

        "peer_count": (
            baseline["count"]
        ),
    }


# ============================================================
# FINAL ANALYSIS
# ============================================================

def analyze_assets(
    performances
):
    baselines = build_baselines(
        performances
    )

    output = []

    for item in performances:
        baseline_key = (
            item["campaign_id"],
            item["network"],
            item["kind"],
        )

        analysis = analyze_performance(
            item,
            baselines.get(
                baseline_key
            ),
        )

        trend = calculate_trend(
            item
        )

        final_status = (
            analysis["status"]
        )

        if final_status not in (
            "unattributable",
            "insufficient_data",
            "no_peers",
        ):
            if (
                trend["status"]
                == "fatigue"
            ):
                final_status = (
                    "fatigue"
                )

            elif (
                trend["status"]
                == "improving"
            ):
                final_status = (
                    "improving"
                )

        result = {
            key: value
            for key, value
            in item.items()
            if key != "daily"
        }

        result.update(
            analysis
        )

        result[
            "base_status"
        ] = analysis["status"]

        result[
            "status"
        ] = final_status

        result[
            "trend"
        ] = trend

        output.append(result)

    priority = {
        "fatigue": 0,
        "weak": 1,
        "improving": 2,
        "successful": 3,
        "normal": 4,
        "insufficient_data": 5,
        "no_peers": 6,
        "unattributable": 7,
    }

    output.sort(
        key=lambda item: (
            priority.get(
                item["status"],
                99
            ),

            -item.get(
                "spend",
                0
            ),
        )
    )

    return output




# ============================================================
# SEARCH KEYWORDS
# ============================================================

def get_keyword_rows():
    """
    Статистика по заданным в Директе ключевым фразам.
    Конверсии разбиты на Order / вебинар / опрос.
    """

    fields = [
        "Date",
        "CampaignId",
        "CampaignName",
        "AdGroupId",
        "AdGroupName",
        "CriterionId",
        "Criterion",
        "CriterionType",
        "Impressions",
        "Clicks",
        "Cost",
        "Conversions",
    ]

    text = request_report(
        "MR Keyword Criteria goals v8",
        "CRITERIA_PERFORMANCE_REPORT",
        fields,
    )

    reader = csv.DictReader(
        io.StringIO(text),
        delimiter="\t",
    )

    grouped = {}

    for row in reader:
        if not row:
            continue

        criterion_type = str(
            row.get(
                "CriterionType",
                ""
            )
        ).strip().upper()

        if criterion_type != "KEYWORD":
            continue

        keyword = str(
            row.get(
                "Criterion",
                ""
            )
        ).strip()

        if keyword in (
            "",
            "-",
            "--",
        ):
            continue

        normalized = normalize_text(
            keyword
        )

        if normalized not in grouped:
            grouped[normalized] = {
                "keyword": keyword,
                "criterion_type": criterion_type,
                "criterion_ids": set(),
                "campaign_ids": set(),
                "campaign_names": set(),
                "ad_group_ids": set(),
                "ad_group_names": set(),
                "impressions": 0,
                "clicks": 0,
                "cost": 0.0,
                "order_conversions": 0.0,
                "webinar_conversions": 0.0,
                "survey_conversions": 0.0,
            }

        item = grouped[normalized]

        for field, target in (
            ("CriterionId", "criterion_ids"),
            ("CampaignId", "campaign_ids"),
            ("CampaignName", "campaign_names"),
            ("AdGroupId", "ad_group_ids"),
            ("AdGroupName", "ad_group_names"),
        ):
            value = str(
                row.get(
                    field,
                    ""
                )
            ).strip()

            if value not in (
                "",
                "-",
                "--",
            ):
                item[target].add(
                    value
                )

        item["impressions"] += safe_int(
            row.get("Impressions")
        )
        item["clicks"] += safe_int(
            row.get("Clicks")
        )
        item["cost"] += safe_float(
            row.get("Cost")
        )

        breakdown = (
            conversion_breakdown_from_row(
                row
            )
        )

        for field in (
            "order_conversions",
            "webinar_conversions",
            "survey_conversions",
        ):
            item[field] += breakdown[field]

    result = []

    for item in grouped.values():
        breakdown = {
            "order_conversions": item["order_conversions"],
            "webinar_conversions": item["webinar_conversions"],
            "survey_conversions": item["survey_conversions"],
        }

        conv = conversion_metrics(
            item["cost"],
            item["clicks"],
            breakdown,
        )

        impressions = item["impressions"]
        clicks = item["clicks"]
        cost = item["cost"]

        result.append({
            "keyword": item["keyword"],
            "criterion_type": item["criterion_type"],
            "criterion_ids": sorted(item["criterion_ids"]),
            "campaign_ids": sorted(item["campaign_ids"]),
            "campaign_names": sorted(item["campaign_names"]),
            "campaign_count": len(item["campaign_ids"]),
            "ad_group_ids": sorted(item["ad_group_ids"]),
            "ad_group_names": sorted(item["ad_group_names"]),
            "impressions": impressions,
            "clicks": clicks,
            "cost": round(cost, 2),
            "ctr": round(
                clicks
                / impressions
                * 100,
                3,
            ) if impressions else 0,
            "avg_cpc": round(
                cost
                / clicks,
                2,
            ) if clicks else 0,
            **conv,
        })

    # Order — основной бизнес-сигнал. Если Order пока нет
    # вообще, рейтинг автоматически опирается на сумму трёх типов.
    total_orders = sum(
        x["order_conversions"]
        for x in result
    )
    ranking_field = (
        "order_conversions"
        if total_orders > 0
        else "conversions"
    )
    ranking_cpa_field = (
        "order_cpa"
        if total_orders > 0
        else "cpa"
    )

    result.sort(
        key=lambda item: (
            -item[ranking_field],
            item[ranking_cpa_field]
            if item[ranking_cpa_field] > 0
            else float("inf"),
            -item["clicks"],
        )
    )

    converting = [
        item
        for item in result
        if item[ranking_field] > 0
    ]

    cpa_values = [
        item[ranking_cpa_field]
        for item in converting
        if item[ranking_cpa_field] > 0
    ]

    median_cpa = (
        median(cpa_values)
        if cpa_values
        else 0
    )

    max_conversions = max(
        (
            item[ranking_field]
            for item in converting
        ),
        default=0,
    )

    top_count = max(
        1,
        int(
            len(converting)
            * 0.20
            + 0.999
        )
    )

    converting_ranks = {
        normalize_text(
            item["keyword"]
        ): rank
        for rank, item in enumerate(
            converting,
            start=1,
        )
    }

    for index, item in enumerate(
        result,
        start=1,
    ):
        conversions = item[ranking_field]
        cpa = item[ranking_cpa_field]
        clicks = item["clicks"]

        if conversions > 0:
            converting_rank = (
                converting_ranks.get(
                    normalize_text(
                        item["keyword"]
                    )
                )
            )

            if (
                converting_rank is not None
                and converting_rank <= top_count
                and (
                    median_cpa <= 0
                    or cpa <= median_cpa * 1.20
                )
            ):
                status = "winner"

            elif (
                median_cpa > 0
                and cpa <= median_cpa
            ):
                status = "efficient"

            else:
                status = "converting"

            volume_score = (
                conversions
                / max_conversions
                * 100
                if max_conversions > 0
                else 0
            )

            efficiency_score = (
                min(
                    100,
                    median_cpa
                    / cpa
                    * 100
                )
                if (
                    median_cpa > 0
                    and cpa > 0
                )
                else 50
            )

            score = round(
                volume_score
                * 0.70
                + efficiency_score
                * 0.30
            )

        else:
            status = (
                "no_conversions"
                if clicks >= 20
                else "needs_data"
            )
            score = 0

        item["rank"] = index
        item["status"] = status
        item["score"] = int(
            clamp(
                score,
                0,
                100
            )
        )
        item["ranking_conversion_type"] = (
            "order"
            if ranking_field == "order_conversions"
            else "tracked_total"
        )

    ranking_total = sum(
        item[ranking_field]
        for item in result
    )

    for item in result:
        item["conversion_share"] = round(
            item[ranking_field]
            / ranking_total
            * 100,
            2,
        ) if ranking_total else 0
        item["median_cpa"] = round(
            median_cpa,
            2
        )

    print(
        "Keywords:",
        len(result),
        flush=True,
    )
    print(
        "Order conversions from keywords:",
        round(
            sum(
                x["order_conversions"]
                for x in result
            ),
            2,
        ),
        flush=True,
    )
    print(
        "Survey conversions from keywords:",
        round(
            sum(
                x["survey_conversions"]
                for x in result
            ),
            2,
        ),
        flush=True,
    )

    return result

def summarize_keywords(
    keywords
):
    total_cost = sum(
        item.get(
            "cost",
            0
        )
        for item in keywords
    )

    total_clicks = sum(
        item.get(
            "clicks",
            0
        )
        for item in keywords
    )

    order_conversions = sum(
        item.get(
            "order_conversions",
            0
        )
        for item in keywords
    )

    webinar_conversions = sum(
        item.get(
            "webinar_conversions",
            0
        )
        for item in keywords
    )

    survey_conversions = sum(
        item.get(
            "survey_conversions",
            0
        )
        for item in keywords
    )

    total_conversions = (
        order_conversions
        + webinar_conversions
        + survey_conversions
    )

    return {
        "total_keywords": len(
            keywords
        ),
        "with_order": sum(
            1
            for item in keywords
            if item.get(
                "order_conversions",
                0
            ) > 0
        ),
        "with_webinar": sum(
            1
            for item in keywords
            if item.get(
                "webinar_conversions",
                0
            ) > 0
        ),
        "with_survey": sum(
            1
            for item in keywords
            if item.get(
                "survey_conversions",
                0
            ) > 0
        ),
        "order_conversions": round(
            order_conversions,
            2
        ),
        "webinar_conversions": round(
            webinar_conversions,
            2
        ),
        "survey_conversions": round(
            survey_conversions,
            2
        ),
        "total_conversions": round(
            total_conversions,
            2
        ),
        "total_cost": round(
            total_cost,
            2
        ),
        "order_cpa": round(
            total_cost
            / order_conversions,
            2,
        ) if order_conversions else 0,
        "webinar_cpa": round(
            total_cost
            / webinar_conversions,
            2,
        ) if webinar_conversions else 0,
        "survey_cpa": round(
            total_cost
            / survey_conversions,
            2,
        ) if survey_conversions else 0,
        "order_cr": round(
            order_conversions
            / total_clicks
            * 100,
            3,
        ) if total_clicks else 0,
        "webinar_cr": round(
            webinar_conversions
            / total_clicks
            * 100,
            3,
        ) if total_clicks else 0,
        "survey_cr": round(
            survey_conversions
            / total_clicks
            * 100,
            3,
        ) if total_clicks else 0,
    }


# ============================================================
# ADVANCED INTELLIGENCE REPORTS
# ============================================================

def advanced_report_name(prefix, report_type, fields, date_from, date_to, filters=None, attribution_models=None, goals=None):
    signature = json.dumps(
        {
            "report_type": report_type,
            "fields": fields,
            "date_from": str(date_from),
            "date_to": str(date_to),
            "filters": filters or [],
            "attribution_models": attribution_models or [],
            "goals": goals or [],
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    digest = hashlib.sha1(signature.encode("utf-8")).hexdigest()[:12]
    return f"{prefix} {date_to.strftime('%Y%m%d')} {digest}"


def request_advanced_report(
    prefix,
    report_type,
    fields,
    filters=None,
    attribution_models=None,
    goals=None,
    order_by=None,
    with_header=True,
    days=REPORT_DAYS,
):
    today = datetime.now(timezone.utc).date()
    date_from = today - timedelta(days=days)
    date_to = today - timedelta(days=1)

    if "Conversions" in fields:
        if attribution_models is None:
            attribution_models = [
                CONVERSION_ATTRIBUTION_MODEL
            ]
        if goals is None:
            goals = TRACKED_GOAL_IDS

    report_name = advanced_report_name(
        prefix,
        report_type,
        fields,
        date_from,
        date_to,
        filters,
        attribution_models,
        goals,
    )

    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Accept-Language": "ru",
        "processingMode": "auto",
        "returnMoneyInMicros": "false",
        "skipReportHeader": "true",
        "skipColumnHeader": "false" if with_header else "true",
        "skipReportSummary": "true",
    }

    selection = {
        "DateFrom": date_from.isoformat(),
        "DateTo": date_to.isoformat(),
    }
    if filters:
        selection["Filter"] = filters

    params = {
        "SelectionCriteria": selection,
        "FieldNames": fields,
        "ReportName": report_name,
        "ReportType": report_type,
        "DateRangeType": "CUSTOM_DATE",
        "Format": "TSV",
        "IncludeVAT": "YES",
        "IncludeDiscount": "YES",
    }

    if attribution_models:
        params["AttributionModels"] = attribution_models
    if goals:
        params["Goals"] = [str(x) for x in goals]
    if order_by:
        params["OrderBy"] = order_by

    body = {"params": params}

    for attempt in range(1, 21):
        print(f"[advanced {attempt}/20] {report_name}", flush=True)
        response = requests.post(
            REPORTS_URL,
            headers=headers,
            json=body,
            timeout=120,
        )
        print(f"HTTP {response.status_code}", flush=True)

        if response.status_code == 200:
            return response.text

        if response.status_code in (201, 202):
            retry_in = safe_int(response.headers.get("retryIn", 10), 10)
            time.sleep(retry_in)
            continue

        print(response.text, flush=True)
        raise RuntimeError(
            f"Advanced report {prefix}: HTTP {response.status_code}: {response.text[:700]}"
        )

    raise RuntimeError(f"Advanced report timeout: {prefix}")


def parse_header_tsv(text):
    if not text or not text.strip():
        return []
    reader = csv.DictReader(io.StringIO(text), delimiter="\t")
    return [dict(row) for row in reader if row]


def optional_module(name, func, default):
    try:
        value = func()
        print(f"{name}: OK", flush=True)
        return value
    except Exception as error:
        print(f"{name}: skipped: {error}", flush=True)
        return default


def normalize_text(value):
    return " ".join(str(value or "").strip().lower().split())


def metrics_from_values(
    impressions,
    clicks,
    cost,
    conversions,
    order_conversions=0,
    webinar_conversions=0,
    survey_conversions=0,
):
    impressions = safe_int(impressions)
    clicks = safe_int(clicks)
    cost = safe_float(cost)
    conversions = safe_float(conversions)

    result = {
        "impressions": impressions,
        "clicks": clicks,
        "cost": round(cost, 2),
        "ctr": round(
            clicks
            / impressions
            * 100,
            3,
        ) if impressions else 0,
        "cpc": round(
            cost
            / clicks,
            2,
        ) if clicks else 0,
    }

    result.update(
        conversion_metrics(
            cost,
            clicks,
            {
                "order_conversions": order_conversions,
                "webinar_conversions": webinar_conversions,
                "survey_conversions": survey_conversions,
            },
        )
    )

    # В старых внутренних вызовах conversions может передаваться
    # отдельно. Если breakdown пустой, сохраняем совместимость.
    if (
        not result["conversions"]
        and conversions
    ):
        result["conversions"] = round(
            conversions,
            2
        )
        result["conversion_rate"] = round(
            conversions
            / clicks
            * 100,
            3,
        ) if clicks else 0
        result["cpa"] = round(
            cost
            / conversions,
            2,
        ) if conversions else 0

    return result


def metrics_from_report_row(row):
    breakdown = (
        conversion_breakdown_from_row(
            row
        )
    )

    return metrics_from_values(
        row.get("Impressions"),
        row.get("Clicks"),
        row.get("Cost"),
        breakdown["conversions"],
        breakdown["order_conversions"],
        breakdown["webinar_conversions"],
        breakdown["survey_conversions"],
    )


# ------------------------------------------------------------
# CAMPAIGN CONFIG / GOALS
# ------------------------------------------------------------

def extract_goal_ids_recursive(value):
    result = []

    if isinstance(
        value,
        dict
    ):
        for key, child in value.items():
            if (
                key == "GoalId"
                and child is not None
            ):
                goal_id = str(
                    child
                ).strip()

                if goal_id:
                    result.append(
                        goal_id
                    )

            else:
                result.extend(
                    extract_goal_ids_recursive(
                        child
                    )
                )

    elif isinstance(
        value,
        list
    ):
        for child in value:
            result.extend(
                extract_goal_ids_recursive(
                    child
                )
            )

    return result


def readable_goal_name(goal_id):
    goal_id = str(
        goal_id
    )

    return KNOWN_GOAL_NAMES.get(
        goal_id,
        f"Цель {goal_id}",
    )


def get_campaign_configuration():
    payload = {
        "method": "get",
        "params": {
            "SelectionCriteria": {},
            "FieldNames": [
                "Id",
                "Name",
                "Type",
                "State",
                "Status",
                "NegativeKeywords",
            ],
            "TextCampaignFieldNames": [
                "CounterIds",
                "PriorityGoals",
                "AttributionModel",
                "BiddingStrategy",
                "PackageBiddingStrategy",
            ],
            "CpmBannerCampaignFieldNames": [
                "CounterIds",
            ],
            "UnifiedCampaignFieldNames": [
                "CounterIds",
                "PriorityGoals",
                "AttributionModel",
                "BiddingStrategy",
                "PackageBiddingStrategy",
            ],
            "Page": {
                "Limit": 10000,
                "Offset": 0,
            },
        },
    }

    result = direct_api(
        CAMPAIGNS_URL,
        payload,
        "Campaigns.get",
    )

    campaigns = []
    goal_ids = set()
    display_ids = []

    for campaign in result.get(
        "Campaigns",
        []
    ):
        item = {
            "id": str(
                campaign.get(
                    "Id",
                    ""
                )
            ),
            "name": (
                campaign.get(
                    "Name"
                )
                or ""
            ),
            "type": (
                campaign.get(
                    "Type"
                )
                or ""
            ),
            "state": (
                campaign.get(
                    "State"
                )
                or ""
            ),
            "status": (
                campaign.get(
                    "Status"
                )
                or ""
            ),
            "negative_keywords": [],
            "counter_ids": [],
            "priority_goals": [],
            "attribution_model": None,
            "bidding_strategy": {},
            "package_strategy_id": None,
            "package_strategy_platforms": {},
        }

        negative_keywords = (
            campaign.get(
                "NegativeKeywords"
            )
            or {}
        )

        item[
            "negative_keywords"
        ] = [
            str(value)
            for value in (
                negative_keywords.get(
                    "Items"
                )
                or []
            )
            if str(
                value
            ).strip()
        ]

        block = (
            campaign.get(
                "TextCampaign"
            )
            or campaign.get(
                "UnifiedCampaign"
            )
            or campaign.get(
                "CpmBannerCampaign"
            )
            or {}
        )

        counter_ids = (
            block.get(
                "CounterIds"
            )
            or {}
        )

        item[
            "counter_ids"
        ] = [
            str(x)
            for x in (
                counter_ids.get(
                    "Items"
                )
                or []
            )
        ]

        priority_goals = (
            block.get(
                "PriorityGoals"
            )
            or {}
        )

        for goal in (
            priority_goals.get(
                "Items"
            )
            or []
        ):
            goal_id = str(
                goal.get(
                    "GoalId",
                    ""
                )
            ).strip()

            if not goal_id:
                continue

            goal_ids.add(
                goal_id
            )

            raw_value = safe_float(
                goal.get(
                    "Value"
                )
            )

            item[
                "priority_goals"
            ].append({
                "goal_id": goal_id,
                "goal_name": (
                    readable_goal_name(
                        goal_id
                    )
                ),
                "value_raw": raw_value,
                "value_currency": round(
                    raw_value
                    / 1_000_000,
                    2,
                ) if raw_value else 0,
                "is_metrika_source_of_value": (
                    goal.get(
                        "IsMetrikaSourceOfValue"
                    )
                ),
            })

        item[
            "attribution_model"
        ] = block.get(
            "AttributionModel"
        )

        item[
            "bidding_strategy"
        ] = (
            block.get(
                "BiddingStrategy"
            )
            or {}
        )

        package = (
            block.get(
                "PackageBiddingStrategy"
            )
            or {}
        )

        if package.get(
            "StrategyId"
        ) is not None:
            item[
                "package_strategy_id"
            ] = str(
                package.get(
                    "StrategyId"
                )
            )

        item[
            "package_strategy_platforms"
        ] = (
            package.get(
                "Platforms"
            )
            or {}
        )

        if (
            item[
                "type"
            ]
            ==
            "CPM_BANNER_CAMPAIGN"
        ):
            display_ids.append(
                item["id"]
            )

        campaigns.append(
            item
        )

    return {
        "campaigns": campaigns,
        "goal_ids": sorted(
            goal_ids
        ),
        "display_campaign_ids": (
            display_ids
        ),
        "summary": {
            "campaigns": len(
                campaigns
            ),
            "with_counters": sum(
                1
                for x in campaigns
                if x[
                    "counter_ids"
                ]
            ),
            "priority_goals": len(
                goal_ids
            ),
            "with_negative_keywords": sum(
                1
                for x in campaigns
                if x[
                    "negative_keywords"
                ]
            ),
            "display_campaigns": len(
                display_ids
            ),
        },
    }

# ------------------------------------------------------------
# PORTFOLIO STRATEGIES / GOALS
# ------------------------------------------------------------

def get_strategy_configuration():
    payload = {
        "method": "get",
        "params": {
            "SelectionCriteria": {},
            "FieldNames": [
                "Id",
                "Name",
                "Type",
                "StatusArchived",
                "AttributionModel",
                "CounterIds",
                "PriorityGoals",
            ],
            "StrategyMaximumConversionRateFieldNames": [
                "GoalId",
            ],
            "StrategyAverageCpaFieldNames": [
                "GoalId",
                "AverageCpa",
            ],
            "StrategyPayForConversionFieldNames": [
                "GoalId",
                "Cpa",
            ],
            "StrategyAverageCrrFieldNames": [
                "GoalId",
                "Crr",
            ],
            "StrategyPayForConversionCrrFieldNames": [
                "GoalId",
                "Crr",
            ],
            "StrategyPayForConversionMultipleGoalsFieldNames": [
                "GoalId",
            ],
            "Page": {
                "Limit": 10000,
                "Offset": 0,
            },
        },
    }

    result = direct_api(
        STRATEGIES_URL,
        payload,
        "Strategies.get",
    )

    rows = []
    goal_ids = set()

    for item in result.get(
        "Strategies",
        []
    ):
        goals = []

        for goal in (
            (
                item.get(
                    "PriorityGoals"
                )
                or {}
            ).get(
                "Items"
            )
            or []
        ):
            gid = str(
                goal.get(
                    "GoalId"
                )
                or ""
            ).strip()

            if not gid:
                continue

            goal_ids.add(
                gid
            )

            raw_value = safe_float(
                goal.get(
                    "Value"
                )
            )

            goals.append({
                "goal_id": gid,
                "goal_name": (
                    readable_goal_name(
                        gid
                    )
                ),
                "value_raw": raw_value,
                "value_currency": round(
                    raw_value
                    / 1_000_000,
                    2,
                ) if raw_value else 0,
                "is_metrika_source_of_value": (
                    goal.get(
                        "IsMetrikaSourceOfValue"
                    )
                ),
            })

        strategy_goal_ids = sorted(
            set(
                extract_goal_ids_recursive(
                    item
                )
            )
        )

        rows.append({
            "id": str(
                item.get(
                    "Id"
                )
                or ""
            ),
            "name": (
                item.get(
                    "Name"
                )
                or ""
            ),
            "type": (
                item.get(
                    "Type"
                )
                or ""
            ),
            "status_archived": (
                item.get(
                    "StatusArchived"
                )
                or ""
            ),
            "attribution_model": (
                item.get(
                    "AttributionModel"
                )
            ),
            "counter_ids": [
                str(x)
                for x in (
                    (
                        item.get(
                            "CounterIds"
                        )
                        or {}
                    ).get(
                        "Items"
                    )
                    or []
                )
            ],
            "priority_goals": goals,
            "strategy_goal_ids": (
                strategy_goal_ids
            ),
        })

    return {
        "rows": rows,
        "goal_ids": sorted(
            goal_ids
        ),
        "summary": {
            "strategies": len(
                rows
            ),
            "priority_goals": len(
                goal_ids
            ),
        },
    }


# ------------------------------------------------------------
# KEYWORD CONFIGURATION / STATUS
# ------------------------------------------------------------

def get_keyword_configuration(
    campaign_ids
):
    campaign_ids = sorted({
        int(x)
        for x in campaign_ids
        if str(x).isdigit()
    })

    by_id = {}
    rows = []

    for campaign_chunk in chunks(
        campaign_ids,
        10,
    ):
        offset = 0

        while True:
            payload = {
                "method": "get",
                "params": {
                    "SelectionCriteria": {
                        "CampaignIds": (
                            campaign_chunk
                        ),
                    },
                    "FieldNames": [
                        "Id",
                        "Keyword",
                        "State",
                        "Status",
                        "ServingStatus",
                        "AdGroupId",
                        "CampaignId",
                    ],
                    "Page": {
                        "Limit": 10000,
                        "Offset": offset,
                    },
                },
            }

            result = direct_api(
                KEYWORDS_URL,
                payload,
                "Keywords.get",
            )

            batch = result.get(
                "Keywords",
                []
            )

            for item in batch:
                row = {
                    "id": str(
                        item.get(
                            "Id"
                        )
                        or ""
                    ),
                    "keyword": (
                        item.get(
                            "Keyword"
                        )
                        or ""
                    ),
                    "state": (
                        item.get(
                            "State"
                        )
                        or "UNKNOWN"
                    ),
                    "status": (
                        item.get(
                            "Status"
                        )
                        or "UNKNOWN"
                    ),
                    "serving_status": (
                        item.get(
                            "ServingStatus"
                        )
                        or "UNKNOWN"
                    ),
                    "ad_group_id": str(
                        item.get(
                            "AdGroupId"
                        )
                        or ""
                    ),
                    "campaign_id": str(
                        item.get(
                            "CampaignId"
                        )
                        or ""
                    ),
                }

                rows.append(
                    row
                )

                if row["id"]:
                    by_id[
                        row["id"]
                    ] = row

            if len(
                batch
            ) < 10000:
                break

            offset += 10000

    return {
        "rows": rows,
        "by_id": by_id,
        "summary": {
            "keywords": len(
                rows
            ),
            "on": sum(
                1
                for x in rows
                if x["state"] == "ON"
            ),
            "suspended": sum(
                1
                for x in rows
                if x["state"]
                == "SUSPENDED"
            ),
            "rejected": sum(
                1
                for x in rows
                if x["status"]
                == "REJECTED"
            ),
            "rarely_served": sum(
                1
                for x in rows
                if x[
                    "serving_status"
                ]
                == "RARELY_SERVED"
            ),
        },
    }


def enrich_keywords_with_configuration(
    keywords,
    keyword_configuration,
):
    by_id = (
        keyword_configuration.get(
            "by_id",
            {}
        )
    )

    for item in keywords:
        states = set()
        statuses = set()
        serving_statuses = set()
        config_rows = []

        for criterion_id in (
            item.get(
                "criterion_ids",
                []
            )
        ):
            config = by_id.get(
                str(
                    criterion_id
                )
            )

            if not config:
                continue

            config_rows.append(
                config
            )
            states.add(
                config[
                    "state"
                ]
            )
            statuses.add(
                config[
                    "status"
                ]
            )
            serving_statuses.add(
                config[
                    "serving_status"
                ]
            )

        item["states"] = sorted(
            states
        )
        item["statuses"] = sorted(
            statuses
        )
        item[
            "serving_statuses"
        ] = sorted(
            serving_statuses
        )
        item[
            "rarely_served"
        ] = (
            "RARELY_SERVED"
            in serving_statuses
        )
        item[
            "keyword_configurations"
        ] = config_rows

    return keywords


def normalize_negative_phrase(
    value
):
    value = str(
        value
        or ""
    ).lower()

    # Убираем служебные операторы Direct и оставляем слова.
    value = re.sub(
        r"[!+\\-\\[\\]\\(\\)\\\"']",
        " ",
        value,
    )

    return " ".join(
        value.split()
    )


def negative_phrase_matches_query(
    negative_phrase,
    query
):
    negative = (
        normalize_negative_phrase(
            negative_phrase
        )
    )

    query = normalize_text(
        query
    )

    if not negative:
        return False

    negative_tokens = (
        negative.split()
    )
    query_tokens = (
        query.split()
    )

    if not negative_tokens:
        return False

    if len(
        negative_tokens
    ) == 1:
        return (
            negative_tokens[0]
            in query_tokens
        )

    # Проверяем последовательность слов.
    size = len(
        negative_tokens
    )

    for index in range(
        0,
        len(query_tokens)
        - size
        + 1,
    ):
        if (
            query_tokens[
                index:index + size
            ]
            ==
            negative_tokens
        ):
            return True

    return False


def build_negative_keyword_audit(
    campaign_configuration,
    search_queries,
):
    query_rows = (
        search_queries.get(
            "rows",
            []
        )
    )

    campaigns = []

    for campaign in (
        campaign_configuration.get(
            "campaigns",
            []
        )
    ):
        negatives = (
            campaign.get(
                "negative_keywords",
                []
            )
        )

        conflict_rows = []

        for negative in negatives:
            matches = []

            for query in query_rows:
                query_campaign_ids = {
                    str(x)
                    for x in (
                        query.get(
                            "campaign_ids",
                            []
                        )
                    )
                }

                if (
                    campaign["id"]
                    not in query_campaign_ids
                ):
                    continue

                if (
                    safe_float(
                        query.get(
                            "conversions"
                        )
                    )
                    <= 0
                ):
                    continue

                if negative_phrase_matches_query(
                    negative,
                    query.get(
                        "query"
                    ),
                ):
                    matches.append({
                        "query": query.get(
                            "query"
                        ),
                        "order_conversions": (
                            query.get(
                                "order_conversions",
                                0
                            )
                        ),
                        "webinar_conversions": (
                            query.get(
                                "webinar_conversions",
                                0
                            )
                        ),
                        "survey_conversions": (
                            query.get(
                                "survey_conversions",
                                0
                            )
                        ),
                        "cost": query.get(
                            "cost",
                            0
                        ),
                    })

            if matches:
                conflict_rows.append({
                    "negative_keyword": (
                        negative
                    ),
                    "historical_converting_queries": (
                        matches[:20]
                    ),
                    "match_count": len(
                        matches
                    ),
                })

        campaigns.append({
            "campaign_id": (
                campaign["id"]
            ),
            "campaign_name": (
                campaign["name"]
            ),
            "negative_keywords": (
                negatives
            ),
            "negative_count": len(
                negatives
            ),
            "potential_conflicts": (
                conflict_rows
            ),
            "potential_conflict_count": sum(
                x["match_count"]
                for x in conflict_rows
            ),
        })

    campaigns.sort(
        key=lambda x: (
            -x[
                "potential_conflict_count"
            ],
            -x[
                "negative_count"
            ],
            x[
                "campaign_name"
            ],
        )
    )

    return {
        "campaigns": campaigns,
        "summary": {
            "campaigns": len(
                campaigns
            ),
            "campaigns_with_negatives": sum(
                1
                for x in campaigns
                if x[
                    "negative_count"
                ] > 0
            ),
            "negative_keywords": sum(
                x[
                    "negative_count"
                ]
                for x in campaigns
            ),
            "potential_conflicts": sum(
                x[
                    "potential_conflict_count"
                ]
                for x in campaigns
            ),
        },
        "note": (
            "Конфликт — диагностический сигнал: текущая минус-фраза "
            "совпала с историческим поисковым запросом этой кампании, "
            "в котором были отслеживаемые конверсии. Это не доказывает, "
            "что минус-фраза сейчас блокирует этот запрос: она могла быть "
            "добавлена позже."
        ),
    }


def effective_goal_ids(
    strategy_type,
    strategy_goal_ids,
    priority_goals,
):
    strategy_type = str(
        strategy_type
        or ""
    ).upper()

    strategy_goal_ids = [
        str(x)
        for x in (
            strategy_goal_ids
            or []
        )
        if str(
            x
        ).strip()
    ]

    priority_ids = [
        str(
            x.get(
                "goal_id"
            )
        )
        for x in (
            priority_goals
            or []
        )
        if str(
            x.get(
                "goal_id"
            )
            or ""
        ).strip()
    ]

    if "13" in strategy_goal_ids:
        return (
            priority_ids,
            "priority_goals",
        )

    direct = [
        x
        for x in strategy_goal_ids
        if x != "13"
    ]

    if direct:
        return (
            direct,
            "strategy_goal",
        )

    if (
        "MULTIPLE_GOALS"
        in strategy_type
        or "MAX_PROFIT"
        in strategy_type
    ):
        return (
            priority_ids,
            "priority_goals",
        )

    if strategy_type in (
        "WB_MAXIMUM_CLICKS",
        "AVERAGE_CPC",
        "HIGHEST_POSITION",
        "NETWORK_DEFAULT",
        "SERVING_OFF",
    ):
        return (
            [],
            "no_conversion_goal",
        )

    # Если в кампании присутствуют PriorityGoals, но конкретный
    # GoalId не вернулся, показываем их как цели автоматической
    # корректировки, не выдавая их за доказанный strategy GoalId.
    if priority_ids:
        return (
            priority_ids,
            "priority_goals_adjustment",
        )

    return (
        [],
        "unknown",
    )


def build_priority_goals_intelligence(
    campaign_configuration,
    strategy_configuration,
):
    portfolio_map = {
        str(
            item.get(
                "id"
            )
        ): item
        for item in (
            strategy_configuration.get(
                "rows",
                []
            )
        )
    }

    rows = []

    for campaign in (
        campaign_configuration.get(
            "campaigns",
            []
        )
    ):
        bidding = (
            campaign.get(
                "bidding_strategy",
                {}
            )
            or {}
        )

        package_strategy_id = (
            campaign.get(
                "package_strategy_id"
            )
        )

        package_platforms = (
            campaign.get(
                "package_strategy_platforms",
                {}
            )
            or {}
        )

        portfolio = (
            portfolio_map.get(
                str(
                    package_strategy_id
                )
            )
            if package_strategy_id
            else None
        )

        for channel_key, channel_label in (
            ("Search", "Поиск"),
            ("Network", "РСЯ"),
        ):
            channel = (
                bidding.get(
                    channel_key
                )
                or {}
            )

            strategy_type = (
                channel.get(
                    "BiddingStrategyType"
                )
                or ""
            )

            package_applies = False

            if portfolio:
                if channel_key == "Network":
                    package_applies = (
                        package_platforms.get(
                            "Network"
                        )
                        == "YES"
                    )
                else:
                    package_applies = any(
                        package_platforms.get(
                            key
                        )
                        == "YES"
                        for key in (
                            "SearchResult",
                            "SearchResults",
                            "ProductGallery",
                            "DynamicPlaces",
                            "Maps",
                            "SearchOrganizationList",
                        )
                    )

            if package_applies:
                strategy_type = (
                    portfolio.get(
                        "type"
                    )
                    or strategy_type
                )

                priority_goals = (
                    portfolio.get(
                        "priority_goals",
                        []
                    )
                )

                strategy_goal_ids = (
                    portfolio.get(
                        "strategy_goal_ids",
                        []
                    )
                )

                attribution_model = (
                    portfolio.get(
                        "attribution_model"
                    )
                    or campaign.get(
                        "attribution_model"
                    )
                )

                strategy_source = (
                    "portfolio"
                )

                strategy_name = (
                    portfolio.get(
                        "name"
                    )
                    or ""
                )

            else:
                priority_goals = (
                    campaign.get(
                        "priority_goals",
                        []
                    )
                )

                strategy_goal_ids = (
                    extract_goal_ids_recursive(
                        channel
                    )
                )

                attribution_model = (
                    campaign.get(
                        "attribution_model"
                    )
                )

                strategy_source = (
                    "campaign"
                )

                strategy_name = ""

            if (
                not strategy_type
                and not priority_goals
                and not strategy_goal_ids
            ):
                continue

            goal_ids, goal_source = (
                effective_goal_ids(
                    strategy_type,
                    strategy_goal_ids,
                    priority_goals,
                )
            )

            priority_value_map = {
                str(
                    item.get(
                        "goal_id"
                    )
                ): item
                for item in (
                    priority_goals
                    or []
                )
            }

            goals = []

            for goal_id in goal_ids:
                meta = (
                    priority_value_map.get(
                        str(
                            goal_id
                        )
                    )
                    or {}
                )

                goals.append({
                    "goal_id": str(
                        goal_id
                    ),
                    "goal_name": (
                        readable_goal_name(
                            goal_id
                        )
                    ),
                    "value_currency": (
                        meta.get(
                            "value_currency",
                            0
                        )
                    ),
                    "is_metrika_source_of_value": (
                        meta.get(
                            "is_metrika_source_of_value"
                        )
                    ),
                })

            rows.append({
                "campaign_id": (
                    campaign["id"]
                ),
                "campaign_name": (
                    campaign["name"]
                ),
                "campaign_state": (
                    campaign["state"]
                ),
                "channel": channel_label,
                "strategy_type": (
                    strategy_type
                ),
                "strategy_source": (
                    strategy_source
                ),
                "portfolio_strategy_id": (
                    str(
                        package_strategy_id
                    )
                    if package_applies
                    else None
                ),
                "portfolio_strategy_name": (
                    strategy_name
                ),
                "attribution_model": (
                    attribution_model
                ),
                "goal_source": goal_source,
                "optimization_goals": goals,
                "priority_goals": (
                    priority_goals
                ),
            })

    rows.sort(
        key=lambda x: (
            x[
                "campaign_name"
            ],
            x[
                "channel"
            ],
        )
    )

    return {
        "rows": rows,
        "summary": {
            "rows": len(
                rows
            ),
            "campaigns": len({
                x[
                    "campaign_id"
                ]
                for x in rows
            }),
            "using_portfolio": sum(
                1
                for x in rows
                if x[
                    "strategy_source"
                ]
                == "portfolio"
            ),
            "with_explicit_optimization_goals": sum(
                1
                for x in rows
                if x[
                    "optimization_goals"
                ]
            ),
            "without_conversion_goal": sum(
                1
                for x in rows
                if x[
                    "goal_source"
                ]
                == "no_conversion_goal"
            ),
        },
        "note": (
            "Для conversion-стратегий фактическая цель берётся из GoalId. "
            "GoalId=13 означает использование PriorityGoals. Для портфельных "
            "стратегий используются настройки Strategies.get. Если GoalId не "
            "вернулся, но у кампании заданы PriorityGoals, они показываются "
            "отдельно как цели автоматической корректировки, а не как "
            "доказанный strategy GoalId."
        ),
    }


# ------------------------------------------------------------
# SEARCH QUERY INTELLIGENCE
# ------------------------------------------------------------

def build_search_query_intelligence(existing_keywords):
    fields = [
        "CampaignId",
        "CampaignName",
        "AdGroupId",
        "AdGroupName",
        "Query",
        "Criterion",
        "MatchedKeyword",
        "MatchType",
        "Impressions",
        "Clicks",
        "Cost",
        "Conversions",
    ]

    text = request_advanced_report(
        "MR Search Queries goals v8",
        "SEARCH_QUERY_PERFORMANCE_REPORT",
        fields,
        order_by=[
            {
                "Field": "Cost",
                "SortOrder": "DESCENDING",
            }
        ],
    )
    rows = parse_header_tsv(
        text
    )

    existing = {
        normalize_text(
            item.get("keyword")
        )
        for item in existing_keywords
        if item.get("keyword")
    }

    grouped = {}

    for row in rows:
        query = str(
            row.get("Query")
            or ""
        ).strip()

        if not query or query in (
            "-",
            "--",
        ):
            continue

        criterion = str(
            row.get("Criterion")
            or ""
        ).strip()

        matched = str(
            row.get("MatchedKeyword")
            or ""
        ).strip()

        match_type = str(
            row.get("MatchType")
            or "NONE"
        ).strip()

        key = (
            normalize_text(query),
            normalize_text(criterion),
            normalize_text(matched),
            match_type,
        )

        if key not in grouped:
            grouped[key] = {
                "query": query,
                "criterion": criterion,
                "matched_keyword": matched,
                "match_type": match_type,
                "campaign_ids": set(),
                "campaign_names": set(),
                "ad_group_ids": set(),
                "ad_group_names": set(),
                "impressions": 0,
                "clicks": 0,
                "cost": 0.0,
                "order_conversions": 0.0,
                "webinar_conversions": 0.0,
                "survey_conversions": 0.0,
            }

        item = grouped[key]

        for field, target in (
            ("CampaignId", "campaign_ids"),
            ("CampaignName", "campaign_names"),
            ("AdGroupId", "ad_group_ids"),
            ("AdGroupName", "ad_group_names"),
        ):
            value = str(
                row.get(field)
                or ""
            ).strip()

            if value and value not in (
                "-",
                "--",
            ):
                item[target].add(
                    value
                )

        item["impressions"] += safe_int(
            row.get("Impressions")
        )
        item["clicks"] += safe_int(
            row.get("Clicks")
        )
        item["cost"] += safe_float(
            row.get("Cost")
        )

        breakdown = (
            conversion_breakdown_from_row(
                row
            )
        )

        for field in (
            "order_conversions",
            "webinar_conversions",
            "survey_conversions",
        ):
            item[field] += breakdown[field]

    output = []

    for item in grouped.values():
        m = metrics_from_values(
            item["impressions"],
            item["clicks"],
            item["cost"],
            (
                item["order_conversions"]
                + item["webinar_conversions"]
                + item["survey_conversions"]
            ),
            item["order_conversions"],
            item["webinar_conversions"],
            item["survey_conversions"],
        )

        query_is_existing_keyword = (
            normalize_text(
                item["query"]
            )
            in existing
        )

        # Любая из трёх конверсий считается положительным
        # сигналом, но Order в интерфейсе показан отдельно.
        if (
            m["conversions"] > 0
            and not query_is_existing_keyword
        ):
            recommendation = (
                "new_keyword_candidate"
            )

        elif (
            m["conversions"] == 0
            and m["clicks"] >= 10
            and m["cost"] >= 1000
        ):
            recommendation = (
                "negative_candidate"
            )

        elif (
            item["match_type"]
            in (
                "SYNONYM",
                "RELATED_KEYWORD",
            )
            and m["cost"] >= 1000
        ):
            recommendation = (
                "semantic_expansion_review"
            )

        elif m["conversions"] > 0:
            recommendation = (
                "converting"
            )

        else:
            recommendation = (
                "monitor"
            )

        output.append({
            **{
                k: v
                for k, v
                in item.items()
                if not isinstance(
                    v,
                    set
                )
            },
            **m,
            "campaign_ids": sorted(
                item["campaign_ids"]
            ),
            "campaign_names": sorted(
                item["campaign_names"]
            ),
            "ad_group_ids": sorted(
                item["ad_group_ids"]
            ),
            "ad_group_names": sorted(
                item["ad_group_names"]
            ),
            "query_is_existing_keyword": (
                query_is_existing_keyword
            ),
            "recommendation": recommendation,
        })

    output.sort(
        key=lambda x: (
            -x["order_conversions"],
            -x["survey_conversions"],
            -x["cost"],
        )
    )

    total_cost = sum(
        x["cost"]
        for x in output
    )

    waste = [
        x
        for x in output
        if x["recommendation"]
        == "negative_candidate"
    ]

    new_keys = [
        x
        for x in output
        if x["recommendation"]
        == "new_keyword_candidate"
    ]

    semantic_cost = sum(
        x["cost"]
        for x in output
        if x["match_type"]
        in (
            "SYNONYM",
            "RELATED_KEYWORD",
        )
    )

    return {
        "rows": output[:1000],
        "summary": {
            "queries": len(output),
            "with_order": sum(
                1
                for x in output
                if x["order_conversions"] > 0
            ),
            "with_webinar": sum(
                1
                for x in output
                if x["webinar_conversions"] > 0
            ),
            "with_survey": sum(
                1
                for x in output
                if x["survey_conversions"] > 0
            ),
            "order_conversions": round(
                sum(
                    x["order_conversions"]
                    for x in output
                ),
                2,
            ),
            "webinar_conversions": round(
                sum(
                    x["webinar_conversions"]
                    for x in output
                ),
                2,
            ),
            "survey_conversions": round(
                sum(
                    x["survey_conversions"]
                    for x in output
                ),
                2,
            ),
            "negative_candidates": len(
                waste
            ),
            "negative_candidate_spend": round(
                sum(
                    x["cost"]
                    for x in waste
                ),
                2,
            ),
            "new_keyword_candidates": len(
                new_keys
            ),
            "semantic_expansion_spend": round(
                semantic_cost,
                2,
            ),
            "semantic_expansion_share": round(
                semantic_cost
                / total_cost
                * 100,
                2,
            ) if total_cost else 0,
        },
    }

# ------------------------------------------------------------
# PLACEMENT INTELLIGENCE
# ------------------------------------------------------------

def build_placement_intelligence():
    # Отдельно получаем goal-specific конверсии и поведенческие
    # метрики. Так динамические Conversions_<goal> не теряются
    # из-за комбинации большого числа метрик в одном отчёте.
    goal_fields = [
        "Placement",
        "ExternalNetworkName",
        "Device",
        "Impressions",
        "Clicks",
        "Cost",
        "Conversions",
    ]

    goal_text = request_advanced_report(
        "MR Placements goals v9",
        "CUSTOM_REPORT",
        goal_fields,
        filters=[{
            "Field": "AdNetworkType",
            "Operator": "EQUALS",
            "Values": ["AD_NETWORK"],
        }],
        order_by=[
            {
                "Field": "Cost",
                "SortOrder": "DESCENDING",
            }
        ],
    )

    goal_rows = parse_header_tsv(
        goal_text
    )

    quality_rows = []

    try:
        quality_fields = [
            "Placement",
            "ExternalNetworkName",
            "Device",
            "Sessions",
            "Bounces",
            "AvgPageviews",
        ]

        quality_text = request_advanced_report(
            "MR Placements quality v9",
            "CUSTOM_REPORT",
            quality_fields,
            filters=[{
                "Field": "AdNetworkType",
                "Operator": "EQUALS",
                "Values": ["AD_NETWORK"],
            }],
        )

        quality_rows = parse_header_tsv(
            quality_text
        )

    except Exception as error:
        print(
            "Placement quality metrics skipped:",
            error,
            flush=True,
        )

    quality_map = {}

    for row in quality_rows:
        key = (
            str(
                row.get(
                    "Placement"
                )
                or ""
            ).strip(),
            str(
                row.get(
                    "ExternalNetworkName"
                )
                or ""
            ).strip(),
            str(
                row.get(
                    "Device"
                )
                or ""
            ).strip(),
        )

        if key not in quality_map:
            quality_map[key] = {
                "sessions": 0,
                "bounces": 0,
                "pageviews_weighted": 0.0,
            }

        q = quality_map[
            key
        ]

        sessions = safe_int(
            row.get(
                "Sessions"
            )
        )

        avg_pageviews = safe_float(
            row.get(
                "AvgPageviews"
            )
        )

        q["sessions"] += (
            sessions
        )

        q["bounces"] += safe_int(
            row.get(
                "Bounces"
            )
        )

        q[
            "pageviews_weighted"
        ] += (
            avg_pageviews
            * sessions
        )

    grouped = {}

    goal_column_names = set()

    for row in goal_rows:
        goal_column_names.update(
            key
            for key in row.keys()
            if str(
                key
            ).startswith(
                "Conversions_"
            )
        )

        placement = str(
            row.get(
                "Placement"
            )
            or ""
        ).strip()

        if (
            not placement
            or placement
            in (
                "-",
                "--",
            )
        ):
            continue

        network = str(
            row.get(
                "ExternalNetworkName"
            )
            or ""
        ).strip()

        device = str(
            row.get(
                "Device"
            )
            or ""
        ).strip()

        key = (
            placement,
            network,
        )

        if key not in grouped:
            grouped[key] = {
                "placement": (
                    placement
                ),
                "external_network": (
                    network
                ),
                "devices": set(),
                "impressions": 0,
                "clicks": 0,
                "cost": 0.0,
                "order_conversions": 0.0,
                "webinar_conversions": 0.0,
                "survey_conversions": 0.0,
                "sessions": 0,
                "bounces": 0,
                "pageviews_weighted": 0.0,
            }

        item = grouped[
            key
        ]

        if device:
            item[
                "devices"
            ].add(
                device
            )

        item[
            "impressions"
        ] += safe_int(
            row.get(
                "Impressions"
            )
        )

        item[
            "clicks"
        ] += safe_int(
            row.get(
                "Clicks"
            )
        )

        item[
            "cost"
        ] += safe_float(
            row.get(
                "Cost"
            )
        )

        breakdown = (
            conversion_breakdown_from_row(
                row
            )
        )

        for field in (
            "order_conversions",
            "webinar_conversions",
            "survey_conversions",
        ):
            item[field] += (
                breakdown[
                    field
                ]
            )

        q = quality_map.get(
            (
                placement,
                network,
                device,
            ),
            {}
        )

        item[
            "sessions"
        ] += safe_int(
            q.get(
                "sessions"
            )
        )

        item[
            "bounces"
        ] += safe_int(
            q.get(
                "bounces"
            )
        )

        item[
            "pageviews_weighted"
        ] += safe_float(
            q.get(
                "pageviews_weighted"
            )
        )

    prelim = []

    for item in grouped.values():
        m = metrics_from_values(
            item[
                "impressions"
            ],
            item[
                "clicks"
            ],
            item[
                "cost"
            ],
            (
                item[
                    "order_conversions"
                ]
                + item[
                    "webinar_conversions"
                ]
                + item[
                    "survey_conversions"
                ]
            ),
            item[
                "order_conversions"
            ],
            item[
                "webinar_conversions"
            ],
            item[
                "survey_conversions"
            ],
        )

        bounce_rate = (
            item[
                "bounces"
            ]
            / item[
                "sessions"
            ]
            * 100
            if item[
                "sessions"
            ]
            else 0
        )

        avg_pageviews = (
            item[
                "pageviews_weighted"
            ]
            / item[
                "sessions"
            ]
            if item[
                "sessions"
            ]
            else 0
        )

        prelim.append({
            **m,
            "placement": (
                item[
                    "placement"
                ]
            ),
            "external_network": (
                item[
                    "external_network"
                ]
            ),
            "devices": sorted(
                item[
                    "devices"
                ]
            ),
            "sessions": (
                item[
                    "sessions"
                ]
            ),
            "bounces": (
                item[
                    "bounces"
                ]
            ),
            "bounce_rate": round(
                bounce_rate,
                2,
            ),
            "avg_pageviews": round(
                avg_pageviews,
                2,
            ),
        })

    order_cpas = sorted(
        x[
            "order_cpa"
        ]
        for x in prelim
        if (
            x[
                "order_conversions"
            ] >= 2
            and x[
                "order_cpa"
            ] > 0
        )
    )

    baseline_order_cpa = (
        median(
            order_cpas
        )
        if order_cpas
        else 0
    )

    for item in prelim:
        if (
            item[
                "conversions"
            ] == 0
            and item[
                "clicks"
            ] >= 10
            and item[
                "cost"
            ] >= 1000
        ):
            item[
                "status"
            ] = "waste"

        elif (
            item[
                "sessions"
            ] >= 10
            and item[
                "bounce_rate"
            ] >= 80
            and item[
                "conversions"
            ] == 0
        ):
            item[
                "status"
            ] = "bad_traffic"

        elif (
            baseline_order_cpa > 0
            and item[
                "order_conversions"
            ] >= 3
            and item[
                "order_cpa"
            ]
            <= baseline_order_cpa
            * 0.8
        ):
            item[
                "status"
            ] = "strong"

        else:
            item[
                "status"
            ] = "normal"

    prelim.sort(
        key=lambda x: (
            -x[
                "cost"
            ],
            -x[
                "clicks"
            ],
        )
    )

    waste_rows = [
        x
        for x in prelim
        if x[
            "status"
        ]
        in (
            "waste",
            "bad_traffic",
        )
    ]

    return {
        "rows": prelim[:1000],
        "summary": {
            "placements": len(
                prelim
            ),
            "goal_columns_found": len(
                goal_column_names
            ),
            "goal_data_available": (
                len(
                    goal_column_names
                )
                > 0
            ),
            "baseline_order_cpa": round(
                baseline_order_cpa,
                2,
            ),
            "waste_candidates": len(
                waste_rows
            ),
            "waste_candidate_spend": round(
                sum(
                    x[
                        "cost"
                    ]
                    for x in waste_rows
                ),
                2,
            ),
            "strong_placements": sum(
                1
                for x in prelim
                if x[
                    "status"
                ]
                == "strong"
            ),
            "order_conversions": round(
                sum(
                    x[
                        "order_conversions"
                    ]
                    for x in prelim
                ),
                2,
            ),
            "webinar_conversions": round(
                sum(
                    x[
                        "webinar_conversions"
                    ]
                    for x in prelim
                ),
                2,
            ),
            "survey_conversions": round(
                sum(
                    x[
                        "survey_conversions"
                    ]
                    for x in prelim
                ),
                2,
            ),
        },
    }

# ------------------------------------------------------------
# GEO INTELLIGENCE
# ------------------------------------------------------------

def build_geo_intelligence():
    fields = [
        "TargetingLocationName",
        "LocationOfPresenceName",
        "Impressions",
        "Clicks",
        "Cost",
        "Conversions",
    ]

    text = request_advanced_report(
        "MR Geo goals v8",
        "CUSTOM_REPORT",
        fields,
        order_by=[
            {
                "Field": "Cost",
                "SortOrder": "DESCENDING",
            }
        ],
    )

    rows = parse_header_tsv(
        text
    )

    pairs = []
    presence = {}

    for row in rows:
        target = str(
            row.get(
                "TargetingLocationName"
            )
            or "—"
        ).strip()

        actual = str(
            row.get(
                "LocationOfPresenceName"
            )
            or "—"
        ).strip()

        m = metrics_from_report_row(
            row
        )

        pairs.append({
            "targeting_location": target,
            "presence_location": actual,
            "differs_from_target": (
                normalize_text(target)
                != normalize_text(actual)
                and target
                not in (
                    "",
                    "—",
                    "-",
                    "--",
                )
                and actual
                not in (
                    "",
                    "—",
                    "-",
                    "--",
                )
            ),
            **m,
        })

        if actual not in presence:
            presence[actual] = {
                "location": actual,
                "impressions": 0,
                "clicks": 0,
                "cost": 0.0,
                "order_conversions": 0.0,
                "webinar_conversions": 0.0,
                "survey_conversions": 0.0,
            }

        p = presence[actual]
        p["impressions"] += m["impressions"]
        p["clicks"] += m["clicks"]
        p["cost"] += m["cost"]

        for field in (
            "order_conversions",
            "webinar_conversions",
            "survey_conversions",
        ):
            p[field] += m[field]

    presence_rows = []

    for p in presence.values():
        presence_rows.append({
            "location": p["location"],
            **metrics_from_values(
                p["impressions"],
                p["clicks"],
                p["cost"],
                (
                    p["order_conversions"]
                    + p["webinar_conversions"]
                    + p["survey_conversions"]
                ),
                p["order_conversions"],
                p["webinar_conversions"],
                p["survey_conversions"],
            ),
        })

    presence_rows.sort(
        key=lambda x:
            -x["cost"]
    )
    pairs.sort(
        key=lambda x:
            -x["cost"]
    )

    total_cost = sum(
        x["cost"]
        for x in pairs
    )
    differing_cost = sum(
        x["cost"]
        for x in pairs
        if x["differs_from_target"]
    )

    return {
        "locations": presence_rows[:500],
        "target_presence_pairs": pairs[:1000],
        "summary": {
            "actual_locations": len(
                presence_rows
            ),
            "different_target_pairs": sum(
                1
                for x in pairs
                if x["differs_from_target"]
            ),
            "different_target_spend": round(
                differing_cost,
                2,
            ),
            "different_target_share": round(
                differing_cost
                / total_cost
                * 100,
                2,
            ) if total_cost else 0,
            "order_conversions": round(
                sum(
                    x["order_conversions"]
                    for x in pairs
                ),
                2,
            ),
            "webinar_conversions": round(
                sum(
                    x["webinar_conversions"]
                    for x in pairs
                ),
                2,
            ),
            "survey_conversions": round(
                sum(
                    x["survey_conversions"]
                    for x in pairs
                ),
                2,
            ),
        },
    }

# ------------------------------------------------------------
# AUDIENCE INTELLIGENCE
# ------------------------------------------------------------

def build_audience_intelligence():
    fields = [
        "Age",
        "Gender",
        "IncomeGrade",
        "Device",
        "Impressions",
        "Clicks",
        "Cost",
        "Conversions",
    ]

    text = request_advanced_report(
        "MR Audience goals v8",
        "CUSTOM_REPORT",
        fields,
        order_by=[
            {
                "Field": "Cost",
                "SortOrder": "DESCENDING",
            }
        ],
    )

    rows = parse_header_tsv(
        text
    )

    items = []
    total_cost = 0.0
    total_clicks = 0
    total_orders = 0.0
    total_webinars = 0.0
    total_surveys = 0.0

    for row in rows:
        m = metrics_from_report_row(
            row
        )

        total_cost += m["cost"]
        total_clicks += m["clicks"]
        total_orders += m[
            "order_conversions"
        ]
        total_webinars += m[
            "webinar_conversions"
        ]
        total_surveys += m[
            "survey_conversions"
        ]

        items.append({
            "age": row.get("Age")
            or "UNKNOWN",
            "gender": row.get("Gender")
            or "UNKNOWN",
            "income_grade": row.get(
                "IncomeGrade"
            )
            or "UNKNOWN",
            "device": row.get("Device")
            or "UNKNOWN",
            **m,
        })

    # Основная бизнес-оценка аудитории — Order.
    account_order_cpa = (
        total_cost
        / total_orders
        if total_orders
        else 0
    )

    account_cpc = (
        total_cost
        / total_clicks
        if total_clicks
        else 0
    )

    for item in items:
        if (
            account_order_cpa > 0
            and item["order_conversions"] >= 3
            and item["order_cpa"]
            <= account_order_cpa * 0.75
        ):
            item["status"] = "opportunity"
            item["recommendation"] = (
                "Order CPA заметно ниже среднего: "
                "кандидат на повышающую корректировку "
                "после ручной проверки."
            )

        elif (
            item["clicks"] >= 10
            and (
                item["order_conversions"] == 0
                or (
                    account_order_cpa > 0
                    and item["order_cpa"] > 0
                    and item["order_cpa"]
                    >= account_order_cpa * 1.5
                )
            )
        ):
            item["status"] = "expensive"
            item["recommendation"] = (
                "Order-эффективность слабая: "
                "кандидат на понижающую корректировку "
                "после ручной проверки."
            )

        else:
            item["status"] = "normal"
            item["recommendation"] = (
                "Без явного сигнала."
            )

    items.sort(
        key=lambda x: (
            -x["cost"],
            -x["order_conversions"],
        )
    )

    return {
        "rows": items[:1000],
        "summary": {
            "segments": len(items),
            "account_order_cpa": round(
                account_order_cpa,
                2,
            ),
            "account_cpc": round(
                account_cpc,
                2,
            ),
            "opportunities": sum(
                1
                for x in items
                if x["status"]
                == "opportunity"
            ),
            "expensive_segments": sum(
                1
                for x in items
                if x["status"]
                == "expensive"
            ),
            "order_conversions": round(
                total_orders,
                2,
            ),
            "webinar_conversions": round(
                total_webinars,
                2,
            ),
            "survey_conversions": round(
                total_surveys,
                2,
            ),
        },
    }

# ------------------------------------------------------------
# SEARCH POSITION ECONOMICS
# ------------------------------------------------------------

def build_position_intelligence():
    fields = [
        "CampaignId",
        "CampaignName",
        "Slot",
        "Impressions",
        "Clicks",
        "Cost",
        "Conversions",
        "AvgImpressionPosition",
        "AvgClickPosition",
        "AvgTrafficVolume",
        "AvgEffectiveBid",
        "WeightedImpressions",
        "WeightedCtr",
    ]

    text = request_advanced_report(
        "MR Position goals v8",
        "CUSTOM_REPORT",
        fields,
        filters=[{
            "Field": "AdNetworkType",
            "Operator": "EQUALS",
            "Values": ["SEARCH"],
        }],
        order_by=[
            {
                "Field": "Cost",
                "SortOrder": "DESCENDING",
            }
        ],
    )

    rows = parse_header_tsv(
        text
    )

    items = []

    for row in rows:
        m = metrics_from_report_row(
            row
        )

        items.append({
            "campaign_id": str(
                row.get("CampaignId")
                or ""
            ),
            "campaign_name": (
                row.get("CampaignName")
                or ""
            ),
            "slot": (
                row.get("Slot")
                or "OTHER"
            ),
            "avg_impression_position": round(
                safe_float(
                    row.get(
                        "AvgImpressionPosition"
                    )
                ),
                2,
            ),
            "avg_click_position": round(
                safe_float(
                    row.get(
                        "AvgClickPosition"
                    )
                ),
                2,
            ),
            "avg_traffic_volume": round(
                safe_float(
                    row.get(
                        "AvgTrafficVolume"
                    )
                ),
                2,
            ),
            "avg_effective_bid": round(
                safe_float(
                    row.get(
                        "AvgEffectiveBid"
                    )
                ),
                2,
            ),
            "weighted_impressions": round(
                safe_float(
                    row.get(
                        "WeightedImpressions"
                    )
                ),
                2,
            ),
            "weighted_ctr": round(
                safe_float(
                    row.get(
                        "WeightedCtr"
                    )
                ),
                3,
            ),
            **m,
        })

    items.sort(
        key=lambda x:
            -x["cost"]
    )

    total_cost = sum(
        x["cost"]
        for x in items
    )

    high_traffic_cost = sum(
        x["cost"]
        for x in items
        if x["avg_traffic_volume"] >= 80
    )

    return {
        "rows": items[:1000],
        "summary": {
            "rows": len(items),
            "high_traffic_volume_spend": round(
                high_traffic_cost,
                2,
            ),
            "high_traffic_volume_share": round(
                high_traffic_cost
                / total_cost
                * 100,
                2,
            ) if total_cost else 0,
            "order_conversions": round(
                sum(
                    x["order_conversions"]
                    for x in items
                ),
                2,
            ),
            "webinar_conversions": round(
                sum(
                    x["webinar_conversions"]
                    for x in items
                ),
                2,
            ),
            "survey_conversions": round(
                sum(
                    x["survey_conversions"]
                    for x in items
                ),
                2,
            ),
        },
    }

# ------------------------------------------------------------
# ATTRIBUTION LAB
# ------------------------------------------------------------

def attribution_model_report(model):
    fields = [
        "CampaignId",
        "CampaignName",
        "Clicks",
        "Cost",
        "Conversions",
        "CostPerConversion",
        "ConversionRate",
        "Revenue",
        "GoalsRoi",
    ]

    text = request_advanced_report(
        f"MR Attribution {model} v7",
        "CAMPAIGN_PERFORMANCE_REPORT",
        fields,
        attribution_models=[model],
        order_by=[{"Field": "Cost", "SortOrder": "DESCENDING"}],
    )

    output = {}
    for row in parse_header_tsv(text):
        cid = str(row.get("CampaignId") or "")
        if not cid:
            continue
        output[cid] = {
            "campaign_id": cid,
            "campaign_name": row.get("CampaignName") or "",
            "clicks": safe_int(row.get("Clicks")),
            "cost": round(safe_float(row.get("Cost")), 2),
            "conversions": round(safe_float(row.get("Conversions")), 2),
            "cpa": round(safe_float(row.get("CostPerConversion")), 2),
            "cr": round(safe_float(row.get("ConversionRate")), 3),
            "revenue": round(safe_float(row.get("Revenue")), 2),
            "goals_roi": round(safe_float(row.get("GoalsRoi")), 3),
        }
    return output


def build_attribution_intelligence():
    models = ["LC", "FCCD", "LSCCD", "AUTO"]
    by_model = {}

    for model in models:
        by_model[model] = optional_module(
            f"Attribution {model}",
            lambda m=model: attribution_model_report(m),
            {},
        )

    campaign_ids = set()
    for data in by_model.values():
        campaign_ids.update(data.keys())

    output = []

    for cid in campaign_ids:
        model_data = {
            model: by_model.get(model, {}).get(cid)
            for model in models
            if by_model.get(model, {}).get(cid)
        }
        conversions = [
            x["conversions"]
            for x in model_data.values()
            if x is not None
        ]
        max_conv = max(conversions) if conversions else 0
        min_conv = min(conversions) if conversions else 0
        stability = (
            min_conv / max_conv * 100
            if max_conv > 0 else 100
        )

        lc = model_data.get("LC", {}).get("conversions", 0) if model_data.get("LC") else 0
        fccd = model_data.get("FCCD", {}).get("conversions", 0) if model_data.get("FCCD") else 0

        if lc > 0 and fccd >= lc * 1.3:
            interpretation = "assist"
        elif max_conv > 0 and stability < 70:
            interpretation = "model_sensitive"
        else:
            interpretation = "stable"

        campaign_name = next(
            (
                x["campaign_name"]
                for x in model_data.values()
                if x and x.get("campaign_name")
            ),
            "",
        )

        output.append({
            "campaign_id": cid,
            "campaign_name": campaign_name,
            "models": model_data,
            "stability_score": round(stability, 1),
            "interpretation": interpretation,
        })

    output.sort(
        key=lambda x: (
            x["stability_score"],
            -max(
                [m.get("conversions", 0) for m in x["models"].values()] or [0]
            ),
        )
    )

    return {
        "rows": output,
        "summary": {
            "campaigns": len(output),
            "model_sensitive": sum(1 for x in output if x["interpretation"] == "model_sensitive"),
            "assist_campaigns": sum(1 for x in output if x["interpretation"] == "assist"),
            "stable_campaigns": sum(1 for x in output if x["interpretation"] == "stable"),
        },
    }


# ------------------------------------------------------------
# GOAL INTELLIGENCE
# ------------------------------------------------------------

def build_goal_intelligence(goal_ids):
    goal_ids = [str(x) for x in goal_ids if str(x).strip()][:10]
    if not goal_ids:
        return {
            "rows": [],
            "summary": {
                "goals": 0,
                "message": "В настройках кампаний не найдены priority goals.",
            },
        }

    fields = [
        "CampaignId",
        "CampaignName",
        "Clicks",
        "Cost",
        "Conversions",
        "CostPerConversion",
        "ConversionRate",
        "Revenue",
        "GoalsRoi",
    ]

    text = request_advanced_report(
        "MR Goals v7",
        "CAMPAIGN_PERFORMANCE_REPORT",
        fields,
        goals=goal_ids,
        attribution_models=["LC"],
        order_by=[{"Field": "Cost", "SortOrder": "DESCENDING"}],
    )

    report_rows = parse_header_tsv(text)
    goal_map = {
        goal: {
            "goal_id": goal,
            "conversions": 0.0,
            "revenue": 0.0,
            "cost_attributed": 0.0,
            "campaigns": set(),
        }
        for goal in goal_ids
    }

    total_account_cost = 0.0
    for row in report_rows:
        total_account_cost += safe_float(row.get("Cost"))
        campaign_name = str(row.get("CampaignName") or "").strip()
        for goal in goal_ids:
            conv = safe_float(row.get(f"Conversions_{goal}_LC"))
            revenue = safe_float(row.get(f"Revenue_{goal}_LC"))
            if conv > 0 and campaign_name:
                goal_map[goal]["campaigns"].add(campaign_name)
            goal_map[goal]["conversions"] += conv
            goal_map[goal]["revenue"] += revenue

    output = []
    for goal, item in goal_map.items():
        conversions = item["conversions"]
        revenue = item["revenue"]
        output.append({
            "goal_id": goal,
            "name": f"Цель {goal}",
            "conversions": round(conversions, 2),
            "revenue": round(revenue, 2),
            "campaigns": sorted(item["campaigns"]),
            "campaign_count": len(item["campaigns"]),
        })

    output.sort(key=lambda x: -x["conversions"])

    return {
        "rows": output,
        "summary": {
            "goals": len(output),
            "goals_with_conversions": sum(1 for x in output if x["conversions"] > 0),
            "total_goal_conversions": round(sum(x["conversions"] for x in output), 2),
            "total_goal_revenue": round(sum(x["revenue"] for x in output), 2),
        },
    }


# ------------------------------------------------------------
# DISPLAY REACH / FREQUENCY / VIDEO
# ------------------------------------------------------------

def build_media_intelligence(display_campaign_ids):
    ids = [str(x) for x in display_campaign_ids if str(x).strip()]
    if not ids:
        return {
            "rows": [],
            "summary": {
                "display_campaigns": 0,
                "message": "Медийные кампании не найдены.",
            },
        }

    fields = [
        "CampaignId",
        "CampaignName",
        "Impressions",
        "Clicks",
        "Cost",
        "AvgCpm",
        "AvgImpressionFrequency",
        "ImpressionReach",
        "VideoViews",
        "VideoViewsRate",
        "VideoFirstQuartile",
        "VideoFirstQuartileRate",
        "VideoMidpoint",
        "VideoMidpointRate",
        "VideoThirdQuartile",
        "VideoThirdQuartileRate",
        "VideoComplete",
        "VideoCompleteRate",
        "AvgVideoCompleteCost",
    ]

    text = request_advanced_report(
        "MR Media v7",
        "REACH_AND_FREQUENCY_PERFORMANCE_REPORT",
        fields,
        filters=[{
            "Field": "CampaignId",
            "Operator": "IN",
            "Values": ids,
        }],
        order_by=[{"Field": "CampaignId", "SortOrder": "ASCENDING"}],
    )

    rows = []
    for row in parse_header_tsv(text):
        rows.append({
            "campaign_id": str(row.get("CampaignId") or ""),
            "campaign_name": row.get("CampaignName") or "",
            "impressions": safe_int(row.get("Impressions")),
            "clicks": safe_int(row.get("Clicks")),
            "cost": round(safe_float(row.get("Cost")), 2),
            "avg_cpm": round(safe_float(row.get("AvgCpm")), 2),
            "avg_frequency": round(safe_float(row.get("AvgImpressionFrequency")), 2),
            "reach": safe_int(row.get("ImpressionReach")),
            "video_views": safe_int(row.get("VideoViews")),
            "video_views_rate": round(safe_float(row.get("VideoViewsRate")), 2),
            "video_25_rate": round(safe_float(row.get("VideoFirstQuartileRate")), 2),
            "video_50_rate": round(safe_float(row.get("VideoMidpointRate")), 2),
            "video_75_rate": round(safe_float(row.get("VideoThirdQuartileRate")), 2),
            "video_100_rate": round(safe_float(row.get("VideoCompleteRate")), 2),
            "avg_complete_cost": round(safe_float(row.get("AvgVideoCompleteCost")), 2),
        })

    rows.sort(key=lambda x: -x["cost"])

    return {
        "rows": rows,
        "summary": {
            "display_campaigns": len(rows),
            "high_frequency_campaigns": sum(1 for x in rows if x["avg_frequency"] >= 5),
            "video_campaign_rows": sum(1 for x in rows if x["video_views"] > 0),
        },
    }


# ------------------------------------------------------------
# RETARGETING HEALTH
# ------------------------------------------------------------

def build_retargeting_health():
    payload = {
        "method": "get",
        "params": {
            "SelectionCriteria": {},
            "FieldNames": [
                "Type",
                "Id",
                "Name",
                "Description",
                "Rules",
                "IsAvailable",
                "Scope",
                "AvailableForTargetsInAdGroupTypes",
            ],
            "Page": {
                "Limit": 10000,
                "Offset": 0,
            },
        },
    }

    result = direct_api(
        RETARGETINGLISTS_URL,
        payload,
        "RetargetingLists.get",
    )

    rows = []
    for item in result.get("RetargetingLists", []):
        rules = item.get("Rules") or []
        goal_ids = set()
        spans = []
        for rule in rules:
            for arg in rule.get("Arguments") or []:
                ext = str(arg.get("ExternalId") or "").strip()
                if ext:
                    goal_ids.add(ext)
                span = safe_int(arg.get("MembershipLifeSpan"))
                if span > 0:
                    spans.append(span)

        rows.append({
            "id": str(item.get("Id") or ""),
            "name": item.get("Name") or "",
            "type": item.get("Type") or "",
            "is_available": item.get("IsAvailable") or "NO",
            "scope": item.get("Scope") or "",
            "rule_count": len(rules),
            "goal_segment_count": len(goal_ids),
            "max_membership_days": max(spans) if spans else 0,
            "status": "healthy" if item.get("IsAvailable") == "YES" else "broken",
        })

    rows.sort(
        key=lambda x: (
            0 if x["status"] == "broken" else 1,
            x["name"].lower(),
        )
    )

    return {
        "rows": rows,
        "summary": {
            "lists": len(rows),
            "unavailable": sum(1 for x in rows if x["status"] == "broken"),
            "available": sum(1 for x in rows if x["status"] == "healthy"),
            "long_windows": sum(1 for x in rows if x["max_membership_days"] >= 365),
        },
    }



# ============================================================
# CAMPAIGNS
# ============================================================

def aggregate_campaigns(rows):
    campaigns = {}

    for row in rows:
        cid = row[
            "campaign_id"
        ]

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
                "order_conversions": 0.0,
                "webinar_conversions": 0.0,
                "survey_conversions": 0.0,
            }

        item = campaigns[cid]

        item["impressions"] += row[
            "impressions"
        ]
        item["clicks"] += row[
            "clicks"
        ]
        item["spend"] += row[
            "cost"
        ]

        for field in (
            "order_conversions",
            "webinar_conversions",
            "survey_conversions",
        ):
            item[field] += row.get(
                field,
                0
            )

    result = []

    for item in campaigns.values():
        conversions = (
            item["order_conversions"]
            + item["webinar_conversions"]
            + item["survey_conversions"]
        )

        result.append({
            **item,
            "spend": round(
                item["spend"],
                2,
            ),
            "ctr": round(
                item["clicks"]
                / item["impressions"]
                * 100,
                3,
            ) if item["impressions"] else 0,
            "avg_cpc": round(
                item["spend"]
                / item["clicks"],
                2,
            ) if item["clicks"] else 0,
            **conversion_metrics(
                item["spend"],
                item["clicks"],
                item,
            ),
        })

    result.sort(
        key=lambda item:
            item["spend"],
        reverse=True,
    )

    return result


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

    order_conversions = sum(
        c.get(
            "order_conversions",
            0
        )
        for c in campaigns
    )

    webinar_conversions = sum(
        c.get(
            "webinar_conversions",
            0
        )
        for c in campaigns
    )

    survey_conversions = sum(
        c.get(
            "survey_conversions",
            0
        )
        for c in campaigns
    )

    result = {
        "spend": round(
            spend,
            2,
        ),
        "impressions": impressions,
        "clicks": clicks,
        "ctr": round(
            clicks
            / impressions
            * 100,
            3,
        ) if impressions else 0,
        "avg_cpc": round(
            spend
            / clicks,
            2,
        ) if clicks else 0,
        "campaigns": len(
            campaigns
        ),
    }

    result.update(
        conversion_metrics(
            spend,
            clicks,
            {
                "order_conversions": order_conversions,
                "webinar_conversions": webinar_conversions,
                "survey_conversions": survey_conversions,
            },
        )
    )

    return result

def creative_summary(
    creatives
):
    counts = defaultdict(int)

    exact = 0
    proxy = 0
    unattributable = 0

    for creative in creatives:
        counts[
            creative["status"]
        ] += 1

        attribution = creative.get(
            "attribution"
        )

        if attribution == "exact":
            exact += 1

        elif attribution == "proxy":
            proxy += 1

        else:
            unattributable += 1

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

        "no_peers": counts[
            "no_peers"
        ],

        "unattributable": counts[
            "unattributable"
        ],

        "exact_attribution": exact,

        "proxy_attribution": proxy,

        "unattributable_assets": (
            unattributable
        ),
    }


# ============================================================
# BUILD REPORT
# ============================================================

def build_report():
    print(
        "======================================",
        flush=True,
    )
    print(
        "MARKETING RADAR v9",
        flush=True,
    )
    print(
        "======================================",
        flush=True,
    )

    print(
        "\n1/15 Campaign report + goal breakdown",
        flush=True,
    )
    campaign_rows = (
        get_campaign_rows()
    )

    campaign_ids = sorted({
        row[
            "campaign_id"
        ]
        for row in campaign_rows
        if str(
            row.get(
                "campaign_id"
            )
            or ""
        ).strip()
    })

    print(
        "\n2/15 Campaign configuration",
        flush=True,
    )
    campaign_configuration = (
        optional_module(
            "Campaign configuration",
            get_campaign_configuration,
            {
                "campaigns": [],
                "goal_ids": [],
                "display_campaign_ids": [],
                "summary": {},
            },
        )
    )

    print(
        "\n3/15 Portfolio strategy configuration",
        flush=True,
    )
    strategy_configuration = (
        optional_module(
            "Portfolio strategies",
            get_strategy_configuration,
            {
                "rows": [],
                "goal_ids": [],
                "summary": {},
            },
        )
    )

    print(
        "\n4/15 Keyword report + goal breakdown",
        flush=True,
    )
    keyword_rows = (
        get_keyword_rows()
    )

    print(
        "\n5/15 Keyword status/state",
        flush=True,
    )
    keyword_configuration = (
        optional_module(
            "Keyword configuration",
            lambda: get_keyword_configuration(
                campaign_ids
            ),
            {
                "rows": [],
                "by_id": {},
                "summary": {},
            },
        )
    )

    keyword_rows = (
        enrich_keywords_with_configuration(
            keyword_rows,
            keyword_configuration,
        )
    )

    keyword_summary = (
        summarize_keywords(
            keyword_rows
        )
    )

    keyword_summary[
        "status_summary"
    ] = (
        keyword_configuration.get(
            "summary",
            {}
        )
    )

    print(
        "\n6/15 Search Query Intelligence",
        flush=True,
    )
    search_queries = optional_module(
        "Search Query Intelligence",
        lambda: build_search_query_intelligence(
            keyword_rows
        ),
        {
            "rows": [],
            "summary": {
                "queries": 0
            },
        },
    )

    print(
        "\n7/15 Negative keyword audit",
        flush=True,
    )
    negative_keywords = (
        build_negative_keyword_audit(
            campaign_configuration,
            search_queries,
        )
    )

    print(
        "\n8/15 Priority Goals Intelligence",
        flush=True,
    )
    priority_goals = (
        build_priority_goals_intelligence(
            campaign_configuration,
            strategy_configuration,
        )
    )

    print(
        "\n9/15 Placement Intelligence",
        flush=True,
    )
    placements = optional_module(
        "Placement Intelligence",
        build_placement_intelligence,
        {
            "rows": [],
            "summary": {
                "placements": 0
            },
        },
    )

    print(
        "\n10/15 Geo Intelligence",
        flush=True,
    )
    geo = optional_module(
        "Geo Intelligence",
        build_geo_intelligence,
        {
            "locations": [],
            "target_presence_pairs": [],
            "summary": {
                "actual_locations": 0
            },
        },
    )

    print(
        "\n11/15 Audience Intelligence",
        flush=True,
    )
    audience = optional_module(
        "Audience Intelligence",
        build_audience_intelligence,
        {
            "rows": [],
            "summary": {
                "segments": 0
            },
        },
    )

    print(
        "\n12/15 Search Position Economics",
        flush=True,
    )
    positions = optional_module(
        "Search Position Economics",
        build_position_intelligence,
        {
            "rows": [],
            "summary": {
                "rows": 0
            },
        },
    )

    print(
        "\n13/15 Ad performance + goal breakdown",
        flush=True,
    )
    ad_rows = get_ad_rows()

    ad_ids = sorted({
        row[
            "ad_id"
        ]
        for row in ad_rows
    })

    print(
        "Unique ads:",
        len(
            ad_ids
        ),
        flush=True,
    )

    print(
        "\n14/15 Creative metadata + attribution",
        flush=True,
    )
    ads = get_ads(
        ad_ids
    )

    ad_asset_map = {}
    registry = {}

    for ad_id, ad in ads.items():
        assets = (
            extract_ad_assets(
                ad
            )
        )

        ad_asset_map[
            ad_id
        ] = assets

        for asset in assets:
            registry[
                asset[
                    "asset_key"
                ]
            ] = asset

    image_hashes = [
        asset[
            "asset_id"
        ]
        for asset in registry.values()
        if asset[
            "asset_key"
        ].startswith(
            "image:"
        )
    ]

    creative_ids = [
        asset[
            "asset_id"
        ]
        for asset in registry.values()
        if asset[
            "asset_key"
        ].startswith(
            "creative:"
        )
    ]

    image_metadata = (
        get_image_metadata(
            image_hashes
        )
        if image_hashes
        else {}
    )

    creative_metadata = (
        get_creative_metadata(
            creative_ids
        )
        if creative_ids
        else {}
    )

    performances = (
        build_asset_performance(
            ad_rows,
            ad_asset_map,
        )
    )

    enrich_metadata(
        performances,
        registry,
        image_metadata,
        creative_metadata,
    )

    creatives = analyze_assets(
        performances
    )

    print(
        "\n15/15 Final summary",
        flush=True,
    )

    campaigns = aggregate_campaigns(
        campaign_rows
    )

    summary = calculate_summary(
        campaigns
    )

    c_summary = creative_summary(
        creatives
    )

    advanced_summary = {
        "search_queries": (
            search_queries.get(
                "summary",
                {}
            )
        ),
        "placements": (
            placements.get(
                "summary",
                {}
            )
        ),
        "geo": (
            geo.get(
                "summary",
                {}
            )
        ),
        "audience": (
            audience.get(
                "summary",
                {}
            )
        ),
        "positions": (
            positions.get(
                "summary",
                {}
            )
        ),
        "priority_goals": (
            priority_goals.get(
                "summary",
                {}
            )
        ),
        "negative_keywords": (
            negative_keywords.get(
                "summary",
                {}
            )
        ),
    }

    return {
        "meta": {
            "updated_at": datetime.now(
                timezone.utc
            ).isoformat(),
            "source": "yandex_direct",
            "period_days": REPORT_DAYS,
            "report_version": 9,
            "conversion_attribution_model": (
                CONVERSION_ATTRIBUTION_MODEL
            ),
            "conversion_categories": {
                "order": ORDER_GOALS,
                "webinar": WEBINAR_GOALS,
                "survey": SURVEY_GOALS,
            },
            "webinar_goal_note": (
                "ID целей вебинаров/митапов пока не настроены; "
                "поле выводится со значением 0."
            ),
            "creative_method": (
                "exact_proxy_shared_context_v9"
            ),
            "creative_shared_proxy_note": (
                "shared_proxy присваивает статистику responsive-объявления "
                "каждому присутствующему визуалу. Это контекстная оценка, "
                "а не доказанная индивидуальная атрибуция."
            ),
            "keyword_method": (
                "CRITERIA_PERFORMANCE_REPORT + Keywords.get"
            ),
            "score_model": (
                "CTR_60_CPC_40"
            ),
            "min_clicks": (
                MIN_CLICKS_FOR_SCORE
            ),
            "advanced_modules": [
                "search_queries",
                "placements",
                "geo",
                "audience",
                "positions",
                "priority_goals",
                "negative_keywords",
            ],
        },

        "summary": summary,
        "campaigns": campaigns,
        "daily": campaign_rows,

        "creative_summary": (
            c_summary
        ),
        "creatives": creatives,

        "keywords": keyword_rows,
        "keyword_summary": (
            keyword_summary
        ),
        "keyword_configuration": (
            keyword_configuration
        ),
        "negative_keywords": (
            negative_keywords
        ),

        "search_queries": (
            search_queries
        ),
        "placements": (
            placements
        ),
        "geo": geo,
        "audience": audience,
        "positions": positions,

        "priority_goals": (
            priority_goals
        ),

        "advanced_summary": (
            advanced_summary
        ),
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
        password.encode(
            "utf-8"
        ),
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

    aes = AESGCM(key)

    ciphertext = aes.encrypt(
        nonce,
        plaintext,
        None,
    )

    return {
        "version": 7,

        "kdf": (
            "PBKDF2-SHA256"
        ),

        "iterations": (
            PBKDF2_ITERATIONS
        ),

        "cipher": (
            "AES-256-GCM"
        ),

        "salt": (
            base64.b64encode(
                salt
            ).decode("ascii")
        ),

        "nonce": (
            base64.b64encode(
                nonce
            ).decode("ascii")
        ),

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
        "\n======================================",
        flush=True,
    )

    print(
        "DONE",
        flush=True,
    )

    print(
        "Encrypted report saved:",
        OUT,
        flush=True,
    )

    print(
        "======================================",
        flush=True,
    )


if __name__ == "__main__":
    main()
