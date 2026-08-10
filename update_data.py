import os
import json
import csv
import io
import time
import base64
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


DIRECT_REPORT_URL = "https://api.direct.yandex.com/json/v501/reports"

TOKEN = os.environ["YANDEX_DIRECT_TOKEN"]
REPORT_PASSWORD = os.environ["REPORT_PASSWORD"]

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data" / "report.enc"


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


def request_campaign_report():
    today = datetime.now(timezone.utc).date()

    date_from = today - timedelta(days=60)
    date_to = today - timedelta(days=1)

    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Accept-Language": "ru",
        "processingMode": "auto",
        "returnMoneyInMicros": "false",
        "skipReportHeader": "true",
        "skipColumnHeader": "true",
        "skipReportSummary": "true",
    }

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
            "ReportName": "Marketing Radar Campaign Report",
            "ReportType": "CAMPAIGN_PERFORMANCE_REPORT",
            "DateRangeType": "CUSTOM_DATE",
            "Format": "TSV",
            "IncludeVAT": "YES",
            "IncludeDiscount": "YES",
        }
    }

    max_attempts = 20

    for attempt in range(1, max_attempts + 1):
        print(
            f"[{attempt}/{max_attempts}] "
            f"Requesting Direct report "
            f"{date_from} — {date_to}...",
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
                "Report received successfully.",
                flush=True,
            )
            return response.text, fields

        if response.status_code in (201, 202):
            retry_in = int(
                response.headers.get("retryIn", "10")
            )

            time.sleep(retry_in)
            continue

        print(
            response.text,
            flush=True,
        )

        raise RuntimeError(
            f"Direct API returned HTTP "
            f"{response.status_code}"
        )

    raise RuntimeError(
        "Report was not ready after "
        f"{max_attempts} attempts."
    )


def parse_tsv(text, fields):
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

        row = dict(zip(fields, values))

        rows.append(
            {
                "date": row.get("Date", ""),
                "campaign_id": row.get(
                    "CampaignId",
                    "",
                ),
                "campaign_name": row.get(
                    "CampaignName",
                    "",
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
            }
        )

    return rows


def aggregate_campaigns(rows):
    campaigns = {}

    for row in rows:
        cid = row["campaign_id"]

        if not cid:
            continue

        if cid not in campaigns:
            campaigns[cid] = {
                "campaign_id": cid,
                "name": row["campaign_name"],
                "impressions": 0,
                "clicks": 0,
                "spend": 0.0,
            }

        campaigns[cid]["impressions"] += (
            row["impressions"]
        )

        campaigns[cid]["clicks"] += (
            row["clicks"]
        )

        campaigns[cid]["spend"] += (
            row["cost"]
        )

    result = []

    for campaign in campaigns.values():
        impressions = campaign["impressions"]
        clicks = campaign["clicks"]
        spend = campaign["spend"]

        ctr = (
            clicks / impressions * 100
            if impressions > 0
            else 0
        )

        avg_cpc = (
            spend / clicks
            if clicks > 0
            else 0
        )

        result.append(
            {
                **campaign,
                "spend": round(spend, 2),
                "ctr": round(ctr, 2),
                "avg_cpc": round(avg_cpc, 2),
            }
        )

    result.sort(
        key=lambda x: x["spend"],
        reverse=True,
    )

    return result


def calculate_summary(campaigns):
    total_impressions = sum(
        c["impressions"]
        for c in campaigns
    )

    total_clicks = sum(
        c["clicks"]
        for c in campaigns
    )

    total_spend = sum(
        c["spend"]
        for c in campaigns
    )

    ctr = (
        total_clicks
        / total_impressions
        * 100
        if total_impressions > 0
        else 0
    )

    avg_cpc = (
        total_spend
        / total_clicks
        if total_clicks > 0
        else 0
    )

    return {
        "spend": round(total_spend, 2),
        "impressions": total_impressions,
        "clicks": total_clicks,
        "ctr": round(ctr, 2),
        "avg_cpc": round(avg_cpc, 2),
    }


def build_report():
    print(
        "Requesting Yandex Direct campaign report...",
        flush=True,
    )

    tsv, fields = request_campaign_report()

    rows = parse_tsv(
        tsv,
        fields,
    )

    campaigns = aggregate_campaigns(
        rows
    )

    summary = calculate_summary(
        campaigns
    )

    return {
        "meta": {
            "updated_at": datetime.now(
                timezone.utc
            ).isoformat(),
            "source": "yandex_direct",
            "period_days": 60,
        },
        "summary": summary,
        "campaigns": campaigns,
        "daily": rows,
    }


def derive_key(password, salt):
    return hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        250000,
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

    encrypted_payload = {
        "version": 1,
        "kdf": "PBKDF2-SHA256",
        "iterations": 250000,
        "cipher": "AES-256-GCM",
        "salt": base64.b64encode(
            salt
        ).decode("ascii"),
        "nonce": base64.b64encode(
            nonce
        ).decode("ascii"),
        "ciphertext": base64.b64encode(
            ciphertext
        ).decode("ascii"),
    }

    return encrypted_payload


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
