import os
import json
import shutil
import csv
from flask import Flask, render_template, request, jsonify, send_from_directory, send_file, session, g, redirect, url_for, flash
from io import BytesIO, StringIO
from pydub import AudioSegment, silence
from werkzeug.utils import secure_filename
import functools
import database
import elan_exporter
import repository


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

def admin_required(view):
    @functools.wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            return redirect(url_for('login'))
        if not g.user.get('is_admin'):
            flash('Acceso denegado: Se requieren permisos de administrador.', 'error')
            return redirect(url_for('dashboard'))
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
    repo_summary = repository.get_repo_summary(app.config['UPLOAD_FOLDER'], g.user['id'])
    return render_template('dashboard.html', projects=projects, repo_summary=repo_summary)

@app.route('/user/panel', methods=['GET', 'POST'])
@login_required
def user_panel():
    if request.method == 'POST':
        lang = getattr(g, 'lang', 'es')
        action = request.form.get('action')
        if action == 'change_theme':
            theme = request.form.get('theme', 'neo-brutalist')
            if theme in ['neo-brutalist', 'clean-light', 'warm-earth']:
                database.update_user_theme(g.user['id'], theme)
                g.user['theme'] = theme
                flash('Estilo de tema actualizado correctamente.' if lang == 'es' else 'Theme style updated successfully.', 'success')
                return redirect(url_for('user_panel'))
        else:
            current_password = request.form.get('current_password', '')
            new_password = request.form.get('new_password', '')
            confirm_password = request.form.get('confirm_password', '')

            user = database.get_user_by_id(g.user['id'])
            if not user or not check_password_hash(user['password_hash'], current_password):
                flash('La contraseña actual es incorrecta.' if lang == 'es' else 'Current password is incorrect.', 'error')
            elif not new_password:
                flash('Por favor ingresa una nueva contraseña.' if lang == 'es' else 'Please enter a new password.', 'error')
            elif len(new_password) < 4:
                flash('La nueva contraseña debe tener al menos 4 caracteres.' if lang == 'es' else 'New password must be at least 4 characters long.', 'error')
            elif new_password != confirm_password:
                flash('Las contraseñas no coinciden.' if lang == 'es' else 'Passwords do not match.', 'error')
            else:
                database.update_user_password(g.user['id'], new_password)
                flash('Contraseña actualizada correctamente.' if lang == 'es' else 'Password updated successfully.', 'success')
                return redirect(url_for('user_panel'))

    return render_template('user_panel.html')

@app.route('/api/user/theme', methods=['POST'])
@login_required
def update_theme_api():
    data = request.json or {}
    theme = data.get('theme', 'neo-brutalist')
    if theme not in ['neo-brutalist', 'clean-light', 'warm-earth']:
        return jsonify({'error': 'Invalid theme'}), 400
    
    database.update_user_theme(g.user['id'], theme)
    g.user['theme'] = theme
    return jsonify({'status': 'success', 'theme': theme})

# --- User Repository Views & APIs ---

@app.route('/repository')
@login_required
def repository_view():
    path = request.args.get('path', '')
    return render_template('repository.html', initial_path=path)

