import type { PageProbe } from "./pageProbe";
import type { TestCase, TestReport } from "./protocol";

export interface CallFact {
  method: string;
  url: string;
  status?: number;
  body?: string;
  error?: string;
  sent: boolean;
  source: string;
}

export interface CookieFact {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
}

export interface PageCheckInput {
  discipline: string;
  focus: string;
  probe: PageProbe;
  calls: CallFact[];
  cookies: CookieFact[];
}

const SESSION_COOKIE = /sess|sid|token|auth|jwt/i;

export function buildPageReport(input: PageCheckInput): TestReport {
  const discipline = input.discipline.toLowerCase();
  if (discipline.includes("api")) {
    return finish(apiCases(input), input.focus);
  }
  if (discipline.includes("security")) {
    return finish(securityCases(input), input.focus);
  }
  return finish(functionalCases(input), input.focus);
}

function finish(cases: TestCase[], focus: string): TestReport {
  const counts = { pass: 0, fail: 0, blocked: 0 };
  for (const testCase of cases) {
    counts[testCase.status] += 1;
  }
  const firstFail = cases.find((testCase) => testCase.status === "fail");
  const focusLine = focus.trim() ? ` Focus: ${focus.trim()}.` : "";
  const fix = firstFail ? ` The first thing to fix is "${firstFail.title}".` : "";
  return {
    summary: `${counts.pass} passed, ${counts.fail} failed, ${counts.blocked} blocked.${fix}${focusLine}`,
    cases,
  };
}

function functionalCases(input: PageCheckInput): TestCase[] {
  const { probe } = input;
  const cases: TestCase[] = [];
  cases.push({
    id: "FT-01",
    title: "The page has a title",
    status: probe.title ? "pass" : "fail",
    expected: "The browser tab shows a title that says what this page is.",
    actual: probe.title ? `The title is "${probe.title}".` : "The title is empty.",
    evidence: probe.url,
    improvement: probe.title ? undefined : "Add a title that names the page.",
  });
  cases.push({
    id: "FT-02",
    title: "A person can find a heading",
    status: probe.h1 === 1 ? "pass" : "fail",
    expected: "The page has one main heading.",
    actual: probe.h1 === 0 ? "No heading was found." : probe.h1 === 1 ? `The heading is "${probe.heading}".` : `The page has ${probe.h1} main headings.`,
    evidence: probe.hasMain ? "A main area is present." : "No main area was found.",
    improvement: probe.h1 === 1 ? undefined : "Keep a single heading that states what the page is for.",
  });

  const unnamed = probe.controls.filter((control) => (control.role === "button" || control.role === "link") && control.visible && !control.name);
  cases.push({
    id: "FT-03",
    title: "Buttons and links have a name",
    status: unnamed.length ? "fail" : "pass",
    expected: "Every visible button and link has a name a person can find.",
    actual: unnamed.length
      ? `${unnamed.length} visible control${unnamed.length === 1 ? " has" : "s have"} no name.`
      : probe.controls.length
        ? `${probe.controls.length} controls have a name.`
        : "This page has no buttons or links.",
    evidence: "Playwright locators: role and accessible name.",
    improvement: unnamed.length ? "Give each control a visible label or an accessible name." : undefined,
  });

  const pictures = probe.images.filter((image) => image.alt === null || image.broken);
  if (probe.images.length) {
    cases.push({
      id: "FT-04",
      title: "Pictures have a description",
      status: pictures.length ? "fail" : "pass",
      expected: "Each picture has a description, or is marked as decorative. Loaded pictures are visible.",
      actual: pictures.length
        ? pictures
            .slice(0, 4)
            .map((image) => (image.broken ? `Broken picture ${image.src}` : `Missing description ${image.src}`))
            .join(" ")
        : `${probe.images.length} picture${probe.images.length === 1 ? "" : "s"} checked.`,
      evidence: probe.images
        .slice(0, 4)
        .map((image) => image.src || "inline picture")
        .join("\n"),
      improvement: pictures.length ? "Add a short description, or mark a decorative picture with an empty alt." : undefined,
    });
  }

  const unlabeled = probe.fields.filter((field) => !field.label && field.type !== "hidden");
  if (probe.fields.length) {
    cases.push({
      id: "FT-05",
      title: "Fields have a label",
      status: unlabeled.length ? "fail" : "pass",
      expected: "Every field has a label, not only a placeholder.",
      actual: unlabeled.length
        ? `${unlabeled.length} field${unlabeled.length === 1 ? "" : "s"} ${unlabeled.length === 1 ? "has" : "have"} no label (${unlabeled.map((field) => field.type).join(", ")}).`
        : `${probe.fields.length} field${probe.fields.length === 1 ? "" : "s"} have a label.`,
      evidence: "Label, aria-label, or aria-labelledby.",
      improvement: unlabeled.length ? "Connect a label to each field." : undefined,
    });
  }

  const deadLinks = probe.links.filter((link) => !link.href || link.href.endsWith("#") || link.href.startsWith("javascript:"));
  if (probe.links.length) {
    cases.push({
      id: "FT-06",
      title: "Links go somewhere",
      status: deadLinks.length ? "fail" : "pass",
      expected: "Each link has an address.",
      actual: deadLinks.length
        ? `${deadLinks.length} link${deadLinks.length === 1 ? "" : "s"} do not go anywhere${deadLinks[0]?.text ? `, including "${deadLinks[0].text}"` : ""}.`
        : `${probe.links.length} link${probe.links.length === 1 ? "" : "s"} have an address.`,
      evidence: deadLinks
        .slice(0, 4)
        .map((link) => link.href || "(empty)")
        .join("\n") || probe.url,
      improvement: deadLinks.length ? "Point each link at the page it should open." : undefined,
    });
  }

  const walk = probe.actions.map((action) => `${action.name}: ${action.result}`).join(" ");
  cases.push({
    id: cases.length < 9 ? `FT-0${cases.length + 1}` : "FT-08",
    title: "NextOps moved through the page",
    status: "pass",
    expected: "The open tab is scrolled, fields can take focus, and only safe controls are pressed.",
    actual: walk || "The page had no sections to move through.",
    evidence: probe.snapshot ? `Aria snapshot:\n${probe.snapshot.split("\n").slice(0, 12).join("\n")}` : probe.url,
  });
  return cases.slice(0, 8).map((testCase, index) => stripEmpty({ ...testCase, id: `FT-0${index + 1}` }));
}

