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

DIRECT_REPORT_URL = (
    "https://api.direct.yandex.com/json/v501/reports"
)

DIRECT_API_BASE = (
    "https://api.direct.yandex.com/json/v5"
)

ROOT = Path(__file__).resolve().parent

OUT = ROOT / "data" / "report.enc"


REPORT_DAYS = 60

TREND_DAYS = 7

MIN_CLICKS_FOR_SCORE = 15

MIN_CLICKS_FOR_BASELINE = 5

PBKDF2_ITERATIONS = 600_000


# ============================================================
# COMMON HELPERS
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


def chunks(items, size):

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
# GENERIC DIRECT JSON API
# ============================================================

def direct_api(
    service,
    payload,
):

    url = (
        f"{DIRECT_API_BASE}/{service}"
    )

    headers = {
        "Authorization": (
            f"Bearer {TOKEN}"
        ),
        "Accept-Language": "ru",
        "Content-Type": (
            "application/json; "
            "charset=utf-8"
        ),
    }

    response = requests.post(
        url,
        headers=headers,
        json=payload,
        timeout=120,
    )

    if response.status_code != 200:

        print(
            f"{service} API error:",
            response.status_code,
            flush=True,
        )

        print(
            response.text,
            flush=True,
        )

        raise RuntimeError(
            f"{service} returned "
            f"HTTP "
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
            f"Direct service "
            f"{service} returned error"
        )

    return data.get(
        "result",
        {},
    )


# ============================================================
# REPORTS API
# ============================================================

def request_report(
    report_name,
    report_type,
    fields,
):

    today = (
        datetime.now(
            timezone.utc
        ).date()
    )

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

    headers = {
        "Authorization": (
            f"Bearer {TOKEN}"
        ),
        "Accept-Language": "ru",
        "processingMode": "auto",
        "returnMoneyInMicros": (
            "false"
        ),
        "skipReportHeader": (
            "true"
        ),
        "skipColumnHeader": (
            "true"
        ),
        "skipReportSummary": (
            "true"
        ),
    }

    body = {
        "params": {

            "SelectionCriteria": {
                "DateFrom": (
                    date_from.isoformat()
                ),
                "DateTo": (
                    date_to.isoformat()
                ),
            },

            "FieldNames": fields,

            "OrderBy": [
                {
                    "Field": "Date",
                    "SortOrder": (
                        "ASCENDING"
                    ),
                }
            ],

            "ReportName": (
                report_name
            ),

            "ReportType": (
                report_type
            ),

            "DateRangeType": (
                "CUSTOM_DATE"
            ),

            "Format": "TSV",

            "IncludeVAT": "YES",

            "IncludeDiscount": "YES",
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
            DIRECT_REPORT_URL,
            headers=headers,
            json=body,
            timeout=120,
        )

        print(
            "HTTP",
            response.status_code,
            flush=True,
        )

        if (
            response.status_code
            == 200
        ):

            print(
                f"{report_name} received",
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
                    10,
                ),
                10,
            )

            print(
                f"Waiting "
                f"{retry_in}s...",
                flush=True,
            )

            time.sleep(
                retry_in
            )

            continue

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
        (
            "Marketing Radar "
            "Campaign Report"
        ),
        (
            "CAMPAIGN_PERFORMANCE_REPORT"
        ),
        fields,
    )

    reader = csv.reader(
        io.StringIO(text),
        delimiter="\t",
    )

    rows = []

    for values in reader:

        if (
            not values
            or len(values)
            < len(fields)
        ):
            continue

        row = dict(
            zip(
                fields,
                values,
            )
        )

        rows.append({

            "date":
                row["Date"],

            "campaign_id":
                row["CampaignId"],

            "campaign_name":
                row["CampaignName"],

            "impressions":
                safe_int(
                    row["Impressions"]
                ),

            "clicks":
                safe_int(
                    row["Clicks"]
                ),

            "cost":
                safe_float(
                    row["Cost"]
                ),
        })

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
        (
            "Marketing Radar "
            "Asset Performance"
        ),
        "AD_PERFORMANCE_REPORT",
        fields,
    )

    reader = csv.reader(
        io.StringIO(text),
        delimiter="\t",
    )

    rows = []

    for values in reader:

        if (
            not values
            or len(values)
            < len(fields)
        ):
            continue

        row = dict(
            zip(
                fields,
                values,
            )
        )

        ad_id = (
            row.get(
                "AdId",
                "",
            )
        )

        if ad_id in (
            "",
            "-",
            "--",
        ):
            continue

        rows.append({

            "date":
                row["Date"],

            "campaign_id":
                row["CampaignId"],

            "campaign_name":
                row["CampaignName"],

            "ad_group_id":
                row["AdGroupId"],

            "ad_group_name":
                row["AdGroupName"],

            "ad_id":
                ad_id,

            "network":
                row[
                    "AdNetworkType"
                ],

            "ad_format":
                row["AdFormat"],

            "impressions":
                safe_int(
                    row["Impressions"]
                ),

            "clicks":
                safe_int(
                    row["Clicks"]
                ),

            "cost":
                safe_float(
                    row["Cost"]
                ),
        })

    print(
        "Ad statistic rows:",
        len(rows),
        flush=True,
    )

    return rows


