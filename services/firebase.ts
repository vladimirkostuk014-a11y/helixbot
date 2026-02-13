// services/firebase.ts
import * as firebaseApp from "firebase/app";
import { getDatabase, ref, set, onValue, remove, update } from "firebase/database";

// ==========================================
// КОНФИГУРАЦИЯ FIREBASE (HELIX BOT)
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyAMs9_3wy03yA1bYL4zXTAAIKBxPRWqA_E",
  authDomain: "helixbotdb.firebaseapp.com",
  databaseURL: "https://helixbotdb-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "helixbotdb",
  storageBucket: "helixbotdb.firebasestorage.app",
  messagingSenderId: "173821251695",
  appId: "1:173821251695:web:3c0fd97a79a6982df4bd9a"
};

// Инициализация
// Handle both named export (v9) and default export (compat/v8 interop) cases safely
const initApp = (firebaseApp as any).initializeApp || (firebaseApp as any).default?.initializeApp;
const app = initApp(firebaseConfig);

export const db = getDatabase(app);

console.log("🔥 Connected to Firebase Realtime Database: helixbotdb");

/**
 * Очищает данные от undefined, так как Firebase их не поддерживает.
 * JSON.stringify автоматически удаляет ключи со значением undefined.
 */
const sanitizeForFirebase = (data: any): any => {
    if (data === undefined) return null;
    return JSON.parse(JSON.stringify(data));
};

/**
 * Сохраняет (перезаписывает) данные по указанному пути.
 * Используется для сохранения настроек, списков и т.д.
 * Если передать null, данные удалятся.
 */
export const saveData = async (path: string, data: any) => {
    try {
        const dbRef = ref(db, path);
        if (data === undefined) return; // Firebase не любит undefined
        
        // Очищаем данные перед сохранением
        const cleanData = sanitizeForFirebase(data);
        await set(dbRef, cleanData);
        // console.log(`[Firebase] Saved: ${path}`);
    } catch (e) {
        console.error(`[Firebase] Error saving ${path}:`, e);
    }
};

/**
 * Подписывается на изменения данных в реальном времени.
 * Callback сработает сразу при подключении и при любом обновлении в базе.
 */
export const subscribeToData = (path: string, callback: (data: any) => void) => {
    const dbRef = ref(db, path);
    
    const unsubscribe = onValue(dbRef, (snapshot) => {
        const val = snapshot.val();
        callback(val);
    }, (error) => {
        console.error(`[Firebase] Subscription error for ${path}:`, error);
    });

    // Возвращаем функцию отписки, чтобы React мог очистить эффект
    return unsubscribe;
};

/**
 * Обновляет конкретные поля по пути (не перезаписывая всё остальное, если это объект)
 */
export const updateData = async (path: string, updates: any) => {
    try {
        const dbRef = ref(db, path);
        const cleanUpdates = sanitizeForFirebase(updates);
        await update(dbRef, cleanUpdates);
    } catch (e) {
        console.error(`[Firebase] Update error ${path}:`, e);
    }
};

/**
 * Удаляет данные по пути
 */
export const removeData = async (path: string) => {
    try {
        const dbRef = ref(db, path);
        await remove(dbRef);
    } catch (e) {
        console.error(`[Firebase] Remove error ${path}:`, e);
    }
};