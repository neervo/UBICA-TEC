const firebaseConfig = { apiKey: "AIzaSyAH7D-sLL4fCJDliP8xzuYUQGt-H5H7nXE", authDomain: "patio-densidad.firebaseapp.com", databaseURL: "https://patio-densidad-default-rtdb.firebaseio.com", projectId: "patio-densidad" };
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let coordenadasBahias = {}; let poligonoTerminal = []; let fueraDeTerminalMinutos = 0; let primerRegistroExitoso = false; 

db.ref('configuracion/posiciones').on('value', snap => { coordenadasBahias = {}; if(snap.val()) { for(let key in snap.val()) coordenadasBahias[snap.val()[key].nombre.toUpperCase()] = snap.val()[key].coordenadas; } });
db.ref('configuracion/geocercas').on('value', snap => { poligonoTerminal = []; if(snap.val()) { for(let key in snap.val()) { if(snap.val()[key].nombre.toUpperCase().trim() === 'TERMINAL') { poligonoTerminal = snap.val()[key].coordenadas; } } } });

// ==========================================
// 🛰️ INTEGRACIÓN GPS J16 (FÍSICO - VPS UBICA-TEC)
// ==========================================
let marcadoresFlotaFisica = {};

db.ref('Flota_Activa').on('value', snap => {
    const flota = snap.val();
    if (!flota) return;

    // Recorremos todos los dispositivos reportando en Flota_Activa
    for (let id in flota) {
        const gpsData = flota[id];
        if (!gpsData.latitud || !gpsData.longitud) continue;

        const lat = gpsData.latitud;
        const lng = gpsData.longitud;

        console.log(`[GPS VIVO - ${id}] Lat: ${lat}, Lng: ${lng}`);

        if (typeof mapa !== 'undefined' && mapa) {
            if (marcadoresFlotaFisica[id]) {
                // Si el marcador ya existe, solo actualizamos su posición suavemente
                marcadoresFlotaFisica[id].setLatLng([lat, lng]);
            } else {
                // Si es nuevo, creamos un marcador llamativo color naranja en el mapa
                marcadoresFlotaFisica[id] = L.circleMarker([lat, lng], { 
                    radius: 12, 
                    fillColor: "#FF5722", 
                    color: "#FFFFFF", 
                    weight: 3, 
                    fillOpacity: 1 
                }).addTo(mapa).bindPopup(`<b>GPS Físico: ${id}</b><br>Velocidad: ${gpsData.velocidad || 0} km/h`);
                
                // Centramos la vista del mapa la primera vez que aparezca
                mapa.setView([lat, lng], 17);
            }
        }
    }
});

function estaDentroDelPoligono(punto, poligono) {
    let x = punto[0], y = punto[1]; let adentro = false;
    for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
        let xi = poligono[i][0], yi = poligono[i][1]; let xj = poligono[j][0], yj = poligono[j][1];
        let interseccion = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (interseccion) adentro = !adentro;
    }
    return adentro;
}

let mapa, marcadorMia, marcadorDestino, watchId = null, wakeLock = null, timerInterval = null;
let tipoGlobal = "", subtipoGlobal = "", placaGlobal = "", destinoGlobal = "", buqueGlobal = "", stsGlobal = "", empleadoGlobal = "";
let horaIngreso = 0, maxSpeed = 0, ultimoAudio = 0, estadoOperativo = "activo";
let latActual = null, lngActual = null, velActual = 0;
let historialBatch = JSON.parse(localStorage.getItem('historialYMS_Offline')) || [];
let tracker1Min = null, sender5Min = null; let ultimaVezMovimiento = Date.now(); let expulsado = false; let destinoPivoteActual = ""; 

mapa = L.map('mapaFondo', { zoomControl: false }).setView([19.066, -104.295], 16);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(mapa);

