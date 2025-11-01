export default function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-gray-900/80 backdrop-blur-xl border border-gray-800 shadow-xl rounded-2xl p-10 w-[380px]">
      {children}
    </div>
  );
}
