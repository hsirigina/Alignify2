'use client';

export default function Settings() {
  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-3xl font-bold">Settings</h1>
      
      {/* Profile Settings */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-xl font-bold mb-4">Profile Settings</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input 
              type="text" 
              className="w-full p-2 border rounded-md"
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input 
              type="email" 
              className="w-full p-2 border rounded-md"
              placeholder="your.email@example.com"
            />
          </div>
        </div>
      </div>

      {/* Preferences */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-xl font-bold mb-4">Preferences</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-medium">Dark Mode</span>
            <button className="w-12 h-6 bg-gray-200 rounded-full"></button>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-medium">Notifications</span>
            <button className="w-12 h-6 bg-blue-500 rounded-full"></button>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <button className="w-full py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600">
        Save Changes
      </button>
    </div>
  );
} 