@app.route('/api/repository/list')
@login_required
def api_repository_list():
    path = request.args.get('path', '')
    try:
        data = repository.list_repo_dir(app.config['UPLOAD_FOLDER'], g.user['id'], path)
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/repository/folder', methods=['POST'])
@login_required
def api_repository_create_folder():
    data = request.json or {}
    path = data.get('path', '')
    folder_name = data.get('name', '')
    try:
        new_rel = repository.create_repo_folder(app.config['UPLOAD_FOLDER'], g.user['id'], path, folder_name)
        return jsonify({'status': 'success', 'path': new_rel})
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/repository/upload', methods=['POST'])
@login_required
def api_repository_upload():
    path = request.form.get('path', '')
    files = request.files.getlist('files')
    if not files:
        single_file = request.files.get('file')
        if single_file:
            files = [single_file]
            
    if not files:
        return jsonify({'error': 'No files provided.'}), 400
        
    try:
        saved = repository.upload_repo_files(app.config['UPLOAD_FOLDER'], g.user['id'], path, files)
        return jsonify({'status': 'success', 'saved': saved})
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/repository/delete', methods=['POST'])
@login_required
def api_repository_delete():
    data = request.json or {}
    path = data.get('path', '')
    try:
        repository.delete_repo_item(app.config['UPLOAD_FOLDER'], g.user['id'], path)
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/repository/rename', methods=['POST'])
@login_required
def api_repository_rename():
    data = request.json or {}
    path = data.get('path', '')
    new_name = data.get('new_name', '')
    try:
        repository.rename_repo_item(app.config['UPLOAD_FOLDER'], g.user['id'], path, new_name)
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/repository/download')
@login_required
def repository_download():
    path = request.args.get('path', '')
    is_download = request.args.get('download', '1') == '1'
    try:
        target_path, clean_rel = repository.safe_join_user_repo(app.config['UPLOAD_FOLDER'], g.user['id'], path)
        if not os.path.exists(target_path) or os.path.isdir(target_path):
            flash('Archivo no encontrado.', 'error')
            return redirect(url_for('repository_view'))
        filename = os.path.basename(target_path)
        return send_file(target_path, as_attachment=is_download, download_name=filename)
    except Exception as e:
        flash(f'Error al acceder al archivo: {str(e)}', 'error')
        return redirect(url_for('repository_view'))


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
    if project.get('user_role') == 'viewer':
        flash('Acceso denegado: El rol de solo lectura no permite subir pistas.', 'error')
        return redirect(url_for('project_detail', project_id=project_id))
    
    audio_file = request.files.get('audio_file')
    text_file = request.files.get('text_file')
    repo_audio_path = request.form.get('repo_audio_path', '').strip()
    repo_text_path = request.form.get('repo_text_path', '').strip()
    
    has_audio_file = audio_file and audio_file.filename != ''
    if not has_audio_file and not repo_audio_path:
        flash('Audio file is required.', 'error')
        return redirect(url_for('project_detail', project_id=project_id))
        
    # Set up directory layout inside uploads/
    project_dir = os.path.join(app.config['UPLOAD_FOLDER'], 'projects', str(project_id))
    audio_dir = os.path.join(project_dir, 'audio')
    texts_dir = os.path.join(project_dir, 'texts')
    os.makedirs(audio_dir, exist_ok=True)
    os.makedirs(texts_dir, exist_ok=True)
    
    # System uploads directory inside user's repository
    sys_uploads_dir = os.path.join(
        repository.get_user_repo_base(app.config['UPLOAD_FOLDER'], g.user['id']),
        repository.SYSTEM_UPLOADS_DIR
    )
    os.makedirs(sys_uploads_dir, exist_ok=True)

    # 1. Save / Copy Audio File
    if repo_audio_path:
        try:
            source_audio_path, _ = repository.safe_join_user_repo(app.config['UPLOAD_FOLDER'], g.user['id'], repo_audio_path)
            if not os.path.exists(source_audio_path) or os.path.isdir(source_audio_path):
                flash('El archivo de audio seleccionado del repositorio no existe.', 'error')
                return redirect(url_for('project_detail', project_id=project_id))
            audio_filename = secure_filename(os.path.basename(source_audio_path))
            audio_local_path = os.path.join(audio_dir, audio_filename)
            shutil.copy(source_audio_path, audio_local_path)
            audio_db_path = f"projects/{project_id}/audio/{audio_filename}"
        except Exception as e:
            flash(f'Error al copiar el audio del repositorio: {str(e)}', 'error')
            return redirect(url_for('project_detail', project_id=project_id))
    else:
        audio_filename = secure_filename(audio_file.filename)
        repo_audio_target = os.path.join(sys_uploads_dir, audio_filename)
        audio_file.save(repo_audio_target)
        
        audio_local_path = os.path.join(audio_dir, audio_filename)
        shutil.copy(repo_audio_target, audio_local_path)
        audio_db_path = f"projects/{project_id}/audio/{audio_filename}"
        
    # 2. Save / Copy Text File (optional)
    text_db_path = ""
    if repo_text_path:
        try:
            source_text_path, _ = repository.safe_join_user_repo(app.config['UPLOAD_FOLDER'], g.user['id'], repo_text_path)
            if os.path.exists(source_text_path) and not os.path.isdir(source_text_path):
                text_filename = secure_filename(os.path.basename(source_text_path))
                text_local_path = os.path.join(texts_dir, text_filename)
                shutil.copy(source_text_path, text_local_path)
                text_db_path = f"projects/{project_id}/texts/{text_filename}"
        except Exception as e:
            print(f"Error copying text file from repository: {e}")
    elif text_file and text_file.filename != '':
        text_filename = secure_filename(text_file.filename)
        repo_text_target = os.path.join(sys_uploads_dir, text_filename)
        text_file.save(repo_text_target)
        
        text_local_path = os.path.join(texts_dir, text_filename)
        shutil.copy(repo_text_target, text_local_path)
        text_db_path = f"projects/{project_id}/texts/{text_filename}"
        
    repo_audio_rel = repo_audio_path if repo_audio_path else f"{repository.SYSTEM_UPLOADS_DIR}/{audio_filename}"

    # Default state structure
    default_state = {
        "audio_path": audio_db_path,
        "text_path": text_db_path,
        "repo_audio_path": repo_audio_rel,
        "segments": [],
        "current_idx": 0,
        "stage": 1
    }
    
    database.create_audio_item(project_id, audio_db_path, text_db_path, json.dumps(default_state))
    flash('Track added successfully!', 'success')
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
                           project_id=project['id'],
                           user_role=project.get('user_role', 'viewer'))

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
    if project.get('user_role') == 'viewer':
        return jsonify({"error": "Unauthorized: Read-only access"}), 403
        
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
        state = {}
        segments = []
        
    audio_filename = item['audio_path'].split('/')[-1]
    repo_audio_path = state.get('repo_audio_path')
    if not repo_audio_path:
        repo_audio_path = f"{repository.SYSTEM_UPLOADS_DIR}/{audio_filename}"
    
    export_segments = []
    for i, seg in enumerate(segments):
        cleaned_seg = {
            "id": seg.get("id", f"seg-{i}"),
            "start": round(seg.get("start", 0.0), 3),
            "end": round(seg.get("end", 0.0), 3)
        }
        if project['type'] != 'segmentation' and 'text' in seg:
            cleaned_seg["text"] = seg["text"]
        export_segments.append(cleaned_seg)
        
    export_data = {
        "audio_file": repo_audio_path,
        "segments": export_segments
    }
        
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

