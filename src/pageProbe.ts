export interface PageControl {
  role: string;
  name: string;
  visible: boolean;
  enabled: boolean;
  href: string;
}

export interface PageImage {
  alt: string | null;
  src: string;
  broken: boolean;
}

export interface PageField {
  label: string;
  type: string;
}

export interface PageLink {
  text: string;
  href: string;
  blank: boolean;
  noopener: boolean;
}

export interface PageEndpoint {
  method: string;
  url: string;
  source: string;
}

export interface PageAction {
  name: string;
  result: string;
}

export interface PageProbe {
  url: string;
  title: string;
  heading: string;
  h1: number;
  hasMain: boolean;
  https: boolean;
  passwordInUrl: boolean;
  snapshot: string;
  html: string;
  controls: PageControl[];
  images: PageImage[];
  fields: PageField[];
  links: PageLink[];
  endpoints: PageEndpoint[];
  actions: PageAction[];
}

/**
 * Runs inside the open tab. Nested on purpose: Chrome serializes this function
 * alone, so it cannot call helpers from the extension bundle.
 * Locators follow Playwright: role, accessible name, label, then visible text.
 * https://playwright.dev/docs/locators
 * The snapshot follows Playwright's aria snapshot shape.
 * https://playwright.dev/docs/aria-snapshots
 */
