const mapa = L.map('mapa', { zoomControl: false }).setView([19.066, -104.295], 16);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(mapa);
L.control.zoom({ position: 'topright' }).addTo(mapa);

const firebaseConfig = { apiKey: "AIzaSyAH7D-sLL4fCJDliP8xzuYUQGt-H5H7nXE", authDomain: "patio-densidad.firebaseapp.com", databaseURL: "https://patio-densidad-default-rtdb.firebaseio.com", projectId: "patio-densidad" };
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// LÓGICA DE LOGIN (Candado Beta)
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

const marcadoresCamiones = {}; const listaUnidades = document.getElementById('listaUnidades');
let camionSeleccionado = null; let dataGlobal = {}; let seleccionadosMulti = new Set();
let geocercasMapa = {}; let posicionesMapa = {}; let emergenciasMapa = {};
let verInternos = true, verForaneos = true; let chartFlota = null;

window.onload = () => {
    const ctx = document.getElementById('graficaFlota').getContext('2d');
    chartFlota = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: ['Activos', 'Ocio', 'Baño', 'Pager', 'Emergencia'], datasets: [{ data: [0, 0, 0, 0, 0], backgroundColor: ['#a4c900', '#ba68c8', '#fbc02d', '#f57f17', '#ba1a1a'], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'right', labels: { font: { family: 'Plus Jakarta Sans', size: 11, weight: 'bold' } } } } }
    });
};

window.cambiarTab = function(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('activo'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('activo'));
    document.getElementById(`tab-${tabName}`).classList.add('activo');
    document.getElementById(`btnTab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`).classList.add('activo');
};

