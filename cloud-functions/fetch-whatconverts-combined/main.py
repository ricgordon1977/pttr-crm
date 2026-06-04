import functions_framework
import requests
from google.cloud import bigquery
from datetime import datetime, timedelta
import hashlib
import os
import json
import time

# ==============================
# Cloud Function Entrypoint
# ==============================

@functions_framework.http
def fetch_whatconverts_leads(request):
    project_id = os.environ.get("GCP_PROJECT") or os.environ.get("GOOGLE_CLOUD_PROJECT")
    dataset_id = "gd_WhatConverts"

    brands = [
        {
            "name": "ETTR",
            "profile_id": os.environ["WC_PROFILE_ID_ETTR"],
            "api_token": os.environ["WC_API_TOKEN_ETTR"],
            "api_secret": os.environ["WC_API_SECRET_ETTR"],
            "main_table": "ettr_leads",
            "excluded_table": "ettr_leads_excluded",
        },
        {
            "name": "PTTR",
            "profile_id": os.environ["WC_PROFILE_ID_PTTR"],
            "api_token": os.environ["WC_API_TOKEN_PTTR"],
            "api_secret": os.environ["WC_API_SECRET_PTTR"],
            "main_table": "pttr_leads",
            "excluded_table": "pttr_leads_excluded",
        },
    ]

    # Full historical pull (safe because deduped)
    start_date = datetime(2025, 11, 1)
    end_date = datetime.utcnow()

    client = bigquery.Client(project=project_id)
    results = []

    for i, cfg in enumerate(brands):
        if i > 0:
            time.sleep(60)

        print(f"\n=== {cfg['name']} ===")

        clean, excluded = fetch_leads(
            api_token=cfg["api_token"],
            api_secret=cfg["api_secret"],
            profile_id=cfg["profile_id"],
            start_date=start_date,
            end_date=end_date,
            brand=cfg["name"],
        )

        full_refresh_load(client, project_id, dataset_id, cfg["main_table"], clean)
        full_refresh_load(client, project_id, dataset_id, cfg["excluded_table"], excluded)

        results.append(f"{cfg['name']}: {len(clean)} clean / {len(excluded)} excluded")

    return " | ".join(results), 200


# ==============================
# WhatConverts Fetch Logic
# ==============================

def fetch_leads(api_token, api_secret, profile_id, start_date, end_date, brand):
    url = "https://app.whatconverts.com/api/v1/leads"
    auth = (api_token, api_secret)

    params = {
        "profile_id": profile_id,
        "start_date": start_date.strftime("%Y-%m-%d"),
        "end_date": end_date.strftime("%Y-%m-%d"),
        "page_number": 1,
        "leads_per_page": 250,
        "lead_status": "unique",     # API-level dedupe
        "duplicate": "false",        # API-level dedupe
        "order": "asc",
    }

    all_rows = []

    while True:
        resp = requests.get(url, auth=auth, params=params, timeout=30)

        if resp.status_code == 429:
            time.sleep(60)
            continue

        resp.raise_for_status()
        payload = resp.json()

        rows = payload.get("leads", [])
        if not rows:
            break

        all_rows.extend(rows)

        if params["page_number"] >= payload.get("total_pages", 1):
            break

        params["page_number"] += 1

    print(f"Fetched {len(all_rows)} raw rows")

    # Deterministic dedupe (WC-safe)
    seen = {}
    for lead in all_rows:
        key = dedupe_key(lead)
        if key not in seen:
            seen[key] = lead

    print(f"After dedupe: {len(seen)} unique rows")

    clean, excluded = [], []

    for lead in seen.values():
        profile_name = str(lead.get("profile", "")).lower()

        if brand == "PTTR" and "plumber" in profile_name:
            clean.append(normalize_lead(lead, brand))
        elif brand == "ETTR" and "electrician" in profile_name:
            clean.append(normalize_lead(lead, brand))
        else:
            excluded.append(normalize_lead(lead, brand))

    return clean, excluded


# ==============================
# Deduplication Logic
# ==============================

def dedupe_key(lead):
    """
    WC-safe uniqueness key.
    Same logical lead can appear multiple times with same lead_id.
    """
    return (
        str(lead.get("profile_id", "")),
        str(lead.get("lead_id", "")),
        lead.get("date_created", ""),
        lead.get("lead_type", ""),
    )


def lead_hash(lead):
    raw = "|".join(dedupe_key(lead))
    return hashlib.sha256(raw.encode()).hexdigest()


# ==============================
# Normalization
# ==============================

def normalize_lead(lead, brand):
    af = lead.get("additional_fields") or {}

    profile_raw = lead.get("profile")
    profile_str = json.dumps(profile_raw) if isinstance(profile_raw, dict) else str(profile_raw or "")

    return {
        "lead_hash": lead_hash(lead),
        "lead_id": str(lead.get("lead_id", "")),
        "profile_id": str(lead.get("profile_id", "")),
        "profile": profile_str,
        "brand": brand,
        "account_id": str(lead.get("account_id", "")),
        "lead_type": lead.get("lead_type", ""),
        "lead_source": lead.get("lead_source", ""),
        "lead_medium": lead.get("lead_medium", ""),
        "lead_campaign": lead.get("lead_campaign", ""),
        "lead_content": lead.get("lead_content", ""),
        "lead_keyword": lead.get("lead_keyword", ""),
        "landing_page": lead.get("landing_url", ""),
        "referring_url": lead.get("lead_url", ""),
        "lead_date": lead.get("date_created", ""),
        "last_updated": lead.get("last_updated", ""),
        "first_name": lead.get("first_name", ""),
        "last_name": lead.get("last_name", ""),
        "email": lead.get("email_address", ""),
        "phone_number": lead.get("phone_number", ""),
        "destination_number": lead.get("destination_number", ""),
        "call_length": lead.get("call_duration_seconds", 0),
        "quotable": lead.get("quotable", ""),
        "value": lead.get("quote_value", 0),
        "form_customer_name": af.get("Customer Name", ""),
        "form_customer_email": af.get("Customer Email", ""),
        "form_customer_phone": af.get("Customer Phone", ""),
        "form_customer_address": af.get("Customer Address", ""),
        "form_problem_description": af.get("Problem Description", ""),
        "recording_url": lead.get("recording", ""),
        "play_recording_url": lead.get("play_recording", ""),
    }


# ==============================
# BigQuery Load
# ==============================

def full_refresh_load(client, project_id, dataset_id, table_id, rows):
    table_ref = f"{project_id}.{dataset_id}.{table_id}"

    if not rows:
        # Just truncate if table exists, ignore if not
        try:
            client.query(f"TRUNCATE TABLE `{table_ref}`").result()
        except Exception:
            pass
        print(f"{table_id}: truncated (no data)")
        return

    job_config = bigquery.LoadJobConfig(
        write_disposition="WRITE_TRUNCATE",
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        autodetect=True,
    )

    client.load_table_from_json(rows, table_ref, job_config=job_config).result()
    print(f"{table_id}: loaded {len(rows)} rows")
