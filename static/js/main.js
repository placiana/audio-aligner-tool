let wsFull, wsSegment;
let regions;
let currentState = initialState || {
    audio_path: config ? config.audio_path : '',
    text_path: config ? config.text_path : '',
    segments: [],
    current_idx: 0,
    stage: 1
};

let currentSpeed = 1;
let previewAudio = null;
let currentPlayingBtn = null;
let currentLang = localStorage.getItem('aligner_lang') || 'en';

const translations = {
    en: {
        title: "Audio Aligner",
        welcome_title: "Select an audio to process",
        download_db: "📥 Download Consolidated Database (JSON)",
        segments_aligned: "segments aligned",
        open_btn: "Open",
        back_to_list: "Back to List",
        reset_btn: "Reset",
        save_btn: "Save",
        stage1_title: "Stage 1: Segmentation",
        file_label: "File:",
        duration_label: "Duration:",
        target_duration: "Target (s):",
        detect_btn: "Detect Segments",
        confirm_btn: "Confirm & Align",
        current_segment_title: "Current Segment",
        play_pause: "Play/Pause",
        seg_label: "Seg.",
        prev_btn: "Previous",
        next_btn: "Next",
        transcription_title: "Transcription",
        show_alignments: "View Alignments",
        alignments_modal_title: "Created Alignments",
        completion_title: "🎉 AUDIO ALIGNED SUCCESSFULLY!",
        completion_congrats: "Excellent work! You have completed the alignment of this audio.",
        completion_instructions: "Review each aligned segment below, listen to the previews to verify synchronization, or return to the list to process a new file.",
        completion_home: "🏠 Return to Main List",
        completion_review: "🔍 Return to Editor",
        completion_preview_title: "Alignments Preview",
        no_alignments_yet: "No aligned segments yet. Start aligning the transcription!",
        listen_btn: "▶ Listen",
        pause_btn: "⏸ Pause",
        jump_btn: "Go to segment",
        correct_btn: "Edit",
        remaining_text: "Remaining Text",
        reset_confirm: "Are you sure you want to go back to segmentation? All text assigned to the current segments will be lost.",
        select_text_alert: "Please select the text corresponding to this segment in the panel above with your mouse.",
        this_seg_badge: "This Seg.",
        seg_badge_prefix: "Seg. ",
        assign_highlight_btn: "Assign Highlight (Ctrl + Enter)",
        next_seg_btn: "Next Segment (Ctrl + Enter)",
        select_and_assign_btn: "Select text above and assign"
    },
    es: {
        title: "Audio Aligner",
        welcome_title: "Selecciona un audio para procesar",
        download_db: "📥 Descargar Base de Datos Consolidada (JSON)",
        segments_aligned: "segmentos alineados",
        open_btn: "Abrir",
        back_to_list: "Volver al listado",
        reset_btn: "Reiniciar",
        save_btn: "Guardar",
        stage1_title: "Fase 1: Segmentación",
        file_label: "Archivo:",
        duration_label: "Duración:",
        target_duration: "Duración obj. (s):",
        detect_btn: "Detectar Segmentos",
        confirm_btn: "Confirmar y Alinear",
        current_segment_title: "Segmento Actual",
        play_pause: "Reproducir/Pausa",
        seg_label: "Seg.",
        prev_btn: "Anterior",
        next_btn: "Siguiente",
        transcription_title: "Transcripción",
        show_alignments: "Ver Alineamientos",
        alignments_modal_title: "Alineamientos Realizados",
        completion_title: "🎉 ¡AUDIO ALINEADO CON ÉXITO!",
        completion_congrats: "¡Excelente trabajo! Has completado la alineación de este audio.",
        completion_instructions: "Revisa a continuación cada uno de los segmentos alineados, escucha las pistas previas para verificar la sincronización o vuelve al listado para procesar un nuevo archivo.",
        completion_home: "🏠 Volver al Listado Principal",
        completion_review: "🔍 Volver al Editor",
        completion_preview_title: "Vista Previa de Alineamientos",
        no_alignments_yet: "No hay segmentos alineados todavía. ¡Comienza a alinear la transcripción!",
        listen_btn: "▶ Escuchar",
        pause_btn: "⏸ Pausa",
        jump_btn: "Ir a segmento",
        correct_btn: "Corregir",
        remaining_text: "Texto Restante",
        reset_confirm: "¿Estás seguro de que quieres volver a la segmentación? Se perderá todo el texto asignado a los segmentos actuales.",
        select_text_alert: "Por favor, selecciona con el ratón el texto correspondiente a este segmento en el panel superior.",
        this_seg_badge: "Este Seg.",
        seg_badge_prefix: "Seg. ",
        assign_highlight_btn: "Asignar Selección (Ctrl + Enter)",
        next_seg_btn: "Siguiente Segmento (Ctrl + Enter)",
        select_and_assign_btn: "Selecciona texto arriba y asigna"
    }
};

