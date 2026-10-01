import os
import json
import shutil
import subprocess
import csv
import urllib.parse
import requests
from flask import Flask, render_template, request, jsonify, send_from_directory, send_file, session, g, redirect, url_for, flash
from io import BytesIO, StringIO
from pydub import AudioSegment, silence
from werkzeug.utils import secure_filename
import functools
import database
import elan_exporter
import repository
import v2_repository


try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from werkzeug.middleware.proxy_fix import ProxyFix

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1, x_prefix=1)
app.secret_key = 'aligner-secret-session-key' # Change to a secure random string in production
UPLOAD_FOLDER = 'uploads'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

ALLOW_REGISTRATION = os.environ.get('ALLOW_REGISTRATION', 'true').lower() == 'true'
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '').strip()
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '').strip()

@app.context_processor
def inject_registration_status():
    return dict(
        allow_registration=ALLOW_REGISTRATION,
        google_auth_enabled=bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)
    )

# Initialize SQLite database and tables
database.init_db()

# Ensure base uploads directory exists
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

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
            
        flash('Account created successfully! Please sign in.', 'success')
        return redirect(url_for('login'))
        
    return render_template('register.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if g.user:
        return redirect(url_for('v2_dashboard'))
        
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        user = database.verify_user(username, password)
        if user is None:
            flash('Invalid username or password.', 'error')
            return render_template('login.html')
            
        session.clear()
        session['user_id'] = user['id']
        return redirect(url_for('v2_dashboard'))
        
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    flash('Logged out successfully.', 'success')
    return redirect(url_for('login'))

@app.route('/auth/google')
def auth_google():
    if not GOOGLE_CLIENT_ID:
        flash('La autenticación con Google no está configurada en el servidor (falta GOOGLE_CLIENT_ID).', 'error')
        return redirect(url_for('login'))
        
    redirect_uri = url_for('google_callback', _external=True)
    google_auth_url = (
        "https://accounts.google.com/o/oauth2/v2/auth?" +
        urllib.parse.urlencode({
            "client_id": GOOGLE_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "prompt": "select_account"
        })
    )
    return redirect(google_auth_url)

@app.route('/auth/google/callback')
def google_callback():
    code = request.args.get('code')
    error = request.args.get('error')
    
    if error or not code:
        flash('Ocurrió un error o se canceló el inicio de sesión con Google.', 'error')
        return redirect(url_for('login'))
        
    redirect_uri = url_for('google_callback', _external=True)
    
    try:
        # Exchange authorization code for tokens
        token_resp = requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri
            },
            timeout=10
        )
        
        if token_resp.status_code != 200:
            flash('No se pudo verificar el token con Google.', 'error')
            return redirect(url_for('login'))
            
        token_data = token_resp.json()
        access_token = token_data.get('access_token')
        
        # Fetch user info from Google
        user_info_resp = requests.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10
        )
        
        if user_info_resp.status_code != 200:
            flash('No se pudo obtener el perfil de usuario de Google.', 'error')
            return redirect(url_for('login'))
            
        user_info = user_info_resp.json()
        google_id = user_info.get('sub')
        email = user_info.get('email')
        name = user_info.get('name') or (email.split('@')[0] if email else 'User')
        
        if not google_id:
            flash('Respuesta de autenticación de Google no válida.', 'error')
            return redirect(url_for('login'))
            
        # 1. Lookup user by google_id
        user = database.get_user_by_google_id(google_id)
        
        # 2. Lookup user by email and link google_id if exists
        if not user and email:
            user = database.get_user_by_email(email)
            if user:
                database.link_google_id(user['id'], google_id)
                user['google_id'] = google_id
                
        # 3. Register new user if not found
        if not user:
            if not ALLOW_REGISTRATION:
                flash('El registro de nuevos usuarios está deshabilitado en este servidor.', 'error')
                return redirect(url_for('login'))
                
            user_id = database.create_google_user(username=name, email=email, google_id=google_id)
            if not user_id:
                flash('No se pudo crear la cuenta con Google.', 'error')
                return redirect(url_for('login'))
                
            user = database.get_user_by_id(user_id)
            
        session.clear()
        session['user_id'] = user['id']
        flash('¡Sesión iniciada correctamente con Google!', 'success')
        return redirect(url_for('v2_dashboard'))
        
    except Exception as e:
        flash(f'Error al conectar con Google: {str(e)}', 'error')
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


