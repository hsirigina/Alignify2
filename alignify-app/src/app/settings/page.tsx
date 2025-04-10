"use client";

import Layout from "@/components/Layout";

export default function Settings() {
  return (
    <Layout>
      <div className="flex flex-col items-center">
        <h1 className="text-2xl font-bold mb-6">Settings</h1>
        
        <div className="bg-white p-6 rounded-lg shadow-md w-full">
          <div className="space-y-6">
            {/* Account Settings */}
            <div className="border-b pb-4">
              <h2 className="text-xl font-semibold mb-4">Account Settings</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Profile Information</span>
                  <button className="text-blue-500 hover:text-blue-700">Edit</button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Email Notifications</span>
                  <div className="relative inline-block w-12 h-6 border rounded-full">
                    <div className="absolute right-1 top-1 w-4 h-4 bg-blue-500 rounded-full"></div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Change Password</span>
                  <button className="text-blue-500 hover:text-blue-700">Update</button>
                </div>
              </div>
            </div>
            
            {/* Workout Settings */}
            <div className="border-b pb-4">
              <h2 className="text-xl font-semibold mb-4">Workout Settings</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Default Workout Duration</span>
                  <select className="border rounded px-2 py-1">
                    <option>15 minutes</option>
                    <option>30 minutes</option>
                    <option>45 minutes</option>
                    <option>60 minutes</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Difficulty Level</span>
                  <select className="border rounded px-2 py-1">
                    <option>Beginner</option>
                    <option>Intermediate</option>
                    <option>Advanced</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Feedback Sound</span>
                  <div className="relative inline-block w-12 h-6 border rounded-full">
                    <div className="absolute left-1 top-1 w-4 h-4 bg-gray-400 rounded-full"></div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Privacy Settings */}
            <div>
              <h2 className="text-xl font-semibold mb-4">Privacy Settings</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Share Progress</span>
                  <div className="relative inline-block w-12 h-6 border rounded-full">
                    <div className="absolute left-1 top-1 w-4 h-4 bg-gray-400 rounded-full"></div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Data Collection</span>
                  <div className="relative inline-block w-12 h-6 border rounded-full">
                    <div className="absolute right-1 top-1 w-4 h-4 bg-blue-500 rounded-full"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
} 