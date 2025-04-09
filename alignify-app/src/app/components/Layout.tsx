'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const isActive = (path: string) => {
    return pathname === path;
  };

  return (
    <div className="flex h-screen">
      {/* Navigation Sidebar */}
      <nav className="w-64 bg-gray-200 p-6 flex flex-col">
        <div className="space-y-6">
          <Link 
            href="/dashboard" 
            className={`block p-4 rounded-lg text-lg font-semibold ${
              isActive('/dashboard') ? 'bg-white shadow-md' : 'hover:bg-gray-300'
            }`}
          >
            Dashboard
          </Link>
          <Link 
            href="/workouts" 
            className={`block p-4 rounded-lg text-lg font-semibold ${
              isActive('/workouts') ? 'bg-white shadow-md' : 'hover:bg-gray-300'
            }`}
          >
            Workouts
          </Link>
          <Link 
            href="/plans" 
            className={`block p-4 rounded-lg text-lg font-semibold ${
              isActive('/plans') ? 'bg-white shadow-md' : 'hover:bg-gray-300'
            }`}
          >
            Plans
          </Link>
          <Link 
            href="/settings" 
            className={`block p-4 rounded-lg text-lg font-semibold ${
              isActive('/settings') ? 'bg-white shadow-md' : 'hover:bg-gray-300'
            }`}
          >
            Settings
          </Link>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6">
          {/* Search Bar */}
          <div className="mb-8 flex justify-between items-center">
            <div className="text-2xl font-bold">Search Bar Stuff</div>
            <div className="w-10 h-10 bg-gray-300 rounded-full"></div> {/* Profile placeholder */}
          </div>
          
          {children}
        </div>
      </main>
    </div>
  );
} 