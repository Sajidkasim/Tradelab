"""Tenant-isolated semantic memory for Primax using Cloudflare Workers AI BGE embeddings.

Stores compact L2-normalized vectors in each workspace's private `settings` table
(reusing existing COACH_CLOUDFLARE_ACCOUNT_ID / COACH_CLOUDFLARE_API_TOKEN credentials
within Cloudflare Workers AI's free tier). Falls back gracefully to fast lexical recall
when Cloudflare Workers AI is not configured or temporarily unreachable.
"""
from __future__ import annotations

from hashlib import sha256
import math
import os
import re

import requests

from . import daily_journal

KEY = "primus_primax_mem_v1"
EMBED_MODEL = "@cf/baai/bge-small-en-v1.5"
MAX_ENTRIES = 400
MAX_BATCH_EMBED = 16
MAX_SNIPPET_CHARS = 720

_STOPWORDS = frozenset({
    "a", "about", "all", "am", "an", "and", "any", "are", "as", "at", "be",
    "been", "before", "but", "by", "can", "could", "did", "do", "does", "for",
    "from", "had", "has", "have", "how", "i", "if", "in", "into", "is", "it",
    "its", "just", "last", "me", "more", "most", "my", "no", "not", "of", "on",
    "or", "our", "out", "over", "past", "really", "should", "so", "some",
    "still", "than", "that", "the", "their", "them", "then", "there", "these",
    "they", "this", "time", "times", "to", "today", "up", "was", "we", "were",
    "what", "when", "where", "which", "who", "why", "will", "with", "would",
    "wrote", "you", "your",
})
_TOKEN_RE = re.compile(r"[a-z0-9]{2,}")


def _cloudflare_creds() -> tuple[str, str] | None:
    if os.getenv("COACH_PROVIDER", "cloudflare").strip().lower() == "gemini":
        return None
    account_id = os.getenv("COACH_CLOUDFLARE_ACCOUNT_ID", "").strip()
    token = os.getenv("COACH_CLOUDFLARE_API_TOKEN", "").strip()
    if not re.fullmatch(r"[a-fA-F0-9]{32}", account_id) or not token:
        return None
    return account_id, token


def _normalize(vec: list[float]) -> list[float] | None:
    if not isinstance(vec, list) or not vec:
        return None
    try:
        nums = [float(v) for v in vec]
    except (TypeError, ValueError):
        return None
    norm = math.sqrt(sum(v * v for v in nums))
    if not math.isfinite(norm) or norm <= 0:
        return None
    return [round(v / norm, 4) for v in nums]


def _embed_texts(texts: list[str]) -> list[list[float]] | None:
    if not texts:
        return []
    creds = _cloudflare_creds()
    if not creds:
        return None
    account_id, token = creds
    model = os.getenv("COACH_CLOUDFLARE_EMBED_MODEL", "").strip() or EMBED_MODEL
    try:
        response = requests.post(
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}",
            headers={"Authorization": f"Bearer {token}"},
            json={"text": [t[:MAX_SNIPPET_CHARS] for t in texts]},
            timeout=(3, 8),
            allow_redirects=False,
        )
        if not response.ok:
            return None
        payload = response.json()
    except (requests.RequestException, ValueError):
        return None
    if not isinstance(payload, dict) or payload.get("success") is False:
        return None
    result = payload.get("result", payload)
    raw = result.get("data") if isinstance(result, dict) else None
    if not isinstance(raw, list) or len(raw) != len(texts):
        return None
    vectors = []
    for item in raw:
        vec = _normalize(item)
        if vec is None:
            return None
        vectors.append(vec)
    return vectors


