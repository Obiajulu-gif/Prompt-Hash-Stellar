const AVATAR_STORAGE_KEY = "ph_user_avatars";

export function getProfileAvatarUrl(address: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AVATAR_STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw);
    return map[address] || null;
  } catch {
    return null;
  }
}

export function saveProfileAvatarUrl(address: string, url: string) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(AVATAR_STORAGE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[address] = url;
    localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(map));
    // Dispatch a custom event to notify components across the app to re-render
    window.dispatchEvent(new Event("avatar_updated"));
  } catch (e) {
    console.error("Failed to save avatar", e);
  }
}
