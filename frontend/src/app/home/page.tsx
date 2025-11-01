import Image from "next/image";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center">
      <Image
        src="/images/logo.png"
        alt="SportSync Logo"
        width={80}
        height={80}
        className="mb-6"
      />
      <h1 className="text-4xl font-extrabold tracking-tight mb-2">
        Welcome to <span className="text-blue-500">SportSync</span>
      </h1>
      <p className="text-gray-400 text-lg mb-8">
        Explore real-time stats, highlights, and sports insights.
      </p>
      <button className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl font-semibold transition">
        Go to Dashboard →
      </button>
    </div>
  );
}