# ============================================================
# ADS.GET
# ============================================================

def get_ads(
    ad_ids,
):

    result = {}

    numeric_ids = []

    for ad_id in ad_ids:

        try:
            numeric_ids.append(
                int(ad_id)
            )
        except Exception:
            pass

    for id_chunk in chunks(
        numeric_ids,
        5000,
    ):

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
                    "State",
                    "Status",
                ],

                # Обычные Text & Image
                "TextAdFieldNames": [
                    "AdImageHash",
                    "VideoExtension",
                ],

                # Динамические
                "DynamicTextAdFieldNames": [
                    "AdImageHash",
                ],

                # Mobile App
                "MobileAppAdFieldNames": [
                    "AdImageHash",
                    "VideoExtension",
                ],

                # Image Ad из картинки
                "TextImageAdFieldNames": [
                    "AdImageHash",
                ],

                "MobileAppImageAdFieldNames": [
                    "AdImageHash",
                ],

                # Builder image creative
                "TextAdBuilderAdFieldNames": [
                    "Creative",
                ],

                "MobileAppAdBuilderAdFieldNames": [
                    "Creative",
                ],

                # Video builders
                "MobileAppCpcVideoAdBuilderAdFieldNames": [
                    "Creative",
                ],

                "CpcVideoAdBuilderAdFieldNames": [
                    "Creative",
                ],

                # CPM
                "CpmBannerAdBuilderAdFieldNames": [
                    "Creative",
                ],

                "CpmVideoAdBuilderAdFieldNames": [
                    "Creative",
                ],

                # Smart
                "SmartAdBuilderAdFieldNames": [
                    "Creative",
                ],

                # Комбинаторные объявления
                "ResponsiveAdFieldNames": [
                    "AdImages",
                    "VideoExtensions",
                ],

                "Page": {
                    "Limit": 5000,
                    "Offset": 0,
                },
            }
        }

        api_result = direct_api(
            "ads",
            payload,
        )

        for ad in api_result.get(
            "Ads",
            [],
        ):
            result[
                str(ad["Id"])
            ] = ad

    print(
        "Ads.get objects:",
        len(result),
        flush=True,
    )

    return result


# ============================================================
# EXTRACT VISUAL ASSETS FROM AD
# ============================================================

def make_image_asset(
    image_hash,
    source,
):

    if not image_hash:
        return None

    return {
        "asset_key": (
            f"image:{image_hash}"
        ),
        "asset_id": image_hash,
        "kind": "image",
        "source": source,
    }


def make_creative_asset(
    creative,
    kind,
    source,
):

    if not creative:
        return None

    creative_id = (
        creative.get(
            "CreativeId"
        )
    )

    if not creative_id:
        return None

    return {

        "asset_key": (
            f"creative:"
            f"{creative_id}"
        ),

        "asset_id": (
            str(creative_id)
        ),

        "kind": kind,

        "source": source,

        "preview_url": (
            creative.get(
                "PreviewUrl"
            )
        ),

        "thumbnail_url": (
            creative.get(
                "ThumbnailUrl"
            )
        ),
    }


