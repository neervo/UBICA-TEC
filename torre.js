const mapa = L.map('mapa', { zoomControl: false }).setView([19.066, -104.295], 16);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(mapa);
L.control.zoom({ position: 'topright' }).addTo(mapa);

const firebaseConfig = { apiKey: "AIzaSyAH7D-sLL4fCJDliP8xzuYUQGt-H5H7nXE", authDomain: "patio-densidad.firebaseapp.com", databaseURL: "https://patio-densidad-default-rtdb.firebaseio.com", projectId: "patio-densidad" };
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ==========================================
// GLOBALES Y TELEMETRÍA
// ==========================================
const marcadoresCamiones = {}; const listaUnidades = document.getElementById('listaUnidades');
let camionSeleccionado = null; let dataGlobal = {}; let seleccionadosMulti = new Set();
let geocercasMapa = {}; let posicionesMapa = {}; let emergenciasMapa = {};
let verInternos = true, verForaneos = true; let chartFlota = null;

var chartVelocidad = null; 
var indexRastreador = 0; 
let datosHistorial = [], polylineHistorial = null, marcadorHistorial = null, timerHistorial = null;
let marcadoresTiempoMuerto = [];

function calcularDistanciaGPS(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// ==========================================
// LÓGICA DE LOGIN Y MODALES
// ==========================================
function iniciarSesionTorre() {
    let user = document.getElementById('loginUser').value;
    let pass = document.getElementById('loginPass').value;
    if(user === "admin" && pass === "admin123") {
        document.getElementById('pantallaLoginAdmin').style.display = 'none';
    } else {
        alert("Usuario o contraseña incorrectos.");
    }
}

function mostrarModal(titulo, texto, tipo = 'alert', placeholder = '') {
    return new Promise((resolve) => {
        const modal = document.getElementById('customModal');
        document.getElementById('modalTitle').innerText = titulo;
        document.getElementById('modalText').innerText = texto;
        const input = document.getElementById('modalInput');
        const btnCancel = document.getElementById('modalBtnCancel');
        const btnOk = document.getElementById('modalBtnOk');

        if (tipo === 'prompt') { input.style.display = 'block'; input.value = ''; input.placeholder = placeholder; btnCancel.style.display = 'block'; } 
        else if (tipo === 'confirm') { input.style.display = 'none'; btnCancel.style.display = 'block'; } 
        else { input.style.display = 'none'; btnCancel.style.display = 'none'; }
        
        modal.style.display = 'flex';
        btnOk.onclick = () => { modal.style.display = 'none'; resolve(tipo === 'prompt' ? input.value : true); };
        btnCancel.onclick = () => { modal.style.display = 'none'; resolve(tipo === 'prompt' ? null : false); };
    });
}

function showToast(mensaje) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast'; toast.innerText = mensaje;
    container.appendChild(toast); setTimeout(() => { toast.remove(); }, 5000);
}

// ==========================================
// DASHBOARD Y EXCEL
// ==========================================
function escucharTiemposMuertos() {
    db.ref('tiempos_muertos').on('value', snapshot => {
        const contenedor = document.getElementById('contenedorTurnosMuertos');
        if (!contenedor) return;
        contenedor.innerHTML = '';

        if (!snapshot.exists() || !snapshot.val()) {
            contenedor.innerHTML = '<div style="text-align:center; padding: 10px; color: #666;">Sin incidencias</div>';
            return;
        }

        const data = snapshot.val();
        let turnosData = {
            'Turno 1': { registros: [], totalIncidencias: 0, totalMinutos: 0 },
            'Turno 2': { registros: [], totalIncidencias: 0, totalMinutos: 0 },
            'Turno 3': { registros: [], totalIncidencias: 0, totalMinutos: 0 }
        };

        const inicioDelDia = new Date();
        inicioDelDia.setHours(0, 0, 0, 0);
        const timestampInicio = inicioDelDia.getTime();

        for (const placa in data) {
            const incidentesPlaca = data[placa];
            for (const pushId in incidentesPlaca) {
                const info = incidentesPlaca[pushId];
                if (info.hora_salida >= timestampInicio) {
                    let horaSalida = info.hora_salida || 0;
                    let mins = info.minutos_gastados || 0;
                    
                    let hora = new Date(horaSalida).getHours();
                    let turno = 'Turno 3';
                    if (hora >= 8 && hora < 16) turno = 'Turno 1';
                    else if (hora >= 16 && hora < 24) turno = 'Turno 2';

                    turnosData[turno].registros.push({
                        placa: placa,
                        zona: info.zona || 'Desconocida',
                        minutos_gastados: mins,
                        hora_salida: horaSalida
                    });
                    turnosData[turno].totalIncidencias++;
                    turnosData[turno].totalMinutos += mins;
                }
            }
        }

        let currentHour = new Date().getHours();
        let currentTurno = 'Turno 3';
        if (currentHour >= 8 && currentHour < 16) currentTurno = 'Turno 1';
        else if (currentHour >= 16 && currentHour < 24) currentTurno = 'Turno 2';

        let html = '';
        let hasData = false;

        ['Turno 1', 'Turno 2', 'Turno 3'].forEach(turnoName => {
            let tData = turnosData[turnoName];
            if (tData.totalIncidencias === 0) return;
            hasData = true;

            tData.registros.sort((a, b) => b.hora_salida - a.hora_salida);
            let isOpen = (turnoName === currentTurno) ? 'open' : '';

            let detailsHtml = `
                <details style="background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden;" ${isOpen}>
                    <summary style="background: #f9fafb; padding: 12px 15px; font-weight: bold; cursor: pointer; color: #374151; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between;">
                        <span>${turnoName} - Incidencias: ${tData.totalIncidencias} | Tiempo Perdido: ${tData.totalMinutos} min</span>
                        <span style="color: #9ca3af;">▼</span>
                    </summary>
                    <div style="padding: 10px;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
                            <thead style="color: var(--text-secondary); border-bottom: 1px solid #eee;">
                                <tr>
                                    <th style="padding: 6px;">Unidad</th>
                                    <th style="padding: 6px;">Zona</th>
                                    <th style="padding: 6px;">Minutos</th>
                                    <th style="padding: 6px;">Hora</th>
                                </tr>
                            </thead>
                            <tbody>
            `;

            tData.registros.forEach(reg => {
                let colorMinutos = 'var(--text-primary)';
                if (reg.minutos_gastados >= 15) colorMinutos = '#7f1d1d';
                else if (reg.minutos_gastados >= 5) colorMinutos = '#ef4444';

                let fecha = new Date(reg.hora_salida);
                let horas = fecha.getHours().toString().padStart(2, '0');
                let mins = fecha.getMinutes().toString().padStart(2, '0');
                let horaLegible = `${horas}:${mins}`;

                detailsHtml += `
                                <tr style="border-bottom: 1px solid #f3f4f6;">
                                    <td style="padding: 6px; font-weight: bold;">${reg.placa}</td>
                                    <td style="padding: 6px;">${reg.zona}</td>
                                    <td style="padding: 6px; color: ${colorMinutos}; font-weight: bold;">${reg.minutos_gastados}m</td>
                                    <td style="padding: 6px;">${horaLegible}</td>
                                </tr>
                `;
            });

            detailsHtml += `
                            </tbody>
                        </table>
                    </div>
                </details>
            `;
            html += detailsHtml;
        });

        if (!hasData) {
            contenedor.innerHTML = '<div style="text-align:center; padding: 10px; color: #666;">Sin incidencias</div>';
        } else {
            contenedor.innerHTML = html;
        }
    });
}