document.addEventListener('DOMContentLoaded', () => {
    currentLang = localStorage.getItem('aligner_lang') || 'en';
    initStage();
    setupEventListeners();
    updateLanguageUI();
});

function initStage() {
    if (!config) return;
    const resetBtn = document.getElementById('reset-seg-btn');
    if (currentState.stage === 1) {
        document.getElementById('stage1').style.display = 'block';
        document.getElementById('stage2').style.display = 'none';
        if (resetBtn) resetBtn.style.display = 'none';
        initWaveformFull();
    } else {
        document.getElementById('stage1').style.display = 'none';
        document.getElementById('stage2').style.display = 'block';
        if (resetBtn) resetBtn.style.display = 'block';
        initWaveformSegment();
        loadTranscription();
    }
    updateProgress();
}

function initWaveformFull() {
    if (!config) return;
    if (wsFull) wsFull.destroy();
    
    wsFull = WaveSurfer.create({
        container: '#waveform-full',
        waveColor: '#4F4A85',
        progressColor: '#383351',
        url: `/uploads/${currentState.audio_path}`,
    });

    regions = wsFull.registerPlugin(WaveSurfer.Regions.create());

    wsFull.on('ready', () => {
        const duration = wsFull.getDuration();
        document.getElementById('total-duration').innerText = formatTime(duration);
    });

    wsFull.on('decode', () => {
        if (currentState.segments.length > 0) {
            renderRegions();
        }
    });

    regions.on('region-updated', (region) => {
        const idx = currentState.segments.findIndex(s => s.id === region.id);
        if (idx !== -1) {
            currentState.segments[idx].start = region.start;
            currentState.segments[idx].end = region.end;
            
            // Update the label inside the region
            const label = region.element.querySelector('.region-label');
            if (label) {
                label.innerText = `${(region.end - region.start).toFixed(1)}s`;
            }
        }
    });
}

function renderRegions() {
    if (!config) return;
    regions.clearRegions();
    currentState.segments.forEach((seg, i) => {
        const region = regions.addRegion({
            id: `seg-${i}`,
            start: seg.start,
            end: seg.end,
            color: 'rgba(0, 123, 255, 0.2)',
            drag: true,
            resize: true,
            content: createRegionLabel(seg.end - seg.start)
        });
        seg.id = `seg-${i}`;
    });
}

function createRegionLabel(duration) {
    const el = document.createElement('div');
    el.className = 'region-label';
    el.innerText = `${duration.toFixed(1)}s`;
    return el;
}

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

async function detectSegments() {
    if (!config) return;
    const btn = document.getElementById('detect-btn');
    const loader = document.getElementById('segmentation-loader');
    const targetDuration = parseInt(document.getElementById('target-duration-input').value) || 25;
    
    btn.disabled = true;
    loader.style.display = 'block';

    try {
        const response = await fetch('/api/detect_segments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                audio_path: currentState.audio_path,
                target_duration: targetDuration
            })
        });
        const data = await response.json();
        currentState.segments = data.segments.map((s, i) => ({ ...s, text: '', id: `seg-${i}` }));
        renderRegions();
    } catch (e) {
        console.error("Segmentation failed", e);
    } finally {
        btn.disabled = false;
        loader.style.display = 'none';
    }
}

