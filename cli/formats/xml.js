// From fontra-source-control (src/formats/xml.js), same author and license.
// escapeAttribute(), escapeText() and serializeElement() at the end are added
// here.
//
// A small non-validating XML parser, enough for .glif files and XML property
// lists. Works without a DOM so it also runs under Node for tests.

export class XMLParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "XMLParseError";
  }
}

// Returns the root element as { name, attributes, children, text }, where
// children holds only elements and text is the concatenated character data.
export function parseXML(source) {
  const root = { name: "#document", attributes: {}, children: [], text: "" };
  const stack = [root];
  let index = 0;
  const length = source.length;

  while (index < length) {
    const open = source.indexOf("<", index);
    if (open < 0) {
      appendText(stack, source.slice(index));
      break;
    }
    if (open > index) {
      appendText(stack, source.slice(index, open));
    }
    if (source.startsWith("<!--", open)) {
      index = skipPast(source, "-->", open + 4);
    } else if (source.startsWith("<![CDATA[", open)) {
      const end = source.indexOf("]]>", open + 9);
      if (end < 0) {
        throw new XMLParseError("unterminated CDATA section");
      }
      stack.at(-1).text += source.slice(open + 9, end);
      index = end + 3;
    } else if (source.startsWith("<?", open)) {
      index = skipPast(source, "?>", open + 2);
    } else if (source.startsWith("<!", open)) {
      index = skipDeclaration(source, open + 2);
    } else if (source[open + 1] === "/") {
      const close = source.indexOf(">", open);
      if (close < 0) {
        throw new XMLParseError("unterminated end tag");
      }
      const name = source.slice(open + 2, close).trim();
      const element = stack.pop();
      if (!element || element.name !== name || stack.length === 0) {
        throw new XMLParseError(`unexpected </${name}>`);
      }
      index = close + 1;
    } else {
      const { element, end, selfClosing } = parseStartTag(source, open);
      stack.at(-1).children.push(element);
      if (!selfClosing) {
        stack.push(element);
      }
      index = end;
    }
  }
  if (stack.length !== 1) {
    throw new XMLParseError(`unclosed <${stack.at(-1).name}>`);
  }
  const rootElement = root.children[0];
  if (!rootElement) {
    throw new XMLParseError("no root element");
  }
  return rootElement;
}

function appendText(stack, rawText) {
  stack.at(-1).text += decodeEntities(rawText);
}

function skipPast(source, terminator, from) {
  const end = source.indexOf(terminator, from);
  if (end < 0) {
    throw new XMLParseError(`missing ${terminator}`);
  }
  return end + terminator.length;
}

// <!DOCTYPE ...> may contain a bracketed internal subset
function skipDeclaration(source, from) {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    const c = source[i];
    if (c === "[") {
      depth++;
    } else if (c === "]") {
      depth--;
    } else if (c === ">" && depth <= 0) {
      return i + 1;
    }
  }
  throw new XMLParseError("unterminated declaration");
}

const attributePattern = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/y;

function parseStartTag(source, open) {
  let i = open + 1;
  const nameMatch = /[^\s/>]+/y;
  nameMatch.lastIndex = i;
  const nameResult = nameMatch.exec(source);
  if (!nameResult) {
    throw new XMLParseError("invalid start tag");
  }
  const element = { name: nameResult[0], attributes: {}, children: [], text: "" };
  i = nameMatch.lastIndex;
  while (i < source.length) {
    while (/\s/.test(source[i])) {
      i++;
    }
    if (source[i] === ">") {
      return { element, end: i + 1, selfClosing: false };
    }
    if (source[i] === "/" && source[i + 1] === ">") {
      return { element, end: i + 2, selfClosing: true };
    }
    attributePattern.lastIndex = i;
    const match = attributePattern.exec(source);
    if (!match) {
      throw new XMLParseError(`invalid attribute in <${element.name}>`);
    }
    element.attributes[match[1]] = decodeEntities(match[3] ?? match[4]);
    i = attributePattern.lastIndex;
  }
  throw new XMLParseError(`unterminated <${element.name}>`);
}

const namedEntities = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeEntities(text) {
  if (!text.includes("&")) {
    return text;
  }
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, entity) => {
    if (entity[0] === "#") {
      const codePoint =
        entity[1] === "x"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : whole;
    }
    return namedEntities[entity] ?? whole;
  });
}

export function childElements(element, name) {
  return element.children.filter((child) => child.name === name);
}

export function firstChild(element, name) {
  return element.children.find((child) => child.name === name) ?? null;
}

const attributeEscapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

export function escapeAttribute(value) {
  return String(value).replace(/[&<>"]/g, (c) => attributeEscapes[c]);
}

export function escapeText(value) {
  return String(value).replace(/[&<>]/g, (c) => attributeEscapes[c]);
}

/**
 * Write an element parsed by parseXML() back as XML, one element per line.
 * Text content is not written (glif outlines have none).
 */
export function serializeElement(element, indent = "", step = "  ") {
  const attributes = Object.entries(element.attributes)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
  if (!element.children.length) {
    return `${indent}<${element.name}${attributes}/>`;
  }
  const children = element.children
    .map((child) => serializeElement(child, indent + step, step))
    .join("\n");
  return `${indent}<${element.name}${attributes}>\n${children}\n${indent}</${element.name}>`;
}
