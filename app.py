import os
import json
from flask import Flask, render_template, request, jsonify, send_from_directory, send_file, session, g, redirect, url_for, flash
from io import BytesIO
from pydub import AudioSegment, silence
from werkzeug.utils import secure_filename
import functools
import database
import elan_exporter

app = Flask(__name__)
app.secret_key = 'aligner-secret-session-key' # Change to a secure random string in production
UPLOAD_FOLDER = 'uploads'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

ALLOW_REGISTRATION = os.environ.get('ALLOW_REGISTRATION', 'true').lower() == 'true'

@app.context_processor
def inject_registration_status():
    return dict(allow_registration=ALLOW_REGISTRATION)

# Initialize SQLite database and tables
database.init_db()

# Ensure base uploads directory exists
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Helper function to seed default projects for a new user
def seed_default_project(user_id):
    config_file = 'config.json'
    state_file = 'state.json'
    
    if os.path.exists(config_file):
        try:
            with open(config_file, 'r') as f:
                config_data = json.load(f)
            
            state_data = {}
            if os.path.exists(state_file):
                with open(state_file, 'r') as f:
                    try:
                        state_data = json.load(f)
                    except:
                        state_data = {}
                        
            project_id = database.create_project(
                "Toba Bible (Imported)", 
                "Migrated automatically from local JSON config & state.", 
                "alignment",
                user_id
            )
            
            for item in config_data:
                audio_path = item.get('audio_path')
                text_path = item.get('text_path')
                
                # Fetch state if exists
                item_state = state_data.get(audio_path, {
                    "audio_path": audio_path,
                    "text_path": text_path,
                    "segments": [],
                    "current_idx": 0,
                    "stage": 1
                })
                item_state['audio_path'] = audio_path
                item_state['text_path'] = text_path
                
                database.create_audio_item(project_id, audio_path, text_path, json.dumps(item_state))
        except Exception as e:
            print(f"Error seeding database: {e}")

# --- Authentication Middleware & Hooks ---

@app.before_request
def load_logged_in_user():
    user_id = session.get('user_id')
    if user_id is None:
        g.user = None
    else:
        g.user = database.get_user_by_id(user_id)

def login_required(view):
    @functools.wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            return redirect(url_for('login'))
        return view(**kwargs)
    return wrapped_view

# --- Auth Routes ---