export function collectPage(): PageProbe {
  function clean(value: string | null | undefined): string {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function nameOf(el: Element): string {
    const labelled = el.getAttribute("aria-label");
    if (clean(labelled)) {
      return clean(labelled);
    }
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => clean(document.getElementById(id)?.textContent))
        .filter(Boolean)
        .join(" ");
      if (text) {
        return text;
      }
    }
    if (el instanceof HTMLImageElement) {
      return clean(el.getAttribute("alt"));
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (clean(label?.textContent)) {
          return clean(label?.textContent);
        }
      }
      const wrapping = el.closest("label");
      if (clean(wrapping?.textContent)) {
        return clean(wrapping?.textContent);
      }
      if (el instanceof HTMLInputElement && (el.type === "submit" || el.type === "button" || el.type === "reset")) {
        return clean(el.value);
      }
    }
    const title = clean(el.getAttribute("title"));
    if (title) {
      return title;
    }
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      return "";
    }
    return clean(el.textContent).slice(0, 120);
  }

  function roleOf(el: Element): string | null {
    const explicit = clean(el.getAttribute("role"));
    if (explicit) {
      return explicit;
    }
    const tag = el.tagName;
    if (tag === "A" && el.hasAttribute("href")) {
      return "link";
    }
    if (tag === "BUTTON") {
      return "button";
    }
    if (/^H[1-6]$/.test(tag)) {
      return "heading";
    }
    if (tag === "IMG") {
      return "img";
    }
    if (tag === "TEXTAREA") {
      return "textbox";
    }
    if (tag === "SELECT") {
      return "combobox";
    }
    if (tag === "INPUT") {
      const type = ((el as HTMLInputElement).type || "text").toLowerCase();
      if (type === "hidden" || type === "file") {
        return null;
      }
      if (type === "checkbox") {
        return "checkbox";
      }
      if (type === "radio") {
        return "radio";
      }
      if (type === "button" || type === "submit" || type === "reset") {
        return "button";
      }
      return "textbox";
    }
    if (tag === "NAV") {
      return "navigation";
    }
    if (tag === "MAIN") {
      return "main";
    }
    if (tag === "HEADER") {
      return "banner";
    }
    if (tag === "FOOTER") {
      return "contentinfo";
    }
    if (tag === "FORM") {
      return "form";
    }
    return null;
  }

  function visible(el: Element): boolean {
    if (!(el instanceof HTMLElement)) {
      return true;
    }
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    return el.getClientRects().length > 0;
  }

  function enabled(el: Element): boolean {
    if (el.getAttribute("aria-disabled") === "true") {
      return false;
    }
    return !(el as HTMLButtonElement).disabled;
  }

  function yamlQuote(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  const lines: string[] = [];
  let nodes = 0;
  const landmarks = new Set(["main", "navigation", "banner", "contentinfo", "form"]);

  function emit(el: Element, role: string, depth: number): void {
    if (nodes >= 70) {
      return;
    }
    const name = nameOf(el);
    const pad = "  ".repeat(depth);
    let line = `${pad}- ${role}`;
    if (name) {
      line += ` "${yamlQuote(name.slice(0, 80))}"`;
    }
    const flags: string[] = [];
    if (role === "heading") {
      const level = /^H([1-6])$/.test(el.tagName) ? el.tagName.slice(1) : el.getAttribute("aria-level") || "1";
      flags.push(`level=${level}`);
    }
    if (!enabled(el) && (role === "button" || role === "textbox" || role === "link")) {
      flags.push("disabled");
    }
    if (flags.length) {
      line += ` [${flags.join("] [")}]`;
    }
    if (role === "link") {
      const href = (el as HTMLAnchorElement).href || el.getAttribute("href") || "";
      lines.push(`${line}:`);
      lines.push(`${pad}  - /url: ${href}`);
    } else {
      lines.push(line);
    }
    nodes += 1;
  }

  function walk(el: Element, depth: number): void {
    if (nodes >= 70 || depth > 5) {
      return;
    }
    const role = roleOf(el);
    if (role === "img" && el.getAttribute("alt") === "") {
      return;
    }
    if (role) {
      emit(el, role, depth);
      if (!landmarks.has(role)) {
        return;
      }
    }
    for (const child of Array.from(el.children)) {
      walk(child, role && landmarks.has(role) ? depth + 1 : depth);
    }
  }

  if (document.body) {
    walk(document.body, 0);
  }

  const controls: PageControl[] = [];
  const seen = new Set<Element>();
  for (const el of Array.from(document.querySelectorAll("a[href], button, input, textarea, select, [role='button'], [role='link'], [role='textbox']"))) {
    if (seen.has(el) || controls.length >= 40) {
      continue;
    }
    const role = roleOf(el);
    if (!role || role === "img") {
      continue;
    }
    seen.add(el);
    controls.push({
      role,
      name: nameOf(el),
      visible: visible(el),
      enabled: enabled(el),
      href: el instanceof HTMLAnchorElement ? el.href : "",
    });
  }

  const images: PageImage[] = [];
  for (const img of Array.from(document.querySelectorAll("img"))) {
    if (images.length >= 20) {
      break;
    }
    const src = img.currentSrc || img.src || img.getAttribute("src") || "";
    images.push({
      alt: img.hasAttribute("alt") ? img.getAttribute("alt") || "" : null,
      src: src.slice(0, 180),
      broken: Boolean(src) && img.complete && img.naturalWidth === 0,
    });
  }

  const fields: PageField[] = [];
  for (const field of Array.from(document.querySelectorAll("input, textarea, select"))) {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) {
      continue;
    }
    if (field instanceof HTMLInputElement && (field.type === "hidden" || field.type === "submit" || field.type === "button")) {
      continue;
    }
    if (fields.length >= 20) {
      break;
    }
    fields.push({ label: nameOf(field), type: field instanceof HTMLInputElement ? field.type : field.tagName.toLowerCase() });
  }

  const links: PageLink[] = [];
  for (const link of Array.from(document.querySelectorAll("a[href]"))) {
    if (links.length >= 30) {
      break;
    }
    const rel = (link.getAttribute("rel") || "").toLowerCase();
    links.push({
      text: nameOf(link),
      href: (link as HTMLAnchorElement).href || link.getAttribute("href") || "",
      blank: link.getAttribute("target") === "_blank",
      noopener: rel.includes("noopener") || rel.includes("noreferrer"),
    });
  }

  const endpoints: PageEndpoint[] = [];
  const seenUrls = new Set<string>();
  function addEndpoint(method: string, raw: string, source: string): void {
    if (endpoints.length >= 8 || !raw) {
      return;
    }
    let url = raw;
    try {
      url = new URL(raw, location.href).href;
    } catch {
      return;
    }
    if (!/^https?:/i.test(url) || seenUrls.has(`${method} ${url}`)) {
      return;
    }
    if (/google-analytics|googletagmanager|doubleclick|facebook\.com|hotjar|segment\.io|sentry\.io|fonts\.googleapis/i.test(url)) {
      return;
    }
    if (/\.(png|jpe?g|gif|svg|webp|css|woff2?|ico|map)(\?|$)/i.test(url)) {
      return;
    }
    seenUrls.add(`${method} ${url}`);
    endpoints.push({ method: method.toUpperCase(), url, source });
  }

  for (const entry of performance.getEntriesByType("resource")) {
    const resource = entry as PerformanceResourceTiming;
    if (resource.initiatorType === "fetch" || resource.initiatorType === "xmlhttprequest") {
      addEndpoint("GET", resource.name, "the page requested it");
    }
  }
  const scriptText = Array.from(document.scripts)
    .map((script) => script.textContent || "")
    .join("\n")
    .slice(0, 150000);
  for (const match of scriptText.matchAll(/fetch\(\s*['"`]([^'"`]+)['"`]/g)) {
    addEndpoint("GET", match[1] || "", "fetch() in the page script");
  }
  for (const match of scriptText.matchAll(/axios\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi)) {
    addEndpoint(match[1] || "GET", match[2] || "", "axios in the page script");
  }
  for (const match of scriptText.matchAll(/\.open\(\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]\s*,\s*['"`]([^'"`]+)['"`]/gi)) {
    addEndpoint(match[1] || "GET", match[2] || "", "XMLHttpRequest in the page script");
  }

  const actions: PageAction[] = [];
  const startUrl = location.href;
  const landmarksOnPage = document.querySelectorAll("main, nav, header, footer, form, h1, h2");
  let scrolled = 0;
  for (const landmark of Array.from(landmarksOnPage)) {
    if (scrolled >= 6) {
      break;
    }
    landmark.scrollIntoView({ block: "center", inline: "nearest" });
    scrolled += 1;
  }
  let focused = 0;
  for (const field of Array.from(document.querySelectorAll("input, textarea, select"))) {
    if (focused >= 4 || !(field instanceof HTMLElement)) {
      continue;
    }
    if (field instanceof HTMLInputElement && (field.type === "hidden" || field.type === "password")) {
      continue;
    }
    field.focus();
    focused += 1;
  }
  const safeName = /^(menu|open|close|more|next|show|details|expand)$/i;
  let clicked = 0;
  for (const button of Array.from(document.querySelectorAll("button, [role='button']"))) {
    if (clicked >= 2 || !(button instanceof HTMLElement)) {
      continue;
    }
    const name = nameOf(button);
    if (!safeName.test(name)) {
      continue;
    }
    if (button.closest("form") && button.getAttribute("type") !== "button") {
      continue;
    }
    const before = location.href;
    button.click();
    clicked += 1;
    const changed = location.href !== before;
    actions.push({
      name: name || "unnamed control",
      result: changed ? "The page moved to another address." : "The control stayed on this page.",
    });
    if (changed && location.origin === new URL(startUrl).origin) {
      history.back();
    }
    if (location.href !== startUrl) {
      break;
    }
  }
  actions.unshift({
    name: "Walk",
    result: `Scrolled ${scrolled} section${scrolled === 1 ? "" : "s"} into view and focused ${focused} field${focused === 1 ? "" : "s"}.`,
  });

  const headings = Array.from(document.querySelectorAll("h1")).map((heading) => clean(heading.textContent)).filter(Boolean);
  return {
    url: location.href,
    title: clean(document.title),
    heading: headings[0] || "",
    h1: headings.length,
    hasMain: Boolean(document.querySelector("main, [role='main']")),
    https: location.protocol === "https:",
    passwordInUrl: /[?&](password|passwd|pwd)=/i.test(location.href),
    snapshot: lines.join("\n").slice(0, 6000),
    html: document.documentElement.outerHTML.slice(0, 280000),
    controls,
    images,
    fields,
    links,
    endpoints,
    actions,
  };
}
