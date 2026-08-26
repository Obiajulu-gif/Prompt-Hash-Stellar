export interface ClipboardResult {
  success: boolean;
  error?: string;
}

export async function copyToClipboard(content: string): Promise<ClipboardResult> {
  if (!content) {
    return { success: false, error: "No content to copy." };
  }

  if (!navigator?.clipboard) {
    return {
      success: false,
      error: "Clipboard API not available in this browser.",
    };
  }

  try {
    await navigator.clipboard.writeText(content);
    return { success: true };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to copy to clipboard.";

    if (message.includes("denied") || message.includes("permission")) {
      return {
        success: false,
        error: "Clipboard access denied. Check browser permissions.",
      };
    }

    if (message.includes("NotSupported")) {
      return {
        success: false,
        error: "Clipboard not supported for this content type.",
      };
    }

    return { success: false, error: "Failed to copy to clipboard." };
  }
}
