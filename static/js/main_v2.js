// Configuración de auto-guardado y notificaciones de texto
const SAVE_NOTIFICATION_DURATION_MS = 2000; // Duración del mensaje 'Cambios guardados.' (en ms)
const AUTO_SAVE_DEBOUNCE_MS = 800; // Tiempo de inactividad tras dejar de escribir antes de guardar (en ms)

// Configuración de ajuste fino de límites y vinculación contigua (Snap)
const CONTIGUOUS_BOUNDARY_THRESHOLD_MS = 60; // Umbral en ms para considerar segmentos adyacentes como contiguos (configurable)
const CONTIGUOUS_BOUNDARY_THRESHOLD_SEC = CONTIGUOUS_BOUNDARY_THRESHOLD_MS / 1000;

let saveNotificationTimeout = null;

function showSaveNotification(message = 'Cambios guardados.') {
    let notif = document.getElementById('v2-save-notification');
    if (!notif) {
        notif = document.createElement('div');
        notif.id = 'v2-save-notification';
        document.body.appendChild(notif);
    }

    notif.innerHTML = `<span style="font-size: 14px;">✓</span> <span>${message}</span>`;
    notif.classList.add('show');

    if (saveNotificationTimeout) {
        clearTimeout(saveNotificationTimeout);
    }

    saveNotificationTimeout = setTimeout(() => {
        notif.classList.remove('show');
    }, SAVE_NOTIFICATION_DURATION_MS);
}

async function autoSaveSegmentText(segmentId, newText, segObj) {
    try {
        const resp = await fetch('/api/v2/segment/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                segment_id: segmentId,
                text_content: newText
            })
        });

        const res = await resp.json();
        if (res.success) {
            if (segObj) {
                segObj.text_content = newText;
                segObj.text = newText;
            }
            showSaveNotification('Cambios guardados.');
            return true;
        } else {
            console.error('Error auto-saving segment text:', res.error);
        }
    } catch (err) {
        console.error('Error auto-saving segment text:', err);
    }
    return false;
}

function autoResizeTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.max(48, textarea.scrollHeight + 2) + 'px';
}

let projectV2Data = v2InitialData || { channels: [], matches: [] };
let selectedSegmentIds = new Set();
let waveSurferInstances = {};

document.addEventListener('DOMContentLoaded', () => {
    initV2Editor();
    setupV2EventListeners();
});

function initV2Editor() {
    renderChannels();
    renderMatches();
}

function openEditChannelModal(ch) {
    const modal = document.getElementById('edit-channel-modal');
    if (!modal) return;
    document.getElementById('edit-channel-id').value = ch.id;
    document.getElementById('edit-channel-name').value = ch.name || '';
    const typeVal = (ch.type === 'audio') ? 'audio' : 'text';
    document.getElementById('edit-channel-type').value = typeVal;
    modal.style.display = 'flex';
}

function openAddMediaModal(ch) {
    if (ch.type === 'audio') {
        const modal = document.getElementById('add-media-modal');
        if (!modal) return;
        document.getElementById('add-media-channel-id').value = ch.id;
        document.getElementById('add-media-channel-info').innerHTML = `Agregando nuevo contenido al canal <strong>${escapeHtml(ch.name)}</strong> (${ch.type}).`;
        document.getElementById('media-file').value = '';
        modal.style.display = 'flex';
    } else {
        openAddTextMediaModal(ch);
    }
}

let currentTextChannelId = null;

function openAddTextMediaModal(ch) {
    currentTextChannelId = ch.id;
    const modal = document.getElementById('add-text-media-modal');
    if (!modal) return;
    document.getElementById('add-text-media-channel-id').value = ch.id;
    document.getElementById('add-text-media-selected-type').value = '';
    document.getElementById('text-media-file').value = '';
    
    document.getElementById('add-text-media-step-1').style.display = 'flex';
    document.getElementById('add-text-media-step-2').style.display = 'none';
    document.getElementById('csv-preview-container').style.display = 'none';
    
    modal.style.display = 'flex';
}

function calculateMediaSlotStatus(med, projectData) {
    const segments = med.segments || [];
    if (segments.length === 0) {
        return {
            status: 'raw',
            label: 'RAW',
            badgeClass: 'raw',
            cssClass: 'slot-raw'
        };
    }

    const matches = (projectData && projectData.matches) ? projectData.matches : [];
    const channels = (projectData && projectData.channels) ? projectData.channels : [];
    const totalChannelsCount = channels.length;

    let matchedSegmentsCount = 0;
    let fullyMatchedSegmentsCount = 0;

    segments.forEach(seg => {
        const matchingGroups = matches.filter(m => 
            m.items && m.items.some(item => String(item.segment_id) === String(seg.id))
        );

        if (matchingGroups.length > 0) {
            matchedSegmentsCount++;

            let maxUniqueChannelsInGroup = 0;
            matchingGroups.forEach(m => {
                const uniqueChs = new Set((m.items || []).map(it => String(it.channel_id))).size;
                if (uniqueChs > maxUniqueChannelsInGroup) {
                    maxUniqueChannelsInGroup = uniqueChs;
                }
            });

            if (maxUniqueChannelsInGroup >= totalChannelsCount && totalChannelsCount > 1) {
                fullyMatchedSegmentsCount++;
            }
        }
    });

    if (matchedSegmentsCount === 0) {
        return {
            status: 'segmented',
            label: 'SEGMENTADO',
            badgeClass: 'segmented',
            cssClass: 'slot-segmented'
        };
    } else if (matchedSegmentsCount === segments.length && fullyMatchedSegmentsCount === segments.length) {
        return {
            status: 'aligned',
            label: 'ALINEADO',
            badgeClass: 'aligned',
            cssClass: 'slot-aligned'
        };
    } else {
        return {
            status: 'partial',
            label: 'PARCIAL',
            badgeClass: 'partial',
            cssClass: 'slot-partial'
        };
    }
}

function renderChannels() {
    const container = document.getElementById('v2-channels-container');
    if (!container) return;
    container.innerHTML = '';
    container.className = 'daw-channels-container';

    if (!projectV2Data.channels || projectV2Data.channels.length === 0) {
        container.innerHTML = `
            <div class="ft-card" style="width: 100%; text-align: center; padding: 40px; background: white;">
                <h3 style="margin-top: 0; font-family: var(--font-serif);">📭 No hay canales definidos</h3>
                <p style="color: var(--ft-ink-muted);">Haz clic en "+ Añadir Canal" arriba para agregar tu primer canal.</p>
            </div>
        `;
        return;
    }

    projectV2Data.channels.forEach((ch, chIdx) => {
        const col = document.createElement('div');
        col.className = 'daw-channel-column';

        // Header: Type badge -> Editable Name link -> + Add Media button
        const header = document.createElement('div');
        header.className = 'daw-channel-header';
        
        // 1. Top: Channel Type badge
        const badgeSpan = document.createElement('span');
        badgeSpan.className = 'daw-channel-type-badge ft-badge';
        if (ch.type === 'audio') badgeSpan.classList.add('claret');
        else if (ch.type === 'translation') badgeSpan.classList.add('translation');
        else badgeSpan.classList.add('teal');
        badgeSpan.innerText = ch.type || 'canal';
        header.appendChild(badgeSpan);

        // 2. Channel Name link (opens edit channel modal)
        const nameLink = document.createElement('a');
        nameLink.className = 'daw-channel-name-link';
        nameLink.href = '#';
        nameLink.title = 'Haz clic para editar canal';
        nameLink.innerHTML = `<span>${escapeHtml(ch.name)}</span> <span style="font-size: 13px; opacity: 0.6;">✏️</span>`;
        nameLink.addEventListener('click', (e) => {
            e.preventDefault();
            openEditChannelModal(ch);
        });
        header.appendChild(nameLink);

        // 3. Button "+ Add Media"
        const addMediaBtn = document.createElement('button');
        addMediaBtn.className = 'ft-button secondary daw-channel-add-media-btn';
        addMediaBtn.innerText = '➕ Add Media';
        addMediaBtn.addEventListener('click', () => {
            openAddMediaModal(ch);
        });
        header.appendChild(addMediaBtn);

        col.appendChild(header);

        // 4. Slots container / Media items
        const slotsDiv = document.createElement('div');
        slotsDiv.className = 'daw-slots-container';

        const mediaList = ch.media || [];
        if (mediaList.length === 0) {
            const emptySlot = document.createElement('div');
            emptySlot.className = 'daw-empty-slot-placeholder';
            emptySlot.innerHTML = `📥 Slot Vacío<br><span style="font-size: 11px; opacity: 0.8;">Sin archivos asignados</span>`;
            slotsDiv.appendChild(emptySlot);
        } else {
            mediaList.forEach(med => {
                const slotStatus = calculateMediaSlotStatus(med, projectV2Data);
                const segCount = (med.segments || []).length;

                if (ch.type === 'audio') {
                    const cell = document.createElement('div');
                    cell.className = `daw-slot-cell ${slotStatus.cssClass}`;
                    cell.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                            <span class="slot-status-badge ${slotStatus.badgeClass}">${slotStatus.label}</span>
                            <span class="slot-cell-hint" style="font-size: 10px; font-weight: 700;">${segCount > 0 ? segCount + ' segs' : '0 segs'}</span>
                        </div>
                        <div class="slot-cell-filename" title="${escapeHtml(med.filename)}">🎵 ${escapeHtml(med.filename)}</div>
                    `;
                    cell.addEventListener('click', () => {
                        openAudioPlayerModal(med, ch, slotStatus);
                    });
                    slotsDiv.appendChild(cell);

                } else {
                    const mediaType = (med.media_type || 'text').toLowerCase();
                    const typeLabel = mediaType.toUpperCase();
                    const icon = mediaType === 'csv' ? '📊' : '📄';

                    const cell = document.createElement('div');
                    cell.className = `daw-slot-cell ${slotStatus.cssClass}`;
                    cell.style.marginBottom = '8px';
                    cell.style.cursor = 'pointer';
                    cell.title = 'Haz clic para ver la segmentación';
                    cell.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                            <span class="slot-status-badge ${slotStatus.badgeClass}">${slotStatus.label}</span>
                            <span style="font-size: 10px; font-weight: 700; color: var(--ft-ink-muted); text-transform: uppercase;">${typeLabel} (${segCount})</span>
                        </div>
                        <div class="slot-cell-filename" title="${escapeHtml(med.filename)}" style="font-weight: 700; font-size: 13px; color: var(--ft-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${icon} ${escapeHtml(med.filename)}
                        </div>
                    `;
                    cell.addEventListener('click', () => {
                        openTextSegmentationModal(med, ch, slotStatus);
                    });
                    slotsDiv.appendChild(cell);
                }
            });
        }

        col.appendChild(slotsDiv);
        container.appendChild(col);
    });
}

function initAudioWaveform(containerId, med, ch) {
    if (waveSurferInstances[containerId]) {
        waveSurferInstances[containerId].destroy();
    }

    const audioUrl = `/uploads/${med.filename}`;
    const ws = WaveSurfer.create({
        container: `#${containerId}`,
        waveColor: '#4F4A85',
        progressColor: '#383351',
        url: audioUrl,
        minPxPerSec: 30
    });

    const regions = ws.registerPlugin(WaveSurfer.Regions.create());

    ws.on('decode', () => {
        (med.segments || []).forEach((seg) => {
            if (seg.start_time !== null && seg.start_time !== undefined && seg.end_time !== null && seg.end_time !== undefined) {
                const isSelected = selectedSegmentIds.has(seg.id);
                regions.addRegion({
                    id: `seg-v2-${seg.id}`,
                    start: seg.start_time,
                    end: seg.end_time,
                    color: isSelected ? 'rgba(254, 240, 138, 0.7)' : 'rgba(0, 123, 255, 0.25)',
                    content: createRegionLabel(seg.end_time - seg.start_time, seg.json_segment_id || seg.id)
                });
            }
        });
    });

    regions.on('region-updated', (region) => {
        const segId = parseInt(region.id.replace('seg-v2-', ''));
        const seg = med.segments.find(s => s.id === segId);
        if (seg) {
            seg.start_time = region.start;
            seg.end_time = region.end;
            updateSegmentOnServer(seg.id, { start_time: region.start, end_time: region.end });
        }
    });

    waveSurferInstances[containerId] = ws;
}

function createRegionLabel(duration, segNum) {
    const el = document.createElement('div');
    el.style.cssText = 'background: #1a1a1a; color: white; padding: 2px 6px; font-size: 11px; font-weight: 900; border: 1px solid black;';
    el.innerText = `#${segNum}: ${duration.toFixed(1)}s`;
    return el;
}

function renderMatches() {
    const container = document.getElementById('v2-matches-list');
    if (!container) return;
    container.innerHTML = '';

    if (!projectV2Data.matches || projectV2Data.matches.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 20px; font-weight: 700; color: #64748b;">
                No cross-channel match linkages created yet.
            </div>
        `;
        return;
    }

    projectV2Data.matches.forEach((m, mIdx) => {
        const block = document.createElement('div');
        block.style.cssText = 'background: #f1f5f9; border: 2px solid var(--border-color); padding: 12px 15px; box-shadow: 3px 3px 0px var(--border-color);';

        const header = document.createElement('div');
        header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;';
        header.innerHTML = `
            <span class="block-badge" style="background: var(--accent-tertiary);">Match Group #${mIdx + 1}</span>
            <button class="brutalist-button danger-btn" style="padding: 4px 8px; font-size: 11px;" onclick="deleteMatch(${m.id})">Remove Match</button>
        `;
        block.appendChild(header);

        const itemsDiv = document.createElement('div');
        itemsDiv.style.cssText = 'display: flex; gap: 10px; flex-wrap: wrap;';

        (m.items || []).forEach(item => {
            const itemPill = document.createElement('div');
            itemPill.style.cssText = 'background: white; border: 1.5px solid var(--border-color); padding: 6px 12px; font-size: 12px; font-weight: 700;';
            const textDisplay = item.text_content ? `"${item.text_content}"` : `${(item.start_time||0).toFixed(1)}s - ${(item.end_time||0).toFixed(1)}s`;
            itemPill.innerText = `[${item.channel_name}] SEG #${item.segment_id}: ${textDisplay}`;
            itemsDiv.appendChild(itemPill);
        });

        block.appendChild(itemsDiv);
        container.appendChild(block);
    });
}