function initWaveformSegment() {
    if (!config) return;
    if (wsSegment) wsSegment.destroy();
    
    const seg = currentState.segments[currentState.current_idx];
    const segmentUrl = `/api/get_segment_audio?path=${currentState.audio_path}&start=${seg.start}&end=${seg.end}`;

    wsSegment = WaveSurfer.create({
        container: '#waveform-segment',
        waveColor: '#4F4A85',
        progressColor: '#383351',
        url: segmentUrl,
    });

    wsSegment.on('decode', () => {
        wsSegment.setPlaybackRate(currentSpeed);
    });

    // Loop logic - simplified since the file is only the segment
    wsSegment.on('finish', () => {
        wsSegment.setTime(0);
        wsSegment.play();
    });
}

let originalTranscription = "";

async function loadTranscription() {
    if (!config) return;
    const response = await fetch(`/api/load_text?path=${currentState.text_path}`);
    const data = await response.json();
    originalTranscription = data.text;
    
    document.getElementById('total-segments').innerText = currentState.segments.length;
    renderTranscription();
}

function renderTranscription() {
    const container = document.getElementById('text-container');
    if (!container) return;
    
    container.style.display = 'block';
    container.style.padding = '25px';
    container.innerHTML = '';
    
    const escapeHtml = (str) => {
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    };

    // Calculate the absolute character ranges of already aligned segments
    let lastIdx = 0;
    const ranges = currentState.segments.map((seg, i) => {
        if (!seg.text) return null;
        let found = originalTranscription.indexOf(seg.text, lastIdx);
        if (found === -1) {
            found = originalTranscription.indexOf(seg.text);
        }
        if (found !== -1) {
            lastIdx = found + seg.text.length;
            return {
                index: i,
                start: found,
                end: found + seg.text.length,
                text: seg.text
            };
        }
        return null;
    });

    // Filter nulls and sort by start index
    const activeRanges = ranges.filter(r => r !== null).sort((a, b) => a.start - b.start);

    let html = "";
    let currentPos = 0;

    activeRanges.forEach(r => {
        // Unaligned gap before this segment
        if (r.start > currentPos) {
            const unalignedText = originalTranscription.substring(currentPos, r.start);
            html += `<span>${escapeHtml(unalignedText)}</span>`;
        }
        
        // Highlighted segment
        const segmentText = originalTranscription.substring(r.start, r.end);
        const isActive = (r.index === currentState.current_idx);
        const highlightClass = isActive ? 'inline-highlight active' : 'inline-highlight aligned';
        const labelBadge = isActive ? translations[currentLang].this_seg_badge : `${translations[currentLang].seg_badge_prefix}${r.index + 1}`;
        
        html += `<span class="${highlightClass}" data-idx="${r.index}" title="${labelBadge}">${escapeHtml(segmentText)}</span>`;
        
        currentPos = r.end;
    });

    // Unaligned remaining text at the end
    if (currentPos < originalTranscription.length) {
        const unalignedText = originalTranscription.substring(currentPos);
        html += `<span>${escapeHtml(unalignedText)}</span>`;
    }

    container.innerHTML = html;

    // Attach click listeners to jump to segments directly when clicking highlighted spans
    const spans = container.querySelectorAll('.inline-highlight');
    spans.forEach(span => {
        span.addEventListener('click', (e) => {
            // Prevent interference with text selection dragging
            if (window.getSelection().toString().trim().length > 0) return;
            
            const idx = parseInt(span.dataset.idx);
            if (idx !== currentState.current_idx) {
                jumpToSegment(idx);
            }
        });
    });
    
    // Update metadata
    document.getElementById('current-segment-idx').innerText = currentState.current_idx + 1;
    const seg = currentState.segments[currentState.current_idx];
    document.getElementById('segment-duration').innerText = (seg.end - seg.start).toFixed(2);
    
    // Update dynamic Assign button label
    const assignBtn = document.getElementById('assign-btn');
    if (assignBtn) {
        const currentText = currentState.segments[currentState.current_idx].text;
        if (currentText) {
            assignBtn.innerText = translations[currentLang].next_seg_btn;
            assignBtn.disabled = false;
            assignBtn.style.opacity = '1';
            assignBtn.style.cursor = 'pointer';
        } else {
            assignBtn.innerText = translations[currentLang].select_and_assign_btn;
            assignBtn.disabled = false;
            assignBtn.style.opacity = '1';
            assignBtn.style.cursor = 'pointer';
        }
    }
    
    // Scroll active span into view smoothly
    setTimeout(() => {
        const activeSpan = container.querySelector('.inline-highlight.active');
        if (activeSpan) {
            activeSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, 100);
}

function updateSegmentUI() {
    if (!config) return;
    renderTranscription();

    const seg = currentState.segments[currentState.current_idx];
    const segmentUrl = `/api/get_segment_audio?path=${currentState.audio_path}&start=${seg.start}&end=${seg.end}`;
    if (wsSegment) {
        wsSegment.load(segmentUrl);
    }
}

function assignText() {
    if (!config) return;
    const selection = window.getSelection().toString().trim();
    if (selection) {
        currentState.segments[currentState.current_idx].text = selection;
        saveState();
        
        if (currentState.current_idx === currentState.segments.length - 1) {
            updateProgress();
            openCompletionModal();
        } else {
            nextSegment();
        }
    } else {
        const currentText = currentState.segments[currentState.current_idx].text;
        if (currentText) {
            if (currentState.current_idx === currentState.segments.length - 1) {
                updateProgress();
                openCompletionModal();
            } else {
                nextSegment();
            }
        } else {
            alert(translations[currentLang].select_text_alert);
        }
    }
}

function nextSegment() {
    if (currentState.current_idx < currentState.segments.length - 1) {
        currentState.current_idx++;
        updateSegmentUI();
        updateProgress();
    }
}

function prevSegment() {
    if (currentState.current_idx > 0) {
        currentState.current_idx--;
        updateSegmentUI();
        updateProgress();
    }
}

async function saveState() {
    if (!config) return;
    await fetch('/api/save_state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentState)
    });
}

function updateProgress() {
    if (!config) return;
    const total = currentState.segments.length;
    if (total === 0) return;
    const completed = currentState.segments.filter(s => s.text).length;
    const percent = Math.round((completed / total) * 100);
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    if (progressBar) progressBar.style.width = `${percent}%`;
    if (progressText) progressText.innerText = `${percent}%`;
}

function setupEventListeners() {
    document.getElementById('lang-toggle-btn')?.addEventListener('click', toggleLanguage);

    if (!config) return;

    document.getElementById('detect-btn')?.addEventListener('click', detectSegments);
    
    document.getElementById('confirm-segments-btn')?.addEventListener('click', () => {
        if (currentState.segments.length > 0) {
            currentState.stage = 2;
            initStage();
            saveState();
        }
    });

    document.getElementById('play-segment-btn')?.addEventListener('click', () => {
        wsSegment.playPause();
    });

    document.getElementById('prev-btn')?.addEventListener('click', prevSegment);
    document.getElementById('next-btn')?.addEventListener('click', nextSegment);
    document.getElementById('assign-btn')?.addEventListener('click', assignText);
    document.getElementById('save-btn')?.addEventListener('click', saveState);
    document.getElementById('show-alignments-btn')?.addEventListener('click', openAlignmentsModal);
    document.getElementById('close-modal-btn')?.addEventListener('click', closeAlignmentsModal);
    
    // Completion modal listeners
    document.getElementById('close-completion-btn')?.addEventListener('click', closeCompletionModal);
    document.getElementById('completion-review-btn')?.addEventListener('click', closeCompletionModal);
    
    // Close modals on clicking outside
    window.addEventListener('click', (e) => {
        const modal = document.getElementById('alignments-modal');
        if (e.target === modal) {
            closeAlignmentsModal();
        }
        const compModal = document.getElementById('completion-modal');
        if (e.target === compModal) {
            closeCompletionModal();
        }
    });

    document.getElementById('reset-seg-btn')?.addEventListener('click', () => {
        const confirmReset = confirm(translations[currentLang].reset_confirm);
        if (confirmReset) {
            currentState.stage = 1;
            currentState.segments = [];
            currentState.current_idx = 0;
            saveState();
            initStage();
        }
    });

    // Speed controls
    document.querySelectorAll('.speed-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const speed = parseFloat(e.target.dataset.speed);
            currentSpeed = speed;
            if (wsSegment) {
                wsSegment.setPlaybackRate(speed);
            }
            
            // Update UI
            document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
        });
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAlignmentsModal();
            closeCompletionModal();
        }
        if (currentState.stage === 2) {
            if (e.code === 'Space' && e.target.tagName !== 'TEXTAREA') {
                e.preventDefault();
                wsSegment.playPause();
            }
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                assignText();
            }
        }
    });
}

