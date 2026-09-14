"""Deterministic FF3E/Entropy design-system contract regressions."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
SRC = WEB / "src"
UI = SRC / "components" / "ui"
DS_RELEASE = "2.4.3"
DS_COMMIT = "7d801cc03c1ff06cfc094f239e1d44a0e3c33dfc"
DS_SOURCE_COMMIT = "df92a57"

RAW_CONTROL = re.compile(r"<(button|input|select|textarea)(?:\s|>|/)")
ARBITRARY_VALUE = re.compile(r"\b[a-z][a-z-]*-\[[^\]]+\]")
STATE_VARIANT_PREFIXES = (
    "data-[", "group-data-[", "peer-data-[", "aria-[", "group-aria-[",
    "peer-aria-[", "supports-[", "has-[", "group-has-[", "peer-has-[",
)
RAW_PALETTE_VAR = re.compile(
    r"var\(--(?:orange|mint|warm|ink|sand|emerald|red|amber|blue)(?:-|\))"
)
SHADOW_CLASS = re.compile(r"(?<![\w-])shadow(?:-[\w\[\]-]+)?(?![\w-])")
FULL_RADIUS = re.compile(r"(?<![\w-])rounded-full(?![\w-])")

# These are upstream component source, not app-owned styling. The local candidate
# compliance run byte-checks them against @42labs; everything else is scanned.
ADOPTED_UI = {
    "alert.tsx",
    "badge.tsx",
    "button.tsx",
    "card.tsx",
    "collapsible.tsx",
    "input.tsx",
    "pagination.tsx",
    "progress.tsx",
    "select.tsx",
    "separator.tsx",
    "sheet.tsx",
    "sidebar.tsx",
    "skeleton.tsx",
    "table.tsx",
    "theme-switch.tsx",
    "toggle-group.tsx",
    "toggle.tsx",
    "tooltip.tsx",
    "top-bar.tsx",
}


def own_source_files() -> list[Path]:
    files = sorted((*SRC.rglob("*.ts"), *SRC.rglob("*.tsx")))
    return [p for p in files if not (p.parent == UI and p.name in ADOPTED_UI)]


def violations(text: str) -> set[str]:
    found: set[str] = set()
    if RAW_CONTROL.search(text):
        found.add("raw-control")
    arbitrary = (
        m.group(0) for m in ARBITRARY_VALUE.finditer(text)
        if not m.group(0).startswith(STATE_VARIANT_PREFIXES)
    )
    if any("var(--" not in token for token in arbitrary):
        found.add("arbitrary-value")
    if RAW_PALETTE_VAR.search(text):
        found.add("raw-palette")
    if SHADOW_CLASS.search(text):
        found.add("shadow")
    if FULL_RADIUS.search(text):
        found.add("full-radius")
    return found


@pytest.mark.parametrize(
    ("fixture", "rule"),
    [
        ('<button type="button">x</button>', "raw-control"),
        ('<input value="x" />', "raw-control"),
        ('className="h-[21px]"', "arbitrary-value"),
        ('style={{ color: "var(--red)" }}', "raw-palette"),
        ('className="shadow-md"', "shadow"),
        ('className="rounded-full"', "full-radius"),
    ],
)
def test_known_bad_fixture_is_rejected(fixture: str, rule: str) -> None:
    assert rule in violations(fixture)


def test_app_owned_source_has_no_visual_or_primitive_drift() -> None:
    findings = {
        str(path.relative_to(ROOT)): sorted(found)
        for path in own_source_files()
        if (found := violations(path.read_text()))
    }
    assert findings == {}


def test_theme_switch_is_only_a_controller_for_the_adopted_component() -> None:
    controller = (SRC / "components" / "ThemeSwitch.tsx").read_text()
    assert "@/components/ui/theme-switch" in controller
    assert "<CanonicalThemeSwitch" in controller
    assert "ToggleGroup" not in controller


def test_shell_has_one_main_and_theme_switch_lives_in_sidebar_footer() -> None:
    for page in ("ForecastPage.tsx", "ReportsPage.tsx"):
        assert "<main" not in (SRC / "components" / page).read_text()
    sidebar = (SRC / "components" / "AppSidebar.tsx").read_text()
    header = sidebar[sidebar.index("<SidebarHeader") : sidebar.index("</SidebarHeader>")]
    footer = sidebar[sidebar.index("<SidebarFooter") : sidebar.index("</SidebarFooter>")]
    assert "<ThemeSwitch" not in header
    assert "<ThemeSwitch" in footer
    assert 'group-data-[collapsible=icon]:size-6' in sidebar


def test_pie_chart_has_one_named_graphic_and_decorative_sectors() -> None:
    source = (SRC / "components" / "BreakdownPie.tsx").read_text()
    assert 'role="img"' in source
    assert "aria-label={accessibleLabel}" in source
    assert 'role="presentation"' in source
    assert 'aria-hidden="true"' in source


def test_permanent_rail_uses_complete_dark_roles_and_dark_assets() -> None:
    tokens = (SRC / "ds-tokens.css").read_text()
    dark = tokens[tokens.index("body.theme-dark,") :]
    for role in (
        "--surface:", "--surface-alt:", "--surface-muted:", "--surface-subtle:",
        "--border:", "--border-subtle:", "--border-control:",
        "--fg:", "--fg-2:", "--fg-muted:", "--fg-disabled:",
        "--accent:", "--accent-hover:", "--accent-solid:", "--accent-solid-hover:",
        "--accent-soft:", "--accent-border:", "--accent-focus:", "--accent-on:",
        "--link:", "--link-hover:", "--logo: var(--mint-300);",
        "--logo-word: var(--warm-50);",
    ):
        assert role in dark

    sidebar = (SRC / "components" / "AppSidebar.tsx").read_text()
    assert "buymeacoffee.com" in sidebar
    assert 'className="band-dark"' in sidebar
    assert "@/components/brand-mark" in sidebar
    assert "@/components/Brand" not in sidebar


def test_alfred_build_contract_is_exact_and_uses_npm_ci() -> None:
    package = json.loads((WEB / "package.json").read_text())
    command = package["scripts"]["build:alfred"]
    for flag in (
        "VITE_BASE=/entropy/",
        "VITE_API_BASE=/projections/data",
        "VITE_TX_API_BASE=/projections/transactions",
        "VITE_AUTH_RELOAD=1",
    ):
        assert flag in command
    makefile = (ROOT / "Makefile").read_text()
    assert "npm ci" in makefile
    assert "npm run build:alfred" in makefile
    env_example = (ROOT / ".env.example").read_text()
    assert "VITE_TX_API_BASE" in env_example


def test_ci_pins_exact_ds_release_and_runs_provenance_and_browser_gates() -> None:
    workflow = (ROOT / ".github" / "workflows" / "ds-compliance.yml").read_text()
    assert f"ref: {DS_COMMIT}" in workflow
    assert f'DS_TOKENS_PIN: "{DS_RELEASE}"' in workflow
    assert "DS_EXPECTED_COMMIT" in workflow
    assert "npm run test:browser:a11y" in workflow
    package = json.loads((WEB / "package.json").read_text())
    assert package["scripts"]["test:browser:a11y"] == "node scripts/test-browser-a11y.mjs"


def test_vendored_token_artifact_has_final_release_provenance() -> None:
    tokens = (SRC / "ds-tokens.css").read_text()
    assert f"Version {DS_RELEASE}" in tokens
    assert f"commit {DS_SOURCE_COMMIT}" in tokens
    assert f"/blob/{DS_SOURCE_COMMIT}/src/app/globals.css" in tokens
    bridge = (SRC / "ds-tailwind.css").read_text()
    assert f"Version {DS_RELEASE}" in bridge
    assert f"commit {DS_SOURCE_COMMIT}" in bridge


def test_local_candidate_adopted_sources_are_byte_identical() -> None:
    candidate = os.environ.get("DS_CANDIDATE")
    if not candidate:
        pytest.skip("set DS_CANDIDATE to byte-check the local design-system candidate")
    ds_src = Path(candidate) / "src"
    pairs = [(UI / name, ds_src / "components" / "ui" / name) for name in ADOPTED_UI]
    pairs.append((SRC / "ds-tokens.css", Path(candidate) / "public" / "tokens.v2.4.3.css"))
    pairs.append((SRC / "ds-tailwind.css", Path(candidate) / "public" / "tailwind.v2.4.3.css"))
    pairs.append((SRC / "components" / "brand-mark.tsx", ds_src / "components" / "brand-mark.tsx"))
    mismatches = [
        str(local.relative_to(ROOT))
        for local, canonical in pairs
        if not canonical.is_file() or local.read_bytes() != canonical.read_bytes()
    ]
    assert mismatches == []