function apiCases(input: PageCheckInput): TestCase[] {
  const calls: CallFact[] = input.calls.length
    ? input.calls
    : input.probe.endpoints.map((endpoint) => ({
        method: endpoint.method,
        url: endpoint.url,
        sent: false,
        source: endpoint.source,
      }));
  if (!calls.length) {
    return [
      stripEmpty({
        id: "AT-01",
        title: "No API was found on this page",
        status: "blocked",
        expected: "The page calls an API NextOps can compare.",
        actual: "No fetch, XHR, or axios call was found in this tab.",
        evidence: input.probe.url,
        improvement: "Open the screen that loads data, then run API testing again.",
      }),
    ];
  }
  return calls.slice(0, 6).map((call, index) => {
    const path = shortUrl(call.url);
    const sent = call.sent;
    let status: TestCase["status"] = "blocked";
    if (sent && call.error) {
      status = "fail";
    } else if (sent && typeof call.status === "number") {
      status = call.status >= 200 && call.status < 400 ? "pass" : "fail";
    }
    const actual = !sent
      ? call.body || `${call.method} was not sent. A request that changes data stays in the collection until you choose to run it.`
      : call.error
        ? `The call failed: ${call.error}`
        : `${call.status}. ${call.body || "The response had no body."}`;
    return stripEmpty({
      id: `AT-0${index + 1}`,
      title: `${call.method} ${path}`,
      status,
      expected: "The page calls this address and can use a successful response.",
      actual,
      evidence: `${call.source}\n${call.method} ${call.url}`,
      improvement:
        status === "fail"
          ? "Point this call at a working address, or show the failure on the page instead of ignoring it."
          : status === "blocked"
            ? "Run this request from the Postman collection with a test account before treating it as passed."
            : undefined,
    });
  });
}

