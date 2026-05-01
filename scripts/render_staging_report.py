#!/usr/bin/env python3
"""Render the integration staging report markdown files to polished HTML."""
import os
import sys
import markdown

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CSS = """
<style>
  :root {
    --ink: #1a1f2e;
    --muted: #5a6478;
    --line: #e3e7ee;
    --bg: #ffffff;
    --bg-alt: #f7f9fc;
    --accent: #2e5bff;
    --green: #1d9a5a;
    --yellow: #b48a00;
    --red: #c8372d;
    --mono: 'SF Mono', Menlo, Monaco, 'Cascadia Mono', 'Roboto Mono', Consolas, monospace;
    --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  body {
    font-family: var(--sans);
    color: var(--ink);
    background: var(--bg);
    max-width: 980px;
    margin: 0 auto;
    padding: 40px 48px 120px;
    line-height: 1.58;
    font-size: 15.5px;
    -webkit-font-smoothing: antialiased;
  }
  h1 {
    font-size: 28px;
    font-weight: 700;
    margin: 0 0 8px;
    letter-spacing: -0.01em;
  }
  h1 + p, h1 + p + p { color: var(--muted); margin: 4px 0; }
  h2 {
    font-size: 22px;
    font-weight: 650;
    margin: 48px 0 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line);
    letter-spacing: -0.01em;
  }
  h3 {
    font-size: 17px;
    font-weight: 650;
    margin: 32px 0 12px;
    color: var(--ink);
  }
  h4 {
    font-size: 15px;
    font-weight: 650;
    margin: 24px 0 10px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  p { margin: 10px 0; }
  a { color: var(--accent); text-decoration: none; border-bottom: 1px dotted var(--accent); }
  a:hover { border-bottom-style: solid; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 32px 0; }
  code {
    font-family: var(--mono);
    font-size: 13px;
    background: var(--bg-alt);
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid var(--line);
  }
  pre {
    background: var(--bg-alt);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 14px 18px;
    overflow-x: auto;
    font-size: 13px;
    line-height: 1.5;
  }
  pre code { background: none; border: 0; padding: 0; font-size: 13px; }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 16px 0;
    font-size: 14px;
  }
  th, td {
    border: 1px solid var(--line);
    padding: 10px 12px;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: var(--bg-alt);
    font-weight: 650;
    color: var(--ink);
  }
  tbody tr:nth-child(even) { background: #fafbfd; }
  ul, ol { padding-left: 22px; margin: 10px 0; }
  li { margin: 4px 0; }
  blockquote {
    border-left: 3px solid var(--accent);
    margin: 16px 0;
    padding: 4px 16px;
    background: var(--bg-alt);
    color: var(--muted);
  }
  /* Callouts */
  .header-bar {
    background: linear-gradient(135deg, #2e5bff, #1e3f99);
    color: white;
    margin: -40px -48px 32px;
    padding: 36px 48px;
    border-radius: 0 0 4px 4px;
  }
  .header-bar h1 { color: white; font-size: 30px; }
  .header-bar p { color: rgba(255,255,255,0.9); }
  /* Traffic-light emoji sizing inside tables */
  td, th { font-size: 14px; }
  /* Code inside table cells */
  td code, th code { font-size: 12.5px; padding: 1px 5px; }
  /* Print */
  @media print {
    body { max-width: none; padding: 20px; font-size: 11pt; }
    h2 { page-break-after: avoid; }
    table, pre { page-break-inside: avoid; }
    .header-bar { background: #2e5bff; color: white; -webkit-print-color-adjust: exact; }
  }
</style>
"""

def render(md_path: str, out_path: str, title: str) -> None:
    with open(md_path, "r", encoding="utf-8") as f:
        md_text = f.read()

    html_body = markdown.markdown(
        md_text,
        extensions=["tables", "fenced_code", "attr_list", "toc", "sane_lists"],
    )

    html_doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  {CSS}
</head>
<body>
  {html_body}
</body>
</html>
"""
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html_doc)
    print(f"[OK] Rendered {os.path.basename(md_path)} → {os.path.basename(out_path)}")


def main() -> int:
    out_dir = os.path.join(ROOT, "docs", "rendered")
    os.makedirs(out_dir, exist_ok=True)

    render(
        os.path.join(ROOT, "docs", "INTEGRATION_STAGING_REPORT_v1.md"),
        os.path.join(out_dir, "INTEGRATION_STAGING_REPORT_v1.html"),
        "Integration Staging Report v1 — SolarPro × Site Survey App",
    )
    render(
        os.path.join(ROOT, "docs", "INTEGRATION_STAGING_REPORT_v1_EXEC.md"),
        os.path.join(out_dir, "INTEGRATION_STAGING_REPORT_v1_EXEC.html"),
        "Integration Staging Report — Exec Summary",
    )
    render(
        os.path.join(ROOT, "docs", "stage9_v47434a-contract-delta-map.md"),
        os.path.join(out_dir, "stage9_v47434a-contract-delta-map.html"),
        "v47.434a Contract Delta Map",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())