let emergenciasMapa = {};
db.ref('configuracion/emergencias').on('value', snap => {
    for(let k in emergenciasMapa) mapa.removeLayer(emergenciasMapa[k]); emergenciasMapa = {};
    if(snap.val()) {
        const iconoSOS = L.divIcon({ className: '', html: `<div class="icono-emergencia-punto"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] });
        for(let key in snap.val()) { emergenciasMapa[key] = L.marker(snap.val()[key].coordenadas, {icon: iconoSOS, interactive: false}).addTo(mapa); }
    }
});

function mostrarAlertaPersonalizada(titulo, mensaje) { document.getElementById('alertTitle').innerText = titulo; document.getElementById('alertText').innerText = mensaje; document.getElementById('customAlert').style.display = 'flex'; }
async function solicitarWakeLock() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {} }
function hablar(texto) { if ('speechSynthesis' in window) { window.speechSynthesis.speak(new SpeechSynthesisUtterance(texto)); } }

document.getElementById('subtipoInput').addEventListener('change', function() {
    let val = this.value; document.getElementById('empleadoInput').style.display = 'block';
    if(val === 'Operacion Buque') { document.getElementById('buqueInput').style.display = 'block'; document.getElementById('stsInput').style.display = 'block'; } 
    else if (val === 'Housekeeping') { document.getElementById('buqueInput').style.display = 'none'; document.getElementById('stsInput').style.display = 'none'; } 
    else if (val === 'Traslado') { document.getElementById('buqueInput').style.display = 'block'; document.getElementById('stsInput').style.display = 'none'; }
});

function seleccionarPerfil(tipo) {
    tipoGlobal = tipo; document.getElementById('pantallaSeleccion').style.display = 'none'; document.getElementById('pantallaLogin').style.display = 'block'; document.getElementById('tituloLogin').innerText = tipo === 'FORANEO' ? "Flujo Foráneo" : "Operación Interna";
    if(tipo === 'FORANEO') { document.getElementById('posicionInput').style.display = 'block'; document.getElementById('subtipoInput').style.display = 'none'; document.getElementById('empleadoInput').style.display = 'none'; document.getElementById('buqueInput').style.display = 'none'; document.getElementById('stsInput').style.display = 'none'; document.getElementById('btnFinalizarTurno').style.display = 'none';
    } else { document.getElementById('posicionInput').style.display = 'none'; document.getElementById('subtipoInput').style.display = 'block'; document.getElementById('subtipoInput').dispatchEvent(new Event('change')); document.getElementById('btnFinalizarTurno').style.display = 'block'; }
}

function volverSeleccion() { document.getElementById('pantallaSeleccion').style.display = 'block'; document.getElementById('pantallaLogin').style.display = 'none'; }
function centrarMapa() { if(latActual && lngActual) mapa.setView([latActual, lngActual], 18); }

function actualizarUIOperador() {
    if(expulsado) return; let min = Math.floor((Date.now() - horaIngreso) / 60000); let txtPrincipal = "";
    if (estadoOperativo === 'activo') txtPrincipal = `Flujo: ${min} min`; else if (estadoOperativo === 'baño') txtPrincipal = "PAUSA (BAÑO)"; else if (estadoOperativo === 'ocio') txtPrincipal = "TIEMPO MUERTO"; else if (estadoOperativo === 'pager') txtPrincipal = "FALLA SISTEMA"; else if (estadoOperativo === 'emergencia') txtPrincipal = "EMERGENCIA";
    if (poligonoTerminal.length > 2 && latActual && lngActual) {
        let adentro = estaDentroDelPoligono([latActual, lngActual], poligonoTerminal);
        let color = adentro ? "#a4c900" : "#ba1a1a"; let texto = adentro ? "🟢 ZONA TERMINAL" : "🔴 FUERA DE TERMINAL";
        txtPrincipal += `<br><span style="font-size:11px; font-weight:800; color:${color}; margin-top:5px; display:block; letter-spacing:0.05em;">${texto}</span>`;
    }
    if (velActual > 30) { txtPrincipal += `<br><span style="font-size:12px; font-weight:800; color:#ba1a1a; margin-top:5px; display:block;">⚠️ REDUCE VELOCIDAD</span>`; }
    document.getElementById('lblTiempo').innerHTML = txtPrincipal;
}

function iniciarRastreo() {
    placaGlobal = document.getElementById('placaInput').value.trim().toUpperCase();
    if(!placaGlobal) return mostrarAlertaPersonalizada("Error", "Debes ingresar tu matrícula.");
    expulsado = false; fueraDeTerminalMinutos = 0; primerRegistroExitoso = false;

    if (tipoGlobal === 'FORANEO') {
        destinoGlobal = document.getElementById('posicionInput').value.trim().toUpperCase(); if(!destinoGlobal) return mostrarAlertaPersonalizada("Error", "Ingresa el destino.");
        document.getElementById('mapaFondo').style.display = 'block'; document.getElementById('btnCentrar').style.display = 'flex'; setTimeout(() => { mapa.invalidateSize(); }, 300);
        document.getElementById('pantallaActiva').className = 'panel-flotante'; document.getElementById('botoneraInterna').style.display = 'none'; document.getElementById('lblDestino').innerText = "Destino: " + destinoGlobal;
        if (coordenadasBahias[destinoGlobal]) { if(marcadorDestino) mapa.removeLayer(marcadorDestino); marcadorDestino = L.marker(coordenadasBahias[destinoGlobal]).addTo(mapa).bindPopup("Destino Original"); }
    } else {
        subtipoGlobal = document.getElementById('subtipoInput').value; empleadoGlobal = document.getElementById('empleadoInput').value.trim().toUpperCase();
        if(!empleadoGlobal) return mostrarAlertaPersonalizada("Error", "Debes ingresar ID de empleado.");
        buqueGlobal = document.getElementById('buqueInput').value.trim().toUpperCase(); stsGlobal = document.getElementById('stsInput').value.trim().toUpperCase();
        if(subtipoGlobal === 'Operacion Buque' && (!buqueGlobal || !stsGlobal)) return mostrarAlertaPersonalizada("Error", "Falta Buque o Grúa STS.");
        if(subtipoGlobal === 'Traslado' && !buqueGlobal) return mostrarAlertaPersonalizada("Error", "Falta el Buque Asignado.");
        document.getElementById('mapaFondo').style.display = 'none'; document.getElementById('btnCentrar').style.display = 'none';
        document.getElementById('pantallaActiva').className = 'panel-completo'; document.getElementById('botoneraInterna').style.display = 'block';
        if(subtipoGlobal === 'Operacion Buque') document.getElementById('lblDestino').innerText = `ID: ${empleadoGlobal} | BQ: ${buqueGlobal} | ST: ${stsGlobal}`; else if(subtipoGlobal === 'Traslado') document.getElementById('lblDestino').innerText = `ID: ${empleadoGlobal} | BQ: ${buqueGlobal}`; else document.getElementById('lblDestino').innerText = `ID: ${empleadoGlobal} | ${subtipoGlobal}`;
    }

    const fechaHoy = new Date().toISOString().split('T')[0];
    tracker1Min = setInterval(() => { if(latActual && lngActual && !expulsado) { historialBatch.push({ lat: latActual, lng: lngActual, vel: velActual, est: estadoOperativo, time: Date.now() }); localStorage.setItem('historialYMS_Offline', JSON.stringify(historialBatch)); } }, 60000); 
    sender5Min = setInterval(() => { if (historialBatch.length > 0 && !expulsado && navigator.onLine) { const refHistorial = db.ref(`historial_rutas/${fechaHoy}/${placaGlobal}`); historialBatch.forEach(punto => refHistorial.push(punto)); historialBatch = []; localStorage.removeItem('historialYMS_Offline'); } }, 300000);

    document.getElementById('lblPlaca').innerText = placaGlobal; document.getElementById('pantallaLogin').style.display = 'none'; document.getElementById('pantallaActiva').style.display = 'flex';
    horaIngreso = Date.now(); ultimaVezMovimiento = Date.now(); estadoOperativo = "activo";
    solicitarWakeLock(); hablar("Ingreso validado.");

    timerInterval = setInterval(() => {
        if (expulsado) return; let min = Math.floor((Date.now() - horaIngreso) / 60000);
        if (tipoGlobal === 'INTERNO' && estadoOperativo === 'activo') { let tiempoDetenido = Date.now() - ultimaVezMovimiento; if (tiempoDetenido >= (3 * 60 * 1000)) cambiarEstado('ocio', 'Detenido prolongado'); }
        if (min >= 2 && poligonoTerminal.length > 2 && latActual && lngActual) { let adentro = estaDentroDelPoligono([latActual, lngActual], poligonoTerminal); if (!adentro) { fueraDeTerminalMinutos++; if (fueraDeTerminalMinutos >= 3) salirRastreo(true); } else { fueraDeTerminalMinutos = 0; } }
    }, 60000);

    setInterval(actualizarUIOperador, 2000);

    db.ref('camiones_en_patio/' + placaGlobal).on('value', snap => {
        const data = snap.val();
        if(data === null && placaGlobal !== "" && primerRegistroExitoso) {
            expulsado = true; if (watchId) navigator.geolocation.clearWatch(watchId); if (timerInterval) clearInterval(timerInterval); if (tracker1Min) clearInterval(tracker1Min); if (sender5Min) clearInterval(sender5Min); alert("Turno finalizado remotamente."); window.location.reload(); return;
        }
        if(data === null) return; 

        if (data.tts_mensaje && data.tts_timestamp > ultimoAudio) { ultimoAudio = data.tts_timestamp; document.getElementById('textoMensaje').innerText = `"${data.tts_mensaje}"`; document.getElementById('alertaMensaje').style.display = 'block'; hablar(data.tts_mensaje); }

        if (tipoGlobal === 'FORANEO') {
            const nuevoPivote = data.destino_temporal || "";
            if (nuevoPivote !== destinoPivoteActual) {
                destinoPivoteActual = nuevoPivote;
                if (destinoPivoteActual !== "") { document.getElementById('lblDestino').innerHTML = `PIVOTE: ${destinoPivoteActual} <br><span style="font-size:12px; font-weight:500;">(Orig: ${destinoGlobal})</span>`; } else { document.getElementById('lblDestino').innerHTML = `Destino: ${destinoGlobal}`; }
                if (marcadorDestino) mapa.removeLayer(marcadorDestino);
                let coordActiva = coordenadasBahias[destinoPivoteActual] || coordenadasBahias[destinoGlobal];
                if (coordActiva) marcadorDestino = L.marker(coordActiva).addTo(mapa).bindPopup("Nueva Posición");
            }
        }

        if (data.estado && data.estado !== estadoOperativo) { estadoOperativo = data.estado; if(estadoOperativo === 'activo') { document.getElementById('btnBano').style.backgroundColor = '#ffca28'; document.getElementById('btnBano').style.color = '#752305'; document.getElementById('btnBano').innerText = "Baño"; ultimaVezMovimiento = Date.now(); } actualizarUIOperador(); }
    });

    db.ref(`llamadas/${placaGlobal}`).on('value', snap => {
        const callData = snap.val();
        if(!callData) { rechazarLlamada(true); return; } 
        
        if (callData.offer && !pcOp) {
            document.getElementById('lblLlamadaTit').innerText = "Llamada de Torre...";
            document.getElementById('botonesContestar').style.display = 'flex';
            document.getElementById('btnColgarOp').style.display = 'none';
            document.getElementById('modalLlamadaOperador').style.display = 'flex';
            window.llamadaOfferGuardada = callData.offer;
        }
    });

    if ("geolocation" in navigator) {
        watchId = navigator.geolocation.watchPosition(pos => {
            if (expulsado) return;
            if (pos.coords.accuracy > 3000) return; 

            latActual = pos.coords.latitude; lngActual = pos.coords.longitude;
            velActual = ((pos.coords.speed || 0) * 3.6).toFixed(1);
            if (parseFloat(velActual) > parseFloat(maxSpeed)) maxSpeed = velActual;
            
            if (parseFloat(velActual) > 2.0) { ultimaVezMovimiento = Date.now(); if (estadoOperativo === 'ocio') cambiarEstado('activo', null); }

            if (tipoGlobal === 'FORANEO') {
                if (marcadorMia) marcadorMia.setLatLng([latActual, lngActual]);
                else { marcadorMia = L.circleMarker([latActual, lngActual], { radius: 8, fillColor: "#38BDF8", color: "white", weight: 2, fillOpacity: 1 }).addTo(mapa); mapa.setView([latActual, lngActual], 18); }
            }

            db.ref('camiones_en_patio/' + placaGlobal).update({
                lat: latActual, lng: lngActual, placa: placaGlobal, tipo: tipoGlobal, subtipo: subtipoGlobal, estado: estadoOperativo,
                destino: destinoGlobal, buque: buqueGlobal, sts: stsGlobal, empleado: empleadoGlobal, hora_ingreso: horaIngreso, velocidad_actual: velActual
            }).then(() => { primerRegistroExitoso = true; });

        }, err => {}, { enableHighAccuracy: true, maximumAge: 0 });
    }
}

function cambiarEstado(nuevoEstado, msj) { if (expulsado) return; estadoOperativo = nuevoEstado; db.ref('camiones_en_patio/' + placaGlobal).update({ estado: nuevoEstado }); actualizarUIOperador(); }
function toggleBano() { if (expulsado) return; const btn = document.getElementById('btnBano'); if (estadoOperativo === 'baño') { cambiarEstado('activo', null); btn.style.backgroundColor = '#ffca28'; btn.style.color = '#752305'; btn.innerText = "Baño"; ultimaVezMovimiento = Date.now(); } else { cambiarEstado('baño', null); btn.style.backgroundColor = '#a4c900'; btn.style.color = 'white'; btn.innerText = "Reanudar Flujo"; } }

async function salirRastreo(esAutomatico) {
    if(!esAutomatico) { let conf = confirm("¿Finalizar el turno operativo?"); if(!conf) return; }
    expulsado = true;
    if (watchId) navigator.geolocation.clearWatch(watchId); if (timerInterval) clearInterval(timerInterval); if (tracker1Min) clearInterval(tracker1Min); if (sender5Min) clearInterval(sender5Min); if (wakeLock) wakeLock.release().then(() => wakeLock = null);
    if(historialBatch.length > 0 && navigator.onLine) { const fechaHoy = new Date().toISOString().split('T')[0]; historialBatch.forEach(punto => db.ref(`historial_rutas/${fechaHoy}/${placaGlobal}`).push(punto)); localStorage.removeItem('historialYMS_Offline'); }
    if (placaGlobal !== "") db.ref('camiones_en_patio/' + placaGlobal).remove();
    if(esAutomatico) alert("Has salido de la Terminal TEC. Sesión cerrada."); window.location.reload(); 
}

const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let localStreamOp;
let pcOp;

window.contestarLlamada = async function() {
    try {
        document.getElementById('lblLlamadaTit').innerText = "En Llamada 🎙️";
        document.getElementById('botonesContestar').style.display = 'none';
        document.getElementById('btnColgarOp').style.display = 'block';

        localStreamOp = await navigator.mediaDevices.getUserMedia({ audio: true });
        pcOp = new RTCPeerConnection(rtcConfig);
        localStreamOp.getTracks().forEach(track => pcOp.addTrack(track, localStreamOp));

        pcOp.onicecandidate = event => {
            if (event.candidate) db.ref(`llamadas/${placaGlobal}/calleeCandidates`).push(event.candidate.toJSON());
        };

        pcOp.ontrack = event => { document.getElementById('audioRemotoOperador').srcObject = event.streams[0]; };

        await pcOp.setRemoteDescription(new RTCSessionDescription(window.llamadaOfferGuardada));
        const answer = await pcOp.createAnswer();
        await pcOp.setLocalDescription(answer);

        db.ref(`llamadas/${placaGlobal}`).update({ answer: { type: answer.type, sdp: answer.sdp } });

        db.ref(`llamadas/${placaGlobal}/callerCandidates`).on('child_added', snap => {
            if(snap.val()) pcOp.addIceCandidate(new RTCIceCandidate(snap.val()));
        });

    } catch(e) {
        alert("Debes permitir el micrófono para contestar.");
        rechazarLlamada();
    }
};

window.rechazarLlamada = function(remoto = false) {
    if(!remoto && placaGlobal) db.ref(`llamadas/${placaGlobal}`).remove();
    if(pcOp) { pcOp.close(); pcOp = null; }
    if(localStreamOp) { localStreamOp.getTracks().forEach(t => t.stop()); localStreamOp = null; }
    document.getElementById('modalLlamadaOperador').style.display = 'none';
};
