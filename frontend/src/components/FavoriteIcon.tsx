type FavoriteIconProps = {
  className?: string;
  filled?: boolean;
};

export default function FavoriteIcon({
  className = "w-4 h-4",
  filled = false,
}: FavoriteIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3.75l2.58 5.23 5.77.84-4.17 4.06.98 5.74L12 16.91 6.84 19.62l.98-5.74-4.17-4.06 5.77-.84L12 3.75z" />
    </svg>
  );
}
