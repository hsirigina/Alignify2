import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const pathname = usePathname();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { currentUser, logout } = useAuth();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
      setDropdownOpen(false);
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-60 bg-gray-200 p-6 flex flex-col space-y-8">
        <Link href="/dashboard" 
          className={`p-3 rounded-full text-center font-medium ${
            pathname === '/dashboard' ? 'bg-white shadow-md' : 'bg-transparent hover:bg-gray-300'
          }`}
        >
          Dashboard
        </Link>
        <Link href="/workouts"
          className={`p-3 rounded-full text-center font-medium ${
            pathname === '/workouts' ? 'bg-white shadow-md' : 'bg-transparent hover:bg-gray-300'
          }`}
        >
          Workouts
        </Link>
        <Link href="/plans"
          className={`p-3 rounded-full text-center font-medium ${
            pathname === '/plans' ? 'bg-white shadow-md' : 'bg-transparent hover:bg-gray-300'
          }`}
        >
          Plans
        </Link>
        <Link href="/settings"
          className={`p-3 rounded-full text-center font-medium ${
            pathname === '/settings' ? 'bg-white shadow-md' : 'bg-transparent hover:bg-gray-300'
          }`}
        >
          Settings
        </Link>
      </aside>

      {/* Main content */}
      <div className="flex-1 relative">
        {/* Profile icon - fixed position */}
        <div className="absolute top-4 right-4 z-10" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="relative hover:opacity-80 transition-opacity focus:outline-none"
          >
            <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
              {currentUser && currentUser.photoURL ? (
                <img 
                  src={currentUser.photoURL} 
                  alt="Profile" 
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-gray-600">
                  <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd" />
                </svg>
              )}
            </div>
          </button>

          {/* Dropdown menu */}
          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-50">
              {currentUser ? (
                <>
                  <div className="px-4 py-2 text-sm text-gray-700 border-b">
                    <div className="font-semibold">{currentUser.displayName || 'User'}</div>
                    <div className="text-xs text-gray-500 truncate">{currentUser.email}</div>
                  </div>
                  <Link href="/profile" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                    Your Profile
                  </Link>
                  <Link href="/settings" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                    Settings
                  </Link>
                  <button 
                    onClick={handleLogout}
                    className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <Link href="/dashboard" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                  Sign in
                </Link>
              )}
            </div>
          )}
        </div>
        
        {/* Content starts at the top */}
        <main className="p-4 h-full">
          {children}
        </main>
      </div>
    </div>
  );
} 