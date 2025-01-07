// script.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js';
import { getFirestore, collection, addDoc, getDocs, doc, deleteDoc, updateDoc, query, where, getDoc } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js';
import { firebaseConfig } from './config.js';

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Variables globales
let productosEnVenta = [];
let consecutivoActual = 1;
let stockTemporal = new Map(); // Para llevar el control del stock mientras se hace la venta

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
                    <button class="editar" onclick="editarProducto('${doc.id}')">Editar</button>
                    <button class="eliminar" onclick="eliminarProducto('${doc.id}')">Eliminar</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        console.error("Error al cargar inventario: ", error);
    }
}

async function eliminarProducto(id) {
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
    try {
        // Obtener el documento de Firebase
        const docRef = doc(db, "productos", id);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const producto = docSnap.data();

            // Llenar el formulario de edición
            document.getElementById('producto-id').value = id;
            document.getElementById('codigo-edicion').value = producto.codigo;
            document.getElementById('descripcion-edicion').value = producto.descripcion;
            document.getElementById('precio-edicion').value = producto.precio;
            document.getElementById('stock-edicion').value = producto.stock;

            // Mostrar el modal
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
        // Obtener el último consecutivo nuevamente antes de guardar
        await obtenerUltimoConsecutivo();

        const venta = {
            fecha: new Date().toISOString(),
            consecutivo: consecutivoActual,
            productos: productosEnVenta,
            total: productosEnVenta.reduce((sum, prod) => sum + prod.total, 0)
        };

        // Guardar la venta
        await addDoc(collection(db, "ventas"), venta);
        consecutivoActual++; // Incrementar para la siguiente venta
        document.getElementById('consecutivo').textContent = consecutivoActual;

        // Actualizar el stock de los productos
        for (const producto of productosEnVenta) {
            const q = query(collection(db, "productos"), where("codigo", "==", producto.codigo));
            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
                const docRef = querySnapshot.docs[0].ref;
                const productoActual = querySnapshot.docs[0].data();
                await updateDoc(docRef, {
                    stock: productoActual.stock - producto.cantidad
                });
            }
        }

        alert('Venta guardada correctamente');
        limpiarVenta();
        cargarInventario();
    } catch (error) {
        console.error("Error al guardar venta: ", error);
        alert('Error al guardar la venta');
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
                <button onclick="eliminarDeVenta(${index})" class="eliminar">Eliminar</button>
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
        let q = collection(db, "ventas");
        if (fechaInicio && fechaFin) {
            q = query(q,
                where("fecha", ">=", fechaInicio),
                where("fecha", "<=", fechaFin)
            );
        }

        const querySnapshot = await getDocs(q);
        querySnapshot.forEach((doc) => {
            const venta = doc.data();
            venta.productos.forEach(producto => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${new Date(venta.fecha).toLocaleDateString()}</td>
                    <td>${venta.consecutivo}</td>
                    <td>${producto.codigo}</td>
                    <td>${producto.descripcion}</td>
                    <td>${producto.cantidad}</td>
                    <td>$${producto.precioUnitario.toLocaleString()}</td>
                    <td>$${producto.total.toLocaleString()}</td>
                `;
                tbody.appendChild(tr);
            });
        });
    } catch (error) {
        console.error("Error al cargar registro de ventas: ", error);
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

// Event Listeners
document.addEventListener('DOMContentLoaded', async () => {
    // Cargar datos iniciales
    await obtenerUltimoConsecutivo(); // Obtener el último consecutivo al inicio
    cargarInventario();
    document.getElementById('fecha').textContent = new Date().toLocaleDateString();


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

            // Actualizar clases activas
            document.querySelectorAll('.menu-lateral a').forEach(a => a.classList.remove('activo'));
            e.target.classList.add('activo');

            // Mostrar sección correspondiente
            document.querySelectorAll('.seccion').forEach(s => s.classList.add('oculto'));
            document.getElementById(seccion).classList.remove('oculto');

            // Cargar datos si es necesario
            if (seccion === 'registros') {
                cargarRegistroVentas();
            }
        });
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
    document.getElementById('filtrar').addEventListener('click', () => {
        const fechaInicio = document.getElementById('fecha-inicio').value;
        const fechaFin = document.getElementById('fecha-fin').value;
        if (fechaInicio && fechaFin) {
            cargarRegistroVentas(fechaInicio, fechaFin);
        }
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
});

// Hacer funciones disponibles globalmente para los onclick
window.eliminarDeVenta = eliminarDeVenta;
window.eliminarProducto = eliminarProducto;
window.editarProducto = editarProducto;
window.cerrarModalEdicion = cerrarModalEdicion;