def get_project_text_tracks(project):
    p_type = project['type']
    tracks = [{"id": "src", "label": "Transcripción (Origen)", "role": "source"}]
    
    desc = project.get('description') or ''
    langs = []
    if '[Langs:' in desc:
        try:
            langs_str = desc.split('[Langs:')[1].split(']')[0].strip()
            langs = [l.strip().upper() for l in langs_str.split(',') if l.strip()]
        except Exception:
            pass
            
    if not langs and p_type in ('multimodal', 'text_translation'):
        langs = ['ES']
        
    for lang in langs:
        lang_id = f"trans_{lang.lower()}"
        tracks.append({
            "id": lang_id,
            "label": f"Traducción ({lang})",
            "role": "translation",
            "lang": lang.lower()
        })
        
    return tracks

@app.route('/project/create', methods=['POST'])
@login_required
def create_project():
    name = request.form.get('name')
    description = request.form.get('description', '')
    project_type = request.form.get('type', 'alignment')
    translation_langs = request.form.get('translation_langs', '').strip()
    
    if translation_langs:
        description = f"{description} [Langs: {translation_langs}]".strip()
        
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
    
    if project.get('type') == 'multichannel_v2':
        return redirect(url_for('editor_v2', project_id=project_id))
    
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
            completed = len([s for s in segments if s.get('text') or (s.get('texts') and any(s.get('texts').values()))])
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
    
    p_type = project['type']
    is_text_only = (p_type == 'text_translation')
    
    audio_file = request.files.get('audio_file')
    text_file = request.files.get('text_file')
    repo_audio_path = request.form.get('repo_audio_path', '').strip()
    repo_text_path = request.form.get('repo_text_path', '').strip()
    
    has_audio_file = audio_file and audio_file.filename != ''
    if not is_text_only and not has_audio_file and not repo_audio_path:
        flash('Audio file is required for this project type.', 'error')
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

    # 1. Save / Copy Audio File (if present or required)
    audio_db_path = ""
    audio_filename = ""
    if repo_audio_path:
        try:
            source_audio_path, _ = repository.safe_join_user_repo(app.config['UPLOAD_FOLDER'], g.user['id'], repo_audio_path)
            if os.path.exists(source_audio_path) and not os.path.isdir(source_audio_path):
                audio_filename = secure_filename(os.path.basename(source_audio_path))
                audio_local_path = os.path.join(audio_dir, audio_filename)
                shutil.copy(source_audio_path, audio_local_path)
                audio_db_path = f"projects/{project_id}/audio/{audio_filename}"
        except Exception as e:
            flash(f'Error al copiar el audio del repositorio: {str(e)}', 'error')
            return redirect(url_for('project_detail', project_id=project_id))
    elif has_audio_file:
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
        
    repo_audio_rel = repo_audio_path if repo_audio_path else (f"{repository.SYSTEM_UPLOADS_DIR}/{audio_filename}" if audio_filename else "")

    text_tracks = get_project_text_tracks(project)
    has_audio = bool(audio_db_path)
    initial_stage = 1 if has_audio else 2

    # Default state structure v2.0
    default_state = {
        "version": "2.0",
        "project_type": p_type,
        "schema": {
            "has_audio": has_audio,
            "audio_tracks": [
                {
                    "id": "audio_main",
                    "label": "Audio Principal",
                    "db_path": audio_db_path
                }
            ] if has_audio else [],
            "text_tracks": text_tracks
        },
        "metadata": {
            "stage": initial_stage,
            "current_idx": 0
        },
        "audio_path": audio_db_path,
        "text_path": text_db_path,
        "repo_audio_path": repo_audio_rel,
        "segments": [],
        "current_idx": 0,
        "stage": initial_stage
    }
    
    database.create_audio_item(project_id, audio_db_path, text_db_path, json.dumps(default_state))
    flash('Item added successfully!', 'success')
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

