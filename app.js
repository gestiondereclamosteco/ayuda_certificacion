document.addEventListener('DOMContentLoaded', () => {

    // --- CONEXIÓN A FIREBASE ---
    const db = firebase.firestore();

    // --- CREDENCIALES ---
    const users = { "AYKO": "francoayko", "OPTICAL": "joseoptical", "NEW": "georginanew", "PEBCOM": "sebastianpebcom", "INCO": "sebastianinco", "MATIAS": "pruebas" };

    // --- ESTADO DE LA APLICACIÓN ---
    let currentUser = null;
    let manosDeObra = [], direccionesMapeo = [], registroOTs = [], tareasSeleccionadas = new Map();
    let otActual = '', otEsValida = false;
    let datosParaExportar = [], historialCertificaciones = [], proximoIdCertificacion = 1, indiceEditando = null, otEnModificacion = null;

    // --- REFERENCIAS AL DOM ---
    const loginContainer = document.getElementById('login-container'), appContainer = document.getElementById('app-container'), loginForm = document.getElementById('login-form-element'), usernameInput = document.getElementById('username'), passwordInput = document.getElementById('password'), loginError = document.getElementById('login-error'), currentUserSpan = document.getElementById('current-user-span'), logoutButton = document.getElementById('logout-button'), otInput = document.getElementById('ot-input'), otError = document.getElementById('ot-error'), searchInput = document.getElementById('search-input'), taskListContainer = document.getElementById('task-list-container'), quantitySection = document.getElementById('quantity-section'), quantityInputsContainer = document.getElementById('quantity-inputs-container'), summaryOt = document.getElementById('summary-ot'), summaryList = document.getElementById('summary-list'), addOtButton = document.getElementById('add-ot-button'), registroContainer = document.getElementById('registro-container'), exportButton = document.getElementById('generate-report-button'), reportModal = document.getElementById('report-modal'), modalCloseButton = document.getElementById('modal-close-button'), reportContent = document.getElementById('report-content'), downloadExcelButton = document.getElementById('download-excel-button'), historyListContainer = document.getElementById('history-list-container'), notificationContainer = document.getElementById('notification-container'), confirmModal = document.getElementById('confirm-modal'), confirmMessage = document.getElementById('confirm-message'), confirmOkBtn = document.getElementById('confirm-ok-btn'), confirmCancelBtn = document.getElementById('confirm-cancel-btn');

    // --- SISTEMA DE NOTIFICACIONES ---
    const showNotification = (message, type = 'success', duration = 3000) => {
        const notif = document.createElement('div');
        notif.className = `notification ${type}`;
        notif.textContent = message;
        notificationContainer.appendChild(notif);
        setTimeout(() => { notif.classList.add('fade-out'); setTimeout(() => { notif.remove(); }, 500); }, duration - 500);
    };
    const showConfirmation = (message) => {
        return new Promise((resolve) => {
            confirmMessage.textContent = message;
            confirmModal.classList.remove('hidden');
            const handleOk = () => { confirmModal.classList.add('hidden'); resolve(true); cleanUp(); };
            const handleCancel = () => { confirmModal.classList.add('hidden'); resolve(false); cleanUp(); };
            const cleanUp = () => { confirmOkBtn.removeEventListener('click', handleOk); confirmCancelBtn.removeEventListener('click', handleCancel); };
            confirmOkBtn.addEventListener('click', handleOk);
            confirmCancelBtn.addEventListener('click', handleCancel);
        });
    };
    
    // --- LÓGICA DE DATOS CON FIRESTORE ---
    const cargarManosDeObra = async () => {
        try {
            const response = await fetch(`cmo.xlsx?v=${new Date().getTime()}`);
            if (!response.ok) throw new Error("No se pudo encontrar 'cmo.xlsx'.");
            const arrayBuffer = await response.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            manosDeObra = json.map(row => ({ codigo: String(row[0] || '').trim(), descripcion: String(row[1] || '').trim() })).filter(t => t.codigo && t.descripcion && t.codigo.toLowerCase() !== 'codigo');
        } catch (error) { showNotification(`Error al cargar las tareas: ${error.message}`, 'error'); }
    };
    const cargarDirecciones = async () => {
        try {
            const response = await fetch(`direcciones_mapeo.xlsx?v=${new Date().getTime()}`);
            if (!response.ok) throw new Error("No se pudo encontrar 'direcciones_mapeo.xlsx'.");
            const arrayBuffer = await response.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            direccionesMapeo = XLSX.utils.sheet_to_json(worksheet);
        } catch (error) { showNotification(`Error al cargar las direcciones: ${error.message}`, 'error'); }
    };
    const cargarRegistroDesdeFirestore = async () => {
        if (!currentUser) return;
        try {
            const snapshot = await db.collection('proveedores').doc(currentUser).collection('registro').get();
            const otsDesdeDB = [];
            snapshot.forEach(doc => otsDesdeDB.push(doc.data()));
            registroOTs = otsDesdeDB.sort((a, b) => a.ot.localeCompare(b.ot));
        } catch (error) { console.error("Error al cargar registro:", error); showNotification("Error al cargar el registro del proveedor.", "error"); }
    };
    const cargarHistorialDesdeFirestore = async () => {
        if (!currentUser) return;
        try {
            const snapshot = await db.collection('proveedores').doc(currentUser).collection('historial').orderBy('timestamp', 'desc').get();
            const historialDB = [];
            snapshot.forEach(doc => historialDB.push({ firestoreId: doc.id, ...doc.data() }));
            historialCertificaciones = historialDB;
            proximoIdCertificacion = historialCertificaciones.length > 0 ? Math.max(...historialCertificaciones.map(h => h.id || 0)) + 1 : 1;
        } catch (error) { console.error("Error al cargar historial:", error); showNotification("Error al cargar el historial del proveedor.", "error"); }
    };

    // --- LÓGICA DE RENDERIZADO Y UI ---
    const renderTaskList = (filter = '') => {
        taskListContainer.innerHTML = '';
        if (manosDeObra.length === 0) { taskListContainer.innerHTML = '<p>No se encontraron tareas.</p>'; return; }
        manosDeObra.filter(t => t.descripcion.toLowerCase().includes(filter.toLowerCase()) || t.codigo.includes(filter)).forEach(tarea => {
            const isChecked = tareasSeleccionadas.has(tarea.codigo);
            const taskItem = document.createElement('div');
            taskItem.className = 'task-item';
            taskItem.dataset.codigo = tarea.codigo;
            taskItem.innerHTML = `<input type="checkbox" ${isChecked ? 'checked' : ''}><span class="code">${tarea.codigo}</span><span class="description">${tarea.descripcion}</span>`;
            taskListContainer.appendChild(taskItem);
        });
    };
    const renderQuantityInputs = () => {
        quantityInputsContainer.innerHTML = '';
        if (tareasSeleccionadas.size === 0) { quantitySection.classList.add('hidden'); return; }
        quantitySection.classList.remove('hidden');
        tareasSeleccionadas.forEach((value, codigo) => {
            const tarea = manosDeObra.find(t => t.codigo === codigo);
            const quantityItem = document.createElement('div');
            quantityItem.className = 'quantity-item';
            quantityItem.innerHTML = `<span class="quantity-item-label">${tarea.codigo} - ${tarea.descripcion}</span><input type="number" min="1" value="${value.cantidad}" data-codigo="${codigo}" class="quantity-input">`;
            quantityInputsContainer.appendChild(quantityItem);
        });
    };
    const updateSummary = () => {
        summaryOt.textContent = `OT: ${otActual || '-'}`;
        summaryList.innerHTML = '';
        let totalItems = 0;
        tareasSeleccionadas.forEach((value, codigo) => {
            if (value.cantidad > 0) {
                const tarea = manosDeObra.find(t => t.codigo === codigo);
                const listItem = document.createElement('li');
                listItem.textContent = `(${value.cantidad}) ${tarea.codigo} - ${tarea.descripcion}`;
                summaryList.appendChild(listItem);
                totalItems++;
            }
        });
        addOtButton.disabled = !(otEsValida && totalItems > 0);
    };
    const renderRegistro = () => {
        registroContainer.innerHTML = '';
        if (registroOTs.length === 0) {
            registroContainer.innerHTML = '<p>No hay OTs en el registro actual.</p>';
            return;
        }
        registroOTs.forEach(registro => {
            const entryDiv = document.createElement('div');
            entryDiv.className = 'registro-entry';
            const metadataHtml = `<div class="ot-metadata"><span><strong>Dirección:</strong> ${registro.direccion}</span><span><strong>Zona:</strong> ${registro.zona}</span></div>`;
            let tasksHtml = '<ul class="task-list-log">';
            registro.tareas.forEach(tarea => {
                const tareaInfo = manosDeObra.find(t => t.codigo === tarea.codigo);
                tasksHtml += `<li>${tareaInfo ? tareaInfo.descripcion : 'Tarea no encontrada'} - ${tarea.cantidad}</li>`;
            });
            tasksHtml += '</ul>';
            const actionsHtml = `<div class="entry-actions"><button class="action-btn modify-btn" data-ot="${registro.ot}">Modificar</button><button class="action-btn delete-btn" data-ot="${registro.ot}">Eliminar</button></div>`;
            entryDiv.innerHTML = `<div class="ot-header">OT: ${registro.ot}</div>${metadataHtml}${tasksHtml}${actionsHtml}`;
            registroContainer.appendChild(entryDiv);
        });
    };
    const renderHistorial = () => {
        historyListContainer.innerHTML = '';
        if (historialCertificaciones.length === 0) {
            historyListContainer.innerHTML = '<p>No hay certificaciones archivadas.</p>';
            return;
        }
        historialCertificaciones.forEach((archivo, index) => {
            const fecha = new Date(archivo.timestamp).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short'});
            const itemCount = archivo.datos.length;
            const historyItem = document.createElement('div');
            historyItem.className = 'history-item';
            let actionButtonsHTML;
            if (index === indiceEditando) {
                historyItem.classList.add('editing');
                actionButtonsHTML = `<button class="save-btn" data-index="${index}">Guardar Cambios</button>`;
            } else {
                actionButtonsHTML = `<button class="view-btn" data-index="${index}">Ver</button><button class="delete-btn" data-index="${index}">Eliminar</button>`;
            }
            historyItem.innerHTML = `
                <div class="history-item-info">
                    <span>Certificación N° ${archivo.id} - ${fecha} hs.</span>
                    <span class="item-count">(${itemCount} OTs)</span>
                </div>
                <div>${actionButtonsHTML}</div>
            `;
            historyListContainer.appendChild(historyItem);
        });
    };
    const updateAllPanels = () => { renderTaskList(searchInput.value); renderQuantityInputs(); updateSummary(); renderRegistro(); renderHistorial(); };
    const resetUI = () => {
        otInput.value = '';
        searchInput.value = '';
        tareasSeleccionadas.clear();
        otActual = '';
        otEsValida = false;
        otEnModificacion = null;
        updateSummary();
        renderQuantityInputs();
    };

    // --- LÓGICA DE INFORME Y EXPORTACIÓN ---
    const generarInforme = () => {
        if (registroOTs.length === 0) { showNotification("No hay datos para generar un informe.", 'error'); return; }
        reportContent.innerHTML = '';
        datosParaExportar = [];
        const proyectoCodes = ['5040793', '5040794'];
        const clasificacion = { proyectoNorte: [], proyectoSur: [], mantenimientoNorte: [], mantenimientoSur: [] };

        // Determinar el email para el campo CC según el proveedor logueado
        const grupoPcalogero = ['AYKO', 'INCO', 'OPTICAL POWER', 'OPTICAL'];
        const grupoPnissero = ['NEW', 'PEBCOM'];
        let ccEmail = '';
        if (grupoPcalogero.includes(currentUser.toUpperCase())) {
            ccEmail = 'pcalogero@teco.com.ar';
        } else if (grupoPnissero.includes(currentUser.toUpperCase())) {
            ccEmail = 'pnissero@teco.com.ar';
        }

        registroOTs.forEach(registro => {
            registro.tareas.forEach(tarea => {
                const esProyecto = proyectoCodes.includes(tarea.codigo);
                const esNorte = registro.zona === 'Capital Norte';
                const tareaCompleta = { ...registro, ...tarea };
                if (esProyecto && esNorte) clasificacion.proyectoNorte.push(tareaCompleta);
                else if (esProyecto && !esNorte) clasificacion.proyectoSur.push(tareaCompleta);
                else if (!esProyecto && esNorte) clasificacion.mantenimientoNorte.push(tareaCompleta);
                else clasificacion.mantenimientoSur.push(tareaCompleta);
            });
        });

        const procesarCategoria = (titulo, tareas, nombreHoja) => {
            if (tareas.length === 0) return;

            // --- INICIO: Lógica para la cabecera informativa ---
            const infoHeader = [];
            let destinatario = '', imputacion = '';
            const ccList = [];

            if (nombreHoja === 'Proyecto Norte') {
                destinatario = 'Destinatario: Planificacion_AdministracionyCertificacionesOBRASAMBA@teco.com.ar';
                if (ccEmail) ccList.push(ccEmail);
                ccList.push('hlmartos@teco.com.ar');
                imputacion = 'Imputación: OC - 600100000641';
            } else if (nombreHoja === 'Proyecto Sur') {
                destinatario = 'Destinatario: Planificacion_AdministracionyCertificacionesOBRASAMBA@teco.com.ar';
                if (ccEmail) ccList.push(ccEmail);
                ccList.push('hlmartos@teco.com.ar');
                imputacion = 'Imputación: OC - 600100000642';
            } else if (nombreHoja === 'Mantenimiento Norte') {
                destinatario = 'Destinatario: AdministracionRedCAPITALNORTE@teco.com.ar';
                ccList.push('hlmartos@teco.com.ar');
                if (ccEmail) ccList.push(ccEmail);
                imputacion = 'Imputación: Mantenimiento Capi Norte';
            } else if (nombreHoja === 'Mantenimiento Sur') {
                destinatario = 'Destinatario: AdministracionRedCAPITALSUR@teco.com.ar';
                ccList.push('hlmartos@teco.com.ar');
                if (ccEmail) ccList.push(ccEmail);
                imputacion = 'Imputación: Mantenimiento Capi Sur';
            }

            infoHeader.push([destinatario]);
            if (ccList.length > 0) infoHeader.push([`CC: ${ccList.join(', ')}`]);
            infoHeader.push([imputacion]);
            infoHeader.push([]); // Fila en blanco para espaciar
            // --- FIN: Lógica para la cabecera informativa ---

            const otsUnicas = [...new Map(tareas.map(t => [t.ot, t])).values()].sort((a,b) => a.ot.localeCompare(b.ot));
            const tareasUnicas = [...new Map(tareas.map(t => [t.codigo, t])).values()].sort((a,b) => a.codigo.localeCompare(b.codigo));
            const mapaCantidades = new Map(tareas.map(t => [`${t.ot}-${t.codigo}`, t.cantidad]));
            
            const cabecera = ['Tarea (Código - Descripción)', ...otsUnicas.map(ot => `${ot.ot} - ${ot.direccion}`)];
            const filas = tareasUnicas.map(tareaInfo => {
                const descripcion = (manosDeObra.find(mo => mo.codigo === tareaInfo.codigo) || {}).descripcion || "N/A";
                const fila = [`${tareaInfo.codigo} - ${descripcion}`];
                otsUnicas.forEach(ot => {
                    const cantidad = mapaCantidades.get(`${ot.ot}-${tareaInfo.codigo}`) || '';
                    fila.push(cantidad);
                });
                return fila;
            });

            const datosParaHoja = [...infoHeader, ...[cabecera, ...filas]];
            datosParaExportar.push({ nombreHoja, datos: datosParaHoja });

            let infoHeaderHTML = infoHeader.map(row => `<p style="margin: 2px 0; font-size: 0.9em;"><strong>${row[0] || ''}</strong></p>`).join('');
            let tablaHTML = `<div class="report-section"><h3>${titulo}</h3>${infoHeaderHTML}<div class="preview-table-container"><table class="preview-table"><thead><tr>`;
            cabecera.forEach(h => tablaHTML += `<th>${h}</th>`);
            tablaHTML += `</tr></thead><tbody>`;
            filas.forEach(fila => {
                tablaHTML += `<tr>`;
                fila.forEach(celda => tablaHTML += `<td>${celda}</td>`);
                tablaHTML += `</tr>`;
            });
            tablaHTML += `</tbody></table></div></div>`;
            reportContent.innerHTML += tablaHTML;
        };

        procesarCategoria('Proyecto OC NORTE', clasificacion.proyectoNorte, 'Proyecto Norte');
        procesarCategoria('Proyecto OC SUR', clasificacion.proyectoSur, 'Proyecto Sur');
        procesarCategoria('Mantenimiento Capi Norte', clasificacion.mantenimientoNorte, 'Mantenimiento Norte');
        procesarCategoria('Mantenimiento Capi Sur', clasificacion.mantenimientoSur, 'Mantenimiento Sur');
        
        if(reportContent.innerHTML === '') {
            reportContent.innerHTML = '<p>No se encontraron datos para clasificar.</p>';
            downloadExcelButton.style.display = 'none';
        } else {
            downloadExcelButton.style.display = 'block';
        }
        reportModal.classList.remove('hidden');
    };
    const descargarExcel = async () => {
        if (datosParaExportar.length === 0 || !currentUser) { showNotification("No hay datos para descargar.", 'error'); return; }
        
        const wb = XLSX.utils.book_new();
        datosParaExportar.forEach(hoja => {
            const ws = XLSX.utils.aoa_to_sheet(hoja.datos);
            const anchos = hoja.datos[0].map(h => ({wch: String(h).length + 5}));
            anchos[0].wch = 50;
            ws['!cols'] = anchos;
            XLSX.utils.book_append_sheet(wb, ws, hoja.nombreHoja);
        });
        const fecha = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `Certificacion_Agrupada_${fecha}.xlsx`);
        
        try {
            if (indiceEditando !== null) {
                const docId = historialCertificaciones[indiceEditando].firestoreId;
                await db.collection('proveedores').doc(currentUser).collection('historial').doc(docId).update({
                    datos: JSON.parse(JSON.stringify(registroOTs)),
                    timestamp: new Date().toISOString()
                });
                showNotification(`Certificación N° ${historialCertificaciones[indiceEditando].id} actualizada.`, 'success');
            } else {
                const nuevoArchivo = { id: proximoIdCertificacion, timestamp: new Date().toISOString(), datos: registroOTs };
                await db.collection('proveedores').doc(currentUser).collection('historial').add(nuevoArchivo);
                proximoIdCertificacion++;
                showNotification(`Certificación N° ${nuevoArchivo.id} archivada.`, 'success');
            }
            
            const otsParaBorrar = await db.collection('proveedores').doc(currentUser).collection('registro').get();
            const batch = db.batch();
            otsParaBorrar.forEach(doc => batch.delete(doc.ref));
            await batch.commit();

            registroOTs = [];
            indiceEditando = null;
            resetUI();
            await cargarHistorialDesdeFirestore();
            updateAllPanels();
            reportModal.classList.add('hidden');
        } catch(error) {
            console.error("Error durante el archivado:", error);
            showNotification("Error durante el archivado.", "error");
        }
    };

    // --- EVENT LISTENERS ---
    otInput.addEventListener('input', () => {
        otInput.value = otInput.value.replace(/\D/g, '');
        otActual = otInput.value;
        if (otActual !== otEnModificacion) { otEnModificacion = null; }
        const esDuplicada = registroOTs.some(r => r.ot === otActual && r.ot !== otEnModificacion);
        if (otActual.length === 9) {
            if (esDuplicada) { otError.textContent = '⛔ Esta OT ya ha sido registrada.'; otEsValida = false; }
            else { otError.textContent = ''; otEsValida = true; }
        } else { otError.textContent = 'Debe contener exactamente 9 dígitos.'; otEsValida = false; }
        updateSummary();
    });
    addOtButton.addEventListener('click', async () => {
        if (addOtButton.disabled || !currentUser) return;
        const infoDireccion = direccionesMapeo.find(item => String(item.OT) === otActual);
        const tareasParaGuardar = [];
        tareasSeleccionadas.forEach((value, codigo) => { if (value.cantidad > 0) tareasParaGuardar.push({ codigo, cantidad: value.cantidad }); });
        if (tareasParaGuardar.length > 0) {
            const nuevaDataOT = { ot: otActual, direccion: infoDireccion?.Direccion || 'No encontrada', zona: infoDireccion?.Zona || 'No encontrada', tareas: tareasParaGuardar };
            try {
                await db.collection('proveedores').doc(currentUser).collection('registro').doc(otActual).set(nuevaDataOT);
                await cargarRegistroDesdeFirestore();
                resetUI();
                updateAllPanels();
                showNotification(`OT ${otActual} guardada.`, 'success');
            } catch (error) {
                console.error("Error al guardar en Firestore: ", error);
                showNotification("Error al guardar en la nube.", "error");
            }
        }
    });
    registroContainer.addEventListener('click', async (e) => {
        const target = e.target;
        const otId = target.dataset.ot;
        if (!otId || !currentUser) return;
        if (target.classList.contains('delete-btn')) {
            const confirmed = await showConfirmation(`¿Estás seguro de que deseas eliminar la OT ${otId}?`);
            if (confirmed) {
                try {
                    await db.collection('proveedores').doc(currentUser).collection('registro').doc(otId).delete();
                    await cargarRegistroDesdeFirestore();
                    updateAllPanels();
                    showNotification(`OT ${otId} eliminada.`, 'success');
                } catch (error) {
                    console.error("Error al eliminar de Firestore: ", error);
                    showNotification("Error al eliminar de la nube.", "error");
                }
            }
        }
        if (target.classList.contains('modify-btn')) {
            const otToModify = registroOTs.find(reg => reg.ot === otId);
            if (otToModify) {
                otEnModificacion = otToModify.ot;
                otInput.value = otToModify.ot;
                otInput.dispatchEvent(new Event('input'));
                tareasSeleccionadas.clear();
                otToModify.tareas.forEach(t => tareasSeleccionadas.set(t.codigo, {cantidad: t.cantidad}));
                renderQuantityInputs();
                updateSummary();
                window.scrollTo(0, 0);
                otInput.focus();
            }
        }
    });
    searchInput.addEventListener('input', () => renderTaskList(searchInput.value));
    taskListContainer.addEventListener('click', e => {
        const taskItem = e.target.closest('.task-item');
        if (!taskItem) return;
        const codigo = taskItem.dataset.codigo;
        const checkbox = taskItem.querySelector('input[type="checkbox"]');
        if (e.target !== checkbox) checkbox.checked = !checkbox.checked;
        if (checkbox.checked) { tareasSeleccionadas.set(codigo, { cantidad: 1 }); }
        else { tareasSeleccionadas.delete(codigo); }
        renderQuantityInputs();
        updateSummary();
    });
    quantityInputsContainer.addEventListener('input', e => {
        if (e.target.classList.contains('quantity-input')) {
            const codigo = e.target.dataset.codigo;
            const cantidad = parseInt(e.target.value, 10) || 0;
            if (tareasSeleccionadas.has(codigo)) { tareasSeleccionadas.get(codigo).cantidad = cantidad; }
            updateSummary();
        }
    });
    if (exportButton) { exportButton.addEventListener('click', generarInforme); }
    if (downloadExcelButton) { downloadExcelButton.addEventListener('click', descargarExcel); }
    modalCloseButton.addEventListener('click', () => reportModal.classList.add('hidden'));
    reportModal.addEventListener('click', (e) => { if (e.target === reportModal) reportModal.classList.add('hidden'); });
    historyListContainer.addEventListener('click', async (e) => {
        const target = e.target;
        const index = parseInt(target.dataset.index, 10);
        if (isNaN(index) || !currentUser) return;
        if (target.classList.contains('view-btn')) {
            if (historialCertificaciones[index]) {
                const confirmed = await showConfirmation('Se reemplazará el registro actual en la nube con este historial. ¿Deseas continuar?');
                if (confirmed) {
                    indiceEditando = index;
                    const datosHistorial = JSON.parse(JSON.stringify(historialCertificaciones[index].datos));
                    try {
                        const otsParaBorrar = await db.collection('proveedores').doc(currentUser).collection('registro').get();
                        const batch = db.batch();
                        otsParaBorrar.forEach(doc => batch.delete(doc.ref));
                        datosHistorial.forEach(ot => {
                            const docRef = db.collection('proveedores').doc(currentUser).collection('registro').doc(ot.ot);
                            batch.set(docRef, ot);
                        });
                        await batch.commit();
                        await cargarRegistroDesdeFirestore();
                        updateAllPanels();
                    } catch (error) {
                        console.error("Error al cargar historial a Firestore:", error);
                        showNotification("Error al cargar historial a la nube.", "error");
                    }
                }
            }
        }
        // ... dentro del listener de historyListContainer.addEventListener('click', ...)
        if (target.classList.contains('save-btn')) {
            if (historialCertificaciones[index]) {
                const docId = historialCertificaciones[index].firestoreId;
                const idCertificacion = historialCertificaciones[index].id;
                try {
                    // 1. Guardar los cambios en el documento del historial
                    await db.collection('proveedores').doc(currentUser).collection('historial').doc(docId).update({
                        datos: JSON.parse(JSON.stringify(registroOTs)),
                        timestamp: new Date().toISOString()
                    });

                    // 2. Limpiar el registro de trabajo actual en la nube
                    const otsParaBorrar = await db.collection('proveedores').doc(currentUser).collection('registro').get();
                    const batch = db.batch();
                    otsParaBorrar.forEach(doc => batch.delete(doc.ref));
                    await batch.commit();

                    // 3. Resetear el estado local y la UI
                    registroOTs = [];
                    indiceEditando = null;
                    resetUI();
                    
                    // 4. Actualizar las vistas para reflejar los cambios
                    await cargarHistorialDesdeFirestore(); // Quita el modo edición del historial
                    updateAllPanels(); // Refresca todos los paneles (el registro aparecerá vacío)
                    
                    showNotification(`Certificación N° ${idCertificacion} guardada.`, 'success');

                } catch(error) {
                    console.error("Error al guardar cambios en historial:", error);
                    showNotification("Error al guardar cambios en la nube.", "error");
                }
            }
        }
        if (target.classList.contains('delete-btn')) {
            if (historialCertificaciones[index]) {
                const idCertificacion = historialCertificaciones[index].id;
                const confirmed = await showConfirmation(`¿Eliminar la Certificación N° ${idCertificacion} permanentemente?`);
                if (confirmed) {
                    const docId = historialCertificaciones[index].firestoreId;
                    try {
                        await db.collection('proveedores').doc(currentUser).collection('historial').doc(docId).delete();
                        await cargarHistorialDesdeFirestore();
                        renderHistorial();
                        showNotification(`Certificación N° ${idCertificacion} eliminada.`, 'success');
                    } catch (error) {
                        console.error("Error al eliminar la certificación:", error);
                        showNotification("Error al eliminar la certificación de la nube.", "error");
                    }
                }
            }
        }
    });

    // --- LÓGICA DE LOGIN Y INICIO ---
    const handleLogin = (e) => {
        e.preventDefault();
        const username = usernameInput.value.toUpperCase().trim();
        const password = passwordInput.value;
        loginError.textContent = '';

        if (users[username] && users[username].toLowerCase() === password.toLowerCase()) {
            currentUser = username;
            loginContainer.style.display = 'none'; // Reemplaza la línea original
            appContainer.style.display = 'block'; // Reemplaza la línea original
            
            setTimeout(() => {
                initializeAppData();
            }, 0);
        } else {
            loginError.textContent = 'Usuario o contraseña incorrectos.';
        }
    };
    const handleLogout = () => {
        location.reload();
    };
    const initializeAppData = async () => {
        currentUserSpan.textContent = `Usuario: ${currentUser}`;
        showNotification(`Bienvenido, ${currentUser}!`, 'success');
        await Promise.all([cargarManosDeObra(), cargarDirecciones()]);
        await cargarRegistroDesdeFirestore();
        await cargarHistorialDesdeFirestore();
        updateAllPanels();
    };
    
    loginForm.addEventListener('submit', handleLogin);
    logoutButton.addEventListener('click', handleLogout);

});