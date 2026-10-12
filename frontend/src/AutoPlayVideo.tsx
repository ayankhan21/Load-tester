import { useEffect, useRef } from "react";

// Start downloading when the video is within this distance of the viewport, so
// it is ready by the time the user scrolls to it.
const PRELOAD_MARGIN = "1500px";

// Loads ahead of the viewport, plays while at least half the video is on
// screen, and pauses otherwise. Muted + playsInline are required for browsers
// to allow autoplay.
export function AutoPlayVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    const preloader = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          video.preload = "auto";
          // Setting preload after load has been suppressed is not enough in
          // every browser; load() starts the fetch explicitly.
          video.load();
          preloader.disconnect();
        }
      },
      { rootMargin: PRELOAD_MARGIN },
    );

    const player = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // play() rejects if the browser blocks autoplay; controls remain.
          video.play().catch(() => undefined);
        } else {
          video.pause();
        }
      },
      { threshold: 0.5 },
    );

    // Watch the post card, not the video: content-visibility skips off-screen
    // card contents, so the video has no box there but the card still does.
    preloader.observe(video.closest("article") ?? video);
    player.observe(video);
    return () => {
      preloader.disconnect();
      player.disconnect();
    };
  }, []);

  return (
    <video
      ref={ref}
      className="post-media video"
      src={src}
      width={640}
      height={360}
      controls
      loop
      muted
      playsInline
      preload="none"
    />
  );
}
