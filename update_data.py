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

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data" / "report.enc"

REPORT_DAYS = 60
TREND_DAYS = 7

MIN_CLICKS_FOR_SCORE = 15
MIN_CLICKS_FOR_BASELINE = 5
MIN_CLICKS_FOR_TREND = 5

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

    report_name = make_report_name(
        prefix,
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
    ]

    text = request_report(
        "MR Campaign v5",
        "CAMPAIGN_PERFORMANCE_REPORT",
        fields,
    )

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
    ]

    text = request_report(
        "MR Creative Performance v5",
        "AD_PERFORMANCE_REPORT",
        fields,
    )

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

    ad_images = safe_block(
        "AdImages"
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


    video_extensions = safe_block(
        "VideoExtensions"
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

        "ad_ids": set(),

        "ad_group_ids": set(),

        "daily": [],

        "exact_impressions": 0,

        "exact_clicks": 0,

        "exact_spend": 0.0,

        "proxy_impressions": 0,

        "proxy_clicks": 0,

        "proxy_spend": 0.0,

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

            # Несколько картинок/видео —
            # статистику не делим.
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

                item[
                    "unattributed_impressions"
                ] += row[
                    "impressions"
                ]

                item[
                    "unattributed_clicks"
                ] += row[
                    "clicks"
                ]

                item[
                    "unattributed_spend"
                ] += row[
                    "cost"
                ]

                item[
                    "unattributed_ad_ids"
                ].add(
                    row["ad_id"]
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
            }

        item = campaigns[cid]

        item[
            "impressions"
        ] += row["impressions"]

        item[
            "clicks"
        ] += row["clicks"]

        item[
            "spend"
        ] += row["cost"]

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
            if impressions > 0
            else 0
        )

        cpc = (
            spend / clicks
            if clicks > 0
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
                3
            ),

            "avg_cpc": round(
                cpc,
                2
            ),
        })

    result.sort(
        key=lambda x: x[
            "spend"
        ],
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

    return {
        "spend": round(
            spend,
            2
        ),

        "impressions": impressions,

        "clicks": clicks,

        "ctr": round(
            ctr,
            3
        ),

        "avg_cpc": round(
            avg_cpc,
            2
        ),
    }


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
        "MARKETING RADAR CREATIVE v5",
        flush=True,
    )

    print(
        "======================================",
        flush=True,
    )

    # --------------------------------------------------------
    # 1
    # --------------------------------------------------------

    print(
        "\n1/6 Campaign report",
        flush=True,
    )

    campaign_rows = (
        get_campaign_rows()
    )

    # --------------------------------------------------------
    # 2
    # --------------------------------------------------------

    print(
        "\n2/6 Ad performance report",
        flush=True,
    )

    ad_rows = get_ad_rows()

    ad_ids = sorted({
        row["ad_id"]
        for row in ad_rows
    })

    print(
        "Unique ads:",
        len(ad_ids),
        flush=True,
    )

    # --------------------------------------------------------
    # 3
    # --------------------------------------------------------

    print(
        "\n3/6 Ads.get",
        flush=True,
    )

    ads = get_ads(
        ad_ids
    )

    ad_asset_map = {}

    registry = {}

    for ad_id, ad in ads.items():
        assets = (
            extract_ad_assets(ad)
        )

        ad_asset_map[
            ad_id
        ] = assets

        for asset in assets:
            registry[
                asset["asset_key"]
            ] = asset

    print(
        "Unique visual assets:",
        len(registry),
        flush=True,
    )

    image_hashes = [
        asset["asset_id"]
        for asset in registry.values()
        if asset["asset_key"].startswith(
            "image:"
        )
    ]

    creative_ids = [
        asset["asset_id"]
        for asset in registry.values()
        if asset["asset_key"].startswith(
            "creative:"
        )
    ]

    print(
        "Image hashes:",
        len(image_hashes),
        flush=True,
    )

    print(
        "Creative IDs:",
        len(creative_ids),
        flush=True,
    )

    # --------------------------------------------------------
    # 4
    # --------------------------------------------------------

    print(
        "\n4/6 AdImages.get",
        flush=True,
    )

    if image_hashes:
        image_metadata = (
            get_image_metadata(
                image_hashes
            )
        )
    else:
        image_metadata = {}

        print(
            "No image assets.",
            flush=True,
        )

    # --------------------------------------------------------
    # 5
    # --------------------------------------------------------

    print(
        "\n5/6 Creatives.get",
        flush=True,
    )

    if creative_ids:
        creative_metadata = (
            get_creative_metadata(
                creative_ids
            )
        )
    else:
        creative_metadata = {}

        print(
            "No builder creatives.",
            flush=True,
        )

    # --------------------------------------------------------
    # 6
    # --------------------------------------------------------

    print(
        "\n6/6 Creative attribution",
        flush=True,
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

    campaigns = aggregate_campaigns(
        campaign_rows
    )

    summary = calculate_summary(
        campaigns
    )

    c_summary = creative_summary(
        creatives
    )

    print(
        "\nCreative summary:",
        flush=True,
    )

    print(
        json.dumps(
            c_summary,
            ensure_ascii=False,
            indent=2,
        ),
        flush=True,
    )

    # Debug — полезно один раз посмотреть,
    # сколько реальной статистики удалось привязать.
    with_stats = sum(
        1
        for c in creatives
        if c.get(
            "impressions",
            0
        ) > 0
    )

    print(
        "Assets with statistics:",
        with_stats,
        "/",
        len(creatives),
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
                "visual_asset_proxy_v5"
            ),

            "score_model": (
                "CTR_60_CPC_40"
            ),

            "min_clicks": (
                MIN_CLICKS_FOR_SCORE
            ),

            "attribution_note": (
                "exact = статистика "
                "выделенного image/video ad; "
                "proxy = статистика объявления "
                "с единственным визуальным "
                "ассетом"
            ),
        },

        "summary": summary,

        "campaigns": campaigns,

        "creative_summary": (
            c_summary
        ),

        "creatives": creatives,

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
        "version": 5,

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