@app.route('/api/export_csv/<int:item_id>')
@login_required
def export_csv(item_id):
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
    
    has_text = project['type'] != 'segmentation'
    fieldnames = ["id", "start", "end"]
    if has_text:
        fieldnames.append("text")
        
    output = StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames, lineterminator='\n')
    writer.writeheader()
    
    for i, seg in enumerate(segments):
        row = {
            "id": seg.get("id", f"seg-{i}"),
            "start": round(seg.get("start", 0.0), 3),
            "end": round(seg.get("end", 0.0), 3)
        }
        if has_text:
            row["text"] = seg.get("text", "")
        writer.writerow(row)
        
    buffer = BytesIO()
    buffer.write(output.getvalue().encode('utf-8-sig'))
    buffer.seek(0)
    
    download_name = os.path.splitext(audio_filename)[0] + '.csv'
    return send_file(
        buffer, 
        mimetype="text/csv", 
        as_attachment=True, 
        download_name=download_name
    )

# --- Collaborators APIs ---

@app.route('/api/users/autocomplete')
@login_required
def users_autocomplete():
    query = request.args.get('q', '')
    if len(query) < 2:
        return jsonify([])
    users = database.search_users_for_autocomplete(query, g.user['id'])
    return jsonify(users)

@app.route('/api/project/<int:project_id>/collaborators')
@login_required
def list_project_collaborators(project_id):
    project = database.get_project(project_id, g.user['id'])
    if not project:
        return jsonify({"error": "Project not found or access denied"}), 403
    collabs = database.list_collaborators(project_id)
    return jsonify({
        "collaborators": collabs,
        "current_user_role": project['user_role']
    })

