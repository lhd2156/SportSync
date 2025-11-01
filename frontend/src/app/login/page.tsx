"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  // const [email, setEmail] = useState("");
  // const [password, setPassword] = useState("");
  // const [staySignedIn, setStaySignedIn] = useState(true);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();

    // 👇 Temporary direct navigation (bypasses auth check)
    router.push("/home");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-black via-gray-950 to-[#0b0e19] text-white">
      <div className="bg-[#121212]/95 p-12 rounded-3xl shadow-[0_0_40px_rgba(0,0,0,0.4)] w-full max-w-md border border-gray-800/50 backdrop-blur-md transition-transform hover:scale-[1.01] duration-300">
        
        {/* Logo + Brand Title */}
        <div className="flex items-center justify-center space-x-3 mb-8">
          <Image
            src="/images/shortlogo.png"
            alt="SportSync Logo"
            width={48}
            height={48}
            className="select-none"
            unoptimized
            priority
          />
          <h1 className="text-4xl font-extrabold tracking-tight text-white">
            SportSync
          </h1>
        </div>

        {/* Tabs */}
        <div className="flex justify-center mb-8 space-x-10 text-sm font-semibold tracking-wide">
          <button className="border-b-2 border-blue-500 pb-1 text-white">
            SIGN IN
          </button>
          <button className="text-gray-400 hover:text-white transition-colors">
            SIGN UP
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="space-y-5">
          {/* 
          <div>
            <input
              type="email"
              placeholder="Username or Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-3.5 rounded-full bg-[#1f1f1f] text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 transition-all duration-200"
              required
            />
          </div>

          <div>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3.5 rounded-full bg-[#1f1f1f] text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 transition-all duration-200"
              required
            />
          </div>

          <div className="flex items-center text-gray-400 text-sm mt-2">
            <input
              type="checkbox"
              id="staySignedIn"
              checked={staySignedIn}
              onChange={() => setStaySignedIn(!staySignedIn)}
              className="mr-2 accent-blue-600"
            />
            <label htmlFor="staySignedIn">Stay signed in</label>
          </div>
          */}

          {/* Button */}
          <button
            type="submit"
            className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white font-semibold rounded-full transition-transform duration-150 shadow-[0_4px_20px_rgba(37,99,235,0.4)]"
          >
            SIGN IN
          </button>
        </form>

        <div className="text-center mt-6 text-gray-500 text-sm">
          <a href="#" className="hover:text-blue-400">
            Forgot Password?
          </a>
        </div>
      </div>
    </div>
  );
}
