// script.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js';
import { getFirestore, collection, addDoc, getDocs, doc, deleteDoc, updateDoc, query, where, getDoc, orderBy, limit } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js';
import { firebaseConfig } from './config.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js';

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth();

// Variables globales
let productosEnVenta = [];
let consecutivoActual = 1;
let stockTemporal = new Map(); // Para llevar el control del stock mientras se hace la venta

// Función para verificar la autenticación
function checkAuth() {
    return new Promise((resolve, reject) => {
        onAuthStateChanged(auth, (user) => {
            if (user) {
                const userRole = sessionStorage.getItem('userRole');
                if (!userRole) {
                    signOut(auth);
                    window.location.href = 'login.html';
                    reject('No role found');
                }
                resolve(userRole);
            } else {
                window.location.href = 'login.html';
                reject('No user found');
            }
        });
    });
}

// Función para verificar permisos
function checkPermissions(role, action) {
    const permissions = {
        admin: ['view', 'edit', 'delete', 'sell'],
        vendedor: ['view', 'sell']
    };

    return permissions[role]?.includes(action) || false;
}

// Agregar las funciones del escáner
let scannerIsRunning = false; // Variables para el escáner
let lastScannedCode = null;
let lastScannedTime = 0;
const SCAN_DELAY = 3000; // 3 segundos de espera entre escaneos

// Función para limpiar los event listeners de Quagga
const cleanupQuagga = () => {
    if (Quagga) {
        // Eliminar todos los event listeners
        Quagga.offDetected();
        if (scannerIsRunning) {
            Quagga.stop();
            scannerIsRunning = false;
        }
    }
};

// Convertir startScanner a una función async --------------------------------------------------------------------------
const startScanner = () => {
    return new Promise((resolve, reject) => {
        // Limpiar cualquier instancia previa
        cleanupQuagga();

        Quagga.init({
            inputStream: {
                name: "Live",
                type: "LiveStream",
                target: document.querySelector("#interactive"),
                constraints: {
                    facingMode: "environment"
                },
            },
            decoder: {
                readers: [
                    "ean_reader",
                    "ean_8_reader",
                    "code_128_reader",
                    "code_39_reader",
                    "upc_reader"
                ]
            }
        }, function (err) {
            if (err) {
                document.getElementById('scanner-error').style.display = 'block';
                document.getElementById('scanner-error').textContent =
                    "Error al iniciar la cámara. Por favor, verifica que has dado los permisos necesarios.";
                reject(err);
                return;
            }
            scannerIsRunning = true;
            // Resetear las variables de control al iniciar el escáner
            lastScannedCode = null;
            lastScannedTime = 0;

            // Agregar el event listener para la detección
            Quagga.onDetected(async function (result) {
                const code = result.codeResult.code;
                const currentTime = Date.now();

                // Verificar si es un código diferente o si ha pasado suficiente tiempo
                if (code &&
                    (code !== lastScannedCode ||
                        currentTime - lastScannedTime > SCAN_DELAY)) {

                    lastScannedCode = code;
                    lastScannedTime = currentTime;

                    document.getElementById('codigo-producto').value = code;
                    stopScanner();

                    try {
                        await buscarProducto(code);
                    } catch (error) {
                        console.error("Error al buscar producto:", error);
                    }
                }
            });

            Quagga.start();
            resolve();
        });
    });
};

const stopScanner = () => {
    cleanupQuagga();
    document.getElementById('scanner-modal').style.display = 'none';
    document.getElementById('scanner-error').style.display = 'none';
    // Resetear las variables de control al detener el escáner
    lastScannedCode = null;
    lastScannedTime = 0;
};

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('scan-button').addEventListener('click', async () => {
        document.getElementById('scanner-modal').style.display = 'block';
        try {
            await startScanner();
        } catch (error) {
            console.error("Error al iniciar el escáner:", error);
        }
    });

    document.querySelector('.close-scanner').addEventListener('click', stopScanner);

    document.getElementById('scanner-modal').addEventListener('click', function (e) {
        if (e.target === this) {
            stopScanner();
        }
    });
});

