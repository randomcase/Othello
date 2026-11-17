#!/usr/bin/env python3
"""Validate Othello Liturgical Commune lore + codex registries and compile artifacts."""

from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "data" / "liturgical_lore.json"
ORDERS_CSV_PATH = ROOT / "data" / "orders_and_houses.csv"
PERSONAE_CSV_PATH = ROOT / "data" / "dramatis_personae.csv"
CALENDAR_CSV_PATH = ROOT / "data" / "liturgical_calendar.csv"
CHARTER_MD_PATH = ROOT / "lore" / "01_world_charter.md"
COMMUNE_MD_PATH = ROOT / "lore" / "02_liturgical_commune.md"
SUITE_PATH = ROOT / "config" / "google-suite.json"
SCHEMA_PATH = ROOT / "config" / "lore.schema.json"
ANTHOLOGY_PATH = ROOT / "lore" / "03_canon_anthology.md"
SITE_DATA_PATH = ROOT / "site" / "lore-data.js"
ASSETS_DIR = ROOT / "assets"
SITE_ASSETS_DIR = ROOT / "site" / "assets"

LORE_ID_RE = re.compile(r"^LC-[0-9]{3,}$")

EXPECTED_CSV_COLUMNS = {
    "orders_and_houses.csv": [
        "Order_ID",
        "Name",
        "Role_In_Commune",
        "Canonical_Hour",
        "Cloister_Seat",
        "Governing_Vow",
        "Liturgical_Symbol",
        "Standing",
    ],
    "dramatis_personae.csv": [
        "Character_ID",
        "Name",
        "Office_Or_Title",
        "House_Or_Order",
        "Vow_Tier",
        "Public_Virtue",
        "Private_Schism",
        "Status",
    ],
    "liturgical_calendar.csv": [
        "Hour_Or_Season",
        "Cycle_Type",
        "Bell_Toll",
        "Communal_Observance",
        "Permitted_Speech",
        "Presiding_Order",
    ],
}


def load_schema_enums() -> tuple[set[str], set[str], set[str]]:
    """Load allowed enum values from config/lore.schema.json."""
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    props = schema["properties"]
    return (
        set(props["liturgical_category"]["enum"]),
        set(props["canonical_hour_or_season"]["enum"]),
        set(props["synod_status"]["enum"]),
    )


def load_and_validate_csv(path: Path, expected_cols: list[str], errors: list[str]) -> list[dict[str, str]]:
    """Read a UTF-8 CSV table and validate header columns and row count."""
    if not path.exists():
        errors.append(f"Missing required CSV registry: {path.relative_to(ROOT)}")
        return []

    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        fieldnames = reader.fieldnames or []
        missing_cols = [col for col in expected_cols if col not in fieldnames]
        if missing_cols:
            errors.append(
                f"{path.relative_to(ROOT)}: missing expected columns ({', '.join(missing_cols)})."
            )
            return []
        rows = [
            {col: (row.get(col) or "").strip() for col in fieldnames}
            for row in reader
            if any((val or "").strip() for val in row.values())
        ]

    if not rows:
        errors.append(f"{path.relative_to(ROOT)}: must contain at least one data row.")
    return rows


def validate_suite_privacy(raw_suite_text: str, suite: dict, errors: list[str]) -> dict:
    """Reject personal Gmail addresses and strip any lingering 'account' field."""
    if "@gmail.com" in raw_suite_text.lower():
        errors.append(
            "config/google-suite.json: personal '@gmail.com' address detected; remove PII before publishing."
        )
    sanitized = dict(suite)
    if "account" in sanitized:
        errors.append("config/google-suite.json: remove 'account' key for public repository hygiene.")
        sanitized.pop("account", None)
    return sanitized


def validate_entries(entries: list[dict]) -> list[str]:
    """Validate every lore record against required fields, enums, and unique IDs."""
    errors: list[str] = []
    if not isinstance(entries, list):
        return ["data/liturgical_lore.json must contain a JSON array."]

    categories, hours, statuses = load_schema_enums()
    required_fields = [
        "lore_id",
        "submitted_at",
        "scribe_or_order",
        "title",
        "liturgical_category",
        "canonical_hour_or_season",
        "commune_house_or_choir",
        "epigraph_or_antiphon",
        "lore_body",
        "cross_references",
        "synod_status",
    ]
    seen_ids: set[str] = set()

    for idx, entry in enumerate(entries):
        label = f"Entry[{idx}] ({entry.get('lore_id', 'missing-id')})"
        if not isinstance(entry, dict):
            errors.append(f"{label}: expected JSON object.")
            continue

        for field in required_fields:
            if field not in entry:
                errors.append(f"{label}: missing required field '{field}'.")

        lore_id = str(entry.get("lore_id", ""))
        if not LORE_ID_RE.match(lore_id):
            errors.append(f"{label}: invalid lore_id '{lore_id}' (expected LC-NNN).")
        elif lore_id in seen_ids:
            errors.append(f"{label}: duplicate lore_id '{lore_id}'.")
        seen_ids.add(lore_id)

        for non_empty in ("scribe_or_order", "title", "lore_body"):
            if not str(entry.get(non_empty, "")).strip():
                errors.append(f"{label}: '{non_empty}' cannot be blank.")

        if entry.get("liturgical_category") not in categories:
            errors.append(
                f"{label}: invalid liturgical_category '{entry.get('liturgical_category')}'."
            )
        if entry.get("canonical_hour_or_season") not in hours:
            errors.append(
                f"{label}: invalid canonical_hour_or_season '{entry.get('canonical_hour_or_season')}'."
            )
        if entry.get("synod_status") not in statuses:
            errors.append(f"{label}: invalid synod_status '{entry.get('synod_status')}'.")

    return errors


