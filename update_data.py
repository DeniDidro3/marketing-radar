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

REPORTS_URL = (
    "https://api.direct.yandex.com/json/v501/reports"
)

ADS_URL = (
    "https://api.direct.yandex.com/json/v501/ads"
)

ADIMAGES_URL = (
    "https://api.direct.yandex.com/json/v5/adimages"
)

CREATIVES_URL = (
    "https://api.direct.yandex.com/json/v5/creatives"
)

ROOT = Path(__file__).resolve().parent

OUT = ROOT / "data" / "report.enc"


REPORT_DAYS = 60
TREND_DAYS = 7

MIN_CLICKS_FOR_SCORE = 15
MIN_CLICKS_FOR_TREND = 5
MIN_CLICKS_FOR_BASELINE = 5

PBKDF2_ITERATIONS = 600_000


# ============================================================
# BASIC HELPERS
# ============================================================

def safe_float(value, default=0.0):

    if value is None:
        return default

    value = str(value).strip()

    if value in (
        "",
        "-",
        "--",
        "null",
        "None",
    ):
        return default

    value = value.replace(",", ".")

    try:
        return float(value)

    except (
        ValueError,
        TypeError,
    ):
        return default


def safe_int(value, default=0):

    if value is None:
        return default

    value = str(value).strip()

    if value in (
        "",
        "-",
        "--",
        "null",
        "None",
    ):
        return default

    try:
        return int(
            float(value)
        )

    except (
        ValueError,
        TypeError,
    ):
        return default


def clamp(
    value,
    minimum,
    maximum,
):

    return max(
        minimum,
        min(
            maximum,
            value,
        ),
    )


def percent_change(
    current,
    previous,
):

    if previous <= 0:
        return 0.0

    return (
        (
            current
            - previous
        )
        / previous
        * 100
    )


