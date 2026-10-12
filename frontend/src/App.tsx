import { useEffect, useState } from "react";
import { FeedPage } from "./FeedPage";
import { ProfilePage } from "./ProfilePage";

const VIEWER_KEY = "viewerId";

function readViewerId(): number {
  try {
    const stored = Number(localStorage.getItem(VIEWER_KEY));
    if (Number.isInteger(stored) && stored > 0) return stored;
  } catch {
    // localStorage unavailable; fall through to the default.
  }
  return 1;
}

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  const [viewerId, setViewerId] = useState(readViewerId);
  const [draft, setDraft] = useState(String(viewerId));

  const switchViewer = (event: React.FormEvent) => {
    event.preventDefault();
    const next = Number(draft);
    if (!Number.isInteger(next) || next <= 0) return;
    try {
      localStorage.setItem(VIEWER_KEY, String(next));
    } catch {
      // Not persisted; still works for this session.
    }
    setViewerId(next);
  };

  const profileMatch = hash.match(/^#\/users\/(\d+)$/);

  return (
    <>
      <header className="topbar">
        <a className="brand" href="#/">
          Social Load Lab
        </a>
        <form className="viewer" onSubmit={switchViewer}>
          <label>
            Viewing as user #
            <input
              type="number"
              min={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <button type="submit">Switch</button>
        </form>
      </header>
      <main className="container">
        {profileMatch ? (
          <ProfilePage
            key={`${viewerId}:${profileMatch[1]}`}
            viewerId={viewerId}
            userId={Number(profileMatch[1])}
          />
        ) : (
          <FeedPage key={viewerId} viewerId={viewerId} />
        )}
      </main>
    </>
  );
}
