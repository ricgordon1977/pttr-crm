import json
from datetime import datetime, timedelta, timezone
import requests
from google.cloud import secretmanager, bigquery, storage

PROJECT_ID = "pttr-taskdata"
DATASET = "ds_crm"
TABLE = "raw_calls"
LEGS_TABLE = "raw_call_legs"
STATE_BUCKET = "pettr-8x8-state"
STATE_OBJECT = "state/last_sync.json"
LOOKBACK_DAYS = 180

BASE_URL = "https://api.8x8.com/analytics/work"

def get_secret(secret_id):
    client = secretmanager.SecretManagerServiceClient()
    name = f"projects/{PROJECT_ID}/secrets/{secret_id}/versions/latest"
    return client.access_secret_version(request={"name": name}).payload.data.decode("UTF-8")

def get_credentials():
    return {
        "api_key": get_secret("8x8-api-key"),
        "username": get_secret("8x8-username"),
        "password": get_secret("8x8-password"),
        "pbx_id": get_secret("8x8-pbx-id"),
    }

def read_last_sync():
    client = storage.Client()
    bucket = client.bucket(STATE_BUCKET)
    blob = bucket.blob(STATE_OBJECT)
    if not blob.exists():
        return datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)
    data = json.loads(blob.download_as_text())
    return datetime.fromisoformat(data["last_sync_utc"])

def write_last_sync(ts_utc):
    client = storage.Client()
    bucket = client.bucket(STATE_BUCKET)
    blob = bucket.blob(STATE_OBJECT)
    blob.upload_from_string(json.dumps({"last_sync_utc": ts_utc.isoformat()}))

def get_access_token(creds):
    url = f"{BASE_URL}/v1/oauth/token"
    headers = {
        "8x8-apikey": creds["api_key"],
        "Content-Type": "application/x-www-form-urlencoded",
    }
    data = {
        "username": creds["username"],
        "password": creds["password"],
    }
    resp = requests.post(url, headers=headers, data=data, timeout=30)
    resp.raise_for_status()
    return resp.json()["access_token"]

def fmt_dt(dt):
    return dt.strftime("%Y-%m-%d %H:%M:%S")

def parse_ts(ts_str):
    """Parse 8x8 timestamp to BigQuery-compatible UTC string."""
    if not ts_str:
        return None
    try:
        ts_str = ts_str.replace('+0000', '+00:00')
        dt = datetime.fromisoformat(ts_str)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f UTC")
    except Exception:
        return None

def fetch_paginated(access_token, api_key, endpoint, pbx_id, start_utc, end_utc):
    """Generic paginated fetch for 8x8 Analytics API."""
    url = f"{BASE_URL}{endpoint}"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "8x8-apikey": api_key,
    }
    params = {
        "pbxId": pbx_id,
        "startTime": fmt_dt(start_utc),
        "endTime": fmt_dt(end_utc),
        "timeZone": "UTC",
        "pageSize": 50,
    }
    all_records = []
    scroll_id = None
    while True:
        if scroll_id:
            params["scrollId"] = scroll_id
        resp = requests.get(url, headers=headers, params=params, timeout=60)
        resp.raise_for_status()
        body = resp.json()
        meta = body.get("meta", {})
        data = body.get("data", [])
        all_records.extend(data)
        scroll_id = meta.get("scrollId")
        if not scroll_id or scroll_id == "No Data":
            break
    return all_records

def normalise_phone(phone):
    if not phone:
        return None
    if phone.startswith('+') and not (
        phone.startswith('+61') or phone.startswith('+0061')
    ):
        return None
    digits = ''.join(c for c in phone if c.isdigit())
    if not digits or len(digits) < 8:
        return None
    if digits.startswith('61'):
        return f"+{digits}"
    if len(digits) == 10 and digits.startswith('04'):
        return f"+61{digits[1:]}"
    if len(digits) == 10 and digits.startswith('02'):
        return f"+61{digits[1:]}"
    if len(digits) == 8 and digits[0] in ('8', '9'):
        return f"+612{digits}"
    if digits.startswith('1300') or digits.startswith('1800'):
        return f"+61{digits}"
    return None

def transform_record(rec):
    caller = rec.get("caller", "")
    callee = rec.get("callee", "")
    return {
        "call_id": rec.get("callId"),
        "start_time": parse_ts(rec.get("startTime")),
        "disconnected_time": parse_ts(rec.get("disconnectedTime")),
        "direction": rec.get("direction"),
        "caller": caller,
        "caller_name": rec.get("callerName"),
        "callee": callee,
        "callee_name": rec.get("calleeName"),
        "talk_time": rec.get("talkTime"),
        "ring_duration": rec.get("ringDuration"),
        "last_leg_disposition": rec.get("lastLegDisposition"),
        "missed": str(rec.get("missed", "")),
        "abandoned": str(rec.get("abandoned", "")),
        "answered": str(rec.get("answered", "")),
        "pbx_id": rec.get("pbxId"),
        "norm_caller_phone": normalise_phone(caller),
        "norm_callee_phone": normalise_phone(callee),
        "ingested_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f UTC"),
    }