def extract_ad_assets(ad):

    assets = []

    # ----------------------------------------
    # TEXT_AD
    # ----------------------------------------

    text_ad = ad.get(
        "TextAd"
    )

    if text_ad:

        image_hash = (
            text_ad.get(
                "AdImageHash"
            )
        )

        asset = make_image_asset(
            image_hash,
            "TextAd.AdImageHash",
        )

        if asset:
            assets.append(asset)

        video = (
            text_ad.get(
                "VideoExtension"
            )
        )

        asset = (
            make_creative_asset(
                video,
                "video",
                (
                    "TextAd."
                    "VideoExtension"
                ),
            )
        )

        if asset:
            assets.append(asset)

    # ----------------------------------------
    # DYNAMIC TEXT AD
    # ----------------------------------------

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
            assets.append(asset)

    # ----------------------------------------
    # MOBILE APP AD
    # ----------------------------------------

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
            assets.append(asset)

        asset = (
            make_creative_asset(
                mobile.get(
                    "VideoExtension"
                ),
                "video",
                (
                    "MobileAppAd."
                    "VideoExtension"
                ),
            )
        )

        if asset:
            assets.append(asset)

    # ----------------------------------------
    # IMAGE ADS FROM FILE
    # ----------------------------------------

    for block_name in [
        "TextImageAd",
        "MobileAppImageAd",
    ]:

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
            assets.append(asset)

    # ----------------------------------------
    # BUILDER IMAGE CREATIVE
    # ----------------------------------------

    for block_name in [
        "TextAdBuilderAd",
        "MobileAppAdBuilderAd",
        "CpmBannerAdBuilderAd",
    ]:

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
            (
                f"{block_name}."
                f"Creative"
            ),
        )

        if asset:
            assets.append(asset)

    # ----------------------------------------
    # VIDEO CREATIVES
    # ----------------------------------------

    for block_name in [
        "MobileAppCpcVideoAdBuilderAd",
        "CpcVideoAdBuilderAd",
        "CpmVideoAdBuilderAd",
    ]:

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
            (
                f"{block_name}."
                f"Creative"
            ),
        )

        if asset:
            assets.append(asset)

    # ----------------------------------------
    # SMART
    # ----------------------------------------

    smart = ad.get(
        "SmartAdBuilderAd"
    )

    if smart:

        asset = make_creative_asset(
            smart.get(
                "Creative"
            ),
            "smart",
            (
                "SmartAdBuilderAd."
                "Creative"
            ),
        )

        if asset:
            assets.append(asset)

    # ----------------------------------------
    # RESPONSIVE AD
    #
    # Здесь может быть несколько изображений
    # и несколько видео.
    # ----------------------------------------

    responsive = ad.get(
        "ResponsiveAd"
    )

    if responsive:

        images_block = (
            responsive.get(
                "AdImages"
            )
            or {}
        )

        for image in (
            images_block.get(
                "Items"
            )
            or []
        ):

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
                assets.append(asset)

        videos_block = (
            responsive.get(
                "VideoExtensions"
            )
            or {}
        )

        for video in (
            videos_block.get(
                "Items"
            )
            or []
        ):

            asset = (
                make_creative_asset(
                    video,
                    "video",
                    (
                        "ResponsiveAd."
                        "VideoExtensions"
                    ),
                )
            )

            if asset:
                assets.append(asset)

    # ----------------------------------------
    # DEDUP
    # ----------------------------------------

    unique = {}

    for asset in assets:

        unique[
            asset["asset_key"]
        ] = asset

    return list(
        unique.values()
    )


# ============================================================
# AD IMAGES METADATA
# ============================================================

def get_adimage_metadata(
    image_hashes,
):

    metadata = {}

    for hash_chunk in chunks(
        image_hashes,
        5000,
    ):

        if not hash_chunk:
            continue

        payload = {

            "method": "get",

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
                    "Limit": 5000,
                    "Offset": 0,
                },
            }
        }

        result = direct_api(
            "adimages",
            payload,
        )

        for item in result.get(
            "AdImages",
            [],
        ):

            metadata[
                item["AdImageHash"]
            ] = item

    return metadata


# ============================================================
# CREATIVE METADATA
# ============================================================

