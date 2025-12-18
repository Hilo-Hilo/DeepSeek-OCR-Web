import { buildResultsAssetUrl } from "@/lib/backend-api";

export function stripOcrTags(input: string): string {
  return (
    input
      // Remove OCR grounding tags like <|ref|>, <|det|>, etc.
      // Avoid RegExp `s` (dotAll) flag to keep compatibility with older TS targets
      .replace(/<\|ref\|>[\s\S]*?<\/ref\|>/g, "")
      .replace(/<\|det\|>[\s\S]*?<\/det\|>/g, "")
      .replace(/<\|ref\|>/g, "")
      .replace(/<\/ref\|>/g, "")
      .replace(/<\|det\|>/g, "")
      .replace(/<\/det\|>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export function fixMarkdownImages(markdown: string, resultDir: string): string {
  // Replace ![alt](images/xxx.jpg) with ![alt](http://<host>:8002/results/<...>/images/xxx.jpg)
  return markdown.replace(/!\[(.*?)\]\((.*?)\)/g, (match, altText, rawPath) => {
    const path = String(rawPath || "").trim();
    if (!path) return match;

    // Skip absolute URLs / data URIs
    if (/^(https?:)?\/\//i.test(path) || path.startsWith("data:")) return match;

    const url = buildResultsAssetUrl(resultDir, path);
    return `![${altText}](${url})`;
  });
}