function setupV2EventListeners() {
    document.getElementById('v2-add-channel-btn')?.addEventListener('click', () => {
        document.getElementById('add-channel-modal').style.display = 'flex';
    });

    document.getElementById('close-add-channel-btn')?.addEventListener('click', () => {
        document.getElementById('add-channel-modal').style.display = 'none';
    });

    document.getElementById('cancel-add-channel-btn')?.addEventListener('click', () => {
        document.getElementById('add-channel-modal').style.display = 'none';
    });

    document.getElementById('add-channel-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('add-channel-name').value.trim();
        const type = document.getElementById('add-channel-type').value;

        try {
            const response = await fetch(`/api/v2/project/${v2ProjectId}/add_channel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, type })
            });
            const data = await response.json();
            if (data.success) {
                document.getElementById('add-channel-modal').style.display = 'none';
                document.getElementById('add-channel-name').value = '';
                refreshV2Data();
            } else {
                alert('Error al añadir canal: ' + (data.error || ''));
            }
        } catch (err) {
            alert('Error en la solicitud: ' + err.message);
        }
    });

    document.getElementById('v2-export-btn')?.addEventListener('click', async () => {
        window.open(`/api/v2/project/${v2ProjectId}/export`, '_blank');
    });

    document.getElementById('v2-create-match-btn')?.addEventListener('click', async () => {
        if (selectedSegmentIds.size === 0) {
            alert('Please select segment checkboxes across channels to create a match group.');
            return;
        }

        const response = await fetch('/api/v2/match/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project_id: v2ProjectId,
                segment_ids: Array.from(selectedSegmentIds)
            })
        });

        const data = await response.json();
        if (data.success) {
            selectedSegmentIds.clear();
            refreshV2Data();
        }
    });

    document.getElementById('close-edit-channel-btn')?.addEventListener('click', () => {
        document.getElementById('edit-channel-modal').style.display = 'none';
    });

    document.getElementById('cancel-edit-channel-btn')?.addEventListener('click', () => {
        document.getElementById('edit-channel-modal').style.display = 'none';
    });

    document.getElementById('delete-channel-btn')?.addEventListener('click', async () => {
        const channelId = document.getElementById('edit-channel-id').value;
        const channelName = document.getElementById('edit-channel-name').value;
        if (!channelId) return;

        if (!confirm(`¿Estás seguro de que deseas eliminar el canal "${channelName}" y todos sus contenidos? Esta acción no se puede deshacer.`)) {
            return;
        }

        try {
            const response = await fetch(`/api/v2/channel/${channelId}`, {
                method: 'DELETE'
            });
            const data = await response.json();
            if (data.success) {
                document.getElementById('edit-channel-modal').style.display = 'none';
                refreshV2Data();
            } else {
                alert('Error al eliminar el canal: ' + (data.error || ''));
            }
        } catch (err) {
            alert('Error en la solicitud: ' + err.message);
        }
    });

    document.getElementById('edit-channel-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const channelId = document.getElementById('edit-channel-id').value;
        const name = document.getElementById('edit-channel-name').value;
        const type = document.getElementById('edit-channel-type').value;

        const response = await fetch('/api/v2/channel/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel_id: channelId, name, type })
        });
        const data = await response.json();
        if (data.success) {
            document.getElementById('edit-channel-modal').style.display = 'none';
            refreshV2Data();
        } else {
            alert('Error al actualizar el canal: ' + (data.error || ''));
        }
    });

    document.getElementById('close-add-media-btn')?.addEventListener('click', () => {
        document.getElementById('add-media-modal').style.display = 'none';
    });

    document.getElementById('add-media-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const channelId = document.getElementById('add-media-channel-id').value;
        const fileInput = document.getElementById('media-file');
        
        if (!fileInput.files || fileInput.files.length === 0) {
            alert('Por favor selecciona al menos un archivo de media.');
            return;
        }

        const formData = new FormData();
        for (let i = 0; i < fileInput.files.length; i++) {
            formData.append('media_files', fileInput.files[i]);
        }

        try {
            const response = await fetch(`/api/v2/channel/${channelId}/add_media`, {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            if (data.success) {
                document.getElementById('add-media-modal').style.display = 'none';
                refreshV2Data();
            } else {
                alert('Error al agregar media: ' + (data.error || ''));
            }
        } catch (err) {
            alert('Error en la solicitud: ' + err.message);
        }
    });

    // Text Media Modal Handlers
    document.getElementById('select-type-txt')?.addEventListener('click', () => {
        document.getElementById('add-text-media-selected-type').value = 'text';
        const badge = document.getElementById('step-2-type-badge');
        if (badge) {
            badge.innerText = 'TEXTO PLANO (.TXT)';
            badge.className = 'ft-badge claret';
        }
        document.getElementById('text-media-file').setAttribute('accept', '.txt');
        document.getElementById('text-media-file').value = '';
        document.getElementById('csv-preview-container').style.display = 'none';
        document.getElementById('add-text-media-step-1').style.display = 'none';
        document.getElementById('add-text-media-step-2').style.display = 'flex';
    });

    document.getElementById('select-type-csv')?.addEventListener('click', () => {
        document.getElementById('add-text-media-selected-type').value = 'csv';
        const badge = document.getElementById('step-2-type-badge');
        if (badge) {
            badge.innerText = 'DATOS TABULARES (.CSV)';
            badge.className = 'ft-badge teal';
        }
        document.getElementById('text-media-file').setAttribute('accept', '.csv');
        document.getElementById('text-media-file').value = '';
        document.getElementById('csv-preview-container').style.display = 'none';
        document.getElementById('add-text-media-step-1').style.display = 'none';
        document.getElementById('add-text-media-step-2').style.display = 'flex';
    });

    document.getElementById('back-to-step-1-btn')?.addEventListener('click', () => {
        document.getElementById('add-text-media-step-1').style.display = 'flex';
        document.getElementById('add-text-media-step-2').style.display = 'none';
        document.getElementById('csv-preview-container').style.display = 'none';
    });

    document.getElementById('close-add-text-media-btn')?.addEventListener('click', () => {
        document.getElementById('add-text-media-modal').style.display = 'none';
    });

    document.getElementById('cancel-add-text-media-btn')?.addEventListener('click', () => {
        document.getElementById('add-text-media-modal').style.display = 'none';
    });

    document.getElementById('text-media-file')?.addEventListener('change', () => {
        const fileInput = document.getElementById('text-media-file');
        const selectedType = document.getElementById('add-text-media-selected-type').value;
        if (selectedType === 'csv' && fileInput.files && fileInput.files.length > 0) {
            const file = fileInput.files[0];
            document.getElementById('csv-preview-filename').innerText = file.name;
            const reader = new FileReader();
            reader.onload = function(e) {
                currentCSVRawText = e.target.result;
                renderCSVPreviewTable(currentCSVRawText);
            };
            reader.readAsText(file);
        } else {
            currentCSVRawText = '';
            document.getElementById('csv-preview-container').style.display = 'none';
        }
    });

    document.getElementById('csv-delimiter-input')?.addEventListener('input', () => {
        if (currentCSVRawText) {
            renderCSVPreviewTable(currentCSVRawText);
        }
    });

    document.getElementById('add-text-media-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const channelId = document.getElementById('add-text-media-channel-id').value;
        const selectedType = document.getElementById('add-text-media-selected-type').value;
        const fileInput = document.getElementById('text-media-file');

        if (!fileInput.files || fileInput.files.length === 0) {
            alert('Por favor selecciona al menos un archivo.');
            return;
        }

        if (selectedType === 'csv') {
            const columnMappings = {};
            const selects = document.querySelectorAll('.csv-col-channel-select');
            selects.forEach(sel => {
                const colIdx = sel.getAttribute('data-col-index');
                const val = sel.value;
                if (val) {
                    columnMappings[colIdx] = parseInt(val, 10);
                }
            });

            if (Object.keys(columnMappings).length === 0) {
                alert('Por favor asigna al menos una columna a un canal de texto.');
                return;
            }

            const formData = new FormData();
            formData.append('media_files', fileInput.files[0]);
            formData.append('column_mappings', JSON.stringify(columnMappings));
            formData.append('delimiter', document.getElementById('csv-delimiter-input')?.value || ',');

            try {
                const response = await fetch(`/api/v2/project/${v2ProjectId}/import_tabular_media`, {
                    method: 'POST',
                    body: formData
                });
                const data = await response.json();
                if (data.success) {
                    document.getElementById('add-text-media-modal').style.display = 'none';
                    refreshV2Data();
                } else {
                    alert('Error al importar archivo CSV: ' + (data.error || ''));
                }
            } catch (err) {
                alert('Error en la solicitud: ' + err.message);
            }
        } else {
            const formData = new FormData();
            for (let i = 0; i < fileInput.files.length; i++) {
                formData.append('media_files', fileInput.files[i]);
            }
            formData.append('media_type', selectedType);

            try {
                const response = await fetch(`/api/v2/channel/${channelId}/add_media`, {
                    method: 'POST',
                    body: formData
                });
                const data = await response.json();
                if (data.success) {
                    document.getElementById('add-text-media-modal').style.display = 'none';
                    refreshV2Data();
                } else {
                    alert('Error al agregar media de texto: ' + (data.error || ''));
                }
            } catch (err) {
                alert('Error en la solicitud: ' + err.message);
            }
        }
    });

    document.getElementById('close-audio-modal-btn')?.addEventListener('click', () => {
        closeAudioPlayerModal();
    });

    document.getElementById('audio-modal-segment-btn')?.addEventListener('click', () => {
        if (currentAudioModalMedia && currentAudioModalChannel) {
            openSegmentationModal(currentAudioModalMedia, currentAudioModalChannel);
        }
    });

    document.getElementById('close-segmentation-modal-btn')?.addEventListener('click', () => {
        closeSegmentationModal();
    });

    document.getElementById('seg-play-btn')?.addEventListener('click', () => {
        if (segWavesurfer) segWavesurfer.playPause();
    });

    document.getElementById('seg-detect-btn')?.addEventListener('click', () => {
        triggerSilenceDetection();
    });

    document.getElementById('seg-add-region-btn')?.addEventListener('click', () => {
        if (segWavesurfer && segRegionsPlugin) {
            const duration = segWavesurfer.getDuration() || 0;
            const existingRegions = segRegionsPlugin.getRegions() || [];
            
            let start = 0;
            let end = 5;
            const defaultLen = 5.0;

            if (existingRegions.length === 0) {
                start = 0;
                end = duration > 0 ? Math.min(defaultLen, duration) : defaultLen;
            } else {
                const maxEnd = Math.max(...existingRegions.map(r => r.end));
                if (duration <= 0 || maxEnd < duration - 0.05) {
                    start = maxEnd;
                    end = duration > 0 ? Math.min(start + defaultLen, duration) : start + defaultLen;
                } else {
                    // Check for available gaps between existing segments
                    const sorted = [...existingRegions].sort((a, b) => a.start - b.start || a.end - b.end);
                    let foundGap = false;

                    if (sorted[0].start >= 0.2) {
                        start = 0;
                        end = Math.min(start + defaultLen, sorted[0].start);
                        foundGap = true;
                    } else {
                        for (let i = 0; i < sorted.length - 1; i++) {
                            const gapStart = sorted[i].end;
                            const gapEnd = sorted[i + 1].start;
                            if (gapEnd - gapStart >= 0.2) {
                                start = gapStart;
                                end = Math.min(start + defaultLen, gapEnd);
                                foundGap = true;
                                break;
                            }
                        }
                    }

                    if (!foundGap) {
                        alert('No hay espacio disponible en el audio para añadir otra región.');
                        return;
                    }
                }
            }

            const count = existingRegions.length + 1;
            segRegionsPlugin.addRegion({
                start: start,
                end: end,
                content: `Seg #${count}`,
                color: 'rgba(153, 15, 61, 0.25)',
                drag: true,
                resize: true
            });

            // Re-sort and renumber regions
            const allRegions = segRegionsPlugin.getRegions();
            allRegions.sort((a, b) => a.start - b.start);
            allRegions.forEach((r, idx) => {
                if (r.setOptions) {
                    r.setOptions({ content: `Seg #${idx + 1}` });
                }
            });

            updateSegmentationCountBadge(allRegions.length);

            try {
                segWavesurfer.setTime(start);
            } catch (e) {}
        }
    });

    document.getElementById('seg-clear-regions-btn')?.addEventListener('click', () => {
        if (segRegionsPlugin) {
            segRegionsPlugin.clearRegions();
            updateSegmentationCountBadge(0);
        }
    });

    document.getElementById('seg-confirm-save-btn')?.addEventListener('click', () => {
        confirmAndSaveSegmentation();
    });

    document.getElementById('close-text-seg-modal-btn')?.addEventListener('click', () => {
        closeTextSegmentationModal();
    });

    let modalMousedownTarget = null;
    window.addEventListener('mousedown', (e) => {
        modalMousedownTarget = e.target;
    });

    window.addEventListener('click', (e) => {
        const audioModal = document.getElementById('audio-player-modal');
        if (e.target === audioModal && modalMousedownTarget === audioModal) closeAudioPlayerModal();
        const segModal = document.getElementById('segmentation-modal');
        if (e.target === segModal && modalMousedownTarget === segModal) closeSegmentationModal();
        const textModal = document.getElementById('add-text-media-modal');
        if (e.target === textModal && modalMousedownTarget === textModal) textModal.style.display = 'none';
        const textSegModal = document.getElementById('text-segmentation-modal');
        if (e.target === textSegModal && modalMousedownTarget === textSegModal) closeTextSegmentationModal();
        const boundaryModal = document.getElementById('segment-boundary-modal');
        if (e.target === boundaryModal && modalMousedownTarget === boundaryModal) closeSegmentBoundaryModal();
        modalMousedownTarget = null;
    });

    // Boundary Modal Controls
    document.getElementById('close-boundary-modal-btn')?.addEventListener('click', () => {
        closeSegmentBoundaryModal();
    });

    document.getElementById('boundary-cancel-btn')?.addEventListener('click', () => {
        closeSegmentBoundaryModal();
    });

    document.getElementById('boundary-play-btn')?.addEventListener('click', () => {
        if (!boundaryWaveSurfer || !currentBoundaryRegion) return;
        if (isBoundaryRegionPlaying && boundaryWaveSurfer.isPlaying()) {
            boundaryWaveSurfer.pause();
            isBoundaryRegionPlaying = false;
            const playBtn = document.getElementById('boundary-play-btn');
            if (playBtn) playBtn.innerHTML = '▶ Reproducir Segmento';
        } else {
            isBoundaryRegionPlaying = true;
            boundaryWaveSurfer.setTime(currentBoundaryRegion.start);
            boundaryWaveSurfer.play();
            const playBtn = document.getElementById('boundary-play-btn');
            if (playBtn) playBtn.innerHTML = '⏸ Pausar Segmento';
        }
    });

    document.getElementById('boundary-play-all-btn')?.addEventListener('click', () => {
        if (!boundaryWaveSurfer) return;
        isBoundaryRegionPlaying = false;
        boundaryWaveSurfer.playPause();
        const isPlaying = boundaryWaveSurfer.isPlaying();
        const playAllBtn = document.getElementById('boundary-play-all-btn');
        if (playAllBtn) playAllBtn.innerHTML = isPlaying ? '⏸ Pausa' : '⏯ Reproducir Todo';
    });

    document.getElementById('boundary-start-minus')?.addEventListener('click', () => {
        if (!currentBoundaryRegion) return;
        const newStart = Math.max(0, Number((currentBoundaryRegion.start - 0.1).toFixed(3)));
        currentBoundaryRegion.setOptions({ start: newStart });
        updateBoundaryDisplays(newStart, currentBoundaryRegion.end);
        syncContiguousBoundaries();
    });

    document.getElementById('boundary-start-plus')?.addEventListener('click', () => {
        if (!currentBoundaryRegion) return;
        const newStart = Math.min(currentBoundaryRegion.end - 0.05, Number((currentBoundaryRegion.start + 0.1).toFixed(3)));
        currentBoundaryRegion.setOptions({ start: newStart });
        updateBoundaryDisplays(newStart, currentBoundaryRegion.end);
        syncContiguousBoundaries();
    });

    document.getElementById('boundary-end-minus')?.addEventListener('click', () => {
        if (!currentBoundaryRegion) return;
        const newEnd = Math.max(currentBoundaryRegion.start + 0.05, Number((currentBoundaryRegion.end - 0.1).toFixed(3)));
        currentBoundaryRegion.setOptions({ end: newEnd });
        updateBoundaryDisplays(currentBoundaryRegion.start, newEnd);
        syncContiguousBoundaries();
    });

    document.getElementById('boundary-end-plus')?.addEventListener('click', () => {
        if (!currentBoundaryRegion) return;
        const totalDur = boundaryWaveSurfer ? boundaryWaveSurfer.getDuration() : 999999;
        const newEnd = Math.min(totalDur, Number((currentBoundaryRegion.end + 0.1).toFixed(3)));
        currentBoundaryRegion.setOptions({ end: newEnd });
        updateBoundaryDisplays(currentBoundaryRegion.start, newEnd);
        syncContiguousBoundaries();
    });

    document.getElementById('boundary-snap-toggle')?.addEventListener('change', () => {
        syncContiguousBoundaries();
    });

    document.getElementById('boundary-zoom-slider')?.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        const label = document.getElementById('boundary-zoom-value');
        if (label) label.innerText = `${val} px/s`;
        if (boundaryWaveSurfer) {
            boundaryWaveSurfer.zoom(val);
            centerBoundaryWaveformOnSegment(val);
            requestAnimationFrame(() => {
                centerBoundaryWaveformOnSegment(val);
            });
        }
    });

    document.getElementById('boundary-save-btn')?.addEventListener('click', async () => {
        if (!currentBoundarySegment || !currentBoundaryRegion) return;
        const saveBtn = document.getElementById('boundary-save-btn');
        const startSec = Number(currentBoundaryRegion.start.toFixed(3));
        const endSec = Number(currentBoundaryRegion.end.toFixed(3));

        if (endSec <= startSec) {
            alert('El tiempo de fin debe ser mayor al tiempo de inicio.');
            return;
        }

        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '💾 Guardando...';
        }

        try {
            const snapToggle = document.getElementById('boundary-snap-toggle');
            const isSnapEnabled = snapToggle ? snapToggle.checked : true;

            const savePromises = [
                fetch('/api/v2/segment/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        segment_id: currentBoundarySegment.id,
                        start_time: startSec,
                        end_time: endSec
                    })
                })
            ];

            let savingPrev = false;
            if (isSnapEnabled && isBoundaryPrevContiguous && currentBoundaryPrevSeg && modifiedPrevEnd !== null && modifiedPrevEnd !== Number(currentBoundaryPrevSeg.end_time)) {
                savingPrev = true;
                savePromises.push(
                    fetch('/api/v2/segment/update', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            segment_id: currentBoundaryPrevSeg.id,
                            start_time: Number(currentBoundaryPrevSeg.start_time),
                            end_time: modifiedPrevEnd
                        })
                    })
                );
            }

            let savingNext = false;
            if (isSnapEnabled && isBoundaryNextContiguous && currentBoundaryNextSeg && modifiedNextStart !== null && modifiedNextStart !== Number(currentBoundaryNextSeg.start_time)) {
                savingNext = true;
                savePromises.push(
                    fetch('/api/v2/segment/update', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            segment_id: currentBoundaryNextSeg.id,
                            start_time: modifiedNextStart,
                            end_time: Number(currentBoundaryNextSeg.end_time)
                        })
                    })
                );
            }

            const responses = await Promise.all(savePromises);
            const results = await Promise.all(responses.map(r => r.json()));
            const allSuccess = results.every(res => res && res.success);

            if (allSuccess) {
                currentBoundarySegment.start_time = startSec;
                currentBoundarySegment.end_time = endSec;

                if (savingPrev && currentBoundaryPrevSeg) {
                    currentBoundaryPrevSeg.end_time = modifiedPrevEnd;
                }
                if (savingNext && currentBoundaryNextSeg) {
                    currentBoundaryNextSeg.start_time = modifiedNextStart;
                }

                if (projectV2Data && projectV2Data.channels) {
                    projectV2Data.channels.forEach(channel => {
                        (channel.media || []).forEach(m => {
                            (m.segments || []).forEach(s => {
                                if (String(s.id) === String(currentBoundarySegment.id)) {
                                    s.start_time = startSec;
                                    s.end_time = endSec;
                                }
                                if (savingPrev && currentBoundaryPrevSeg && String(s.id) === String(currentBoundaryPrevSeg.id)) {
                                    s.end_time = modifiedPrevEnd;
                                }
                                if (savingNext && currentBoundaryNextSeg && String(s.id) === String(currentBoundaryNextSeg.id)) {
                                    s.start_time = modifiedNextStart;
                                }
                            });
                        });
                    });
                }

                await refreshV2Data();
                closeSegmentBoundaryModal();
                renderAlignerContainer();
                showSaveNotification('Límites guardados.');
            } else {
                alert('Error al guardar límites de segmento.');
            }
        } catch (err) {
            console.error('Error saving segment boundaries:', err);
            alert('Error al conectar con el servidor.');
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '💾 Guardar Segmento';
            }
        }
    });

    window.addEventListener('keydown', (e) => {
        const boundaryModal = document.getElementById('segment-boundary-modal');
        if (boundaryModal && boundaryModal.style.display === 'flex') {
            if (e.key === 'Escape') {
                closeSegmentBoundaryModal();
            } else if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                e.preventDefault();
                document.getElementById('boundary-play-btn')?.click();
            }
        }
    });

    document.getElementById('v2-open-aligner-btn')?.addEventListener('click', () => {
        document.getElementById('daw-view-container').style.display = 'none';
        const alignerView = document.getElementById('v2-aligner-view');
        if (alignerView) alignerView.style.display = 'flex';
        renderAlignerContainer();
    });

    document.getElementById('v2-do-align-btn')?.addEventListener('click', async () => {
        const channels = projectV2Data.channels || [];
        const totalChannels = channels.length;
        const selectedSegIds = Object.values(selectedAlignerSegments);

        if (selectedSegIds.length < totalChannels) {
            alert('Debes seleccionar un segmento en cada uno de los canales para realizar la alineación.');
            return;
        }

        try {
            const response = await fetch('/api/v2/match/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    project_id: v2ProjectId,
                    segment_ids: selectedSegIds
                })
            });

            const res = await response.json();
            if (res.success) {
                selectedAlignerSegments = {};
                await refreshV2Data();
                renderAlignerContainer();
            } else {
                alert('Error al guardar la alineación: ' + (res.error || 'Error desconocido'));
            }
        } catch (err) {
            console.error('Error saving alignment match:', err);
            alert('Error al conectar con el servidor.');
        }
    });

    document.getElementById('v2-back-to-daw-btn')?.addEventListener('click', () => {
        destroyAlignerWaveSurfers();
        const alignerView = document.getElementById('v2-aligner-view');
        if (alignerView) alignerView.style.display = 'none';
        document.getElementById('daw-view-container').style.display = 'flex';
    });
}