def ensure_web_compatible_audio(file_path):
    """
    Checks if an audio file has sample rates or formats that standard web browsers
    cannot decode (e.g. sample_rate > 48kHz, 24-bit/32-bit integer PCM).
    If incompatible, generates an optimized web-compatible MP3 (44.1kHz / 96k)
    while preserving the original file intact on disk.
    Returns the path to the web-compatible audio file.
    """
    if not os.path.exists(file_path):
        return file_path

    ext = os.path.splitext(file_path)[1].lower()
    if ext not in ['.wav', '.flac', '.aiff', '.aif', '.ogg', '.m4a']:
        return file_path

    cmd = [
        'ffprobe', '-v', 'error',
        '-select_streams', 'a:0',
        '-show_entries', 'stream=sample_rate,codec_name,sample_fmt',
        '-of', 'json', file_path
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        info = json.loads(res.stdout).get('streams', [{}])[0]
        sr = int(info.get('sample_rate', 0))
        fmt = info.get('sample_fmt', '')
    except Exception as e:
        print(f"Warning: ffprobe failed on {file_path}: {e}")
        return file_path

    is_incompatible = (sr > 48000) or ('32' in fmt and 'flt' not in fmt) or ('24' in fmt)
    if not is_incompatible:
        return file_path

    web_path = os.path.splitext(file_path)[0] + '.web.mp3'
    if not os.path.exists(web_path) or os.path.getmtime(file_path) > os.path.getmtime(web_path):
        try:
            cmd_conv = [
                'ffmpeg', '-y', '-v', 'error',
                '-i', file_path,
                '-ar', '44100',
                '-ac', '1',
                '-b:a', '96k',
                web_path
            ]
            subprocess.run(cmd_conv, check=True, timeout=60)
            print(f"Generated web-compatible audio: {web_path}")
        except Exception as e:
            print(f"Error converting audio to web format for {file_path}: {e}")
            return file_path

    return web_path

# --- Serving Uploaded Files ---

@app.route('/uploads/<path:filename>')
@login_required
def uploaded_file(filename):
    # Security: check if file is within project boundaries or is a legacy file
    upload_folder = app.config['UPLOAD_FOLDER']
    target_path = os.path.join(upload_folder, filename)
    if not os.path.exists(target_path) and g.user:
        sys_uploads = os.path.join(
            repository.get_user_repo_base(upload_folder, g.user['id']),
            repository.SYSTEM_UPLOADS_DIR,
            filename
        )
        if os.path.exists(sys_uploads):
            upload_folder = os.path.dirname(sys_uploads)
            filename = os.path.basename(sys_uploads)
            target_path = sys_uploads

    # Automatically detect if audio requires a web-compatible version
    if os.path.exists(target_path):
        web_version = ensure_web_compatible_audio(target_path)
        if web_version != target_path and os.path.exists(web_version):
            upload_folder = os.path.dirname(web_version)
            filename = os.path.basename(web_version)

    mimetype = None
    lower_fn = filename.lower()
    if lower_fn.endswith('.wav'):
        mimetype = 'audio/wav'
    elif lower_fn.endswith('.mp3'):
        mimetype = 'audio/mpeg'
    elif lower_fn.endswith('.ogg'):
        mimetype = 'audio/ogg'
    elif lower_fn.endswith('.flac'):
        mimetype = 'audio/flac'

    return send_from_directory(upload_folder, filename, mimetype=mimetype, conditional=True)

# --- Alignment & Silence Detection API ---

@app.route('/api/get_segment_audio')
@login_required
def get_segment_audio():
    audio_path = request.args.get('path', '')
    try:
        start = float(request.args.get('start', 0))
    except (ValueError, TypeError):
        start = 0.0
    try:
        end = float(request.args.get('end', 0))
    except (ValueError, TypeError):
        end = 0.0

    if not audio_path:
        return "Missing path parameter", 400

    candidates = [
        os.path.join(app.config['UPLOAD_FOLDER'], audio_path),
        os.path.join(app.config['UPLOAD_FOLDER'], os.path.basename(audio_path)),
    ]
    if g.user:
        sys_uploads = os.path.join(
            repository.get_user_repo_base(app.config['UPLOAD_FOLDER'], g.user['id']),
            repository.SYSTEM_UPLOADS_DIR,
            os.path.basename(audio_path)
        )
        candidates.append(sys_uploads)

    full_path = None
    for cand in candidates:
        if os.path.exists(cand) and not os.path.isdir(cand):
            full_path = cand
            break

    if not full_path:
        return "File not found", 404

    try:
        audio = AudioSegment.from_file(full_path)
        audio_len = len(audio) / 1000.0

        if end <= 0 or end > audio_len:
            end = audio_len
        if start < 0:
            start = 0.0

        if start >= end:
            segment = audio[0:100]
        else:
            segment = audio[int(start * 1000):int(end * 1000)]

        buffer = BytesIO()
        segment.export(buffer, format="mp3")
        buffer.seek(0)
        return send_file(buffer, mimetype="audio/mp3")
    except Exception as e:
        return jsonify({"error": str(e)}), 500


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
    data = request.json or {}
    raw_path = data.get('audio_path', '')
    audio_path = os.path.join(app.config['UPLOAD_FOLDER'], raw_path)
    
    if not os.path.exists(audio_path):
        alt_path = os.path.join(app.config['UPLOAD_FOLDER'], 'System Uploads', os.path.basename(raw_path))
        if os.path.exists(alt_path):
            audio_path = alt_path
        else:
            repo_base = repository.get_user_repo_base(app.config['UPLOAD_FOLDER'], g.user['id'])
            alt_repo_path = os.path.join(repo_base, 'System Uploads', os.path.basename(raw_path))
            if os.path.exists(alt_repo_path):
                audio_path = alt_repo_path
            else:
                return jsonify({"error": f"Audio file not found: {raw_path}"}), 404
    
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
        schema = state.get('schema', {})
        text_tracks = schema.get('text_tracks')
    except:
        segments = []
        text_tracks = None
        
    audio_filename = item['audio_path'].split('/')[-1] if item['audio_path'] else "track.mp3"
    xml_data = elan_exporter.export_elan_xml(audio_filename, segments, text_tracks=text_tracks)
    
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
        schema = state.get('schema', {})
        text_tracks = schema.get('text_tracks', [])
    except:
        state = {}
        segments = []
        text_tracks = []
        
    audio_filename = item['audio_path'].split('/')[-1] if item['audio_path'] else ""
    repo_audio_path = state.get('repo_audio_path')
    if not repo_audio_path and audio_filename:
        repo_audio_path = f"{repository.SYSTEM_UPLOADS_DIR}/{audio_filename}"
    
    export_segments = []
    for i, seg in enumerate(segments):
        start_val = seg.get("start", 0.0)
        end_val = seg.get("end", 0.0)
        if isinstance(seg.get("audio"), dict):
            start_val = seg["audio"].get("start", start_val)
            end_val = seg["audio"].get("end", end_val)
            
        cleaned_seg = {
            "id": seg.get("id", f"seg-{i}"),
            "start": round(float(start_val), 3),
            "end": round(float(end_val), 3)
        }
        
        if 'texts' in seg and isinstance(seg['texts'], dict):
            cleaned_seg["texts"] = seg["texts"]
        elif 'text' in seg:
            cleaned_seg["texts"] = {"src": seg["text"]}
            
        export_segments.append(cleaned_seg)
        
    export_data = {
        "audio_file": repo_audio_path,
        "schema": schema,
        "segments": export_segments
    }
        
    buffer = BytesIO()
    buffer.write(json.dumps(export_data, indent=2, ensure_ascii=False).encode('utf-8'))
    buffer.seek(0)
    
    download_name = (os.path.splitext(audio_filename)[0] if audio_filename else f"item_{item_id}") + '.json'
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
        schema = state.get('schema', {})
        text_tracks = schema.get('text_tracks', [{"id": "src", "label": "Text"}])
    except:
        segments = []
        text_tracks = [{"id": "src", "label": "Text"}]
        
    audio_filename = item['audio_path'].split('/')[-1] if item['audio_path'] else ""
    
    fieldnames = ["id", "start", "end"] + [track.get('id', 'src') for track in text_tracks]
        
    output = StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames, lineterminator='\n')
    writer.writeheader()
    
    for i, seg in enumerate(segments):
        start_val = seg.get("start", 0.0)
        end_val = seg.get("end", 0.0)
        if isinstance(seg.get("audio"), dict):
            start_val = seg["audio"].get("start", start_val)
            end_val = seg["audio"].get("end", end_val)
            
        row = {
            "id": seg.get("id", f"seg-{i}"),
            "start": round(float(start_val), 3),
            "end": round(float(end_val), 3)
        }
        
        texts_map = seg.get("texts") if isinstance(seg.get("texts"), dict) else {}
        for track in text_tracks:
            t_id = track.get('id', 'src')
            row[t_id] = texts_map.get(t_id, seg.get("text", "") if t_id == "src" else "")
            
        writer.writerow(row)
        
    buffer = BytesIO()
    buffer.write(output.getvalue().encode('utf-8-sig'))
    buffer.seek(0)
    
    download_name = (os.path.splitext(audio_filename)[0] if audio_filename else f"item_{item_id}") + '.csv'
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

