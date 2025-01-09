import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js';
import { firebaseConfig } from './config.js';

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('error-message');
    
    try {
        // Intentar autenticar al usuario
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        
        // Obtener el rol del usuario desde Firestore
        const userDoc = await getDoc(doc(db, 'usuarios', userCredential.user.uid));
        
        if (userDoc.exists()) {
            const userData = userDoc.data();
            // Guardar el rol en sessionStorage
            sessionStorage.setItem('userRole', userData.rol);
            sessionStorage.setItem('userEmail', email);
            
            // Redirigir al sistema
            window.location.href = 'index.html';
        } else {
            errorMessage.textContent = 'Error: Usuario no tiene rol asignado';
            errorMessage.style.display = 'block';
        }
    } catch (error) {
        errorMessage.textContent = 'Error: Credenciales inválidas';
        errorMessage.style.display = 'block';
    }
});