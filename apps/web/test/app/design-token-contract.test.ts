import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const appCss = await readFile(
  resolve(process.cwd(), "src/app/app.css"),
  "utf8",
);

describe("global UI design token contract", () => {
  it("defines semantic editor layers and shared overlay tokens", () => {
    expect(appCss).toMatch(/--editor-layer-canvas:\s*1/);
    expect(appCss).toMatch(/--editor-layer-status:\s*6/);
    expect(appCss).toMatch(/--editor-layer-controls:\s*7/);
    expect(appCss).toMatch(/--editor-layer-context:\s*8/);
    expect(appCss).toMatch(/--editor-layer-recovery:\s*9/);
    expect(appCss).toMatch(/--color-border-subtle:/);
    expect(appCss).toMatch(/--shadow-overlay:/);
  });

  it("lets the canvas receive pointer events outside the editor controls", () => {
    expect(appCss).toMatch(/\.editor-command-bar\s*\{[\s\S]*pointer-events:\s*none/);
    expect(appCss).toMatch(
      /\.editor-command-bar button,[\s\S]*\.editor-viewport-controls button\s*\{[\s\S]*pointer-events:\s*auto/,
    );
  });

  it("keeps the workspace surface flat and uses shared card tokens", () => {
    expect(appCss).not.toMatch(/\.workspace-home::before/);
    expect(appCss).not.toMatch(/\.workspace-home::after/);
    expect(appCss).toMatch(/--color-surface-subtle:/);
    expect(appCss).toMatch(/\.workspace-toolbar\s*\{[\s\S]*border-radius:\s*var\(--radius-card\)/);
    expect(appCss).toMatch(/\.workspace-panel\s*\{[\s\S]*border-radius:\s*var\(--radius-card\)/);
    expect(appCss).toMatch(
      /\.workspace-document-card__icon\s*\{[\s\S]*background:\s*var\(--color-surface-subtle\)/,
    );
  });

  it("gives the editor chrome a compact overflow and status treatment", () => {
    expect(appCss).toMatch(
      /\.editor-command-bar\s*\{[\s\S]*overflow-x:\s*auto[\s\S]*scrollbar-width:\s*none/,
    );
    expect(appCss).toMatch(/--editor-command-reserve:\s*560px/);
    expect(appCss).toMatch(/\.editor-shell__status\s*\{[\s\S]*padding:/);
    expect(appCss).toMatch(
      /\.editor-shell__status\s*>\s*span,\s*[\s\S]*\.editor-shell__status\s+\.lock-status\s*\{/,
    );
  });

  it("uses the neutral blue and amber product palette", () => {
    expect(appCss).toMatch(/--accent:\s*#007bff/);
    expect(appCss).toMatch(/--accent-strong:\s*#0056b3/);
    expect(appCss).toMatch(/--ink:\s*#212529/);
    expect(appCss).toMatch(/--muted:\s*#6c757d/);
    expect(appCss).toMatch(/--page:\s*#f8f8f8/);
    expect(appCss).toMatch(/--border:\s*#dee2e6/);
    expect(appCss).toMatch(/--color-warning:\s*#ffc107/);
    expect(appCss).toMatch(/--color-canvas-bg:\s*#212529/);
    expect(appCss).not.toMatch(/--accent:\s*#0b8f83/);
  });
});
