import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EmbeddedAsk } from "../src/workbench/WorkPanel.jsx";
import { buildYiwenUrl } from "../src/config/yiwen";

describe("Data Agent iframe", () => {
  const { url } = buildYiwenUrl("http://dataaitest.digitalshell.com.cn:3052/", "lukx1@digitalchina.com");
  it("loads only when visited, and shares the email URL with the independent link", () => {
    const html = renderToStaticMarkup(<EmbeddedAsk loaded url={url} />);
    expect(html).toContain(`src="${url}"`);
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-forms allow-popups"');
    expect(renderToStaticMarkup(<EmbeddedAsk loaded={false} url={url} />)).not.toContain("<iframe");
  });
});
