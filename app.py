import os
import json
import yaml
from flask import Flask, render_template, request, jsonify, send_from_directory, send_file
from io import BytesIO
from pydub import AudioSegment, silence

app = Flask(__name__)
UPLOAD_FOLDER = 'uploads'
STATE_FILE = 'state.json'
CONFIG_FILE = 'config.json'

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

def load_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)
    return [] # Return list instead of dict

def load_state(project_id=None):
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, 'r') as f:
            try:
                full_state = json.load(f)
                if project_id:
                    return full_state.get(project_id, {})
                return full_state
            except:
                return {}
    return {}

def save_state(project_id, state):
    full_state = {}
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, 'r') as f:
            try:
                full_state = json.load(f)
            except:
                full_state = {}
    
    full_state[project_id] = state
    with open(STATE_FILE, 'w') as f:
        json.dump(full_state, f, indent=4)

@app.route('/')
def index():
    config = load_config()
    all_states = load_state()
    
    # Calculate progress for each project
    projects_with_progress = []
    for idx, item in enumerate(config):
        project_id = item['audio_path']
        state = all_states.get(project_id, {})
        
        segments = state.get('segments', [])
        total = len(segments)
        completed = len([s for s in segments if s.get('text')])
        progress = round((completed / total * 100)) if total > 0 else 0
        
        projects_with_progress.append({
            'idx': idx,
            'audio_path': item['audio_path'],
            'text_path': item['text_path'],
            'progress': progress,
            'completed_count': completed,
            'total_count': total
        })

    project_idx = request.args.get('p', type=int)
    state = None
    selected_config = None
    
    if project_idx is not None and 0 <= project_idx < len(config):
        selected_config = config[project_idx]
        project_id = selected_config['audio_path']
        state = all_states.get(project_id)
    
    return render_template('index.html', 
                           state=state, 
                           projects=projects_with_progress, 
                           selected_config=selected_config, 
                           project_idx=project_idx)

@app.route('/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/api/get_segment_audio')
def get_segment_audio():
    audio_path = request.args.get('path')
    start = float(request.args.get('start'))
    end = float(request.args.get('end'))
    
    full_path = os.path.join(app.config['UPLOAD_FOLDER'], audio_path)
    if not os.path.exists(full_path):
        return "File not found", 404
        
    audio = AudioSegment.from_file(full_path)
    segment = audio[int(start*1000):int(end*1000)]
    
    buffer = BytesIO()
    segment.export(buffer, format="mp3")
    buffer.seek(0)
    
    return send_file(buffer, mimetype="audio/mp3")

@app.route('/api/load_text', methods=['GET'])
def load_text():
    text_path = request.args.get('path')
    full_path = os.path.join(app.config['UPLOAD_FOLDER'], text_path)
    if os.path.exists(full_path):
        with open(full_path, 'r', encoding='utf-8') as f:
            return jsonify({"text": f.read()})
    return jsonify({"error": "File not found"}), 404

@app.route('/api/detect_segments', methods=['POST'])
def detect_segments():
    data = request.json
    audio_path = os.path.join(app.config['UPLOAD_FOLDER'], data.get('audio_path'))
    
    if not os.path.exists(audio_path):
        return jsonify({"error": "Audio file not found"}), 404
    
    audio = AudioSegment.from_file(audio_path)
    duration_ms = len(audio)
    
    # Detect silence to find potential split points
    # We look for silences of at least 700ms
    silences = silence.detect_silence(
        audio, 
        min_silence_len=500, 
        silence_thresh=audio.dBFS - 20
    )
    
    # Convert silences to split points (middle of silence)
    split_points = [0]
    for start, end in silences:
        split_points.append(start + (end - start) / 2)
    split_points.append(duration_ms)
    
    # Group split points into segments based on target_duration
    segments = []
    current_start = 0
    target_duration = data.get('target_duration', 25) * 1000 # Default to 25s if not provided

    for i in range(1, len(split_points)):
        point = split_points[i]
        if (point - current_start) >= target_duration or i == len(split_points) - 1:
            segments.append({
                "start": current_start / 1000.0, 
                "end": point / 1000.0
            })
            current_start = point

        
    return jsonify({"segments": segments})

@app.route('/api/save_state', methods=['POST'])
def save_state_api():
    data = request.json
    project_id = data.get('audio_path')
    save_state(project_id, data)
    return jsonify({"status": "success"})

if __name__ == '__main__':
    app.run(debug=True, port=5000)
