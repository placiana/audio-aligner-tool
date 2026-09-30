let wsFull, wsSegment;
let regions, regionsSegment;
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
let isUpdatingContiguous = false;

// Access global translations declared in locale.js
const translations = window.translations;

document.addEventListener('DOMContentLoaded', () => {
    initStage();
    setupEventListeners();
    
    if (window.userRole === 'viewer') {
        const textarea = document.getElementById('manual-transcription-input');
        if (textarea) textarea.readOnly = true;
        
        const hideIds = ['reset-seg-btn', 'save-btn', 'detect-btn', 'confirm-segments-btn', 'assign-btn', 
                         'adj-start-minus', 'adj-start-plus', 'adj-end-minus', 'adj-end-plus'];
        hideIds.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.style.display = 'none';
        });
        
        const silenceInputs = ['target-duration-input', 'silence-ms-input', 'silence-db-input'];
        silenceInputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = true;
        });
    }
    
    // Selection listener to sync text highlighting into input textarea
    document.addEventListener('selectionchange', () => {
        if (currentState.stage === 2 && config && config.text_path && config.project_type === 'alignment') {
            const selection = window.getSelection().toString().trim();
            const textContainer = document.getElementById('text-container');
            if (selection && textContainer && textContainer.contains(window.getSelection().anchorNode)) {
                const manualInput = document.getElementById('manual-transcription-input');
                if (manualInput) {
                    manualInput.value = selection;
                }
            }
        }
    });

    // Listen to global language change event to refresh highlighted text
    window.addEventListener('languagechanged', () => {
        if (config) {
            renderTranscription();
        }
    });
});

function hasAudio() {
    if (currentState && currentState.schema && typeof currentState.schema.has_audio === 'boolean') {
        return currentState.schema.has_audio;
    }
    if (config && config.project_type === 'text_translation') {
        return false;
    }
    return Boolean(currentState && currentState.audio_path);
}

function getSegStart(seg) {
    if (!seg) return 0;
    if (seg.audio && typeof seg.audio.start === 'number') return seg.audio.start;
    return typeof seg.start === 'number' ? seg.start : 0;
}

function getSegEnd(seg) {
    if (!seg) return 0;
    if (seg.audio && typeof seg.audio.end === 'number') return seg.audio.end;
    return typeof seg.end === 'number' ? seg.end : 0;
}

