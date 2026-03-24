import { useEffect, useState } from "react";
import type { ReactNode } from "react";

type SafeAvatarProps = {
  src?: string | null;
  alt?: string;
  className?: string;
  imgClassName?: string;
  fallback: ReactNode;
  loadingContent?: ReactNode;
};

export default function SafeAvatar({
  src,
  alt = "",
  className = "",
  imgClassName = "",
  fallback,
  loadingContent,
}: SafeAvatarProps) {
  const [status, setStatus] = useState<"empty" | "loading" | "ready" | "error">(
    src ? "loading" : "empty",
  );

  useEffect(() => {
    let active = true;

    if (!src) {
      setStatus("empty");
      return () => {
        active = false;
      };
    }

    setStatus("loading");
    const image = new window.Image();
    image.onload = () => {
      if (active) {
        setStatus("ready");
      }
    };
    image.onerror = () => {
      if (active) {
        setStatus("error");
      }
    };
    image.src = src;

    if (image.complete && image.naturalWidth > 0) {
      setStatus("ready");
    }

    return () => {
      active = false;
    };
  }, [src]);

  return (
    <div className={className}>
      {status === "ready" && src ? (
        <img src={src} alt={alt} className={`${imgClassName} img-fade-in`} />
      ) : status === "loading" ? (
        loadingContent ?? fallback
      ) : (
        fallback
      )}
    </div>
  );
}
