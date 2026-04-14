// ══════════════════════════════════════════════════════════════════
//  La Antigua Barbería — Firebase Configuration
//  Reemplaza los tres valores PEGA_AQUI con los de tu proyecto:
//  Firebase Console → Configuración del proyecto → Tus apps → Web
// ══════════════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey:     "PEGA_AQUI_TU_API_KEY",
  authDomain: "PEGA_AQUI_TU_AUTH_DOMAIN",
  projectId:  "PEGA_AQUI_TU_PROJECT_ID"
};

// var (no const) para que sea accesible desde reservas.js
var db;

try {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
} catch (e) {
  console.warn("[Antigua Barbería] Firebase no configurado:", e.message);
}
