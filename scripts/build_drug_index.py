#!/usr/bin/env python3
"""
SurviveV1 — Offline drug reference indexer.

Parses the openFDA drug-label partitions downloaded to $STORAGE/drugs/raw/
(*.json.zip) into an SQLite FTS5 database at $STORAGE/.drug_index.db, so the
dashboard can answer "what is this pill / what treats this symptom / can these
two be taken together" with NO internet. openFDA data is US-government public
domain.

Standalone by design (like index_documents.py): importing web/server.py would
start its Flask app and background threads. Runs at lowest CPU priority.

Memory note: each partition is one ~120 MB JSON object; json.load of one peaks
~1 GB RAM, fine on a 16 GB Pi — but process ONE partition at a time, never all
14 at once.

Dedup note: openFDA carries hundreds of near-identical labels per drug (every
repackager files one). We keep a single row per (generic, brand), choosing the
newest effective_time, which collapses ~262k raw labels to a far smaller set.

Usage:
    python3 scripts/build_drug_index.py [--storage /mnt/survive]
"""

import argparse
import json
import os
import re
import sqlite3
import zipfile
from pathlib import Path

FIELD_CAP = 50_000  # some labels embed entire monographs; cap each stored field


def default_storage() -> str:
    """SURVIVE_STORAGE_PATH env wins; then survive.conf; then /mnt/survive."""
    env = os.environ.get("SURVIVE_STORAGE_PATH")
    if env:
        return env
    conf = Path(__file__).resolve().parent.parent / "config" / "survive.conf"
    try:
        for line in conf.read_text().splitlines():
            m = re.match(r'\s*SURVIVE_STORAGE_PATH="?([^"#]+)"?\s*$', line)
            if m:
                return m.group(1).strip()
    except OSError:
        pass
    return "/mnt/survive"


def _joined(value) -> str:
    """openFDA fields are arrays of strings; join and cap them."""
    if not value:
        return ""
    if isinstance(value, list):
        text = "\n".join(str(v) for v in value)
    else:
        text = str(value)
    return re.sub(r"[ \t]+", " ", text).strip()[:FIELD_CAP]


def _first(openfda: dict, key: str) -> str:
    val = openfda.get(key)
    if isinstance(val, list) and val:
        return str(val[0]).strip()
    return str(val).strip() if val else ""


def _create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE drugs (
            id INTEGER PRIMARY KEY,
            brand_name TEXT, generic_name TEXT, active_ingredient TEXT,
            purpose TEXT, indications TEXT, warnings TEXT, dosage TEXT,
            contraindications TEXT, interactions TEXT,
            otc_or_rx TEXT, effective_time TEXT
        );
        -- External-content FTS5 tables (content=drugs) avoid duplicating the
        -- text. drug_names powers by-drug search; drug_uses by-symptom.
        CREATE VIRTUAL TABLE drug_names USING fts5(
            brand_name, generic_name, active_ingredient,
            content='drugs', content_rowid='id');
        CREATE VIRTUAL TABLE drug_uses USING fts5(
            purpose, indications,
            content='drugs', content_rowid='id');
        """
    )


def build(storage: str) -> int:
    raw_dir = Path(storage) / "drugs" / "raw"
    parts = sorted(raw_dir.glob("*.json.zip")) if raw_dir.exists() else []
    if not parts:
        print(f"[DRUGS] No partitions in {raw_dir} — run download/drug_reference.sh")
        return 0

    db_path = Path(storage) / ".drug_index.db"
    tmp_path = db_path.with_suffix(".db.new")
    tmp_path.unlink(missing_ok=True)

    conn = sqlite3.connect(str(tmp_path))
    _create_schema(conn)

    # Dedup: newest effective_time wins per (generic, brand).
    best: dict = {}      # key -> (effective_time, record_dict)
    seen = 0
    for part in parts:
        print(f"[DRUGS] Reading {part.name} ...")
        try:
            with zipfile.ZipFile(part) as z:
                data = json.loads(z.read(z.namelist()[0]))
        except (zipfile.BadZipFile, json.JSONDecodeError, OSError, KeyError) as exc:
            print(f"[DRUGS]   skipped ({exc})")
            continue
        for rec in data.get("results", []):
            seen += 1
            ofda = rec.get("openfda", {}) or {}
            generic = _first(ofda, "generic_name")
            brand = _first(ofda, "brand_name")
            if not (generic or brand):
                continue
            key = (generic.lower(), brand.lower())
            eff = str(rec.get("effective_time", "") or "")
            if key in best and best[key][0] >= eff:
                continue
            best[key] = (eff, {
                "brand_name": brand,
                "generic_name": generic,
                "active_ingredient": _joined(rec.get("active_ingredient")),
                "purpose": _joined(rec.get("purpose")),
                "indications": _joined(rec.get("indications_and_usage")),
                "warnings": _joined(rec.get("warnings")),
                "dosage": _joined(rec.get("dosage_and_administration")),
                "contraindications": _joined(rec.get("contraindications")),
                "interactions": _joined(rec.get("drug_interactions")),
                "otc_or_rx": _first(ofda, "product_type"),
                "effective_time": eff,
            })
        del data  # free the ~1 GB partition before loading the next

    print(f"[DRUGS] {seen} labels -> {len(best)} unique drugs; writing index...")
    cols = ("brand_name", "generic_name", "active_ingredient", "purpose",
            "indications", "warnings", "dosage", "contraindications",
            "interactions", "otc_or_rx", "effective_time")
    placeholders = ",".join("?" for _ in cols)
    conn.executemany(
        f"INSERT INTO drugs ({','.join(cols)}) VALUES ({placeholders})",
        [tuple(rec[c] for c in cols) for _, rec in best.values()],
    )
    # Populate the external-content FTS tables from the base table.
    conn.execute(
        "INSERT INTO drug_names(rowid, brand_name, generic_name, active_ingredient) "
        "SELECT id, brand_name, generic_name, active_ingredient FROM drugs")
    conn.execute(
        "INSERT INTO drug_uses(rowid, purpose, indications) "
        "SELECT id, purpose, indications FROM drugs")
    conn.commit()
    conn.close()

    # Atomic swap so the dashboard never reads a half-built DB.
    os.replace(tmp_path, db_path)
    print(f"[DRUGS] Done: {db_path} ({db_path.stat().st_size // (1024*1024)} MB)")
    return len(best)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the offline drug index.")
    parser.add_argument("--storage", default=default_storage())
    args = parser.parse_args()
    try:
        os.nice(19)
    except (AttributeError, OSError):
        pass
    build(args.storage)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