def render_anthology(entries: list[dict]) -> str:
    """Compile lore entries into Google-Docs-safe Markdown (no raw $ math or file:/// links)."""
    lines = [
        "# Canonized & Pending Lore Anthology",
        "",
        "*Compiled from `data/liturgical_lore.json` by `scripts/validate_lore.py`.*",
        "",
    ]
    for i, entry in enumerate(entries):
        if i > 0:
            lines.extend(["---", ""])
        lines.extend(
            [
                f"## {entry['lore_id']} — {entry['title']}",
                "",
                f"- **Category:** {entry['liturgical_category']}",
                f"- **Canonical Hour / Season:** {entry['canonical_hour_or_season']}",
                f"- **Commune House / Choir:** {entry.get('commune_house_or_choir') or 'Unassigned'}",
                f"- **Scribe / Order:** {entry['scribe_or_order']}",
                f"- **Synod Status:** {entry['synod_status']}",
                "",
            ]
        )
        epigraph = (entry.get("epigraph_or_antiphon") or "").strip()
        if epigraph:
            lines.extend([f"> *\"{epigraph}\"*", ""])
        lines.extend([entry["lore_body"].strip(), ""])
        xref = (entry.get("cross_references") or "").strip()
        if xref:
            lines.extend([f"- **Cross-References:** {xref}", ""])

    return "\n".join(lines).rstrip() + "\n"


def render_site_data(entries: list[dict], suite: dict, codex: dict) -> str:
    """Emit static JS bundle for GitHub Pages and local file viewing."""
    return (
        "// Auto-generated by scripts/validate_lore.py\n"
        f"window.OTHELLO_SUITE = {json.dumps(suite, indent=2, ensure_ascii=False)};\n"
        f"window.OTHELLO_LORE = {json.dumps(entries, indent=2, ensure_ascii=False)};\n"
        f"window.OTHELLO_CODEX = {json.dumps(codex, indent=2, ensure_ascii=False)};\n"
    )


def mirror_site_assets() -> int:
    """Mirror assets/ into site/assets/ for local previews without git duplication."""
    if not ASSETS_DIR.exists():
        return 0
    SITE_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    copied = 0
    for item in ASSETS_DIR.iterdir():
        if item.is_file():
            shutil.copy2(item, SITE_ASSETS_DIR / item.name)
            copied += 1
    return copied


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate and compile Othello lore and codex.")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify generated files are up to date without writing changes.",
    )
    args = parser.parse_args()

    entries = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    raw_suite = SUITE_PATH.read_text(encoding="utf-8")
    suite_raw_obj = json.loads(raw_suite)

    errors = validate_entries(entries)
    suite = validate_suite_privacy(raw_suite, suite_raw_obj, errors)

    orders = load_and_validate_csv(
        ORDERS_CSV_PATH, EXPECTED_CSV_COLUMNS["orders_and_houses.csv"], errors
    )
    personae = load_and_validate_csv(
        PERSONAE_CSV_PATH, EXPECTED_CSV_COLUMNS["dramatis_personae.csv"], errors
    )
    calendar = load_and_validate_csv(
        CALENDAR_CSV_PATH, EXPECTED_CSV_COLUMNS["liturgical_calendar.csv"], errors
    )

    if not CHARTER_MD_PATH.exists():
        errors.append("Missing lore/01_world_charter.md")
    if not COMMUNE_MD_PATH.exists():
        errors.append("Missing lore/02_liturgical_commune.md")

    if errors:
        for err in errors:
            print(f"ERROR: {err}", file=sys.stderr)
        return 1

    codex = {
        "orders": orders,
        "personae": personae,
        "calendar": calendar,
        "charter_md": CHARTER_MD_PATH.read_text(encoding="utf-8"),
        "commune_md": COMMUNE_MD_PATH.read_text(encoding="utf-8"),
    }

    anthology_md = render_anthology(entries)
    site_js = render_site_data(entries, suite, codex)

    if args.check:
        mismatches = []
        if not ANTHOLOGY_PATH.exists() or ANTHOLOGY_PATH.read_text(encoding="utf-8") != anthology_md:
            mismatches.append(str(ANTHOLOGY_PATH.relative_to(ROOT)))
        if not SITE_DATA_PATH.exists() or SITE_DATA_PATH.read_text(encoding="utf-8") != site_js:
            mismatches.append(str(SITE_DATA_PATH.relative_to(ROOT)))
        if mismatches:
            print(
                f"ERROR: Compiled files out of sync ({', '.join(mismatches)}). Run `python scripts/validate_lore.py`.",
                file=sys.stderr,
            )
            return 1
        print(
            f"OK: Verified {len(entries)} lore entries, {len(orders)} orders, "
            f"{len(personae)} personae, {len(calendar)} liturgical hours/seasons, and compiled artifacts."
        )
        return 0

    with ANTHOLOGY_PATH.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(anthology_md)
    with SITE_DATA_PATH.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(site_js)
    mirrored = mirror_site_assets()
    print(
        f"OK: Validated {len(entries)} lore entries, {len(orders)} orders, "
        f"{len(personae)} personae, {len(calendar)} calendar slots -> updated "
        f"{ANTHOLOGY_PATH.relative_to(ROOT)}, {SITE_DATA_PATH.relative_to(ROOT)}, "
        f"and mirrored {mirrored} asset(s) to site/assets/."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
