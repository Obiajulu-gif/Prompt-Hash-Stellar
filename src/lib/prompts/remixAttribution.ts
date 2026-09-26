const STORAGE_KEY = "prompthash:remix-attributions:v1";

type AttributionIndex = Record<string, string>;

function readIndex(): AttributionIndex {
  if (typeof window === "undefined") return {};

  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getSourcePromptId(
  promptId: string | bigint,
): string | undefined {
  return readIndex()[String(promptId)];
}

export function saveRemixAttribution(
  promptId: string | bigint,
  sourcePromptId: string | bigint,
): void {
  if (typeof window === "undefined") return;

  const index = readIndex();
  index[String(promptId)] = String(sourcePromptId);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(index));
}
