/**
 * SportSync - Logo Component
 *
 * Consistent branding across the entire app.
 * "Sport" in accent blue, "Sync" in white.
 * Optional S icon from favicon.svg.
 *
 * Used on: Landing, Login, Register, Navbar, Footer, legal pages.
 */
import { Link } from "react-router-dom";
import { ROUTES } from "../constants";

interface LogoProps {
  size?: "sm" | "md" | "lg" | "xl";
  showIcon?: boolean;
  linkTo?: string | null;
}

const SIZES = {
  sm: { text: "text-lg", icon: "w-5 h-5", gap: "gap-1.5" },
  md: { text: "text-xl", icon: "w-6 h-6", gap: "gap-2" },
  lg: { text: "text-3xl", icon: "w-8 h-8", gap: "gap-2.5" },
  xl: { text: "text-5xl sm:text-6xl", icon: "w-12 h-12", gap: "gap-3" },
};

export default function Logo({ size = "md", showIcon = true, linkTo = ROUTES.HOME }: LogoProps) {
  const s = SIZES[size];

  const content = (
    <span className={`inline-flex items-center ${s.gap} font-bold`}>
      {showIcon && (
        <img
          src="/favicon.svg"
          alt="SportSync logo"
          className={s.icon}
        />
      )}
      <span>
        <span className="text-accent">Sport</span>
        <span className="text-foreground">Sync</span>
      </span>
    </span>
  );

  if (linkTo) {
    return <Link to={linkTo} className={s.text}>{content}</Link>;
  }

  return <span className={s.text}>{content}</span>;
}