function initStage() {
    if (!config) return;
    const resetBtn = document.getElementById('reset-seg-btn');
    const stage1El = document.getElementById('stage1');
    const stage2El = document.getElementById('stage2');
    
    // Check if project has no audio (e.g. text translation)
    if (!hasAudio()) {
        if (stage1El) stage1El.style.display = 'none';
        if (stage2El) stage2El.style.display = 'block';
        if (resetBtn) resetBtn.style.display = 'none';
        
        currentState.stage = 2;
        
        // Hide audio controls in Stage 2
        const waveSeg = document.getElementById('waveform-segment');
        if (waveSeg) waveSeg.style.display = 'none';
        const playBtn = document.getElementById('play-segment-btn');
        if (playBtn) playBtn.style.display = 'none';
        const speedCtrl = document.querySelector('.speed-controls');
        if (speedCtrl) speedCtrl.style.display = 'none';
        const zoomCtrl = document.querySelector('.zoom-container');
        if (zoomCtrl) zoomCtrl.style.display = 'none';
        
        // If segments are empty and text_path is provided, load initial text lines as segments
        if (currentState.segments.length === 0 && config.text_path) {
            fetch(`/api/load_text?path=${config.text_path}`)
                .then(r => r.text())
                .then(txt => {
                    const lines = txt.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    currentState.segments = lines.map((l, idx) => ({
                        id: `seg_${idx+1}`,
                        audio: null,
                        texts: { src: l },
                        text: l
                    }));
                    saveState();
                    updateSegmentUI();
                })
                .catch(err => console.error("Error loading text for text_translation project", err));
        } else {
            updateSegmentUI();
        }
        updateProgress();
        return;
    }
    
    if (currentState.stage === 1) {
        if (stage1El) stage1El.style.display = 'block';
        if (stage2El) stage2El.style.display = 'none';
        if (resetBtn) resetBtn.style.display = 'none';
        initWaveformFull();
    } else {
        if (stage1El) stage1El.style.display = 'none';
        if (stage2El) stage2El.style.display = 'block';
        if (resetBtn) resetBtn.style.display = 'block';
        
        // Dynamic layout adjust based on project type
        const rightPanel = document.querySelector('.right-panel');
        const leftPanel = document.querySelector('.left-panel');
        const splitLayout = document.querySelector('.split-layout');
        const textContainer = document.getElementById('text-container');
        const manualContainer = document.getElementById('manual-transcription-container');
        
        if (config.project_type === 'segmentation') {
            if (rightPanel) rightPanel.style.display = 'none';
            if (leftPanel) {
                leftPanel.style.flex = '1 0 100%';
                leftPanel.style.maxWidth = '100%';
            }
            if (splitLayout) splitLayout.style.height = 'auto';
        } else if (config.project_type === 'transcription') {
            if (rightPanel) rightPanel.style.display = 'block';
            if (leftPanel) {
                leftPanel.style.flex = '1';
                leftPanel.style.maxWidth = '';
            }
            if (splitLayout) splitLayout.style.height = 'auto';
            if (textContainer) textContainer.style.display = 'none';
            if (manualContainer) manualContainer.style.display = 'flex';
        } else {
            // alignment / multimodal
            if (rightPanel) rightPanel.style.display = 'block';
            if (leftPanel) {
                leftPanel.style.flex = '1';
                leftPanel.style.maxWidth = '';
            }
            if (splitLayout) splitLayout.style.height = 'auto';
            if (textContainer) textContainer.style.display = 'block';
            if (manualContainer) manualContainer.style.display = 'flex';
        }
        
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
        minPxPerSec: 20
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
        if (isUpdatingContiguous) return;

        const idx = currentState.segments.findIndex(s => s.id === region.id);
        if (idx !== -1) {
            const oldStart = currentState.segments[idx].start;
            const oldEnd = currentState.segments[idx].end;

            currentState.segments[idx].start = region.start;
            currentState.segments[idx].end = region.end;
            
            const label = region.element.querySelector('.region-label');
            if (label) {
                label.innerText = `${(region.end - region.start).toFixed(1)}s`;
            }

            isUpdatingContiguous = true;
            try {
                // If start position changed, snap the end of the previous region
                if (region.start !== oldStart && idx > 0) {
                    const prevRegion = regions.getRegions().find(r => r.id === `seg-${idx - 1}`);
                    if (prevRegion) {
                        prevRegion.setOptions({ end: region.start });
                        currentState.segments[idx - 1].end = region.start;
                        const prevLabel = prevRegion.element.querySelector('.region-label');
                        if (prevLabel) {
                            prevLabel.innerText = `${(prevRegion.end - prevRegion.start).toFixed(1)}s`;
                        }
                    }
                }
                // If end position changed, snap the start of the next region
                if (region.end !== oldEnd && idx < currentState.segments.length - 1) {
                    const nextRegion = regions.getRegions().find(r => r.id === `seg-${idx + 1}`);
                    if (nextRegion) {
                        nextRegion.setOptions({ start: region.end });
                        currentState.segments[idx + 1].start = region.end;
                        const nextLabel = nextRegion.element.querySelector('.region-label');
                        if (nextLabel) {
                            nextLabel.innerText = `${(nextRegion.end - nextRegion.start).toFixed(1)}s`;
                        }
                    }
                }
            } finally {
                isUpdatingContiguous = false;
            }
        }
    });
}

function renderRegions() {
    if (!config) return;
    regions.clearRegions();
    const isViewer = (window.userRole === 'viewer');
    currentState.segments.forEach((seg, i) => {
        const region = regions.addRegion({
            id: `seg-${i}`,
            start: seg.start,
            end: seg.end,
            color: 'rgba(0, 123, 255, 0.2)',
            drag: !isViewer,
            resize: !isViewer,
            content: createRegionLabel(seg.end - seg.start)
        });
        seg.id = `seg-${i}`;
        
        if (!isViewer && currentState.stage === 1) {
            region.element.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showRegionContextMenu(e, region);
            });
        }
    });
}