let currentCSVRawText = '';

function renderCSVPreviewTable(csvText) {
    const container = document.getElementById('csv-preview-container');
    const table = document.getElementById('csv-preview-table');
    if (!container || !table) return;

    if (!csvText) {
        container.style.display = 'none';
        return;
    }

    let delimiter = document.getElementById('csv-delimiter-input')?.value;
    if (delimiter === undefined || delimiter === null || delimiter === '') {
        delimiter = ',';
    }
    if (delimiter === '\\t') delimiter = '\t';

    const lines = csvText.split(/\r\n|\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) {
        container.style.display = 'none';
        return;
    }

    const parseLine = (line) => {
        const result = [];
        let cur = '';
        let inQuotes = false;
        const dLen = delimiter.length;

        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"' || c === "'") {
                inQuotes = !inQuotes;
            } else if (!inQuotes && line.substr(i, dLen) === delimiter) {
                result.push(cur.trim());
                cur = '';
                i += (dLen - 1);
            } else {
                cur += c;
            }
        }
        result.push(cur.trim());
        return result;
    };

    const header = parseLine(lines[0]);
    const rows = lines.slice(1, 6).map(l => parseLine(l));

    const channelsList = (typeof projectV2Data !== 'undefined' && projectV2Data && projectV2Data.channels) 
        ? projectV2Data.channels 
        : [];
    const textChannels = channelsList.filter(c => c.type !== 'audio');

    let html = '<thead>';

    // Row 1 of thead: Channel dropdowns above each column
    html += '<tr style="background: #e2e8f0; border-bottom: 2px solid #cbd5e1;">';
    header.forEach((h, colIdx) => {
        html += `<th style="padding: 6px; border-right: 1px solid #cbd5e1; min-width: 140px;">`;
        html += `<select class="csv-col-channel-select ft-input" data-col-index="${colIdx}" style="padding: 4px 6px; font-size: 11px; font-weight: 700; background: white; width: 100%; cursor: pointer;">`;
        html += `<option value="">- Sin asignar -</option>`;
        textChannels.forEach(ch => {
            const isSelected = (colIdx === 0 && String(ch.id) === String(currentTextChannelId)) ? 'selected' : '';
            html += `<option value="${ch.id}" ${isSelected}>${escapeHtml(ch.name)}</option>`;
        });
        html += `</select></th>`;
    });
    html += '</tr>';

    // Row 2 of thead: Header names from CSV Row 0
    html += '<tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1;">';
    header.forEach(h => {
        html += `<th style="padding: 8px 12px; font-weight: 700; border-right: 1px solid #cbd5e1; color: var(--ft-ink); font-size: 12px;">${escapeHtml(h)}</th>`;
    });
    html += '</tr></thead><tbody>';

    rows.forEach((r, rIdx) => {
        html += `<tr style="border-bottom: 1px solid #e2e8f0; ${rIdx % 2 === 1 ? 'background: #f8fafc;' : ''}">`;
        for (let i = 0; i < header.length; i++) {
            const cellVal = r[i] !== undefined ? r[i] : '';
            html += `<td style="padding: 8px 12px; border-right: 1px solid #e2e8f0; font-size: 12px;">${escapeHtml(cellVal)}</td>`;
        }
        html += '</tr>';
    });
    html += '</tbody>';

    table.innerHTML = html;
    container.style.display = 'flex';
}

let modalWavesurfer = null;
let currentAudioModalMedia = null;
let currentAudioModalChannel = null;

let segWavesurfer = null;
let segRegionsPlugin = null;
let currentSegmentingMedia = null;
let currentSegmentingChannel = null;

let boundaryWaveSurfer = null;
let boundaryRegionsPlugin = null;
let currentBoundaryRegion = null;
let currentBoundarySegment = null;
let currentBoundaryMedia = null;
let currentBoundaryChannel = null;
let isBoundaryRegionPlaying = false;
let currentBoundaryPrevSeg = null;
let currentBoundaryNextSeg = null;
let currentBoundaryPrevRegion = null;
let currentBoundaryNextRegion = null;
let isBoundaryPrevContiguous = false;
let isBoundaryNextContiguous = false;
let modifiedPrevEnd = null;
let modifiedNextStart = null;

function syncContiguousBoundaries() {
    const snapToggle = document.getElementById('boundary-snap-toggle');
    const isSnapEnabled = snapToggle ? snapToggle.checked : true;
    if (!isSnapEnabled || !currentBoundaryRegion) return;

    const currentStart = Number(currentBoundaryRegion.start.toFixed(3));
    const currentEnd = Number(currentBoundaryRegion.end.toFixed(3));

    // 1. Acompañar el segmento previo contiguo si se mueve el inicio del actual
    if (isBoundaryPrevContiguous && currentBoundaryPrevSeg && currentBoundaryPrevRegion) {
        const prevStart = Number(currentBoundaryPrevSeg.start_time);
        const newPrevEnd = Math.max(prevStart + 0.05, currentStart);
        modifiedPrevEnd = Number(newPrevEnd.toFixed(3));
        currentBoundaryPrevRegion.setOptions({
            end: modifiedPrevEnd
        });
    }

    // 2. Acompañar el segmento siguiente contiguo si se mueve el fin del actual
    if (isBoundaryNextContiguous && currentBoundaryNextSeg && currentBoundaryNextRegion) {
        const nextEnd = Number(currentBoundaryNextSeg.end_time);
        const newNextStart = Math.min(nextEnd - 0.05, currentEnd);
        modifiedNextStart = Number(newNextStart.toFixed(3));
        currentBoundaryNextRegion.setOptions({
            start: modifiedNextStart
        });
    }
}

function centerBoundaryWaveformOnSegment(pxPerSec) {
    if (!boundaryWaveSurfer || !currentBoundarySegment) return;
    const seg = currentBoundarySegment;
    const segStart = (currentBoundaryRegion ? currentBoundaryRegion.start : Number(seg.start_time)) || 0;
    const segEnd = (currentBoundaryRegion ? currentBoundaryRegion.end : Number(seg.end_time)) || (segStart + 5);
    const centerTime = (segStart + segEnd) / 2;

    const scrollContainer = boundaryWaveSurfer.renderer?.scrollContainer ||
                            document.querySelector('#boundary-waveform-container div[style*="overflow"]') ||
                            document.querySelector('#boundary-waveform-container [part="scroll"]') ||
                            document.querySelector('#boundary-waveform-container > div');
    const wrapper = document.getElementById('boundary-waveform-wrapper');

    const clientWidth = (scrollContainer && scrollContainer.clientWidth > 50) 
        ? scrollContainer.clientWidth 
        : (wrapper?.clientWidth || 850);
        
    const duration = boundaryWaveSurfer.getDuration() || 0;
    const scrollWidth = scrollContainer ? scrollContainer.scrollWidth : 0;

    let centerPx = 0;
    const currentPxPerSec = pxPerSec || (scrollWidth > clientWidth && duration > 0 ? (scrollWidth / duration) : 70);

    if (scrollWidth > clientWidth && duration > 0) {
        centerPx = centerTime * (scrollWidth / duration);
    } else {
        centerPx = centerTime * currentPxPerSec;
    }

    const targetScroll = Math.max(0, Math.round(centerPx - (clientWidth / 2)));

    // 1. Scroll WaveSurfer's internal scroll container directly
    if (scrollContainer) {
        scrollContainer.scrollLeft = targetScroll;
    }

    // 2. WaveSurfer API setScroll
    if (typeof boundaryWaveSurfer.setScroll === 'function') {
        try {
            boundaryWaveSurfer.setScroll(targetScroll);
        } catch (e) {}
    }

    // 3. Fallback setScrollPercentage
    if (duration > 0 && typeof boundaryWaveSurfer.setScrollPercentage === 'function') {
        const totalW = scrollWidth || (duration * currentPxPerSec);
        if (totalW > clientWidth) {
            const ratio = targetScroll / totalW;
            try {
                boundaryWaveSurfer.setScrollPercentage(Math.max(0, Math.min(1, ratio)));
            } catch (e) {}
        }
    }

    // 4. Fallback on outer wrapper if it has overflow
    if (wrapper && wrapper.scrollWidth > wrapper.clientWidth) {
        wrapper.scrollLeft = targetScroll;
    }
}

