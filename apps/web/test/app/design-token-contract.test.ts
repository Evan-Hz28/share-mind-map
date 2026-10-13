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

  it("stacks the top bar above the tab strip", () => {
    // 两者都是 position: relative 的同级元素,且标签栏在 DOM 里更靠后、背景不透明;
    // 一旦 z-index 相等,顶栏里向下展开的账户菜单就会被标签栏盖住。
    function layer(name: string): number {
      const match = new RegExp(`${name}:\\s*(\\d+)`).exec(appCss);
      const raw = match?.[1];
      if (raw === undefined) throw new Error(`未找到设计令牌 ${name}`);
      return Number(raw);
    }

    expect(layer("--app-topbar-layer")).toBeGreaterThan(layer("--app-tabs-layer"));
    expect(appCss).toMatch(/\.top-bar\s*\{[\s\S]*?z-index:\s*var\(--app-topbar-layer\)/);
    expect(appCss).toMatch(/\.app-tabs\s*\{[\s\S]*?z-index:\s*var\(--app-tabs-layer\)/);
  });
});