def get_creative_metadata(
    creative_ids,
):

    metadata = {}

    numeric = []

    for creative_id in (
        creative_ids
    ):

        try:
            numeric.append(
                int(creative_id)
            )
        except Exception:
            pass

    for id_chunk in chunks(
        numeric,
        5000,
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
                    "Limit": 5000,
                    "Offset": 0,
                },
            }
        }

        result = direct_api(
            "creatives",
            payload,
        )

        for item in result.get(
            "Creatives",
            [],
        ):

            metadata[
                str(item["Id"])
            ] = item

    return metadata


# ============================================================
# CAMPAIGN AGGREGATION
# ============================================================

def aggregate_campaigns(
    rows,
):

    campaigns = {}

    for row in rows:

        cid = (
            row["campaign_id"]
        )

        if not cid:
            continue

        if cid not in campaigns:

            campaigns[cid] = {

                "campaign_id": cid,

                "name":
                    row[
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

    for item in (
        campaigns.values()
    ):

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

        cpc = (
            spend / clicks
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
                    cpc,
                    2,
                ),
        })

    result.sort(
        key=lambda x:
            x["spend"],
        reverse=True,
    )

    return result


# ============================================================
# WHICH ASSETS MATCH WHICH AD FORMAT?
# ============================================================

def assets_for_format(
    assets,
    ad_format,
):

    ad_format = (
        ad_format
        or ""
    ).upper()

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

    if ad_format == "VIDEO":

        return [
            asset
            for asset in assets
            if asset["kind"]
            == "video"
        ]

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

    # TEXT-показы визуальному ассету
    # не присваиваем.
    return []


# ============================================================
# BUILD ASSET PERFORMANCE
# ============================================================

def build_asset_performance(
    ad_rows,
    ad_asset_map,
):

    performances = {}

    def ensure_perf(
        asset,
        row,
    ):

        key = (
            asset["asset_key"],
            row["campaign_id"],
            row["network"],
        )

        if key not in performances:

            performances[key] = {

                "asset_key":
                    asset["asset_key"],

                "asset_id":
                    asset["asset_id"],

                "kind":
                    asset["kind"],

                "source":
                    asset["source"],

                "campaign_id":
                    row[
                        "campaign_id"
                    ],

                "campaign_name":
                    row[
                        "campaign_name"
                    ],

                "network":
                    row["network"],

                "impressions": 0,

                "clicks": 0,

                "spend": 0.0,

                "ad_ids": set(),

                "ad_group_ids": set(),

                "daily": [],

                # Статистика, которую нельзя
                # распределить между несколькими
                # ассетами.
                "shared_impressions": 0,

                "shared_clicks": 0,

                "shared_spend": 0.0,

                "shared_ad_ids": set(),
            }

        return performances[key]

    for row in ad_rows:

        assets = (
            ad_asset_map.get(
                row["ad_id"],
                [],
            )
        )

        matching = (
            assets_for_format(
                assets,
                row["ad_format"],
            )
        )

        if not matching:
            continue

        # ====================================================
        # ТОЧНАЯ АТРИБУЦИЯ:
        # в этом формате объявления только один ассет
        # ====================================================

        if len(matching) == 1:

            asset = matching[0]

            perf = ensure_perf(
                asset,
                row,
            )

            perf["impressions"] += (
                row["impressions"]
            )

            perf["clicks"] += (
                row["clicks"]
            )

            perf["spend"] += (
                row["cost"]
            )

            perf["ad_ids"].add(
                row["ad_id"]
            )

            perf[
                "ad_group_ids"
            ].add(
                row["ad_group_id"]
            )

            perf["daily"].append({

                "date":
                    row["date"],

                "impressions":
                    row[
                        "impressions"
                    ],

                "clicks":
                    row["clicks"],

                "cost":
                    row["cost"],
            })

        # ====================================================
        # НЕВОЗМОЖНО ТОЧНО РАЗДЕЛИТЬ:
        # responsive ad с несколькими картинками/видео
        # ====================================================

        else:

            for asset in matching:

                perf = ensure_perf(
                    asset,
                    row,
                )

                perf[
                    "shared_impressions"
                ] += (
                    row["impressions"]
                )

                perf[
                    "shared_clicks"
                ] += (
                    row["clicks"]
                )

                perf[
                    "shared_spend"
                ] += (
                    row["cost"]
                )

                perf[
                    "shared_ad_ids"
                ].add(
                    row["ad_id"]
                )

    result = []

    for perf in (
        performances.values()
    ):

        impressions = (
            perf["impressions"]
        )

        clicks = (
            perf["clicks"]
        )

        spend = (
            perf["spend"]
        )

        perf["ctr"] = (
            clicks
            / impressions
            * 100
            if impressions
            else 0
        )

        perf["avg_cpc"] = (
            spend / clicks
            if clicks
            else 0
        )

        perf["spend"] = round(
            spend,
            2,
        )

        perf["ctr"] = round(
            perf["ctr"],
            3,
        )

        perf["avg_cpc"] = round(
            perf["avg_cpc"],
            2,
        )

        perf["shared_spend"] = round(
            perf[
                "shared_spend"
            ],
            2,
        )

        perf["ad_ids"] = sorted(
            perf["ad_ids"]
        )

        perf["ad_group_ids"] = sorted(
            perf[
                "ad_group_ids"
            ]
        )

        perf[
            "shared_ad_ids"
        ] = sorted(
            perf[
                "shared_ad_ids"
            ]
        )

        result.append(perf)

    return result