function showRegionContextMenu(e, region) {
    let menu = document.getElementById('region-context-menu');
    if (menu) menu.remove();

    menu = document.createElement('div');
    menu.id = 'region-context-menu';
    menu.className = 'brutalist-card';
    menu.style.cssText = `
        position: fixed;
        left: ${e.clientX}px;
        top: ${e.clientY}px;
        background: white;
        border: 2.5px solid var(--border-color);
        box-shadow: 4px 4px 0px var(--border-color);
        z-index: 9999;
        padding: 5px 0;
        min-width: 150px;
    `;

    const splitBtn = document.createElement('button');
    splitBtn.className = 'dropdown-item';
    splitBtn.style.cssText = `
        width: 100%;
        text-align: left;
        background: none;
        border: none;
        padding: 8px 15px;
        font-weight: 800;
        font-family: inherit;
        cursor: pointer;
        font-size: 13px;
        color: var(--text-color);
    `;
    splitBtn.innerText = window.currentLang === 'es' ? '✂️ Dividir segmento' : '✂️ Split Segment';
    splitBtn.addEventListener('click', (evt) => {
        evt.stopPropagation();
        splitSegmentAtClick(e, region);
        menu.remove();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'dropdown-item';
    deleteBtn.style.cssText = `
        width: 100%;
        text-align: left;
        background: none;
        border: none;
        padding: 8px 15px;
        font-weight: 800;
        font-family: inherit;
        cursor: pointer;
        font-size: 13px;
        color: #dc2626;
        display: flex;
        align-items: center;
        gap: 8px;
    `;
    deleteBtn.innerText = window.currentLang === 'es' ? '🗑️ Eliminar segmento' : '🗑️ Delete Segment';
    deleteBtn.addEventListener('click', (evt) => {
        evt.stopPropagation();
        deleteSegmentAtClick(region);
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

function splitSegmentAtClick(e, region) {
    if (!wsFull) return;
    const wrapper = wsFull.getWrapper();
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const x = e.clientX - rect.left + wrapper.scrollLeft;
    const percentage = Math.max(0, Math.min(1, x / wrapper.scrollWidth));
    const splitTime = percentage * wsFull.getDuration();

    const idx = currentState.segments.findIndex(s => s.id === region.id);
    if (idx === -1) return;
    const targetSeg = currentState.segments[idx];
    if (splitTime <= targetSeg.start + 0.05 || splitTime >= targetSeg.end - 0.05) return;

    const firstPart = {
        ...targetSeg,
        end: splitTime
    };
    const secondPart = {
        start: splitTime,
        end: targetSeg.end,
        text: ''
    };

    currentState.segments[idx] = firstPart;
    currentState.segments.splice(idx + 1, 0, secondPart);

    renderRegions();
    saveState();
}

function deleteSegmentAtClick(region) {
    if (!currentState || !currentState.segments) return;
    const idx = currentState.segments.findIndex(s => s.id === region.id);
    if (idx === -1) return;
    currentState.segments.splice(idx, 1);
    renderRegions();
    saveState();
}

function createRegionLabel(duration, isActive = false, index = null) {
    const el = document.createElement('div');
    el.className = 'region-label';
    if (isActive) {
        el.classList.add('active-region-label');
    }
    el.style.background = isActive ? '#fef08a' : '#000000';
    el.style.color = isActive ? '#1a1a1a' : '#ffffff';
    el.style.border = '2px solid #1a1a1a';
    el.style.fontSize = '12px';
    el.style.fontWeight = '900';
    el.style.padding = '3px 6px';
    el.style.boxShadow = isActive ? '2px 2px 0px #1a1a1a' : '1px 1px 0px #000000';
    
    if (isActive && index !== null) {
        el.innerText = `#${index + 1}: ${duration.toFixed(1)}s`;
    } else {
        el.innerText = `${duration.toFixed(1)}s`;
    }
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
    
    // Read silence configuration parameters
    const targetDuration = parseInt(document.getElementById('target-duration-input').value) || 25;
    const silenceMs = parseInt(document.getElementById('silence-ms-input').value) || 500;
    const silenceDb = parseInt(document.getElementById('silence-db-input').value) || -20;
    
    btn.disabled = true;
    loader.style.display = 'block';

    try {
        const response = await fetch('/api/detect_segments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                audio_path: currentState.audio_path,
                target_duration: targetDuration,
                min_silence_len: silenceMs,
                silence_thresh: silenceDb
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
    if (wsSegment) {
        wsSegment.destroy();
        wsSegment = null;
    }
    
    const zoomVal = parseInt(document.getElementById('zoom-slider-stage2')?.value || '50');

    wsSegment = WaveSurfer.create({
        container: '#waveform-segment',
        waveColor: '#4F4A85',
        progressColor: '#383351',
        url: `/uploads/${currentState.audio_path}`,
        minPxPerSec: zoomVal
    });

    regionsSegment = wsSegment.registerPlugin(WaveSurfer.Regions.create());

    wsSegment.on('ready', () => {
        wsSegment.setPlaybackRate(currentSpeed);
    });

    wsSegment.on('decode', () => {
        renderStage2Regions();
        focusCurrentSegment();
    });

    wsSegment.on('timeupdate', (currentTime) => {
        const seg = currentState.segments[currentState.current_idx];
        if (seg && wsSegment && wsSegment.isPlaying()) {
            const startVal = getSegStart(seg);
            const endVal = getSegEnd(seg);
            if (currentTime >= endVal) {
                wsSegment.pause();
                wsSegment.setTime(startVal);
            }
        }
    });

    regionsSegment.on('region-updated', (region) => {
        if (isUpdatingContiguous) return;

        const idx = currentState.segments.findIndex((s, i) => `seg-stage2-${i}` === region.id);
        if (idx !== -1) {
            const oldStart = getSegStart(currentState.segments[idx]);
            const oldEnd = getSegEnd(currentState.segments[idx]);

            if (currentState.segments[idx].audio) {
                currentState.segments[idx].audio.start = region.start;
                currentState.segments[idx].audio.end = region.end;
            }
            currentState.segments[idx].start = region.start;
            currentState.segments[idx].end = region.end;

            const isActive = (idx === currentState.current_idx);
            const label = region.element.querySelector('.region-label');
            if (label) {
                label.innerText = isActive 
                    ? `#${idx + 1}: ${(region.end - region.start).toFixed(1)}s`
                    : `${(region.end - region.start).toFixed(1)}s`;
            }

            if (isActive) {
                const segDurEl = document.getElementById('segment-duration');
                if (segDurEl) segDurEl.innerText = (region.end - region.start).toFixed(2);
            }

            isUpdatingContiguous = true;
            try {
                if (region.start !== oldStart && idx > 0) {
                    const prevRegion = regionsSegment.getRegions().find(r => r.id === `seg-stage2-${idx - 1}`);
                    if (prevRegion) {
                        prevRegion.setOptions({ end: region.start });
                        if (currentState.segments[idx - 1].audio) {
                            currentState.segments[idx - 1].audio.end = region.start;
                        }
                        currentState.segments[idx - 1].end = region.start;
                        const prevLabel = prevRegion.element.querySelector('.region-label');
                        if (prevLabel) {
                            const isPrevActive = (idx - 1 === currentState.current_idx);
                            prevLabel.innerText = isPrevActive 
                                ? `#${idx}: ${(prevRegion.end - prevRegion.start).toFixed(1)}s`
                                : `${(prevRegion.end - prevRegion.start).toFixed(1)}s`;
                        }
                    }
                }
                if (region.end !== oldEnd && idx < currentState.segments.length - 1) {
                    const nextRegion = regionsSegment.getRegions().find(r => r.id === `seg-stage2-${idx + 1}`);
                    if (nextRegion) {
                        nextRegion.setOptions({ start: region.end });
                        if (currentState.segments[idx + 1].audio) {
                            currentState.segments[idx + 1].audio.start = region.end;
                        }
                        currentState.segments[idx + 1].start = region.end;
                        const nextLabel = nextRegion.element.querySelector('.region-label');
                        if (nextLabel) {
                            const isNextActive = (idx + 1 === currentState.current_idx);
                            nextLabel.innerText = isNextActive 
                                ? `#${idx + 2}: ${(nextRegion.end - nextRegion.start).toFixed(1)}s`
                                : `${(nextRegion.end - nextRegion.start).toFixed(1)}s`;
                        }
                    }
                }
            } finally {
                isUpdatingContiguous = false;
            }

            saveState();
        }
    });

    wsSegment.on('play', () => {
        const btn = document.getElementById('play-segment-btn');
        if (btn) btn.innerText = '⏸';
    });

    wsSegment.on('pause', () => {
        const btn = document.getElementById('play-segment-btn');
        if (btn) btn.innerText = '▶';
    });
}

function renderStage2Regions() {
    if (!config || !regionsSegment) return;
    regionsSegment.clearRegions();
    const isViewer = (window.userRole === 'viewer');

    currentState.segments.forEach((seg, i) => {
        const isActive = (i === currentState.current_idx);
        const startVal = getSegStart(seg);
        const endVal = getSegEnd(seg);

        const region = regionsSegment.addRegion({
            id: `seg-stage2-${i}`,
            start: startVal,
            end: endVal,
            color: isActive ? 'rgba(254, 240, 138, 0.65)' : 'rgba(0, 123, 255, 0.2)',
            drag: !isViewer,
            resize: !isViewer,
            content: createRegionLabel(endVal - startVal, isActive, i)
        });

        if (isActive && region.element) {
            region.element.classList.add('active-region');
        }

        if (region.element) {
            region.element.addEventListener('click', (e) => {
                if (e.target.classList.contains('wavesurfer-region-handle')) return;
                if (currentState.current_idx !== i) {
                    jumpToSegment(i);
                }
            });
        }
    });
}

function focusCurrentSegment() {
    if (!wsSegment || !currentState.segments[currentState.current_idx]) return;
    const seg = currentState.segments[currentState.current_idx];
    const startVal = getSegStart(seg);
    const endVal = getSegEnd(seg);

    wsSegment.setTime(startVal);

    const wrapper = wsSegment.getWrapper();
    if (wrapper) {
        const duration = wsSegment.getDuration();
        if (duration > 0) {
            const pxPerSec = wrapper.scrollWidth / duration;
            const startPx = startVal * pxPerSec;
            const segWidthPx = (endVal - startVal) * pxPerSec;
            const centerPx = startPx + (segWidthPx / 2);
            wrapper.scrollLeft = Math.max(0, centerPx - (wrapper.clientWidth / 2));
        }
    }
}

let originalTranscription = "";

async function loadTranscription() {
    if (!config) return;
    document.getElementById('total-segments').innerText = currentState.segments.length;
    
    if (config.project_type === 'alignment' && config.text_path && config.text_path !== "") {
        try {
            const response = await fetch(`/api/load_text?path=${config.text_path}`);
            const data = await response.json();
            originalTranscription = data.text || "";
        } catch (e) {
            console.error("Error loading transcription", e);
            originalTranscription = "";
        }
    } else {
        originalTranscription = "";
    }
    
    renderTranscription();
}

function renderDynamicTextInputs() {
    const container = document.getElementById('manual-transcription-container');
    if (!container) return;
    
    const textTracks = (currentState.schema && currentState.schema.text_tracks) ? 
        currentState.schema.text_tracks : 
        [{ id: 'src', label: 'Transcription', role: 'source' }];
        
    const seg = currentState.segments[currentState.current_idx];
    if (!seg) return;
    
    if (!seg.texts || typeof seg.texts !== 'object') {
        seg.texts = {};
        if (seg.text) seg.texts['src'] = seg.text;
    }

    container.innerHTML = '';
    
    textTracks.forEach(track => {
        const fieldWrapper = document.createElement('div');
        fieldWrapper.style.display = 'flex';
        fieldWrapper.style.flexDirection = 'column';
        fieldWrapper.style.gap = '5px';
        fieldWrapper.style.marginBottom = '10px';
        
        const label = document.createElement('label');
        label.style.fontWeight = '900';
        label.style.fontSize = '12px';
        label.style.textTransform = 'uppercase';
        label.innerText = `${track.label}:`;
        
        const textarea = document.createElement('textarea');
        textarea.className = 'brutalist-input track-textarea';
        textarea.dataset.trackId = track.id;
        textarea.style.height = '65px';
        textarea.style.resize = 'vertical';
        textarea.style.fontFamily = 'inherit';
        textarea.style.fontSize = '14px';
        textarea.placeholder = `Escribir ${track.label.toLowerCase()} aquí...`;
        
        textarea.value = seg.texts[track.id] || (track.id === 'src' ? (seg.text || '') : '');
        
        if (window.userRole === 'viewer') {
            textarea.readOnly = true;
        }
        
        textarea.addEventListener('input', () => {
            seg.texts[track.id] = textarea.value;
            if (track.id === 'src') seg.text = textarea.value;
        });
        
        fieldWrapper.appendChild(label);
        fieldWrapper.appendChild(textarea);
        container.appendChild(fieldWrapper);
    });
}

function renderTranscription() {
    const container = document.getElementById('text-container');
    
    const currentIdxEl = document.getElementById('current-segment-idx');
    const totalSegsEl = document.getElementById('total-segments');
    if (currentIdxEl) currentIdxEl.innerText = currentState.segments.length > 0 ? currentState.current_idx + 1 : 0;
    if (totalSegsEl) totalSegsEl.innerText = currentState.segments.length;
    
    const seg = currentState.segments[currentState.current_idx];
    if (seg) {
        const segDurEl = document.getElementById('segment-duration');
        if (segDurEl) {
            const startVal = getSegStart(seg);
            const endVal = getSegEnd(seg);
            segDurEl.innerText = (endVal - startVal).toFixed(2);
        }
    }
    
    renderDynamicTextInputs();
    
    // If text file was loaded and project type is alignment, render highlights
    if (container && config.project_type === 'alignment' && config.text_path && config.text_path !== "" && originalTranscription !== "") {
        container.style.display = 'block';
        container.innerHTML = '';
        
        const escapeHtml = (str) => {
            return str
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        };

        let lastIdx = 0;
        const ranges = currentState.segments.map((s, i) => {
            const txt = (s.texts && s.texts.src) || s.text;
            if (!txt) return null;
            let found = originalTranscription.indexOf(txt, lastIdx);
            if (found === -1) {
                found = originalTranscription.indexOf(txt);
            }
            if (found !== -1) {
                lastIdx = found + txt.length;
                return {
                    index: i,
                    start: found,
                    end: found + txt.length,
                    text: txt
                };
            }
            return null;
        });

        const activeRanges = ranges.filter(r => r !== null).sort((a, b) => a.start - b.start);

        let html = "";
        let currentPos = 0;

        activeRanges.forEach(r => {
            if (r.start > currentPos) {
                const unalignedText = originalTranscription.substring(currentPos, r.start);
                html += `<span>${escapeHtml(unalignedText)}</span>`;
            }
            
            const segmentText = originalTranscription.substring(r.start, r.end);
            const isActive = (r.index === currentState.current_idx);
            const highlightClass = isActive ? 'inline-highlight active' : 'inline-highlight aligned';
            const labelBadge = isActive ? translations[currentLang].this_seg_badge : `${translations[currentLang].seg_badge_prefix}${r.index + 1}`;
            
            html += `<span class="${highlightClass}" data-idx="${r.index}" title="${labelBadge}">${escapeHtml(segmentText)}</span>`;
            currentPos = r.end;
        });

        if (currentPos < originalTranscription.length) {
            const unalignedText = originalTranscription.substring(currentPos);
            html += `<span>${escapeHtml(unalignedText)}</span>`;
        }

        container.innerHTML = html;

        // Add click listeners to highlighted items
        const spans = container.querySelectorAll('.inline-highlight');
        spans.forEach(span => {
            span.addEventListener('click', () => {
                if (window.getSelection().toString().trim().length > 0) return;
                const idx = parseInt(span.dataset.idx);
                if (idx !== currentState.current_idx) {
                    jumpToSegment(idx);
                }
            });
        });
        
        setTimeout(() => {
            const activeSpan = container.querySelector('.inline-highlight.active');
            if (activeSpan) {
                activeSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    } else if (container) {
        container.style.display = 'none';
    }
    
    // Update Assign button labels based on type
    const assignBtn = document.getElementById('assign-btn');
    if (assignBtn && seg) {
        if (config.project_type === 'segmentation') {
            assignBtn.style.display = 'none';
        } else {
            assignBtn.style.display = 'block';
            const hasAnyText = (seg.texts && Object.values(seg.texts).some(v => v && v.trim())) || Boolean(seg.text);
            if (hasAnyText) {
                assignBtn.innerText = translations[currentLang].next_seg_btn;
            } else {
                assignBtn.innerText = translations[currentLang].save_segment_btn;
            }
        }
    }
}

function updateSegmentUI() {
    if (!config) return;
    renderTranscription();

    const btn = document.getElementById('play-segment-btn');
    if (btn) btn.innerText = '▶';

    const seg = currentState.segments[currentState.current_idx];
    if (seg && hasAudio()) {
        if (!wsSegment) {
            initWaveformSegment();
        } else {
            renderStage2Regions();
            focusCurrentSegment();
        }
    }
}

function assignText() {
    if (!config) return;
    
    const seg = currentState.segments[currentState.current_idx];
    if (!seg) return;
    
    if (!seg.texts || typeof seg.texts !== 'object') {
        seg.texts = {};
    }
    
    const container = document.getElementById('manual-transcription-container');
    if (container) {
        const textareas = container.querySelectorAll('.track-textarea');
        textareas.forEach(ta => {
            const tId = ta.dataset.trackId;
            const val = ta.value.trim();
            seg.texts[tId] = val;
            if (tId === 'src') seg.text = val;
        });
    }
    
    const hasAnyText = Object.values(seg.texts).some(v => v !== '') || Boolean(seg.text && seg.text.trim() !== '');
    
    if (hasAnyText || config.project_type === 'segmentation') {
        saveState();
        
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

function nextSegment() {
    if (currentState.current_idx < currentState.segments.length - 1) {
        currentState.current_idx++;
        updateSegmentUI();
        updateProgress();
    } else {
        // Segmentation/Transcription/Alignment complete
        updateProgress();
        openCompletionModal();
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
    currentState.item_id = config.item_id;
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
    
    let percent = 0;
    if (config.project_type === 'segmentation') {
        // Progress tracks viewed / checked segments
        percent = Math.round(((currentState.current_idx + 1) / total) * 100);
    } else {
        const completed = currentState.segments.filter(s => s.text).length;
        percent = Math.round((completed / total) * 100);
    }
    
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    if (progressBar) progressBar.style.width = `${percent}%`;
    if (progressText) progressText.innerText = `${percent}%`;
}

// Re-segmentation timeline tuning function
function adjustSegmentTime(boundary, delta) {
    if (!config) return;
    const seg = currentState.segments[currentState.current_idx];
    if (!seg) return;
    
    if (boundary === 'start') {
        const newStart = Math.max(0, getSegStart(seg) + delta);
        if (newStart < getSegEnd(seg)) {
            seg.start = newStart;
            if (seg.audio) seg.audio.start = newStart;
            if (currentState.current_idx > 0) {
                const prevSeg = currentState.segments[currentState.current_idx - 1];
                prevSeg.end = newStart;
                if (prevSeg.audio) prevSeg.audio.end = newStart;
            }
        }
    } else if (boundary === 'end') {
        const newEnd = getSegEnd(seg) + delta;
        if (newEnd > getSegStart(seg)) {
            seg.end = newEnd;
            if (seg.audio) seg.audio.end = newEnd;
            if (currentState.current_idx < currentState.segments.length - 1) {
                const nextSeg = currentState.segments[currentState.current_idx + 1];
                nextSeg.start = newEnd;
                if (nextSeg.audio) nextSeg.audio.start = newEnd;
            }
        }
    }
    
    // Save new state immediately
    saveState();
    
    // Update display labels
    document.getElementById('segment-duration').innerText = (getSegEnd(seg) - getSegStart(seg)).toFixed(2);
    
    if (wsSegment && regionsSegment) {
        renderStage2Regions();
        wsSegment.setTime(getSegStart(seg));
    }
}

function setupEventListeners() {
    if (!config) return;

    // Zoom slider bindings
    document.getElementById('zoom-slider-stage1')?.addEventListener('input', (e) => {
        const zoomVal = parseInt(e.target.value);
        document.getElementById('zoom-value-stage1').innerText = `${zoomVal} px/s`;
        if (wsFull) {
            wsFull.zoom(zoomVal);
        }
    });

    document.getElementById('zoom-slider-stage2')?.addEventListener('input', (e) => {
        const zoomVal = parseInt(e.target.value);
        const zoomText = document.getElementById('zoom-value-stage2');
        if (zoomText) zoomText.innerText = `${zoomVal} px/s`;
        if (wsSegment) {
            wsSegment.zoom(zoomVal);
            focusCurrentSegment();
        }
    });

    // Fine-tune timing listener adjustments
    document.getElementById('adj-start-minus')?.addEventListener('click', () => adjustSegmentTime('start', -0.1));
    document.getElementById('adj-start-plus')?.addEventListener('click', () => adjustSegmentTime('start', 0.1));
    document.getElementById('adj-end-minus')?.addEventListener('click', () => adjustSegmentTime('end', -0.1));
    document.getElementById('adj-end-plus')?.addEventListener('click', () => adjustSegmentTime('end', 0.1));

    document.getElementById('detect-btn')?.addEventListener('click', detectSegments);
    
    document.getElementById('confirm-segments-btn')?.addEventListener('click', () => {
        if (currentState.segments.length > 0) {
            currentState.stage = 2;
            initStage();
            saveState();
        }
    });

    document.getElementById('play-segment-btn')?.addEventListener('click', () => {
        if (wsSegment) {
            if (wsSegment.isPlaying()) {
                wsSegment.pause();
            } else {
                const seg = currentState.segments[currentState.current_idx];
                if (seg) {
                    const startVal = getSegStart(seg);
                    const endVal = getSegEnd(seg);
                    const cur = wsSegment.getCurrentTime();
                    if (cur < startVal || cur >= endVal - 0.05) {
                        wsSegment.setTime(startVal);
                    }
                }
                wsSegment.play();
            }
        }
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
    let modalMousedownTarget = null;
    window.addEventListener('mousedown', (e) => {
        modalMousedownTarget = e.target;
    });
    window.addEventListener('click', (e) => {
        const modal = document.getElementById('alignments-modal');
        if (e.target === modal && modalMousedownTarget === modal) {
            closeAlignmentsModal();
        }
        const compModal = document.getElementById('completion-modal');
        if (e.target === compModal && modalMousedownTarget === compModal) {
            closeCompletionModal();
        }
        modalMousedownTarget = null;
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
            
            // Update speed buttons active states
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
            if (e.code === 'Space' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
                e.preventDefault();
                if (wsSegment) {
                    if (wsSegment.isPlaying()) {
                        wsSegment.pause();
                    } else {
                        const seg = currentState.segments[currentState.current_idx];
                        if (seg) {
                            const startVal = getSegStart(seg);
                            const endVal = getSegEnd(seg);
                            const cur = wsSegment.getCurrentTime();
                            if (cur < startVal || cur >= endVal - 0.05) {
                                wsSegment.setTime(startVal);
                            }
                        }
                        wsSegment.play();
                    }
                }
            }
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                if (config.project_type !== 'segmentation') {
                    assignText();
                } else {
                    nextSegment();
                }
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
    
    if (currentState.segments.length === 0) {
        body.innerHTML = `<div style="text-align: center; padding: 40px; font-weight: 800; font-size: 1.2rem;">${translations[currentLang].no_alignments_yet}</div>`;
        return;
    }
    
    const listContainer = document.createElement('div');
    listContainer.className = 'alignments-list';
    
    if (config.project_type === 'segmentation') {
        currentState.segments.forEach((seg, i) => {
            const blockEl = document.createElement('div');
            blockEl.className = 'alignment-block aligned';
            
            const headerEl = document.createElement('div');
            headerEl.className = 'block-header';
            
            const badgeEl = document.createElement('span');
            badgeEl.className = 'block-badge';
            badgeEl.innerText = `${translations[currentLang].seg_badge_prefix}${i + 1} (${seg.start.toFixed(2)}s - ${seg.end.toFixed(2)}s)`;
            headerEl.appendChild(badgeEl);
            
            const actionsEl = document.createElement('div');
            actionsEl.className = 'block-actions';
            
            const playBtn = document.createElement('button');
            playBtn.className = 'brutalist-button block-btn';
            playBtn.innerText = translations[currentLang].listen_btn;
            playBtn.addEventListener('click', () => {
                playSegmentPreview(seg.start, seg.end, playBtn);
            });
            actionsEl.appendChild(playBtn);
            
            const jumpBtn = document.createElement('button');
            jumpBtn.className = 'brutalist-button block-btn secondary-btn';
            jumpBtn.innerText = translations[currentLang].jump_btn;
            jumpBtn.addEventListener('click', () => {
                jumpToSegment(i);
            });
            actionsEl.appendChild(jumpBtn);
            
            headerEl.appendChild(actionsEl);
            blockEl.appendChild(headerEl);
            
            listContainer.appendChild(blockEl);
        });
    } else {
        let lastIndex = 0;
        const blocks = [];
        
        currentState.segments.forEach((seg, i) => {
            if (seg.text) {
                let foundIndex = -1;
                if (originalTranscription !== "") {
                    foundIndex = originalTranscription.indexOf(seg.text, lastIndex);
                    if (foundIndex === -1) {
                        foundIndex = originalTranscription.indexOf(seg.text);
                    }
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
        
        if (originalTranscription !== "" && lastIndex < originalTranscription.length) {
            blocks.push({
                type: 'unaligned',
                text: originalTranscription.substring(lastIndex)
            });
        }
        
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
                    return;
                }
            }
            
            listContainer.appendChild(blockEl);
        });
    }
    
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
    
    const listContainer = document.createElement('div');
    listContainer.className = 'alignments-list';
    
    currentState.segments.forEach((seg, i) => {
        const blockEl = document.createElement('div');
        blockEl.className = 'alignment-block aligned';
        blockEl.style.boxShadow = '4px 4px 0px var(--border-color)';
        
        const headerEl = document.createElement('div');
        headerEl.className = 'block-header';
        
        const badgeEl = document.createElement('span');
        badgeEl.className = 'block-badge';
        badgeEl.innerText = `${translations[currentLang].seg_badge_prefix}${i + 1} (${seg.start.toFixed(2)}s - ${seg.end.toFixed(2)}s)`;
        headerEl.appendChild(badgeEl);
        
        const actionsEl = document.createElement('div');
        actionsEl.className = 'block-actions';
        
        const playBtn = document.createElement('button');
        playBtn.className = 'brutalist-button block-btn';
        playBtn.innerText = translations[currentLang].listen_btn;
        playBtn.addEventListener('click', () => {
            playSegmentPreview(seg.start, seg.end, playBtn);
        });
        actionsEl.appendChild(playBtn);
        
        const jumpBtn = document.createElement('button');
        jumpBtn.className = 'brutalist-button block-btn secondary-btn';
        jumpBtn.innerText = translations[currentLang].correct_btn;
        jumpBtn.addEventListener('click', () => {
            closeCompletionModal();
            jumpToSegment(i);
        });
        actionsEl.appendChild(jumpBtn);
        
        headerEl.appendChild(actionsEl);
        blockEl.appendChild(headerEl);
        
        if (config.project_type !== 'segmentation') {
            const textEl = document.createElement('div');
            textEl.className = 'block-text';
            textEl.innerText = seg.text || '';
            blockEl.appendChild(textEl);
        }
        
        listContainer.appendChild(blockEl);
    });
    
    body.appendChild(listContainer);
    
    // Refresh translation labels dynamically in the completion modal
    if (window.updateLanguageUI) {
        window.updateLanguageUI();
    }
}
