import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';

// Your web app's Firebase configuration - Updated with correct project
const firebaseConfig = {
  apiKey: "AIzaSyBvLwBrUrWvqieuM6NwL22afxeIpfhWQkA",
  authDomain: "fitty-af564.firebaseapp.com",
  projectId: "fitty-af564",
  storageBucket: "fitty-af564.appspot.com",
  messagingSenderId: "594001481986",
  appId: "1:594001481986:web:377edfaa8ae98d44e1321b",
  measurementId: "G-T1VWT4D6C3"
};

// Initialize Firebase
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const app = firebase.app();
const auth = firebase.auth();
const db = firebase.firestore();

export { app, auth, db }; 