function openAudioPlayerModal(med, ch, slotStatus) {
    currentAudioModalMedia = med;
    currentAudioModalChannel = ch;

    if (!slotStatus || typeof slotStatus !== 'object') {
        slotStatus = calculateMediaSlotStatus(med, projectV2Data);
    }

    const modal = document.getElementById('audio-player-modal');
    if (!modal) return;

    document.getElementById('audio-modal-filename').innerText = med.filename;
    
    const badge = document.getElementById('audio-modal-status-badge');
    if (badge) {
        badge.innerText = slotStatus.label;
        badge.className = `ft-badge ${slotStatus.badgeClass}`;
    }

    const segBtn = document.getElementById('audio-modal-segment-btn');
    if (segBtn) {
        if (slotStatus.status !== 'raw') {
            segBtn.innerHTML = 'Ver / Editar segmentación';
        } else {
            segBtn.innerHTML = 'Segmentar Audio';
        }
    }

    const containerId = 'audio-modal-waveform-container';
    const container = document.getElementById(containerId);
    if (container) {
        container.innerHTML = `
            <div id="audio-modal-loading" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100px; color: var(--ft-ink-muted); gap: 8px;">
                <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 13px;">
                    <span class="waveform-loading-spinner"></span>
                    <span id="audio-modal-loading-text">Cargando audio... <strong id="audio-modal-loading-progress" style="color: var(--ft-claret);">0%</strong></span>
                </div>
                <div id="audio-modal-loading-bar-bg" style="width: 220px; height: 6px; background: #e5e0d8; border-radius: 3px; overflow: hidden;">
                    <div id="audio-modal-loading-bar-fill" style="width: 0%; height: 100%; background: var(--ft-claret); transition: width 0.15s ease;"></div>
                </div>
            </div>
            <div id="audio-modal-waveform-target" style="display: none; width: 100%;"></div>
        `;
    }

    if (modalWavesurfer) {
        try { modalWavesurfer.destroy(); } catch (e) {}
        modalWavesurfer = null;
    }

    modal.style.display = 'flex';

    const playBtn = document.getElementById('audio-modal-play-btn');
    if (playBtn) {
        playBtn.disabled = true;
        playBtn.innerHTML = '⏳ Cargando...';
    }

    const audioUrl = `/uploads/${med.filename}`;
    modalWavesurfer = WaveSurfer.create({
        container: '#audio-modal-waveform-target',
        waveColor: '#d7cbb9',
        progressColor: '#990F3D',
        height: 100,
        responsive: true,
        url: audioUrl
    });

    modalWavesurfer.on('loading', (percent) => {
        const progEl = document.getElementById('audio-modal-loading-progress');
        if (progEl) progEl.innerText = `${percent}%`;
        const barFill = document.getElementById('audio-modal-loading-bar-fill');
        if (barFill) barFill.style.width = `${percent}%`;
    });

    modalWavesurfer.on('decode', () => {
        const textEl = document.getElementById('audio-modal-loading-text');
        if (textEl) textEl.innerHTML = 'Decodificando forma de onda...';
    });

    modalWavesurfer.on('ready', () => {
        const loadingEl = document.getElementById('audio-modal-loading');
        if (loadingEl) loadingEl.style.display = 'none';
        const targetEl = document.getElementById('audio-modal-waveform-target');
        if (targetEl) targetEl.style.display = 'block';
        if (playBtn) {
            playBtn.disabled = false;
            playBtn.innerHTML = '▶ Reproducir';
        }
    });

    modalWavesurfer.on('error', (err) => {
        console.error('Error cargando audio en modalWavesurfer:', err);
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100px; color: #991b1b; background: #fee2e2; border: 1.5px solid #f87171; padding: 12px; border-radius: 4px; gap: 6px; font-size: 12px; text-align: center;">
                    <strong>⚠️ Error al procesar el archivo de audio</strong>
                    <span>No se pudo decodificar "${med.filename}". El navegador puede tener dificultades con archivos de alta frecuencia (como 96kHz PCM).</span>
                </div>
            `;
        }
        if (playBtn) {
            playBtn.disabled = true;
            playBtn.innerHTML = '❌ Error';
        }
    });

    modalWavesurfer.on('play', () => {
        if (playBtn) playBtn.innerHTML = '⏸ Pausar';
    });

    modalWavesurfer.on('pause', () => {
        if (playBtn) playBtn.innerHTML = '▶ Reproducir';
    });

    modalWavesurfer.on('finish', () => {
        if (playBtn) playBtn.innerHTML = '▶ Reproducir';
    });

    if (playBtn) {
        playBtn.onclick = () => {
            if (modalWavesurfer) modalWavesurfer.playPause();
        };
    }
}

function closeAudioPlayerModal() {
    const modal = document.getElementById('audio-player-modal');
    if (modal) modal.style.display = 'none';

    if (modalWavesurfer) {
        try {
            modalWavesurfer.pause();
            modalWavesurfer.destroy();
        } catch (e) {}
        modalWavesurfer = null;
    }
}

let currentTextModalMedia = null;
let currentTextModalChannel = null;

/**
 * Shared Text Segment Card Component.
 * Ensures the cell representation in the Text Segmenter is the EXACT same
 * as in the Aligner grid, allowing seamless simultaneous workflows.
 */
function buildTextSegmentCard(seg, ch, options = {}) {
    // Resolve the true channel belonging to this segment
    const actualChannel = (projectV2Data && projectV2Data.channels) ?
        (projectV2Data.channels.find(c => String(c.id) === String(seg.channel_id)) || ch) : ch;

    const {
        index = 1,
        showRadio = false,
        radioName = `aligner-ch-${actualChannel.id}`,
        isSelected = false,
        onSelect = null,
        showTimestamps = true
    } = options;

    const status = getSegmentMatchStatus(seg.id);

    const card = document.createElement('div');
    card.className = `aligner-segment-card status-${status}`;
    card.setAttribute('data-segment-id', seg.id);
    card.setAttribute('data-channel-id', actualChannel.id);

    if (isSelected) {
        card.classList.add('selected-segment-card');
    }

    let statusBadgeText = 'Sin Match';
    let statusBadgeStyle = 'background: #fee2e2; color: #991b1b;';
    if (status === 'all') {
        statusBadgeText = 'Match Total';
        statusBadgeStyle = 'background: #dcfce7; color: #166534;';
    } else if (status === 'partial') {
        statusBadgeText = 'Match Parcial';
        statusBadgeStyle = 'background: #fef9c3; color: #854d0e;';
    }

    const segHeader = document.createElement('div');
    segHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; gap: 8px;';

    const leftGroup = document.createElement('div');
    leftGroup.style.cssText = 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;';

    if (showRadio) {
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.className = 'aligner-seg-radio';
        radio.name = radioName;
        radio.value = seg.id;
        radio.checked = isSelected;
        radio.style.cssText = 'cursor: pointer; width: 16px; height: 16px; accent-color: var(--ft-claret); margin: 0;';
        leftGroup.appendChild(radio);
    }

    const badgeSpan = document.createElement('span');
    badgeSpan.className = 'ft-badge';
    badgeSpan.style.cssText = 'font-size: 10px; background: white; border: 1px solid var(--ft-border); font-weight: 700; color: var(--ft-ink);';
    badgeSpan.innerText = `SEG #${seg.json_segment_id || index}`;
    leftGroup.appendChild(badgeSpan);

    // Actions button placed directly next to segment identifier
    const actionsBtn = document.createElement('button');
    actionsBtn.type = 'button';
    actionsBtn.title = 'Acciones de segmento';
    actionsBtn.style.cssText = 'padding: 1px 6px; font-size: 11px; cursor: pointer; border: 1px solid var(--ft-border); background: white; font-weight: 700; color: var(--ft-ink); border-radius: 2px; line-height: 1.2; display: inline-flex; align-items: center; gap: 3px;';
    actionsBtn.innerHTML = '⚙️ <span style="font-size: 9px;">▾</span>';

    actionsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideSegActionsMenu();

        const rect = actionsBtn.getBoundingClientRect();
        const menu = document.createElement('div');
        menu.className = 'seg-actions-menu-popup';
        
        let topPos = rect.bottom + 4;
        if (topPos + 150 > window.innerHeight) {
            topPos = Math.max(10, rect.top - 140);
        }
        let leftPos = rect.left;
        if (leftPos + 210 > window.innerWidth) {
            leftPos = Math.max(10, window.innerWidth - 220);
        }

        menu.style.cssText = `
            position: fixed;
            left: ${leftPos}px;
            top: ${topPos}px;
            z-index: 99999;
            background: white;
            border: 1.5px solid var(--ft-border, #1e1e1e);
            box-shadow: 3px 3px 0px rgba(0,0,0,0.2);
            min-width: 200px;
            padding: 4px 0;
            border-radius: 4px;
        `;

        const addBeforeItem = document.createElement('div');
        addBeforeItem.style.cssText = 'padding: 8px 12px; font-size: 12px; font-weight: 700; color: var(--ft-ink, #1e1e1e); cursor: pointer; display: flex; align-items: center; gap: 8px; transition: background 0.1s ease;';
        addBeforeItem.innerHTML = '<span>⬆️</span> <span>Agregar segmento antes</span>';
        addBeforeItem.addEventListener('mouseenter', () => addBeforeItem.style.background = '#f0fdf4');
        addBeforeItem.addEventListener('mouseleave', () => addBeforeItem.style.background = 'white');
        addBeforeItem.addEventListener('click', (ev) => {
            ev.stopPropagation();
            hideSegActionsMenu();
            handleInsertEmptySegment(seg, actualChannel, 'before');
        });

        const addAfterItem = document.createElement('div');
        addAfterItem.style.cssText = 'padding: 8px 12px; font-size: 12px; font-weight: 700; color: var(--ft-ink, #1e1e1e); cursor: pointer; display: flex; align-items: center; gap: 8px; transition: background 0.1s ease;';
        addAfterItem.innerHTML = '<span>⬇️</span> <span>Agregar segmento después</span>';
        addAfterItem.addEventListener('mouseenter', () => addAfterItem.style.background = '#f0fdf4');
        addAfterItem.addEventListener('mouseleave', () => addAfterItem.style.background = 'white');
        addAfterItem.addEventListener('click', (ev) => {
            ev.stopPropagation();
            hideSegActionsMenu();
            handleInsertEmptySegment(seg, actualChannel, 'after');
        });

        const divider = document.createElement('div');
        divider.style.cssText = 'border-top: 1px solid #e2e8f0; margin: 4px 0;';

        const deleteItem = document.createElement('div');
        deleteItem.style.cssText = 'padding: 8px 12px; font-size: 12px; font-weight: 700; color: #990F3D; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: background 0.1s ease;';
        deleteItem.innerHTML = '<span>🗑️</span> <span>Eliminar segmento</span>';

        deleteItem.addEventListener('mouseenter', () => deleteItem.style.background = '#fff5f5');
        deleteItem.addEventListener('mouseleave', () => deleteItem.style.background = 'white');

        deleteItem.addEventListener('click', (ev) => {
            ev.stopPropagation();
            hideSegActionsMenu();
            handleDeleteSegment(seg, actualChannel);
        });

        menu.appendChild(addBeforeItem);
        menu.appendChild(addAfterItem);
        menu.appendChild(divider);
        menu.appendChild(deleteItem);
        document.body.appendChild(menu);
        activeSegActionsMenu = menu;
    });

    leftGroup.appendChild(actionsBtn);

    segHeader.appendChild(leftGroup);

    const rightGroup = document.createElement('div');
    rightGroup.style.cssText = 'display: flex; align-items: center; gap: 6px;';

    const statusBadge = document.createElement('span');
    statusBadge.style.cssText = `font-size: 10px; font-weight: 800; padding: 2px 6px; text-transform: uppercase; ${statusBadgeStyle}`;
    statusBadge.innerText = statusBadgeText;
    rightGroup.appendChild(statusBadge);

    segHeader.appendChild(rightGroup);
    card.appendChild(segHeader);

    const textContentInput = document.createElement('textarea');
    textContentInput.className = 'aligner-segment-text';
    const initialText = (seg.text_content !== undefined && seg.text_content !== null)
        ? seg.text_content
        : (seg.text || '');
    textContentInput.value = initialText;
    textContentInput.placeholder = 'Escribe el texto aquí...';
    textContentInput.rows = 2;

    let lastSavedText = initialText;
    let autoSaveTimeout = null;

    function triggerAutoSave() {
        const currentVal = textContentInput.value;
        if (currentVal !== lastSavedText) {
            autoSaveSegmentText(seg.id, currentVal, seg).then(success => {
                if (success) {
                    lastSavedText = currentVal;
                    // Sync other textboxes for this segment if present in the DOM
                    document.querySelectorAll(`.aligner-segment-card[data-segment-id="${seg.id}"] .aligner-segment-text`).forEach(other => {
                        if (other !== textContentInput && other.value !== currentVal) {
                            other.value = currentVal;
                            autoResizeTextarea(other);
                        }
                    });
                }
            });
        }
    }

    textContentInput.addEventListener('input', () => {
        autoResizeTextarea(textContentInput);
        if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
        autoSaveTimeout = setTimeout(triggerAutoSave, AUTO_SAVE_DEBOUNCE_MS);
    });

    textContentInput.addEventListener('blur', () => {
        if (autoSaveTimeout) {
            clearTimeout(autoSaveTimeout);
            autoSaveTimeout = null;
        }
        triggerAutoSave();
    });

    // Prevent clicking inside textarea from triggering selection toggle on card
    textContentInput.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // Right-click context menu for text selection to assign text to new previous/next segment
    textContentInput.addEventListener('contextmenu', (e) => {
        const start = textContentInput.selectionStart;
        const end = textContentInput.selectionEnd;
        if (start === undefined || end === undefined || start === end) return;

        const selectedText = textContentInput.value.substring(start, end);
        if (!selectedText.trim()) return;

        e.preventDefault();
        e.stopPropagation();

        hideTextContextMenu();

        // Ensure current text is synced to seg object
        seg.text_content = textContentInput.value;
        seg.text = textContentInput.value;

        const offsets = { start: start, end: end };

        showTextContextMenu(e.pageX, e.pageY, {
            selectedText: selectedText,
            offsets: offsets,
            seg: seg,
            ch: actualChannel
        });
    });

    card.appendChild(textContentInput);

    // Initial height calculation
    requestAnimationFrame(() => autoResizeTextarea(textContentInput));

    if (typeof onSelect === 'function') {
        card.addEventListener('click', (e) => {
            onSelect(e, seg, card);
        });
    }

    return card;
}

let activeContextMenu = null;
let activeSegActionsMenu = null;

function hideTextContextMenu() {
    if (activeContextMenu) {
        activeContextMenu.remove();
        activeContextMenu = null;
    }
}

function hideSegActionsMenu() {
    if (activeSegActionsMenu) {
        activeSegActionsMenu.remove();
        activeSegActionsMenu = null;
    }
}

document.addEventListener('click', () => {
    hideTextContextMenu();
    hideSegActionsMenu();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        hideTextContextMenu();
        hideSegActionsMenu();
    }
});

function getSelectionCharacterOffsetWithin(element) {
    let start = 0;
    let end = 0;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(element);
        preCaretRange.setEnd(range.startContainer, range.startOffset);
        start = preCaretRange.toString().length;
        end = start + range.toString().length;
    }
    return { start, end };
}

function showTextContextMenu(x, y, data) {
    const { selectedText, offsets, seg, ch } = data;

    const menu = document.createElement('div');
    menu.id = 'v2-text-context-menu';
    menu.style.cssText = `
        position: absolute;
        top: ${y}px;
        left: ${x}px;
        z-index: 10000;
        background: white;
        border: 2px solid var(--ft-border, #1e1e1e);
        box-shadow: 4px 4px 0px rgba(0,0,0,0.15);
        padding: 4px 0;
        min-width: 260px;
        font-family: inherit;
    `;

    const itemPrev = document.createElement('div');
    itemPrev.className = 'v2-ctx-menu-item';
    itemPrev.style.cssText = `
        padding: 8px 14px;
        font-size: 12px;
        font-weight: 700;
        color: var(--ft-ink, #1e1e1e);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: background 0.1s ease;
    `;
    itemPrev.innerHTML = `<span>⬆️</span> <span>Asignar a nuevo segmento previo</span>`;
    itemPrev.addEventListener('mouseenter', () => itemPrev.style.background = '#f0fdf4');
    itemPrev.addEventListener('mouseleave', () => itemPrev.style.background = 'white');

    itemPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        hideTextContextMenu();
        handleTextSegmentSplit(seg, ch, selectedText, offsets, 'prev');
    });

    const itemNext = document.createElement('div');
    itemNext.className = 'v2-ctx-menu-item';
    itemNext.style.cssText = `
        padding: 8px 14px;
        font-size: 12px;
        font-weight: 700;
        color: var(--ft-ink, #1e1e1e);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        border-top: 1px solid #f0f0f0;
        transition: background 0.1s ease;
    `;
    itemNext.innerHTML = `<span>⬇️</span> <span>Asignar a nuevo segmento posterior</span>`;
    itemNext.addEventListener('mouseenter', () => itemNext.style.background = '#eff6ff');
    itemNext.addEventListener('mouseleave', () => itemNext.style.background = 'white');

    itemNext.addEventListener('click', (e) => {
        e.stopPropagation();
        hideTextContextMenu();
        handleTextSegmentSplit(seg, ch, selectedText, offsets, 'next');
    });

    menu.appendChild(itemPrev);
    menu.appendChild(itemNext);
    document.body.appendChild(menu);
    activeContextMenu = menu;
}

function findBestMatchIndex(fullText, targetStr, approxStart) {
    if (!fullText || !targetStr) return null;

    let searchStr = targetStr;
    let pos = fullText.indexOf(searchStr);

    if (pos === -1 && targetStr.trim()) {
        searchStr = targetStr.trim();
        pos = fullText.indexOf(searchStr);
    }

    if (pos === -1) return null;

    const indices = [];
    while (pos !== -1) {
        indices.push({ index: pos, length: searchStr.length });
        pos = fullText.indexOf(searchStr, pos + 1);
    }

    if (indices.length === 1) {
        return indices[0];
    }

    let best = indices[0];
    let minDiff = Math.abs(indices[0].index - (approxStart || 0));
    for (let i = 1; i < indices.length; i++) {
        const diff = Math.abs(indices[i].index - (approxStart || 0));
        if (diff < minDiff) {
            minDiff = diff;
            best = indices[i];
        }
    }
    return best;
}