//------------------------------------------------------------------------------------------

// Funciones para el manejo de inventario
async function agregarProducto(producto) {
    try {
        await addDoc(collection(db, "productos"), producto);
        cargarInventario();
        alert('Producto agregado correctamente');
    } catch (error) {
        console.error("Error al agregar producto: ", error);
        alert('Error al agregar producto');
    }
}

async function cargarInventario() {
    const tbody = document.querySelector('#tabla-inventario tbody');
    tbody.innerHTML = '';

    try {
        const querySnapshot = await getDocs(collection(db, "productos"));
        querySnapshot.forEach((doc) => {
            const producto = doc.data();
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${producto.codigo}</td>
                <td>${producto.descripcion}</td>
                <td>$${producto.precio.toLocaleString()}</td>
                <td>${producto.stock}</td>
                <td>
                    <button class="editar" onclick="editarProducto('${doc.id}')">
                    <img src="imagenes/editar.png" alt="Editar" class="icono-inventario">
                </button>
                <button class="eliminar" onclick="eliminarProducto('${doc.id}')">
                    <img src="imagenes/eliminar.png" alt="Eliminar" class="icono-inventario">
                </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        console.error("Error al cargar inventario: ", error);
    }
}

async function eliminarProducto(id) {
    const userRole = sessionStorage.getItem('userRole');
    if (!checkPermissions(userRole, 'delete')) {
        alert('No tienes permisos para realizar esta acción');
        return;
    }

    if (confirm('¿Está seguro de eliminar este producto?')) {
        try {
            await deleteDoc(doc(db, "productos", id));
            cargarInventario();
            alert('Producto eliminado correctamente');
        } catch (error) {
            console.error("Error al eliminar producto: ", error);
            alert('Error al eliminar producto');
        }
    }
}

async function editarProducto(id) {
    const userRole = sessionStorage.getItem('userRole');
    if (!checkPermissions(userRole, 'edit')) {
        alert('No tienes permisos para realizar esta acción');
        return;
    }

    try {
        const docRef = doc(db, "productos", id);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const producto = docSnap.data();
            document.getElementById('producto-id').value = id;
            document.getElementById('codigo-edicion').value = producto.codigo;
            document.getElementById('descripcion-edicion').value = producto.descripcion;
            document.getElementById('precio-edicion').value = producto.precio;
            document.getElementById('stock-edicion').value = producto.stock;
            document.getElementById('modal-edicion').style.display = 'block';
        }
    } catch (error) {
        console.error("Error al cargar producto para edición: ", error);
        alert('Error al cargar producto');
    }
}

function cerrarModalEdicion() {
    document.getElementById('modal-edicion').style.display = 'none';
}

// Funciones para el punto de venta
async function buscarProducto(codigo) {
    try {
        const q = query(collection(db, "productos"), where("codigo", "==", codigo));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const producto = querySnapshot.docs[0].data();
            const stockDisponible = calcularStockDisponible(codigo, producto.stock);

            if (stockDisponible <= 0) {
                alert('No hay stock disponible para este producto');
                return;
            }

            mostrarModal(producto, stockDisponible);
        } else {
            alert('Producto no encontrado');
        }
    } catch (error) {
        console.error("Error al buscar producto: ", error);
    }
}

// Función para calcular el stock disponible
function calcularStockDisponible(codigo, stockTotal) {
    const stockReservado = stockTemporal.get(codigo) || 0;
    return stockTotal - stockReservado;
}

function mostrarModal(producto, stockDisponible) {
    const mensaje = `Producto: ${producto.descripcion}\nStock disponible: ${stockDisponible}\nIngrese la cantidad:`;
    const cantidad = prompt(mensaje);

    if (cantidad && !isNaN(cantidad)) {
        const cantidadNum = parseInt(cantidad);
        if (cantidadNum > 0 && cantidadNum <= stockDisponible) {
            // Actualizar stock temporal
            const stockActual = stockTemporal.get(producto.codigo) || 0;
            stockTemporal.set(producto.codigo, stockActual + cantidadNum);

            agregarProductoAVenta(producto, cantidadNum);
        } else {
            alert('Cantidad inválida o excede el stock disponible');
        }
    }
}