# ============================================================
# ADD PREVIEW / METADATA
# ============================================================

def enrich_asset_metadata(
    performances,
    asset_registry,
    image_metadata,
    creative_metadata,
):

    for perf in performances:

        asset = (
            asset_registry.get(
                perf["asset_key"],
                {},
            )
        )

        perf["preview_url"] = (
            asset.get(
                "preview_url"
            )
        )

        perf[
            "thumbnail_url"
        ] = (
            asset.get(
                "thumbnail_url"
            )
        )

        perf["name"] = None

        perf["width"] = None
        perf["height"] = None

        perf["asset_type"] = (
            perf["kind"]
        )

        # ----------------------------------------
        # ADIMAGE
        # ----------------------------------------

        if (
            perf["asset_key"]
            .startswith(
                "image:"
            )
        ):

            meta = (
                image_metadata.get(
                    perf["asset_id"],
                    {},
                )
            )

            perf["name"] = (
                meta.get("Name")
            )

            perf["preview_url"] = (
                meta.get(
                    "PreviewUrl"
                )
                or perf[
                    "preview_url"
                ]
            )

            perf["original_url"] = (
                meta.get(
                    "OriginalUrl"
                )
            )

            perf["asset_type"] = (
                meta.get("Type")
                or "IMAGE"
            )

            perf["subtype"] = (
                meta.get(
                    "Subtype"
                )
            )

        # ----------------------------------------
        # CREATIVE ID
        # ----------------------------------------

        else:

            meta = (
                creative_metadata.get(
                    perf["asset_id"],
                    {},
                )
            )

            perf["name"] = (
                meta.get("Name")
            )

            perf["preview_url"] = (
                meta.get(
                    "PreviewUrl"
                )
                or perf[
                    "preview_url"
                ]
            )

            perf[
                "thumbnail_url"
            ] = (
                meta.get(
                    "ThumbnailUrl"
                )
                or perf[
                    "thumbnail_url"
                ]
            )

            perf["asset_type"] = (
                meta.get("Type")
                or perf["kind"]
            )

            perf["width"] = (
                meta.get("Width")
            )

            perf["height"] = (
                meta.get("Height")
            )