@app.route('/register', methods=['GET', 'POST'])
def register():
    if not ALLOW_REGISTRATION:
        flash('El registro de nuevos usuarios está deshabilitado en este servidor.', 'error')
        return redirect(url_for('login'))
        
    if g.user:
        return redirect(url_for('dashboard'))
        
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        if not username or not password:
            flash('All fields are required.', 'error')
            return render_template('register.html')
            
        user_id = database.create_user(username, password)
        if user_id is None:
            flash('Username already exists.', 'error')
            return render_template('register.html')
            
        # Seed default project if local JSON files are found
        seed_default_project(user_id)
        
        flash('Account created successfully! Please sign in.', 'success')
        return redirect(url_for('login'))
        
    return render_template('register.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if g.user:
        return redirect(url_for('dashboard'))
        
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        user = database.verify_user(username, password)
        if user is None:
            flash('Invalid username or password.', 'error')
            return render_template('login.html')
            
        session.clear()
        session['user_id'] = user['id']
        return redirect(url_for('dashboard'))
        
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    flash('Logged out successfully.', 'success')
    return redirect(url_for('login'))

# --- Dashboard & Project Views ---

@app.route('/')
@login_required
def index():
    return redirect(url_for('dashboard'))

@app.route('/dashboard')
@login_required
def dashboard():
    projects = database.list_projects(g.user['id'])
    return render_template('dashboard.html', projects=projects)

@app.route('/project/create', methods=['POST'])
@login_required
def create_project():
    name = request.form.get('name')
    description = request.form.get('description')
    project_type = request.form.get('type', 'alignment')
    if name:
        database.create_project(name, description, project_type, g.user['id'])
        flash('Project created successfully!', 'success')
    else:
        flash('Project name is required.', 'error')
    return redirect(url_for('dashboard'))

@app.route('/project/<int:project_id>')
@login_required
def project_detail(project_id):
    project = database.get_project(project_id, g.user['id'])
    if not project:
        flash('Project not found.', 'error')
        return redirect(url_for('dashboard'))
    
    items = database.list_audio_items(project_id)
    items_with_progress = []
    
    for item in items:
        try:
            state = json.loads(item['state_json'])
        except:
            state = {}
            
        segments = state.get('segments', [])
        total = len(segments)
        if project['type'] == 'segmentation':
            stage = state.get('stage', 1)
            completed = total if stage == 2 else 0
            progress = 100 if stage == 2 else 0
        else:
            completed = len([s for s in segments if s.get('text')])
            progress = round((completed / total * 100)) if total > 0 else 0
        
        items_with_progress.append({
            'id': item['id'],
            'audio_path': item['audio_path'],
            'text_path': item['text_path'],
            'progress': progress,
            'completed_count': completed,
            'total_count': total
        })
        
    return render_template('project_detail.html', project=project, items=items_with_progress)

@app.route('/project/<int:project_id>/delete', methods=['POST'])
@login_required
def delete_project(project_id):
    if database.delete_project(project_id, g.user['id']):
        flash('Project deleted successfully.', 'success')
    else:
        flash('Failed to delete project.', 'error')
    return redirect(url_for('dashboard'))

@app.route('/project/<int:project_id>/upload', methods=['POST'])
@login_required
def upload_track(project_id):
    project = database.get_project(project_id, g.user['id'])
    if not project:
        flash('Project not found.', 'error')
        return redirect(url_for('dashboard'))
    
    audio_file = request.files.get('audio_file')
    text_file = request.files.get('text_file')
    
    if not audio_file or audio_file.filename == '':
        flash('Audio file is required.', 'error')
        return redirect(url_for('project_detail', project_id=project_id))
        
    # Set up directory layout inside uploads/
    project_dir = os.path.join(app.config['UPLOAD_FOLDER'], 'projects', str(project_id))
    audio_dir = os.path.join(project_dir, 'audio')
    texts_dir = os.path.join(project_dir, 'texts')
    os.makedirs(audio_dir, exist_ok=True)
    os.makedirs(texts_dir, exist_ok=True)
    
    # Save audio file
    audio_filename = secure_filename(audio_file.filename)
    audio_local_path = os.path.join(audio_dir, audio_filename)
    audio_file.save(audio_local_path)
    audio_db_path = f"projects/{project_id}/audio/{audio_filename}"
    
    # Save text file (optional)
    text_db_path = ""
    if text_file and text_file.filename != '':
        text_filename = secure_filename(text_file.filename)
        text_local_path = os.path.join(texts_dir, text_filename)
        text_file.save(text_local_path)
        text_db_path = f"projects/{project_id}/texts/{text_filename}"
        
    # Default state structure
    default_state = {
        "audio_path": audio_db_path,
        "text_path": text_db_path,
        "segments": [],
        "current_idx": 0,
        "stage": 1
    }
    
    database.create_audio_item(project_id, audio_db_path, text_db_path, json.dumps(default_state))
    flash('Track uploaded successfully!', 'success')
    return redirect(url_for('project_detail', project_id=project_id))

# --- Editor View ---

@app.route('/align/<int:item_id>')
@login_required
def align(item_id):
    item = database.get_audio_item(item_id)
    if not item:
        flash('Track not found.', 'error')
        return redirect(url_for('dashboard'))
    
    project = database.get_project(item['project_id'], g.user['id'])
    if not project:
        flash('Unauthorized access.', 'error')
        return redirect(url_for('dashboard'))
        
    try:
        state = json.loads(item['state_json'])
    except:
        state = None
        
    selected_config = {
        "audio_path": item['audio_path'],
        "text_path": item['text_path'],
        "item_id": item['id'],
        "project_type": project['type']
    }
    
    return render_template('index.html',
                           state=state,
                           selected_config=selected_config,
                           project_id=project['id'])

# --- Serving Uploaded Files ---

@app.route('/uploads/<path:filename>')
@login_required
def uploaded_file(filename):
    # Security: check if file is within project boundaries or is a legacy file
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# --- Alignment & Silence Detection API ---

@app.route('/api/get_segment_audio')
@login_required
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
@login_required
def load_text():
    text_path = request.args.get('path')
    if not text_path:
        return jsonify({"text": ""})
        
    full_path = os.path.join(app.config['UPLOAD_FOLDER'], text_path)
    if os.path.exists(full_path):
        with open(full_path, 'r', encoding='utf-8') as f:
            return jsonify({"text": f.read()})
    return jsonify({"error": "File not found"}), 404

@app.route('/api/detect_segments', methods=['POST'])
@login_required
def detect_segments():
    data = request.json
    audio_path = os.path.join(app.config['UPLOAD_FOLDER'], data.get('audio_path'))
    
    if not os.path.exists(audio_path):
        return jsonify({"error": "Audio file not found"}), 404
    
    audio = AudioSegment.from_file(audio_path)
    duration_ms = len(audio)
    
    # Custom silence parameters from user or defaults
    min_silence_len = int(data.get('min_silence_len', 500))
    silence_thresh_offset = int(data.get('silence_thresh', -20)) # default: 20dB below average
    
    # Detect silence to find potential split points
    silences = silence.detect_silence(
        audio, 
        min_silence_len=min_silence_len, 
        silence_thresh=audio.dBFS + silence_thresh_offset
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
@login_required
def save_state_api():
    data = request.json
    item_id = data.get('item_id')
    
    item = database.get_audio_item(item_id)
    if not item:
        return jsonify({"error": "Track not found"}), 404
        
    project = database.get_project(item['project_id'], g.user['id'])
    if not project:
        return jsonify({"error": "Unauthorized"}), 403
        
    database.update_audio_item_state(item_id, json.dumps(data))
    return jsonify({"status": "success"})

# --- ELAN Export API ---

@app.route('/api/export_elan/<int:item_id>')
@login_required
def export_elan(item_id):
    item = database.get_audio_item(item_id)
    if not item:
        flash('Track not found.', 'error')
        return redirect(url_for('dashboard'))
        
    project = database.get_project(item['project_id'], g.user['id'])
    if not project:
        flash('Unauthorized.', 'error')
        return redirect(url_for('dashboard'))
        
    try:
        state = json.loads(item['state_json'])
        segments = state.get('segments', [])
    except:
        segments = []
        
    audio_filename = item['audio_path'].split('/')[-1]
    xml_data = elan_exporter.export_elan_xml(audio_filename, segments)
    
    buffer = BytesIO()
    buffer.write(xml_data.encode('utf-8'))
    buffer.seek(0)
    
    download_name = os.path.splitext(audio_filename)[0] + '.eaf'
    return send_file(
        buffer, 
        mimetype="text/xml", 
        as_attachment=True, 
        download_name=download_name
    )

@app.route('/api/export_json/<int:item_id>')
@login_required
def export_json(item_id):
    item = database.get_audio_item(item_id)
    if not item:
        flash('Track not found.', 'error')
        return redirect(url_for('dashboard'))
        
    project = database.get_project(item['project_id'], g.user['id'])
    if not project:
        flash('Unauthorized.', 'error')
        return redirect(url_for('dashboard'))
        
    try:
        state = json.loads(item['state_json'])
        segments = state.get('segments', [])
    except:
        segments = []
        
    audio_filename = item['audio_path'].split('/')[-1]
    
    export_data = []
    for i, seg in enumerate(segments):
        cleaned_seg = {
            "id": seg.get("id", f"seg-{i}"),
            "start": round(seg.get("start", 0.0), 3),
            "end": round(seg.get("end", 0.0), 3)
        }
        if project['type'] != 'segmentation' and 'text' in seg:
            cleaned_seg["text"] = seg["text"]
        export_data.append(cleaned_seg)
        
    buffer = BytesIO()
    buffer.write(json.dumps(export_data, indent=2, ensure_ascii=False).encode('utf-8'))
    buffer.seek(0)
    
    download_name = os.path.splitext(audio_filename)[0] + '.json'
    return send_file(
        buffer, 
        mimetype="application/json", 
        as_attachment=True, 
        download_name=download_name
    )

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