function agregarProductoAVenta(producto, cantidad) {
    const total = producto.precio * cantidad;
    productosEnVenta.push({
        codigo: producto.codigo,
        descripcion: producto.descripcion,
        cantidad,
        precioUnitario: producto.precio,
        total
    });
    actualizarTablaVenta();
    actualizarTotales();
}

// Guardar venta en Firebase
async function guardarVenta() {
    if (productosEnVenta.length === 0) {
        alert('No hay productos para guardar');
        return;
    }

    try {
        // Primero determinar el nuevo consecutivo
        const ventasRef = collection(db, "ventas");
        let nuevoConsecutivo = 1;

        // Intentar obtener el último consecutivo
        try {
            const q = query(ventasRef, orderBy("consecutivo", "desc"), limit(1));
            const querySnapshot = await getDocs(q);

            if (!querySnapshot.empty) {
                const ultimaVenta = querySnapshot.docs[0].data();
                nuevoConsecutivo = ultimaVenta.consecutivo + 1;
            }
        } catch (error) {
            console.error("Error al obtener consecutivo:", error);
            // Continuar con consecutivo 1 si hay error
        }

        const venta = {
            fecha: new Date().toISOString(),
            consecutivo: nuevoConsecutivo,
            productos: productosEnVenta,
            total: productosEnVenta.reduce((sum, prod) => sum + prod.total, 0)
        };

        // Guardar la venta
        await addDoc(ventasRef, venta);

        // Actualizar el stock de los productos
        for (const producto of productosEnVenta) {
            const prodQuery = query(collection(db, "productos"), where("codigo", "==", producto.codigo));
            const prodSnapshot = await getDocs(prodQuery);
            if (!prodSnapshot.empty) {
                const docRef = prodSnapshot.docs[0].ref;
                const productoActual = prodSnapshot.docs[0].data();
                await updateDoc(docRef, {
                    stock: productoActual.stock - producto.cantidad
                });
            }
        }

        // Actualizar el consecutivo en la UI inmediatamente
        consecutivoActual = nuevoConsecutivo + 1; // Incrementar para la próxima venta
        document.getElementById('consecutivo').textContent = consecutivoActual;

        alert('Venta guardada correctamente');
        limpiarVenta();
        cargarInventario();
        cargarRegistroVentas();
    } catch (error) {
        console.error("Error al guardar venta:", error);
        alert('Error al guardar la venta: ' + error.message);
    }
}

function limpiarVenta() {
    productosEnVenta = [];
    stockTemporal.clear(); // Limpiar el control temporal de stock
    actualizarTablaVenta();
    actualizarTotales();
    document.getElementById('codigo-producto').value = '';
}

