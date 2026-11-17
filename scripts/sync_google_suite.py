#!/usr/bin/env python3
"""Synchronize Othello local repository with Google Sheets and Google Docs."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUITE_CONFIG = ROOT / "config" / "google-suite.json"
LORE_JSON = ROOT / "data" / "liturgical_lore.json"
APPS_SCRIPT_FILE = ROOT / "scripts" / "google-apps-script" / "LiturgicalLoreForm.gs"


def load_suite() -> dict:
    return json.loads(SUITE_CONFIG.read_text(encoding="utf-8"))


def resolve_executable(name: str) -> str:
    found = shutil.which(name)
    if found:
        return found
    if os.name == "nt":
        for ext in (".cmd", ".exe", ".bat"):
            candidate = shutil.which(name + ext)
            if candidate:
                return candidate
    return name


def run_cli(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    resolved = [resolve_executable(cmd[0]), *cmd[1:]]
    return subprocess.run(
        resolved,
        cwd=ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
    )


def print_status(suite: dict) -> int:
    print("=== Othello Google Suite Status ===")
    gh = suite.get("github", {})
    print(f"GitHub Repo   : {gh.get('url')} ({gh.get('visibility')})")
    if gh.get("pages_url"):
        print(f"GitHub Pages  : {gh['pages_url']}")
    print(f"Drive Root    : {suite['drive']['root_folder']['url']}")
    codex = suite["suite"]["codex_doc"]
    print(f"World Codex   : {codex['url']} ({codex['id']})")
    for key, tab in codex["tabs"].items():
        print(f"  - Tab [{key}]: {tab['title']} ({tab['id']}) <-> {tab['local_file']}")
    intake = suite["suite"]["intake_sheet"]
    print(f"Lore Intake   : {intake['url']} ({intake['id']})")
    reg = suite["suite"]["registry_sheet"]
    print(f"Registry      : {reg['url']} ({reg['id']})")
    slides = suite["suite"]["briefing_slides"]
    print(f"Slides Deck   : {slides['url']} ({slides['id']})")
    colab = suite["suite"]["colab_notebook"]
    print(f"Colab Engine  : {colab['url']} ({colab['id']})")
    form = suite["suite"]["liturgical_lore_form"]
    print(f"First Form    : {form['title']} [status={form['status']}]")
    print(f"  - Form URL  : {form.get('form_url') or 'Not yet provisioned'}")
    print(f"  - Webhook   : {form.get('webhook_url') or 'Not yet deployed'}")
    return 0


def pull_intake_sheet(suite: dict) -> int:
    sheet_id = suite["suite"]["intake_sheet"]["id"]
    tab = suite["suite"]["intake_sheet"]["tabs"]["submissions"]
    proc = run_cli(["gsheets", "readonly", "read", sheet_id, f"{tab}!A1:K500", "--json"])
    if proc.returncode != 0:
        print(proc.stderr or proc.stdout, file=sys.stderr)
        return proc.returncode

    rows = json.loads(proc.stdout)
    if not rows or len(rows) < 2:
        print("No lore submission rows found in sheet.")
        return 0

    headers = [h.strip().lower() for h in rows[0]]
    entries = []
    for row in rows[1:]:
        padded = row + [""] * (len(headers) - len(row))
        record = dict(zip(headers, padded))
        if not str(record.get("title", "")).strip():
            continue
        entries.append(
            {
                "lore_id": record.get("lore_id", "").strip(),
                "submitted_at": record.get("submitted_at", "").strip(),
                "scribe_or_order": record.get("scribe_or_order", "").strip(),
                "title": record.get("title", "").strip(),
                "liturgical_category": record.get("liturgical_category", "").strip(),
                "canonical_hour_or_season": record.get("canonical_hour_or_season", "").strip(),
                "commune_house_or_choir": record.get("commune_house_or_choir", "").strip(),
                "epigraph_or_antiphon": record.get("epigraph_or_antiphon", "").strip(),
                "lore_body": record.get("lore_body", "").strip(),
                "cross_references": record.get("cross_references", "").strip(),
                "synod_status": record.get("synod_status", "").strip() or "Pending_Synod",
            }
        )

    LORE_JSON.write_text(json.dumps(entries, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Pulled {len(entries)} entries from {tab} into {LORE_JSON.relative_to(ROOT)}.")

    val_proc = run_cli([sys.executable, str(ROOT / "scripts" / "validate_lore.py")])
    print(val_proc.stdout.strip())
    if val_proc.returncode != 0:
        print(val_proc.stderr, file=sys.stderr)
    return val_proc.returncode


def sync_apps_script_tab(suite: dict) -> int:
    """Push LiturgicalLoreForm.gs source and setup instructions into Google_Forms_Apps_Script!A1:B4."""
    if not APPS_SCRIPT_FILE.exists():
        print(f"ERROR: Missing {APPS_SCRIPT_FILE}", file=sys.stderr)
        return 1

    sheet_id = suite["suite"]["intake_sheet"]["id"]
    tab = suite["suite"]["intake_sheet"]["tabs"]["apps_script"]
    source = APPS_SCRIPT_FILE.read_text(encoding="utf-8")

    batch_ops = [
        {
            "op": "write",
            "range": f"{tab}!A1:B4",
            "data": [
                ["Step", "Instruction / Source"],
                [
                    "1",
                    "Open Extensions -> Apps Script in this Google Sheet, replace Code.gs with cell B4, and save.",
                ],
                [
                    "2",
                    "In Project Settings -> Script Properties add SYNOD_SEAL_KEY (from local .env). Run createLiturgicalCommuneLoreForm() once to link the native Google Form & onGoogleFormSubmit trigger, then Deploy -> New deployment -> Web app (Execute as: Me, Access: Anyone).",
                ],
                ["Apps Script Source", source],
            ],
        }
    ]

    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", encoding="utf-8", delete=False
        ) as handle:
            json.dump(batch_ops, handle, ensure_ascii=False)
            tmp_path = Path(handle.name)

        proc = run_cli(["gsheets", "mutate", "batch", sheet_id, "-f", str(tmp_path)])
        if proc.returncode != 0:
            print(proc.stderr or proc.stdout, file=sys.stderr)
            return proc.returncode
        print(proc.stdout.strip() or f"Synced {APPS_SCRIPT_FILE.name} into {tab}!A1:B4.")
        return 0
    finally:
        if tmp_path and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)


def push_docs(suite: dict) -> int:
    codex = suite["suite"]["codex_doc"]
    doc_id = codex["id"]
    exit_code = 0
    for key, tab in codex["tabs"].items():
        local_md = ROOT / tab["local_file"]
        print(f"Syncing {tab['local_file']} -> Tab '{tab['title']}' ({tab['id']})...")
        proc = run_cli(
            ["gdocs", "mutate", "sync", doc_id, str(local_md), "--tab", tab["id"], "--json-conflicts"]
        )
        if proc.returncode != 0:
            exit_code = proc.returncode
            print(f"Sync notice for {key}:\n{proc.stdout}\n{proc.stderr}", file=sys.stderr)
        else:
            print(proc.stdout.strip() or f"Synced {tab['title']}.")
    return exit_code


def main() -> int:
    parser = argparse.ArgumentParser(description="Othello Google Suite synchronization CLI.")
    parser.add_argument("--status", action="store_true", help="Print linked Google Suite IDs and URLs.")
    parser.add_argument(
        "--pull",
        action="store_true",
        help="Pull Lore_Submissions from Intake Sheet and rebuild repo artifacts.",
    )
    parser.add_argument(
        "--sync-script",
        action="store_true",
        help="Upload LiturgicalLoreForm.gs into the Intake Sheet's Google_Forms_Apps_Script tab.",
    )
    parser.add_argument(
        "--push-docs",
        action="store_true",
        help="3-way sync local lore/*.md files into World Codex tabs.",
    )
    args = parser.parse_args()

    suite = load_suite()
    if not (args.status or args.pull or args.sync_script or args.push_docs):
        return print_status(suite)

    code = 0
    if args.status:
        code |= print_status(suite)
    if args.pull:
        code |= pull_intake_sheet(suite)
    if args.sync_script:
        code |= sync_apps_script_tab(suite)
    if args.push_docs:
        code |= push_docs(suite)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
