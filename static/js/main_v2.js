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
        document.getElementById('add-media-channel-info').innerHTML = `Agregando nuevo slot de media al canal <strong>${escapeHtml(ch.name)}</strong> (${ch.type}).`;
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
                    cell.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                            <span class="slot-status-badge ${slotStatus.badgeClass}">${slotStatus.label}</span>
                            <span style="font-size: 10px; font-weight: 700; color: var(--ft-ink-muted); text-transform: uppercase;">${typeLabel} (${segCount})</span>
                        </div>
                        <div class="slot-cell-filename" title="${escapeHtml(med.filename)}" style="font-weight: 700; font-size: 13px; color: var(--ft-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${icon} ${escapeHtml(med.filename)}
                        </div>
                    `;
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
            if (seg.start_time !== None && seg.end_time !== None) {
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
            const currentTime = segWavesurfer.getCurrentTime() || 0;
            const duration = segWavesurfer.getDuration() || (currentTime + 10);
            const start = currentTime;
            const end = Math.min(currentTime + 5, duration);
            const count = segRegionsPlugin.getRegions().length + 1;
            segRegionsPlugin.addRegion({
                start: start,
                end: end,
                content: `Seg #${count}`,
                color: 'rgba(153, 15, 61, 0.25)',
                drag: true,
                resize: true
            });
            updateSegmentationCountBadge(segRegionsPlugin.getRegions().length);
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

    window.addEventListener('click', (e) => {
        const audioModal = document.getElementById('audio-player-modal');
        if (e.target === audioModal) closeAudioPlayerModal();
        const segModal = document.getElementById('segmentation-modal');
        if (e.target === segModal) closeSegmentationModal();
        const textModal = document.getElementById('add-text-media-modal');
        if (e.target === textModal) textModal.style.display = 'none';
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
            segBtn.innerHTML = '<span class="icon">👁️</span> Ver / Editar segmentación';
        } else {
            segBtn.innerHTML = '<span class="icon">✂️</span> Segmentar Audio';
        }
    }

    const containerId = 'audio-modal-waveform-container';
    const container = document.getElementById(containerId);
    if (container) container.innerHTML = '';

    if (modalWavesurfer) {
        try { modalWavesurfer.destroy(); } catch (e) {}
        modalWavesurfer = null;
    }

    modal.style.display = 'flex';

    const audioUrl = `/uploads/${med.filename}`;
    modalWavesurfer = WaveSurfer.create({
        container: `#${containerId}`,
        waveColor: '#d7cbb9',
        progressColor: '#990F3D',
        height: 100,
        responsive: true,
        url: audioUrl
    });

    const playBtn = document.getElementById('audio-modal-play-btn');
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
    if (container) container.innerHTML = '';

    if (segWavesurfer) {
        try { segWavesurfer.destroy(); } catch (e) {}
        segWavesurfer = null;
        segRegionsPlugin = null;
    }

    modal.style.display = 'flex';

    const audioUrl = `/uploads/${med.filename}`;
    
    segRegionsPlugin = WaveSurfer.Regions.create();

    segWavesurfer = WaveSurfer.create({
        container: `#${containerId}`,
        waveColor: '#d7cbb9',
        progressColor: '#990F3D',
        height: 120,
        responsive: true,
        url: audioUrl,
        plugins: [segRegionsPlugin]
    });

    segWavesurfer.on('ready', () => {
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

    segRegionsPlugin.on('region-created', () => {
        updateSegmentationCountBadge(segRegionsPlugin.getRegions().length);
    });
}

function closeSegmentationModal() {
    const modal = document.getElementById('segmentation-modal');
    if (modal) modal.style.display = 'none';

    if (segWavesurfer) {
        try {
            segWavesurfer.pause();
            segWavesurfer.destroy();
        } catch (e) {}
        segWavesurfer = null;
        segRegionsPlugin = null;
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

async function refreshV2Data() {
    const res = await fetch(`/api/v2/project/${v2ProjectId}`);
    const data = await res.json();
    if (data.project && data.project.v2_data) {
        projectV2Data = data.project.v2_data;
        initV2Editor();
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

                const radioName = `aligner-ch-${ch.id}`;
                const isSelected = selectedAlignerSegments[ch.id] && String(selectedAlignerSegments[ch.id]) === String(seg.id);
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
                    if (e.target.closest('.play-aligner-wave-btn') || e.target.closest('[id^="aligner-wave-"]')) {
                        return;
                    }
                    selectAlignerSegment(ch.id, seg.id);
                });

                if (ch.type === 'audio') {
                    const waveBox = document.createElement('div');
                    waveBox.style.cssText = 'background: white; border: 1px solid var(--ft-border); padding: 8px; margin-top: 4px;';
                    
                    const waveId = `aligner-wave-${seg.id}`;
                    const startTimeVal = (seg.start_time !== undefined && seg.start_time !== null) ? Number(seg.start_time) : 0;
                    const endTimeVal = (seg.end_time !== undefined && seg.end_time !== null) ? Number(seg.end_time) : 0;
                    const segDuration = Math.max(0, endTimeVal - startTimeVal);

                    waveBox.innerHTML = `
                        <div id="${waveId}" style="min-height: 40px; margin-bottom: 6px;"></div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <button type="button" class="ft-button secondary play-aligner-wave-btn" style="padding: 2px 8px; font-size: 11px;">▶ Play / Pausa</button>
                            <span style="font-size: 10px; font-weight: 700; color: var(--ft-ink-muted);">⏱️ ${startTimeVal.toFixed(1)}s - ${endTimeVal.toFixed(1)}s (${segDuration.toFixed(1)}s)</span>
                        </div>
                    `;
                    card.appendChild(waveBox);

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
                } else {
                    const textContentDiv = document.createElement('div');
                    textContentDiv.style.cssText = 'font-size: 13px; color: var(--ft-ink); line-height: 1.4; background: white; padding: 8px; border: 1px solid var(--ft-border); word-break: break-word;';
                    textContentDiv.innerText = seg.text_content || seg.text || 'Sin texto';
                    card.appendChild(textContentDiv);
                }

                cell.appendChild(card);
            }

            container.appendChild(cell);
        });
    });

    updateAlignerSelectionUI();
}