def entry_text(entry: dict) -> str:
    """Render one saved Journal day into a compact searchable text summary."""
    if not isinstance(entry, dict) or entry.get("deleted_at"):
        return ""
    day = str(entry.get("day") or "").strip()
    parts = []
    mindset = str(entry.get("mindset") or "").strip()
    if mindset and mindset != "Not set":
        parts.append(f"Mindset: {mindset}")
    plan_followed = str(entry.get("plan_followed") or "").strip()
    if plan_followed:
        parts.append(f"Plan followed: {plan_followed}")
    for label, field, limit in (
        ("Plan", "plan", 180),
        ("Notes", "notes", 220),
        ("Lesson", "lesson", 220),
    ):
        value = " ".join(str(entry.get(field) or "").split())
        if value:
            parts.append(f"{label}: {value[:limit]}")
    trade_bits = []
    for trade in (entry.get("trades") or [])[:5]:
        if not isinstance(trade, dict):
            continue
        bits = [
            str(trade.get("symbol") or "").strip(),
            str(trade.get("direction") or "").strip(),
            str(trade.get("strategy") or "").strip(),
            str(trade.get("outcome") or "").strip(),
        ]
        confs = [str(c).strip() for c in (trade.get("confirmations") or []) if str(c).strip()]
        if confs:
            bits.append(" ".join(confs[:4]))
        note = " ".join(str(trade.get("notes") or "").split())[:100]
        if note:
            bits.append(note)
        summary = " ".join(b for b in bits if b)
        if summary:
            trade_bits.append(summary)
    if trade_bits:
        parts.append("Trades: " + "; ".join(trade_bits))
    if not parts:
        return ""
    prefix = f"Date: {day} | " if day else ""
    return (prefix + " | ".join(parts))[:MAX_SNIPPET_CHARS]


def entry_preview(entry: dict) -> str:
    """Short human-readable snippet for Primax memory chips."""
    for field in ("lesson", "notes", "plan"):
        text = " ".join(str(entry.get(field) or "").split())
        if text:
            return text[:72] + ("…" if len(text) > 72 else "")
    for trade in (entry.get("trades") or []):
        if not isinstance(trade, dict):
            continue
        note = " ".join(str(trade.get("notes") or "").split())
        if note:
            return note[:72] + ("…" if len(note) > 72 else "")
        head = " ".join(str(trade.get(k) or "").strip() for k in ("symbol", "direction", "strategy") if trade.get(k))
        if head:
            return head[:72]
    mindset = str(entry.get("mindset") or "").strip()
    return mindset if mindset and mindset != "Not set" else "Saved Journal entry"


def _content_hash(text: str) -> str:
    return sha256(text.encode("utf-8")).hexdigest()[:12]


def _tokens(text: str) -> set[str]:
    words = {tok for tok in _TOKEN_RE.findall(text.lower()) if tok not in _STOPWORDS}
    return words


def _lexical_score(query_tokens: set[str], doc_tokens: set[str]) -> float:
    if not query_tokens or not doc_tokens:
        return 0.0
    hits = 0.0
    for q in query_tokens:
        if q in doc_tokens:
            hits += 1.0
        elif len(q) >= 4 and any(d.startswith(q[:4]) or q.startswith(d[:4]) for d in doc_tokens if len(d) >= 4):
            hits += 0.6
    return min(1.0, hits / max(1.0, len(query_tokens)))