function openAlignmentsModal() {
    const modal = document.getElementById('alignments-modal');
    if (!modal) return;
    
    modal.style.display = 'flex';
    renderAlignmentsOverview();
}

function closeAlignmentsModal() {
    const modal = document.getElementById('alignments-modal');
    if (!modal) return;
    
    modal.style.display = 'none';
    
    // Pause any preview audio that is playing
    if (previewAudio) {
        previewAudio.pause();
        previewAudio = null;
        currentPlayingBtn = null;
    }
}

function renderAlignmentsOverview() {
    const body = document.getElementById('modal-alignments-body');
    if (!body) return;
    
    body.innerHTML = '';
    
    let lastIndex = 0;
    const blocks = [];
    
    currentState.segments.forEach((seg, i) => {
        if (seg.text) {
            let foundIndex = originalTranscription.indexOf(seg.text, lastIndex);
            
            if (foundIndex === -1) {
                foundIndex = originalTranscription.indexOf(seg.text);
            }
            
            if (foundIndex !== -1) {
                if (foundIndex > lastIndex) {
                    blocks.push({
                        type: 'unaligned',
                        text: originalTranscription.substring(lastIndex, foundIndex)
                    });
                }
                blocks.push({
                    type: 'aligned',
                    index: i,
                    start: seg.start,
                    end: seg.end,
                    text: seg.text
                });
                lastIndex = foundIndex + seg.text.length;
            } else {
                blocks.push({
                    type: 'aligned',
                    index: i,
                    start: seg.start,
                    end: seg.end,
                    text: seg.text,
                    orphan: true
                });
            }
        }
    });
    
    if (lastIndex < originalTranscription.length) {
        blocks.push({
            type: 'unaligned',
            text: originalTranscription.substring(lastIndex)
        });
    }
    
    if (blocks.length === 0) {
        body.innerHTML = `<div style="text-align: center; padding: 40px; font-weight: 800; font-size: 1.2rem;">${translations[currentLang].no_alignments_yet}</div>`;
        return;
    }
    
    const listContainer = document.createElement('div');
    listContainer.className = 'alignments-list';
    
    blocks.forEach(block => {
        const blockEl = document.createElement('div');
        
        if (block.type === 'aligned') {
            blockEl.className = 'alignment-block aligned';
            
            const headerEl = document.createElement('div');
            headerEl.className = 'block-header';
            
            const badgeEl = document.createElement('span');
            badgeEl.className = 'block-badge';
            badgeEl.innerText = `${translations[currentLang].seg_badge_prefix}${block.index + 1} (${block.start.toFixed(2)}s - ${block.end.toFixed(2)}s)`;
            headerEl.appendChild(badgeEl);
            
            const actionsEl = document.createElement('div');
            actionsEl.className = 'block-actions';
            
            const playBtn = document.createElement('button');
            playBtn.className = 'brutalist-button block-btn';
            playBtn.innerText = translations[currentLang].listen_btn;
            playBtn.addEventListener('click', () => {
                playSegmentPreview(block.start, block.end, playBtn);
            });
            actionsEl.appendChild(playBtn);
            
            const jumpBtn = document.createElement('button');
            jumpBtn.className = 'brutalist-button block-btn secondary-btn';
            jumpBtn.innerText = translations[currentLang].jump_btn;
            jumpBtn.addEventListener('click', () => {
                jumpToSegment(block.index);
            });
            actionsEl.appendChild(jumpBtn);
            
            headerEl.appendChild(actionsEl);
            blockEl.appendChild(headerEl);
            
            const textEl = document.createElement('div');
            textEl.className = 'block-text';
            textEl.innerText = block.text;
            blockEl.appendChild(textEl);
            
        } else {
            blockEl.className = 'alignment-block unaligned';
            
            const headerEl = document.createElement('div');
            headerEl.className = 'block-header';
            
            const badgeEl = document.createElement('span');
            badgeEl.className = 'block-badge unaligned-badge';
            badgeEl.innerText = translations[currentLang].remaining_text;
            headerEl.appendChild(badgeEl);
            
            blockEl.appendChild(headerEl);
            
            const textEl = document.createElement('div');
            textEl.className = 'block-text';
            textEl.innerText = block.text.trim();
            
            if (textEl.innerText.length > 0) {
                blockEl.appendChild(textEl);
            } else {
                return; // Skip empty unaligned blocks
            }
        }
        
        listContainer.appendChild(blockEl);
    });
    
    body.appendChild(listContainer);
}