async function handleTextSegmentSplit(seg, ch, selectedText, offsets, direction) {
    if (!projectV2Data || !projectV2Data.channels) return;

    let targetChannel = null;
    let targetMedia = null;

    // First attempt to match using segment's own channel_id or media_id
    const candidateChannelId = seg.channel_id || (ch ? ch.id : null);
    const passedChObj = projectV2Data.channels.find(c => String(c.id) === String(candidateChannelId));
    if (passedChObj && passedChObj.media) {
        if (seg.media_id) {
            targetMedia = passedChObj.media.find(m => String(m.id) === String(seg.media_id));
        }
        if (!targetMedia) {
            targetMedia = passedChObj.media.find(m => m.segments && m.segments.some(s => String(s.id) === String(seg.id)));
        }
        if (targetMedia) {
            targetChannel = passedChObj;
        }
    }

    // Fallback: search across all channels to find which channel and media own this segment
    if (!targetMedia) {
        for (const c of (projectV2Data.channels || [])) {
            if (!c.media) continue;
            for (const m of c.media) {
                if (seg.media_id && String(m.id) === String(seg.media_id)) {
                    targetMedia = m;
                    targetChannel = c;
                    break;
                }
                if (m.segments && m.segments.some(s => String(s.id) === String(seg.id))) {
                    targetMedia = m;
                    targetChannel = c;
                    break;
                }
            }
            if (targetMedia) break;
        }
    }

    if (!targetMedia || !targetChannel) {
        alert('No se pudo encontrar el medio o canal correspondiente a este segmento.');
        return;
    }

    const currentSegments = targetMedia.segments || [];
    const segIdx = currentSegments.findIndex(s => String(s.id) === String(seg.id));
    if (segIdx === -1) {
        alert('No se encontró el segmento en el medio de destino.');
        return;
    }

    const rawFullText = currentSegments[segIdx].text_content !== undefined ? currentSegments[segIdx].text_content : (currentSegments[segIdx].text || '');
    const cleanFullText = rawFullText.replace(/\u00a0/g, ' ');
    const cleanSelectedText = selectedText.replace(/\u00a0/g, ' ').trim();

    let match = findBestMatchIndex(cleanFullText, cleanSelectedText, offsets ? offsets.start : 0);

    let remainingText = cleanFullText;
    if (match && match.index !== -1) {
        remainingText = cleanFullText.slice(0, match.index) + cleanFullText.slice(match.index + match.length);
    } else if (offsets && offsets.end > offsets.start) {
        remainingText = cleanFullText.slice(0, offsets.start) + cleanFullText.slice(offsets.end);
    } else {
        const fallbackPos = cleanFullText.indexOf(cleanSelectedText);
        if (fallbackPos !== -1) {
            remainingText = cleanFullText.slice(0, fallbackPos) + cleanFullText.slice(fallbackPos + cleanSelectedText.length);
        }
    }

    remainingText = remainingText.replace(/[ \t]+/g, ' ').trim();

    const newSegText = cleanSelectedText;
    const newSegObj = {
        start: currentSegments[segIdx].start_time || currentSegments[segIdx].start || 0,
        end: currentSegments[segIdx].end_time || currentSegments[segIdx].end || 0,
        text: newSegText,
        text_content: newSegText
    };

    currentSegments[segIdx].text_content = remainingText;
    currentSegments[segIdx].text = remainingText;

    if (direction === 'prev') {
        currentSegments.splice(segIdx, 0, newSegObj);
    } else {
        currentSegments.splice(segIdx + 1, 0, newSegObj);
    }

    const segmentsPayload = currentSegments.map((s, idx) => ({
        id: s.id || null,
        start: Number(s.start_time !== undefined ? s.start_time : (s.start || 0)),
        end: Number(s.end_time !== undefined ? s.end_time : (s.end || 0)),
        text: (s.text_content !== undefined ? s.text_content : (s.text || '')).trim(),
        json_segment_id: idx + 1
    }));

    try {
        const response = await fetch(`/api/v2/media/${targetMedia.id}/save_segments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                channel_id: targetChannel.id,
                segments: segmentsPayload
            })
        });
        const data = await response.json();
        if (data.success) {
            await refreshV2Data();

            const alignerView = document.getElementById('v2-aligner-view');
            if (alignerView && alignerView.style.display !== 'none') {
                renderAlignerContainer();
            }

            if (currentTextModalMedia && String(currentTextModalMedia.id) === String(targetMedia.id)) {
                let updatedMed = null;
                for (const channel of (projectV2Data.channels || [])) {
                    if (channel.media) {
                        const found = channel.media.find(m => String(m.id) === String(targetMedia.id));
                        if (found) { updatedMed = found; break; }
                    }
                }
                if (updatedMed) {
                    openTextSegmentationModal(updatedMed, targetChannel);
                }
            }
        } else {
            alert('Error al re-segmentar texto: ' + (data.error || ''));
        }
    } catch (err) {
        alert('Error en la solicitud: ' + err.message);
    }
}

async function handleInsertEmptySegment(seg, ch, position = 'after') {
    if (!projectV2Data || !projectV2Data.channels) return;

    let targetChannel = null;
    let targetMedia = null;

    const candidateChannelId = seg.channel_id || (ch ? ch.id : null);
    const passedChObj = projectV2Data.channels.find(c => String(c.id) === String(candidateChannelId));
    if (passedChObj && passedChObj.media) {
        if (seg.media_id) {
            targetMedia = passedChObj.media.find(m => String(m.id) === String(seg.media_id));
        }
        if (!targetMedia) {
            targetMedia = passedChObj.media.find(m => m.segments && m.segments.some(s => String(s.id) === String(seg.id)));
        }
        if (targetMedia) {
            targetChannel = passedChObj;
        }
    }

    if (!targetMedia) {
        for (const c of (projectV2Data.channels || [])) {
            if (!c.media) continue;
            for (const m of c.media) {
                if (seg.media_id && String(m.id) === String(seg.media_id)) {
                    targetMedia = m;
                    targetChannel = c;
                    break;
                }
                if (m.segments && m.segments.some(s => String(s.id) === String(seg.id))) {
                    targetMedia = m;
                    targetChannel = c;
                    break;
                }
            }
            if (targetMedia) break;
        }
    }

    if (!targetMedia || !targetChannel) {
        alert('No se pudo encontrar el medio o canal correspondiente a este segmento.');
        return;
    }

    const currentSegments = targetMedia.segments || [];
    const segIdx = currentSegments.findIndex(s => String(s.id) === String(seg.id));
    if (segIdx === -1) {
        alert('No se encontró el segmento en el medio de destino.');
        return;
    }

    // Sync any current values from DOM inputs before saving
    document.querySelectorAll(`.aligner-segment-card[data-channel-id="${targetChannel.id}"]`).forEach(cEl => {
        const sId = cEl.getAttribute('data-segment-id');
        const txtInput = cEl.querySelector('.aligner-segment-text');
        if (sId && txtInput) {
            const foundSeg = currentSegments.find(s => String(s.id) === String(sId));
            if (foundSeg) {
                foundSeg.text_content = txtInput.value;
                foundSeg.text = txtInput.value;
            }
        }
    });

    const newSegObj = {
        id: null,
        start: 0,
        end: 0,
        text: '',
        text_content: ''
    };

    const insertIdx = (position === 'before') ? segIdx : (segIdx + 1);
    currentSegments.splice(insertIdx, 0, newSegObj);

    const segmentsPayload = currentSegments.map((s, idx) => ({
        id: s.id || null,
        start: Number(s.start_time !== undefined ? s.start_time : (s.start || 0)),
        end: Number(s.end_time !== undefined ? s.end_time : (s.end || 0)),
        text: s.text_content !== undefined && s.text_content !== null ? s.text_content : (s.text || ''),
        json_segment_id: idx + 1
    }));

    try {
        const response = await fetch(`/api/v2/media/${targetMedia.id}/save_segments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                channel_id: targetChannel.id,
                segments: segmentsPayload
            })
        });
        const data = await response.json();
        if (data.success) {
            await refreshV2Data();

            const alignerView = document.getElementById('v2-aligner-view');
            if (alignerView && alignerView.style.display !== 'none') {
                renderAlignerContainer();
            }

            if (currentTextModalMedia && String(currentTextModalMedia.id) === String(targetMedia.id)) {
                let updatedMed = null;
                for (const channel of (projectV2Data.channels || [])) {
                    if (channel.media) {
                        const found = channel.media.find(m => String(m.id) === String(targetMedia.id));
                        if (found) { updatedMed = found; break; }
                    }
                }
                if (updatedMed) {
                    openTextSegmentationModal(updatedMed, targetChannel);
                }
            }

            showSaveNotification('Segmento agregado.');

            // Focus newly inserted empty textbox
            setTimeout(() => {
                let refreshedMedia = null;
                const chObj = (projectV2Data.channels || []).find(c => String(c.id) === String(targetChannel.id));
                if (chObj && chObj.media) {
                    refreshedMedia = chObj.media.find(m => String(m.id) === String(targetMedia.id));
                }
                if (refreshedMedia && refreshedMedia.segments && refreshedMedia.segments[insertIdx]) {
                    const createdSegId = refreshedMedia.segments[insertIdx].id;
                    const newEl = document.querySelector(`.aligner-segment-card[data-segment-id="${createdSegId}"] .aligner-segment-text`);
                    if (newEl) {
                        newEl.focus();
                    }
                }
            }, 60);
        } else {
            alert('Error al agregar segmento: ' + (data.error || ''));
        }
    } catch (err) {
        alert('Error en la solicitud: ' + err.message);
    }
}

async function handleDeleteSegment(seg, ch) {
    if (!confirm('¿Estás seguro de que deseas eliminar este segmento?')) return;

    if (!projectV2Data || !projectV2Data.channels) return;

    let targetChannel = null;
    let targetMedia = null;

    const candidateChannelId = seg.channel_id || (ch ? ch.id : null);
    const passedChObj = projectV2Data.channels.find(c => String(c.id) === String(candidateChannelId));
    if (passedChObj && passedChObj.media) {
        if (seg.media_id) {
            targetMedia = passedChObj.media.find(m => String(m.id) === String(seg.media_id));
        }
        if (!targetMedia) {
            targetMedia = passedChObj.media.find(m => m.segments && m.segments.some(s => String(s.id) === String(seg.id)));
        }
        if (targetMedia) {
            targetChannel = passedChObj;
        }
    }

    if (!targetMedia) {
        for (const c of (projectV2Data.channels || [])) {
            if (!c.media) continue;
            for (const m of c.media) {
                if (seg.media_id && String(m.id) === String(seg.media_id)) {
                    targetMedia = m;
                    targetChannel = c;
                    break;
                }
                if (m.segments && m.segments.some(s => String(s.id) === String(seg.id))) {
                    targetMedia = m;
                    targetChannel = c;
                    break;
                }
            }
            if (targetMedia) break;
        }
    }

    if (!targetMedia || !targetChannel) return;

    const currentSegments = targetMedia.segments || [];
    const segIdx = currentSegments.findIndex(s => String(s.id) === String(seg.id));
    if (segIdx === -1) return;

    currentSegments.splice(segIdx, 1);

    const segmentsPayload = currentSegments.map((s, idx) => ({
        id: s.id || null,
        start: Number(s.start_time !== undefined ? s.start_time : (s.start || 0)),
        end: Number(s.end_time !== undefined ? s.end_time : (s.end || 0)),
        text: (s.text_content !== undefined ? s.text_content : (s.text || '')).trim(),
        json_segment_id: idx + 1
    }));

    try {
        const response = await fetch(`/api/v2/media/${targetMedia.id}/save_segments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                channel_id: targetChannel.id,
                segments: segmentsPayload
            })
        });
        const data = await response.json();
        if (data.success) {
            await refreshV2Data();

            const alignerView = document.getElementById('v2-aligner-view');
            if (alignerView && alignerView.style.display !== 'none') {
                renderAlignerContainer();
            }

            if (currentTextModalMedia && String(currentTextModalMedia.id) === String(targetMedia.id)) {
                let updatedMed = null;
                for (const channel of (projectV2Data.channels || [])) {
                    if (channel.media) {
                        const found = channel.media.find(m => String(m.id) === String(targetMedia.id));
                        if (found) { updatedMed = found; break; }
                    }
                }
                if (updatedMed) {
                    openTextSegmentationModal(updatedMed, targetChannel);
                }
            }
        } else {
            alert('Error al eliminar segmento: ' + (data.error || ''));
        }
    } catch (err) {
        alert('Error en la solicitud: ' + err.message);
    }
}

async function handleDeleteAllSegmentation(med, ch) {
    if (!confirm('¿Estás seguro de que deseas eliminar la segmentación y volver a cargar el texto original del archivo?\n\nEsta acción descartará todos los segmentos actuales y restaurará el contenido del archivo original.')) return;

    try {
        const response = await fetch(`/api/v2/media/${med.id}/reset_segmentation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel_id: ch.id })
        });
        const data = await response.json();
        if (data.success) {
            await refreshV2Data();

            const alignerView = document.getElementById('v2-aligner-view');
            if (alignerView && alignerView.style.display !== 'none') {
                renderAlignerContainer();
            }

            if (currentTextModalMedia && String(currentTextModalMedia.id) === String(med.id)) {
                let updatedMed = null;
                for (const channel of (projectV2Data.channels || [])) {
                    if (channel.media) {
                        const found = channel.media.find(m => String(m.id) === String(med.id));
                        if (found) { updatedMed = found; break; }
                    }
                }
                if (updatedMed) {
                    openTextSegmentationModal(updatedMed, ch);
                }
            }
        } else {
            alert('Error al reiniciar segmentación: ' + (data.error || ''));
        }
    } catch (err) {
        alert('Error en la solicitud: ' + err.message);
    }
}


function openTextSegmentationModal(med, ch, slotStatus) {
    currentTextModalMedia = med;
    currentTextModalChannel = ch;

    if (!slotStatus || typeof slotStatus !== 'object') {
        slotStatus = calculateMediaSlotStatus(med, projectV2Data);
    }

    const modal = document.getElementById('text-segmentation-modal');
    if (!modal) return;

    // Filename & channel info
    const filenameEl = document.getElementById('text-seg-modal-filename');
    if (filenameEl) filenameEl.innerText = med.filename || 'Archivo';

    const subtitleEl = document.getElementById('text-seg-modal-subtitle');
    if (subtitleEl) {
        const chName = ch ? (ch.name || 'Canal') : 'Canal';
        const chType = ch ? (ch.type || 'texto') : 'texto';
        subtitleEl.innerText = `Canal: ${chName} (${chType})`;
    }

    const typeBadge = document.getElementById('text-seg-modal-type-badge');
    if (typeBadge) typeBadge.innerText = (med.media_type || 'text').toUpperCase();

    const statusBadge = document.getElementById('text-seg-modal-status-badge');
    if (statusBadge) {
        statusBadge.innerText = slotStatus.label || 'RAW';
        statusBadge.className = `ft-badge ${slotStatus.badgeClass || ''}`;
    }

    const segments = med.segments || [];
    const countBadge = document.getElementById('text-seg-modal-count-badge');
    if (countBadge) {
        countBadge.innerText = `${segments.length} Segmentos`;
    }

    const actionsBtn = document.getElementById('text-seg-modal-actions-btn');
    if (actionsBtn) {
        actionsBtn.onclick = (e) => {
            e.stopPropagation();
            hideSegActionsMenu();

            const rect = actionsBtn.getBoundingClientRect();
            const menu = document.createElement('div');
            menu.className = 'seg-actions-menu-popup';
            menu.style.cssText = `
                position: fixed;
                left: ${rect.left}px;
                top: ${rect.bottom + 4}px;
                z-index: 99999;
                background: white;
                border: 1.5px solid var(--ft-border, #1e1e1e);
                box-shadow: 3px 3px 0px rgba(0,0,0,0.2);
                min-width: 190px;
                padding: 4px 0;
                border-radius: 4px;
            `;

            const resetItem = document.createElement('div');
            resetItem.style.cssText = 'padding: 8px 12px; font-size: 12px; font-weight: 700; color: #990F3D; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: background 0.1s ease;';
            resetItem.innerHTML = '<span>🗑️</span> <span>Eliminar segmentación</span>';

            resetItem.addEventListener('mouseenter', () => resetItem.style.background = '#fff5f5');
            resetItem.addEventListener('mouseleave', () => resetItem.style.background = 'white');

            resetItem.addEventListener('click', (ev) => {
                ev.stopPropagation();
                hideSegActionsMenu();
                handleDeleteAllSegmentation(med, ch);
            });

            menu.appendChild(resetItem);
            document.body.appendChild(menu);
            activeSegActionsMenu = menu;
        };
    }

    const listContainer = document.getElementById('text-seg-list-container');
    if (listContainer) {
        listContainer.innerHTML = '';

        if (segments.length === 0) {
            const emptyDiv = document.createElement('div');
            emptyDiv.style.cssText = 'text-align: center; padding: 48px 20px; background: white; border: 1px solid var(--ft-border); color: var(--ft-ink-muted); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;';
            emptyDiv.innerHTML = `
                <div style="font-size: 36px;">📭</div>
                <div style="font-weight: 700; font-size: 15px; color: var(--ft-ink);">Sin segmentos registrados</div>
                <div style="font-size: 13px; max-width: 420px; line-height: 1.4;">Este archivo de texto no contiene segmentos aún. Este espacio está preparado para editar la segmentación o re-segmentar próximamente.</div>
            `;
            listContainer.appendChild(emptyDiv);
        } else {
            segments.forEach((seg, idx) => {
                const card = buildTextSegmentCard(seg, ch, {
                    index: idx + 1,
                    showRadio: false,
                    showTimestamps: false,
                    isSelected: selectedAlignerSegments[ch.id] && String(selectedAlignerSegments[ch.id]) === String(seg.id),
                    onSelect: (e, segment, cardEl) => {
                        selectAlignerSegment(ch.id, segment.id);
                        updateAlignerSelectionUI();
                    }
                });
                listContainer.appendChild(card);
            });
        }
    }

    modal.style.display = 'flex';
}