function securityCases(input: PageCheckInput): TestCase[] {
  const { probe, cookies } = input;
  const cases: TestCase[] = [];
  cases.push({
    id: "ST-01",
    title: "The page uses a protected connection",
    status: probe.https ? "pass" : "fail",
    expected: "The page is opened over HTTPS.",
    actual: probe.https ? "The address uses HTTPS." : "The address uses HTTP.",
    evidence: probe.url,
    improvement: probe.https ? undefined : "Serve this page over HTTPS.",
  });
  cases.push({
    id: "ST-02",
    title: "The address does not carry a password",
    status: probe.passwordInUrl ? "fail" : "pass",
    expected: "A password is never put in the address.",
    actual: probe.passwordInUrl ? "The address contains a password field." : "The address has no password field.",
    evidence: probe.url.split("?")[0] || probe.url,
    improvement: probe.passwordInUrl ? "Send the password in the request body over HTTPS, never in the address." : undefined,
  });

  const sessionCookies = cookies.filter((cookie) => SESSION_COOKIE.test(cookie.name));
  const weak = sessionCookies.filter((cookie) => !cookie.secure || !cookie.httpOnly);
  if (!cookies.length) {
    cases.push({
      id: "ST-03",
      title: "Session cookies are protected",
      status: "blocked",
      expected: "A session cookie is marked Secure and HttpOnly.",
      actual: "This page did not set a cookie NextOps could see.",
      evidence: probe.url,
      improvement: "If this page starts a session, set that cookie as Secure and HttpOnly.",
    });
  } else if (!sessionCookies.length) {
    cases.push({
      id: "ST-03",
      title: "Session cookies are protected",
      status: "pass",
      expected: "A session cookie is marked Secure and HttpOnly.",
      actual: `${cookies.length} cookie${cookies.length === 1 ? "" : "s"} set, and none use a session name.`,
      evidence: cookies.map((cookie) => cookie.name).join(", "),
    });
  } else {
    cases.push({
      id: "ST-03",
      title: "Session cookies are protected",
      status: weak.length ? "fail" : "pass",
      expected: "A session cookie is marked Secure and HttpOnly.",
      actual: weak.length
        ? weak.map((cookie) => `${cookie.name} is missing ${[!cookie.secure ? "Secure" : "", !cookie.httpOnly ? "HttpOnly" : ""].filter(Boolean).join(" and ")}.`).join(" ")
        : sessionCookies.map((cookie) => `${cookie.name} is Secure and HttpOnly.`).join(" "),
      evidence: sessionCookies.map((cookie) => `${cookie.name} sameSite=${cookie.sameSite || "unspecified"}`).join("\n"),
      improvement: weak.length ? "Mark the session cookie Secure and HttpOnly, and use SameSite=Lax or Strict." : undefined,
    });
  }

  const unsafeBlank = probe.links.filter((link) => link.blank && !link.noopener);
  cases.push({
    id: "ST-04",
    title: "New tabs do not keep a handle on this page",
    status: unsafeBlank.length ? "fail" : "pass",
    expected: "A link that opens a new tab uses rel=noopener.",
    actual: unsafeBlank.length
      ? `${unsafeBlank.length} link${unsafeBlank.length === 1 ? "" : "s"} open a new tab without noopener.`
      : "No link opens a new tab without noopener.",
    evidence: unsafeBlank
      .slice(0, 4)
      .map((link) => link.href)
      .join("\n") || probe.url,
    improvement: unsafeBlank.length ? "Add rel=\"noopener\" to links that open a new tab." : undefined,
  });

  const passwordFields = probe.fields.filter((field) => field.type === "password");
  if (passwordFields.length) {
    const unlabeled = passwordFields.filter((field) => !field.label);
    cases.push({
      id: "ST-05",
      title: "Password fields are labeled",
      status: unlabeled.length ? "fail" : "pass",
      expected: "Each password field has a label and is not sent in the address.",
      actual: unlabeled.length
        ? `${unlabeled.length} password field${unlabeled.length === 1 ? "" : "s"} have no label.`
        : `${passwordFields.length} password field${passwordFields.length === 1 ? "" : "s"} have a label.`,
      evidence: "Password fields stay on the page. NextOps does not submit them.",
      improvement: unlabeled.length ? "Add a label to the password field so the browser and the person can tell what it is." : undefined,
    });
  }
  return cases.map(stripEmpty);
}

function shortUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.pathname || "/"}${url.search}` || url.host;
  } catch {
    return value;
  }
}

function stripEmpty(testCase: TestCase): TestCase {
  if (!testCase.improvement?.trim()) {
    const { improvement: _omit, ...rest } = testCase;
    return rest;
  }
  return testCase;
}