// EXCEL INTELIGENTE (Solo Truck Time a Foráneos y Traslados)
window.exportarExcel = async function() {
    const fechaHoy = new Date().toISOString().split('T')[0];
    let csv = "Placa,Tipo,Subtipo,Estado,Destino/Buque,STS,Velocidad (km/h),Hora Ingreso,Hora Salida,Truck Time Min,Estatus\n";
    
    for(let key in dataGlobal) {
        let u = dataGlobal[key]; 
        let aplicaTT = (u.tipo === 'FORANEO' || (u.tipo === 'INTERNO' && u.subtipo === 'Traslado'));
        let min = aplicaTT ? Math.floor((Date.now() - (u.hora_ingreso||Date.now())) / 60000) : 'N/A';
        let horaIn = u.hora_ingreso ? new Date(u.hora_ingreso).toLocaleTimeString() : 'N/A';
        
        csv += `${u.placa},${u.tipo},${u.subtipo || 'N/A'},${u.estado},${u.destino || u.buque || 'S/D'},${u.sts || 'N/A'},${u.velocidad_actual || 0},${horaIn},EN RUTA,${min},ACTIVO\n`;
    }
    
    const snap = await db.ref(`viajes_finalizados/${fechaHoy}`).once('value');
    if(snap.val()) {
        let finalizados = snap.val();
        for(let key in finalizados) {
            let u = finalizados[key];
            let aplicaTT = (u.tipo === 'FORANEO' || (u.tipo === 'INTERNO' && u.subtipo === 'Traslado'));
            let minTotal = aplicaTT ? (u.minutos_totales || 0) : 'N/A';
            let horaIn = u.hora_ingreso ? new Date(u.hora_ingreso).toLocaleTimeString() : 'N/A';
            let horaOut = u.hora_salida ? new Date(u.hora_salida).toLocaleTimeString() : 'N/A';
            
            csv += `${u.placa},${u.tipo},${u.subtipo || 'N/A'},COMPLETADO,${u.destino || u.buque || 'S/D'},${u.sts || 'N/A'},0,${horaIn},${horaOut},${minTotal},FINALIZADO\n`;
        }
    }
    
    const blob = new Blob(["\uFEFF"+csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `Reporte_YMS_${fechaHoy}.csv`; a.click();
};

// DASHBOARD INTELIGENTE (Promedia solo aplicables)
function actualizarDashboard() {
    let total = 0, ocio = 0, act = 0, bano = 0, pager = 0, emerg = 0; 
    let sumaMinutosTotales = 0;
    let unidadesParaPromedio = 0;

    for(let key in dataGlobal) {
        total++; let c = dataGlobal[key]; let est = c.estado;
        if(est === 'ocio') ocio++; else if(est === 'baño') bano++; else if(est === 'pager') pager++; else if(est === 'emergencia') emerg++; else act++;
        
        let aplicaTT = (c.tipo === 'FORANEO' || (c.tipo === 'INTERNO' && c.subtipo === 'Traslado'));
        if(aplicaTT) {
            sumaMinutosTotales += Math.floor((Date.now() - (c.hora_ingreso || Date.now())) / 60000);
            unidadesParaPromedio++;
        }
    }
    
    document.getElementById('dashTotal').innerText = total; document.getElementById('dashOcio').innerText = ocio;
    
    let promedio = unidadesParaPromedio > 0 ? Math.floor(sumaMinutosTotales / unidadesParaPromedio) : 0;
    document.getElementById('dashTruckTime').innerText = promedio + "m";
    
    if(chartFlota) { chartFlota.data.datasets[0].data = [act, ocio, bano, pager, emerg]; chartFlota.update(); }
}

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
        
        // CONDICIONAL VISUAL TRUCK TIME
        let aplicaTT = (camion.tipo === 'FORANEO' || (camion.tipo === 'INTERNO' && camion.subtipo === 'Traslado'));
        let minTxt = aplicaTT ? Math.floor((Date.now() - (camion.hora_ingreso||Date.now())) / 60000) + 'm' : 'N/A';

        let tarjetaHTML = `
            <div class="tarjeta-unidad ${claseCSS} ${placa === camionSeleccionado ? 'seleccionada' : ''}" onclick="seleccionarCamion('${placa}', '${camion.estado}')">
                ${chipHtml}
                <div class="placa"><input type="checkbox" class="chk-multi" ${isChecked} onclick="toggleMulti('${placa}', event)"><span>${placa}</span><span style="font-size:12px; color:var(--text-secondary);">${camion.velocidad_actual||0} km/h</span></div>
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
        const fechaHoy = new Date().toISOString().split('T')[0];
        db.ref(`viajes_finalizados/${fechaHoy}/${placa}_${Date.now()}`).set(camionInfo);
        
        // TOAST SOLO PARA APLICABLES A TRUCK TIME
        if(camionInfo.tipo === 'FORANEO' || (camionInfo.tipo === 'INTERNO' && camionInfo.subtipo === 'Traslado')) {
            showToast(`Unidad ${placa} finalizó flujo. Truck Time: ${min} min`);
        }
    }
    renderLista();
});

// HISTORIAL REPRODUCTOR MANTIENE IGUAL
let datosHistorial = [], polylineHistorial = null, marcadorHistorial = null, timerHistorial = null;
window.abrirReproductor = function() { if (!camionSeleccionado) return; document.getElementById('reproductorRutas').style.display = 'block'; document.getElementById('repPlaca').innerText = "Historial: " + camionSeleccionado; document.getElementById('repFecha').value = new Date().toISOString().split('T')[0]; cargarHistorialDia(); };
window.cargarHistorialDia = function() { const fecha = document.getElementById('repFecha').value; if(!fecha || !camionSeleccionado) return; limpiarRutaMapa(); document.getElementById('repInfoHora').innerText = "..."; db.ref(`historial_rutas/${fecha}/${camionSeleccionado}`).once('value', snap => { if(!snap.val()) { document.getElementById('repInfoHora').innerText = "--:--"; return mostrarModal("Vacio", "Sin registros."); } datosHistorial = Object.values(snap.val()).sort((a,b) => a.time - b.time); if(datosHistorial.length === 0) return; document.getElementById('sliderRep').max = datosHistorial.length - 1; document.getElementById('sliderRep').value = 0; dibujarLineaHistorial(); actualizarDatosSlider(0); }); };
function dibujarLineaHistorial() { const ptos = datosHistorial.map(p => [p.lat, p.lng]); polylineHistorial = L.polyline(ptos, {color: '#FF5E3A', weight: 4, opacity: 0.8, dashArray: '8, 8'}).addTo(mapa); mapa.fitBounds(polylineHistorial.getBounds(), {padding: [50, 50]}); const ghostIcon = L.divIcon({ className: '', html: `<div class="icono-base icono-fantasma"></div>`, iconSize: [12, 12], iconAnchor: [6, 6] }); marcadorHistorial = L.marker(ptos[0], {icon: ghostIcon, zIndexOffset: 1000}).addTo(mapa); }
window.actualizarDatosSlider = function(index) { if(datosHistorial.length === 0) return; const punto = datosHistorial[index]; marcadorHistorial.setLatLng([punto.lat, punto.lng]); document.getElementById('repInfoHora').innerText = new Date(punto.time).toLocaleTimeString(); document.getElementById('repInfoVel').innerText = punto.vel + " km/h"; document.getElementById('repInfoEst').innerText = punto.est.toUpperCase(); };
window.moverSliderRep = function() { actualizarDatosSlider(parseInt(document.getElementById('sliderRep').value)); };
window.togglePlayRep = function() { const btn = document.getElementById('btnPlayRep'); if(timerHistorial) { clearInterval(timerHistorial); timerHistorial = null; btn.innerText = "Play"; } else { btn.innerText = "Pausa"; timerHistorial = setInterval(() => { let val = parseInt(document.getElementById('sliderRep').value); if(val < datosHistorial.length - 1) { document.getElementById('sliderRep').value = ++val; actualizarDatosSlider(val); } else { clearInterval(timerHistorial); timerHistorial = null; btn.innerText = "Play"; } }, 800); } };
function limpiarRutaMapa() { if(polylineHistorial) mapa.removeLayer(polylineHistorial); if(marcadorHistorial) mapa.removeLayer(marcadorHistorial); polylineHistorial = null; marcadorHistorial = null; if(timerHistorial) clearInterval(timerHistorial); timerHistorial = null; document.getElementById('btnPlayRep').innerText = "Play"; }
window.cerrarReproductor = function() { limpiarRutaMapa(); document.getElementById('reproductorRutas').style.display = 'none'; datosHistorial = []; mapa.setView([19.066, -104.295], 16); };


// ==========================================
// 📞 SISTEMA WEBRTC (LLAMADAS P2P GRATUITAS)
// ==========================================
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let localStreamTorre;
let pcTorre;
let unsubscribeWebRTC = null;

window.iniciarLlamadaTorre = async function() {
    if(!camionSeleccionado) return;
    try {
        localStreamTorre = await navigator.mediaDevices.getUserMedia({ audio: true });
        pcTorre = new RTCPeerConnection(rtcConfig);
        localStreamTorre.getTracks().forEach(track => pcTorre.addTrack(track, localStreamTorre));

        pcTorre.onicecandidate = event => {
            if (event.candidate) { db.ref(`llamadas/${camionSeleccionado}/callerCandidates`).push(event.candidate.toJSON()); }
        };

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

        db.ref(`llamadas/${camionSeleccionado}/calleeCandidates`).on('child_added', snap => {
            if(snap.val()) pcTorre.addIceCandidate(new RTCIceCandidate(snap.val()));
        });

    } catch (e) {
        alert("Error de Micrófono: Por favor permite el acceso al micrófono en tu navegador.");
    }
};

window.colgarLlamadaTorre = function(remoto = false) {
    if(camionSeleccionado && !remoto) db.ref(`llamadas/${camionSeleccionado}`).remove();
    if(unsubscribeWebRTC && camionSeleccionado) db.ref(`llamadas/${camionSeleccionado}`).off('value', unsubscribeWebRTC);
    if(pcTorre) { pcTorre.close(); pcTorre = null; }
    if(localStreamTorre) { localStreamTorre.getTracks().forEach(t => t.stop()); localStreamTorre = null; }
    document.getElementById('modalLlamadaActiva').style.display = 'none';
};