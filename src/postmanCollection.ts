import type { CallFact } from "./pageReport";

export interface PostmanCollection {
  info: { name: string; description: string; schema: string };
  item: Array<{ name: string; request: { method: string; url: string; description: string } }>;
}

/** Postman Collection v2.1, the shape POST /collections accepts. */
export function postmanCollection(name: string, calls: CallFact[]): PostmanCollection {
  return {
    info: {
      name,
      description: "Collected by Verity from the open page.",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: calls.map((call) => ({
      name: `${call.method} ${call.url}`,
      request: {
        method: call.method,
        url: call.url,
        description: call.sent
          ? `Verity called this from the open page. Status ${call.status ?? "unknown"}. ${call.source}`
          : `Verity did not send this, because it could change data. ${call.source}`,
      },
    })),
  };
}

/** Creates the collection in the caller's Postman workspace. https://learning.postman.com/docs/reference/postman-api/authentication */
export async function savePostmanCollection(apiKey: string, collection: PostmanCollection, workspaceId?: string): Promise<string> {
  const url = new URL("https://api.getpostman.com/collections");
  if (workspaceId) {
    url.searchParams.set("workspace", workspaceId);
  }
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
    },
    body: JSON.stringify({ collection }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Postman returned ${response.status}.`);
  }
  const payload = JSON.parse(text) as { collection?: { uid?: string; id?: string } };
  const id = payload.collection?.uid || payload.collection?.id;
  if (!id) {
    throw new Error("Postman did not return a collection id.");
  }
  return id;
}