# ============================================================
# TREND
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
            day = (
                datetime.strptime(
                    row["date"],
                    "%Y-%m-%d",
                ).date()
            )
        except Exception:
            continue

        if not (
            start_date
            <= day
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
        if impressions
        else 0
    )

    cpc = (
        spend / clicks
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


def calculate_trend(
    perf,
):

    today = (
        datetime.now(
            timezone.utc
        ).date()
    )

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
        perf["daily"],
        current_start,
        current_end,
    )

    previous = period_stats(
        perf["daily"],
        previous_start,
        previous_end,
    )

    ctr_change = (
        percent_change(
            current["ctr"],
            previous["ctr"],
        )
    )

    cpc_change = (
        percent_change(
            current["cpc"],
            previous["cpc"],
        )
    )

    status = "stable"

    if (
        current["clicks"] < 5
        or previous["clicks"] < 5
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

        status = (
            "ctr_declining"
        )

    elif cpc_change >= 20:

        status = (
            "cpc_growing"
        )

    return {

        "current_7d": current,

        "previous_7d": previous,

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

    groups = defaultdict(list)

    for perf in performances:

        if (
            perf["clicks"]
            < MIN_CLICKS_FOR_BASELINE
        ):
            continue

        # Никакие shared-показы
        # в baseline не включаем.
        if (
            perf["impressions"]
            <= 0
        ):
            continue

        key = (
            perf["campaign_id"],
            perf["network"],
            perf["kind"],
        )

        groups[key].append(
            perf
        )

    baselines = {}

    for key, items in (
        groups.items()
    ):

        valid_ctr = [
            item["ctr"]
            for item in items
            if item["ctr"] > 0
        ]

        valid_cpc = [
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
                    median(valid_ctr)
                    if valid_ctr
                    else 0
                ),

            "cpc":
                (
                    median(valid_cpc)
                    if valid_cpc
                    else 0
                ),
        }

    return baselines


# ============================================================
# SCORE
# ============================================================

def analyze_performance(
    perf,
    baseline,
):

    # Только shared статистика.
    if (
        perf["impressions"] == 0
        and perf[
            "shared_impressions"
        ] > 0
    ):

        return {

            "score": None,

            "status":
                "unattributable",

            "reason": (
                "В этом объявлении "
                "несколько визуальных "
                "ассетов. Direct не "
                "показывает статистику "
                "каждого отдельно."
            ),
        }

    if (
        perf["clicks"]
        < MIN_CLICKS_FOR_SCORE
    ):

        return {

            "score": None,

            "status":
                "insufficient_data",

            "reason": (
                f"Для оценки нужно "
                f"минимум "
                f"{MIN_CLICKS_FOR_SCORE} "
                f"кликов."
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

            "status":
                "no_peers",

            "reason": (
                "Недостаточно "
                "сопоставимых креативов "
                "в этой кампании."
            ),
        }

    ctr_ratio = (
        perf["ctr"]
        / baseline["ctr"]
    )

    cpc_ratio = (
        baseline["cpc"]
        / perf["avg_cpc"]
        if perf["avg_cpc"] > 0
        else 1
    )

    # ----------------------------------------
    # CTR component
    #
    # 0.5x baseline => 0
    # 1.0x baseline => 50
    # 1.5x baseline => 100
    # ----------------------------------------

    ctr_component = clamp(
        (
            50
            + (
                ctr_ratio - 1
            ) * 100
        ),
        0,
        100,
    )

    # ----------------------------------------
    # CPC component
    #
    # CPC ниже baseline => больше score
    # ----------------------------------------

    cpc_component = clamp(
        (
            50
            + (
                cpc_ratio - 1
            ) * 100
        ),
        0,
        100,
    )

    score = round(
        (
            ctr_component * 0.60
            + cpc_component * 0.40
        )
    )

    if score >= 70:

        status = "successful"

        reason = (
            "CTR/CPC лучше "
            "сопоставимых креативов."
        )

    elif score >= 45:

        status = "normal"

        reason = (
            "Результат близок "
            "к медиане кампании."
        )

    else:

        status = "weak"

        reason = (
            "Уступает сопоставимым "
            "креативам по CTR/CPC."
        )

    return {

        "score":
            int(score),

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
                baseline["ctr"],
                3,
            ),

        "baseline_cpc":
            round(
                baseline["cpc"],
                2,
            ),
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

    for perf in performances:

        key = (
            perf["campaign_id"],
            perf["network"],
            perf["kind"],
        )

        baseline = (
            baselines.get(key)
        )

        analysis = (
            analyze_performance(
                perf,
                baseline,
            )
        )

        trend = (
            calculate_trend(
                perf
            )
        )

        final_status = (
            analysis["status"]
        )

        # Trend переопределяет только
        # те ассеты, которые уже можно
        # нормально оценивать.
        if (
            final_status
            not in (
                "unattributable",
                "insufficient_data",
                "no_peers",
            )
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

            **{
                key: value
                for key, value
                in perf.items()
                if key != "daily"
            },

            **analysis,

            "status":
                final_status,

            "base_status":
                analysis["status"],

            "trend":
                trend,
        }

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

def creative_summary(
    creatives,
):

    counts = defaultdict(int)

    for creative in creatives:

        counts[
            creative["status"]
        ] += 1

    return {

        "total":
            len(creatives),

        "successful":
            counts["successful"],

        "normal":
            counts["normal"],

        "weak":
            counts["weak"],

        "fatigue":
            counts["fatigue"],

        "improving":
            counts["improving"],

        "insufficient_data":
            counts[
                "insufficient_data"
            ],

        "no_peers":
            counts["no_peers"],

        "unattributable":
            counts[
                "unattributable"
            ],
    }


# ============================================================
# TOTAL SUMMARY
# ============================================================

def total_summary(
    campaigns,
):

    impressions = sum(
        item["impressions"]
        for item in campaigns
    )

    clicks = sum(
        item["clicks"]
        for item in campaigns
    )

    spend = sum(
        item["spend"]
        for item in campaigns
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
                cpc,
                2,
            ),
    }


# ============================================================
# BUILD
# ============================================================

def build_report():

    print(
        "1/6 Campaign report",
        flush=True,
    )

    campaign_rows = (
        get_campaign_rows()
    )

    print(
        "2/6 Ad performance report",
        flush=True,
    )

    ad_rows = get_ad_rows()

    ad_ids = sorted({
        row["ad_id"]
        for row in ad_rows
    })

    print(
        "3/6 Ads.get",
        flush=True,
    )

    ads = get_ads(
        ad_ids
    )

    # ----------------------------------------
    # Ad -> visual assets
    # ----------------------------------------

    ad_asset_map = {}

    asset_registry = {}

    for ad_id, ad in (
        ads.items()
    ):

        assets = (
            extract_ad_assets(
                ad
            )
        )

        ad_asset_map[
            ad_id
        ] = assets

        for asset in assets:

            key = (
                asset["asset_key"]
            )

            if key not in (
                asset_registry
            ):

                asset_registry[
                    key
                ] = asset.copy()

    print(
        "Unique visual assets:",
        len(asset_registry),
        flush=True,
    )

    image_hashes = [
        asset["asset_id"]
        for asset
        in asset_registry.values()
        if asset["asset_key"]
        .startswith("image:")
    ]

    creative_ids = [
        asset["asset_id"]
        for asset
        in asset_registry.values()
        if asset["asset_key"]
        .startswith("creative:")
    ]

    print(
        "4/6 AdImages.get",
        flush=True,
    )

    image_meta = (
        get_adimage_metadata(
            image_hashes
        )
    )

    print(
        "5/6 Creatives.get",
        flush=True,
    )

    creative_meta = (
        get_creative_metadata(
            creative_ids
        )
    )

    print(
        "6/6 Calculate creative stats",
        flush=True,
    )

    performance = (
        build_asset_performance(
            ad_rows,
            ad_asset_map,
        )
    )

    enrich_asset_metadata(
        performance,
        asset_registry,
        image_meta,
        creative_meta,
    )

    creatives = (
        analyze_assets(
            performance
        )
    )

    campaigns = (
        aggregate_campaigns(
            campaign_rows
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
                "visual_asset_v2",

            "min_clicks":
                MIN_CLICKS_FOR_SCORE,
        },

        "summary":
            total_summary(
                campaigns
            ),

        "campaigns":
            campaigns,

        "creative_summary":
            creative_summary(
                creatives
            ),

        "creatives":
            creatives,

        "daily":
            campaign_rows,
    }

    print(
        "Creative summary:",
        report[
            "creative_summary"
        ],
        flush=True,
    )

    return report


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


def encrypt_report(
    report,
):

    plaintext = json.dumps(
        report,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")

    salt = (
        secrets.token_bytes(16)
    )

    nonce = (
        secrets.token_bytes(12)
    )

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

        "version": 2,

        "kdf":
            "PBKDF2-SHA256",

        "iterations":
            PBKDF2_ITERATIONS,

        "cipher":
            "AES-256-GCM",

        "salt":
            base64.b64encode(
                salt
            ).decode("ascii"),

        "nonce":
            base64.b64encode(
                nonce
            ).decode("ascii"),

        "ciphertext":
            base64.b64encode(
                ciphertext
            ).decode("ascii"),
    }


# ============================================================
# MAIN
# ============================================================

def main():

    report = build_report()

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
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )

    print(
        "Encrypted report saved:",
        OUT,
        flush=True,
    )


if __name__ == "__main__":
    main()