function closeTextSegmentationModal() {
    const modal = document.getElementById('text-segmentation-modal');
    if (modal) modal.style.display = 'none';
    currentTextModalMedia = null;
    currentTextModalChannel = null;
}

function openSegmentationModal(med, ch) {
    closeAudioPlayerModal();
    
    currentSegmentingMedia = med;
    currentSegmentingChannel = ch;

    const modal = document.getElementById('segmentation-modal');
    if (!modal) return;

    document.getElementById('seg-modal-filename').innerText = med.filename;
    updateSegmentationCountBadge(0);

    const containerId = 'seg-waveform-container';
    const container = document.getElementById(containerId);
    if (container) {
        container.innerHTML = `
            <div id="seg-modal-loading" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 120px; color: var(--ft-ink-muted); gap: 8px;">
                <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 13px;">
                    <span class="waveform-loading-spinner"></span>
                    <span id="seg-modal-loading-text">Cargando audio... <strong id="seg-modal-loading-progress" style="color: var(--ft-claret);">0%</strong></span>
                </div>
                <div id="seg-modal-loading-bar-bg" style="width: 220px; height: 6px; background: #e5e0d8; border-radius: 3px; overflow: hidden;">
                    <div id="seg-modal-loading-bar-fill" style="width: 0%; height: 100%; background: var(--ft-claret); transition: width 0.15s ease;"></div>
                </div>
            </div>
            <div id="seg-modal-waveform-target" style="display: none; width: 100%;"></div>
        `;
    }

    if (segWavesurfer) {
        try { segWavesurfer.destroy(); } catch (e) {}
        segWavesurfer = null;
        segRegionsPlugin = null;
    }

    modal.style.display = 'flex';

    const audioUrl = `/uploads/${med.filename}`;
    
    segRegionsPlugin = WaveSurfer.Regions.create();

    segWavesurfer = WaveSurfer.create({
        container: '#seg-modal-waveform-target',
        waveColor: '#d7cbb9',
        progressColor: '#990F3D',
        height: 120,
        responsive: true,
        url: audioUrl,
        plugins: [segRegionsPlugin]
    });

    segWavesurfer.on('loading', (percent) => {
        const progEl = document.getElementById('seg-modal-loading-progress');
        if (progEl) progEl.innerText = `${percent}%`;
        const barFill = document.getElementById('seg-modal-loading-bar-fill');
        if (barFill) barFill.style.width = `${percent}%`;
    });

    segWavesurfer.on('decode', () => {
        const textEl = document.getElementById('seg-modal-loading-text');
        if (textEl) textEl.innerHTML = 'Decodificando forma de onda...';
    });

    segWavesurfer.on('error', (err) => {
        console.error('Error cargando audio en segWavesurfer:', err);
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 120px; color: #991b1b; background: #fee2e2; border: 1.5px solid #f87171; padding: 12px; border-radius: 4px; gap: 6px; font-size: 12px; text-align: center;">
                    <strong>⚠️ Error al procesar el archivo de audio</strong>
                    <span>No se pudo decodificar "${med.filename}". El navegador puede tener dificultades con archivos de alta frecuencia (como 96kHz PCM).</span>
                </div>
            `;
        }
    });

    segWavesurfer.on('ready', () => {
        const loadingEl = document.getElementById('seg-modal-loading');
        if (loadingEl) loadingEl.style.display = 'none';
        const targetEl = document.getElementById('seg-modal-waveform-target');
        if (targetEl) targetEl.style.display = 'block';
        const segments = med.segments || [];
        if (segments && segments.length > 0) {
            segRegionsPlugin.clearRegions();
            segments.forEach((seg, idx) => {
                const startTime = (seg.start_time !== undefined && seg.start_time !== null) ? seg.start_time : seg.start;
                const endTime = (seg.end_time !== undefined && seg.end_time !== null) ? seg.end_time : seg.end;
                const label = seg.text_content || seg.text || `Seg #${idx + 1}`;

                if (startTime !== undefined && endTime !== undefined) {
                    segRegionsPlugin.addRegion({
                        start: Number(startTime),
                        end: Number(endTime),
                        content: label,
                        color: 'rgba(153, 15, 61, 0.25)',
                        drag: true,
                        resize: true
                    });
                }
            });
            updateSegmentationCountBadge(segRegionsPlugin.getRegions().length);
        } else {
            triggerSilenceDetection();
        }
    });

    segRegionsPlugin.on('region-updated', () => {
        updateSegmentationCountBadge(segRegionsPlugin.getRegions().length);
    });

    segRegionsPlugin.on('region-created', (region) => {
        updateSegmentationCountBadge(segRegionsPlugin.getRegions().length);
        attachContextMenuToRegionV2(region);
    });

    segWavesurfer.on('play', () => {
        const btn = document.getElementById('seg-play-btn');
        if (btn) btn.innerHTML = '⏸ Pausa';
    });

    segWavesurfer.on('pause', () => {
        const btn = document.getElementById('seg-play-btn');
        if (btn) btn.innerHTML = '▶ Play / Pausa';
    });
}

function closeSegmentationModal() {
    const modal = document.getElementById('segmentation-modal');
    if (modal) modal.style.display = 'none';

    const playBtn = document.getElementById('seg-play-btn');
    if (playBtn) playBtn.innerHTML = '▶ Play / Pausa';

    if (segWavesurfer) {
        try {
            segWavesurfer.pause();
            segWavesurfer.destroy();
        } catch (e) {}
        segWavesurfer = null;
        segRegionsPlugin = null;
    }
}

function attachContextMenuToRegionV2(region) {
    if (!region) return;
    const bindEvent = () => {
        if (!region.element || region.element.dataset.hasContextMenu) return;
        region.element.dataset.hasContextMenu = "true";
        region.element.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showSegmentationRegionContextMenu(e, region);
        });
    };
    bindEvent();
    setTimeout(bindEvent, 0);
}

