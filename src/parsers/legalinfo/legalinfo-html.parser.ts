import { randomUUID } from "node:crypto";

import type { LegalDocument, LegalNode } from "../../domain/entities.js";
import {
  DocumentStatus,
  DocumentType,
  LegalNodeType,
  VersionStatus,
} from "../../domain/enums.js";
import type { ILegalParser, ParserInput } from "../../domain/ports/legal-parser.js";
import { sha256Hex } from "../../application/archive/hash.js";

export const LEGALINFO_PARSER_ID = "legalinfo-html-v2";

const ARTICLE_RE =
  /^(\d+)(?:\^(\d+))?\s*(?:дүгээр|дугаар|дэх)\s*зүйл(?:[.\s:—-]+(.*))?$/i;
const COMPOUND_ARTICLE_RE =
  /^(\d+\.\d+)(?:\^(\d+))?\s*(?:дүгээр|дугаар|дэх)\s*зүйл(?:[.\s:—-]+(.*))?$/i;
const ARTICLE_WORD_RE =
  /^(?:(АРВАН|ХОРИН|ГУЧИН|ДӨЧИН|ТАВИН|ЖАРАН|ДАЛАН|НАЯН|ЕРЭН)\s+)?(НЭГДҮГЭЭР|ХОЁРДУГААР|ГУРАВДУГААР|ДӨРӨВДҮГЭЭР|ТАВДУГААР|ЗУРГАДУГААР|ЗУРГААДУГААР|ДОЛООДУГААР|ДОЛДУГААР|НАЙМДУГААР|ЕСДҮГЭЭР|АРАВДУГААР|ХОРЬДУГААР|ГУЧДУГААР|ДӨЧДҮГЭЭР|ТАВЬДУГААР|ЖАРДУГААР|ДАЛДУГААР|НАЯДУГААР|ЕРДҮГЭЭР)(?:\^(\d+))?\s+ЗҮЙЛ(?:[.\s:—-]*(.*))?$/i;
const QUALIFIED_RE =
  /^(\d+)(?:\^(\d+))?\.(\d+)(?:\.(\d+))?(?:\.(\d+))?\.?\s*(.*)$/;
const SIMPLE_PARA_RE = /^(\d+)(?:[.)]|\/)\s*(.*)$/;
const CHAPTER_HEAD_RE =
  /^(?:(АРВАН|ХОРИН|ГУЧИН|ДӨЧИН|ТАВИН|ЖАРАН|ДАЛАН|НАЯН|ЕРЭН)\s+)?(НЭГДҮГЭЭР|ХОЁРДУГААР|ГУРАВДУГААР|ДӨРӨВДҮГЭЭР|ТАВДУГААР|ЗУРГАДУГААР|ЗУРГААДУГААР|ДОЛООДУГААР|ДОЛДУГААР|НАЙМДУГААР|ЕСДҮГЭЭР|АРАВДУГААР|ХОРЬДУГААР|ГУЧДУГААР|ДӨЧДҮГЭЭР|ТАВЬДУГААР|ЖАРДУГААР|ДАЛДУГААР|НАЯДУГААР|ЕРДҮГЭЭР)(?:\^(\d+))?\s+БҮЛЭГ(?:\^(\d+))?(?:[.\s:—-]*(.*))?$/i;
const ANNEX_RE = /^хавсралт\b/i;
const CHROME_LINE_RE =
  /^(хэвлэх|pdf|word|сонсох.*|хуваалцах|-->)$/i;
