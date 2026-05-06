let wsFull, wsSegment;
let regions;
let currentState = initialState || {
    audio_path: config.audio_path,
    text_path: config.text_path,
    segments: [],
    current_idx: 0,
    stage: 1
};

let currentSpeed = 1;

document.addEventListener('DOMContentLoaded', () => {
    initStage();
    setupEventListeners();
});

function initStage() {
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
    const response = await fetch(`/api/load_text?path=${currentState.text_path}`);
    const data = await response.json();
    originalTranscription = data.text;
    
    document.getElementById('total-segments').innerText = currentState.segments.length;
    renderTranscription();
}

function renderTranscription() {
    let text = originalTranscription;
    
    // Remove text assigned to OTHER segments
    currentState.segments.forEach((seg, i) => {
        if (i !== currentState.current_idx && seg.text) {
            // Replace first occurrence of the assigned text with an empty string
            // to handle duplicates correctly if they align in order.
            text = text.replace(seg.text, "");
        }
    });

    const container = document.getElementById('text-container');
    container.innerText = text;
    
    // Update metadata
    document.getElementById('current-segment-idx').innerText = currentState.current_idx + 1;
    const seg = currentState.segments[currentState.current_idx];
    document.getElementById('segment-duration').innerText = (seg.end - seg.start).toFixed(2);
}

function updateSegmentUI() {
    renderTranscription();

    const seg = currentState.segments[currentState.current_idx];
    // Reload the waveform with the new segment slice
    const segmentUrl = `/api/get_segment_audio?path=${currentState.audio_path}&start=${seg.start}&end=${seg.end}`;
    if (wsSegment) {
        wsSegment.load(segmentUrl);
    }
}

function assignText() {
    const selection = window.getSelection().toString();
    if (selection) {
        currentState.segments[currentState.current_idx].text = selection;
        saveState();
        nextSegment();
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
    await fetch('/api/save_state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentState)
    });
}

function updateProgress() {
    const total = currentState.segments.length;
    if (total === 0) return;
    const completed = currentState.segments.filter(s => s.text).length;
    const percent = Math.round((completed / total) * 100);
    document.getElementById('progress-bar').style.width = `${percent}%`;
    document.getElementById('progress-text').innerText = `${percent}%`;
}

function setupEventListeners() {
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

    document.getElementById('reset-seg-btn')?.addEventListener('click', () => {
        const confirmReset = confirm("¿Estás seguro de que quieres volver a la segmentación? Se perderá todo el texto asignado a los segmentos actuales.");
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