function playSegmentPreview(start, end, btn) {
    if (previewAudio && !previewAudio.paused) {
        previewAudio.pause();
        if (currentPlayingBtn) {
            currentPlayingBtn.innerText = translations[currentLang].listen_btn;
        }
        
        if (currentPlayingBtn === btn) {
            previewAudio = null;
            currentPlayingBtn = null;
            return;
        }
    }
    
    const url = `/api/get_segment_audio?path=${currentState.audio_path}&start=${start}&end=${end}`;
    previewAudio = new Audio(url);
    currentPlayingBtn = btn;
    btn.innerText = translations[currentLang].pause_btn;
    
    previewAudio.play();
    previewAudio.onended = () => {
        btn.innerText = translations[currentLang].listen_btn;
        previewAudio = null;
        currentPlayingBtn = null;
    };
}

function jumpToSegment(idx) {
    if (previewAudio) {
        previewAudio.pause();
        previewAudio = null;
        currentPlayingBtn = null;
    }
    currentState.current_idx = idx;
    updateSegmentUI();
    updateProgress();
    closeAlignmentsModal();
}

function openCompletionModal() {
    const modal = document.getElementById('completion-modal');
    if (!modal) return;
    
    if (previewAudio) {
        previewAudio.pause();
        previewAudio = null;
        if (currentPlayingBtn) {
            currentPlayingBtn.innerText = translations[currentLang].listen_btn;
            currentPlayingBtn = null;
        }
    }
    
    renderCompletionOverview();
    modal.style.display = 'flex';
}