@app.route('/api/project/<int:project_id>/collaborators', methods=['POST'])
@login_required
def add_project_collaborator(project_id):
    project = database.get_project(project_id, g.user['id'])
    if not project:
        return jsonify({"error": "Project not found or access denied"}), 403
        
    if project['user_role'] != 'owner':
        return jsonify({"error": "Only the project owner can manage collaborators"}), 403
        
    data = request.json
    username = data.get('username')
    role = data.get('role', 'editor')
    
    if not username:
        return jsonify({"error": "Username is required"}), 400
    if role not in ['editor', 'viewer']:
        return jsonify({"error": "Invalid role"}), 400
        
    res = database.add_collaborator(project_id, username, role)
    if res['success']:
        return jsonify({"status": "success"})
    else:
        err = res['error']
        if err == 'user_not_found':
            return jsonify({"error": "User not found"}), 404
        elif err == 'is_owner':
            return jsonify({"error": "User is the owner of this project"}), 400
        elif err == 'already_collaborator':
            return jsonify({"error": "User is already a collaborator"}), 400
        return jsonify({"error": "Failed to add collaborator"}), 500

@app.route('/api/project/<int:project_id>/collaborators/<int:collab_user_id>', methods=['PUT'])
@login_required
def update_project_collaborator_role(project_id, collab_user_id):
    project = database.get_project(project_id, g.user['id'])
    if not project:
        return jsonify({"error": "Project not found or access denied"}), 403
        
    if project['user_role'] != 'owner':
        return jsonify({"error": "Only the project owner can manage collaborators"}), 403
        
    data = request.json
    role = data.get('role')
    if role not in ['editor', 'viewer']:
        return jsonify({"error": "Invalid role"}), 400
        
    if database.update_collaborator_role(project_id, collab_user_id, role):
        return jsonify({"status": "success"})
    return jsonify({"error": "Collaborator not found or not updated"}), 404

@app.route('/api/project/<int:project_id>/collaborators/<int:collab_user_id>', methods=['DELETE'])
@login_required
def delete_project_collaborator(project_id, collab_user_id):
    project = database.get_project(project_id, g.user['id'])
    if not project:
        return jsonify({"error": "Project not found or access denied"}), 403
        
    if project['user_role'] != 'owner':
        return jsonify({"error": "Only the project owner can manage collaborators"}), 403
        
    if database.delete_collaborator(project_id, collab_user_id):
        return jsonify({"status": "success"})
    return jsonify({"error": "Collaborator not found"}), 404


# --- Admin CRUD Routes ---

@app.route('/admin')
@admin_required
def admin_dashboard():
    users = database.list_all_users()
    projects = database.list_all_projects_admin()
    items = database.list_all_audio_items_admin()
    return render_template('admin/dashboard.html', users=users, projects=projects, items=items)

# Users CRUD
@app.route('/admin/users/create', methods=['GET', 'POST'])
@admin_required
def admin_create_user():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        is_admin = int(request.form.get('is_admin', 0))
        if not username or not password:
            flash('El usuario y la contraseña son requeridos.', 'error')
        else:
            user_id = database.create_user_admin(username, password, is_admin)
            if user_id is None:
                flash('El nombre de usuario ya existe.', 'error')
            else:
                flash('Usuario creado con éxito.', 'success')
                return redirect(url_for('admin_dashboard'))
                
    return render_template('admin/create_user.html')

