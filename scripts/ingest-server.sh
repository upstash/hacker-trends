#!/usr/bin/env bash
#
# Self-contained Hacker News -> Upstash Redis ingester.
#
# Downloads the open-index/hacker-news monthly Parquet archive from HuggingFace
# and HSETs every eligible item into an Upstash Redis DB, creating the `hn`
# search index first. Reproduces scripts/ingest.ts exactly (same field mapping,
# HTML cleaning, index schema) but with zero JS/Node dependency - it only needs
# python3 (it builds its own venv and pip-installs pyarrow).
#
# Usage:
#   export UPSTASH_REDIS_REST_URL="https://<db>.upstash.io"
#   export UPSTASH_REDIS_REST_TOKEN="<token>"
#   bash ingest-server.sh                  # full archive (2006-10 .. latest)
#   bash ingest-server.sh 2020 2026        # only years 2020..2026
#
# Optional env:
#   DATA_DIR        scratch dir for venv + parquet (default ./hn-ingest-tmp)
#   CONCURRENCY     parallel pipeline requests (default 64)
#   BATCH_SIZE      HSETs per pipeline request (default 1000)
#   KEEP_PARQUET    1 = keep downloaded parquet files (default 0 = delete after each month)
#
set -euo pipefail

: "${UPSTASH_REDIS_REST_URL:?set UPSTASH_REDIS_REST_URL}"
: "${UPSTASH_REDIS_REST_TOKEN:?set UPSTASH_REDIS_REST_TOKEN}"

DATA_DIR="${DATA_DIR:-$PWD/hn-ingest-tmp}"
CONCURRENCY="${CONCURRENCY:-64}"
BATCH_SIZE="${BATCH_SIZE:-1000}"
KEEP_PARQUET="${KEEP_PARQUET:-0}"
YEAR_FROM="${1:-0}"
YEAR_TO="${2:-9999}"

mkdir -p "$DATA_DIR"
VENV="$DATA_DIR/venv"

# --- bootstrap an isolated python env with pyarrow ----------------------------
if [ ! -x "$VENV/bin/python" ]; then
  echo "[setup] creating venv at $VENV"
  python3 -m venv "$VENV"
fi
"$VENV/bin/python" -c "import pyarrow" 2>/dev/null || {
  echo "[setup] installing pyarrow"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet pyarrow
}

export UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN
export DATA_DIR CONCURRENCY BATCH_SIZE KEEP_PARQUET YEAR_FROM YEAR_TO

# --- everything below runs in the venv python --------------------------------
"$VENV/bin/python" - <<'PY'
import json, os, re, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import datetime as dt
import pyarrow.parquet as pq
import pyarrow as pa

URL   = os.environ["UPSTASH_REDIS_REST_URL"].rstrip("/")
TOKEN = os.environ["UPSTASH_REDIS_REST_TOKEN"]
DATA_DIR    = os.environ["DATA_DIR"]
CONCURRENCY = int(os.environ["CONCURRENCY"])
BATCH_SIZE  = int(os.environ["BATCH_SIZE"])
KEEP        = os.environ["KEEP_PARQUET"] == "1"
YEAR_FROM   = int(os.environ["YEAR_FROM"])
YEAR_TO     = int(os.environ["YEAR_TO"])

REPO = "open-index/hacker-news"
API  = f"https://huggingface.co/api/datasets/{REPO}/tree/main/data?recursive=true"
RESOLVE = f"https://huggingface.co/datasets/{REPO}/resolve/main"

HDRS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
TYPE_NAMES = ["", "story", "comment", "poll", "pollopt", "job"]
TEXT_MAX = 1500
HTML_ENTITY = {"amp":"&","lt":"<","gt":">","quot":'"',"apos":"'","#39":"'","#x27":"'","nbsp":" "}

# ---- HTTP helpers ------------------------------------------------------------
def _post(path, payload, timeout=60):
    req = urllib.request.Request(URL + path, data=json.dumps(payload).encode(),
                                 headers=HDRS, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())

def _get_json(u, timeout=60):
    req = urllib.request.Request(u, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())

TRANSIENT = ("timed out", "ETIMEDOUT", "ECONNRESET", "aborted", "reset",
             "Connection", "temporarily", "Remote end")

def flush(commands):
    """POST a pipeline batch, retrying transient/5xx/429 with backoff."""
    if not commands:
        return
    attempt = 0
    while True:
        try:
            res = _post("/pipeline", commands)
            for item in res:
                if isinstance(item, dict) and item.get("error"):
                    raise RuntimeError("pipeline error: " + item["error"])
            return
        except Exception as e:
            msg = str(e)
            status = getattr(e, "code", None)
            transient = (status in (429, 500, 502, 503, 504)
                         or any(t in msg for t in TRANSIENT))
            attempt += 1
            if not transient or attempt > 5:
                raise
            delay = min(15, 0.5 * (2 ** attempt))
            print(f"  flush retry {attempt} after {delay:.1f}s ({msg[:80]})", flush=True)
            time.sleep(delay)

# ---- create index (idempotent), exact command from @upstash/redis ------------
def ensure_index():
    cmd = ["SEARCH.CREATE","hn","ON","HASH","PREFIX","1","hn:","SCHEMA",
           "title","TEXT","text","TEXT","by","KEYWORD","type","KEYWORD",
           "time","DATE","FAST","score","F64","FAST","ndesc","F64","FAST",
           "parent","F64","FAST"]
    try:
        _post("/", cmd)
        print('index "hn" created')
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        if "already exists" in body.lower():
            print('index "hn" already exists, skipping create')
        else:
            raise RuntimeError(f"create index failed {e.code}: {body[:300]}")

