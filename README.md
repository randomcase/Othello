# Othello — The Liturgical Commune

**Othello** is a dark-parchment worldbuilding codex and living archive centered on the **Liturgical Commune**—an austere Venetian garrison-commune chartered Under the King (`0xCROWN_WARRANT_OTHELLO_SCRIPTORIUM`) and sworn to the Doge and Senate of Venice, binding bell-foundries, refectories, reed-cells, and ash-ink scriptoria together across six daily Canonical Hours and three seasonal observances.

## Repository Structure

| Path | Purpose |
| :--- | :--- |
| `Othello.code-workspace` | Saved VS Code workspace configuration for opening Othello cleanly |
| `lore/` | World Charter (`01_world_charter.md`), Liturgical Commune Rule (`02_liturgical_commune.md`), and compiled Canon Anthology (`03_canon_anthology.md`) |
| `data/` | Structured lore records (`liturgical_lore.json`), `orders_and_houses.csv`, `dramatis_personae.csv`, and `liturgical_calendar.csv` |
| `config/` | Lore JSON Schema (`lore.schema.json`) and linked Google Suite registry (`google-suite.json`) |
| `scripts/` | Lore validator/compiler (`validate_lore.py`), Google Suite sync CLI (`sync_google_suite.py`), and Apps Script Form webhook (`google-apps-script/LiturgicalLoreForm.gs`) |
| `site/` | Illuminated Scriptorium Codex (`index.html`), split-desk lore intake form (`form.html`), shared runtime & sync engine (`scriptorium-core.js`), styling (`styles.css`), and compiled bundle (`lore-data.js`) |
| `notebooks/` | Seed motif & ID generator (`Othello_Scriptorium_Lore_Engine.ipynb`) |
| `assets/` | Visual reliquary (`commune-emblem.jpg`) |

Live Portal: [https://randomcase.github.io/Othello/](https://randomcase.github.io/Othello/)

## Validation & Build Commands

Compile `lore/03_canon_anthology.md` and `site/lore-data.js` from `data/liturgical_lore.json`:

```powershell
python scripts/validate_lore.py
```

Verify that all lore records satisfy `config/lore.schema.json` and compiled artifacts are up to date (matches GitHub Actions CI):

```powershell
python scripts/validate_lore.py --check
```

## Google Suite Synchronization

Inspect linked Drive, Docs, Sheets, Slides, and Colab endpoints:

```powershell
python scripts/sync_google_suite.py --status
```

Pull new submissions from `Lore_Submissions` and recompile local artifacts:

```powershell
python scripts/sync_google_suite.py --pull
```

Synchronize `lore/*.md` files with the three tabs of the World Codex Google Doc:

```powershell
python scripts/sync_google_suite.py --push-docs
```

## Linked Google Suite Workspace

| Artifact | Purpose | Access |
| :--- | :--- | :--- |
| Drive Root Folder | Master folder organizing intake, codex, registries, and media | [Othello Drive Folder](https://drive.google.com/drive/folders/1lWODQYoUhRP6vZcsBuhWqY3P0vLgxPnm) |
| World Codex & Canon | Master 3-tab Google Doc (`I. World Charter`, `II. Liturgical Commune`, `III. Canon Anthology`) | [Othello — World Codex & Liturgical Canon](https://docs.google.com/document/d/12bQPXzPtPtxCRhVCQWCo4JqzNqCGvdWR-24aEDmDckQ/edit) |
| Lore Intake Sheet | `Lore_Submissions` intake ledger and Apps Script Form generator | [Othello — Liturgical Commune Lore Intake](https://docs.google.com/spreadsheets/d/1iPjlmIWB_Zg_MBm4ApvJdxD_AEE8GV2tVfXvNtm4cpA/edit) |
| Commune Registry | `Orders_And_Houses`, `Dramatis_Personae`, and `Liturgical_Calendar` | [Othello — Commune Registry & Chronicle](https://docs.google.com/spreadsheets/d/17r5y9YrJ1Scr9icrLhJkvb9MklGuHLTVX6Fv_wEdt7Q/edit) |
| Synod Briefing Deck | Overview of the Commune, 7 lore categories, and intake workflow | [Othello — Liturgical Commune & World Briefing](https://docs.google.com/presentation/d/1UK-Ilc2KU-RKjn7MZsP_fpTW7NUxymxwxu6OvkcSLzQ/edit) |
| Scriptorium Notebook | Colab seed generator for liturgical motifs and `LC-NNN` IDs | [Othello_Scriptorium_Lore_Engine.ipynb](https://colab.research.google.com/drive/13Rf_PU_w9a7MfLohEikG-FpjIrH7k-Dy) |
