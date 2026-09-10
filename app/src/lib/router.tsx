import { useEffect, useState } from "react";

/**
 * Hash routing. The portal is a static bundle with no server to rewrite paths, so
 * `#/app/p/2001` survives a reload and a shared link on any host.
 */

function current(): string[] {
  return window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
}

export function useRoute(): string[] {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const on = () => {
      setRoute(current());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function href(path: string): string {
  return `#${path.startsWith("/") ? path : `/${path}`}`;
}

export function go(path: string) {
  window.location.hash = href(path);
}

export function Link({
  to, className, children, ...rest
}: { to: string; className?: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={href(to)} className={className} {...rest}>
      {children}
    </a>
  );
}