def transform_leg(rec):
    return {
        "call_id": rec.get("callId"),
        "leg_id": rec.get("legId"),
        "parent_call_id": rec.get("parentCallId"),
        "start_time": parse_ts(rec.get("startTime")),
        "disconnected_time": parse_ts(rec.get("disconnectedTime")),
        "talk_time_ms": rec.get("talkTimeMS"),
        "talk_time": rec.get("talkTime"),
        "caller": rec.get("caller", ""),
        "caller_name": rec.get("callerName", ""),
        "callee": rec.get("callee", ""),
        "callee_name": rec.get("calleeName", ""),
        "direction": rec.get("direction"),
        "missed": str(rec.get("missed", "")),
        "answered": str(rec.get("answered", "")),
        "status": rec.get("status"),
        "cause": rec.get("cause", ""),
        "caller_svc_name": rec.get("callerSvcName", ""),
        "caller_svc_type": rec.get("callerSvcType", ""),
        "pbx_id": rec.get("pbxId"),
        "ingested_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f UTC"),
    }

CALLS_SCHEMA = [
    bigquery.SchemaField("call_id", "STRING"),
    bigquery.SchemaField("start_time", "TIMESTAMP"),
    bigquery.SchemaField("disconnected_time", "TIMESTAMP"),
    bigquery.SchemaField("direction", "STRING"),
    bigquery.SchemaField("caller", "STRING"),
    bigquery.SchemaField("caller_name", "STRING"),
    bigquery.SchemaField("callee", "STRING"),
    bigquery.SchemaField("callee_name", "STRING"),
    bigquery.SchemaField("talk_time", "STRING"),
    bigquery.SchemaField("ring_duration", "INTEGER"),
    bigquery.SchemaField("last_leg_disposition", "STRING"),
    bigquery.SchemaField("missed", "STRING"),
    bigquery.SchemaField("abandoned", "STRING"),
    bigquery.SchemaField("answered", "STRING"),
    bigquery.SchemaField("pbx_id", "STRING"),
    bigquery.SchemaField("norm_caller_phone", "STRING"),
    bigquery.SchemaField("norm_callee_phone", "STRING"),
    bigquery.SchemaField("ingested_at", "TIMESTAMP"),
]

LEGS_SCHEMA = [
    bigquery.SchemaField("call_id", "STRING"),
    bigquery.SchemaField("leg_id", "STRING"),
    bigquery.SchemaField("parent_call_id", "STRING"),
    bigquery.SchemaField("start_time", "TIMESTAMP"),
    bigquery.SchemaField("disconnected_time", "TIMESTAMP"),
    bigquery.SchemaField("talk_time_ms", "INTEGER"),
    bigquery.SchemaField("talk_time", "STRING"),
    bigquery.SchemaField("caller", "STRING"),
    bigquery.SchemaField("caller_name", "STRING"),
    bigquery.SchemaField("callee", "STRING"),
    bigquery.SchemaField("callee_name", "STRING"),
    bigquery.SchemaField("direction", "STRING"),
    bigquery.SchemaField("missed", "STRING"),
    bigquery.SchemaField("answered", "STRING"),
    bigquery.SchemaField("status", "STRING"),
    bigquery.SchemaField("cause", "STRING"),
    bigquery.SchemaField("caller_svc_name", "STRING"),
    bigquery.SchemaField("caller_svc_type", "STRING"),
    bigquery.SchemaField("pbx_id", "STRING"),
    bigquery.SchemaField("ingested_at", "TIMESTAMP"),
]

def dedupe_rows(rows, key_field):
    """Remove duplicates by key field, keeping first occurrence."""
    seen = set()
    deduped = []
    for row in rows:
        k = row.get(key_field)
        if k and k not in seen:
            seen.add(k)
            deduped.append(row)
    return deduped

def load_to_bigquery(rows, table_name, schema):
    if not rows:
        print(f"No new rows for {table_name}")
        return
    bq = bigquery.Client(project=PROJECT_ID)
    table_ref = f"{PROJECT_ID}.{DATASET}.{table_name}"
    job_config = bigquery.LoadJobConfig(
        schema=schema,
        write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
    )
    job = bq.load_table_from_json(rows, table_ref, job_config=job_config)
    job.result()
    print(f"✅ Inserted {len(rows)} rows into {table_name}")

def sync_calls(request=None):
    now_utc = datetime.now(timezone.utc)
    last_sync = read_last_sync()
    print(f"Fetching calls from {last_sync.isoformat()} to {now_utc.isoformat()}")
    creds = get_credentials()
    token = get_access_token(creds)

    # Fetch call records
    records = fetch_paginated(token, creds["api_key"], "/v2/call-records", creds["pbx_id"], last_sync, now_utc)
    print(f"Fetched {len(records)} call records")
    call_rows = dedupe_rows([transform_record(r) for r in records], "call_id")
    print(f"After dedupe: {len(call_rows)} unique call records")
    load_to_bigquery(call_rows, TABLE, CALLS_SCHEMA)

    # Fetch call legs
    legs = fetch_paginated(token, creds["api_key"], "/v2/call-legs", creds["pbx_id"], last_sync, now_utc)
    print(f"Fetched {len(legs)} call legs")
    leg_rows = [transform_leg(l) for l in legs]
    # Dedupe legs by call_id + leg_id composite key
    seen_legs = set()
    deduped_legs = []
    for row in leg_rows:
        key = f"{row['call_id']}-{row['leg_id']}"
        if key not in seen_legs:
            seen_legs.add(key)
            deduped_legs.append(row)
    print(f"After dedupe: {len(deduped_legs)} unique call legs")
    load_to_bigquery(deduped_legs, LEGS_TABLE, LEGS_SCHEMA)

    write_last_sync(now_utc)
    return f"Synced {len(call_rows)} calls + {len(leg_rows)} legs from {last_sync.isoformat()} to {now_utc.isoformat()}", 200

if __name__ == "__main__":
    print(sync_calls())