# ---- text cleaning (mirrors cleanText in ingest.ts) --------------------------
_TAG_INLINE = re.compile(r"</?(p|br|div|span|li|ul|ol|pre|code|i|em|b|strong)[^>]*>", re.I)
_TAG_A      = re.compile(r"<a [^>]*>([^<]*)</a>", re.I)
_TAG_ANY    = re.compile(r"<[^>]+>")
_ENT        = re.compile(r"&([a-zA-Z]+|#x?[0-9a-fA-F]+);")
_WS         = re.compile(r"\s+")

def clean_text(s):
    if not s:
        return ""
    out = _TAG_INLINE.sub(" ", s)
    out = _TAG_A.sub(r" \1 ", out)
    out = _TAG_ANY.sub(" ", out)
    out = _ENT.sub(lambda m: HTML_ENTITY.get(m.group(1), " "), out)
    out = _WS.sub(" ", out).strip()
    if len(out) > TEXT_MAX:
        out = out[:TEXT_MAX]
    return out

def iso(ms):
    sec, msec = divmod(int(ms), 1000)
    d = dt.datetime.fromtimestamp(sec, dt.timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{msec:03d}Z"

def row_to_hash(r):
    if r["deleted"] or r["dead"]:
        return None
    t = r["type"]
    name = TYPE_NAMES[t] if 0 <= t < len(TYPE_NAMES) else ""
    if not name or name == "pollopt":
        return None
    by = r["by"]
    if not by:
        return None
    tm = r["time"]
    if tm is None or tm < 1157000000000:
        return None
    if name in ("story", "job", "poll"):
        title = r["title"]
        if not title:
            return None
        h = {"id": r["id"], "title": title, "by": by, "type": name,
             "time": iso(tm), "score": r["score"] if r["score"] is not None else 1,
             "ndesc": r["descendants"] if r["descendants"] is not None else 0,
             "parent": 0}
        if r["text"]:
            txt = clean_text(r["text"])
            if txt:
                h["text"] = txt
        if r["url"]:
            h["url"] = r["url"]
        return h
    # comment
    if not r["text"]:
        return None
    txt = clean_text(r["text"])
    if len(txt) < 12:
        return None
    return {"id": r["id"], "title": "", "text": txt, "by": by, "type": name,
            "time": iso(tm), "score": 0, "ndesc": 0,
            "parent": r["parent"] if r["parent"] is not None else 0}

COLS = ["id","type","by","time","title","text","url","score","descendants","parent","deleted","dead"]

def download(path, dest):
    for attempt in range(1, 6):
        try:
            req = urllib.request.Request(f"{RESOLVE}/{path}")
            with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
            return True
        except Exception as e:
            print(f"  download retry {attempt} ({str(e)[:80]})", flush=True)
            time.sleep(2 * attempt)
    return False

def ingest_month(path):
    local = os.path.join(DATA_DIR, os.path.basename(path))
    t0 = time.time()
    if not (os.path.exists(local) and os.path.getsize(local) > 0):
        if not download(path, local):
            print(f"[{path}] DOWNLOAD FAILED, skipping", flush=True)
            return 0, 0
    pf = pq.ParquetFile(local)
    written = skipped = 0
    pending = []
    futures = set()
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
        def submit(batch):
            nonlocal futures
            while len(futures) >= CONCURRENCY:
                done, futures = wait(futures, return_when=FIRST_COMPLETED)
                for d in done:
                    d.result()
            futures.add(ex.submit(flush, batch))
        for batch in pf.iter_batches(batch_size=50000, columns=COLS):
            # cast time (timestamp[ms]) -> int64 epoch ms to match ingest.ts
            cols = {c: batch.column(c) for c in COLS}
            cols["time"] = cols["time"].cast(pa.int64())
            rows = pa.table(cols).to_pylist()
            for r in rows:
                h = row_to_hash(r)
                if not h:
                    skipped += 1
                    continue
                cmd = ["HSET", f"hn:{h['id']}"]
                for k, v in h.items():
                    cmd.append(k); cmd.append(str(v))
                pending.append(cmd)
                written += 1
                if len(pending) >= BATCH_SIZE:
                    submit(pending); pending = []
        if pending:
            submit(pending)
        for f in as_completed_all(futures):
            f.result()
    if not KEEP:
        try: os.remove(local)
        except OSError: pass
    el = time.time() - t0
    rate = written / el if el else 0
    print(f"[{path}] DONE written={written:,} skipped={skipped:,} in {el:.1f}s ({rate:.0f}/s)", flush=True)
    return written, skipped

def as_completed_all(futures):
    # drain remaining futures
    pending = set(futures)
    while pending:
        done, pending = wait(pending, return_when=FIRST_COMPLETED)
        for d in done:
            yield d

def main():
    print(f"target: {URL}  concurrency={CONCURRENCY} batch={BATCH_SIZE}", flush=True)
    ensure_index()
    tree = _get_json(API)
    files = sorted(x["path"] for x in tree
                   if x["type"] == "file" and x["path"].endswith(".parquet"))
    def yr(p):  # data/YYYY/YYYY-MM.parquet
        return int(p.split("/")[1])
    files = [p for p in files if YEAR_FROM <= yr(p) <= YEAR_TO]
    print(f"{len(files)} monthly files to ingest", flush=True)
    tw = ts = 0
    t0 = time.time()
    for p in files:
        w, s = ingest_month(p)
        tw += w; ts += s
    el = time.time() - t0
    print(f"\nALL DONE: written={tw:,} skipped={ts:,} in {el/60:.1f}min "
          f"(avg {tw/el if el else 0:.0f}/s)", flush=True)

if __name__ == "__main__":
    main()
PY