function actualizarTablaVenta() {
    const tbody = document.querySelector('#tabla-productos tbody');
    tbody.innerHTML = '';

    productosEnVenta.forEach((producto, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${producto.codigo}</td>
            <td>${producto.descripcion}</td>
            <td>${producto.cantidad}</td>
            <td>$${producto.precioUnitario.toLocaleString()}</td>
            <td>$${producto.total.toLocaleString()}</td>
            <td>
               <button onclick="eliminarDeVenta(${index})" class="eliminar">
        <img src="imagenes/eliminar.png" alt="Eliminar" class="icono-eliminarVenProd"> Eliminar
    </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function actualizarTotales() {
    const totalArticulos = productosEnVenta.reduce((sum, prod) => sum + prod.cantidad, 0);
    const totalCosto = productosEnVenta.reduce((sum, prod) => sum + prod.total, 0);

    document.getElementById('total-articulos').textContent = totalArticulos;
    document.getElementById('total-costo').textContent = `$${totalCosto.toLocaleString()}`;
}

function eliminarDeVenta(index) {
    const producto = productosEnVenta[index];
    // Restaurar el stock temporal
    const stockActual = stockTemporal.get(producto.codigo);
    if (stockActual) {
        stockTemporal.set(producto.codigo, stockActual - producto.cantidad);
        if (stockTemporal.get(producto.codigo) <= 0) {
            stockTemporal.delete(producto.codigo);
        }
    }

    productosEnVenta.splice(index, 1);
    actualizarTablaVenta();
    actualizarTotales();
}

// Funciones para el registro de ventas
async function cargarRegistroVentas(fechaInicio = null, fechaFin = null) {
    const tbody = document.querySelector('#tabla-registros tbody');
    tbody.innerHTML = '';

    try {
        const ventasRef = collection(db, "ventas");
        let querySnapshot;

        if (fechaInicio && fechaFin) {
            const fechaInicioISO = new Date(fechaInicio + 'T00:00:00').toISOString();
            const fechaFinISO = new Date(fechaFin + 'T23:59:59').toISOString();

            const q = query(ventasRef,
                where("fecha", ">=", fechaInicioISO),
                where("fecha", "<=", fechaFinISO)
            );
            querySnapshot = await getDocs(q);
        } else {
            querySnapshot = await getDocs(ventasRef);
        }

        if (querySnapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="8">No hay registros de ventas</td></tr>';
            return;
        }

        // Ordenar los documentos por consecutivo de manera descendente
        const ventas = querySnapshot.docs
            .map(doc => ({
                id: doc.id,
                ...doc.data()
            }))
            .sort((a, b) => b.consecutivo - a.consecutivo);

        let currentVentaId = null;

        ventas.forEach((venta) => {
            // Añadir encabezado de la venta
            const trHeader = document.createElement('tr');
            trHeader.classList.add('venta-header');
            trHeader.innerHTML = `
                <td colspan="7">
                    <strong>Venta #${venta.consecutivo}</strong> - 
                    Fecha: ${new Date(venta.fecha).toLocaleDateString()} - 
                    Total de la venta: $${venta.total.toLocaleString()}
                </td>
                <td>
                    <button onclick="eliminarVenta('${venta.id}')" class="eliminar">
                    <img src="imagenes/eliminar.png" alt="Eliminar" class="icono-eliminarVenta">
                    </button>
                </td>
            `;
            tbody.appendChild(trHeader);

            // Añadir los productos de la venta
            venta.productos.forEach((producto, index) => {
                const tr = document.createElement('tr');
                tr.classList.add('venta-producto');
                if (index === venta.productos.length - 1) {
                    tr.classList.add('ultimo-producto');
                }
                tr.innerHTML = `
                    <td>${new Date(venta.fecha).toLocaleDateString()}</td>
                    <td>${venta.consecutivo}</td>
                    <td>${producto.codigo}</td>
                    <td>${producto.descripcion}</td>
                    <td>${producto.cantidad}</td>
                    <td>$${producto.precioUnitario.toLocaleString()}</td>
                    <td>$${producto.total.toLocaleString()}</td>
                    <td></td>
                `;
                tbody.appendChild(tr);
            });
        });
    } catch (error) {
        console.error("Error al cargar registro de ventas:", error);
        tbody.innerHTML = '<tr><td colspan="8">Error al cargar los registros: ' + error.message + '</td></tr>';
    }
}


// esta función es para obtener el último consecutivo
async function obtenerUltimoConsecutivo() {
    try {
        const ventasRef = collection(db, "ventas");
        const q = query(ventasRef, orderBy("consecutivo", "desc"), limit(1));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const ultimaVenta = querySnapshot.docs[0].data();
            consecutivoActual = ultimaVenta.consecutivo + 1;
        } else {
            consecutivoActual = 1;
        }

        document.getElementById('consecutivo').textContent = consecutivoActual;
    } catch (error) {
        console.error("Error al obtener último consecutivo:", error);
        consecutivoActual = 1;
    }
}


// Función para eliminar una venta
async function eliminarVenta(id) {
    if (!confirm('¿Está seguro de eliminar esta venta? Esta acción no se puede deshacer.')) {
        return;
    }

    try {
        // Primero obtener la venta para restaurar el stock
        const ventaRef = doc(db, "ventas", id);
        const ventaDoc = await getDoc(ventaRef);

        if (ventaDoc.exists()) {
            const venta = ventaDoc.data();

            // Restaurar el stock de cada producto
            for (const producto of venta.productos) {
                const prodQuery = query(collection(db, "productos"),
                    where("codigo", "==", producto.codigo));
                const prodSnapshot = await getDocs(prodQuery);

                if (!prodSnapshot.empty) {
                    const docRef = prodSnapshot.docs[0].ref;
                    const productoActual = prodSnapshot.docs[0].data();
                    await updateDoc(docRef, {
                        stock: productoActual.stock + producto.cantidad
                    });
                }
            }

            // Eliminar la venta
            await deleteDoc(ventaRef);
            alert('Venta eliminada correctamente');
            cargarRegistroVentas(); // Recargar la tabla
            cargarInventario(); // Actualizar el inventario
        }
    } catch (error) {
        console.error("Error al eliminar la venta:", error);
        alert('Error al eliminar la venta: ' + error.message);
    }
}


// Event Listeners
document.addEventListener('DOMContentLoaded', async () => {

    try {
        // Verificar autenticación
        const userRole = await checkAuth();

        // Mostrar/ocultar elementos según el rol
        if (userRole === 'vendedor') {
            // Ocultar elementos para vendedor
            document.querySelector('[data-seccion="inventario"]').parentElement.style.display = 'none';
            document.querySelector('[data-seccion="registros"]').parentElement.style.display = 'none';
            document.querySelectorAll('.editar, .eliminar').forEach(btn => btn.style.display = 'none');
        }

        // Agregar información del usuario y botón de logout
        const userInfo = document.createElement('div');
        userInfo.className = 'user-info';
        userInfo.style.padding = '10px 20px';
        userInfo.style.borderTop = '1px solid rgba(255, 255, 255, 0.1)';
        userInfo.style.marginTop = 'auto';
        userInfo.innerHTML = `
            <p style="color: white; margin-bottom: 10px;">
                ${sessionStorage.getItem('userEmail')}
                <br>
                <small>${userRole.charAt(0).toUpperCase() + userRole.slice(1)}</small>
            </p>
            <button id="logout-btn" style="width: 100%; padding: 8px; background: #e53e3e; color: white; border: none; border-radius: 4px; cursor: pointer;">
                Cerrar Sesión
            </button>
        `;
        document.querySelector('.menu-lateral').appendChild(userInfo);

        // Event listener para logout
        document.getElementById('logout-btn').addEventListener('click', async () => {
            await signOut(auth);
            window.location.href = 'login.html';
        });

        // Cargar datos iniciales
        await obtenerUltimoConsecutivo();
        cargarInventario();
        document.getElementById('fecha').textContent = new Date().toLocaleDateString();

        // Event listeners existentes
        const menuToggle = document.querySelector('.menu-toggle');
        const menuLateral = document.querySelector('.menu-lateral');

        menuToggle.addEventListener('click', () => {
            menuLateral.classList.toggle('activo');
        });

        // Navegación del menú
        document.querySelectorAll('.menu-lateral a').forEach(enlace => {
            enlace.addEventListener('click', (e) => {
                e.preventDefault();
                const seccion = e.target.getAttribute('data-seccion');

                // Verificar permisos para la sección
                if (userRole === 'vendedor' && (seccion === 'inventario' || seccion === 'registros')) {
                    alert('No tienes permisos para acceder a esta sección');
                    return;
                }

                document.querySelectorAll('.menu-lateral a').forEach(a => a.classList.remove('activo'));
                e.target.classList.add('activo');

                document.querySelectorAll('.seccion').forEach(s => s.classList.add('oculto'));
                document.getElementById(seccion).classList.remove('oculto');

                if (seccion === 'registros') {
                    cargarRegistroVentas();
                }
            });
        });

        // Event listener para filtro de fechas
        document.getElementById('filtrar').addEventListener('click', () => {
            const fechaInicio = document.getElementById('fecha-inicio').value;
            const fechaFin = document.getElementById('fecha-fin').value;

            if (!fechaInicio || !fechaFin) {
                alert('Por favor seleccione ambas fechas para filtrar');
                return;
            }

            if (fechaInicio > fechaFin) {
                alert('La fecha de inicio debe ser anterior o igual a la fecha final');
                return;
            }

            cargarRegistroVentas(fechaInicio, fechaFin);
        });

        // Event listener para registro de productos
        document.getElementById('form-producto').addEventListener('submit', async (e) => {
            e.preventDefault();
            const producto = {
                codigo: document.getElementById('codigo').value,
                descripcion: document.getElementById('descripcion').value,
                precio: parseFloat(document.getElementById('precio').value),
                stock: parseInt(document.getElementById('stock').value)
            };
            await agregarProducto(producto);
            e.target.reset();
        });

        // Event listener para registrar producto en venta
        document.getElementById('registrar').addEventListener('click', () => {
            const codigo = document.getElementById('codigo-producto').value;
            if (codigo) {
                buscarProducto(codigo);
            }
        });

        // Event listeners para botones de venta
        document.getElementById('guardar').addEventListener('click', guardarVenta);
        document.getElementById('cancelar').addEventListener('click', limpiarVenta);

        // Event listener para filtro de fechas
        // document.getElementById('filtrar').addEventListener('click', () => {
        //     const fechaInicio = document.getElementById('fecha-inicio').value;
        //     const fechaFin = document.getElementById('fecha-fin').value;
        //     if (fechaInicio && fechaFin) {
        //         cargarRegistroVentas(fechaInicio, fechaFin);
        //     }
        // });


        // En tu script.js, dentro del DOMContentLoaded
        document.getElementById('scan-button').addEventListener('click', () => {
            const root = document.getElementById('scanner-container');
            const handleCodeDetected = (code) => {
                document.getElementById('codigo-producto').value = code;
                // Opcionalmente, puedes activar la búsqueda automáticamente
                buscarProducto(code);
            };

            // Renderizar el componente del escáner
            const scannerComponent = React.createElement(BarcodeScanner, {
                onCodeDetected: handleCodeDetected,
                onClose: () => {
                    root.style.display = 'none';
                    ReactDOM.unmountComponentAtNode(root);
                }
            });

            root.style.display = 'block';
            ReactDOM.render(scannerComponent, root);
        });


        // Event listener para el formulario de edición
        document.getElementById('form-edicion').addEventListener('submit', async (e) => {
            e.preventDefault();

            const id = document.getElementById('producto-id').value;
            const productoActualizado = {
                codigo: document.getElementById('codigo-edicion').value,
                descripcion: document.getElementById('descripcion-edicion').value,
                precio: parseFloat(document.getElementById('precio-edicion').value),
                stock: parseInt(document.getElementById('stock-edicion').value)
            };

            try {
                const docRef = doc(db, "productos", id);
                await updateDoc(docRef, productoActualizado);
                alert('Producto actualizado correctamente');
                cerrarModalEdicion();
                cargarInventario(); // Recargar la tabla
            } catch (error) {
                console.error("Error al actualizar producto: ", error);
                alert('Error al actualizar producto');
            }
        });


        // Event listener para cerrar el modal
        document.getElementById('cerrar-modal-edicion').addEventListener('click', cerrarModalEdicion);

        // Cerrar modal al hacer clic fuera de él
        window.addEventListener('click', (e) => {
            const modal = document.getElementById('modal-edicion');
            if (e.target === modal) {
                cerrarModalEdicion();
            }
        });

    } catch (error) {
        console.error('Error de autenticación:', error);
        window.location.href = 'login.html';
    }
});

// Hacer funciones disponibles globalmente para los onclick
window.eliminarDeVenta = eliminarDeVenta;
window.eliminarProducto = eliminarProducto;
window.editarProducto = editarProducto;
window.cerrarModalEdicion = cerrarModalEdicion;
window.eliminarVenta = eliminarVenta;
