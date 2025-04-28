"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import AuthModal from "@/components/AuthModal";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, parseISO, isWithinInterval, subWeeks, isAfter } from "date-fns";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, 
  Legend, ResponsiveContainer, PieChart, Pie, Cell, BarChart, 
  Bar, RadarChart, PolarGrid, PolarAngleAxis, Radar 
} from "recharts";

export default function Dashboard() {
  const router = useRouter();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { currentUser, loading } = useAuth();

  useEffect(() => {
    // Show auth modal if user is not authenticated (after loading completes)
    if (!loading && !currentUser) {
      setShowAuthModal(true);
    }
  }, [currentUser, loading]);

  const handleCloseModal = () => {
    // Only allow closing if authenticated
    if (currentUser) {
      setShowAuthModal(false);
    }
  };

  return (
    <Layout>
      <div className="flex flex-col items-center">
        <h1 className="text-2xl font-bold mb-6">
          {currentUser ? `Welcome, ${currentUser.displayName || 'User'}` : 'Dashboard'}
        </h1>
        
        <div className="bg-white p-6 rounded-lg shadow-md w-full">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gray-100 p-4 rounded-lg min-h-[200px] flex items-center justify-center">
              <p className="text-gray-500 text-center">
                Recent Activity Placeholder
              </p>
            </div>
            
            <div className="bg-gray-100 p-4 rounded-lg min-h-[200px] flex items-center justify-center">
              <p className="text-gray-500 text-center">
                Workout Stats Placeholder
              </p>
            </div>
            
            <div className="bg-gray-100 p-4 rounded-lg min-h-[200px] flex items-center justify-center">
              <p className="text-gray-500 text-center">
                Upcoming Sessions Placeholder
              </p>
            </div>
            
            <div className="bg-gray-100 p-4 rounded-lg min-h-[200px] flex items-center justify-center">
              <p className="text-gray-500 text-center">
                Pose Improvement Tracker Placeholder
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Auth Modal */}
      <AuthModal isOpen={showAuthModal} onClose={handleCloseModal} />
    </Layout>
  );
} 