interface PrimaryButtonProps {
  text: string;
  type?: "button" | "submit";
}

export default function PrimaryButton({ text, type = "button" }: PrimaryButtonProps) {
  return (
    <button
      type={type}
      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-all duration-150"
    >
      {text}
    </button>
  );
}