function showSegmentationRegionContextMenu(e, region) {
    let menu = document.getElementById('seg-region-context-menu');
    if (menu) menu.remove();

    menu = document.createElement('div');
    menu.id = 'seg-region-context-menu';
    menu.style.cssText = `
        position: fixed;
        left: ${e.clientX}px;
        top: ${e.clientY}px;
        background: #ffffff;
        border: 2.5px solid #1a1a1a;
        box-shadow: 4px 4px 0px #1a1a1a;
        z-index: 10000;
        padding: 4px 0;
        min-width: 160px;
        border-radius: 4px;
        font-family: inherit;
    `;

    const splitBtn = document.createElement('button');
    splitBtn.style.cssText = `
        width: 100%;
        text-align: left;
        background: none;
        border: none;
        padding: 8px 14px;
        font-weight: 700;
        font-family: inherit;
        cursor: pointer;
        font-size: 13px;
        color: #1a1a1a;
        display: flex;
        align-items: center;
        gap: 8px;
    `;
    splitBtn.onmouseenter = () => { splitBtn.style.background = '#f3f4f6'; };
    splitBtn.onmouseleave = () => { splitBtn.style.background = 'none'; };
    splitBtn.innerHTML = '<span>✂️</span> <span>Dividir segmento</span>';
    
    splitBtn.addEventListener('click', (evt) => {
        evt.stopPropagation();
        splitSegmentationRegionAtClick(e, region);
        menu.remove();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.style.cssText = `
        width: 100%;
        text-align: left;
        background: none;
        border: none;
        padding: 8px 14px;
        font-weight: 700;
        font-family: inherit;
        cursor: pointer;
        font-size: 13px;
        color: #d32f2f;
        display: flex;
        align-items: center;
        gap: 8px;
    `;
    deleteBtn.onmouseenter = () => { deleteBtn.style.background = '#fee2e2'; };
    deleteBtn.onmouseleave = () => { deleteBtn.style.background = 'none'; };
    deleteBtn.innerHTML = '<span>🗑️</span> <span>Eliminar segmento</span>';

    deleteBtn.addEventListener('click', (evt) => {
        evt.stopPropagation();
        deleteSegmentationRegion(region);
        menu.remove();
    });

    menu.appendChild(splitBtn);
    menu.appendChild(deleteBtn);
    document.body.appendChild(menu);

    const closeMenu = (evt) => {
        if (menu && !menu.contains(evt.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
            document.removeEventListener('contextmenu', closeMenu);
            document.removeEventListener('keydown', handleEsc);
        }
    };
    const handleEsc = (evt) => {
        if (evt.key === 'Escape') {
            menu.remove();
            document.removeEventListener('click', closeMenu);
            document.removeEventListener('contextmenu', closeMenu);
            document.removeEventListener('keydown', handleEsc);
        }
    };

    setTimeout(() => {
        document.addEventListener('click', closeMenu);
        document.addEventListener('contextmenu', closeMenu);
        document.addEventListener('keydown', handleEsc);
    }, 10);
}

function splitSegmentationRegionAtClick(e, region) {
    if (!segWavesurfer || !segRegionsPlugin) return;

    const wrapper = segWavesurfer.getWrapper();
    if (!wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const x = e.clientX - rect.left + wrapper.scrollLeft;
    const percentage = Math.max(0, Math.min(1, x / wrapper.scrollWidth));
    const splitTime = percentage * segWavesurfer.getDuration();

    if (splitTime <= region.start + 0.05 || splitTime >= region.end - 0.05) return;

    const origStart = region.start;
    const origEnd = region.end;
    const origContent = region.content || '';

    region.remove();

    segRegionsPlugin.addRegion({
        start: origStart,
        end: splitTime,
        content: origContent,
        color: 'rgba(153, 15, 61, 0.25)',
        drag: true,
        resize: true
    });

    segRegionsPlugin.addRegion({
        start: splitTime,
        end: origEnd,
        content: 'Nuevo Segmento',
        color: 'rgba(153, 15, 61, 0.25)',
        drag: true,
        resize: true
    });

    const allRegions = segRegionsPlugin.getRegions();
    allRegions.sort((a, b) => a.start - b.start);
    allRegions.forEach((r, idx) => {
        if (r.setOptions) {
            r.setOptions({ content: `Seg #${idx + 1}` });
        }
    });

    updateSegmentationCountBadge(allRegions.length);
}

function deleteSegmentationRegion(region) {
    if (!region) return;
    region.remove();
    if (segRegionsPlugin) {
        const allRegions = segRegionsPlugin.getRegions();
        allRegions.sort((a, b) => a.start - b.start);
        allRegions.forEach((r, idx) => {
            if (r.setOptions) {
                r.setOptions({ content: `Seg #${idx + 1}` });
            }
        });
        updateSegmentationCountBadge(allRegions.length);
    }
}

function updateSegmentationCountBadge(count) {
    const badge = document.getElementById('seg-modal-count-badge');
    if (badge) badge.innerText = `${count} Segmentos`;
}

async function triggerSilenceDetection() {
    if (!currentSegmentingMedia || !segWavesurfer || !segRegionsPlugin) return;

    const targetDuration = parseFloat(document.getElementById('seg-target-duration').value || '25');
    const minSilence = parseInt(document.getElementById('seg-min-silence').value || '500');
    const silenceThresh = parseInt(document.getElementById('seg-silence-thresh').value || '-20');

    try {
        const response = await fetch('/api/detect_segments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                audio_path: currentSegmentingMedia.filename,
                target_duration: targetDuration,
                min_silence_len: minSilence,
                silence_thresh: silenceThresh
            })
        });

        const data = await response.json();
        if (data.segments) {
            segRegionsPlugin.clearRegions();
            data.segments.forEach((seg, idx) => {
                segRegionsPlugin.addRegion({
                    start: seg.start,
                    end: seg.end,
                    content: `Seg #${idx + 1}`,
                    color: 'rgba(153, 15, 61, 0.25)',
                    drag: true,
                    resize: true
                });
            });
            updateSegmentationCountBadge(data.segments.length);
        } else {
            console.warn('Detección aviso: ', data.error);
        }
    } catch (err) {
        console.error('Error conectando a API detect_segments:', err);
    }
}

async function confirmAndSaveSegmentation() {
    if (!currentSegmentingMedia || !currentSegmentingChannel || !segRegionsPlugin) return;

    const regions = segRegionsPlugin.getRegions();
    if (regions.length === 0) {
        if (!confirm('No se crearon segmentos. ¿Deseas continuar de todos modos?')) return;
    }

    regions.sort((a, b) => a.start - b.start);

    const segmentsPayload = regions.map((r, idx) => ({
        json_segment_id: idx + 1,
        start: r.start,
        end: r.end,
        text: ''
    }));

    try {
        const response = await fetch(`/api/v2/media/${currentSegmentingMedia.id}/save_segments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                channel_id: currentSegmentingChannel.id,
                segments: segmentsPayload
            })
        });

        const data = await response.json();
        if (data.success) {
            closeSegmentationModal();
            refreshV2Data();
        } else {
            alert('Error al guardar la segmentación: ' + (data.error || ''));
        }
    } catch (err) {
        alert('Error en la solicitud: ' + err.message);
    }
}

async function updateSegmentOnServer(segmentId, updateFields) {
    await fetch('/api/v2/segment/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            segment_id: segmentId,
            ...updateFields
        })
    });
}

async function deleteMatch(matchId) {
    if (confirm('Delete this match group link?')) {
        await fetch(`/api/v2/match/${matchId}/delete`, { method: 'POST' });
        refreshV2Data();
    }
}

function updateBoundaryDisplays(startTime, endTime) {
    const s = Math.max(0, Number(startTime) || 0);
    const e = Math.max(s, Number(endTime) || 0);
    const d = Math.max(0, e - s);

    const sEl = document.getElementById('boundary-start-display');
    if (sEl) sEl.innerText = `${s.toFixed(3)}s`;

    const eEl = document.getElementById('boundary-end-display');
    if (eEl) eEl.innerText = `${e.toFixed(3)}s`;

    const dEl = document.getElementById('boundary-duration-display');
    if (dEl) dEl.innerText = `${d.toFixed(3)}s`;
}

function closeSegmentBoundaryModal() {
    const modal = document.getElementById('segment-boundary-modal');
    if (modal) modal.style.display = 'none';

    if (boundaryWaveSurfer) {
        try {
            boundaryWaveSurfer.pause();
            boundaryWaveSurfer.destroy();
        } catch (e) {}
        boundaryWaveSurfer = null;
        boundaryRegionsPlugin = null;
        currentBoundaryRegion = null;
    }

    currentBoundarySegment = null;
    currentBoundaryMedia = null;
    currentBoundaryChannel = null;
    isBoundaryRegionPlaying = false;
    currentBoundaryPrevSeg = null;
    currentBoundaryNextSeg = null;
    currentBoundaryPrevRegion = null;
    currentBoundaryNextRegion = null;
    isBoundaryPrevContiguous = false;
    isBoundaryNextContiguous = false;
    modifiedPrevEnd = null;
    modifiedNextStart = null;
}

function openSegmentBoundaryModal(seg, activeMedia, ch) {
    if (!seg || !activeMedia) return;

    currentBoundarySegment = seg;
    currentBoundaryMedia = activeMedia;
    currentBoundaryChannel = ch;
    isBoundaryRegionPlaying = false;

    // Pause any playing audio instances in the aligner
    if (alignerWaveSurferInstances && alignerWaveSurferInstances.length > 0) {
        alignerWaveSurferInstances.forEach(ws => {
            try {
                if (ws && typeof ws.isPlaying === 'function' && ws.isPlaying()) {
                    ws.pause();
                }
            } catch (e) {}
        });
    }

    const modal = document.getElementById('segment-boundary-modal');
    if (!modal) return;

    // Set header info
    const segBadge = document.getElementById('boundary-modal-seg-badge');
    if (segBadge) {
        segBadge.innerText = `SEG #${seg.json_segment_id || seg.id}`;
    }
    const filenameEl = document.getElementById('boundary-modal-filename');
    if (filenameEl) {
        filenameEl.innerText = activeMedia.filename || 'audio.mp3';
    }

    const segStart = (seg.start_time !== undefined && seg.start_time !== null) ? Number(seg.start_time) : 0;
    const segEnd = (seg.end_time !== undefined && seg.end_time !== null) ? Number(seg.end_time) : (segStart + 5);
    updateBoundaryDisplays(segStart, segEnd);

    // Contiguous segment detection (Snap / Contiguity)
    const allSegments = (activeMedia.segments || []).filter(s => 
        s.start_time !== undefined && s.start_time !== null &&
        s.end_time !== undefined && s.end_time !== null &&
        !isNaN(Number(s.start_time)) && !isNaN(Number(s.end_time))
    ).sort((a, b) => Number(a.start_time) - Number(b.start_time));

    const currentIndex = allSegments.findIndex(s => String(s.id) === String(seg.id));
    currentBoundaryPrevSeg = currentIndex > 0 ? allSegments[currentIndex - 1] : null;
    currentBoundaryNextSeg = (currentIndex >= 0 && currentIndex < allSegments.length - 1) ? allSegments[currentIndex + 1] : null;

    isBoundaryPrevContiguous = false;
    isBoundaryNextContiguous = false;
    modifiedPrevEnd = null;
    modifiedNextStart = null;

    if (currentBoundaryPrevSeg) {
        const prevEnd = Number(currentBoundaryPrevSeg.end_time);
        if (Math.abs(prevEnd - segStart) <= CONTIGUOUS_BOUNDARY_THRESHOLD_SEC) {
            isBoundaryPrevContiguous = true;
        }
    }

    if (currentBoundaryNextSeg) {
        const nextStart = Number(currentBoundaryNextSeg.start_time);
        if (Math.abs(nextStart - segEnd) <= CONTIGUOUS_BOUNDARY_THRESHOLD_SEC) {
            isBoundaryNextContiguous = true;
        }
    }

    const contigBadge = document.getElementById('boundary-contiguous-badge');
    if (contigBadge) {
        if (isBoundaryPrevContiguous || isBoundaryNextContiguous) {
            contigBadge.style.display = 'inline-flex';
            const details = [];
            if (isBoundaryPrevContiguous) details.push(`con #${currentBoundaryPrevSeg.json_segment_id || currentBoundaryPrevSeg.id}`);
            if (isBoundaryNextContiguous) details.push(`con #${currentBoundaryNextSeg.json_segment_id || currentBoundaryNextSeg.id}`);
            contigBadge.title = `Segmento contiguo ${details.join(' y ')} (umbral: ${CONTIGUOUS_BOUNDARY_THRESHOLD_MS}ms)`;
        } else {
            contigBadge.style.display = 'none';
        }
    }

    // Reset buttons
    const playSegBtn = document.getElementById('boundary-play-btn');
    if (playSegBtn) playSegBtn.innerHTML = '▶ Reproducir Segmento';
    const playAllBtn = document.getElementById('boundary-play-all-btn');
    if (playAllBtn) playAllBtn.innerHTML = '⏯ Reproducir Todo';

    // Show modal
    modal.style.display = 'flex';

    // Destroy existing wavesurfer if any
    if (boundaryWaveSurfer) {
        try {
            boundaryWaveSurfer.pause();
            boundaryWaveSurfer.destroy();
        } catch (e) {}
        boundaryWaveSurfer = null;
        boundaryRegionsPlugin = null;
        currentBoundaryRegion = null;
    }

    const container = document.getElementById('boundary-waveform-container');
    if (container) {
        container.innerHTML = `
            <div id="boundary-modal-loading" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 140px; color: var(--ft-ink-muted); gap: 8px;">
                <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 13px;">
                    <span class="waveform-loading-spinner"></span>
                    <span id="boundary-modal-loading-text">Cargando audio... <strong id="boundary-modal-loading-progress" style="color: var(--ft-claret);">0%</strong></span>
                </div>
                <div id="boundary-modal-loading-bar-bg" style="width: 220px; height: 6px; background: #e5e0d8; border-radius: 3px; overflow: hidden;">
                    <div id="boundary-modal-loading-bar-fill" style="width: 0%; height: 100%; background: var(--ft-claret); transition: width 0.15s ease;"></div>
                </div>
            </div>
            <div id="boundary-modal-waveform-target" style="display: none; width: 100%;"></div>
        `;
    }

    // Calculate zoom level to show segment + margin
    const segDuration = Math.max(0.1, segEnd - segStart);
    const margin = Math.max(1.5, segDuration * 0.25);
    const viewSpan = segDuration + (margin * 2);
    const wrapper = document.getElementById('boundary-waveform-wrapper');
    const wrapperWidth = (wrapper && wrapper.clientWidth > 100) ? wrapper.clientWidth : 850;

    let targetPxPerSec = Math.round(wrapperWidth / viewSpan);
    targetPxPerSec = Math.max(20, Math.min(350, targetPxPerSec));

    const zoomSlider = document.getElementById('boundary-zoom-slider');
    if (zoomSlider) zoomSlider.value = targetPxPerSec;
    const zoomVal = document.getElementById('boundary-zoom-value');
    if (zoomVal) zoomVal.innerText = `${targetPxPerSec} px/s`;

    // Create Wavesurfer & Regions
    boundaryRegionsPlugin = WaveSurfer.Regions.create();
    const audioUrl = `/uploads/${activeMedia.filename}`;

    boundaryWaveSurfer = WaveSurfer.create({
        container: '#boundary-modal-waveform-target',
        waveColor: '#d7cbb9',
        progressColor: '#990F3D',
        height: 140,
        minPxPerSec: targetPxPerSec,
        autoCenter: false,
        autoScroll: true,
        url: audioUrl,
        plugins: [boundaryRegionsPlugin]
    });

    boundaryWaveSurfer.on('loading', (percent) => {
        const progEl = document.getElementById('boundary-modal-loading-progress');
        if (progEl) progEl.innerText = `${percent}%`;
        const barFill = document.getElementById('boundary-modal-loading-bar-fill');
        if (barFill) barFill.style.width = `${percent}%`;
    });

    boundaryWaveSurfer.on('decode', () => {
        const textEl = document.getElementById('boundary-modal-loading-text');
        if (textEl) textEl.innerHTML = 'Decodificando forma de onda...';
    });

    boundaryWaveSurfer.on('error', (err) => {
        console.error('Error cargando audio en boundaryWaveSurfer:', err);
        const container = document.getElementById('boundary-waveform-container');
        if (container) {
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 140px; color: #991b1b; background: #fee2e2; border: 1.5px solid #f87171; padding: 12px; border-radius: 4px; gap: 6px; font-size: 12px; text-align: center;">
                    <strong>⚠️ Error al procesar el archivo de audio</strong>
                    <span>No se pudo decodificar "${activeMedia.filename}". El navegador puede tener dificultades con archivos de alta frecuencia (como 96kHz PCM).</span>
                </div>
            `;
        }
    });

    boundaryWaveSurfer.on('ready', () => {
        const loadingEl = document.getElementById('boundary-modal-loading');
        if (loadingEl) loadingEl.style.display = 'none';
        const targetEl = document.getElementById('boundary-modal-waveform-target');
        if (targetEl) targetEl.style.display = 'block';
        try {
            boundaryWaveSurfer.zoom(targetPxPerSec);
        } catch (e) {}

        // Set playhead at start of segment
        try {
            boundaryWaveSurfer.setTime(segStart);
        } catch (e) {}

        boundaryRegionsPlugin.clearRegions();
        currentBoundaryPrevRegion = null;
        currentBoundaryNextRegion = null;

        // 1. Add other segments as context (light, non-draggable/non-resizable)
        allSegments.forEach((s) => {
            if (String(s.id) === String(seg.id)) return;
            const sStart = Number(s.start_time);
            const sEnd = Number(s.end_time);
            if (isFinite(sStart) && isFinite(sEnd) && sEnd > sStart) {
                const isContigPrev = isBoundaryPrevContiguous && currentBoundaryPrevSeg && String(s.id) === String(currentBoundaryPrevSeg.id);
                const isContigNext = isBoundaryNextContiguous && currentBoundaryNextSeg && String(s.id) === String(currentBoundaryNextSeg.id);

                let regColor = 'rgba(120, 110, 100, 0.12)';
                let regContent = `Seg #${s.json_segment_id || s.id}`;

                if (isContigPrev || isContigNext) {
                    regColor = 'rgba(13, 148, 136, 0.18)'; // Teal tint to highlight contiguous neighbor
                    regContent = `🔗 #${s.json_segment_id || s.id}`;
                }

                const reg = boundaryRegionsPlugin.addRegion({
                    id: `boundary-context-seg-${s.id}`,
                    start: sStart,
                    end: sEnd,
                    content: regContent,
                    color: regColor,
                    drag: false,
                    resize: false
                });

                if (reg && reg.element) {
                    // Prevent context regions from blocking mouse events/handles of the target segment
                    reg.element.style.pointerEvents = 'none';
                }

                if (isContigPrev) currentBoundaryPrevRegion = reg;
                if (isContigNext) currentBoundaryNextRegion = reg;
            }
        });

        // 2. Add current target segment (editable, prominent claret color)
        currentBoundaryRegion = boundaryRegionsPlugin.addRegion({
            id: `boundary-edit-seg-${seg.id}`,
            start: segStart,
            end: segEnd,
            content: `SEG #${seg.json_segment_id || seg.id}`,
            color: 'rgba(153, 15, 61, 0.35)',
            drag: true,
            resize: true
        });

        if (currentBoundaryRegion && currentBoundaryRegion.element) {
            currentBoundaryRegion.element.style.zIndex = '20';
        }

        currentBoundaryRegion.on('update', () => {
            updateBoundaryDisplays(currentBoundaryRegion.start, currentBoundaryRegion.end);
            syncContiguousBoundaries();
        });
        currentBoundaryRegion.on('update-end', () => {
            updateBoundaryDisplays(currentBoundaryRegion.start, currentBoundaryRegion.end);
            syncContiguousBoundaries();
        });

        // Center waveform viewport directly on the segment
        centerBoundaryWaveformOnSegment(targetPxPerSec);
        requestAnimationFrame(() => {
            centerBoundaryWaveformOnSegment(targetPxPerSec);
        });
        setTimeout(() => {
            centerBoundaryWaveformOnSegment(targetPxPerSec);
        }, 50);
        setTimeout(() => {
            centerBoundaryWaveformOnSegment(targetPxPerSec);
        }, 150);
        setTimeout(() => {
            centerBoundaryWaveformOnSegment(targetPxPerSec);
        }, 300);
    });

    boundaryRegionsPlugin.on('region-updated', (reg) => {
        if (currentBoundaryRegion && reg.id === currentBoundaryRegion.id) {
            updateBoundaryDisplays(reg.start, reg.end);
            syncContiguousBoundaries();
        }
    });

    boundaryWaveSurfer.on('timeupdate', (currentTime) => {
        if (isBoundaryRegionPlaying && currentBoundaryRegion) {
            if (currentTime >= currentBoundaryRegion.end) {
                boundaryWaveSurfer.pause();
                isBoundaryRegionPlaying = false;
                const playBtn = document.getElementById('boundary-play-btn');
                if (playBtn) playBtn.innerHTML = '▶ Reproducir Segmento';
            }
        }
    });

    boundaryWaveSurfer.on('pause', () => {
        isBoundaryRegionPlaying = false;
        const playBtn = document.getElementById('boundary-play-btn');
        if (playBtn) playBtn.innerHTML = '▶ Reproducir Segmento';
        const playAllBtn = document.getElementById('boundary-play-all-btn');
        if (playAllBtn) playAllBtn.innerHTML = '⏯ Reproducir Todo';
    });

    boundaryWaveSurfer.on('finish', () => {
        isBoundaryRegionPlaying = false;
        const playBtn = document.getElementById('boundary-play-btn');
        if (playBtn) playBtn.innerHTML = '▶ Reproducir Segmento';
        const playAllBtn = document.getElementById('boundary-play-all-btn');
        if (playAllBtn) playAllBtn.innerHTML = '⏯ Reproducir Todo';
    });
}


async function refreshV2Data() {
    const res = await fetch(`/api/v2/project/${v2ProjectId}`);
    const data = await res.json();
    if (data.project && data.project.v2_data) {
        projectV2Data = data.project.v2_data;
        initV2Editor();

        const alignerView = document.getElementById('v2-aligner-view');
        if (alignerView && alignerView.style.display !== 'none') {
            renderAlignerContainer();
        }
    }
}

