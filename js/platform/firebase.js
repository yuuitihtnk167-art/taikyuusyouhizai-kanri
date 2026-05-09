import {
  getApp,
  getApps,
  initializeApp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAcZ0Te9RO3EjSDWuG4HVqEGhjDNOEDmbs",
  authDomain: "taikyuusyouhizai-kanri.firebaseapp.com",
  projectId: "taikyuusyouhizai-kanri",
  storageBucket: "taikyuusyouhizai-kanri.firebasestorage.app",
  messagingSenderId: "580176190013",
  appId: "1:580176190013:web:e4c213e42645ac10f5e854",
  measurementId: "G-NRYNZS8E9R",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