def chunks(
    items,
    size,
):

    items = list(items)

    for i in range(
        0,
        len(items),
        size,
    ):

        yield items[
            i:i + size
        ]


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
    Яндекс требует уникальный ReportName
    для разных параметров offline-отчёта.

    При этом повторный запрос 201/202 должен
    иметь ТОЧНО такое же имя.

    Поэтому имя детерминированно зависит
    от периода + типа + полей.
    """

    signature = json.dumps(
        {
            "type": report_type,
            "fields": fields,
            "from": str(date_from),
            "to": str(date_to),
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
        - timedelta(
            days=REPORT_DAYS
        )
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

        "Authorization":
            f"Bearer {TOKEN}",

        "Accept-Language":
            "ru",

        "processingMode":
            "auto",

        "returnMoneyInMicros":
            "false",

        "skipReportHeader":
            "true",

        "skipColumnHeader":
            "true",

        "skipReportSummary":
            "true",
    }

    body = {

        "params": {

            "SelectionCriteria": {

                "DateFrom":
                    date_from.isoformat(),

                "DateTo":
                    date_to.isoformat(),
            },

            "FieldNames":
                fields,

            "OrderBy": [

                {
                    "Field":
                        "Date",

                    "SortOrder":
                        "ASCENDING",
                }
            ],

            "ReportName":
                report_name,

            "ReportType":
                report_type,

            "DateRangeType":
                "CUSTOM_DATE",

            "Format":
                "TSV",

            "IncludeVAT":
                "YES",

            "IncludeDiscount":
                "YES",
        }
    }

    max_attempts = 20

    for attempt in range(
        1,
        max_attempts + 1,
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
            "HTTP",
            response.status_code,
            flush=True,
        )

        request_id = (
            response.headers.get(
                "RequestId"
            )
        )

        if request_id:

            print(
                "RequestId:",
                request_id,
                flush=True,
            )

        # ------------------------------------
        # REPORT READY
        # ------------------------------------

        if response.status_code == 200:

            print(
                "Report ready.",
                flush=True,
            )

            return response.text

        # ------------------------------------
        # OFFLINE REPORT
        # ------------------------------------

        if response.status_code in (
            201,
            202,
        ):

            retry_in = safe_int(
                response.headers.get(
                    "retryIn",
                    10,
                ),
                10,
            )

            print(
                f"Waiting {retry_in}s...",
                flush=True,
            )

            time.sleep(
                retry_in
            )

            continue

        # ------------------------------------
        # ERROR
        # ------------------------------------

        print(
            "Reports API error:",
            flush=True,
        )

        print(
            response.text,
            flush=True,
        )

        raise RuntimeError(
            f"Reports API: "
            f"HTTP "
            f"{response.status_code}"
        )

    raise RuntimeError(
        "Report generation timeout."
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

        prefix=(
            "MR Campaign"
        ),

        report_type=(
            "CAMPAIGN_PERFORMANCE_REPORT"
        ),

        fields=fields,
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
            zip(
                fields,
                values,
            )
        )

        rows.append({

            "date":
                row.get(
                    "Date",
                    "",
                ),

            "campaign_id":
                row.get(
                    "CampaignId",
                    "",
                ),

            "campaign_name":
                row.get(
                    "CampaignName",
                    "",
                ),

            "impressions":
                safe_int(
                    row.get(
                        "Impressions"
                    )
                ),

            "clicks":
                safe_int(
                    row.get(
                        "Clicks"
                    )
                ),

            "cost":
                safe_float(
                    row.get(
                        "Cost"
                    )
                ),
        })

    print(
        "Campaign rows:",
        len(rows),
        flush=True,
    )

    return rows


# ============================================================
# AD PERFORMANCE
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

        prefix=(
            "MR Visual Assets"
        ),

        report_type=(
            "AD_PERFORMANCE_REPORT"
        ),

        fields=fields,
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
            zip(
                fields,
                values,
            )
        )

        ad_id = str(
            row.get(
                "AdId",
                "",
            )
        ).strip()

        if ad_id in (
            "",
            "-",
            "--",
        ):
            continue

        rows.append({

            "date":
                row.get(
                    "Date",
                    "",
                ),

            "campaign_id":
                row.get(
                    "CampaignId",
                    "",
                ),

            "campaign_name":
                row.get(
                    "CampaignName",
                    "",
                ),

            "ad_group_id":
                row.get(
                    "AdGroupId",
                    "",
                ),

            "ad_group_name":
                row.get(
                    "AdGroupName",
                    "",
                ),

            "ad_id":
                ad_id,

            "network":
                row.get(
                    "AdNetworkType",
                    "UNKNOWN",
                ),

            "ad_format":
                row.get(
                    "AdFormat",
                    "UNKNOWN",
                ),

            "impressions":
                safe_int(
                    row.get(
                        "Impressions"
                    )
                ),

            "clicks":
                safe_int(
                    row.get(
                        "Clicks"
                    )
                ),

            "cost":
                safe_float(
                    row.get(
                        "Cost"
                    )
                ),
        })

    print(
        "Ad performance rows:",
        len(rows),
        flush=True,
    )

    return rows


# ============================================================
# GENERIC JSON API CALL
# ============================================================

def direct_json_api(
    url,
    payload,
    service_name,
):

    headers = {

        "Authorization":
            f"Bearer {TOKEN}",

        "Accept-Language":
            "ru",

        "Content-Type":
            "application/json; charset=utf-8",
    }

    response = requests.post(
        url,
        headers=headers,
        json=payload,
        timeout=120,
    )

    print(
        f"{service_name}: "
        f"HTTP "
        f"{response.status_code}",
        flush=True,
    )

    if response.status_code != 200:

        print(
            response.text,
            flush=True,
        )

        raise RuntimeError(
            f"{service_name}: HTTP "
            f"{response.status_code}"
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
            f"{service_name}: "
            f"API error"
        )

    return data.get(
        "result",
        {},
    )


# ============================================================
# ADS.GET
# ============================================================

def get_ads(ad_ids):

    ads_by_id = {}

    numeric_ids = []

    for ad_id in ad_ids:

        try:

            numeric_ids.append(
                int(ad_id)
            )

        except Exception:

            continue

    # Ads.get поддерживает до 10000 Id,
    # но используем меньшие пачки.
    for id_chunk in chunks(
        numeric_ids,
        3000,
    ):

        print(
            "Ads.get batch:",
            len(id_chunk),
            flush=True,
        )

        payload = {

            "method":
                "get",

            "params": {

                "SelectionCriteria": {

                    "Ids":
                        id_chunk,
                },

                "FieldNames": [

                    "Id",

                    "CampaignId",

                    "AdGroupId",

                    "Type",

                    "Subtype",
                ],

                # --------------------------------
                # TEXT & IMAGE
                # --------------------------------

                "TextAdFieldNames": [

                    "AdImageHash",

                    "VideoExtension",
                ],

                # --------------------------------
                # DYNAMIC
                # --------------------------------

                "DynamicTextAdFieldNames": [

                    "AdImageHash",
                ],

                # --------------------------------
                # MOBILE
                # --------------------------------

                "MobileAppAdFieldNames": [

                    "AdImageHash",

                    "VideoExtension",
                ],

                # --------------------------------
                # IMAGE ADS
                # --------------------------------

                "TextImageAdFieldNames": [

                    "AdImageHash",
                ],

                "MobileAppImageAdFieldNames": [

                    "AdImageHash",
                ],

                # --------------------------------
                # IMAGE BUILDER
                # --------------------------------

                "TextAdBuilderAdFieldNames": [

                    "Creative",
                ],

                "MobileAppAdBuilderAdFieldNames": [

                    "Creative",
                ],

                # --------------------------------
                # VIDEO BUILDER
                # --------------------------------

                "MobileAppCpcVideoAdBuilderAdFieldNames": [

                    "Creative",
                ],

                "CpcVideoAdBuilderAdFieldNames": [

                    "Creative",
                ],

                # --------------------------------
                # CPM
                # --------------------------------

                "CpmBannerAdBuilderAdFieldNames": [

                    "Creative",
                ],

                "CpmVideoAdBuilderAdFieldNames": [

                    "Creative",
                ],

                # --------------------------------
                # SMART
                # --------------------------------

                "SmartAdBuilderAdFieldNames": [

                    "Creative",
                ],

                # --------------------------------
                # RESPONSIVE / COMBINATORIAL
                # --------------------------------

                "ResponsiveAdFieldNames": [

                    "AdImages",

                    "VideoExtensions",
                ],

                "Page": {

                    "Limit":
                        10000,

                    "Offset":
                        0,
                },
            }
        }

        result = direct_json_api(
            ADS_URL,
            payload,
            "Ads.get",
        )

        for ad in result.get(
            "Ads",
            [],
        ):

            ad_id = str(
                ad.get(
                    "Id"
                )
            )

            ads_by_id[
                ad_id
            ] = ad

    print(
        "Ads received:",
        len(ads_by_id),
        flush=True,
    )

    return ads_by_id


# ============================================================
# ASSET BUILDERS
# ============================================================

def make_image_asset(
    image_hash,
    source,
):

    if not image_hash:
        return None

    image_hash = str(
        image_hash
    )

    return {

        "asset_key":
            f"image:{image_hash}",

        "asset_id":
            image_hash,

        "kind":
            "image",

        "source":
            source,
    }


def make_creative_asset(
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

        "asset_key":
            f"creative:{creative_id}",

        "asset_id":
            creative_id,

        "kind":
            kind,

        "source":
            source,

        "preview_url":
            creative.get(
                "PreviewUrl"
            ),

        "thumbnail_url":
            creative.get(
                "ThumbnailUrl"
            ),
    }


# ============================================================
# EXTRACT ASSETS FROM AD
# ============================================================

def extract_ad_assets(ad):

    assets = []

    # ========================================================
    # TEXT AD
    # ========================================================

    text_ad = ad.get(
        "TextAd"
    )

    if text_ad:

        image_asset = (
            make_image_asset(

                text_ad.get(
                    "AdImageHash"
                ),

                "TextAd.AdImageHash",
            )
        )

        if image_asset:

            assets.append(
                image_asset
            )

        video_asset = (
            make_creative_asset(

                text_ad.get(
                    "VideoExtension"
                ),

                "video",

                "TextAd.VideoExtension",
            )
        )

        if video_asset:

            assets.append(
                video_asset
            )

    # ========================================================
    # DYNAMIC TEXT
    # ========================================================

    dynamic = ad.get(
        "DynamicTextAd"
    )

    if dynamic:

        asset = make_image_asset(

            dynamic.get(
                "AdImageHash"
            ),

            (
                "DynamicTextAd."
                "AdImageHash"
            ),
        )

        if asset:

            assets.append(
                asset
            )

    # ========================================================
    # MOBILE APP
    # ========================================================

    mobile = ad.get(
        "MobileAppAd"
    )

    if mobile:

        asset = make_image_asset(

            mobile.get(
                "AdImageHash"
            ),

            (
                "MobileAppAd."
                "AdImageHash"
            ),
        )

        if asset:

            assets.append(
                asset
            )

        asset = make_creative_asset(

            mobile.get(
                "VideoExtension"
            ),

            "video",

            (
                "MobileAppAd."
                "VideoExtension"
            ),
        )

        if asset:

            assets.append(
                asset
            )

    # ========================================================
    # IMAGE ADS
    # ========================================================

    for block_name in (

        "TextImageAd",

        "MobileAppImageAd",
    ):

        block = ad.get(
            block_name
        )

        if not block:
            continue

        asset = make_image_asset(

            block.get(
                "AdImageHash"
            ),

            (
                f"{block_name}."
                f"AdImageHash"
            ),
        )

        if asset:

            assets.append(
                asset
            )

    # ========================================================
    # IMAGE CREATIVE BUILDER
    # ========================================================

    for block_name in (

        "TextAdBuilderAd",

        "MobileAppAdBuilderAd",

        "CpmBannerAdBuilderAd",
    ):

        block = ad.get(
            block_name
        )

        if not block:
            continue

        asset = make_creative_asset(

            block.get(
                "Creative"
            ),

            "image",

            f"{block_name}.Creative",
        )

        if asset:

            assets.append(
                asset
            )

    # ========================================================
    # VIDEO CREATIVE BUILDER
    # ========================================================

    for block_name in (

        "MobileAppCpcVideoAdBuilderAd",

        "CpcVideoAdBuilderAd",

        "CpmVideoAdBuilderAd",
    ):

        block = ad.get(
            block_name
        )

        if not block:
            continue

        asset = make_creative_asset(

            block.get(
                "Creative"
            ),

            "video",

            f"{block_name}.Creative",
        )

        if asset:

            assets.append(
                asset
            )

    # ========================================================
    # SMART CREATIVE
    # ========================================================

    smart = ad.get(
        "SmartAdBuilderAd"
    )

    if smart:

        asset = make_creative_asset(

            smart.get(
                "Creative"
            ),

            "smart",

            "SmartAdBuilderAd.Creative",
        )

        if asset:

            assets.append(
                asset
            )

    # ========================================================
    # RESPONSIVE
    # ========================================================

    responsive = ad.get(
        "ResponsiveAd"
    )

    if responsive:

        # ------------------------------------
        # IMAGES
        # ------------------------------------

        ad_images = (
            responsive.get(
                "AdImages"
            )
            or {}
        )

        image_items = (
            ad_images.get(
                "Items"
            )
            or []
        )

        for image in image_items:

            asset = make_image_asset(

                image.get(
                    "ImageHash"
                ),

                (
                    "ResponsiveAd."
                    "AdImages"
                ),
            )

            if asset:

                assets.append(
                    asset
                )

        # ------------------------------------
        # VIDEOS
        # ------------------------------------

        video_extensions = (
            responsive.get(
                "VideoExtensions"
            )
            or {}
        )

        video_items = (
            video_extensions.get(
                "Items"
            )
            or []
        )

        for video in video_items:

            asset = make_creative_asset(

                video,

                "video",

                (
                    "ResponsiveAd."
                    "VideoExtensions"
                ),
            )

            if asset:

                assets.append(
                    asset
                )

    # ========================================================
    # DEDUP
    # ========================================================

    unique = {}

    for asset in assets:

        unique[
            asset["asset_key"]
        ] = asset

    return list(
        unique.values()
    )


# ============================================================
# ADIMAGES.GET
# ============================================================

def get_adimage_metadata(
    image_hashes,
):

    metadata = {}

    image_hashes = sorted(
        set(
            image_hashes
        )
    )

    for hash_chunk in chunks(
        image_hashes,
        5000,
    ):

        if not hash_chunk:
            continue

        print(
            "AdImages.get batch:",
            len(hash_chunk),
            flush=True,
        )

        payload = {

            "method":
                "get",

            "params": {

                "SelectionCriteria": {

                    "AdImageHashes":
                        hash_chunk,
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

                    "Limit":
                        10000,

                    "Offset":
                        0,
                },
            }
        }

        result = direct_json_api(

            ADIMAGES_URL,

            payload,

            "AdImages.get",
        )

        for item in result.get(
            "AdImages",
            [],
        ):

            image_hash = str(
                item.get(
                    "AdImageHash"
                )
            )

            metadata[
                image_hash
            ] = item

    print(
        "Image metadata:",
        len(metadata),
        flush=True,
    )

    return metadata


# ============================================================
# CREATIVES.GET
# ============================================================

def get_creative_metadata(
    creative_ids,
):

    metadata = {}

    numeric_ids = []

    for creative_id in sorted(
        set(
            creative_ids
        )
    ):

        try:

            numeric_ids.append(
                int(creative_id)
            )

        except Exception:

            continue

    for id_chunk in chunks(
        numeric_ids,
        5000,
    ):

        if not id_chunk:
            continue

        print(
            "Creatives.get batch:",
            len(id_chunk),
            flush=True,
        )

        payload = {

            "method":
                "get",

            "params": {

                "SelectionCriteria": {

                    "Ids":
                        id_chunk,
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

                    "Limit":
                        10000,

                    "Offset":
                        0,
                },
            }
        }

        result = direct_json_api(

            CREATIVES_URL,

            payload,

            "Creatives.get",
        )

        for item in result.get(
            "Creatives",
            [],
        ):

            creative_id = str(
                item.get(
                    "Id"
                )
            )

            metadata[
                creative_id
            ] = item

    print(
        "Creative metadata:",
        len(metadata),
        flush=True,
    )

    return metadata


# ============================================================
# CAMPAIGN AGGREGATION
# ============================================================

def aggregate_campaigns(
    rows,
):

    campaigns = {}

    for row in rows:

        campaign_id = (
            row["campaign_id"]
        )

        if not campaign_id:
            continue

        if (
            campaign_id
            not in campaigns
        ):

            campaigns[
                campaign_id
            ] = {

                "campaign_id":
                    campaign_id,

                "name":
                    row[
                        "campaign_name"
                    ],

                "impressions":
                    0,

                "clicks":
                    0,

                "spend":
                    0.0,
            }

        item = campaigns[
            campaign_id
        ]

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

        impressions = (
            item["impressions"]
        )

        clicks = (
            item["clicks"]
        )

        spend = (
            item["spend"]
        )

        ctr = (
            clicks
            / impressions
            * 100
            if impressions
            else 0
        )

        avg_cpc = (
            spend
            / clicks
            if clicks
            else 0
        )

        result.append({

            **item,

            "spend":
                round(
                    spend,
                    2,
                ),

            "ctr":
                round(
                    ctr,
                    3,
                ),

            "avg_cpc":
                round(
                    avg_cpc,
                    2,
                ),
        })

    result.sort(
        key=lambda item:
            item["spend"],
        reverse=True,
    )

    return result


# ============================================================
# MATCH AD FORMAT -> ASSET
# ============================================================

def assets_for_format(
    assets,
    ad_format,
):

    ad_format = str(
        ad_format
        or ""
    ).upper()

    # IMAGE / ADAPTIVE_IMAGE
    if ad_format in (
        "IMAGE",
        "ADAPTIVE_IMAGE",
    ):

        return [

            asset
            for asset in assets

            if asset["kind"]
            == "image"
        ]

    # VIDEO
    if ad_format == "VIDEO":

        return [

            asset
            for asset in assets

            if asset["kind"]
            == "video"
        ]

    # SMART
    if ad_format in (

        "SMART_MULTIPLE",

        "SMART_SINGLE",

        "SMART_TILE",
    ):

        return [

            asset
            for asset in assets

            if asset["kind"]
            == "smart"
        ]

    # TEXT не приписываем визуалу.
    return []


# ============================================================
# ASSET PERFORMANCE
# ============================================================

def build_asset_performance(
    ad_rows,
    ad_asset_map,
):

    performances = {}

    def ensure_item(
        asset,
        row,
    ):

        # Один и тот же visual asset
        # оцениваем отдельно в каждой кампании
        # и сети.

        key = (

            asset["asset_key"],

            row["campaign_id"],

            row["network"],
        )

        if key not in performances:

            performances[key] = {

                "asset_key":
                    asset[
                        "asset_key"
                    ],

                "asset_id":
                    asset[
                        "asset_id"
                    ],

                "kind":
                    asset[
                        "kind"
                    ],

                "source":
                    asset.get(
                        "source"
                    ),

                "campaign_id":
                    row[
                        "campaign_id"
                    ],

                "campaign_name":
                    row[
                        "campaign_name"
                    ],

                "network":
                    row[
                        "network"
                    ],

                "impressions":
                    0,

                "clicks":
                    0,

                "spend":
                    0.0,

                "ad_ids":
                    set(),

                "ad_group_ids":
                    set(),

                "daily":
                    [],

                # Статистика объявлений, где
                # несколько визуальных ассетов
                # одного типа и нельзя понять,
                # какой из них получил результат.

                "shared_impressions":
                    0,

                "shared_clicks":
                    0,

                "shared_spend":
                    0.0,

                "shared_ad_ids":
                    set(),
            }

        return performances[
            key
        ]

    for row in ad_rows:

        ad_id = (
            row["ad_id"]
        )

        assets = (
            ad_asset_map.get(
                ad_id,
                [],
            )
        )

        matching_assets = (
            assets_for_format(

                assets,

                row[
                    "ad_format"
                ],
            )
        )

        if not matching_assets:
            continue

        # ====================================================
        # ТОЧНАЯ АТРИБУЦИЯ
        # ====================================================

        if len(
            matching_assets
        ) == 1:

            asset = (
                matching_assets[0]
            )

            item = ensure_item(
                asset,
                row,
            )

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
                ad_id
            )

            if row[
                "ad_group_id"
            ]:

                item[
                    "ad_group_ids"
                ].add(
                    row[
                        "ad_group_id"
                    ]
                )

            item["daily"].append({

                "date":
                    row["date"],

                "impressions":
                    row[
                        "impressions"
                    ],

                "clicks":
                    row[
                        "clicks"
                    ],

                "cost":
                    row[
                        "cost"
                    ],
            })

        # ====================================================
        # НЕВОЗМОЖНАЯ АТРИБУЦИЯ
        # ====================================================

        else:

            for asset in (
                matching_assets
            ):

                item = ensure_item(
                    asset,
                    row,
                )

                item[
                    "shared_impressions"
                ] += (
                    row[
                        "impressions"
                    ]
                )

                item[
                    "shared_clicks"
                ] += (
                    row[
                        "clicks"
                    ]
                )

                item[
                    "shared_spend"
                ] += (
                    row[
                        "cost"
                    ]
                )

                item[
                    "shared_ad_ids"
                ].add(
                    ad_id
                )

    result = []

    for item in (
        performances.values()
    ):

        impressions = (
            item[
                "impressions"
            ]
        )

        clicks = (
            item[
                "clicks"
            ]
        )

        spend = (
            item[
                "spend"
            ]
        )

        ctr = (
            clicks
            / impressions
            * 100
            if impressions
            else 0
        )

        avg_cpc = (
            spend
            / clicks
            if clicks
            else 0
        )

        item["ctr"] = round(
            ctr,
            3,
        )

        item["avg_cpc"] = round(
            avg_cpc,
            2,
        )

        item["spend"] = round(
            spend,
            2,
        )

        item[
            "shared_spend"
        ] = round(
            item[
                "shared_spend"
            ],
            2,
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
            "shared_ad_ids"
        ] = sorted(
            item[
                "shared_ad_ids"
            ]
        )

        result.append(
            item
        )

    print(
        "Asset performance objects:",
        len(result),
        flush=True,
    )

    return result


# ============================================================
# METADATA ENRICHMENT
# ============================================================

def enrich_asset_metadata(
    performances,
    asset_registry,
    image_metadata,
    creative_metadata,
):

    for item in performances:

        registry_item = (
            asset_registry.get(
                item[
                    "asset_key"
                ],
                {},
            )
        )

        item["preview_url"] = (
            registry_item.get(
                "preview_url"
            )
        )

        item[
            "thumbnail_url"
        ] = (
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

        # ====================================================
        # IMAGE HASH
        # ====================================================

        if item[
            "asset_key"
        ].startswith(
            "image:"
        ):

            meta = (
                image_metadata.get(
                    item[
                        "asset_id"
                    ],
                    {},
                )
            )

            item["name"] = (
                meta.get(
                    "Name"
                )
            )

            item["preview_url"] = (
                meta.get(
                    "PreviewUrl"
                )
                or item[
                    "preview_url"
                ]
            )

            item["original_url"] = (
                meta.get(
                    "OriginalUrl"
                )
            )

            item["asset_type"] = (
                meta.get(
                    "Type"
                )
                or "IMAGE"
            )

            item["subtype"] = (
                meta.get(
                    "Subtype"
                )
            )

        # ====================================================
        # CREATIVE ID
        # ====================================================

        else:

            meta = (
                creative_metadata.get(
                    item[
                        "asset_id"
                    ],
                    {},
                )
            )

            item["name"] = (
                meta.get(
                    "Name"
                )
            )

            item["preview_url"] = (

                meta.get(
                    "PreviewUrl"
                )

                or item[
                    "preview_url"
                ]
            )

            item[
                "thumbnail_url"
            ] = (

                meta.get(
                    "ThumbnailUrl"
                )

                or item[
                    "thumbnail_url"
                ]
            )

            item["asset_type"] = (
                meta.get(
                    "Type"
                )
                or item[
                    "kind"
                ]
            )

            item["width"] = (
                meta.get(
                    "Width"
                )
            )

            item["height"] = (
                meta.get(
                    "Height"
                )
            )


# ============================================================
# TREND PERIOD
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
            row[
                "impressions"
            ]
        )

        clicks += (
            row[
                "clicks"
            ]
        )

        spend += (
            row[
                "cost"
            ]
        )

    ctr = (

        clicks
        / impressions
        * 100

        if impressions

        else 0
    )

    cpc = (

        spend
        / clicks

        if clicks

        else 0
    )

    return {

        "impressions":
            impressions,

        "clicks":
            clicks,

        "spend":
            round(
                spend,
                2,
            ),

        "ctr":
            round(
                ctr,
                3,
            ),

        "cpc":
            round(
                cpc,
                2,
            ),
    }


# ============================================================
# TREND CALCULATION
# ============================================================

def calculate_trend(
    item,
):

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

    ctr_change = (
        percent_change(

            current[
                "ctr"
            ],

            previous[
                "ctr"
            ],
        )
    )

    cpc_change = (
        percent_change(

            current[
                "cpc"
            ],

            previous[
                "cpc"
            ],
        )
    )

    status = "stable"

    if (

        current["clicks"]
        < MIN_CLICKS_FOR_TREND

        or

        previous["clicks"]
        < MIN_CLICKS_FOR_TREND
    ):

        status = (
            "insufficient_data"
        )

    elif (

        ctr_change <= -20

        and

        cpc_change >= 15
    ):

        status = (
            "fatigue"
        )

    elif (

        ctr_change >= 20

        and

        cpc_change <= -10
    ):

        status = (
            "improving"
        )

    elif ctr_change <= -20:

        status = (
            "ctr_declining"
        )

    elif cpc_change >= 20:

        status = (
            "cpc_growing"
        )

    return {

        "current_7d":
            current,

        "previous_7d":
            previous,

        "ctr_change":
            round(
                ctr_change,
                1,
            ),

        "cpc_change":
            round(
                cpc_change,
                1,
            ),

        "status":
            status,
    }


# ============================================================
# BASELINES
# ============================================================

def build_baselines(
    performances,
):

    groups = defaultdict(
        list
    )

    for item in performances:

        if (
            item["clicks"]
            < MIN_CLICKS_FOR_BASELINE
        ):
            continue

        if (
            item["impressions"]
            <= 0
        ):
            continue

        key = (

            item[
                "campaign_id"
            ],

            item[
                "network"
            ],

            item[
                "kind"
            ],
        )

        groups[key].append(
            item
        )

    baselines = {}

    for key, items in (
        groups.items()
    ):

        ctr_values = [

            item["ctr"]

            for item in items

            if item["ctr"] > 0
        ]

        cpc_values = [

            item["avg_cpc"]

            for item in items

            if item[
                "avg_cpc"
            ] > 0
        ]

        baselines[key] = {

            "count":
                len(items),

            "ctr":
                (
                    median(
                        ctr_values
                    )

                    if ctr_values

                    else 0
                ),

            "cpc":
                (
                    median(
                        cpc_values
                    )

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

    # ========================================================
    # ONLY SHARED STATS
    # ========================================================

    if (

        item["impressions"] == 0

        and

        item[
            "shared_impressions"
        ] > 0
    ):

        return {

            "score":
                None,

            "status":
                "unattributable",

            "reason": (
                "В объявлении одновременно "
                "используется несколько "
                "визуальных креативов. "
                "Яндекс отдаёт общую "
                "статистику объявления, "
                "поэтому результат нельзя "
                "надёжно распределить."
            ),
        }

    # ========================================================
    # NOT ENOUGH CLICKS
    # ========================================================

    if (
        item["clicks"]
        < MIN_CLICKS_FOR_SCORE
    ):

        return {

            "score":
                None,

            "status":
                "insufficient_data",

            "reason": (
                "Недостаточно данных: "
                f"для оценки требуется минимум "
                f"{MIN_CLICKS_FOR_SCORE} кликов."
            ),
        }

    # ========================================================
    # NO PEERS
    # ========================================================

    if (

        not baseline

        or

        baseline[
            "count"
        ] < 2

        or

        baseline[
            "ctr"
        ] <= 0

        or

        baseline[
            "cpc"
        ] <= 0
    ):

        return {

            "score":
                None,

            "status":
                "no_peers",

            "reason": (
                "Недостаточно сопоставимых "
                "визуальных креативов "
                "в этой кампании."
            ),
        }

    # ========================================================
    # RELATIVE METRICS
    # ========================================================

    ctr_ratio = (

        item["ctr"]

        / baseline["ctr"]

        if baseline["ctr"] > 0

        else 1
    )

    cpc_ratio = (

        baseline["cpc"]

        / item["avg_cpc"]

        if item["avg_cpc"] > 0

        else 1
    )

    # ========================================================
    # CTR SCORE
    #
    # CTR = median       -> 50
    # CTR = 1.5x median  -> 100
    # CTR = 0.5x median  -> 0
    # ========================================================

    ctr_component = clamp(

        50
        + (
            ctr_ratio - 1
        ) * 100,

        0,

        100,
    )

    # ========================================================
    # CPC SCORE
    #
    # CPC ниже среднего = лучше
    # ========================================================

    cpc_component = clamp(

        50
        + (
            cpc_ratio - 1
        ) * 100,

        0,

        100,
    )

    # ========================================================
    # FINAL SCORE
    #
    # CTR 60%
    # CPC 40%
    # ========================================================

    score = round(

        ctr_component * 0.60

        +

        cpc_component * 0.40
    )

    score = int(
        clamp(
            score,
            0,
            100,
        )
    )

    if score >= 70:

        status = (
            "successful"
        )

        reason = (
            "Креатив работает лучше "
            "медианы сопоставимых "
            "креативов кампании."
        )

    elif score >= 45:

        status = (
            "normal"
        )

        reason = (
            "Показатели близки "
            "к медиане сопоставимых "
            "креативов."
        )

    else:

        status = (
            "weak"
        )

        reason = (
            "Креатив уступает "
            "сопоставимым визуалам "
            "по CTR и/или CPC."
        )

    return {

        "score":
            score,

        "status":
            status,

        "reason":
            reason,

        "ctr_ratio":
            round(
                ctr_ratio,
                2,
            ),

        "cpc_ratio":
            round(
                cpc_ratio,
                2,
            ),

        "baseline_ctr":
            round(
                baseline[
                    "ctr"
                ],
                3,
            ),

        "baseline_cpc":
            round(
                baseline[
                    "cpc"
                ],
                2,
            ),

        "peer_count":
            baseline[
                "count"
            ],
    }


# ============================================================
# FINAL CREATIVE ANALYSIS
# ============================================================

def analyze_assets(
    performances,
):

    baselines = (
        build_baselines(
            performances
        )
    )

    output = []

    for item in performances:

        baseline_key = (

            item[
                "campaign_id"
            ],

            item[
                "network"
            ],

            item[
                "kind"
            ],
        )

        baseline = (
            baselines.get(
                baseline_key
            )
        )

        analysis = (
            analyze_performance(
                item,
                baseline,
            )
        )

        trend = (
            calculate_trend(
                item
            )
        )

        final_status = (
            analysis[
                "status"
            ]
        )

        # ====================================================
        # TREND CAN OVERRIDE SCORE STATUS
        # ====================================================

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

        output_item = {

            key: value

            for key, value
            in item.items()

            if key != "daily"
        }

        output_item.update(
            analysis
        )

        output_item[
            "base_status"
        ] = (
            analysis[
                "status"
            ]
        )

        output_item[
            "status"
        ] = (
            final_status
        )

        output_item[
            "trend"
        ] = (
            trend
        )

        output.append(
            output_item
        )

    priority = {

        "fatigue":
            0,

        "weak":
            1,

        "improving":
            2,

        "successful":
            3,

        "normal":
            4,

        "insufficient_data":
            5,

        "no_peers":
            6,

        "unattributable":
            7,
    }

    output.sort(

        key=lambda item: (

            priority.get(
                item[
                    "status"
                ],
                99,
            ),

            -item.get(
                "spend",
                0,
            ),
        )
    )

    return output


# ============================================================
# CREATIVE SUMMARY
# ============================================================

def calculate_creative_summary(
    creatives,
):

    counts = defaultdict(
        int
    )

    for creative in creatives:

        counts[
            creative[
                "status"
            ]
        ] += 1

    return {

        "total":
            len(creatives),

        "successful":
            counts[
                "successful"
            ],

        "normal":
            counts[
                "normal"
            ],

        "weak":
            counts[
                "weak"
            ],

        "fatigue":
            counts[
                "fatigue"
            ],

        "improving":
            counts[
                "improving"
            ],

        "insufficient_data":
            counts[
                "insufficient_data"
            ],

        "no_peers":
            counts[
                "no_peers"
            ],

        "unattributable":
            counts[
                "unattributable"
            ],
    }


# ============================================================
# ACCOUNT SUMMARY
# ============================================================

def calculate_summary(
    campaigns,
):

    impressions = sum(

        item[
            "impressions"
        ]

        for item
        in campaigns
    )

    clicks = sum(

        item[
            "clicks"
        ]

        for item
        in campaigns
    )

    spend = sum(

        item[
            "spend"
        ]

        for item
        in campaigns
    )

    ctr = (

        clicks
        / impressions
        * 100

        if impressions

        else 0
    )

    avg_cpc = (

        spend
        / clicks

        if clicks

        else 0
    )

    return {

        "spend":
            round(
                spend,
                2,
            ),

        "impressions":
            impressions,

        "clicks":
            clicks,

        "ctr":
            round(
                ctr,
                3,
            ),

        "avg_cpc":
            round(
                avg_cpc,
                2,
            ),
    }


# ============================================================
# BUILD REPORT
# ============================================================

def build_report():

    print(
        "",
        flush=True,
    )

    print(
        "======================================",
        flush=True,
    )

    print(
        "MARKETING RADAR UPDATE",
        flush=True,
    )

    print(
        "======================================",
        flush=True,
    )

    # ========================================================
    # 1. CAMPAIGN STATS
    # ========================================================

    print(
        "",
        flush=True,
    )

    print(
        "1/6 Campaign report",
        flush=True,
    )

    campaign_rows = (
        get_campaign_rows()
    )

    # ========================================================
    # 2. AD STATS
    # ========================================================

    print(
        "",
        flush=True,
    )

    print(
        "2/6 Ad performance report",
        flush=True,
    )

    ad_rows = (
        get_ad_rows()
    )

    ad_ids = sorted({

        row[
            "ad_id"
        ]

        for row
        in ad_rows
    })

    print(
        "Unique Ads:",
        len(ad_ids),
        flush=True,
    )

    # ========================================================
    # 3. ADS.GET
    # ========================================================

    print(
        "",
        flush=True,
    )

    print(
        "3/6 Ads.get",
        flush=True,
    )

    ads = get_ads(
        ad_ids
    )

    # ========================================================
    # EXTRACT ASSETS
    # ========================================================

    ad_asset_map = {}

    asset_registry = {}

    for ad_id, ad in ads.items():

        assets = (
            extract_ad_assets(
                ad
            )
        )

        ad_asset_map[
            ad_id
        ] = (
            assets
        )

        for asset in assets:

            asset_key = (
                asset[
                    "asset_key"
                ]
            )

            if (
                asset_key
                not in asset_registry
            ):

                asset_registry[
                    asset_key
                ] = (
                    asset.copy()
                )

    print(
        "Unique visual assets:",
        len(asset_registry),
        flush=True,
    )

    image_hashes = [

        asset[
            "asset_id"
        ]

        for asset
        in asset_registry.values()

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

        for asset
        in asset_registry.values()

        if asset[
            "asset_key"
        ].startswith(
            "creative:"
        )
    ]

    print(
        "Image assets:",
        len(image_hashes),
        flush=True,
    )

    print(
        "Creative IDs:",
        len(creative_ids),
        flush=True,
    )

    # ========================================================
    # 4. IMAGE METADATA
    # ========================================================

    print(
        "",
        flush=True,
    )

    print(
        "4/6 AdImages.get",
        flush=True,
    )

    image_metadata = {}

    if image_hashes:

        image_metadata = (
            get_adimage_metadata(
                image_hashes
            )
        )

    else:

        print(
            "No image hashes.",
            flush=True,
        )

    # ========================================================
    # 5. CREATIVE METADATA
    # ========================================================

    print(
        "",
        flush=True,
    )

    print(
        "5/6 Creatives.get",
        flush=True,
    )

    creative_metadata = {}

    if creative_ids:

        creative_metadata = (
            get_creative_metadata(
                creative_ids
            )
        )

    else:

        print(
            "No CreativeIds.",
            flush=True,
        )

    # ========================================================
    # 6. ANALYSIS
    # ========================================================

    print(
        "",
        flush=True,
    )

    print(
        "6/6 Creative analysis",
        flush=True,
    )

    asset_performance = (
        build_asset_performance(

            ad_rows,

            ad_asset_map,
        )
    )

    enrich_asset_metadata(

        asset_performance,

        asset_registry,

        image_metadata,

        creative_metadata,
    )

    creatives = (
        analyze_assets(
            asset_performance
        )
    )

    campaigns = (
        aggregate_campaigns(
            campaign_rows
        )
    )

    creative_summary = (
        calculate_creative_summary(
            creatives
        )
    )

    summary = (
        calculate_summary(
            campaigns
        )
    )

    report = {

        "meta": {

            "updated_at":
                datetime.now(
                    timezone.utc
                ).isoformat(),

            "source":
                "yandex_direct",

            "period_days":
                REPORT_DAYS,

            "creative_method":
                "visual_asset_v3",

            "score_model":
                "CTR_60_CPC_40",

            "min_clicks":
                MIN_CLICKS_FOR_SCORE,
        },

        "summary":
            summary,

        "campaigns":
            campaigns,

        "creative_summary":
            creative_summary,

        "creatives":
            creatives,

        "daily":
            campaign_rows,
    }

    print(
        "",
        flush=True,
    )

    print(
        "CREATIVE SUMMARY",
        flush=True,
    )

    print(
        json.dumps(
            creative_summary,
            ensure_ascii=False,
            indent=2,
        ),
        flush=True,
    )

    return report


# ============================================================
# ENCRYPTION
# ============================================================

def derive_encryption_key(
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


def encrypt_report(
    report,
):

    plaintext = json.dumps(

        report,

        ensure_ascii=False,

        separators=(
            ",",
            ":",
        ),
    ).encode(
        "utf-8"
    )

    salt = secrets.token_bytes(
        16
    )

    nonce = secrets.token_bytes(
        12
    )

    key = (
        derive_encryption_key(
            REPORT_PASSWORD,
            salt,
        )
    )

    aes = AESGCM(
        key
    )

    ciphertext = aes.encrypt(

        nonce,

        plaintext,

        None,
    )

    return {

        "version":
            3,

        "kdf":
            "PBKDF2-SHA256",

        "iterations":
            PBKDF2_ITERATIONS,

        "cipher":
            "AES-256-GCM",

        "salt":
            base64.b64encode(
                salt
            ).decode(
                "ascii"
            ),

        "nonce":
            base64.b64encode(
                nonce
            ).decode(
                "ascii"
            ),

        "ciphertext":
            base64.b64encode(
                ciphertext
            ).decode(
                "ascii"
            ),
    }


# ============================================================
# MAIN
# ============================================================

def main():

    report = (
        build_report()
    )

    encrypted = (
        encrypt_report(
            report
        )
    )

    OUT.parent.mkdir(

        parents=True,

        exist_ok=True,
    )

    OUT.write_text(

        json.dumps(

            encrypted,

            ensure_ascii=False,

            separators=(
                ",",
                ":",
            ),
        ),

        encoding=(
            "utf-8"
        ),
    )

    print(
        "",
        flush=True,
    )

    print(
        "======================================",
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
