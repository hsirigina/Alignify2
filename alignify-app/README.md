# Alignify - Real-time Yoga Pose Guidance

A web application that provides real-time feedback on yoga and fitness poses using MediaPipe pose detection.

## Features

- Real-time pose detection with MediaPipe
- Pose calibration and matching
- User authentication with Firebase
- Progress tracking and statistics
- Responsive UI for various devices

## Getting Started

### Prerequisites

- Node.js 16+ and npm
- A Firebase project (for authentication and database)

### Setup

1. Clone the repository

```bash
git clone <repository-url>
cd alignify-app
```

2. Install dependencies

```bash
npm install
```

3. Set up Firebase

- Go to [Firebase Console](https://console.firebase.google.com/)
- Create a new project
- Set up Authentication (Email/Password and Google Sign-in)
- Set up Firestore Database
- Get your Firebase configuration values

4. Create a `.env.local` file in the root of the project with your Firebase config:

```
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=your-measurement-id
```

5. Run the development server

```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000) with your browser to see the application

## Firebase Security Rules

Add the following security rules to your Firestore database:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## About

Alignify helps users improve their yoga and fitness poses by providing real-time feedback and tracking progress over time. The application uses MediaPipe for pose detection and Firebase for user authentication and data storage.

### Technologies Used

- **Frontend**: Next.js, React, TailwindCSS
- **Pose Detection**: MediaPipe
- **Authentication & Database**: Firebase
- **Deployment**: Vercel (optional)

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