function getBadgeColor(type) {
    if (type === 'audio') return 'var(--accent-secondary)';
    if (type === 'transcript') return 'var(--accent-tertiary)';
    return 'var(--accent-color)';
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* Alignment View ("Alinear") Logic */
let selectedAlignerMedia = {};

function getSegmentMatchStatus(segId) {
    if (!projectV2Data || !projectV2Data.matches) return 'none';
    const totalChannelsCount = (projectV2Data.channels || []).length;
    
    const matchingGroups = projectV2Data.matches.filter(m => 
        m.items && m.items.some(it => String(it.segment_id) === String(segId))
    );

    if (matchingGroups.length === 0) return 'none';

    let maxMatchedChannels = 0;
    matchingGroups.forEach(m => {
        const uniqueChannels = new Set(m.items.map(it => it.channel_id)).size;
        if (uniqueChannels > maxMatchedChannels) {
            maxMatchedChannels = uniqueChannels;
        }
    });

    if (maxMatchedChannels >= totalChannelsCount && totalChannelsCount > 1) {
        return 'all';
    } else if (maxMatchedChannels > 1) {
        return 'partial';
    } else {
        return 'none';
    }
}

let alignerWaveSurferInstances = [];
let selectedAlignerSegments = {};

function destroyAlignerWaveSurfers() {
    alignerWaveSurferInstances.forEach(ws => {
        try {
            if (ws) {
                ws.pause();
                ws.destroy();
            }
        } catch (e) {}
    });
    alignerWaveSurferInstances = [];
}

function updateAlignerSelectionUI() {
    const channels = projectV2Data.channels || [];
    const totalChannels = channels.length;
    const selectedCount = Object.keys(selectedAlignerSegments).length;

    const alignBtn = document.getElementById('v2-do-align-btn');
    if (alignBtn) {
        alignBtn.innerText = `🔗 Alinear (${selectedCount}/${totalChannels})`;
        if (selectedCount === totalChannels && totalChannels > 0) {
            alignBtn.disabled = false;
            alignBtn.style.opacity = '1';
            alignBtn.style.cursor = 'pointer';
        } else {
            alignBtn.disabled = true;
            alignBtn.style.opacity = '0.5';
            alignBtn.style.cursor = 'not-allowed';
        }
    }

    document.querySelectorAll('.aligner-segment-card').forEach(card => {
        const segId = card.getAttribute('data-segment-id');
        const chId = card.getAttribute('data-channel-id');
        const radio = card.querySelector('.aligner-seg-radio');

        const isSelected = selectedAlignerSegments[chId] && String(selectedAlignerSegments[chId]) === String(segId);

        if (isSelected) {
            card.classList.add('selected-segment-card');
            if (radio) radio.checked = true;
        } else {
            card.classList.remove('selected-segment-card');
            if (radio) radio.checked = false;
        }
    });
}

function selectAlignerSegment(channelId, segId) {
    if (selectedAlignerSegments[channelId] && String(selectedAlignerSegments[channelId]) === String(segId)) {
        delete selectedAlignerSegments[channelId];
    } else {
        selectedAlignerSegments[channelId] = segId;

        const matchGroups = (projectV2Data.matches || []).filter(m => 
            (m.items || []).some(item => String(item.segment_id) === String(segId))
        );

        matchGroups.forEach(m => {
            (m.items || []).forEach(item => {
                if (item.channel_id && item.segment_id) {
                    selectedAlignerSegments[item.channel_id] = item.segment_id;
                }
            });
        });
    }

    updateAlignerSelectionUI();
}

function buildAlignerRows(channels, activeMediaByChannel, projectV2Data) {
    const totalChannelsCount = channels.length;
    const matches = projectV2Data.matches || [];

    const segMatchMap = {};
    matches.forEach(m => {
        (m.items || []).forEach(it => {
            if (it.segment_id) {
                const sId = String(it.segment_id);
                if (!segMatchMap[sId]) segMatchMap[sId] = [];
                segMatchMap[sId].push(m);
            }
        });
    });

    function getMatchChannelCount(matchGroup) {
        const activeChs = new Set();
        (matchGroup.items || []).forEach(it => {
            if (it.channel_id && activeMediaByChannel[it.channel_id]) {
                const mediaSegs = activeMediaByChannel[it.channel_id].segments || [];
                if (mediaSegs.some(s => String(s.id) === String(it.segment_id))) {
                    activeChs.add(String(it.channel_id));
                }
            }
        });
        return activeChs.size;
    }

    const assignedSegIds = new Set();
    const totalMatchRows = [];

    // 1. Total Match Groups (all N channels matched) -> Group at top of grid
    matches.forEach(matchGroup => {
        const chCount = getMatchChannelCount(matchGroup);
        if (chCount >= totalChannelsCount && totalChannelsCount > 1) {
            const rowSegments = {};
            let hasSeg = false;

            (matchGroup.items || []).forEach(item => {
                const chData = activeMediaByChannel[item.channel_id];
                if (chData && chData.segments) {
                    const seg = chData.segments.find(s => String(s.id) === String(item.segment_id));
                    if (seg && !assignedSegIds.has(seg.id)) {
                        rowSegments[item.channel_id] = {
                            segment: seg,
                            channel: channels.find(c => String(c.id) === String(item.channel_id)),
                            activeMedia: chData.media
                        };
                        assignedSegIds.add(seg.id);
                        hasSeg = true;
                    }
                }
            });

            if (hasSeg) {
                totalMatchRows.push(rowSegments);
            }
        }
    });

    totalMatchRows.sort((rA, rB) => {
        const segA = Object.values(rA)[0]?.segment;
        const segB = Object.values(rB)[0]?.segment;
        const timeA = segA ? (segA.start_time !== undefined && segA.start_time !== null ? segA.start_time : (segA.json_segment_id || 0)) : 0;
        const timeB = segB ? (segB.start_time !== undefined && segB.start_time !== null ? segB.start_time : (segB.json_segment_id || 0)) : 0;
        return timeA - timeB;
    });

    // 2. Remaining unassigned segments per channel in original sequence order
    const remainingByChannel = {};
    channels.forEach(ch => {
        const chData = activeMediaByChannel[ch.id];
        const segs = chData ? chData.segments : [];
        remainingByChannel[ch.id] = segs.filter(s => !assignedSegIds.has(s.id));
    });

    const remainingRows = [];

    // 3. Build sequential rows for partial matches and unassigned segments
    while (channels.some(ch => remainingByChannel[ch.id].length > 0)) {
        const rowSegments = {};

        let targetMatchGroup = null;
        for (const ch of channels) {
            const headSeg = remainingByChannel[ch.id][0];
            if (headSeg) {
                const matchingGroups = segMatchMap[String(headSeg.id)] || [];
                if (matchingGroups.length > 0) {
                    targetMatchGroup = matchingGroups[0];
                    break;
                }
            }
        }

        if (targetMatchGroup) {
            (targetMatchGroup.items || []).forEach(item => {
                const chData = activeMediaByChannel[item.channel_id];
                if (chData && chData.segments && remainingByChannel[item.channel_id]) {
                    const segIdx = remainingByChannel[item.channel_id].findIndex(s => String(s.id) === String(item.segment_id));
                    if (segIdx !== -1) {
                        const [seg] = remainingByChannel[item.channel_id].splice(segIdx, 1);
                        rowSegments[item.channel_id] = {
                            segment: seg,
                            channel: channels.find(c => String(c.id) === String(item.channel_id)),
                            activeMedia: chData.media
                        };
                        assignedSegIds.add(seg.id);
                    }
                }
            });

            channels.forEach(ch => {
                if (!rowSegments[ch.id] && remainingByChannel[ch.id].length > 0) {
                    const headSeg = remainingByChannel[ch.id][0];
                    const headMatches = segMatchMap[String(headSeg.id)] || [];
                    const isMatchedToOther = headMatches.some(m => 
                        (m.items || []).some(it => String(it.channel_id) !== String(ch.id) && !rowSegments[it.channel_id])
                    );

                    if (!isMatchedToOther) {
                        const seg = remainingByChannel[ch.id].shift();
                        rowSegments[ch.id] = {
                            segment: seg,
                            channel: ch,
                            activeMedia: activeMediaByChannel[ch.id]?.media
                        };
                        assignedSegIds.add(seg.id);
                    }
                }
            });
        } else {
            channels.forEach(ch => {
                if (remainingByChannel[ch.id].length > 0) {
                    const seg = remainingByChannel[ch.id].shift();
                    rowSegments[ch.id] = {
                        segment: seg,
                        channel: ch,
                        activeMedia: activeMediaByChannel[ch.id]?.media
                    };
                    assignedSegIds.add(seg.id);
                }
            });
        }

        if (Object.keys(rowSegments).length === 0) {
            channels.forEach(ch => {
                if (remainingByChannel[ch.id].length > 0) {
                    const seg = remainingByChannel[ch.id].shift();
                    rowSegments[ch.id] = {
                        segment: seg,
                        channel: ch,
                        activeMedia: activeMediaByChannel[ch.id]?.media
                    };
                    assignedSegIds.add(seg.id);
                }
            });
        }

        remainingRows.push(rowSegments);
    }

    return [...totalMatchRows, ...remainingRows];
}

function renderAlignerContainer() {
    destroyAlignerWaveSurfers();

    const container = document.getElementById('v2-aligner-columns-container');
    if (!container) return;
    container.innerHTML = '';

    const channels = projectV2Data.channels || [];
    if (channels.length === 0) {
        container.innerHTML = `
            <div class="ft-card" style="width: 100%; text-align: center; padding: 40px; background: white;">
                <h3 style="margin-top: 0; font-family: var(--font-serif);">📭 No hay canales definidos</h3>
            </div>
        `;
        updateAlignerSelectionUI();
        return;
    }

    container.style.gridTemplateColumns = `repeat(${channels.length}, minmax(280px, 1fr))`;

    // 1. Render Header Cells
    channels.forEach(ch => {
        const header = document.createElement('div');
        header.className = 'aligner-channel-header';

        const titleRow = document.createElement('div');
        titleRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';

        const badgeClass = ch.type === 'audio' ? 'claret' : 'teal';
        titleRow.innerHTML = `
            <span class="ft-badge ${badgeClass}">${escapeHtml(ch.type || 'canal')}</span>
            <strong style="font-family: var(--font-serif); font-size: 15px; color: var(--ft-ink);">${escapeHtml(ch.name)}</strong>
        `;
        header.appendChild(titleRow);

        const mediaList = ch.media || [];
        const mediaSelect = document.createElement('select');
        mediaSelect.className = 'aligner-media-select ft-input';
        mediaSelect.style.cssText = 'padding: 6px 10px; font-size: 12px; font-weight: 700; background: white; cursor: pointer; border: 1px solid var(--ft-border); width: 100%;';

        if (mediaList.length === 0) {
            mediaSelect.innerHTML = `<option value="">- Sin media -</option>`;
        } else {
            if (!selectedAlignerMedia[ch.id] && mediaList.length > 0) {
                selectedAlignerMedia[ch.id] = mediaList[0].id;
            }

            mediaSelect.innerHTML = mediaList.map(med => {
                const isSel = String(med.id) === String(selectedAlignerMedia[ch.id]) ? 'selected' : '';
                return `<option value="${med.id}" ${isSel}>🎵/📄 ${escapeHtml(med.filename)}</option>`;
            }).join('');
        }

        mediaSelect.addEventListener('change', (e) => {
            selectedAlignerMedia[ch.id] = e.target.value;
            renderAlignerContainer();
        });

        header.appendChild(mediaSelect);
        container.appendChild(header);
    });

    // 2. Active Media map
    const activeMediaByChannel = {};
    channels.forEach(ch => {
        const mediaList = ch.media || [];
        const activeMedia = mediaList.find(m => String(m.id) === String(selectedAlignerMedia[ch.id]));
        activeMediaByChannel[ch.id] = {
            media: activeMedia,
            segments: (activeMedia && activeMedia.segments) ? activeMedia.segments : []
        };
    });

    // 3. Build Aligned Rows (Total matches at top, partial & unassigned aligned horizontally by row height)
    const rows = buildAlignerRows(channels, activeMediaByChannel, projectV2Data);

    if (rows.length === 0) {
        const emptyNotice = document.createElement('div');
        emptyNotice.style.gridColumn = `1 / -1`;
        emptyNotice.style.cssText = 'text-align: center; padding: 40px; color: var(--ft-ink-muted); font-size: 13px; font-family: var(--font-serif);';
        emptyNotice.innerHTML = '📭 No hay segmentos disponibles para la media seleccionada en los canales.';
        container.appendChild(emptyNotice);
        updateAlignerSelectionUI();
        return;
    }

    // 4. Render Grid Cells
    rows.forEach((rowSegments, rIdx) => {
        channels.forEach(ch => {
            const cellData = rowSegments[ch.id];
            const cell = document.createElement('div');
            cell.className = 'aligner-row-cell';

            if (!cellData || !cellData.segment) {
                cell.innerHTML = `<div class="aligner-empty-cell">- Sin Segmento -</div>`;
            } else {
                const seg = cellData.segment;
                const activeMedia = cellData.activeMedia;
                const status = getSegmentMatchStatus(seg.id);
                const radioName = `aligner-ch-${ch.id}`;
                const isSelected = selectedAlignerSegments[ch.id] && String(selectedAlignerSegments[ch.id]) === String(seg.id);

                if (ch.type === 'audio') {
                    const card = document.createElement('div');
                    card.className = `aligner-segment-card status-${status}`;
                    card.setAttribute('data-segment-id', seg.id);
                    card.setAttribute('data-channel-id', ch.id);

                    let statusBadgeText = 'Sin Match';
                    let statusBadgeStyle = 'background: #fee2e2; color: #991b1b;';
                    if (status === 'all') {
                        statusBadgeText = 'Match Total';
                        statusBadgeStyle = 'background: #dcfce7; color: #166534;';
                    } else if (status === 'partial') {
                        statusBadgeText = 'Match Parcial';
                        statusBadgeStyle = 'background: #fef9c3; color: #854d0e;';
                    }

                    const segHeader = document.createElement('div');
                    segHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; gap: 8px;';
                    if (isSelected) card.classList.add('selected-segment-card');

                    segHeader.innerHTML = `
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <input type="radio" class="aligner-seg-radio" name="${radioName}" value="${seg.id}" ${isSelected ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px; accent-color: var(--ft-claret);">
                            <span class="ft-badge" style="font-size: 10px; background: white; border: 1px solid var(--ft-border);">SEG #${seg.json_segment_id || (rIdx + 1)}</span>
                        </div>
                        <span style="font-size: 10px; font-weight: 800; padding: 2px 6px; text-transform: uppercase; ${statusBadgeStyle}">${statusBadgeText}</span>
                    `;
                    card.appendChild(segHeader);

                    card.addEventListener('click', (e) => {
                        if (e.target.closest('.play-aligner-wave-btn') || e.target.closest('.aligner-wave-box')) {
                            return;
                        }
                        selectAlignerSegment(ch.id, seg.id);
                    });

                    const waveBox = document.createElement('div');
                    waveBox.className = 'aligner-wave-box';
                    waveBox.title = 'Haz clic para ver la onda completa y ajustar los límites del segmento';
                    
                    const waveId = `aligner-wave-${seg.id}`;
                    const startTimeVal = (seg.start_time !== undefined && seg.start_time !== null) ? Number(seg.start_time) : 0;
                    const endTimeVal = (seg.end_time !== undefined && seg.end_time !== null) ? Number(seg.end_time) : 0;
                    const segDuration = Math.max(0, endTimeVal - startTimeVal);

                    waveBox.innerHTML = `
                        <div id="${waveId}" style="min-height: 40px; margin-bottom: 6px; cursor: pointer;"></div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <button type="button" class="ft-button secondary play-aligner-wave-btn" style="padding: 2px 8px; font-size: 11px;">▶ Play / Pausa</button>
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <span style="font-size: 10px; font-weight: 700; color: var(--ft-ink-muted);">⏱️ ${startTimeVal.toFixed(1)}s - ${endTimeVal.toFixed(1)}s (${segDuration.toFixed(1)}s)</span>
                                <span style="font-size: 11px; cursor: pointer;" title="Ajustar límites">✂️</span>
                            </div>
                        </div>
                    `;
                    card.appendChild(waveBox);

                    waveBox.addEventListener('click', (e) => {
                        if (e.target.closest('.play-aligner-wave-btn')) {
                            return;
                        }
                        e.stopPropagation();
                        openSegmentBoundaryModal(seg, activeMedia, ch);
                    });

                    setTimeout(() => {
                        try {
                            const segmentAudioUrl = `/api/get_segment_audio?path=${encodeURIComponent(activeMedia.filename)}&start=${startTimeVal}&end=${endTimeVal}`;
                            const ws = WaveSurfer.create({
                                container: `#${waveId}`,
                                waveColor: '#d7cbb9',
                                progressColor: '#990F3D',
                                height: 40,
                                responsive: true,
                                url: segmentAudioUrl
                            });

                            alignerWaveSurferInstances.push(ws);

                            const btn = waveBox.querySelector('.play-aligner-wave-btn');
                            if (btn) {
                                btn.onclick = (e) => {
                                    e.stopPropagation();
                                    if (ws) {
                                        alignerWaveSurferInstances.forEach(otherWs => {
                                            if (otherWs !== ws && typeof otherWs.isPlaying === 'function' && otherWs.isPlaying()) {
                                                otherWs.pause();
                                            }
                                        });
                                        ws.playPause();
                                    }
                                };
                            }

                            ws.on('play', () => {
                                if (btn) btn.innerHTML = '⏸ Pausa';
                            });
                            ws.on('pause', () => {
                                if (btn) btn.innerHTML = '▶ Play / Pausa';
                            });
                            ws.on('finish', () => {
                                if (btn) btn.innerHTML = '▶ Play / Pausa';
                            });
                        } catch (e) {
                            console.error('WaveSurfer mini error:', e);
                        }
                    }, 50);

                    cell.appendChild(card);
                } else {
                    const actualCh = cellData.channel || ch;
                    const card = buildTextSegmentCard(seg, actualCh, {
                        index: rIdx + 1,
                        showRadio: true,
                        radioName: radioName,
                        isSelected: isSelected,
                        showTimestamps: false,
                        onSelect: (e, segment) => {
                            selectAlignerSegment(actualCh.id, segment.id);
                        }
                    });
                    cell.appendChild(card);
                }
            }

            container.appendChild(cell);
        });
    });

    updateAlignerSelectionUI();
}