# --- Module V2 Routes & API ---

@app.route('/v2/')
@login_required
def v2_dashboard():
    v2_projects = database.list_v2_user_projects(g.user['id'])
    return render_template('v2/dashboard_v2.html', 
                           owned_projects=v2_projects['owned'], 
                           shared_projects=v2_projects['shared'])

@app.route('/v2/project/create', methods=['POST'])
@login_required
def v2_create_project():
    name = request.form.get('name', '').strip()
    description = request.form.get('description', '').strip()
    project_type = request.form.get('project_type', 'empty').strip()
    
    if name:
        project_id = database.create_project(name, description, 'multichannel_v2', g.user['id'])
        database.initialize_project_channels(project_id, project_type)
        flash('¡Proyecto multicanal creado con éxito!', 'success')
        return redirect(url_for('editor_v2', project_id=project_id))
    else:
        flash('El nombre del proyecto es requerido.', 'error')
        return redirect(url_for('v2_dashboard'))

@app.route('/editor_v2/<int:project_id>')
@login_required
def editor_v2(project_id):
    project = v2_repository.get_v2_project_data(project_id, g.user['id'])
    if not project:
        flash('Proyecto no encontrado o sin acceso.', 'error')
        return redirect(url_for('v2_dashboard'))
    return render_template('editor_v2.html', project=project)