const CHAPTER_UNITS: Record<string, number> = {
  НЭГДҮГЭЭР: 1,
  ХОЁРДУГААР: 2,
  ГУРАВДУГААР: 3,
  ДӨРӨВДҮГЭЭР: 4,
  ТАВДУГААР: 5,
  ЗУРГАДУГААР: 6,
  ЗУРГААДУГААР: 6,
  ДОЛООДУГААР: 7,
  ДОЛДУГААР: 7,
  НАЙМДУГААР: 8,
  ЕСДҮГЭЭР: 9,
  АРАВДУГААР: 10,
  ХОРЬДУГААР: 20,
  ГУЧДУГААР: 30,
  ДӨЧДҮГЭЭР: 40,
  ТАВЬДУГААР: 50,
  ЖАРДУГААР: 60,
  ДАЛДУГААР: 70,
  НАЯДУГААР: 80,
  ЕРДҮГЭЭР: 90,
};
const CHAPTER_TENS: Record<string, number> = {
  АРВАН: 10,
  ХОРИН: 20,
  ГУЧИН: 30,
  ДӨЧИН: 40,
  ТАВИН: 50,
  ЖАРАН: 60,
  ДАЛАН: 70,
  НАЯН: 80,
  ЕРЭН: 90,
};

export class LegalInfoHtmlParser implements ILegalParser {
  readonly id = LEGALINFO_PARSER_ID;