window.onload = () => {
    const ctx = document.getElementById('graficaFlota').getContext('2d');
    chartFlota = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: ['Activos', 'Ocio', 'Baño', 'Pager', 'Emergencia'], datasets: [{ data: [0, 0, 0, 0, 0], backgroundColor: ['#a4c900', '#ba68c8', '#fbc02d', '#f57f17', '#ba1a1a'], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'right', labels: { font: { family: 'Plus Jakarta Sans', size: 11, weight: 'bold' } } } } }
    });
    escucharTiemposMuertos();
};

window.cambiarTab = function(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('activo'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('activo'));
    document.getElementById(`tab-${tabName}`).classList.add('activo');
    document.getElementById(`btnTab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`).classList.add('activo');
};

window.exportarExcel = async function() {
    function calcularTurno(timestamp) {
        if (!timestamp) return 'N/A';
        const hora = new Date(timestamp).getHours();
        if (hora >= 8 && hora < 16) return 'Turno 1';
        if (hora >= 16 && hora < 24) return 'Turno 2';
        return 'Turno 3'; // De 00:00 a 07:59
    }

    showToast("Procesando telemetría... Espere un momento.");
    const fechaHoy = obtenerFechaLocal();
    // 1. Agregamos las columnas de Ciclos y Turno al encabezado
    let csv = "Placa,Turno,Tipo,Subtipo,Estado,Destino/Buque,STS,Hora Ingreso,Hora Salida,Truck Time Min,Km Recorridos,Vel Promedio (km/h),Minutos Detenido,Total Ciclos,Detalle de Ciclos,Estatus,Zonas Restringidas,Minutos en Zonas\n";
    
    async function analizarRuta(placa) {
        let km = 0, velSuma = 0, minDetenido = 0, ptsValidos = 0;
        let totalCiclos = 0;
        let cicloTiempos = [];
        let prevTime = null;

        let snap = await db.ref(`historial_rutas/${fechaHoy}/${placa}`).once('value');
        let data = snap.val();
        
        // Fallback robusto por si la estructura está invertida
        if (!data) {
            snap = await db.ref(`historial_rutas/${placa}/${fechaHoy}`).once('value');
            data = snap.val();
        }

        if (data) {
            if (data[fechaHoy]) data = data[fechaHoy]; 
            let pts = Object.values(data).sort((a,b) => (a.time||a.timestamp) - (b.time||b.timestamp));
            
            for (let i = 0; i < pts.length; i++) {
                let p = pts[i];
                
                // 2. Lógica de Tiempos de Ciclo (Laps)
                if (i === 0) prevTime = p.time || p.timestamp; 
                let vue = p.vue || p.vueltas || 0;
                
                if (vue > totalCiclos) {
                    totalCiclos = vue;
                    if (prevTime) {
                        let diffMs = (p.time || p.timestamp) - prevTime;
                        let min = Math.floor(diffMs / 60000);
                        let sec = Math.floor((diffMs % 60000) / 1000);
                        cicloTiempos.push(`L${vue}: ${min}m ${sec}s`);
                    }
                    prevTime = p.time || p.timestamp;
                }

                // 3. Lógica de Distancia y Velocidad parcheada
                if (i > 0) {
                    let p1 = pts[i-1];
                    let lat1 = p1.lat || p1.latitude || p1.latitud;
                    let lon1 = p1.lng || p1.longitude || p1.longitud;
                    let lat2 = p.lat || p.latitude || p.latitud;
                    let lon2 = p.lng || p.longitude || p.longitud;
                    
                    if (lat1 && lon1 && lat2 && lon2) {
                        km += calcularDistanciaGPS(lat1, lon1, lat2, lon2);
                    }
                    
                    let v = parseFloat(p1.vel || p1.velocidad || p1.velocidad_actual || p1.speed || 0);
                    velSuma += v; 
                    ptsValidos++;
                    
                    if (v <= 2) { 
                        let diffMs = (p.time||p.timestamp||0) - (p1.time||p1.timestamp||0);
                        if (diffMs > 0 && diffMs < 300000) minDetenido += (diffMs / 60000);
                    }
                }
            }
        }
        let prom = ptsValidos > 0 ? (velSuma / ptsValidos) : 0;
        return { 
            km: km.toFixed(2), 
            prom: prom.toFixed(1), 
            detenido: Math.floor(minDetenido),
            ciclos: totalCiclos,
            detalleCiclos: cicloTiempos.length > 0 ? cicloTiempos.join(" | ") : "N/A"
        };
    }

    async function obtenerTiemposMuertos(placa) {
        let snap = await db.ref('tiempos_muertos/' + placa).once('value');
        let data = snap.val();
        if (!data) return { zonas: 'Ninguna', minutosTotales: 0 };

        let totalMinutos = 0;
        let desgloseZonas = {};
        
        for (let pushId in data) {
            let info = data[pushId];
            let mins = info.minutos_gastados || 0;
            let zona = info.zona || 'Desconocida';
            
            totalMinutos += mins;
            desgloseZonas[zona] = (desgloseZonas[zona] || 0) + mins;
        }
        
        let zonasArr = [];
        for (let zona in desgloseZonas) {
            zonasArr.push(`${zona} (${desgloseZonas[zona]}m)`);
        }
        
        return { 
            zonas: zonasArr.length > 0 ? zonasArr.join(' | ') : 'Ninguna', 
            minutosTotales: totalMinutos 
        };
    }

    for (let placa in dataGlobal) {
        let u = dataGlobal[placa]; 
        let turnoActual = calcularTurno(u.hora_ingreso || Date.now());
        let aplicaTT = (u.tipo === 'FORANEO' || (u.tipo === 'INTERNO' && u.subtipo === 'Traslado'));
        let minTT = aplicaTT ? Math.floor((Date.now() - (u.hora_ingreso||Date.now())) / 60000) : 'N/A';
        let horaIn = u.hora_ingreso ? new Date(u.hora_ingreso).toLocaleTimeString() : 'N/A';
        let kpis = await analizarRuta(placa); 
        let tiempos = await obtenerTiemposMuertos(placa);
        csv += `${placa},${turnoActual},${u.tipo},${u.subtipo || 'N/A'},${u.estado},${u.destino || u.buque || 'S/D'},${u.sts || 'N/A'},${horaIn},EN RUTA,${minTT},${kpis.km},${kpis.prom},${kpis.detenido},${kpis.ciclos},${kpis.detalleCiclos},ACTIVO,${tiempos.zonas},${tiempos.minutosTotales}\n`;
    }
    
    const snapFin = await db.ref(`viajes_finalizados/${fechaHoy}`).once('value');
    if (snapFin.val()) {
        let finalizados = snapFin.val();
        for (let key in finalizados) {
            let u = finalizados[key];
            let placaFin = u.placa || key.split('_')[0];
            let turnoFin = calcularTurno(u.hora_salida || u.hora_ingreso);
            let aplicaTT = (u.tipo === 'FORANEO' || (u.tipo === 'INTERNO' && u.subtipo === 'Traslado'));
            let minTT = aplicaTT ? (u.minutos_totales || 0) : 'N/A';
            let horaIn = u.hora_ingreso ? new Date(u.hora_ingreso).toLocaleTimeString() : 'N/A';
            let horaOut = u.hora_salida ? new Date(u.hora_salida).toLocaleTimeString() : 'N/A';
            let kpis = await analizarRuta(placaFin); 
            let tiempos = await obtenerTiemposMuertos(placaFin);
            csv += `${placaFin},${turnoFin},${u.tipo},${u.subtipo || 'N/A'},COMPLETADO,${u.destino || u.buque || 'S/D'},${u.sts || 'N/A'},${horaIn},${horaOut},${minTT},${kpis.km},${kpis.prom},${kpis.detenido},${kpis.ciclos},${kpis.detalleCiclos},FINALIZADO,${tiempos.zonas},${tiempos.minutosTotales}\n`;
        }
    }
    const blob = new Blob(["\uFEFF"+csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement("a"); 
    a.href = URL.createObjectURL(blob); 
    a.download = `Reporte_YMS_${fechaHoy}.csv`; 
    a.click();
};

function actualizarDashboard() {
    let total = 0, ocio = 0, act = 0, bano = 0, pager = 0, emerg = 0; 
    let sumaMinutosTotales = 0; let unidadesParaPromedio = 0;

    for(let key in dataGlobal) {
        total++; let c = dataGlobal[key]; let est = c.estado;
        if(est === 'ocio') ocio++; else if(est === 'baño') bano++; else if(est === 'pager') pager++; else if(est === 'emergencia') emerg++; else act++;
        let aplicaTT = (c.tipo === 'FORANEO' || (c.tipo === 'INTERNO' && c.subtipo === 'Traslado'));
        if(aplicaTT) { sumaMinutosTotales += Math.floor((Date.now() - (c.hora_ingreso || Date.now())) / 60000); unidadesParaPromedio++; }
    }
    document.getElementById('dashTotal').innerText = total; document.getElementById('dashOcio').innerText = ocio;
    let promedio = unidadesParaPromedio > 0 ? Math.floor(sumaMinutosTotales / unidadesParaPromedio) : 0;
    document.getElementById('dashTruckTime').innerText = promedio + "m";
    if(chartFlota) { chartFlota.data.datasets[0].data = [act, ocio, bano, pager, emerg]; chartFlota.update(); }
}

// ==========================================
// HERRAMIENTAS DEL MAPA (Geocercas y Acciones)
// ==========================================
let modoDibujoPos = false, modoDibujoGeo = false, modoDibujoEmergencia = false;
let puntosDibujo = [], polylineDibujo = null, marcadoresDibujo = [];

window.toggleNombresGeo = function() { let activo = document.getElementById('chkNombresGeo').checked; document.querySelectorAll('.geo-tooltip').forEach(el => { if(activo) el.classList.remove('oculto'); else el.classList.add('oculto'); }); };
window.iniciarDibujoPosicion = function() { modoDibujoPos = true; modoDibujoEmergencia = false; document.getElementById('mapa').style.cursor = 'crosshair'; mostrarModal("Posiciones", "Da clic en el mapa donde se ubica la bahía.", "alert"); };
window.iniciarDibujoEmergencia = function() { modoDibujoEmergencia = true; modoDibujoPos = false; document.getElementById('mapa').style.cursor = 'crosshair'; mostrarModal("Emergencia", "Da clic en el mapa donde ubicar la zona SOS.", "alert"); };
window.iniciarDibujoGeocerca = function() { modoDibujoGeo = true; puntosDibujo = []; document.getElementById('btnDibujarGeo').style.display = 'none'; document.getElementById('btnGuardarGeo').style.display = 'block'; document.getElementById('mapa').style.cursor = 'crosshair'; };

mapa.on('click', async function(e) {
    if (modoDibujoPos) { modoDibujoPos = false; document.getElementById('mapa').style.cursor = 'grab'; let nombre = await mostrarModal("Nueva Posición", "Ingresa código de Bahía:", "prompt", "Ej. A0 02"); if (nombre) { db.ref('configuracion/posiciones').push({ nombre: nombre.toUpperCase(), coordenadas: [e.latlng.lat, e.latlng.lng] }); mostrarModal("Éxito", "Posición guardada."); } return; }
    if (modoDibujoEmergencia) { modoDibujoEmergencia = false; document.getElementById('mapa').style.cursor = 'grab'; let nombre = await mostrarModal("Punto SOS", "Nombra esta zona:", "prompt", "Ej. Botiquín"); if (nombre) { db.ref('configuracion/emergencias').push({ nombre: nombre.toUpperCase(), coordenadas: [e.latlng.lat, e.latlng.lng] }); mostrarModal("Éxito", "Zona SOS activa."); } return; }
    if (!modoDibujoGeo) return;
    puntosDibujo.push([e.latlng.lat, e.latlng.lng]); marcadoresDibujo.push(L.circleMarker([e.latlng.lat, e.latlng.lng], {radius: 4, color: '#FF5E3A', fillColor: '#FF5E3A', fillOpacity: 1}).addTo(mapa));
    if (polylineDibujo) mapa.removeLayer(polylineDibujo);
    let puntosPoligono = [...puntosDibujo]; if(puntosPoligono.length > 2) puntosPoligono.push(puntosPoligono[0]);
    polylineDibujo = L.polygon(puntosPoligono, {color: '#FF5E3A', weight: 2, fillColor: '#ffdbd0', fillOpacity: 0.3}).addTo(mapa);
});

window.guardarGeocerca = async function() { if (puntosDibujo.length < 3) return mostrarModal("Error", "Mínimo 3 puntos."); let nombre = await mostrarModal("Guardar", "Nombre (Usa 'TERMINAL' para auto-salida):", "prompt", "Ej. TERMINAL"); if (nombre) db.ref('configuracion/geocercas').push({ nombre: nombre.toUpperCase(), coordenadas: puntosDibujo }); modoDibujoGeo = false; document.getElementById('btnDibujarGeo').style.display = 'block'; document.getElementById('btnGuardarGeo').style.display = 'none'; document.getElementById('mapa').style.cursor = 'grab'; if(polylineDibujo) mapa.removeLayer(polylineDibujo); marcadoresDibujo.forEach(m => mapa.removeLayer(m)); puntosDibujo = []; marcadoresDibujo = []; polylineDibujo = null; };
window.eliminarGeocerca = async function(key) { let conf = await mostrarModal("Borrar", "¿Borrar zona?", "confirm"); if(conf) db.ref('configuracion/geocercas/' + key).remove(); };
window.eliminarPosicion = async function(key) { let conf = await mostrarModal("Borrar", "¿Borrar posición?", "confirm"); if(conf) db.ref('configuracion/posiciones/' + key).remove(); };
window.eliminarEmergencia = async function(key) { let conf = await mostrarModal("Borrar", "¿Borrar punto SOS?", "confirm"); if(conf) db.ref('configuracion/emergencias/' + key).remove(); };

db.ref('configuracion/posiciones').on('value', snap => { for(let k in posicionesMapa) mapa.removeLayer(posicionesMapa[k]); posicionesMapa = {}; let htmlList = ""; if(snap.val()) { const iconoPos = L.divIcon({ className: '', html: `<div class="icono-posicion"></div>`, iconSize: [10, 10], iconAnchor: [5, 5] }); for(let key in snap.val()) { let p = snap.val()[key]; posicionesMapa[key] = L.marker(p.coordenadas, {icon: iconoPos}).addTo(mapa).bindTooltip(p.nombre, {permanent: true, direction: 'top', className: 'geo-tooltip'}); htmlList += `<div class="item-geo"><span>📍 ${p.nombre}</span><button onclick="eliminarPosicion('${key}')">❌</button></div>`; } } document.getElementById('listaPosicionesGuardadas').innerHTML = htmlList || "<p class='texto-ayuda'>No hay posiciones.</p>"; });
db.ref('configuracion/emergencias').on('value', snap => { for(let k in emergenciasMapa) mapa.removeLayer(emergenciasMapa[k]); emergenciasMapa = {}; let htmlList = ""; if(snap.val()) { const iconoSOS = L.divIcon({ className: '', html: `<div class="icono-emergencia-punto"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] }); for(let key in snap.val()) { let p = snap.val()[key]; emergenciasMapa[key] = L.marker(p.coordenadas, {icon: iconoSOS}).addTo(mapa).bindTooltip(p.nombre, {direction: 'top', className: 'geo-tooltip'}); htmlList += `<div class="item-geo"><span>⛑️ ${p.nombre}</span><button onclick="eliminarEmergencia('${key}')">❌</button></div>`; } } document.getElementById('listaEmergenciasGuardadas').innerHTML = htmlList || "<p class='texto-ayuda'>No hay zonas SOS.</p>"; });
db.ref('configuracion/geocercas').on('value', snap => { for(let k in geocercasMapa) mapa.removeLayer(geocercasMapa[k]); geocercasMapa = {}; let htmlListaGeo = ""; if(snap.val()) { let show = document.getElementById('chkNombresGeo').checked ? '' : 'oculto'; for(let key in snap.val()) { let geo = snap.val()[key]; let poligono = L.polygon(geo.coordenadas, {color: '#ffffff', weight: 2, fillColor: '#ffffff', fillOpacity: 0.15}).addTo(mapa); poligono.bindTooltip(`${geo.nombre}`, {permanent: true, direction: 'center', className: `geo-tooltip ${show}`}).openTooltip(); geocercasMapa[key] = poligono; htmlListaGeo += `<div class="item-geo"><span>${geo.nombre}</span><button onclick="eliminarGeocerca('${key}')">❌</button></div>`; } } document.getElementById('listaGeocercasGuardadas').innerHTML = htmlListaGeo || "<p class='texto-ayuda'>No hay zonas.</p>"; });

window.toggleMulti = function(placa, event) { event.stopPropagation(); if (event.target.checked) seleccionadosMulti.add(placa); else seleccionadosMulti.delete(placa); actualizarPanelMulti(); };
window.actualizarPanelMulti = function() { const panel = document.getElementById('panelMulti'), panelInd = document.getElementById('panelAcciones'); if (seleccionadosMulti.size > 0) { panel.style.display = 'flex'; document.getElementById('lblMulti').innerText = `Seleccionadas: ${seleccionadosMulti.size}`; panelInd.style.display = 'none'; camionSeleccionado = null; renderLista(); } else { panel.style.display = 'none'; } };
window.enviarMensajeMultiple = async function() { let msj = await mostrarModal("Grupo", "Instrucción:", "prompt"); if (msj) { seleccionadosMulti.forEach(placa => { if(dataGlobal[placa]) db.ref('camiones_en_patio/' + placa).update({ tts_mensaje: msj.trim(), tts_timestamp: Date.now() }); }); mostrarModal("Enviado", "Señal transmitida."); seleccionadosMulti.clear(); actualizarPanelMulti(); renderLista(); } };
window.reasignarDestinoMultiple = async function() { let nuevoDestino = await mostrarModal("Desvío", "Ingresa Posición Temporal.\nDejar vacío para original:", "prompt"); if (nuevoDestino !== null) { let msj = nuevoDestino.trim() !== "" ? "Atención. Procedan a la posición temporal: " + nuevoDestino : "Atención. Regresen a su destino original."; seleccionadosMulti.forEach(placa => { if(dataGlobal[placa]) db.ref('camiones_en_patio/' + placa).update({ destino_temporal: nuevoDestino.trim().toUpperCase(), tts_mensaje: msj, tts_timestamp: Date.now() }); }); mostrarModal("Desvío", "Comando enviado."); seleccionadosMulti.clear(); actualizarPanelMulti(); renderLista(); } };
window.seleccionarCamion = function(placa, estado) { if (seleccionadosMulti.size > 0) return; camionSeleccionado = placa; if (marcadoresCamiones[placa]) mapa.setView(marcadoresCamiones[placa].getLatLng(), 18); document.getElementById('panelAcciones').style.display = 'flex'; document.getElementById('tituloAccion').innerText = "Unidad: " + placa; document.getElementById('btnResolverAlerta').style.display = (estado !== 'activo') ? 'block' : 'none'; renderLista(); };
window.reasignarDestinoIndividual = async function() { if(camionSeleccionado) { let nuevoDestino = await mostrarModal("Desvío", "Posición Temporal.\nDejar vacío para original:", "prompt"); if (nuevoDestino !== null) { let msj = nuevoDestino.trim() !== "" ? "Atención. Proceda a la posición temporal: " + nuevoDestino : "Atención. Regrese a su destino original."; db.ref('camiones_en_patio/' + camionSeleccionado).update({ destino_temporal: nuevoDestino.trim().toUpperCase(), tts_mensaje: msj, tts_timestamp: Date.now() }); mostrarModal("Desvío", "Comando enviado."); renderLista(); } } };
window.enviarMensajeTorre = function() { const input = document.getElementById('inputVoz'); if (camionSeleccionado && input.value.trim() !== "") { db.ref('camiones_en_patio/' + camionSeleccionado).update({ tts_mensaje: input.value.trim(), tts_timestamp: Date.now() }); input.value = ""; mostrarModal("Enviado", "Transmitida."); } };
window.enviarMensajeGlobal = async function() { let msj = await mostrarModal("GLOBAL", "Mensaje a TODA LA FLOTA:", "prompt"); if (msj) { for(const placa in dataGlobal) { db.ref('camiones_en_patio/' + placa).update({ tts_mensaje: msj.trim(), tts_timestamp: Date.now() }); } mostrarModal("Global", "Alerta transmitida."); } };
window.resolverAlertaTorre = function() { if (camionSeleccionado) { db.ref('camiones_en_patio/' + camionSeleccionado).update({ estado: 'activo' }); document.getElementById('btnResolverAlerta').style.display = 'none'; } };
window.forzarSalidaTorre = async function() { let conf = await mostrarModal("Cerrar", "¿Forzar Cierre de Turno?", "confirm"); if (camionSeleccionado && conf) { db.ref('camiones_en_patio/' + camionSeleccionado).remove(); document.getElementById('panelAcciones').style.display = 'none'; camionSeleccionado = null; } };
window.toggleOjito = function(tipo, event) { event.stopPropagation(); if(tipo === 'internos') verInternos = !verInternos; if(tipo === 'foraneos') verForaneos = !verForaneos; renderLista(); };

function getIcono(tipo, subtipo, estado) {
    let claseFondo = tipo === 'INTERNO' ? 'icono-interno' : 'icono-foraneo';
    if(tipo === 'INTERNO' && subtipo === 'Housekeeping') claseFondo = 'icono-housekeeping'; if(tipo === 'INTERNO' && subtipo === 'Traslado') claseFondo = 'icono-traslado';
    if (estado === 'emergencia') claseFondo = 'icono-emergencia'; if (estado === 'pager') claseFondo = 'icono-pager'; if (estado === 'baño') claseFondo = 'icono-bano'; if (estado === 'ocio') claseFondo = 'icono-ocio';
    return L.divIcon({ className: '', html: `<div class="icono-base ${claseFondo}"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] });
}

window.renderLista = function() {
    const filtro = document.getElementById('inputBuscador').value.trim().toUpperCase();
    let htmlInternos = "", htmlForaneos = "", totalUnidades = 0, countInt = 0, countFor = 0;

    for (const placa in dataGlobal) {
        const camion = dataGlobal[placa];
        if(camion.tipo === 'INTERNO' && !verInternos) { if(marcadoresCamiones[placa]) mapa.removeLayer(marcadoresCamiones[placa]); continue; }
        if(camion.tipo === 'FORANEO' && !verForaneos) { if(marcadoresCamiones[placa]) mapa.removeLayer(marcadoresCamiones[placa]); continue; }
        if(marcadoresCamiones[placa] && !mapa.hasLayer(marcadoresCamiones[placa])) marcadoresCamiones[placa].addTo(mapa);

        let textoDestino = camion.destino || 'S/D';
        if(camion.tipo === 'FORANEO' && camion.destino_temporal && camion.destino_temporal !== "") textoDestino = `🔄 ${camion.destino_temporal} (Orig: ${textoDestino})`;
        let infoRuta = camion.tipo === 'FORANEO' ? `Des: ${textoDestino}` : (camion.subtipo === 'Operacion Buque' ? `BQ: ${camion.buque} | ST: ${camion.sts}` : `⚙️ ${camion.subtipo}`);
        
        let verVueltas = document.getElementById('chkVueltas') ? document.getElementById('chkVueltas').checked : true;
        let infoVueltas = (verVueltas && camion.vueltas !== undefined) ? ' | 🔄 Laps: ' + camion.vueltas : '';
        infoRuta += infoVueltas;
        
        if (filtro !== "" && !placa.includes(filtro) && !infoRuta.includes(filtro)) continue; 
        totalUnidades++;
        
        let claseCSS = camion.tipo === 'INTERNO' ? 'interno' : 'foraneo';
        if (camion.tipo === 'INTERNO' && camion.subtipo === 'Housekeeping') claseCSS = 'housekeeping';
        if (camion.tipo === 'INTERNO' && camion.subtipo === 'Traslado') claseCSS = 'traslado';

        let chipHtml = ''; 
        if (camion.estado === 'emergencia') { claseCSS = 'alerta-emergencia'; chipHtml = `<span class="chip-estado chip-emergencia">Emergencia</span>`;} 
        else if (camion.estado === 'pager') { claseCSS = 'alerta-pager'; chipHtml = `<span class="chip-estado chip-pager">Falla</span>`;}
        else if (camion.estado === 'baño') { claseCSS = 'alerta-bano'; chipHtml = `<span class="chip-estado chip-bano">Pausa</span>`;}
        else if (camion.estado === 'ocio') { claseCSS = 'alerta-ocio'; chipHtml = `<span class="chip-estado chip-ocio">Ocio</span>`;}
        if (parseFloat(camion.velocidad_actual) > 30) { claseCSS += ' alerta-velocidad'; chipHtml = `<span class="chip-estado chip-velocidad">⚠️ VELOCIDAD</span>`; }

        let isChecked = seleccionadosMulti.has(placa) ? 'checked' : '';
        let aplicaTT = (camion.tipo === 'FORANEO' || (camion.tipo === 'INTERNO' && camion.subtipo === 'Traslado'));
        let minTxt = aplicaTT ? Math.floor((Date.now() - (camion.hora_ingreso||Date.now())) / 60000) + 'm' : 'N/A';

        let tarjetaHTML = `
            <div class="tarjeta-unidad ${claseCSS} ${placa === camionSeleccionado ? 'seleccionada' : ''}" onclick="seleccionarCamion('${placa}', '${camion.estado}')">
                ${chipHtml}
                <div class="placa"><input type="checkbox" class="chk-multi" ${isChecked} onclick="toggleMulti('${placa}', event)"><span>${placa}</span><span style="font-size:12px; color:var(--text-secondary);">${parseFloat(camion.velocidad_actual || 0).toFixed(1)} km/h</span></div>
                <div class="datos"><span>${infoRuta}</span><span>Flujo: ${minTxt}</span></div>
            </div>`;

        if (camion.tipo === 'INTERNO') { htmlInternos += tarjetaHTML; countInt++; } else { htmlForaneos += tarjetaHTML; countFor++; }
    }
    let vistaFinal = `<details open><summary>Operación Interna (${countInt}) <button class="btn-ojo" onclick="toggleOjito('internos', event)">[ ${verInternos ? "Ocultar" : "Mostrar"} ]</button></summary>${verInternos ? htmlInternos : ''}</details><details open><summary>Flujo Foráneo (${countFor}) <button class="btn-ojo" onclick="toggleOjito('foraneos', event)">[ ${verForaneos ? "Ocultar" : "Mostrar"} ]</button></summary>${verForaneos ? htmlForaneos : ''}</details>`;
    listaUnidades.innerHTML = vistaFinal; document.getElementById('contadorCamiones').innerText = totalUnidades; actualizarDashboard();
}

db.ref('camiones_en_patio').on('child_added', snap => {
    dataGlobal[snap.key] = snap.val(); let c = dataGlobal[snap.key];
    marcadoresCamiones[snap.key] = L.marker([c.lat, c.lng], { icon: getIcono(c.tipo, c.subtipo, c.estado) }).addTo(mapa);
    marcadoresCamiones[snap.key].on('click', () => seleccionarCamion(snap.key, c.estado)); marcadoresCamiones[snap.key].estadoGuardado = c.estado; renderLista();
});
db.ref('camiones_en_patio').on('child_changed', snap => {
    dataGlobal[snap.key] = snap.val(); let c = dataGlobal[snap.key];
    if (marcadoresCamiones[snap.key]) { marcadoresCamiones[snap.key].setLatLng([c.lat, c.lng]); if (marcadoresCamiones[snap.key].estadoGuardado !== c.estado) { marcadoresCamiones[snap.key].setIcon(getIcono(c.tipo, c.subtipo, c.estado)); marcadoresCamiones[snap.key].estadoGuardado = c.estado; if(camionSeleccionado === snap.key) seleccionarCamion(snap.key, c.estado); } } renderLista();
});
db.ref('camiones_en_patio').on('child_removed', snap => {
    const placa = snap.key; const camionInfo = snap.val(); delete dataGlobal[placa];
    if (marcadoresCamiones[placa]) { mapa.removeLayer(marcadoresCamiones[placa]); delete marcadoresCamiones[placa]; }
    if(camionSeleccionado === placa) { camionSeleccionado = null; document.getElementById('panelAcciones').style.display = 'none'; }
    if(seleccionadosMulti.has(placa)) { seleccionadosMulti.delete(placa); actualizarPanelMulti(); }
    if(camionInfo) {
        let min = Math.floor((Date.now() - (camionInfo.hora_ingreso||Date.now())) / 60000); camionInfo.minutos_totales = min; camionInfo.hora_salida = Date.now();
        const fechaHoy = obtenerFechaLocal();
        db.ref(`viajes_finalizados/${fechaHoy}/${placa}_${Date.now()}`).set(camionInfo);
        if(camionInfo.tipo === 'FORANEO' || (camionInfo.tipo === 'INTERNO' && camionInfo.subtipo === 'Traslado')) {
            showToast(`Unidad ${placa} finalizó flujo. Truck Time: ${min} min`);
        }
    }
    renderLista();
});

// ==========================================
// 📍 REPRODUCTOR HISTÓRICO Y TELEMETRÍA
// ==========================================
function obtenerFechaLocal() {
    const hoy = new Date();
    const offset = hoy.getTimezoneOffset() * 60000;
    return new Date(hoy.getTime() - offset).toISOString().split('T')[0];
}

window.abrirReproductorGlobal = function() { 
    document.getElementById('reproductorRutas').style.display = 'block';
    document.getElementById('repFecha').value = obtenerFechaLocal(); 
    document.getElementById('inputPlacaHistorial').value = '';
    document.getElementById('repInfoHora').innerText = "--:--";
    limpiarRutaMapa();
};

window.abrirReproductor = function() { 
    if (!camionSeleccionado) return;
    document.getElementById('reproductorRutas').style.display = 'block';
    document.getElementById('repFecha').value = obtenerFechaLocal(); 
    document.getElementById('inputPlacaHistorial').value = camionSeleccionado;
    cargarHistorialDia();
};

window.cargarHistorialDia = function() { 
    const fecha = document.getElementById('repFecha').value;
    const placaInput = document.getElementById('inputPlacaHistorial').value.trim().toUpperCase();
    
    if (!fecha || !placaInput) return alert("Ingresa una fecha y una matrícula válida.");
    
    limpiarRutaMapa(); 
    document.getElementById('repInfoHora').innerText = "Buscando..."; 
    
    db.ref(`historial_rutas/${fecha}/${placaInput}`).once('value', snap => {
        let val = snap.val();
        if (val) {
            if (val[fecha]) procesarDatosHistorial(val[fecha]);
            else procesarDatosHistorial(val);
        } else {
            db.ref(`historial_rutas/${placaInput}/${fecha}`).once('value', snap2 => {
                procesarDatosHistorial(snap2.val());
            });
        }
    });
};

function procesarDatosHistorial(val) {
    if (!val) {
        document.getElementById('repInfoHora').innerText = "--:--"; 
        return mostrarModal("Vacío", `No hay registros para la unidad en el día seleccionado.`); 
    }

    datosHistorial = Object.values(val).map(p => {
        return {
            lat: p.lat || p.latitude || p.latitud || 0,
            lng: p.lng || p.longitude || p.longitud || 0,
            time: p.time || p.timestamp || p.hora || Date.now(),
            vel: parseFloat(p.vel || p.velocidad || p.velocidad_actual || p.speed || 0).toFixed(1),
            est: p.est || p.estado || 'activo',
            vue: p.vue || p.vueltas || 0
        };
    }).filter(p => p.lat !== 0 && p.lng !== 0).sort((a, b) => a.time - b.time);

    if(datosHistorial.length === 0) {
        document.getElementById('repInfoHora').innerText = "--:--";
        return mostrarModal("Vacío", "Los registros encontrados están vacíos o corruptos.");
    }
    
    document.getElementById('sliderRep').max = datosHistorial.length - 1; 
    document.getElementById('sliderRep').value = 0; 
    
    generarGraficaVelocidad(datosHistorial);
    dibujarLineaHistorial(); 
    actualizarDatosSlider(0);
    detectarTiemposMuertos(datosHistorial);
}

function detectarTiemposMuertos(datos) {
    let enPausa = false, inicioPausa = null, finPausa = null;
    for(let i=0; i<datos.length; i++) {
        let p = datos[i];
        let v = parseFloat(p.vel);
        if(v <= 2) { 
            if(!enPausa) { enPausa = true; inicioPausa = p; }
            finPausa = p;
        } else { 
            if(enPausa) { evaluarParada(inicioPausa, finPausa); enPausa = false; }
        }
    }
    if(enPausa) evaluarParada(inicioPausa, finPausa); 
}

function evaluarParada(inicio, fin) {
    let duracionMs = fin.time - inicio.time;
    let minDetenido = Math.floor(duracionMs / 60000);
    if(minDetenido >= 5) { 
        const iconoParada = L.divIcon({
            className: '',
            html: `<div style="background-color:#ef4444; color:white; border-radius:50%; width:24px; height:24px; display:flex; align-items:center; justify-content:center; border:2px solid white; box-shadow:0 0 5px rgba(0,0,0,0.5); font-size:12px; cursor:pointer;">🛑</div>`,
            iconSize: [24, 24], iconAnchor: [12, 12]
        });
        let horaInicio = new Date(inicio.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        let horaFin = new Date(fin.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        let marker = L.marker([inicio.lat, inicio.lng], {icon: iconoParada, zIndexOffset: 800}).addTo(mapa);
        
        let tooltipContent = `
            <div style="text-align:center; font-family:'Plus Jakarta Sans', sans-serif;">
                <strong style="color:#ef4444; font-size:14px;">🛑 Detención Crítica</strong><br>
                <b>Duración:</b> ${minDetenido} Minutos<br>
                <span style="font-size:11px; color:#666;">${horaInicio} - ${horaFin}</span>
            </div>
        `;
        marker.bindTooltip(tooltipContent, {direction: 'top', offset: [0, -10], opacity: 0.95});
        marcadoresTiempoMuerto.push(marker); 
    }
}

function generarGraficaVelocidad(datos) {
    const canvas = document.getElementById('graficaVelocidad');
    if (!canvas) return console.error("Falta el <canvas id='graficaVelocidad'> en el HTML");
    const ctx = canvas.getContext('2d');
    
    if (chartVelocidad) chartVelocidad.destroy(); 

    const labels = datos.map(p => new Date(p.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}));
    const dataVel = datos.map(p => parseFloat(p.vel));

    const lineaVerticalPlugin = {
        id: 'lineaVertical',
        afterDraw: chart => {
            const meta = chart.getDatasetMeta(0);
            const pt = meta.data[indexRastreador]; 
            if (pt) {
                const ctx = chart.ctx;
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(pt.x, chart.scales.y.top);
                ctx.lineTo(pt.x, chart.scales.y.bottom);
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#FF5E3A'; 
                ctx.setLineDash([5, 5]); 
                ctx.stroke();
                ctx.restore();
            }
        }
    };

    const banderasCicloPlugin = {
        id: 'banderasCiclo',
        afterDraw: chart => {
            const ctx = chart.ctx;
            const meta = chart.getDatasetMeta(0);
            const topY = chart.scales.y.top;
            const bottomY = chart.scales.y.bottom;

            let vueltaActual = 0;
            let prevX = null;
            let prevTime = null;

            ctx.save();
            ctx.textAlign = 'center';

            for (let i = 0; i < datos.length; i++) {
                let vue = datos[i].vue || datos[i].vueltas || 0;
                if (vue > vueltaActual) {
                    vueltaActual = vue;
                    const pt = meta.data[i];
                    if (!pt) continue;

                    // 1. Dibujar línea vertical negra
                    ctx.beginPath();
                    ctx.moveTo(pt.x, topY);
                    ctx.lineTo(pt.x, bottomY);
                    ctx.lineWidth = 1;
                    ctx.strokeStyle = '#1d1c15';
                    ctx.stroke();

                    // 2. Dibujar bandera
                    ctx.font = '14px Arial';
                    ctx.fillText('🏁', pt.x, topY - 5);

                    // 3. Calcular y dibujar el gap de tiempo (Cycle Time)
                    if (prevTime && prevX) {
                        let diffMs = datos[i].time - prevTime;
                        let min = Math.floor(diffMs / 60000);
                        let sec = Math.floor((diffMs % 60000) / 1000);
                        let gapText = `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
                        
                        let midX = prevX + ((pt.x - prevX) / 2);
                        ctx.font = 'bold 11px "Plus Jakarta Sans"';
                        ctx.fillStyle = '#1d1c15';
                        ctx.fillText(gapText, midX, topY + 15);
                    }

                    prevX = pt.x;
                    prevTime = datos[i].time;
                }
            }
            ctx.restore();
        }
    };

    chartVelocidad = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Velocidad (km/h)',
                data: dataVel,
                segment: {
                    borderColor: ctx => ctx.p0.parsed.y <= 2 ? '#ef4444' : '#10b981',
                    backgroundColor: ctx => ctx.p0.parsed.y <= 2 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)'
                },
                borderWidth: 2, fill: true, pointRadius: 0, tension: 0.3 
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
            scales: {
                x: { display: true, ticks: { maxTicksLimit: 8, font: { size: 10 } } }, 
                y: { beginAtZero: true, max: Math.max(...dataVel) + 10, ticks: { font: {size: 10} } }
            }
        },
        plugins: [lineaVerticalPlugin, banderasCicloPlugin] 
    });
}

window.moverPaso = function(direccion) {
    let slider = document.getElementById('sliderRep');
    let max = parseInt(slider.max);
    let val = parseInt(slider.value) + direccion;
    if (val >= 0 && val <= max) {
        slider.value = val;
        actualizarDatosSlider(val);
    }
};

function dibujarLineaHistorial() { 
    const ptos = datosHistorial.map(p => [p.lat, p.lng]); 
    polylineHistorial = L.polyline(ptos, {color: '#FF5E3A', weight: 4, opacity: 0.8, dashArray: '8, 8'}).addTo(mapa); 
    mapa.fitBounds(polylineHistorial.getBounds(), {padding: [50, 50]}); 
    const ghostIcon = L.divIcon({ className: '', html: `<div class="icono-base icono-fantasma"></div>`, iconSize: [12, 12], iconAnchor: [6, 6] }); 
    marcadorHistorial = L.marker(ptos[0], {icon: ghostIcon, zIndexOffset: 1000}).addTo(mapa); 
    
    let vueltaActual = 0;
    for (let i = 0; i < datosHistorial.length; i++) {
        if (datosHistorial[i].vue > vueltaActual) {
            vueltaActual = datosHistorial[i].vue;
            const iconoMeta = L.divIcon({ className: '', html: `<div style="font-size:24px; text-shadow: 0 0 8px #000;">🏁</div>`, iconSize: [24, 24], iconAnchor: [12,24] });
            let metaMarker = L.marker([datosHistorial[i].lat, datosHistorial[i].lng], {icon: iconoMeta, zIndexOffset: 900}).addTo(mapa).bindTooltip(`Lap ${vueltaActual}`, {permanent: true, direction: 'top', className: 'geo-tooltip'});
            marcadoresTiempoMuerto.push(metaMarker);
        }
    }
}

window.actualizarDatosSlider = function(index) { 
    if(datosHistorial.length === 0) return; 
    const punto = datosHistorial[index]; 
    marcadorHistorial.setLatLng([punto.lat, punto.lng]); 
    document.getElementById('repInfoHora').innerText = new Date(punto.time).toLocaleTimeString(); 
    document.getElementById('repInfoVel').innerText = parseFloat(punto.vel).toFixed(1) + " km/h"; 
    document.getElementById('repInfoEst').innerText = punto.est.toUpperCase(); 

    indexRastreador = index;
    if (chartVelocidad) chartVelocidad.update('none'); 
};

window.moverSliderRep = function() { actualizarDatosSlider(parseInt(document.getElementById('sliderRep').value)); };

window.togglePlayRep = function() { 
    const btn = document.getElementById('btnPlayRep'); 
    if(timerHistorial) { 
        clearInterval(timerHistorial); timerHistorial = null; btn.innerText = "Play"; 
    } else { 
        btn.innerText = "Pausa"; 
        timerHistorial = setInterval(() => { 
            let val = parseInt(document.getElementById('sliderRep').value); 
            if(val < datosHistorial.length - 1) { 
                document.getElementById('sliderRep').value = ++val; actualizarDatosSlider(val); 
            } else { 
                clearInterval(timerHistorial); timerHistorial = null; btn.innerText = "Play"; 
            } 
        }, 800); 
    } 
};

function limpiarRutaMapa() { 
    if(polylineHistorial) mapa.removeLayer(polylineHistorial); 
    if(marcadorHistorial) mapa.removeLayer(marcadorHistorial); 
    if(marcadoresTiempoMuerto.length > 0) { marcadoresTiempoMuerto.forEach(m => mapa.removeLayer(m)); marcadoresTiempoMuerto = []; }
    polylineHistorial = null; marcadorHistorial = null; 
    if(timerHistorial) clearInterval(timerHistorial); timerHistorial = null; 
    document.getElementById('btnPlayRep').innerText = "Play"; 
}

window.cerrarReproductor = function() { 
    limpiarRutaMapa(); document.getElementById('reproductorRutas').style.display = 'none'; datosHistorial = []; mapa.setView([19.066, -104.295], 16); 
};

// ==========================================
// 📞 SISTEMA WEBRTC (LLAMADAS)
// ==========================================
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let localStreamTorre; let pcTorre; let unsubscribeWebRTC = null;

window.iniciarLlamadaTorre = async function() {
    if(!camionSeleccionado) return;
    try {
        localStreamTorre = await navigator.mediaDevices.getUserMedia({ audio: true });
        pcTorre = new RTCPeerConnection(rtcConfig);
        localStreamTorre.getTracks().forEach(track => pcTorre.addTrack(track, localStreamTorre));
        pcTorre.onicecandidate = event => { if (event.candidate) { db.ref(`llamadas/${camionSeleccionado}/callerCandidates`).push(event.candidate.toJSON()); } };
        pcTorre.ontrack = event => { document.getElementById('audioRemotoTorre').srcObject = event.streams[0]; };
        const offer = await pcTorre.createOffer();
        await pcTorre.setLocalDescription(offer);
        db.ref(`llamadas/${camionSeleccionado}`).set({ offer: { type: offer.type, sdp: offer.sdp } });
        document.getElementById('lblEstadoLlamada').innerText = `Llamando a Unidad ${camionSeleccionado}...`;
        document.getElementById('modalLlamadaActiva').style.display = 'flex';
        unsubscribeWebRTC = db.ref(`llamadas/${camionSeleccionado}`).on('value', snap => {
            const data = snap.val();
            if (!data) { colgarLlamadaTorre(true); return; } 
            if (data.answer && pcTorre.signalingState !== 'stable') {
                document.getElementById('lblEstadoLlamada').innerText = `En llamada con ${camionSeleccionado} 🎙️`;
                pcTorre.setRemoteDescription(new RTCSessionDescription(data.answer));
            }
        });
        db.ref(`llamadas/${camionSeleccionado}/calleeCandidates`).on('child_added', snap => { if(snap.val()) pcTorre.addIceCandidate(new RTCIceCandidate(snap.val())); });
    } catch (e) { alert("Error de Micrófono: Por favor permite el acceso al micrófono."); }
};

window.colgarLlamadaTorre = function(remoto = false) {
    if(camionSeleccionado && !remoto) db.ref(`llamadas/${camionSeleccionado}`).remove();
    if(unsubscribeWebRTC && camionSeleccionado) db.ref(`llamadas/${camionSeleccionado}`).off('value', unsubscribeWebRTC);
    if(pcTorre) { pcTorre.close(); pcTorre = null; }
    if(localStreamTorre) { localStreamTorre.getTracks().forEach(t => t.stop()); localStreamTorre = null; }
    document.getElementById('modalLlamadaActiva').style.display = 'none';
};

function purgarHistorialAntiguo() {
    const hoy = new Date();
    db.ref('historial_rutas').once('value', snap => {
        if (!snap.val()) return;
        const fechasRegistradas = Object.keys(snap.val()); 
        fechasRegistradas.forEach(fechaStr => {
            const fechaCarpeta = new Date(fechaStr);
            const diferenciaDias = Math.floor((hoy - fechaCarpeta) / (1000 * 60 * 60 * 24));
            if (diferenciaDias > 7) db.ref(`historial_rutas/${fechaStr}`).remove();
        });
    });
}
setTimeout(purgarHistorialAntiguo, 3000);