@app.route('/api/v2/project/<int:project_id>')
@login_required
def api_v2_get_project(project_id):
    project = v2_repository.get_v2_project_data(project_id, g.user['id'])
    if not project:
        return jsonify({'error': 'Project not found'}), 404
    return jsonify({'project': project})

@app.route('/api/v2/project/<int:project_id>/import', methods=['POST'])
@login_required
def api_v2_import_project(project_id):
    project = database.get_project(project_id, g.user['id'])
    if not project:
        return jsonify({'error': 'Project not found'}), 404
    
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No JSON payload provided'}), 400
    
    try:
        json_data = data.get('project', data)
        v2_repository.import_project_json(project_id, json_data)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/v2/project/<int:project_id>/export')
@login_required
def api_v2_export_project(project_id):
    project = database.get_project(project_id, g.user['id'])
    if not project:
        return jsonify({'error': 'Project not found'}), 404
    
    data = v2_repository.export_project_json(project_id)
    return jsonify(data)

@app.route('/api/v2/match/save', methods=['POST'])
@login_required
def api_v2_save_match():
    data = request.get_json() or {}
    project_id = data.get('project_id')
    segment_ids = data.get('segment_ids', [])
    
    if not project_id or not segment_ids:
        return jsonify({'error': 'project_id and segment_ids required'}), 400
        
    try:
        match_id = v2_repository.create_match_group(project_id, segment_ids)
        return jsonify({'success': True, 'match_id': match_id})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/v2/match/<int:match_id>/delete', methods=['POST'])