  async parse(input: ParserInput): Promise<LegalDocument> {
    const raw = input.html ?? (input.bytes ? new TextDecoder("utf-8").decode(input.bytes) : "");
    const lawHtml = isolateLawHtml(raw);
    const lines = extractLines(lawHtml);
    const title = extractTitle(raw, lawHtml, lines) || "Untitled";
    const adoptedAt = extractDate(raw, /батлагдсан[:\s]*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
    const effectiveFrom = extractDate(
      raw,
      /хүчин\s*төгөлдөр(?:\s*болсон)?[:\s]*([0-9]{4}-[0-9]{2}-[0-9]{2})/i,
    );
    const versionId = randomUUID();
    const documentId = randomUUID();
    const root = makeNode({
      documentVersionId: versionId,
      parentId: null,
      nodeType: LegalNodeType.DOCUMENT,
      sourceLocator: "doc",
      title,
      text: title,
    });

    let currentChapter: LegalNode | null = null;
    let currentArticle: LegalNode | null = null;
    let currentParagraph: LegalNode | null = null;
    let currentClause: LegalNode | null = null;
    const simpleParagraphLocators = new Set<string>();

    const articleParent = (): LegalNode => currentChapter ?? root;

    for (const line of lines) {
      if (
        CHROME_LINE_RE.test(line) ||
        line.includes("Lang::lineCode") ||
        /^МОНГОЛ УЛСЫН ИХ ХУРЛЫН ДАРГА\b/i.test(line)
      ) {
        continue;
      }

      const chapterMatch = parseChapterHeading(line);
      if (chapterMatch) {
        const number = articleToken(chapterMatch.number, chapterMatch.bis);
        currentChapter = makeNode({
          documentVersionId: versionId,
          parentId: root.id,
          nodeType: LegalNodeType.CHAPTER,
          sourceLocator: `ch-${number}`,
          chapter: number,
          number,
          title: line,
          text: line,
        });
        root.children.push(currentChapter);
        currentArticle = null;
        currentParagraph = null;
        currentClause = null;
        continue;
      }

      const wordArticleMatch = parseArticleWordHeading(line);
      if (wordArticleMatch) {
        const number = wordArticleMatch.number;
        const parent = articleParent();
        currentArticle = makeNode({
          documentVersionId: versionId,
          parentId: parent.id,
          nodeType: LegalNodeType.ARTICLE,
          sourceLocator: `art-${number}`,
          article: number,
          chapter: currentChapter?.chapter ?? null,
          number,
          title: wordArticleMatch.title || `Article ${number}`,
          text: line,
        });
        parent.children.push(currentArticle);
        currentParagraph = null;
        currentClause = null;
        continue;
      }

      const compoundArticle = line.match(COMPOUND_ARTICLE_RE);
      const articleMatch = compoundArticle ?? line.match(ARTICLE_RE);
      if (articleMatch) {
        const number = articleToken(articleMatch[1] ?? "0", articleMatch[2]);
        const parent = articleParent();
        currentArticle = makeNode({
          documentVersionId: versionId,
          parentId: parent.id,
          nodeType: LegalNodeType.ARTICLE,
          sourceLocator: `art-${number}`,
          article: number,
          chapter: currentChapter?.chapter ?? null,
          number,
          title: articleMatch[3]?.trim() || `Article ${number}`,
          text: line,
        });
        parent.children.push(currentArticle);
        currentParagraph = null;
        currentClause = null;
        continue;
      }

      if (ANNEX_RE.test(line)) {
        const parent = articleParent();
        parent.children.push(
          makeNode({
            documentVersionId: versionId,
            parentId: parent.id,
            nodeType: LegalNodeType.ANNEX,
            sourceLocator: `annex-${root.children.length + 1}`,
            title: line.slice(0, 120),
            text: line,
          }),
        );
        currentArticle = null;
        currentParagraph = null;
        currentClause = null;
        continue;
      }

      const qualified = line.match(QUALIFIED_RE);
      if (qualified && currentArticle) {
        const articleNumber = articleToken(qualified[1] ?? "", qualified[2]);
        const located = findArticle(root, articleNumber);
        const target: LegalNode =
          currentArticle.article === articleNumber || !located ? currentArticle : located;
        if (target !== currentArticle) {
          currentArticle = target;
          currentParagraph = null;
          currentClause = null;
        }
        const paraNum = qualified[3] ?? "1";
        const clauseNum = qualified[4] ?? null;
        const subNum = qualified[5] ?? null;
        const rest = (qualified[6] ?? line).trim();
        // Fixture-style "1. / 1.1.": a simple paragraph numbered N already
        // exists, so N.M is clause M of that paragraph. LegalInfo-style
        // "1.1. / 1.1.1." has no such simple paragraph, so N.M is paragraph M.
        const simpleParagraph = !clauseNum
          ? target.children.find(
              (node) =>
                node.nodeType === LegalNodeType.PARAGRAPH &&
                node.paragraph === qualified[1] &&
                simpleParagraphLocators.has(node.sourceLocator),
            )
          : undefined;
        if (simpleParagraph) {
          currentParagraph = simpleParagraph;
          currentClause = ensureClause(simpleParagraph, paraNum, versionId, rest);
          appendText(currentClause, rest);
          continue;
        }
        currentParagraph = ensureParagraph(target, paraNum, versionId, clauseNum ? null : rest);
        if (!clauseNum) {
          appendText(currentParagraph, rest);
          currentClause = null;
          continue;
        }
        currentClause = ensureClause(currentParagraph, clauseNum, versionId, subNum ? null : rest);
        if (!subNum) {
          appendText(currentClause, rest);
          continue;
        }
        const sub = makeNode({
          documentVersionId: versionId,
          parentId: currentClause.id,
          nodeType: LegalNodeType.SUB_CLAUSE,
          sourceLocator: `${currentClause.sourceLocator}/sc-${subNum}`,
          article: target.article,
          paragraph: currentParagraph.paragraph,
          clause: clauseNum,
          subClause: subNum,
          number: subNum,
          title: null,
          text: rest,
        });
        currentClause.children.push(sub);
        continue;
      }

      const simple = line.match(SIMPLE_PARA_RE);
      if (simple && currentArticle && !QUALIFIED_RE.test(line)) {
        const paraNum = simple[1] ?? "1";
        const rest = (simple[2] ?? line).trim();
        currentParagraph = ensureParagraph(currentArticle, paraNum, versionId, rest);
        simpleParagraphLocators.add(currentParagraph.sourceLocator);
        appendText(currentParagraph, rest);
        currentClause = null;
        continue;
      }

      if (currentClause) {
        appendText(currentClause, line);
      } else if (currentParagraph) {
        appendText(currentParagraph, line);
      } else if (currentArticle) {
        appendText(currentArticle, line);
      }
    }

    return {
      id: documentId,
      sourceId: "",
      documentType: inferDocumentType(title),
      title,
      documentNumber: null,
      issuingAuthority: "State Great Khural",
      jurisdiction: "MN",
      adoptedAt,
      canonicalUrl: input.sourceUrl,
      status: DocumentStatus.IN_FORCE,
      versions: [
        {
          id: versionId,
          documentId,
          versionNumber: 1,
          effectiveFrom,
          effectiveTo: null,
          contentHash: sha256Hex(new TextEncoder().encode(raw)),
          parserId: LEGALINFO_PARSER_ID,
          status: VersionStatus.DRAFT,
          amendmentDocumentId: null,
          archiveRecordId: "",
          nodes: [root],
        },
      ],
    };
  }
}

function articleToken(main: string, bis: string | undefined): string {
  return bis ? `${main}^${bis}` : main;
}

function parseChapterHeading(line: string): { number: string; bis?: string } | null {
  const match = line.match(CHAPTER_HEAD_RE);
  if (!match) {
    return null;
  }
  const tens = match[1] ? CHAPTER_TENS[match[1].toUpperCase()] : undefined;
  const unit = CHAPTER_UNITS[match[2]?.toUpperCase() ?? ""];
  if (unit === undefined) {
    return null;
  }
  const number = String(tens !== undefined ? tens + unit : unit);
  const bis = match[3] || match[4] || undefined;
  return { number, bis };
}

function parseArticleWordHeading(line: string): { number: string; title?: string } | null {
  const match = line.match(ARTICLE_WORD_RE);
  if (!match) {
    return null;
  }
  const tens = match[1] ? CHAPTER_TENS[match[1].toUpperCase()] : undefined;
  const unit = CHAPTER_UNITS[match[2]?.toUpperCase() ?? ""];
  if (unit === undefined) {
    return null;
  }
  const number = String(tens !== undefined ? tens + unit : unit);
  const title = match[3]?.trim() || undefined;
  return { number, title };
}

function findArticle(root: LegalNode, article: string): LegalNode | null {
  for (const child of root.children) {
    if (child.nodeType === LegalNodeType.ARTICLE && child.article === article) {
      return child;
    }
    if (child.nodeType === LegalNodeType.CHAPTER) {
      const found = child.children.find(
        (node) => node.nodeType === LegalNodeType.ARTICLE && node.article === article,
      );
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ensureParagraph(
  article: LegalNode,
  paraNum: string,
  versionId: string,
  initialText: string | null,
): LegalNode {
  const locator = `${article.sourceLocator}/p-${paraNum}`;
  const existing = article.children.find((node) => node.sourceLocator === locator);
  if (existing) {
    return existing;
  }
  const node = makeNode({
    documentVersionId: versionId,
    parentId: article.id,
    nodeType: LegalNodeType.PARAGRAPH,
    sourceLocator: locator,
    article: article.article,
    paragraph: paraNum,
    number: paraNum,
    title: null,
    text: initialText ?? "",
  });
  article.children.push(node);
  return node;
}

function ensureClause(
  paragraph: LegalNode,
  clauseNum: string,
  versionId: string,
  initialText: string | null,
): LegalNode {
  const locator = `${paragraph.sourceLocator}/c-${clauseNum}`;
  const existing = paragraph.children.find((node) => node.sourceLocator === locator);
  if (existing) {
    return existing;
  }
  const node = makeNode({
    documentVersionId: versionId,
    parentId: paragraph.id,
    nodeType: LegalNodeType.CLAUSE,
    sourceLocator: locator,
    article: paragraph.article,
    paragraph: paragraph.paragraph,
    clause: clauseNum,
    number: clauseNum,
    title: null,
    text: initialText ?? "",
  });
  paragraph.children.push(node);
  return node;
}

function appendText(node: LegalNode, line: string): void {
  if (!line) {
    return;
  }
  if (!node.text) {
    node.text = line;
  } else if (!node.text.includes(line)) {
    node.text = `${node.text} ${line}`.trim();
  }
  node.contentHash = sha256Hex(new TextEncoder().encode(`${node.sourceLocator}:${node.text}`));
}

function isolateLawHtml(html: string): string {
  const tabAttr = html.search(/id=["']bordered-tab1["']/i);
  let scope = html;
  if (tabAttr >= 0) {
    const divStart = html.lastIndexOf("<div", tabAttr);
    if (divStart >= 0) {
      scope = sliceBalancedDiv(html, divStart);
    }
  }
  return findDivByClass(scope, "law_content") ?? stripChrome(scope);
}

function findDivByClass(html: string, className: string): string | null {
  const re = new RegExp(`<div\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`, "i");
  const match = html.match(re);
  if (!match || match.index === undefined) {
    return null;
  }
  return sliceBalancedDiv(html, match.index);
}

function sliceBalancedDiv(html: string, start: number): string {
  let depth = 1;
  let index = html.indexOf(">", start) + 1;
  while (index < html.length && depth > 0) {
    const nextOpen = html.indexOf("<div", index);
    const nextClose = html.indexOf("</div>", index);
    if (nextClose < 0) {
      return html.slice(start);
    }
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      index = nextOpen + 4;
    } else {
      depth -= 1;
      index = nextClose + 6;
    }
  }
  return html.slice(start, index);
}

function stripChrome(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<label[\s\S]*?<\/label>/gi, " ")
    .replace(/<span[^>]*print-zuil[^>]*>[\s\S]*?<\/span>/gi, " ")
    .replace(/<span[^>]*icon-s[^>]*>[\s\S]*?<\/span>/gi, " ");
}

function extractLines(html: string): string[] {
  const prepared = stripChrome(html)
    .replace(/<p[^>]*style="[^"]*display\s*:\s*none[^"]*"[^>]*>[\s\S]*?<\/p>/gi, " ")
    .replace(/<sup>(\d+)<\/sup>/gi, "^$1")
    .replace(/<\/(p|div|h1|h2|h3|li|br|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeHtml(prepared)
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .map((line) => line.replace(/^(хэвлэх|pdf|word)\s+/i, "").trim())
    .map((line) => line.replace(/^text-align\s*:\s*center">/i, "").trim())
    .map((line) => line.replace(/(\d+)\s+\.(?=\d)/g, "$1."))
    .filter((line) => line.length > 0);
}

function extractTitle(fullHtml: string, lawHtml: string, lines: string[]): string {
  const pageTitle = fullHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (pageTitle?.[1]) {
    const cleaned = decodeHtml(pageTitle[1]).replace(/\s+/g, " ").trim();
    if (cleaned.length >= 3) {
      return cleaned;
    }
  }
  const h1 = lawHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1?.[1]) {
    return decodeHtml(h1[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  }
  const named = lines.find((line) => /хууль$/i.test(line) && line === line.toUpperCase());
  return named ?? lines[0] ?? "";
}

function extractDate(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match?.[1] ? `${match[1]}T00:00:00.000Z` : null;
}

function inferDocumentType(title: string): DocumentType {
  const lower = title.toLowerCase();
  if (lower.includes("тогтоол")) {
    return DocumentType.GOVERNMENT_RESOLUTION;
  }
  if (lower.includes("тушаал")) {
    return DocumentType.MINISTERIAL_ORDER;
  }
  return DocumentType.LAW;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function makeNode(
  partial: {
    documentVersionId: string;
    parentId: string | null;
    nodeType: LegalNode["nodeType"];
    sourceLocator: string;
    title: string | null;
    text: string;
    article?: string | null;
    paragraph?: string | null;
    clause?: string | null;
    subClause?: string | null;
    chapter?: string | null;
    number?: string | null;
  },
): LegalNode {
  const node: LegalNode = {
    id: randomUUID(),
    book: null,
    part: null,
    chapter: null,
    section: null,
    article: null,
    paragraph: null,
    clause: null,
    subClause: null,
    number: null,
    ...partial,
    contentHash: "",
    children: [],
  };
  node.contentHash = sha256Hex(new TextEncoder().encode(`${node.sourceLocator}:${node.text}`));
  return node;
}