@app.route('/admin/users/<int:user_id>/edit', methods=['GET', 'POST'])
@admin_required
def admin_edit_user(user_id):
    if request.method == 'POST':
        username = request.form.get('username')
        is_admin = int(request.form.get('is_admin', 0))
        if not username:
            flash('El nombre de usuario es requerido.', 'error')
        else:
            database.update_user_admin(user_id, username, is_admin)
            flash('Usuario actualizado con éxito.', 'success')
            return redirect(url_for('admin_dashboard'))
            
    u = database.get_user_by_id(user_id)
    if not u:
        flash('Usuario no encontrado.', 'error')
        return redirect(url_for('admin_dashboard'))
    return render_template('admin/edit_user.html', user_to_edit=u)

@app.route('/admin/users/<int:user_id>/delete', methods=['POST'])
@admin_required
def admin_delete_user(user_id):
    if user_id == g.user['id']:
        flash('No puedes eliminarte a ti mismo.', 'error')
    else:
        database.delete_user_admin(user_id)
        flash('Usuario eliminado.', 'success')
    return redirect(url_for('admin_dashboard'))

# Projects CRUD
@app.route('/admin/projects/<int:project_id>/edit', methods=['GET', 'POST'])
@admin_required
def admin_edit_project(project_id):
    if request.method == 'POST':
        name = request.form.get('name')
        description = request.form.get('description')
        project_type = request.form.get('type')
        user_id = int(request.form.get('user_id'))
        
        if not name:
            flash('El nombre del proyecto es requerido.', 'error')
        else:
            database.update_project_admin(project_id, name, description, project_type, user_id)
            flash('Proyecto actualizado con éxito.', 'success')
            return redirect(url_for('admin_dashboard'))
            
    p = database.get_project_admin(project_id)
    if not p:
        flash('Proyecto no encontrado.', 'error')
        return redirect(url_for('admin_dashboard'))
    users = database.list_all_users()
    return render_template('admin/edit_project.html', project_to_edit=p, users=users)

@app.route('/admin/projects/<int:project_id>/delete', methods=['POST'])
@admin_required
def admin_delete_project(project_id):
    database.delete_project_admin(project_id)
    flash('Proyecto eliminado.', 'success')
    return redirect(url_for('admin_dashboard'))

# Audio Items CRUD
@app.route('/admin/audio-items/<int:item_id>/edit', methods=['GET', 'POST'])
@admin_required
def admin_edit_audio_item(item_id):
    if request.method == 'POST':
        project_id = int(request.form.get('project_id'))
        audio_path = request.form.get('audio_path')
        text_path = request.form.get('text_path')
        state_json = request.form.get('state_json')
        
        if not audio_path:
            flash('La ruta del audio es requerida.', 'error')
        else:
            try:
                json.loads(state_json) if state_json else "{}"
                database.update_audio_item_admin(item_id, project_id, audio_path, text_path, state_json)
                flash('Pista de audio actualizada con éxito.', 'success')
                return redirect(url_for('admin_dashboard'))
            except ValueError:
                flash('El formato de state_json no es un JSON válido.', 'error')
                
    item = database.get_audio_item(item_id)
    if not item:
        flash('Pista de audio no encontrada.', 'error')
        return redirect(url_for('admin_dashboard'))
    projects = database.list_all_projects_admin()
    return render_template('admin/edit_audio_item.html', item_to_edit=item, projects=projects)

@app.route('/admin/audio-items/<int:item_id>/delete', methods=['POST'])
@admin_required
def admin_delete_audio_item(item_id):
    database.delete_audio_item(item_id)
    flash('Pista de audio eliminada.', 'success')
    return redirect(url_for('admin_dashboard'))

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