@login_required
def api_v2_delete_match(match_id):
    v2_repository.remove_match_group(match_id)
    return jsonify({'success': True})

@app.route('/api/v2/segment/update', methods=['POST'])
@login_required
def api_v2_update_segment():
    data = request.get_json() or {}
    segment_id = data.get('segment_id')
    if not segment_id:
        return jsonify({'error': 'segment_id required'}), 400
        
    start_time = data.get('start_time')
    end_time = data.get('end_time')
    text_content = data.get('text_content')
    
    v2_repository.update_segment_data(segment_id, start_time, end_time, text_content)
    return jsonify({'success': True})

@app.route('/api/v2/project/<int:project_id>/add_channel', methods=['POST'])
@login_required
def api_v2_add_channel(project_id):
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    channel_type = data.get('type', 'audio').strip()
    
    if not name or not channel_type:
        return jsonify({'error': 'Name and type are required'}), 400
        
    channel_id = v2_repository.add_channel(project_id, name, channel_type)
    return jsonify({'success': True, 'channel_id': channel_id})

@app.route('/api/v2/channel/<int:channel_id>', methods=['DELETE', 'POST'])
@login_required
def api_v2_delete_channel(channel_id):
    v2_repository.delete_channel(channel_id)
    return jsonify({'success': True})

@app.route('/api/v2/channel/update', methods=['POST'])
@login_required
def api_v2_update_channel():
    data = request.get_json() or {}
    channel_id = data.get('channel_id')
    name = data.get('name', '').strip()
    channel_type = data.get('type', '').strip()
    
    if not channel_id or not name or not channel_type:
        return jsonify({'error': 'channel_id, name, and type are required'}), 400
        
    v2_repository.update_channel_data(channel_id, name, channel_type)
    return jsonify({'success': True})

@app.route('/api/v2/channel/<int:channel_id>/add_media', methods=['POST'])
@login_required
def api_v2_add_media(channel_id):
    files = request.files.getlist('media_files') or request.files.getlist('media_file')
    if not files or all(f.filename == '' for f in files):
        return jsonify({'error': 'No file selected'}), 400

    sys_uploads_dir = os.path.join(
        repository.get_user_repo_base(app.config['UPLOAD_FOLDER'], g.user['id']),
        repository.SYSTEM_UPLOADS_DIR
    )
    os.makedirs(sys_uploads_dir, exist_ok=True)

    added_items = []
    for file in files:
        if not file or file.filename == '':
            continue

        filename = secure_filename(file.filename)
        if not filename:
            continue

        repo_target = os.path.join(sys_uploads_dir, filename)
        file.save(repo_target)

        uploads_target = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        try:
            shutil.copy(repo_target, uploads_target)
        except Exception:
            pass

        media_type = request.form.get('media_type')
        if not media_type:
            ext = os.path.splitext(filename)[1].lower()
            if ext in ['.csv']:
                media_type = 'csv'
            elif ext in ['.txt']:
                media_type = 'text'
            else:
                media_type = 'audio'

        media_id = v2_repository.add_channel_media(channel_id, filename, media_type=media_type)

        target_path = uploads_target if os.path.exists(uploads_target) else repo_target
        ext = os.path.splitext(filename)[1].lower()
        if media_type in ['text', 'transcript', 'translation', 'txt'] or ext in ['.txt', '.text']:
            try:
                with open(target_path, 'r', encoding='utf-8-sig', errors='replace') as tf:
                    text_content = tf.read().strip()
                v2_repository.save_media_segments(
                    media_id=media_id,
                    channel_id=channel_id,
                    segments=[{
                        'start': 0.0,
                        'end': 0.0,
                        'text': text_content,
                        'json_segment_id': 1
                    }]
                )
            except Exception as e:
                print(f"Error auto-segmenting text file: {e}")
        elif media_type == 'audio' or ext in ['.wav', '.flac', '.aiff', '.aif', '.ogg', '.m4a']:
            try:
                ensure_web_compatible_audio(target_path)
            except Exception as e:
                print(f"Error generating web-compatible audio on upload: {e}")

        added_items.append({'media_id': media_id, 'filename': filename})

    if not added_items:
        return jsonify({'error': 'No valid files processed'}), 400

    return jsonify({'success': True, 'count': len(added_items), 'items': added_items})