function closeCompletionModal() {
    const modal = document.getElementById('completion-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    if (previewAudio) {
        previewAudio.pause();
        previewAudio = null;
        if (currentPlayingBtn) {
            currentPlayingBtn.innerText = translations[currentLang].listen_btn;
            currentPlayingBtn = null;
        }
    }
}

function renderCompletionOverview() {
    const body = document.getElementById('completion-alignments-body');
    if (!body) return;
    
    body.innerHTML = '';
    
    let lastIndex = 0;
    const blocks = [];
    
    currentState.segments.forEach((seg, i) => {
        if (seg.text) {
            let foundIndex = originalTranscription.indexOf(seg.text, lastIndex);
            
            if (foundIndex === -1) {
                foundIndex = originalTranscription.indexOf(seg.text);
            }
            
            if (foundIndex !== -1) {
                if (foundIndex > lastIndex) {
                    blocks.push({
                        type: 'unaligned',
                        text: originalTranscription.substring(lastIndex, foundIndex)
                    });
                }
                blocks.push({
                    type: 'aligned',
                    index: i,
                    start: seg.start,
                    end: seg.end,
                    text: seg.text
                });
                lastIndex = foundIndex + seg.text.length;
            } else {
                blocks.push({
                    type: 'aligned',
                    index: i,
                    start: seg.start,
                    end: seg.end,
                    text: seg.text,
                    orphan: true
                });
            }
        }
    });
    
    if (lastIndex < originalTranscription.length) {
        blocks.push({
            type: 'unaligned',
            text: originalTranscription.substring(lastIndex)
        });
    }
    
    if (blocks.length === 0) {
        body.innerHTML = `<div style="text-align: center; padding: 40px; font-weight: 800; font-size: 1.2rem;">${translations[currentLang].no_alignments_yet}</div>`;
        return;
    }
    
    const listContainer = document.createElement('div');
    listContainer.className = 'alignments-list';
    
    blocks.forEach(block => {
        const blockEl = document.createElement('div');
        
        if (block.type === 'aligned') {
            blockEl.className = 'alignment-block aligned';
            
            const headerEl = document.createElement('div');
            headerEl.className = 'block-header';
            
            const badgeEl = document.createElement('span');
            badgeEl.className = 'block-badge';
            badgeEl.innerText = `${translations[currentLang].seg_badge_prefix}${block.index + 1} (${block.start.toFixed(2)}s - ${block.end.toFixed(2)}s)`;
            headerEl.appendChild(badgeEl);
            
            const actionsEl = document.createElement('div');
            actionsEl.className = 'block-actions';
            
            const playBtn = document.createElement('button');
            playBtn.className = 'brutalist-button block-btn';
            playBtn.innerText = translations[currentLang].listen_btn;
            playBtn.addEventListener('click', () => {
                playSegmentPreview(block.start, block.end, playBtn);
            });
            actionsEl.appendChild(playBtn);
            
            const jumpBtn = document.createElement('button');
            jumpBtn.className = 'brutalist-button block-btn secondary-btn';
            jumpBtn.innerText = translations[currentLang].correct_btn;
            jumpBtn.addEventListener('click', () => {
                closeCompletionModal();
                jumpToSegment(block.index);
            });
            actionsEl.appendChild(jumpBtn);
            
            headerEl.appendChild(actionsEl);
            blockEl.appendChild(headerEl);
            
            const textEl = document.createElement('div');
            textEl.className = 'block-text';
            textEl.innerText = block.text;
            blockEl.appendChild(textEl);
            
        } else {
            blockEl.className = 'alignment-block unaligned';
            
            const headerEl = document.createElement('div');
            headerEl.className = 'block-header';
            
            const badgeEl = document.createElement('span');
            badgeEl.className = 'block-badge unaligned-badge';
            badgeEl.innerText = translations[currentLang].remaining_text;
            headerEl.appendChild(badgeEl);
            
            blockEl.appendChild(headerEl);
            
            const textEl = document.createElement('div');
            textEl.className = 'block-text';
            textEl.innerText = block.text.trim();
            
            if (textEl.innerText.length > 0) {
                blockEl.appendChild(textEl);
            } else {
                return;
            }
        }
        
        listContainer.appendChild(blockEl);
    });
    
    body.appendChild(listContainer);
}

function toggleLanguage() {
    currentLang = currentLang === 'en' ? 'es' : 'en';
    localStorage.setItem('aligner_lang', currentLang);
    updateLanguageUI();
}

function updateLanguageUI() {
    const langBtn = document.getElementById('lang-toggle-btn');
    if (langBtn) {
        langBtn.innerText = currentLang === 'en' ? '🌐 ES' : '🌐 EN';
    }

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[currentLang] && translations[currentLang][key]) {
            el.innerText = translations[currentLang][key];
        }
    });

    document.querySelectorAll('.project-segments-status').forEach(el => {
        const completed = el.getAttribute('data-completed');
        const total = el.getAttribute('data-total');
        el.innerText = `${completed} / ${total} ${translations[currentLang].segments_aligned}`;
    });

    if (config) {
        renderTranscription();
    }
}
