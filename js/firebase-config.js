import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

export const firebaseConfig = {
  apiKey: "AIzaSyC4_IED_BVwsIrdqHPpmHp-VZGTA_fWDts",
  authDomain: "dulieuxuatkhau.firebaseapp.com",
  projectId: "dulieuxuatkhau",
  storageBucket: "dulieuxuatkhau.firebasestorage.app",
  messagingSenderId: "794977066160",
  appId: "1:794977066160:web:4b14cdd310dd785c24ef75",
  measurementId: "G-ZHL69LRE5P"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