@app.route('/api/v2/project/<int:project_id>/import_tabular_media', methods=['POST'])
@login_required
def api_v2_import_tabular_media(project_id):
    files = request.files.getlist('media_files') or request.files.getlist('media_file')
    if not files or not files[0] or files[0].filename == '':
        return jsonify({'error': 'No file uploaded'}), 400

    file = files[0]
    filename = secure_filename(file.filename)
    if not filename:
        return jsonify({'error': 'Invalid filename'}), 400

    mappings_raw = request.form.get('column_mappings', '{}')
    delimiter = request.form.get('delimiter', ',')
    if delimiter == '\\t':
        delimiter = '\t'

    try:
        column_mappings = json.loads(mappings_raw)
    except Exception:
        return jsonify({'error': 'Invalid column_mappings format'}), 400

    if not column_mappings:
        return jsonify({'error': 'No column mappings specified'}), 400

    sys_uploads_dir = os.path.join(
        repository.get_user_repo_base(app.config['UPLOAD_FOLDER'], g.user['id']),
        repository.SYSTEM_UPLOADS_DIR
    )
    os.makedirs(sys_uploads_dir, exist_ok=True)
    repo_target = os.path.join(sys_uploads_dir, filename)
    file.save(repo_target)

    uploads_target = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    try:
        shutil.copy(repo_target, uploads_target)
    except Exception:
        pass

    try:
        with open(repo_target, 'r', encoding='utf-8-sig', errors='replace') as f:
            content = f.read()
    except Exception as e:
        return jsonify({'error': f'Error reading CSV content: {str(e)}'}), 400

    res = v2_repository.import_tabular_csv_media(
        project_id=project_id,
        filename=filename,
        csv_content=content,
        column_mappings=column_mappings,
        delimiter=delimiter
    )

    if 'error' in res:
        return jsonify({'error': res['error']}), 400

    return jsonify({'success': True, 'details': res})

@app.route('/api/v2/media/<int:media_id>/save_segments', methods=['POST'])
@login_required
def api_v2_save_media_segments(media_id):
    data = request.get_json() or {}
    channel_id = data.get('channel_id')
    segments = data.get('segments', [])
    
    if not channel_id:
        return jsonify({'error': 'channel_id is required'}), 400
        
    v2_repository.save_media_segments(media_id, channel_id, segments)
    return jsonify({'success': True})

@app.route('/api/v2/media/<int:media_id>/reset_segmentation', methods=['POST'])
@login_required
def api_v2_reset_media_segmentation(media_id):
    data = request.get_json() or {}
    channel_id = data.get('channel_id')
    
    if not channel_id:
        return jsonify({'error': 'channel_id is required'}), 400

    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM v2_media WHERE id = ?", (media_id,))
    media_row = cursor.fetchone()
    conn.close()

    if not media_row:
        return jsonify({'error': 'Media not found'}), 404

    filename = media_row['filename']
    
    sys_uploads_dir = os.path.join(
        repository.get_user_repo_base(app.config['UPLOAD_FOLDER'], g.user['id']),
        repository.SYSTEM_UPLOADS_DIR
    )
    repo_target = os.path.join(sys_uploads_dir, filename)
    uploads_target = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    
    target_path = None
    if os.path.exists(uploads_target):
        target_path = uploads_target
    elif os.path.exists(repo_target):
        target_path = repo_target

    if target_path and os.path.exists(target_path):
        try:
            with open(target_path, 'r', encoding='utf-8-sig', errors='replace') as tf:
                original_text = tf.read().strip()
        except Exception as e:
            return jsonify({'error': f'Error reading original file: {str(e)}'}), 500
    else:
        return jsonify({'error': f'Original file "{filename}" not found on server'}), 404

    v2_repository.save_media_segments(
        media_id=media_id,
        channel_id=channel_id,
        segments=[{
            'start': 0.0,
            'end': 0.0,
            'text': original_text,
            'json_segment_id': 1
        }]
    )

    return jsonify({'success': True, 'text': original_text})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)



