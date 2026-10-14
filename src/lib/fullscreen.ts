/**
 * Fullscreen API with the Safari (webkit-prefixed) fallback. Every function is
 * safe to call where fullscreen isn't available (e.g. iPhone Safari, which only
 * allows it for video): they just do nothing / return false.
 */
type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export function fullscreenSupported(): boolean {
  const d = document as FsDocument;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  const d = document as FsDocument;
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
}

/** Resolves true if the element went fullscreen. Must run from a user gesture. */
export async function enterFullscreen(el: HTMLElement): Promise<boolean> {
  try {
    const e = el as FsElement;
    if (e.requestFullscreen) await e.requestFullscreen({ navigationUI: "hide" });
    else if (e.webkitRequestFullscreen) await e.webkitRequestFullscreen();
    else return false;
    return true;
  } catch {
    return false;
  }
}

export async function exitFullscreen(): Promise<void> {
  try {
    const d = document as FsDocument;
    if (!isFullscreen()) return;
    if (d.exitFullscreen) await d.exitFullscreen();
    else if (d.webkitExitFullscreen) await d.webkitExitFullscreen();
  } catch {
    /* already left */
  }
}

/** Returns an unsubscribe function. */
export function onFullscreenChange(cb: () => void): () => void {
  document.addEventListener("fullscreenchange", cb);
  document.addEventListener("webkitfullscreenchange", cb);
  return () => {
    document.removeEventListener("fullscreenchange", cb);
    document.removeEventListener("webkitfullscreenchange", cb);
  };
}