def _cosine(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return 0.0
    return sum(x * y for x, y in zip(a, b))


def _load_index(database) -> dict:
    stored = database.get_setting(KEY, {})
    items = stored.get("items") if isinstance(stored, dict) else None
    return dict(items) if isinstance(items, dict) else {}


def _save_index(database, items: dict) -> None:
    if len(items) > MAX_ENTRIES:
        keep = sorted(items.keys(), reverse=True)[:MAX_ENTRIES]
        items = {k: items[k] for k in keep}
    database.set_setting(KEY, {"model": EMBED_MODEL, "items": items})


def remove_day(database, day: str) -> None:
    """Drop a deleted day from the cached embedding index."""
    items = _load_index(database)
    if day in items:
        items.pop(day, None)
        _save_index(database, items)


def without_days(database, days):
    items = _load_index(database)
    remaining = {day: item for day, item in items.items() if day not in days}
    if len(remaining) != len(items):
        return {KEY: {"model": EMBED_MODEL, "items": remaining}}
    return {}


def prepare_day(database, entry: dict) -> tuple[str, str, str] | None:
    """Return (day, digest, text) if this entry needs embedding, or None if already indexed/empty."""
    day = str((entry or {}).get("day") or "").strip()
    if not day:
        return None
    text = entry_text(entry)
    items = _load_index(database)
    if not text:
        if day in items:
            items.pop(day, None)
            _save_index(database, items)
        return None
    digest = _content_hash(text)
    existing = items.get(day)
    if isinstance(existing, dict) and existing.get("h") == digest and isinstance(existing.get("v"), list):
        return None
    return day, digest, text


def embed_text(text: str) -> list[float] | None:
    """Embed a single text snippet via Cloudflare Workers AI (safe outside locks)."""
    vectors = _embed_texts([text])
    return vectors[0] if vectors else None


def store_vector(database, day: str, digest: str, vector: list[float]) -> None:
    items = _load_index(database)
    items[day] = {"h": digest, "v": vector}
    _save_index(database, items)


def sync_day(database, entry: dict) -> None:
    """Best-effort embed and cache one saved Journal entry; never raises."""
    pending = prepare_day(database, entry)
    if not pending:
        return
    day, digest, text = pending
    vector = embed_text(text)
    if vector is not None:
        store_vector(database, day, digest, vector)


def recall(database, query: str, *, exclude_day: str | None = None, limit: int = 4) -> list[dict]:
    """Retrieve the most relevant past Journal days for Primax using BGE embeddings + lexical boost."""
    cleaned_query = " ".join(str(query or "").split())
    if not cleaned_query:
        return []
    raw_entries = database.settings_with_prefix(daily_journal.PREFIX)
    candidates = []
    for row in raw_entries.values():
        if not isinstance(row, dict) or row.get("deleted_at"):
            continue
        day = str(row.get("day") or "").strip()
        if not day or day == exclude_day:
            continue
        text = entry_text(row)
        if not text:
            continue
        candidates.append((day, row, text, _content_hash(text)))
    if not candidates:
        return []
    candidates.sort(key=lambda item: item[0], reverse=True)
    candidates = candidates[:MAX_ENTRIES]

    index = _load_index(database)
    stale = [
        (day, text, digest)
        for day, _row, text, digest in candidates
        if not (isinstance(index.get(day), dict) and index[day].get("h") == digest and isinstance(index[day].get("v"), list))
    ]

    query_vec = None
    if _cloudflare_creds():
        batch_items = stale[:MAX_BATCH_EMBED]
        batch_texts = [cleaned_query] + [text for _day, text, _digest in batch_items]
        vectors = _embed_texts(batch_texts)
        if vectors and len(vectors) == len(batch_texts):
            query_vec = vectors[0]
            if batch_items:
                for (day, _text, digest), vec in zip(batch_items, vectors[1:]):
                    index[day] = {"h": digest, "v": vec}
                valid_days = {day for day, *_ in candidates}
                pruned = {k: v for k, v in index.items() if k in valid_days or k == exclude_day}
                try:
                    _save_index(database, pruned)
                except Exception:
                    pass

    query_tokens = _tokens(cleaned_query)
    scored = []
    for rank, (day, row, text, digest) in enumerate(candidates):
        lex = _lexical_score(query_tokens, _tokens(text))
        cached = index.get(day)
        vec = cached.get("v") if isinstance(cached, dict) and cached.get("h") == digest else None
        if query_vec is not None and isinstance(vec, list):
            sim = max(0.0, _cosine(query_vec, vec))
            score = 0.78 * sim + 0.22 * lex
            threshold = 0.24
        else:
            score = lex
            threshold = 0.14
        if score >= threshold:
            # Tiny recency tie-breaker so equally relevant memories prefer more recent lessons.
            recency_bonus = max(0.0, 0.015 * (1.0 - rank / max(1, len(candidates))))
            scored.append((score + recency_bonus, day, row, text, round(score, 3)))

    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    results = []
    for _total, day, row, text, score in scored[:limit]:
        mindset = str(row.get("mindset") or "").strip()
        results.append({
            "day": day,
            "mindset": mindset if mindset and mindset != "Not set" else "",
            "plan_followed": row.get("plan_followed"),
            "preview": entry_preview(row),
            "snippet": text,
            "score": score,
        })
    return results
